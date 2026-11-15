import type { Adapter } from "../adapter.ts";
import { GeocoderError } from "../errors.ts";
import type { Outcome, Plugin, PluginCall } from "../geocoder.ts";

/** Options for {@link failover}. */
export interface FailoverOptions {
  /** The adapters to fall back to, in order. */
  to: Adapter | readonly Adapter[];
  /**
   * Whether an error should move the call to the next adapter.
   * By default it does when the provider is unreachable, slow, overloaded, rate limited or broken,
   * or lacks the operation. A bad request or a rejected key does not, since the next provider
   * would be asked the same wrong thing.
   */
  when?: ((error: GeocoderError, call: PluginCall) => boolean) | undefined;
  /** Also fall back when the answer has no results. Default `false`. */
  onEmpty?: boolean | undefined;
  /** Called each time a call moves on. `error` is absent when it moved on for an empty answer. */
  onFailover?:
    | ((event: {
        from: Adapter;
        to: Adapter;
        error: GeocoderError | undefined;
        call: PluginCall;
      }) => void)
    | undefined;
}

/**
 * Tries the geocoder's own adapter first and falls back to others when it fails.
 * The result's `provider` names the adapter that answered.
 *
 * ```ts
 * new Geocoder({ adapter: og({ baseUrl }), plugins: [failover({ to: google({ apiKey }) })] });
 * ```
 */
export function failover(options: FailoverOptions): Plugin {
  const fallbacks = "id" in options.to ? [options.to] : [...options.to];
  const when = options.when ?? ((error: GeocoderError) => error.retryable);
  return {
    name: "failover",
    async handle(call, next) {
      let from = call.adapter;
      let attempt: () => Promise<Outcome> = () => next(call);
      for (let index = 0; ; index++) {
        const to = fallbacks[index];
        let error: GeocoderError | undefined;
        try {
          const outcome = await attempt();
          if (to === undefined || !options.onEmpty || outcome.result.results.length > 0)
            return outcome;
        } catch (thrown) {
          error = GeocoderError.from(thrown, { provider: from.id, operation: call.operation });
          if (to === undefined || error.code === "aborted" || !when(error, call)) throw error;
        }
        // `to` is defined here: both branches above leave the loop without it.
        const target = to as Adapter;
        options.onFailover?.({ from, to: target, error, call });
        from = target;
        attempt = () => call.run(target);
      }
    },
  };
}
