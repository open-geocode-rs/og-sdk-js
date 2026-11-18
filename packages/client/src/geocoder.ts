import {
  type Adapter,
  type AdapterBatchItem,
  type AdapterCapabilities,
  batchItem,
  distance,
  oneLine,
  type OperationCapabilities,
  pool,
} from "./adapter.ts";
import { APIPromise, type RequestOptions } from "./core.ts";
import { GeocoderError, OgError } from "./errors.ts";
import type {
  Attribution,
  BaseRequest,
  BatchGeocodeInput,
  BatchItem,
  BatchOptions,
  BatchResult,
  BatchReverseInput,
  FieldName,
  GeocodeRequest,
  GeocodeResult,
  Include,
  LatLon,
  LookupOptions,
  Operation,
  OptionName,
  PlaceRecord,
  ProviderId,
  Requests,
  ReverseOptions,
  SearchOptions,
  StructuredAddress,
} from "./types.ts";

/** A result before its `include` is known to the type system. Plugins work with this shape. */
export interface ResultEnvelope {
  provider: ProviderId;
  operation: Operation;
  results: PlaceRecord[];
  attribution: Attribution[];
  unavailable: FieldName[];
  ignored: OptionName[];
  /** Present only when `include` asks for `raw`. */
  raw?: unknown;
}

/** What a call produced. */
export interface Outcome {
  result: ResultEnvelope;
  /** The HTTP response. Absent when no request was made, as on a cache hit. */
  response: Response | undefined;
  requestId: string | undefined;
}

/** One call on its way through the plugins. */
export interface PluginCall<O extends Operation = Operation> {
  readonly operation: O;
  /** The normalised request. A plugin may replace it before calling `next`. */
  request: Requests[O];
  options: RequestOptions | undefined;
  /** The adapter the call is headed for. */
  readonly adapter: Adapter;
  /** Sends this call straight to an adapter, past the remaining plugins. Defaults to the call's own adapter. */
  run(adapter?: Adapter): Promise<Outcome>;
}

/**
 * A step of the pipeline. Plugins run in the order given, each wrapping the ones after it.
 *
 * - To observe, call `next(call)` and look at what comes back.
 * - To transform, change `call.request` before `next`, or the outcome after it.
 * - To veto, throw `veto("why")` instead of calling `next`.
 */
export interface Plugin {
  name: string;
  handle(call: PluginCall, next: (call: PluginCall) => Promise<Outcome>): Promise<Outcome>;
}

/** The error a plugin throws to refuse a call. */
export function veto(reason: string, operation?: string): GeocoderError {
  return new GeocoderError(reason, { code: "vetoed", operation });
}

/** How a batch runs. `native` uses the provider's batch endpoint, `emulated` runs single calls, `false` means the operation is missing. */
export type BatchMode = "native" | "emulated" | false;

/** What a `Geocoder` can do with its adapter. Check here before relying on a feature. */
export type Capabilities = Omit<AdapterCapabilities, "batch"> & {
  batch: { geocode: BatchMode; reverse: BatchMode };
};

/** Options for a {@link Geocoder}. */
export interface GeocoderOptions<A extends Adapter = Adapter> {
  /** The provider to talk to. Switching provider is changing this one line. */
  adapter: A;
  /** Plugins, outermost first. */
  plugins?: readonly Plugin[] | undefined;
  /**
   * When `true`, a call fails with `unsupported` if the provider cannot honour one of its options.
   * By default such an option is left out and reported in the result's `ignored`.
   */
  strict?: boolean | undefined;
  /** Milliseconds before a request fails. Overrides the adapter's own setting. */
  timeout?: number | undefined;
  /** Times a failed request is retried. Overrides the adapter's own setting. */
  maxRetries?: number | undefined;
}

/** The promise every `Geocoder` operation returns. Await it for the result, or call `withResponse()`. */
export type GeocoderPromise<I extends Include = never> = APIPromise<
  GeocodeResult<I>,
  Response | undefined
>;

