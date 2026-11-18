/**
 * What every client is built on.
 * One transport with retries, timeouts and request IDs, one plugin pipeline and one error class,
 * whichever API the client speaks and whichever server answers it.
 */
import {
  APIPromise,
  type CacheRule,
  type Call,
  type Logger,
  type LogLevel,
  type Outcome,
  readBody,
  type RequestOptions,
  type Shape,
  Transport,
} from "./core.ts";
import { GeocoderError, type GeocoderErrorCode, OgError } from "./errors.ts";

/** A point on the map. */
export interface Position {
  lat: number;
  lon: number;
}

/** What a client says about itself. Every client carries these two fields. */
export interface ClientInfo {
  /** The API the client speaks. */
  readonly shape: Shape;
  /** The server that answers. It is `og` when the client points at an og server, else the vendor. */
  readonly server: Shape;
}

/** One call on its way through the plugins. */
export interface PluginCall {
  /** The client the call was made on. */
  readonly client: ClientInfo;
  /** The method called, such as `geocode` or `geocoding.forward`. */
  readonly method: string;
  /** The arguments given to the method, without the trailing request options. */
  readonly args: readonly unknown[];
  readonly options: RequestOptions | undefined;
  /** Makes the same call on another client that speaks the same API. */
  run(client: ClientInfo): Promise<Outcome>;
  /** The points of the results in an answer to this call, in order. A result without a point is left out. */
  positions(data: unknown): Position[];
}

/**
 * A step of the pipeline. Plugins run in the order given, each wrapping the ones after it.
 *
 * - To pass the call on, return `next()`.
 * - To answer without the server, return an outcome and never call `next`.
 * - To refuse the call, throw `veto("why")`.
 */
export interface Plugin {
  name: string;
  /** Called once when a client is built with the plugin. Throw here to refuse the client. */
  setup?(client: ClientInfo): void;
  handle(call: PluginCall, next: () => Promise<Outcome>): Promise<Outcome>;
}

/** The error a plugin throws to refuse a call. */
export function veto(reason: string, method?: string): GeocoderError {
  return new GeocoderError(reason, { code: "vetoed", operation: method });
}

/** Options every client accepts. */
export interface CommonOptions {
  /** Headers sent with every request, for example your gateway's auth header. */
  headers?: Record<string, string> | undefined;
  /** A custom `fetch`. Defaults to the global one. */
  fetch?: typeof globalThis.fetch | undefined;
  /** Milliseconds before a request fails with code `timeout`. Default 60000. `Infinity` or `0` sets no limit. */
  timeout?: number | undefined;
  /** Times a failed request is retried, with exponential backoff. Default 2. */
  maxRetries?: number | undefined;
  /** How much to log. Default `"warn"`. */
  logLevel?: LogLevel | undefined;
  /** Where to log. Default `console`. */
  logger?: Logger | undefined;
  /** Plugins, outermost first. */
  plugins?: readonly Plugin[] | undefined;
}

/** What a client module tells the base about its API. */
export interface BaseSpec {
  shape: Shape;
  options: CommonOptions;
  /** An og server. With it, every request goes to og, under `/compat/<shape>` for a vendor's API. */
  baseUrl: string | undefined;
  /** Whether the vendor's own credentials were given. Without them and without `baseUrl` there is no server to ask. */
  credentials?: boolean | undefined;
  /** The root every relative path is under when the vendor itself answers. Default none, for a client that sends absolute URLs. */
  vendorUrl?: string | undefined;
  /** Headers sent to the vendor only, never to og. A vendor's key goes here. */
  vendorHeaders?: Record<string, string> | undefined;
  /** How long the vendor's answers may be kept, for a call that states no rule of its own. Default never. */
  cache?: CacheRule | undefined;
  /** Reads a message out of an error body. */
  describeError?: ((body: unknown, status: number) => string | undefined) | undefined;
  /** Response headers that may hold the request ID, in order of preference. */
  requestIdHeaders?: readonly string[] | undefined;
  /** Reads an error the HTTP status alone would misread. */
  errorCode?: ((error: OgError, method: string) => GeocoderErrorCode | undefined) | undefined;
  /** The points of the results in an answer to `method`, in order. */
  positions?: ((method: string, data: unknown) => Position[]) | undefined;
}

/** One method call, as a client module describes it to the base. */
export interface Step<T> {
  /** The method's name, dotted where it is nested, exactly as it is reached on the client. */
  method: string;
  /** The method's arguments, without the trailing request options. */
  args: readonly unknown[];
  options: RequestOptions | undefined;
  /** Sends the request. Called once per run of the pipeline's last step. */
  send(options: RequestOptions | undefined): Promise<Response>;
  /** Reads the body. Default JSON. */
  parse?: ((response: Response) => Promise<T>) | undefined;
  /** How long the vendor's answer may be kept, where it differs from the client's own rule. */
  cache?: CacheRule | ((response: Response) => CacheRule) | undefined;
  /** `false` for a call no plugin should see, such as a job's upload or its status. */
  plugins?: boolean | undefined;
}

