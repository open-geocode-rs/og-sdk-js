import type { Outcome, Plugin, PluginCall } from "../geocoder.ts";
import type { Operation } from "../types.ts";

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

/** The default cache key: provider, operation and the whole request, except its `session`. */
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

/**
 * Answers a repeated call from memory instead of the provider.
 * A cached answer has no HTTP response, so `withResponse()` gives `response: undefined` for it.
 * Each caller gets its own copy, so changing a result never changes the cache.
 * Check what your provider's terms allow you to keep, and for how long, before raising `ttl`.
 */
export function cache(options: CacheOptions = {}): Plugin {
  const ttl = options.ttl ?? 300_000;
  const store = options.store ?? memoryStore(options.max);
  const operations = options.operations ? new Set(options.operations) : undefined;
  const keyOf = options.key ?? cacheKey;
  return {
    name: "cache",
    async handle(call, next) {
      if (operations && !operations.has(call.operation)) return next(call);
      const key = keyOf(call);
      if (key === undefined) return next(call);
      const hit = await store.get(key);
      options.onLookup?.({ key, hit: hit !== undefined, call });
      if (hit !== undefined)
        return { result: structuredClone(hit), response: undefined, requestId: undefined };
      const outcome = await next(call);
      await store.set(key, structuredClone(outcome.result), ttl);
      return outcome;
    },
  };
}