const CORE_FIELDS: readonly FieldName[] = [
  "id",
  "location",
  "accuracy",
  "confidence",
  "distance",
  "address",
];
const OPTIONS: readonly Exclude<OptionName, "structured">[] = [
  "limit",
  "language",
  "countries",
  "focus",
  "bounds",
  "types",
  "session",
];
const CORE_KEYS = [
  "id",
  "type",
  "name",
  "label",
  "location",
  "accuracy",
  "confidence",
  "distance",
  "address",
] as const;

/**
 * The most language codes one call may ask for.
 * Every further language adds a name to each result and to each area around it,
 * so the list is capped to keep the size of an answer bounded.
 */
export const MAX_LANGUAGES = 20;

/** Refuses a request no provider should be sent. */
function validate(request: BaseRequest, provider: ProviderId, operation: string): void {
  const count = request.language?.length ?? 0;
  if (count > MAX_LANGUAGES)
    throw new GeocoderError(
      `language takes at most ${MAX_LANGUAGES} codes, and ${count} were given.`,
      { code: "invalid_request", provider, operation },
    );
}

function baseRequest(options: SearchOptions<Include> | undefined): BaseRequest {
  const request: BaseRequest = { include: [...new Set(options?.include)] };
  if (options?.limit !== undefined) request.limit = options.limit;
  if (options?.language !== undefined)
    request.language =
      typeof options.language === "string" ? [options.language] : [...options.language];
  if (options?.countries !== undefined)
    request.countries = options.countries.map((code) => code.toUpperCase());
  if (options?.focus !== undefined) request.focus = options.focus;
  if (options?.bounds !== undefined) request.bounds = options.bounds;
  if (options?.types !== undefined) request.types = [...options.types];
  if (options?.session !== undefined) request.session = options.session;
  return request;
}

function geocodeRequest(query: string | StructuredAddress, base: BaseRequest): GeocodeRequest {
  return typeof query === "string" ? { ...base, query } : { ...base, address: query };
}

/**
 * One geocoding API over any provider.
 *
 * ```ts
 * const geo = new Geocoder({ adapter: og({ baseUrl: "http://localhost:8080" }) });
 * const { results } = await geo.geocode("10 King St W, Toronto");
 * ```
 */
export class Geocoder<A extends Adapter = Adapter> {
  /** The adapter this geocoder talks to. */
  readonly adapter: A;
  /** What this geocoder supports. */
  readonly capabilities: Capabilities;
  readonly #plugins: readonly Plugin[];
  readonly #strict: boolean;
  readonly #defaults: RequestOptions;

