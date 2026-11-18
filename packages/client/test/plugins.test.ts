import { describe, expect, it, vi } from "vitest";
import { type ClientInfo, createBase, type Plugin, type Position } from "../src/base.ts";
import type { APIPromise, CacheRule, RequestOptions, Shape } from "../src/core.ts";
import { createClient, GeocoderError, veto } from "../src/index.ts";
import {
  cache,
  type CacheLimitEvent,
  compare,
  type CompareReport,
  comparePositions,
  failover,
  memoryStore,
} from "../src/plugins/index.ts";
import { fakeFetch, type Fetch, type Reply, urlOf } from "./helpers.ts";

interface Found {
  from: string;
  points?: Position[];
}
interface Mini extends ClientInfo {
  find(params: { q: string }, options?: RequestOptions): APIPromise<Found>;
  fetch: Fetch;
}

/** A client of any shape with one lookup method, enough to drive a plugin. */
function mini(
  shape: Shape,
  setup: {
    baseUrl?: string;
    cache?: CacheRule;
    plugins?: Plugin[];
    replies?: Reply[];
  } = {},
): Mini {
  const fetch = fakeFetch(...(setup.replies ?? [{ body: { from: setup.baseUrl ?? shape } }]));
  const base = createBase({
    shape,
    options: { fetch, plugins: setup.plugins, maxRetries: 0, logLevel: "off" },
    baseUrl: setup.baseUrl,
    credentials: true,
    vendorUrl: `http://${shape}.test`,
    cache: setup.cache,
    positions: (_method, data) => (data as Found).points ?? [],
  });
  return {
    shape: base.shape,
    server: base.server,
    fetch,
    find: (params, options) =>
      base.call({
        method: "find",
        args: [params],
        options,
        send: (sent) =>
          base.http({
            method: "GET",
            path: "/find",
            query: params,
            idempotent: true,
            options: sent,
          }),
      }),
  };
}

const THIRTY_DAYS = 30 * 86_400_000;
const caught = async (promise: PromiseLike<unknown>): Promise<GeocoderError> =>
  (await Promise.resolve(promise).then(
    () => {
      throw new Error("the call did not fail");
    },
    (error: unknown) => error,
  )) as GeocoderError;

describe("the pipeline", () => {
  it("runs plugins outermost first, and gives each the call as it was made", async () => {
    const order: string[] = [];
    const tag = (name: string): Plugin => ({
      name,
      async handle(call, next) {
        order.push(`${name} ${call.client.shape}/${call.client.server} ${call.method}`);
        expect(call.args).toEqual([{ q: "x" }]);
        const outcome = await next();
        order.push(`${name} done`);
        return outcome;
      },
    });
    const client = mini("mapbox", { plugins: [tag("a"), tag("b")] });
    await client.find({ q: "x" });
    expect(order).toEqual(["a mapbox/mapbox find", "b mapbox/mapbox find", "b done", "a done"]);
  });

  it("lets a plugin answer without the server, or refuse the call", async () => {
    const canned = mini("og", {
      baseUrl: "http://og.test",
      plugins: [
        {
          name: "canned",
          handle: async () => ({
            data: { from: "plugin" },
            response: undefined,
            requestId: undefined,
            server: "og",
            cache: { maxTtl: 0 },
          }),
        },
      ],
    });
    const outcome = await canned.find({ q: "x" }).withResponse();
    expect(outcome.data).toEqual({ from: "plugin" });
    expect(outcome.response).toBeUndefined();
    expect(canned.fetch).not.toHaveBeenCalled();

    const refused = mini("og", {
      baseUrl: "http://og.test",
      plugins: [
        {
          name: "guard",
          handle(call) {
            throw veto("not today", call.method);
          },
        },
      ],
    });
    const error = await caught(refused.find({ q: "x" }));
    expect(error).toMatchObject({ code: "vetoed", operation: "find", message: "not today" });
    expect(refused.fetch).not.toHaveBeenCalled();
  });

  it("works on the og client", async () => {
    const seen: string[] = [];
    const fetch = fakeFetch({ body: { type: "FeatureCollection", features: [] } });
    const og = createClient({
      baseUrl: "http://og.test",
      fetch,
      plugins: [
        {
          name: "log",
          handle(call, next) {
            seen.push(call.method);
            return next();
          },
        },
      ],
    });
    await og.geocode({ q: "x" });
    await og.batch.reverse([{ lon: 1, lat: 2 }]);
    await og.jobs.status("j1");
    // A job's own calls never pass through the plugins.
    expect(seen).toEqual(["geocode", "batch.reverse"]);
  });
});

