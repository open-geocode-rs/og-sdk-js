import type { ClientInfo, Plugin, PluginCall } from "../base.ts";
import type { Outcome } from "../core.ts";
import { GeocoderError } from "../errors.ts";

/** Options for {@link failover}. */
export interface FailoverOptions {
  /** The clients to fall back to, in order. Each must speak the same API as the client the plugin is on. */
  to: ClientInfo | readonly ClientInfo[];
  /**
   * Whether an error should move the call to the next client.
   * By default it does when the server is unreachable, slow, overloaded, rate limited or broken,
   * or lacks the method. A bad request or a rejected key does not, since the next server
   * would be asked the same wrong thing.
   */
  when?: ((error: GeocoderError, call: PluginCall) => boolean) | undefined;
  /** Whether an answer counts as empty, which also moves the call on. Default never. */
  empty?: ((data: unknown, call: PluginCall) => boolean) | undefined;
  /** Called each time a call moves on. `error` is absent when it moved on for an empty answer. */
  onFailover?:
    | ((event: {
        from: ClientInfo;
        to: ClientInfo;
        error: GeocoderError | undefined;
        call: PluginCall;
      }) => void)
    | undefined;
}

/** Refuses a second client that speaks another API, since a call cannot move between two shapes. */
export function sameShape(plugin: string, client: ClientInfo, other: ClientInfo): void {
  if (other.shape !== client.shape)
    throw new GeocoderError(
      `${plugin} needs two clients that speak the same API, and was given ${client.shape} and ${other.shape}.`,
      { code: "invalid_request", provider: other.server },
    );
}

/**
 * Tries the client's own server first and falls back to others when it fails.
 * Every client involved speaks the same API, so the caller reads the answer the same way whoever gave it.
 * `withResponse()` names the server that answered in `server`.
 *
 * ```ts
 * mapbox({ accessToken, plugins: [failover({ to: mapbox({ baseUrl: "http://localhost:8080" }) })] });
 * ```
 */
export function failover(options: FailoverOptions): Plugin {
  const fallbacks = "shape" in options.to ? [options.to] : [...options.to];
  const when = options.when ?? ((error: GeocoderError) => error.retryable);
  return {
    name: "failover",
    setup(client) {
      for (const fallback of fallbacks) sameShape("failover", client, fallback);
    },
    async handle(call, next) {
      let from = call.client;
      let attempt: () => Promise<Outcome> = next;
      for (let index = 0; ; index++) {
        const to = fallbacks[index];
        let error: GeocoderError | undefined;
        try {
          const outcome = await attempt();
          if (to === undefined || !options.empty?.(outcome.data, call)) return outcome;
        } catch (thrown) {
          error = GeocoderError.from(thrown, { provider: from.server, operation: call.method });
          if (to === undefined || error.code === "aborted" || !when(error, call)) throw error;
        }
        // `to` is defined here, since both branches above leave the loop without it.
        const target = to as ClientInfo;
        options.onFailover?.({ from, to: target, error, call });
        from = target;
        attempt = () => call.run(target);
      }
    },
  };
}