  constructor(options: GeocoderOptions<A>) {
    this.adapter = options.adapter;
    this.#plugins = options.plugins ?? [];
    this.#strict = options.strict ?? false;
    this.#defaults = {
      ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
      ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
    };
    const { batch, ...operations } = options.adapter.capabilities;
    // The distance from a reverse point is measured here when the provider sends none.
    const { reverse } = operations;
    if (reverse?.fields.includes("location") && !reverse.fields.includes("distance"))
      operations.reverse = { ...reverse, fields: [...reverse.fields, "distance"] };
    this.capabilities = {
      ...operations,
      // An adapter that states no cache rule is one whose answers may never be kept.
      cache: operations.cache ?? { maxTtl: 0 },
      batch: {
        geocode: mode(batch?.geocode, operations.geocode),
        reverse: mode(batch?.reverse, operations.reverse),
      },
    };
  }

  /** The adapter's name, such as `og` or `google`. */
  get provider(): ProviderId {
    return this.adapter.id;
  }

  /** The provider's own API, for anything outside the unified surface. */
  get native(): A["native"] {
    return this.adapter.native;
  }

  /** Forward geocoding. Text, or an address in parts, to places. */
  geocode<I extends Include = never>(
    query: string | StructuredAddress,
    options?: SearchOptions<I>,
  ): GeocoderPromise<I> {
    return this.#call("geocode", geocodeRequest(query, baseRequest(options)), options);
  }

  /** Reverse geocoding. A point to the places at it, nearest first. */
  reverse<I extends Include = never>(
    point: LatLon,
    options?: ReverseOptions<I>,
  ): GeocoderPromise<I> {
    return this.#call("reverse", { ...baseRequest(options), point }, options);
  }

  /** Suggestions as the user types. Never retried by default, since a retried keystroke is already stale. */
  autocomplete<I extends Include = never>(
    query: string,
    options?: SearchOptions<I>,
  ): GeocoderPromise<I> {
    return this.#call(
      "autocomplete",
      { ...baseRequest(options), query },
      { maxRetries: 0, ...options },
    );
  }

  /** Place search by name. */
  places<I extends Include = never>(query: string, options?: SearchOptions<I>): GeocoderPromise<I> {
    return this.#call("places", { ...baseRequest(options), query }, options);
  }

  /** The records with these IDs, as an earlier call on the same provider returned them. An unknown ID answers nothing. */
  lookup<I extends Include = never>(
    id: string | readonly string[],
    options?: LookupOptions<I>,
  ): GeocoderPromise<I> {
    const ids = typeof id === "string" ? [id] : [...id];
    return this.#call("lookup", { ...baseRequest(options), ids }, options);
  }

  /** Many lookups in one call, through the provider's batch endpoint where it has one. */
  readonly batch: {
    /** Geocodes many addresses. An item that fails does not fail the batch. */
    geocode<I extends Include = never>(
      items: readonly BatchGeocodeInput[],
      options?: BatchOptions<I>,
    ): Promise<BatchResult<I>>;
    /** Reverse geocodes many points. An item that fails does not fail the batch. */
    reverse<I extends Include = never>(
      items: readonly BatchReverseInput[],
      options?: BatchOptions<I>,
    ): Promise<BatchResult<I>>;
  } = {
    geocode: (items, options) =>
      this.#batch(
        "geocode",
        items.map(batchItem),
        options,
        (item, base) =>
          item.query === undefined
            ? { ...base, address: item.address ?? {} }
            : { ...base, query: item.query },
        (list, context) => this.adapter.batch?.geocode?.(list, context),
      ),
    reverse: (items, options) =>
      this.#batch(
        "reverse",
        [...items],
        options,
        (item, base) => ({ ...base, point: { lat: item.lat, lon: item.lon } }),
        (list, context) => this.adapter.batch?.reverse?.(list, context),
      ),
  };

  #options(options: RequestOptions | undefined): RequestOptions | undefined {
    const merged: RequestOptions = { ...this.#defaults };
    if (options?.signal !== undefined) merged.signal = options.signal;
    if (options?.timeout !== undefined) merged.timeout = options.timeout;
    if (options?.maxRetries !== undefined) merged.maxRetries = options.maxRetries;
    if (options?.headers !== undefined) merged.headers = options.headers;
    return Object.keys(merged).length === 0 ? undefined : merged;
  }

  #call<O extends Operation, I extends Include>(
    operation: O,
    request: Requests[O],
    options: RequestOptions | undefined,
  ): GeocoderPromise<I> {
    const outcome = this.#run(operation, request, this.#options(options));
    let requestId: string | undefined;
    return new APIPromise<GeocodeResult<I>, Response | undefined>(
      outcome.then((done) => {
        requestId = done.requestId;
        return done.response;
      }),
      async () => (await outcome).result as unknown as GeocodeResult<I>,
      () => requestId,
    );
  }

  /** Sends one call through the plugins to the adapter. */
  async #run<O extends Operation>(
    operation: O,
    request: Requests[O],
    options: RequestOptions | undefined,
  ): Promise<Outcome> {
    const plugins = this.#plugins;
    const strict = this.#strict;
    const dispatch = (index: number, call: PluginCall): Promise<Outcome> => {
      const plugin = plugins[index];
      if (plugin === undefined) return terminal(call.adapter, call, strict);
      return plugin.handle(call, (next) => dispatch(index + 1, next));
    };
    const call: PluginCall = {
      operation,
      request,
      options,
      adapter: this.adapter,
      run(adapter) {
        return terminal(adapter ?? this.adapter, this, strict);
      },
    };
    try {
      validate(request, this.adapter.id, operation);
      return await dispatch(0, call);
    } catch (error) {
      throw GeocoderError.from(error, { provider: this.adapter.id, operation });
    }
  }

  async #batch<Item extends { id?: string | undefined }, I extends Include>(
    operation: "geocode" | "reverse",
    items: Item[],
    options: BatchOptions<I> | undefined,
    single: (item: Item, base: BaseRequest) => Requests["geocode"] | Requests["reverse"],
    native: (
      items: Item[],
      context: Parameters<NonNullable<NonNullable<Adapter["batch"]>["geocode"]>>[1],
    ) => Promise<AdapterBatchItem[]> | undefined,
  ): Promise<BatchResult<I>> {
    const adapter = this.adapter;
    const name = `batch.${operation}` as const;
    const base = baseRequest(options as SearchOptions<Include> | undefined);
    const requestOptions = this.#options(options);
    validate(base, adapter.id, name);
    const concurrency = options?.concurrency ?? 4;
    const fail = (error: unknown): GeocoderError =>
      GeocoderError.from(error, {
        provider: adapter.id,
        operation: name,
        code: error instanceof OgError ? adapter.errorCode?.(error, "batch") : undefined,
      });
    const progress = (done: number, total: number): void => options?.onProgress?.({ done, total });
    let attribution: Attribution[] = [];
    let unavailable: FieldName[] = [];
    let ignored: OptionName[] = [];
    type Row = Omit<BatchItem, "results"> & { results: PlaceRecord[] };
    let batchItems: Row[];
    let mode: "native" | "emulated" = "emulated";

    const capabilities = adapter.capabilities[operation];
    const answer =
      capabilities === undefined
        ? undefined
        : (() => {
            const plan = prepare(
              adapter,
              operation,
              capabilities,
              base,
              this.#strict,
              // Each reverse item is its own point to measure from.
              operation === "reverse" || base.focus !== undefined,
            );
            const pending = native(items, {
              request: plan.request,
              options: requestOptions,
              concurrency,
              pollInterval: options?.pollInterval ?? 1000,
              onProgress: progress,
            });
            return pending === undefined ? undefined : { plan, pending };
          })();
    if (answer !== undefined) {
      mode = "native";
      let rows: AdapterBatchItem[];
      try {
        rows = await answer.pending;
      } catch (error) {
        throw fail(error);
      }
      unavailable = answer.plan.unavailable;
      ignored = answer.plan.ignored;
      const byIndex = new Map(rows.map((row) => [row.index, row]));
      batchItems = items.map((item, index): Row => {
        const row = byIndex.get(index);
        return {
          index,
          id: item.id ?? null,
          results:
            row === undefined || row.error !== undefined
              ? []
              : shape(
                  row.results,
                  base.include,
                  base.limit,
                  operation === "reverse" ? (item as unknown as LatLon) : base.focus,
                ),
          error: row?.error === undefined ? null : fail(row.error),
        };
      });
    } else {
      batchItems = await pool(
        items,
        concurrency,
        async (item, index): Promise<Row> => {
          const done = await this.#run(operation, single(item, base), requestOptions);
          attribution = done.result.attribution;
          unavailable = done.result.unavailable;
          ignored = done.result.ignored;
          return { index, id: item.id ?? null, results: done.result.results, error: null };
        },
        (error, item, index): Row => ({
          index,
          id: item.id ?? null,
          results: [],
          error: fail(error),
        }),
        progress,
      );
    }
    const failed = batchItems.filter((item) => item.error !== null).length;
    return {
      provider: adapter.id,
      operation: name,
      mode,
      items: batchItems as unknown as BatchItem<I>[],
      summary: { total: batchItems.length, succeeded: batchItems.length - failed, failed },
      attribution,
      unavailable,
      ignored,
    };
  }
}