/** What {@link createBase} gives a client module. */
export interface Base extends ClientInfo {
  readonly transport: Transport;
  /** Sends one HTTP request through the transport. */
  http(call: Call): Promise<Response>;
  /** Runs a method call through the plugins and the transport. */
  call<T>(step: Step<T>): APIPromise<T>;
}

const silent: Logger = { error() {}, warn() {}, info() {}, debug() {} };

/** An answer from og may be kept without limit, whichever API it was asked through. */
const UNLIMITED: CacheRule = { maxTtl: Infinity };
const NEVER: CacheRule = { maxTtl: 0 };

/** Finds a method on a client by its dotted name. */
function find(
  client: object,
  name: string,
): ((...args: unknown[]) => APIPromise<unknown>) | undefined {
  let found: unknown = client;
  for (const part of name.split(".")) {
    if (found === null || typeof found !== "object") return undefined;
    found = (found as Record<string, unknown>)[part];
  }
  return typeof found === "function"
    ? (found as (...args: unknown[]) => APIPromise<unknown>)
    : undefined;
}

/** Builds the transport and the pipeline of one client. */
export function createBase(spec: BaseSpec): Base {
  const { shape, options } = spec;
  const og = spec.baseUrl?.replace(/\/+$/, "");
  if (og === undefined && !spec.credentials)
    throw new GeocoderError(
      shape === "og"
        ? "The og client needs `baseUrl`, the address of an og server."
        : `The ${shape} client needs either \`baseUrl\`, the address of an og server, or ${shape}'s own credentials.`,
      { code: "invalid_request", provider: shape },
    );
  const server: Shape = og === undefined ? shape : "og";
  const info: ClientInfo = { shape, server };
  const plugins = options.plugins ?? [];
  for (const plugin of plugins) plugin.setup?.(info);

  const transport = new Transport({
    name: server,
    baseUrl:
      og === undefined ? (spec.vendorUrl ?? "") : shape === "og" ? og : `${og}/compat/${shape}`,
    // A vendor's key is never sent to og.
    headers: { ...(server === "og" ? {} : spec.vendorHeaders), ...options.headers },
    fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
    timeout: options.timeout ?? 60_000,
    maxRetries: options.maxRetries ?? 2,
    logLevel: options.logLevel ?? "warn",
    logger: options.logger ?? (typeof console === "undefined" ? silent : console),
    describeError: spec.describeError,
    // A vendor's own header comes first, since some vendors only echo the caller's `x-request-id`.
    requestIdHeaders: [...(spec.requestIdHeaders ?? []), "x-request-id"],
  });

  const fail = (thrown: unknown, name: string): GeocoderError =>
    GeocoderError.from(thrown, {
      provider: server,
      operation: name,
      code: thrown instanceof OgError ? spec.errorCode?.(thrown, name) : undefined,
    });

  async function last<T>(step: Step<T>): Promise<Outcome<T>> {
    const response = await step.send(step.options);
    let data: T;
    try {
      data = await readBody(response, step.parse ?? ((answer) => answer.json() as Promise<T>));
    } catch (thrown) {
      if (thrown instanceof OgError) throw thrown;
      throw new GeocoderError(`${server} sent an answer that cannot be read.`, {
        code: "provider_error",
        operation: step.method,
        provider: server,
        status: response.status,
        headers: response.headers,
        requestId: transport.requestId(response.headers),
        cause: thrown,
      });
    }
    const rule = step.cache ?? spec.cache ?? NEVER;
    return {
      data,
      response,
      requestId: transport.requestId(response.headers),
      server,
      cache: server === "og" ? UNLIMITED : typeof rule === "function" ? rule(response) : rule,
    };
  }

  function run<T>(step: Step<T>): Promise<Outcome<T>> {
    if (step.plugins === false || plugins.length === 0) return last(step);
    const call: PluginCall = {
      client: info,
      method: step.method,
      args: step.args,
      options: step.options,
      run(other) {
        if (other.shape !== shape)
          throw new GeocoderError(
            `A ${shape} call cannot run on a ${other.shape} client, since the two speak different APIs.`,
            { code: "unsupported", operation: step.method, provider: other.server },
          );
        const found = find(other, step.method);
        if (found === undefined)
          throw new GeocoderError(`The other client has no method ${step.method}.`, {
            code: "unsupported",
            operation: step.method,
            provider: other.server,
          });
        return found(...step.args, step.options).withResponse();
      },
      positions: (data) => spec.positions?.(step.method, data) ?? [],
    };
    const dispatch = (index: number): Promise<Outcome> => {
      const plugin = plugins[index];
      return plugin === undefined ? last(step) : plugin.handle(call, () => dispatch(index + 1));
    };
    return dispatch(0) as Promise<Outcome<T>>;
  }

  return {
    ...info,
    transport,
    http: (call) => transport.send(call),
    call<T>(step: Step<T>): APIPromise<T> {
      // The request is sent before the method returns, and a plugin that throws at once still rejects the call.
      let outcome: Promise<Outcome<T>>;
      try {
        outcome = run(step);
      } catch (thrown) {
        outcome = Promise.reject(thrown);
      }
      return new APIPromise(
        outcome.catch((thrown: unknown) => {
          throw fail(thrown, step.method);
        }),
      );
    },
  };
}
