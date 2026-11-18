/**
 * The client for og's own API.
 *
 * ```ts
 * import { createClient } from "@open-geocode/client";
 * const og = createClient({ baseUrl: "http://localhost:8080" });
 * const { features } = await og.geocode({ q: "10 King St W, Toronto" });
 * ```
 *
 * A client that speaks a vendor's API instead is in `@open-geocode/client/google`, `/mapbox`,
 * `/here` and `/precisely`. The plugins are in `@open-geocode/client/plugins`.
 */
export { ALL_EXTRAS, createClient } from "./client.ts";
export type * from "./client.ts";
export {
  veto,
  type ClientInfo,
  type CommonOptions,
  type Plugin,
  type PluginCall,
  type Position,
} from "./base.ts";
export {
  APIPromise,
  type CacheRule,
  type Logger,
  type LogLevel,
  type Outcome,
  type RequestOptions,
  type Shape,
  type WithResponse,
} from "./core.ts";
export * from "./errors.ts";
export type { components, operations, paths } from "./schema.gen.ts";
