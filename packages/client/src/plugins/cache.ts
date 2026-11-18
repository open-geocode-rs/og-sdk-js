import { cacheRule } from "../adapter.ts";
import type { Outcome, Plugin, PluginCall } from "../geocoder.ts";
import type { Operation, ProviderId } from "../types.ts";

/** What the cache did to stay inside a provider's rule. */
export interface CacheLimitEvent {
  provider: ProviderId;
  operation: Operation;
  /**
   * - `skipped`: the provider's answers to this operation may not be kept, so nothing was cached.
   * - `shortened`: the answer is kept for `allowed` and not for the longer `asked`.
   * - `foreign`: another provider answered in place of the one asked, so its answer was not kept.
   */
  action: "skipped" | "shortened" | "foreign";
  /** The `ttl` the cache was set up with, in milliseconds. */
  asked: number;
  /** The longest the provider allows, in milliseconds. */
  allowed: number;
}

/** Where {@link cache} keeps its entries. Implement it to share a cache between processes. */
export interface CacheStore {
  get(key: string): Outcome["result"] | undefined | Promise<Outcome["result"] | undefined>;
  set(key: string, value: Outcome["result"], ttl: number): void | Promise<void>;
}

/** Options for {@link cache}. */
export interface CacheOptions {
  /** Milliseconds an answer is kept. Default 300000, five minutes. */
  ttl?: number | undefined;
  /** Entries the built-in store keeps before it drops the least recently used. Default 500. */
  max?: number | undefined;
  /** The operations to cache. Default all five. */
  operations?: readonly Operation[] | undefined;
  /** A store of your own, in place of the built-in memory store. */
  store?: CacheStore | undefined;
  /** The key of a call. Return `undefined` to leave the call uncached. */
  key?: ((call: PluginCall) => string | undefined) | undefined;
  /** Called on every lookup of the cache. */
  onLookup?: ((event: { key: string; hit: boolean; call: PluginCall }) => void) | undefined;
  /**
   * Called each time a provider's rule makes the cache keep an answer for less time than `ttl`, or not at all.
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

/** The default cache key, made of the provider, the operation and the whole request except its `session`. */
export function cacheKey(call: PluginCall): string {
  const { session: _session, ...request } = call.request;
  return `${call.adapter.id}:${call.operation}:${stable(request)}`;
}

/** A least-recently-used store in memory. */
export function memoryStore(max = 500): CacheStore {
  const entries = new Map<string, { value: Outcome["result"]; expires: number }>();
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

const days = (ms: number): string =>
  ms === 0 ? "not at all" : `for ${Math.round((ms / 86_400_000) * 100) / 100} days`;

/**
 * Answers a repeated call from memory instead of the provider.
 * A cached answer has no HTTP response, so `withResponse()` gives `response: undefined` for it.
 * Each caller gets its own copy, so changing a result never changes the cache.
 *
 * A cache never keeps an answer longer than its provider allows.
 * Each adapter states its provider's rule in `capabilities.cache`, and an operation may state its own.
 * The cache keeps an answer for the shorter of `ttl` and that rule, keeps nothing where the rule is `0`,
 * and says so through `onLimit` each time, never silently.
 */
export function cache(options: CacheOptions = {}): Plugin {
  const ttl = options.ttl ?? 300_000;
  const store = options.store ?? memoryStore(options.max);
  const operations = options.operations ? new Set(options.operations) : undefined;
  const keyOf = options.key ?? cacheKey;
  const warned = new Set<string>();
  const limit = (event: CacheLimitEvent): void => {
    if (options.onLimit) {
      options.onLimit(event);
      return;
    }
    const once = `${event.provider}:${event.operation}:${event.action}`;
    if (warned.has(once) || typeof console === "undefined") return;
    warned.add(once);
    console.warn(
      event.action === "foreign"
        ? `[cache] ${event.provider} answered a ${event.operation} call in place of the provider asked, so its answer is not kept.`
        : `[cache] ${event.provider} allows a ${event.operation} answer to be kept ${days(event.allowed)}, so it is not kept for the ${days(event.asked).replace("for ", "")} asked for.`,
    );
  };
  return {
    name: "cache",
    async handle(call, next) {
      if (operations && !operations.has(call.operation)) return next(call);
      const key = keyOf(call);
      if (key === undefined) return next(call);
      const provider = call.adapter.id;
      const allowed = cacheRule(call.adapter.capabilities, call.operation).maxTtl;
      const event = { provider, operation: call.operation, asked: ttl, allowed };
      if (!(allowed > 0)) {
        limit({ ...event, action: "skipped" });
        return next(call);
      }
      const hit = await store.get(key);
      options.onLookup?.({ key, hit: hit !== undefined, call });
      if (hit !== undefined)
        return { result: structuredClone(hit), response: undefined, requestId: undefined };
      const outcome = await next(call);
      // Another plugin may have sent the call to a provider with a rule this cache does not know.
      if (outcome.result.provider !== provider) {
        limit({ ...event, provider: outcome.result.provider, action: "foreign" });
        return outcome;
      }
      if (allowed < ttl) limit({ ...event, action: "shortened" });
      await store.set(key, structuredClone(outcome.result), Math.min(ttl, allowed));
      return outcome;
    },
  };
}
