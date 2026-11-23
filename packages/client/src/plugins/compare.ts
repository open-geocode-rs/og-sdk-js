import type { ClientInfo, Plugin, Position } from "../base.ts";
import type { Outcome, Shape } from "../core.ts";
import { GeocoderError } from "../errors.ts";
import { sameShape } from "./failover.ts";

/** How the answers of two servers to one call differ, read from the points of their results. */
export interface Comparison {
  /** Whether the two top results lie within `tolerance`. `null` when either answer has no point to compare. */
  agree: boolean | null;
  /** How many results with a point each returned. */
  counts: { primary: number; candidate: number };
  /** Metres between the two top results. `null` when either has no point. */
  topDistance: number | null;
  /** Results of the primary that the candidate does not have within `tolerance`, by position. */
  missing: number[];
}

/** What {@link compare} reports for one call. */
export interface CompareReport {
  method: string;
  args: readonly unknown[];
  primary: CompareSide;
  candidate: CompareSide;
  /** Absent when either side failed. */
  comparison: Comparison | undefined;
}

/** One server's side of a comparison. */
export interface CompareSide {
  server: Shape;
  /** Milliseconds the call took. */
  ms: number;
  /** The answer, in the shape of the API both clients speak. */
  data: unknown;
  error: GeocoderError | undefined;
}

/** Options for {@link compare}. */
export interface CompareOptions {
  /** The client to run next to the one the plugin is on. It must speak the same API. */
  with: ClientInfo;
  /** Receives the report of each compared call. */
  onReport: (report: CompareReport) => void;
  /** Metres within which two results count as the same place. Default 100. */
  tolerance?: number | undefined;
  /** The share of calls to compare, from 0 to 1. Default 1. */
  sample?: number | undefined;
  /** The methods to compare, by name. Default every lookup. */
  methods?: readonly string[] | undefined;
  /**
   * When `true`, the call waits for the candidate too before it answers.
   * By default the caller gets the primary's answer as soon as it is in, and the report follows.
   */
  wait?: boolean | undefined;
}

/** Metres between two points along a great circle. */
export function distance(a: Position, b: Position): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Compares the points of two answers to the same call. */
export function comparePositions(
  primary: readonly Position[],
  candidate: readonly Position[],
  tolerance = 100,
): Comparison {
  const a = primary[0];
  const b = candidate[0];
  const topDistance = a && b ? distance(a, b) : null;
  const missing: number[] = [];
  for (const [index, point] of primary.entries())
    if (!candidate.some((other) => distance(point, other) <= tolerance)) missing.push(index);
  return {
    agree: topDistance === null ? null : topDistance <= tolerance,
    counts: { primary: primary.length, candidate: candidate.length },
    topDistance,
    missing,
  };
}

async function side(
  server: Shape,
  run: () => Promise<Outcome>,
  method: string,
): Promise<CompareSide & { outcome: Outcome | undefined }> {
  const started = performance.now();
  try {
    const outcome = await run();
    return {
      server: outcome.server,
      ms: performance.now() - started,
      data: outcome.data,
      error: undefined,
      outcome,
    };
  } catch (thrown) {
    return {
      server,
      ms: performance.now() - started,
      data: undefined,
      error: GeocoderError.from(thrown, { provider: server, operation: method }),
      outcome: undefined,
    };
  }
}

/**
 * Runs a second client on the same call and reports how the two answers differ.
 * Both clients speak the same API, so the two answers have the same shape.
 * The caller always gets the primary client's answer, and a failing candidate never fails the call.
 *
 * A comparison never involves HERE's own service.
 * A client is refused at once when either side of the comparison is answered by HERE.
 *
 * ```ts
 * const candidate = google({ baseUrl: "http://localhost:8080" });
 * google({ apiKey, plugins: [compare({ with: candidate, onReport: console.log })] });
 * ```
 */
export function compare(options: CompareOptions): Plugin {
  const tolerance = options.tolerance ?? 100;
  const sample = options.sample ?? 1;
  const methods = options.methods ? new Set(options.methods) : undefined;

  return {
    name: "compare",
    setup(client) {
      sameShape("compare", client, options.with);
      if (client.server === "here" || options.with.server === "here")
        throw new GeocoderError("compare never runs against HERE's own service.", {
          code: "unsupported",
          provider: "here",
        });
    },
    async handle(call, next) {
      if ((methods && !methods.has(call.method)) || Math.random() >= sample) return next();
      const primary = side(call.client.server, next, call.method);
      const candidate = side(options.with.server, () => call.run(options.with), call.method);
      const report = Promise.all([primary, candidate]).then(([first, second]) => {
        const { outcome: _a, ...one } = first;
        const { outcome: _b, ...two } = second;
        try {
          options.onReport({
            method: call.method,
            args: call.args,
            primary: one,
            candidate: two,
            comparison:
              first.outcome && second.outcome
                ? comparePositions(call.positions(one.data), call.positions(two.data), tolerance)
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