const mode = (native: boolean | undefined, single: unknown): BatchMode =>
  native ? "native" : single ? "emulated" : false;

/** What the adapter will be sent, and what the caller must be told it cannot do. */
function prepare<R extends BaseRequest>(
  adapter: Adapter,
  operation: Operation,
  capabilities: OperationCapabilities,
  request: R,
  strict: boolean,
  measured: boolean = origin(request) !== undefined,
): { request: R; unavailable: FieldName[]; ignored: OptionName[] } {
  const supported = new Set<OptionName>(capabilities.options);
  const sent: R = { ...request };
  const ignored: OptionName[] = [];
  for (const option of OPTIONS) {
    if (sent[option] === undefined || supported.has(option)) continue;
    ignored.push(option);
    delete sent[option];
  }
  const structured = sent as GeocodeRequest;
  if (operation === "geocode" && structured.address !== undefined && !supported.has("structured")) {
    ignored.push("structured");
    structured.query = oneLine(structured.address);
    delete structured.address;
  }
  if (strict && ignored.length > 0)
    throw new GeocoderError(`${adapter.id} cannot honour ${ignored.join(", ")} on ${operation}.`, {
      code: "unsupported",
      provider: adapter.id,
      operation,
    });
  const fields = new Set<FieldName>(capabilities.fields);
  // A distance can be measured wherever there is a location and a point to measure from.
  if (fields.has("location") && measured) fields.add("distance");
  const unavailable = [...CORE_FIELDS, ...request.include].filter(
    (field) => field !== "raw" && !fields.has(field),
  );
  return { request: sent, unavailable, ignored };
}

