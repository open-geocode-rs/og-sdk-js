import { describe, expect, expectTypeOf, it } from "vitest";
import {
  BadRequestError,
  Geocoder,
  GeocoderError,
  MAX_LANGUAGES,
  OgError,
  type Plugin,
  RateLimitError,
  veto,
} from "../src/index.ts";
import { fakeAdapter, place } from "./helpers.ts";

describe("the unified result", () => {
  it("returns the default fields and nothing else", async () => {
    const adapter = fakeAdapter("fake", () => ({
      results: [place({ bbox: [1, 2, 3, 4], raw: { secret: true } })],
    }));
    const result = await new Geocoder({ adapter }).geocode("10 King St W");
    expect(result).toEqual({
      provider: "fake",
      operation: "geocode",
      results: [place()],
      attribution: [],
      unavailable: ["accuracy", "confidence", "distance"],
      ignored: [],
    });
    expect("raw" in result).toBe(false);
  });

  it("adds an opt-in field only when asked, and null when the provider has no value", async () => {
    const adapter = fakeAdapter("fake", () => ({ results: [place({ bbox: [1, 2, 3, 4] })] }), {
      capabilities: {
        geocode: { options: [], fields: ["id", "location", "address", "bbox", "timezone"] },
      },
    });
    const result = await new Geocoder({ adapter }).geocode("x", {
      include: ["bbox", "timezone", "rating"],
    });
    const [first] = result.results;
    expect(first!.bbox).toEqual([1, 2, 3, 4]);
    expect(first!.timezone).toBeNull();
    expect(first!.rating).toBeNull();
    // `timezone` is null because this record has none, `rating` because the provider never has one.
    expect(result.unavailable).toEqual(["accuracy", "confidence", "distance", "rating"]);
    expectTypeOf(first!.bbox).toEqualTypeOf<[number, number, number, number] | null>();
    // @ts-expect-error `contact` was not asked for, so it is not on the type.
    void first!.contact;
  });

  it("returns raw on the result and on each place when asked", async () => {
    const adapter = fakeAdapter("fake", () => ({
      results: [place({ raw: { vendor: 1 } })],
      raw: { body: true },
    }));
    const result = await new Geocoder({ adapter }).geocode("x", { include: ["raw"] });
    expect(result.raw).toEqual({ body: true });
    expect(result.results[0]!.raw).toEqual({ vendor: 1 });
    expect(result.unavailable).not.toContain("raw");
  });

  it("cuts the results to limit", async () => {
    const adapter = fakeAdapter("fake", () => ({ results: [place(), place(), place()] }));
    expect((await new Geocoder({ adapter }).places("x", { limit: 2 })).results).toHaveLength(2);
  });

  it("gives the response and request id through withResponse", async () => {
    const response = new Response("{}");
    const adapter = fakeAdapter("fake", () => ({ response, requestId: "req-7" }));
    const answer = await new Geocoder({ adapter }).reverse({ lat: 1, lon: 2 }).withResponse();
    expect(answer.response).toBe(response);
    expect(answer.requestId).toBe("req-7");
    expect(answer.data.operation).toBe("reverse");
  });
});

describe("requests", () => {
  it("normalises the options an adapter receives", async () => {
    const adapter = fakeAdapter("fake", () => ({}));
    adapter.capabilities.geocode = { options: ["limit", "language", "structured"], fields: [] };
    const geo = new Geocoder({ adapter });
    await geo.geocode("x", { language: "fr", limit: 3, include: ["bbox", "bbox"] });
    await geo.geocode({ address: "10 King St W", locality: "Toronto" });
    await geo.lookup("abc");
    expect(adapter.native.calls.map((call) => call.request)).toEqual([
      { query: "x", language: ["fr"], limit: 3, include: ["bbox"] },
      { address: { address: "10 King St W", locality: "Toronto" }, include: [] },
      { ids: ["abc"], include: [] },
    ]);
  });

  it("leaves out an option the provider cannot honour and reports it", async () => {
    const adapter = fakeAdapter("fake", () => ({}));
    const result = await new Geocoder({ adapter }).geocode(
      { address: "10 King St W", locality: "Toronto" },
      { countries: ["ca"], bounds: [0, 0, 1, 1], limit: 1 },
    );
    expect(result.ignored).toEqual(["countries", "bounds", "structured"]);
    expect(adapter.native.calls[0]!.request).toEqual({
      query: "10 King St W, Toronto",
      limit: 1,
      include: [],
    });
  });

  it("fails instead when strict", async () => {
    const adapter = fakeAdapter("fake", () => ({}));
    const error = await new Geocoder({ adapter, strict: true })
      .geocode("x", { countries: ["CA"] })
      .catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(GeocoderError);
    expect((error as GeocoderError).code).toBe("unsupported");
    expect(adapter.native.calls).toHaveLength(0);
  });

  it("passes timeouts, retries and the signal down, and never retries autocomplete by default", async () => {
    const seen: unknown[] = [];
    const adapter = fakeAdapter("fake", () => ({}));
    const record = async (_request: unknown, options?: unknown) => {
      seen.push(options);
      return { results: [], raw: null, response: undefined };
    };
    adapter.geocode = record;
    adapter.autocomplete = record;
    const geo = new Geocoder({ adapter, timeout: 500, maxRetries: 4 });
    const { signal } = new AbortController();
    await geo.geocode("x", { signal, timeout: 100 });
    await geo.autocomplete("x");
    expect(seen).toEqual([
      { timeout: 100, maxRetries: 4, signal },
      { timeout: 500, maxRetries: 0 },
    ]);
  });
});

