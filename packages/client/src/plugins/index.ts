/**
 * Plugins for a `Geocoder`.
 *
 * ```ts
 * import { cache, compare, failover } from "@open-geocode/client/plugins";
 * ```
 */
export {
  cache,
  cacheKey,
  memoryStore,
  type CacheLimitEvent,
  type CacheOptions,
  type CacheStore,
} from "./cache.ts";
export {
  compare,
  compareResults,
  type CompareOptions,
  type CompareReport,
  type CompareSide,
  type Comparison,
} from "./compare.ts";
export { failover, type FailoverOptions } from "./failover.ts";
