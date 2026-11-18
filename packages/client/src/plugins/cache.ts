import type { Plugin, PluginCall } from "../base.ts";
import type { CacheRule, Outcome, Shape } from "../core.ts";

/** What the cache did to stay inside the rule of the server that answered. */
export interface CacheLimitEvent {
  /** The server that answered. */
  server: Shape;
  method: string;
  /**
   * - `skipped`: the server's answers to this call may not be kept, so nothing was cached.
   * - `shortened`: the answer is kept for `allowed` and not for the longer `asked`.
   */
  action: "skipped" | "shortened";
  /** The `ttl` the cache was set up with, in milliseconds. */
  asked: number;
  /** The longest the server allows, in milliseconds. */
  allowed: number;
}

/** What the cache keeps of an answer. */
export interface CacheEntry {
  data: unknown;
  server: Shape;
  cache: CacheRule;
}

/** Where {@link cache} keeps its entries. Implement it to share a cache between processes. */
export interface CacheStore {
  get(key: string): CacheEntry | undefined | Promise<CacheEntry | undefined>;
  set(key: string, value: CacheEntry, ttl: number): void | Promise<void>;
}

/** Options for {@link cache}. */
export interface CacheOptions {
  /** Milliseconds an answer is kept. Default 300000, five minutes. */
  ttl?: number | undefined;
  /** Entries the built-in store keeps before it drops the least recently used. Default 500. */
  max?: number | undefined;
  /** The methods to cache, by name, such as `geocode` or `geocoding.forward`. Default every lookup. */
  methods?: readonly string[] | undefined;
  /** A store of your own, in place of the built-in memory store. */
  store?: CacheStore | undefined;
  /** The key of a call. Return `undefined` to leave the call uncached. */
  key?: ((call: PluginCall) => string | undefined) | undefined;
  /** Called on every lookup of the cache. */
  onLookup?: ((event: { key: string; hit: boolean; call: PluginCall }) => void) | undefined;
  /**
   * Called each time a server's rule makes the cache keep an answer for less time than `ttl`, or not at all.
   * Without it, the cache warns on the console the first time each case arises.
   */
  onLimit?: ((event: CacheLimitEvent) => void) | undefined;
}

/** JSON with object keys in a fixed order, so equal requests give equal keys. */
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  // `toSorted` needs ES2023 and the package targets ES2022. The array is fresh, so sorting it in place is safe.
  // oxlint-disable-next-line unicorn/no-array-sort
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(",")}}`;
}

/** The default cache key, made of the API, the server, the method and its arguments. */
export function cacheKey(call: PluginCall): string {
  return `${call.client.shape}:${call.client.server}:${call.method}:${stable(call.args)}`;
}

/** A least-recently-used store in memory. */
export function memoryStore(max = 500): CacheStore {
  const entries = new Map<string, { value: CacheEntry; expires: number }>();
  return {
    get(key) {
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      entries.delete(key);
      if (entry.expires <= Date.now()) return undefined;
      // Re-inserting moves the entry to the young end of the map's order.
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value, ttl) {
      entries.delete(key);
      entries.set(key, { value, expires: Date.now() + ttl });
      while (entries.size > max) entries.delete(entries.keys().next().value as string);
    },
  };
}

/** A time span in words, in the largest unit that reads well. */
function span(ms: number): string {
  if (ms === Infinity) return "ever";
  const [size, unit] =
    ms < 3_600_000
      ? [60_000, "minute"]
      : ms < 172_800_000
        ? [3_600_000, "hour"]
        : [86_400_000, "day"];
  const count = Math.round((ms / size) * 10) / 10;
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/**
 * Answers a repeated call from memory instead of the server.
 * A cached answer has no HTTP response, so `withResponse()` gives `response: undefined` for it.
 * Each caller gets its own copy, so changing an answer never changes the cache.
 *
 * A cache never keeps an answer longer than the server that gave it allows.
 * Every answer carries that rule in `cache`, as the client that fetched it states it.
 * The cache keeps an answer for the shorter of `ttl` and that rule, keeps nothing where the rule is `0`,
 * and says so through `onLimit` each time, never silently.
 */
export function cache(options: CacheOptions = {}): Plugin {
  const ttl = options.ttl ?? 300_000;
  const store = options.store ?? memoryStore(options.max);
  const methods = options.methods ? new Set(options.methods) : undefined;
  const keyOf = options.key ?? cacheKey;
  const warned = new Set<string>();
  const limit = (event: CacheLimitEvent): void => {
    if (options.onLimit) {
      options.onLimit(event);
      return;
    }
    const once = `${event.server}:${event.method}:${event.action}`;
    if (warned.has(once) || typeof console === "undefined") return;
    warned.add(once);
    console.warn(
      event.action === "skipped"
        ? `[cache] ${event.server} does not allow a ${event.method} answer to be kept, so it is not cached.`
        : `[cache] ${event.server} allows a ${event.method} answer to be kept for ${span(event.allowed)}, so it is not kept for the ${span(event.asked)} asked for.`,
    );
  };
  return {
    name: "cache",
    async handle(call, next) {
      if (methods && !methods.has(call.method)) return next();
      const key = keyOf(call);
      if (key === undefined) return next();
      const hit = await store.get(key);
      options.onLookup?.({ key, hit: hit !== undefined, call });
      if (hit !== undefined)
        return {
          ...hit,
          data: structuredClone(hit.data),
          response: undefined,
          requestId: undefined,
        };
      const outcome: Outcome = await next();
      // The rule is the answering server's, which another plugin may have chosen.
      const allowed = outcome.cache.maxTtl;
      const event = { server: outcome.server, method: call.method, asked: ttl, allowed };
      if (!(allowed > 0)) {
        limit({ ...event, action: "skipped" });
        return outcome;
      }
      if (allowed < ttl) limit({ ...event, action: "shortened" });
      await store.set(
        key,
        { data: structuredClone(outcome.data), server: outcome.server, cache: outcome.cache },
        Math.min(ttl, allowed),
      );
      return outcome;
    },
  };
}
