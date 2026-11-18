/**
 * The client for og's own API.
 *
 * Request and response types come from og's OpenAPI contract
 * (`contract/openapi.json`), generated into `schema.gen.ts` by `bun run gen`.
 */
import { type ClientInfo, type CommonOptions, createBase, type Position } from "./base.ts";
import { type APIPromise, readBody, type RequestOptions, sleep } from "./core.ts";
import { GeocoderError } from "./errors.ts";
import type { components, operations } from "./schema.gen.ts";

/** Every parameter optional and allowed to be `undefined`, which is then left out of the request. */
type Loose<T> = { [K in keyof T]?: T[K] | undefined };

type Query<Op extends keyof operations> = operations[Op] extends { parameters: { query?: infer Q } }
  ? Loose<NonNullable<Q>>
  : never;

/**
 * The extras of a result. A response carries the ones named in `include` and no other,
 * so a call that names none gets the lean result every screen needs.
 */
export type Include =
  | "access"
  | "address_lines"
  | "bbox"
  | "brand"
  | "contact"
  | "opening_hours"
  | "timezone"
  | "match"
  | "highlights";

/** Every extra, for `include: ALL_EXTRAS`. */
export const ALL_EXTRAS: readonly Include[] = [
  "access",
  "address_lines",
  "bbox",
  "brand",
  "contact",
  "opening_hours",
  "timezone",
  "match",
  "highlights",
];

/** The `include` every lookup accepts. */
export interface Included<I extends Include> {
  /** The extras to keep on each result. Default none. */
  include?: readonly I[] | undefined;
}

/** Query parameters of `GET /geocode`. */
export type GeocodeParams = Query<"geocode">;
/** Query parameters of `GET /reverse`. */
export type ReverseParams = Query<"reverse">;
/** Query parameters of `GET /autocomplete`. */
export type AutocompleteParams = Query<"autocomplete">;
/** Query parameters of `GET /places`. */
export type PlacesParams = Query<"places">;
/** Query parameters of `POST /geocode`, which apply to every item of the batch. */
export type GeocodeBatchParams = Query<"geocode_batch">;
/** Query parameters of `POST /reverse`, which apply to every item of the batch. */
export type ReverseBatchParams = Query<"reverse_batch">;
/** Query parameters of `POST /places`, which apply to every item of the batch. */
export type PlacesBatchParams = Query<"places_batch">;
/** Query parameters of `POST /jobs`. */
export type CreateJobParams = Query<"create">;

/** One item of a `/geocode` batch. */
export type GeocodeItem = components["schemas"]["GeocodeItem"];
/** One item of a `/reverse` batch. */
export type ReverseItem = components["schemas"]["ReverseItem"];
/** One item of a `/places` batch. */
export type PlacesItem = components["schemas"]["PlacesItem"];

/** The properties `P` without the extras that `I` does not name. */
export type Trim<P, I extends Include> = Omit<P, Exclude<Include, I>>;
/** A collection whose features carry the extras `I` and no other. */
export type WithExtras<C extends { features: { properties: unknown }[] }, I extends Include> = Omit<
  C,
  "features"
> & {
  features: (Omit<C["features"][number], "properties"> & {
    properties: Trim<C["features"][number]["properties"], I>;
  })[];
};
/** A batch answer whose results hold the collection `R`. */
export type BatchOf<B extends { results: { response?: unknown }[] }, R> = Omit<B, "results"> & {
  results: (Omit<B["results"][number], "response"> & { response?: R })[];
};

/** Forward results, from `/geocode`, `/autocomplete` and `/places`, with the extras `I`. */
export type ForwardCollection<I extends Include = never> = WithExtras<
  components["schemas"]["ForwardCollection"],
  I
>;
/** Reverse results, from `/reverse`, with the extras `I`. */
export type ReverseCollection<I extends Include = never> = WithExtras<
  components["schemas"]["ReverseCollection"],
  I
>;
/** The answer to a forward batch, one result per item in input order. */
export type ForwardBatch<I extends Include = never> = BatchOf<
  components["schemas"]["ForwardBatch"],
  ForwardCollection<I>
>;
/** The answer to a reverse batch, one result per item in input order. */
export type ReverseBatch<I extends Include = never> = BatchOf<
  components["schemas"]["ReverseBatch"],
  ReverseCollection<I>
>;
/** A batch job's status. */
export type JobStatus = components["schemas"]["JobStatus"];
/** Where a job is, one of `running`, `completed`, `cancelled` and `failed`. */
export type JobState = components["schemas"]["JobState"];

/** Job upload, either CSV with a header row or one JSON object per line. */
export type JobBody = { csv: string } | { jsonl: string };

