/**
 * Plugins for any client.
 *
 * ```ts
 * import { cache, compare, failover } from "@open-geocode/client/plugins";
 * ```
 */
export {
  cache,
  cacheKey,
  memoryStore,
  type CacheEntry,
  type CacheLimitEvent,
  type CacheOptions,
  type CacheStore,
} from "./cache.ts";
export {
  compare,
  comparePositions,
  distance,
  type CompareOptions,
  type CompareReport,
  type CompareSide,
  type Comparison,
} from "./compare.ts";
export { failover, type FailoverOptions } from "./failover.ts";
