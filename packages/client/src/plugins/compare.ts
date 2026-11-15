import { type Adapter, distance } from "../adapter.ts";
import { GeocoderError } from "../errors.ts";
import type { Outcome, Plugin, PluginCall, ResultEnvelope } from "../geocoder.ts";
import type { Address, Operation, PlaceRecord, ProviderId } from "../types.ts";

/** How the answers of two providers to one query differ. */
export interface Comparison {
  /** Whether both answered and their top results agree within `tolerance`. */
  agree: boolean;
  /** How many results each returned. */
  counts: { primary: number; candidate: number };
  /** Metres between the two top results. `null` when either has no location. */
  topDistance: number | null;
  /** The top result's type on each side, when the two differ. */
  type: { primary: string; candidate: string } | null;
  /** The address parts of the top results that differ, compared without case or accents. */
  address: Partial<Record<keyof Address, { primary: string | null; candidate: string | null }>>;
  /** Top results of the primary that the candidate does not have within `tolerance`, by position. */
  missing: number[];
}

/** What {@link compare} reports for one call. */
export interface CompareReport {
  operation: Operation;
  request: PluginCall["request"];
  primary: CompareSide;
  candidate: CompareSide;
  /** Absent when either side failed. */
  comparison: Comparison | undefined;
}

/** One provider's side of a comparison. */
export interface CompareSide {
  provider: ProviderId;
  /** Milliseconds the call took. */
  ms: number;
  result: ResultEnvelope | undefined;
  error: GeocoderError | undefined;
}

/** Options for {@link compare}. */
export interface CompareOptions {
  /** The adapter to run next to the geocoder's own. */
  with: Adapter;
  /** Receives the report of each compared call. */
  onReport: (report: CompareReport) => void;
  /** Metres within which two results count as the same place. Default 100. */
  tolerance?: number | undefined;
  /** The share of calls to compare, from 0 to 1. Default 1. */
  sample?: number | undefined;
  /** The operations to compare. Default `geocode`, `reverse` and `places`. */
  operations?: readonly Operation[] | undefined;
  /**
   * When `true`, the call waits for the candidate too before it answers.
   * By default the caller gets the primary's answer as soon as it is in, and the report follows.
   */
  wait?: boolean | undefined;
}

const fold = (value: string | null): string | null =>
  value === null
    ? null
    : value
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();

/** Compares two answers to the same query. */
export function compareResults(
  primary: readonly PlaceRecord[],
  candidate: readonly PlaceRecord[],
  tolerance = 100,
): Comparison {
  const a = primary[0];
  const b = candidate[0];
  const topDistance = a?.location && b?.location ? distance(a.location, b.location) : null;
  const address: Comparison["address"] = {};
  if (a && b)
    for (const key of Object.keys(a.address) as (keyof Address)[])
      if (fold(a.address[key]) !== fold(b.address[key]))
        address[key] = { primary: a.address[key], candidate: b.address[key] };
  const missing: number[] = [];
  for (const [index, place] of primary.entries()) {
    const { location } = place;
    const found =
      location !== null &&
      candidate.some((other) => other.location && distance(location, other.location) <= tolerance);
    if (!found) missing.push(index);
  }
  return {
    agree: topDistance !== null && topDistance <= tolerance,
    counts: { primary: primary.length, candidate: candidate.length },
    topDistance,
    type: a && b && a.type !== b.type ? { primary: a.type, candidate: b.type } : null,
    address,
    missing,
  };
}

async function side(
  provider: ProviderId,
  run: () => Promise<Outcome>,
  operation: Operation,
): Promise<CompareSide & { outcome: Outcome | undefined }> {
  const started = performance.now();
  try {
    const outcome = await run();
    return {
      provider,
      ms: performance.now() - started,
      result: outcome.result,
      error: undefined,
      outcome,
    };
  } catch (thrown) {
    return {
      provider,
      ms: performance.now() - started,
      result: undefined,
      error: GeocoderError.from(thrown, { provider, operation }),
      outcome: undefined,
    };
  }
}

/**
 * Runs a second adapter on the same query and reports how the two answers differ.
 * The caller always gets the primary adapter's answer, and a failing candidate never fails the call.
 *
 * ```ts
 * compare({ with: og({ baseUrl }), onReport: (report) => console.log(report.comparison) });
 * ```
 */
export function compare(options: CompareOptions): Plugin {
  const tolerance = options.tolerance ?? 100;
  const sample = options.sample ?? 1;
  const operations = new Set(options.operations ?? ["geocode", "reverse", "places"]);

  return {
    name: "compare",
    async handle(call, next) {
      if (!operations.has(call.operation) || Math.random() >= sample) return next(call);
      const primary = side(call.adapter.id, () => next(call), call.operation);
      const candidate = side(options.with.id, () => call.run(options.with), call.operation);
      const report = Promise.all([primary, candidate]).then(([first, second]) => {
        const { outcome: _a, ...one } = first;
        const { outcome: _b, ...two } = second;
        try {
          options.onReport({
            operation: call.operation,
            request: call.request,
            primary: one,
            candidate: two,
            comparison:
              one.result && two.result
                ? compareResults(one.result.results, two.result.results, tolerance)
                : undefined,
          });
        } catch {
          // A reporter that throws must not fail the caller's own call.
        }
      });
      const first = await primary;
      if (options.wait) await report;
      if (first.outcome === undefined) throw first.error;
      return first.outcome;
    },
  };
}