/** Options for `jobs.create`. */
export interface CreateJobOptions extends RequestOptions {
  /** Format of the results. Defaults to the upload's own format. */
  output?: "csv" | "jsonl" | undefined;
}

/** Options for `jobs.wait`. */
export interface WaitOptions extends RequestOptions {
  /** Milliseconds between status checks. Default 1000. */
  interval?: number | undefined;
}

/** Options for {@link createClient}. */
export interface ClientOptions extends CommonOptions {
  /** Where og runs, for example `http://localhost:8080`. */
  baseUrl: string;
}

/** The og client. */
export interface Client extends ClientInfo {
  /** Forward geocoding, from text or a structured address to places. */
  geocode<const I extends Include = never>(
    params: GeocodeParams & Included<I>,
    options?: RequestOptions,
  ): APIPromise<ForwardCollection<I>>;
  /** Reverse geocoding, from a point to the nearest places. */
  reverse<const I extends Include = never>(
    params: ReverseParams & Included<I>,
    options?: RequestOptions,
  ): APIPromise<ReverseCollection<I>>;
  /** Suggestions as the user types. Never retried by default, since a retried keystroke is already stale. */
  autocomplete<const I extends Include = never>(
    params: AutocompleteParams & Included<I>,
    options?: RequestOptions,
  ): APIPromise<ForwardCollection<I>>;
  /** Place search by name, or lookup by `ids`. */
  places<const I extends Include = never>(
    params: PlacesParams & Included<I>,
    options?: RequestOptions,
  ): APIPromise<ForwardCollection<I>>;
  /** Many lookups in one request, answered in one response. A bad item never fails the batch. */
  batch: {
    geocode<const I extends Include = never>(
      items: readonly GeocodeItem[],
      params?: GeocodeBatchParams & Included<I>,
      options?: RequestOptions,
    ): APIPromise<ForwardBatch<I>>;
    reverse<const I extends Include = never>(
      items: readonly ReverseItem[],
      params?: ReverseBatchParams & Included<I>,
      options?: RequestOptions,
    ): APIPromise<ReverseBatch<I>>;
    places<const I extends Include = never>(
      items: readonly PlacesItem[],
      params?: PlacesBatchParams & Included<I>,
      options?: RequestOptions,
    ): APIPromise<ForwardBatch<I>>;
  };
  /** Batches too large for one request, run by the server as a job. */
  jobs: {
    /** Uploads a batch job. Never retried, since a retry could start the job twice. */
    create(
      body: JobBody,
      params?: CreateJobParams,
      options?: CreateJobOptions,
    ): APIPromise<JobStatus>;
    /** The job's current status. */
    status(id: string, options?: RequestOptions): APIPromise<JobStatus>;
    /** Polls until the job stops, then returns its final status. */
    wait(id: string, options?: WaitOptions): Promise<JobStatus>;
    /** The job's results as one string, once the job has stopped. */
    results(id: string, options?: RequestOptions): APIPromise<string>;
    /** The job's results line by line as og writes them, including while it runs. */
    lines(id: string, options?: RequestOptions): AsyncIterable<string>;
    /** Stops a running job. */
    cancel(id: string, options?: RequestOptions): APIPromise<JobStatus>;
    /** Deletes a job and its results. */
    delete(id: string, options?: RequestOptions): APIPromise<void>;
  };
}

function job(id: string): string {
  return `/jobs/${encodeURIComponent(id)}`;
}

interface Collection {
  features?: { geometry?: { coordinates?: number[] }; properties?: Record<string, unknown> }[];
}
interface BatchAnswer {
  results?: { response?: Collection }[];
}

/** Drops the extras the call did not ask for. */
function trim(collection: Collection | undefined, include: readonly Include[] | undefined): void {
  const dropped = ALL_EXTRAS.filter((extra) => !include?.includes(extra));
  for (const feature of collection?.features ?? [])
    for (const extra of dropped) delete feature.properties?.[extra];
}

function point(collection: Collection | undefined, index: number): Position[] {
  const at = collection?.features?.[index]?.geometry?.coordinates;
  return at?.[0] === undefined || at[1] === undefined ? [] : [{ lon: at[0], lat: at[1] }];
}

function positions(method: string, data: unknown): Position[] {
  if (method.startsWith("batch."))
    return ((data as BatchAnswer).results ?? []).flatMap((result) => point(result.response, 0));
  const collection = data as Collection;
  return (collection.features ?? []).flatMap((_, index) => point(collection, index));
}

const failed = (thrown: unknown, operation: string): GeocoderError =>
  GeocoderError.from(thrown, { provider: "og", operation });