const codes = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `x-l${index}`);

describe("the language list", () => {
  it("takes 20 codes and refuses 21 on every operation, before the provider is asked", async () => {
    const adapter = fakeAdapter("fake", () => ({}));
    const geo = new Geocoder({ adapter });
    await geo.geocode("x", { language: codes(MAX_LANGUAGES) });
    expect(MAX_LANGUAGES).toBe(20);
    expect(adapter.native.calls).toHaveLength(1);

    const language = codes(21);
    const point = { lat: 1, lon: 2 };
    const refused = [
      geo.geocode("x", { language }),
      geo.reverse(point, { language }),
      geo.autocomplete("x", { language }),
      geo.places("x", { language }),
      geo.lookup("id", { language }),
      geo.batch.geocode(["x"], { language }),
      geo.batch.reverse([point], { language }),
    ];
    for (const call of refused) {
      const error = (await call.catch((thrown: unknown) => thrown)) as GeocoderError;
      expect(error).toBeInstanceOf(GeocoderError);
      expect(error.code).toBe("invalid_request");
      expect(error.message).toBe("language takes at most 20 codes, and 21 were given.");
      expect(error.provider).toBe("fake");
    }
    expect(adapter.native.calls).toHaveLength(1);
  });
});

describe("capabilities", () => {
  it("lists what the adapter can do, and how each batch would run", () => {
    const adapter = fakeAdapter("fake", () => ({}));
    delete adapter.capabilities.places;
    adapter.capabilities.batch = { geocode: true };
    const geo = new Geocoder({ adapter });
    expect(geo.capabilities.places).toBeUndefined();
    expect(geo.capabilities.autocomplete?.coordinates).toBe(true);
    expect(geo.capabilities.batch).toEqual({ geocode: "native", reverse: "emulated" });
    expect(geo.provider).toBe("fake");
    expect(geo.native).toBe(adapter.native);
  });

  it("fails with unsupported for an operation the adapter lacks", async () => {
    const adapter = fakeAdapter("fake", () => ({}));
    delete adapter.capabilities.places;
    delete adapter.places;
    const error = await new Geocoder({ adapter }).places("x").catch((thrown: unknown) => thrown);
    expect((error as GeocoderError).code).toBe("unsupported");
    expect((error as GeocoderError).operation).toBe("places");
  });
});

describe("errors", () => {
  it("wraps the provider's error in one class with a normalised code", async () => {
    const cause = OgError.fromResponse(429, { error: "slow down" }, new Headers(), {
      provider: "fake",
      message: "slow down",
      requestId: "req-9",
    });
    const adapter = fakeAdapter("fake", () => Promise.reject(cause));
    const error = (await new Geocoder({ adapter })
      .geocode("x")
      .catch((thrown: unknown) => thrown)) as GeocoderError;
    expect(error).toBeInstanceOf(GeocoderError);
    expect(error).toBeInstanceOf(OgError);
    expect(error.code).toBe("rate_limited");
    expect(error.retryable).toBe(true);
    expect(error.status).toBe(429);
    expect(error.provider).toBe("fake");
    expect(error.operation).toBe("geocode");
    expect(error.requestId).toBe("req-9");
    expect(error.message).toBe("slow down");
    expect(error.body).toEqual({ error: "slow down" });
    expect(error.cause).toBe(cause);
    expect(error.cause).toBeInstanceOf(RateLimitError);
  });

  it("lets the adapter read a code the status alone would get wrong", async () => {
    const cause = new BadRequestError("quota", { status: 400, body: { reason: "quota" } });
    const adapter = fakeAdapter("fake", () => Promise.reject(cause), {
      errorCode: (error) =>
        (error.body as { reason: string }).reason === "quota" ? "rate_limited" : undefined,
    });
    const error = await new Geocoder({ adapter }).geocode("x").catch((thrown: unknown) => thrown);
    expect((error as GeocoderError).code).toBe("rate_limited");
  });

  it("labels anything else thrown as unknown and keeps it as the cause", async () => {
    const cause = new TypeError("boom");
    const adapter = fakeAdapter("fake", () => Promise.reject(cause));
    const error = (await new Geocoder({ adapter })
      .geocode("x")
      .catch((thrown: unknown) => thrown)) as GeocoderError;
    expect(error.code).toBe("unknown");
    expect(error.cause).toBe(cause);
  });
});