/** The point distances are measured from, which is the reverse point, else the caller's `focus`. */
function origin(request: BaseRequest): LatLon | undefined {
  return (request as Partial<Requests["reverse"]>).point ?? request.focus;
}

/**
 * Keeps the default fields and the ones asked for, and fills every gap with `null`.
 * A result with a location but no distance of the provider's own gets the great-circle
 * distance from `from`, which is geometry and not a guess.
 */
function shape(
  results: readonly PlaceRecord[],
  include: readonly Include[],
  limit: number | undefined,
  from?: LatLon,
): PlaceRecord[] {
  const kept = limit === undefined ? results : results.slice(0, Math.max(0, limit));
  return kept.map((place) => {
    const out: Record<string, unknown> = {};
    for (const key of CORE_KEYS) out[key] = place[key] ?? null;
    if (out["distance"] === null && from !== undefined && place.location)
      out["distance"] = Math.round(distance(from, place.location) * 100) / 100;
    for (const key of include) out[key] = place[key] ?? null;
    return out as unknown as PlaceRecord;
  });
}

/** The last step of the pipeline, the adapter itself. */
async function terminal(adapter: Adapter, call: PluginCall, strict: boolean): Promise<Outcome> {
  const { operation } = call;
  const capabilities = adapter.capabilities[operation];
  const method = adapter[operation] as
    | ((
        request: BaseRequest,
        options?: RequestOptions,
      ) => ReturnType<NonNullable<Adapter["geocode"]>>)
    | undefined;
  if (capabilities === undefined || method === undefined)
    throw new GeocoderError(`${adapter.id} has no ${operation}.`, {
      code: "unsupported",
      provider: adapter.id,
      operation,
    });
  const plan = prepare(adapter, operation, capabilities, call.request, strict);
  try {
    const answer = await method.call(adapter, plan.request, call.options);
    const result: ResultEnvelope = {
      provider: adapter.id,
      operation,
      results: shape(
        answer.results,
        call.request.include,
        call.request.limit,
        origin(call.request),
      ),
      attribution: answer.attribution ?? [],
      unavailable: plan.unavailable,
      ignored: plan.ignored,
    };
    if (call.request.include.includes("raw")) result.raw = answer.raw;
    return { result, response: answer.response, requestId: answer.requestId };
  } catch (error) {
    throw GeocoderError.from(error, {
      provider: adapter.id,
      operation,
      code: error instanceof OgError ? adapter.errorCode?.(error, operation) : undefined,
    });
  }
}