/** Creates a client for one og server. */
export function createClient(options: ClientOptions): Client {
  const base = createBase({ shape: "og", options, baseUrl: options.baseUrl, positions });
  const { transport } = base;

  const lookup = <T>(
    method: string,
    params: object | undefined,
    call: RequestOptions | undefined,
    items?: readonly unknown[],
  ): APIPromise<T> => {
    const { include, ...query } = (params ?? {}) as Record<string, unknown> & Included<Include>;
    const batch = items !== undefined;
    return base.call<T>({
      method,
      args: batch ? [items, params] : [params],
      options: call,
      send: (sent) =>
        base.http({
          method: batch ? "POST" : "GET",
          path: `/${method.replace("batch.", "")}`,
          query,
          ...(batch
            ? { body: JSON.stringify(items), headers: { "content-type": "application/json" } }
            : {}),
          // A batch only reads, so a retry is as safe as for a single lookup.
          idempotent: true,
          options: sent,
        }),
      async parse(response) {
        const data = (await response.json()) as T;
        if (batch)
          for (const result of (data as BatchAnswer).results ?? []) trim(result.response, include);
        else trim(data as Collection, include);
        return data;
      },
    });
  };

  const jobCall = <T>(
    method: string,
    http: "GET" | "POST" | "DELETE",
    path: string,
    args: readonly unknown[],
    call: RequestOptions | undefined,
    parse?: (response: Response) => Promise<T>,
  ): APIPromise<T> =>
    base.call<T>({
      method,
      args,
      options: call,
      plugins: false,
      send: (sent) =>
        base.http({
          method: http,
          path,
          ...(parse ? { headers: { accept: "*/*" } } : {}),
          idempotent: true,
          options: sent,
        }),
      parse,
    });

  const status = (id: string, call?: RequestOptions): APIPromise<JobStatus> =>
    jobCall("jobs.status", "GET", job(id), [id], call);

  return {
    shape: base.shape,
    server: base.server,
    geocode: (params, call) => lookup("geocode", params, call),
    reverse: (params, call) => lookup("reverse", params, call),
    autocomplete: (params, call) => lookup("autocomplete", params, { maxRetries: 0, ...call }),
    places: (params, call) => lookup("places", params, call),
    batch: {
      geocode: (items, params, call) => lookup("batch.geocode", params, call, items),
      reverse: (items, params, call) => lookup("batch.reverse", params, call, items),
      places: (items, params, call) => lookup("batch.places", params, call, items),
    },
    jobs: {
      create(body, params, call) {
        const [contentType, text] =
          "csv" in body ? ["text/csv", body.csv] : ["application/jsonl", body.jsonl];
        const output =
          call?.output === undefined
            ? {}
            : { accept: call.output === "csv" ? "text/csv" : "application/jsonl" };
        return base.call<JobStatus>({
          method: "jobs.create",
          args: [body, params],
          options: call,
          plugins: false,
          send: (sent) =>
            base.http({
              method: "POST",
              path: "/jobs",
              ...(params ? { query: params } : {}),
              body: text,
              headers: { "content-type": contentType, prefer: "respond-async", ...output },
              idempotent: false,
              options: sent,
            }),
        });
      },
      status,
      async wait(id, call) {
        const interval = call?.interval ?? 1000;
        for (;;) {
          const current = await status(id, call);
          if (current.status !== "running") return current;
          try {
            await sleep(interval, call?.signal);
          } catch (thrown) {
            throw failed(thrown, "jobs.wait");
          }
        }
      },
      results: (id, call) =>
        jobCall("jobs.results", "GET", `${job(id)}/results`, [id], call, (response) =>
          response.text(),
        ),
      async *lines(id, call) {
        let response: Response;
        try {
          // No timeout by default, since og keeps the stream open until the job stops.
          response = await transport.send({
            method: "GET",
            path: `${job(id)}/results`,
            headers: { accept: "*/*" },
            idempotent: true,
            options: { timeout: Infinity, ...call },
          });
        } catch (thrown) {
          throw failed(thrown, "jobs.lines");
        }
        if (!response.body) return;
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffered = "";
        try {
          for (;;) {
            const { value, done } = await readBody(response, () => reader.read()).catch(
              (thrown: unknown) => {
                throw failed(thrown, "jobs.lines");
              },
            );
            if (done) break;
            buffered += value;
            let newline: number;
            while ((newline = buffered.indexOf("\n")) >= 0) {
              const line = buffered.slice(0, newline).replace(/\r$/, "");
              buffered = buffered.slice(newline + 1);
              if (line !== "") yield line;
            }
          }
          if (buffered !== "") yield buffered;
        } finally {
          reader.releaseLock();
        }
      },
      cancel: (id, call) => jobCall("jobs.cancel", "POST", `${job(id)}/cancel`, [id], call),
      delete: (id, call) =>
        jobCall("jobs.delete", "DELETE", job(id), [id], call, async () => undefined),
    },
  };
}