describe("which server answers", () => {
  it("is og under /compat/<shape> with a baseUrl, and the vendor without", async () => {
    const viaOg = mini("here", { baseUrl: "http://og.test/" });
    await viaOg.find({ q: "x" });
    expect(viaOg.server).toBe("og");
    expect(urlOf(viaOg.fetch).href).toBe("http://og.test/compat/here/find?q=x");

    const direct = mini("here");
    await direct.find({ q: "x" });
    expect(direct.server).toBe("here");
    expect(urlOf(direct.fetch).href).toBe("http://here.test/find?q=x");
  });

  it("names og as the provider of an error from /compat", async () => {
    const client = mini("google", {
      baseUrl: "http://og.test",
      replies: [{ status: 501, body: { error: { message: "no" } } }],
    });
    const error = await caught(client.find({ q: "x" }));
    expect(error).toMatchObject({ code: "unsupported", provider: "og", status: 501 });
  });
});

describe("cache", () => {
  it("answers a repeated call from memory, with a copy for each caller", async () => {
    const lookups: boolean[] = [];
    const client = mini("og", {
      baseUrl: "http://og.test",
      plugins: [cache({ onLookup: (event) => lookups.push(event.hit) })],
    });
    const first = await client.find({ q: "x" }).withResponse();
    first.data.from = "changed";
    const second = await client.find({ q: "x" }).withResponse();
    await client.find({ q: "y" });
    expect(client.fetch).toHaveBeenCalledTimes(2);
    expect(lookups).toEqual([false, true, false]);
    expect(second.data).toEqual({ from: "http://og.test" });
    expect(second.response).toBeUndefined();
    expect(second.server).toBe("og");
  });

  it("keeps nothing where the vendor's rule is never, and says so", async () => {
    const events: CacheLimitEvent[] = [];
    const client = mini("mapbox", {
      cache: { maxTtl: 0 },
      plugins: [cache({ onLimit: (event) => events.push(event) })],
    });
    await client.find({ q: "x" });
    await client.find({ q: "x" });
    expect(client.fetch).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      { server: "mapbox", method: "find", action: "skipped", asked: 300_000, allowed: 0 },
      { server: "mapbox", method: "find", action: "skipped", asked: 300_000, allowed: 0 },
    ]);
  });

  it("keeps an answer no longer than the vendor allows", async () => {
    const events: CacheLimitEvent[] = [];
    const store = memoryStore();
    const set = vi.spyOn(store, "set");
    const client = mini("google", {
      cache: { maxTtl: THIRTY_DAYS },
      plugins: [cache({ ttl: 90 * 86_400_000, store, onLimit: (event) => events.push(event) })],
    });
    await client.find({ q: "x" });
    expect(set.mock.calls[0]![2]).toBe(THIRTY_DAYS);
    expect(events).toEqual([
      {
        server: "google",
        method: "find",
        action: "shortened",
        asked: 90 * 86_400_000,
        allowed: THIRTY_DAYS,
      },
    ]);
    await client.find({ q: "x" });
    expect(client.fetch).toHaveBeenCalledTimes(1);
  });

  it("sets no limit on an answer from og, whichever API it was asked through", async () => {
    const store = memoryStore();
    const set = vi.spyOn(store, "set");
    const onLimit = vi.fn();
    const client = mini("mapbox", {
      baseUrl: "http://og.test",
      cache: { maxTtl: 0 },
      plugins: [cache({ ttl: Infinity, store, onLimit })],
    });
    const outcome = await client.find({ q: "x" }).withResponse();
    expect(outcome.cache).toEqual({ maxTtl: Infinity });
    expect(set.mock.calls[0]![2]).toBe(Infinity);
    expect(onLimit).not.toHaveBeenCalled();
  });

  it("follows the rule of the server that answered after a failover", async () => {
    const events: CacheLimitEvent[] = [];
    const og = mini("mapbox", { baseUrl: "http://og.test" });
    const client = mini("mapbox", {
      cache: { maxTtl: 0 },
      replies: [{ status: 503 }],
      plugins: [cache({ onLimit: (event) => events.push(event) }), failover({ to: og })],
    });
    const first = await client.find({ q: "x" }).withResponse();
    const second = await client.find({ q: "x" }).withResponse();
    expect(first.server).toBe("og");
    expect(second.server).toBe("og");
    expect(second.response).toBeUndefined();
    expect(events).toEqual([]);
    expect(client.fetch).toHaveBeenCalledTimes(1);
  });

  it("warns once on the console when nobody listens", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const client = mini("here", { cache: { maxTtl: 0 }, plugins: [cache()] });
      await client.find({ q: "x" });
      await client.find({ q: "y" });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toBe(
        "[cache] here does not allow a find answer to be kept, so it is not cached.",
      );
      const short = mini("google", {
        cache: { maxTtl: THIRTY_DAYS },
        plugins: [cache({ ttl: Infinity })],
      });
      await short.find({ q: "x" });
      expect(warn.mock.calls[1]![0]).toBe(
        "[cache] google allows a find answer to be kept for 30 days, so it is not kept for the ever asked for.",
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("caches only the methods named, and only the calls with a key", async () => {
    const named = mini("og", {
      baseUrl: "http://og.test",
      plugins: [cache({ methods: ["other"] })],
    });
    await named.find({ q: "x" });
    await named.find({ q: "x" });
    expect(named.fetch).toHaveBeenCalledTimes(2);
    const keyed = mini("og", {
      baseUrl: "http://og.test",
      plugins: [cache({ key: () => undefined })],
    });
    await keyed.find({ q: "x" });
    await keyed.find({ q: "x" });
    expect(keyed.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("failover", () => {
  it("moves to the next client of the same API when the first fails", async () => {
    const moves: string[] = [];
    const og = mini("google", { baseUrl: "http://og.test" });
    const client = mini("google", {
      replies: [{ status: 503 }],
      plugins: [
        failover({
          to: og,
          onFailover: (event) =>
            moves.push(`${event.from.server} to ${event.to.server} ${event.error?.code}`),
        }),
      ],
    });
    const outcome = await client.find({ q: "x" }).withResponse();
    expect(outcome.data).toEqual({ from: "http://og.test" });
    expect(outcome.server).toBe("og");
    expect(urlOf(og.fetch).href).toBe("http://og.test/compat/google/find?q=x");
    expect(moves).toEqual(["google to og unavailable"]);
  });

  it("stays put on a bad request and on an abort", async () => {
    const og = mini("google", { baseUrl: "http://og.test" });
    const client = mini("google", {
      replies: [{ status: 400 }],
      plugins: [failover({ to: og })],
    });
    expect((await caught(client.find({ q: "" }))).code).toBe("invalid_request");
    const error = await caught(client.find({ q: "x" }, { signal: AbortSignal.abort() }));
    expect(error.code).toBe("aborted");
    expect(og.fetch).not.toHaveBeenCalled();
  });

  it("moves on for an answer the caller calls empty, and throws the last error", async () => {
    const second = mini("og", { baseUrl: "http://two.test", replies: [{ status: 500 }] });
    const client = mini("og", {
      baseUrl: "http://one.test",
      plugins: [failover({ to: [second], empty: (data) => (data as Found).from !== "never" })],
    });
    const error = await caught(client.find({ q: "x" }));
    expect(error.code).toBe("provider_error");
    expect(second.fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses a fallback that speaks another API", () => {
    const og = createClient({ baseUrl: "http://og.test" });
    expect(() => mini("mapbox", { plugins: [failover({ to: og })] })).toThrowError(
      expect.objectContaining({
        code: "invalid_request",
        message: "failover needs two clients that speak the same API, and was given mapbox and og.",
      }),
    );
  });
});

const at = (lat: number, lon: number): Reply => ({
  body: { from: "x", points: [{ lat, lon }] },
});
const onReport = (): void => {};

describe("compare", () => {
  it("reports how the two answers differ, and answers with the primary's", async () => {
    const reports: CompareReport[] = [];
    const candidate = mini("mapbox", { baseUrl: "http://og.test", replies: [at(43.7396, 7.4276)] });
    const client = mini("mapbox", {
      replies: [at(43.7377, 7.4271)],
      plugins: [
        compare({ with: candidate, onReport: (report) => reports.push(report), wait: true }),
      ],
    });
    const outcome = await client.find({ q: "casino" }).withResponse();
    expect(outcome.server).toBe("mapbox");
    expect(reports).toHaveLength(1);
    const report = reports[0]!;
    expect(report).toMatchObject({ method: "find", args: [{ q: "casino" }] });
    expect(report.primary).toMatchObject({ server: "mapbox", error: undefined });
    expect(report.candidate).toMatchObject({ server: "og", error: undefined });
    expect(report.candidate.data).toEqual({ from: "x", points: [{ lat: 43.7396, lon: 7.4276 }] });
    expect(report.comparison).toMatchObject({
      agree: false,
      counts: { primary: 1, candidate: 1 },
      missing: [0],
    });
    expect(report.comparison!.topDistance).toBeGreaterThan(200);
    expect(report.comparison!.topDistance).toBeLessThan(230);
  });

  it("never fails the call when the candidate fails", async () => {
    const reports: CompareReport[] = [];
    const candidate = mini("og", { baseUrl: "http://two.test", replies: [{ status: 500 }] });
    const client = mini("og", {
      baseUrl: "http://one.test",
      plugins: [
        compare({ with: candidate, onReport: (report) => reports.push(report), wait: true }),
      ],
    });
    await expect(client.find({ q: "x" })).resolves.toEqual({ from: "http://one.test" });
    expect(reports[0]!.candidate.error?.code).toBe("provider_error");
    expect(reports[0]!.comparison).toBeUndefined();
  });

  it("has nothing to agree on when an answer has no point", () => {
    expect(comparePositions([], [{ lat: 1, lon: 1 }])).toEqual({
      agree: null,
      counts: { primary: 0, candidate: 1 },
      topDistance: null,
      missing: [],
    });
    expect(comparePositions([{ lat: 1, lon: 1 }], [{ lat: 1, lon: 1.0001 }]).agree).toBe(true);
  });

  it("is refused when either side is answered by HERE", () => {
    const refusal = expect.objectContaining({
      code: "unsupported",
      message: "compare never runs against HERE's own service.",
    });
    const viaOg = mini("here", { baseUrl: "http://og.test" });
    const direct = mini("here");
    expect(() => mini("here", { plugins: [compare({ with: viaOg, onReport })] })).toThrowError(
      refusal,
    );
    expect(() =>
      mini("here", { baseUrl: "http://og.test", plugins: [compare({ with: direct, onReport })] }),
    ).toThrowError(refusal);
    // Two og servers may be compared through HERE's API, since HERE answers neither.
    expect(() =>
      mini("here", { baseUrl: "http://two.test", plugins: [compare({ with: viaOg, onReport })] }),
    ).not.toThrow();
  });

  it("refuses a candidate that speaks another API", () => {
    const og = createClient({ baseUrl: "http://og.test" });
    expect(() =>
      mini("google", { plugins: [compare({ with: og, onReport: () => {} })] }),
    ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
  });
});
