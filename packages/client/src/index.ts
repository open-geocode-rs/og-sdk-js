/**
 * One geocoding API over any provider.
 *
 * ```ts
 * import { Geocoder } from "@open-geocode/client";
 * import { og } from "@open-geocode/client/og";
 * const geo = new Geocoder({ adapter: og({ baseUrl: "http://localhost:8080" }) });
 * const { results } = await geo.geocode("10 King St W, Toronto");
 * ```
 *
 * The adapters are `@open-geocode/client/og`, `/google`, `/mapbox`, `/here` and `/precisely`.
 * The plugins are in `@open-geocode/client/plugins`.
 */
export {
  Geocoder,
  MAX_LANGUAGES,
  veto,
  type BatchMode,
  type Capabilities,
  type GeocoderOptions,
  type GeocoderPromise,
  type Outcome,
  type Plugin,
  type PluginCall,
  type ResultEnvelope,
} from "./geocoder.ts";
export type * from "./types.ts";
export {
  batchItem,
  cacheRule,
  chunk,
  createTransport,
  distance,
  emptyAddress,
  nativeRequest,
  oneLine,
  pool,
  sleep,
  streetLine,
  text,
  toParams,
  toStringRanges,
  utcOffsetMinutes,
  type Adapter,
  type AdapterBatchItem,
  type AdapterCapabilities,
  type AdapterOptions,
  type AdapterResult,
  type BatchContext,
  type BatchGeocodeItem,
  type CacheRule,
  type NativeCall,
  type NativeRequest,
  type OperationCapabilities,
} from "./adapter.ts";
export {
  APIPromise,
  retryDelay,
  Transport,
  type Call,
  type Logger,
  type LogLevel,
  type RequestOptions,
  type TransportOptions,
  type WithResponse,
} from "./core.ts";
export * from "./errors.ts";
// og's native client, also exported from `@open-geocode/client/og`.
export { createClient } from "./client.ts";
export type * from "./client.ts";
export type { components, operations, paths } from "./schema.gen.ts";