const trace = (name: string, log: string[]): Plugin => ({
  name,
  async handle(call, next) {
    log.push(`${name} in`);
    const outcome = await next(call);
    log.push(`${name} out`);
    return outcome;
  },
});

describe("plugins", () => {
  it("run in order, each wrapping the next", async () => {
    const log: string[] = [];
    const adapter = fakeAdapter("fake", () => {
      log.push("adapter");
      return {};
    });
    await new Geocoder({ adapter, plugins: [trace("a", log), trace("b", log)] }).geocode("x");
    expect(log).toEqual(["a in", "b in", "adapter", "b out", "a out"]);
  });

  it("can transform the request and the result", async () => {
    const adapter = fakeAdapter("fake", () => ({ results: [place()] }));
    const upper: Plugin = {
      name: "upper",
      async handle(call, next) {
        if (call.operation === "geocode") {
          const request = call.request as { query?: string };
          call = { ...call, request: { ...call.request, query: request.query!.toUpperCase() } };
        }
        const outcome = await next(call);
        for (const result of outcome.result.results) result.label = `[${result.label}]`;
        return outcome;
      },
    };
    const result = await new Geocoder({ adapter, plugins: [upper] }).geocode("king st");
    expect(adapter.native.calls[0]!.request).toMatchObject({ query: "KING ST" });
    expect(result.results[0]!.label).toBe("[10 King St W, Toronto]");
  });

  it("can veto a call before it reaches the provider", async () => {
    const adapter = fakeAdapter("fake", () => ({}));
    const guard: Plugin = {
      name: "guard",
      handle(call, next) {
        if (call.operation === "places") throw veto("places search is switched off");
        return next(call);
      },
    };
    const geo = new Geocoder({ adapter, plugins: [guard] });
    const error = (await geo.places("x").catch((thrown: unknown) => thrown)) as GeocoderError;
    expect(error.code).toBe("vetoed");
    expect(error.message).toBe("places search is switched off");
    expect(adapter.native.calls).toHaveLength(0);
    await geo.geocode("x");
    expect(adapter.native.calls).toHaveLength(1);
  });
});

describe("batch", () => {
  it("emulates a batch with single calls, keeps input order and isolates failures", async () => {
    let inFlight = 0;
    let most = 0;
    const adapter = fakeAdapter("fake", async (_operation, request) => {
      const { query } = request as { query: string };
      most = Math.max(most, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, query === "slow" ? 20 : 1));
      inFlight--;
      if (query === "bad") throw new BadRequestError("no", { status: 400 });
      return { results: [place({ name: query })] } as never;
    });
    const progress: number[] = [];
    const result = await new Geocoder({ adapter }).batch.geocode(
      ["slow", { id: "b", query: "bad" }, "c", "d", "e"],
      { concurrency: 2, onProgress: ({ done }) => progress.push(done) },
    );
    expect(result.mode).toBe("emulated");
    expect(result.operation).toBe("batch.geocode");
    expect(result.items.map((item) => item.results[0]?.name)).toEqual([
      "slow",
      undefined,
      "c",
      "d",
      "e",
    ]);
    expect(result.items[1]).toMatchObject({ index: 1, id: "b", results: [] });
    expect(result.items[1]!.error?.code).toBe("invalid_request");
    expect(result.summary).toEqual({ total: 5, succeeded: 4, failed: 1 });
    expect(most).toBe(2);
    expect(progress).toEqual([1, 2, 3, 4, 5]);
  });

  it("uses the adapter's own batch when it has one", async () => {
    const adapter = fakeAdapter("fake", () => ({}));
    adapter.capabilities.batch = { reverse: true };
    adapter.batch = {
      async reverse(items, context) {
        context.onProgress(items.length, items.length);
        return [
          { index: 1, results: [place({ name: "second", bbox: [0, 0, 1, 1] })] },
          { index: 0, results: [], error: new BadRequestError("bad point", { status: 400 }) },
        ];
      },
    };
    const result = await new Geocoder({ adapter }).batch.reverse([
      { lat: 99, lon: 0, id: "a" },
      { lat: 1, lon: 2 },
    ]);
    expect(result.mode).toBe("native");
    expect(result.items[0]).toMatchObject({ index: 0, id: "a", results: [] });
    expect(result.items[0]!.error?.code).toBe("invalid_request");
    // The adapter sent no distance, so it is measured from the item's own point.
    expect(result.items[1]!.results).toEqual([place({ name: "second", distance: 9238015.92 })]);
    expect(result.summary).toEqual({ total: 2, succeeded: 1, failed: 1 });
    expect(adapter.native.calls).toHaveLength(0);
  });
});
