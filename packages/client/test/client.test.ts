/// <reference types="node" />
import { describe, expect, it, vi } from "vitest";
import {
  ALL_EXTRAS,
  APIConnectionTimeoutError,
  APIUserAbortError,
  BadRequestError,
  createClient,
  GeocoderError,
  InternalServerError,
  NotFoundError,
} from "../src/index.ts";
import { retryDelay } from "../src/core.ts";
import { bodyOf, fakeFetch as plainFetch, type Reply } from "./helpers.ts";

/** A fake fetch whose every answer carries a request ID. */
const fakeFetch = (...replies: Reply[]) =>
  plainFetch(
    ...replies.map((reply, index) => ({
      ...reply,
      headers: { "x-request-id": `req-${index + 1}`, ...reply.headers },
    })),
  );

const caught = async (promise: PromiseLike<unknown>): Promise<GeocoderError> =>
  (await Promise.resolve(promise).then(
    () => {
      throw new Error("the call did not fail");
    },
    (error: unknown) => error,
  )) as GeocoderError;

const empty = { type: "FeatureCollection", features: [], geocoding: {} };
const problem = (status: number, code: string) => ({
  type: "about:blank",
  title: "Error",
  status,
  detail: `failed ${code}`,
  error_code: code,
});
const fast = { "retry-after-ms": "1" };

describe("requests", () => {
  it("builds the query string and drops undefined parameters", async () => {
    const fetch = fakeFetch({ body: empty });
    const og = createClient({ baseUrl: "http://og.test/", fetch });
    await og.autocomplete({ q: "10 King St", limit: 5, country: "CA,US", focus: undefined });
    expect(fetch.mock.calls[0]![0]).toBe(
      "http://og.test/autocomplete?q=10+King+St&limit=5&country=CA%2CUS",
    );
  });

  it("sends client headers and per-call headers", async () => {
    const fetch = fakeFetch({ body: empty });
    const og = createClient({
      baseUrl: "http://og.test",
      fetch,
      headers: { authorization: "Bearer gateway" },
    });
    await og.geocode({ q: "24 Sussex Drive" }, { headers: { "x-trace": "abc" } });
    expect(fetch.mock.calls[0]![1]!.headers).toMatchObject({
      authorization: "Bearer gateway",
      "x-trace": "abc",
    });
  });
});

const feature = (properties: Record<string, unknown>) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [7.42, 43.73] },
  properties: {
    id: "osm:node:1",
    layer: "address",
    accuracy: "rooftop",
    name: "2 Avenue de Monte-Carlo",
    label: "2 Avenue de Monte-Carlo, Monaco",
    source: { dataset: "osm" },
    ...properties,
  },
});
const rich = {
  ...empty,
  features: [
    feature({
      timezone: "Europe/Monaco",
      bbox: [7.4, 43.7, 7.5, 43.8],
      contact: { phone: "+377 1" },
      match: { street: "matched" },
      context: { country: { id: "osm:relation:1", name: "Monaco", code: "MC" } },
    }),
  ],
};

describe("responses", () => {
  it("returns og's own shape", async () => {
    const og = createClient({ baseUrl: "http://og.test", fetch: fakeFetch({ body: rich }) });
    expect(og).toMatchObject({ shape: "og", server: "og" });
    const result = await og.geocode({ q: "x" });
    expect(result.type).toBe("FeatureCollection");
    expect(result.features[0]!.geometry.coordinates).toEqual([7.42, 43.73]);
    expect(result.features[0]!.properties.context?.country?.code).toBe("MC");
  });

  it("gives the response, the request id, the server and the cache rule with withResponse()", async () => {
    const og = createClient({
      baseUrl: "http://og.test",
      fetch: fakeFetch({ body: empty, headers: { "x-og-pack": "p1" } }),
    });
    const { data, response, requestId, server, cache } = await og
      .geocode({ q: "x" })
      .withResponse();
    expect(data.features).toEqual([]);
    expect(response?.headers.get("x-og-pack")).toBe("p1");
    expect(requestId).toBe("req-1");
    expect(server).toBe("og");
    expect(cache).toEqual({ maxTtl: Infinity });
  });
});

describe("include", () => {
  it("leaves the extras out unless they are asked for, and never sends include to og", async () => {
    const fetch = fakeFetch({ body: rich });
    const og = createClient({ baseUrl: "http://og.test", fetch });
    const lean = await og.geocode({ q: "x" });
    const properties = lean.features[0]!.properties as Record<string, unknown>;
    for (const extra of ALL_EXTRAS) expect(properties).not.toHaveProperty(extra);
    expect(properties["context"]).toBeDefined();
    expect(String(fetch.mock.calls[0]![0])).toBe("http://og.test/geocode?q=x");

    const some = await og.geocode({ q: "x", include: ["timezone", "match"] });
    expect(some.features[0]!.properties.timezone).toBe("Europe/Monaco");
    expect(some.features[0]!.properties.match).toEqual({ street: "matched" });
    expect(some.features[0]!.properties).not.toHaveProperty("bbox");
    // @ts-expect-error an extra that was not asked for is not on the type either
    void some.features[0]!.properties.bbox;

    const all = await og.places({ q: "x", include: ALL_EXTRAS });
    expect(all.features[0]!.properties.contact).toEqual({ phone: "+377 1" });
  });
});

describe("batch", () => {
  it("posts the items as JSON, with the shared parameters in the query", async () => {
    const fetch = fakeFetch({
      body: {
        results: [
          { id: "a", status: 200, response: rich },
          { id: "b", status: 400 },
        ],
        summary: { total: 2, succeeded: 1, failed: 1 },
      },
    });
    const og = createClient({ baseUrl: "http://og.test", fetch });
    const items = [
      { id: "a", q: "2 Avenue de Monte-Carlo" },
      { id: "b", q: "" },
    ];
    const batch = await og.batch.geocode(items, { country: "MC", include: ["bbox"] });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("http://og.test/geocode?country=MC");
    expect(init!.method).toBe("POST");
    expect(init!.headers).toMatchObject({ "content-type": "application/json" });
    expect(bodyOf(fetch)).toEqual(items);
    expect(batch.summary.failed).toBe(1);
    const properties = batch.results[0]!.response!.features[0]!.properties;
    expect(properties.bbox).toEqual([7.4, 43.7, 7.5, 43.8]);
    expect(properties).not.toHaveProperty("timezone");
  });

  it("has a reverse and a places batch", async () => {
    const fetch = fakeFetch({
      body: { results: [], summary: { total: 0, succeeded: 0, failed: 0 } },
    });
    const og = createClient({ baseUrl: "http://og.test", fetch });
    await og.batch.reverse([{ lon: 7.42, lat: 43.73 }]);
    await og.batch.places([{ ids: "osm:node:1" }]);
    expect(fetch.mock.calls.map(([url, init]) => `${init!.method} ${String(url)}`)).toEqual([
      "POST http://og.test/reverse",
      "POST http://og.test/places",
    ]);
  });
});

describe("errors", () => {
  it("throws one error class, with a normalised code and the transport error as the cause", async () => {
    const og = createClient({
      baseUrl: "http://og.test",
      fetch: fakeFetch({ status: 400, body: problem(400, "invalid_parameter") }),
    });
    const error = await caught(og.geocode({ q: "" }));
    expect(error).toBeInstanceOf(GeocoderError);
    expect(error).toMatchObject({
      code: "invalid_request",
      status: 400,
      provider: "og",
      operation: "geocode",
      requestId: "req-1",
      message: "failed invalid_parameter",
    });
    // og's own error code stays readable on the problem document and on the cause.
    expect(error.problem?.error_code).toBe("invalid_parameter");
    expect(error.cause).toBeInstanceOf(BadRequestError);
    expect((error.cause as BadRequestError).code).toBe("invalid_parameter");
  });

  it("maps 404 and 5xx", async () => {
    const og404 = createClient({
      baseUrl: "http://og.test",
      fetch: fakeFetch({ status: 404, body: problem(404, "not_found") }),
    });
    const missing = await caught(og404.jobs.status("nope"));
    expect(missing.code).toBe("not_found");
    expect(missing.cause).toBeInstanceOf(NotFoundError);
    const og503 = createClient({
      baseUrl: "http://og.test",
      maxRetries: 0,
      fetch: fakeFetch({ status: 503, body: problem(503, "not_ready") }),
    });
    const down = await caught(og503.geocode({ q: "x" }));
    expect(down.code).toBe("unavailable");
    expect(down.retryable).toBe(true);
    expect(down.cause).toBeInstanceOf(InternalServerError);
  });

  it("reads an answer that is not JSON as a provider error", async () => {
    const og = createClient({ baseUrl: "http://og.test", fetch: fakeFetch({ body: "<html>" }) });
    const error = await caught(og.geocode({ q: "x" }));
    expect(error.code).toBe("provider_error");
    expect(error.requestId).toBe("req-1");
  });

  it("needs a baseUrl", () => {
    expect(() => createClient({} as { baseUrl: string })).toThrowError(
      expect.objectContaining({ code: "invalid_request" }),
    );
  });
});

describe("retries", () => {
  it("retries 5xx and 429, honouring retry-after-ms", async () => {
    const fetch = fakeFetch(
      { status: 503, headers: fast },
      { status: 429, headers: fast },
      { body: empty },
    );
    const og = createClient({ baseUrl: "http://og.test", fetch });
    await og.geocode({ q: "x" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("stops after maxRetries", async () => {
    const fetch = fakeFetch({ status: 500, headers: fast, body: problem(500, "internal") });
    const og = createClient({ baseUrl: "http://og.test", fetch, maxRetries: 1 });
    expect((await caught(og.geocode({ q: "x" }))).code).toBe("provider_error");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("never retries a 501, since the endpoint will not appear", async () => {
    const fetch = fakeFetch({ status: 501, headers: fast });
    const error = await caught(
      createClient({ baseUrl: "http://og.test", fetch }).geocode({ q: "x" }),
    );
    expect(error.code).toBe("unsupported");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("never retries 4xx other than 408 and 429", async () => {
    const fetch = fakeFetch({ status: 400, body: problem(400, "invalid_parameter") });
    await createClient({ baseUrl: "http://og.test", fetch })
      .geocode({ q: "" })
      .catch(() => {});
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry autocomplete unless asked", async () => {
    const fetch = fakeFetch(
      { status: 503, headers: fast },
      { status: 503, headers: fast },
      { body: empty },
    );
    const og = createClient({ baseUrl: "http://og.test", fetch });
    await og.autocomplete({ q: "x" }).catch(() => {});
    expect(fetch).toHaveBeenCalledTimes(1);
    await og.autocomplete({ q: "x" }, { maxRetries: 1 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("never retries job creation", async () => {
    const fetch = fakeFetch(
      { status: 503, headers: fast },
      { status: 202, body: { id: "j", status: "running" } },
    );
    await createClient({ baseUrl: "http://og.test", fetch })
      .jobs.create({ csv: "address\nx" })
      .catch(() => {});
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("backs off exponentially, capped, with jitter", () => {
    expect(retryDelay(0, undefined)).toBeGreaterThan(374);
    expect(retryDelay(0, undefined)).toBeLessThanOrEqual(500);
    expect(retryDelay(10, undefined)).toBeLessThanOrEqual(8000);
    expect(retryDelay(0, new Headers({ "retry-after": "2" }))).toBe(2000);
  });
});

describe("timeouts and aborts", () => {
  const hang = vi.fn(
    (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
      ),
  );

  it("fails with code timeout after the timeout", async () => {
    const og = createClient({ baseUrl: "http://og.test", fetch: hang, timeout: 20, maxRetries: 0 });
    const error = await caught(og.geocode({ q: "x" }));
    expect(error.code).toBe("timeout");
    expect(error.cause).toBeInstanceOf(APIConnectionTimeoutError);
  });

  it("fails with code aborted when the caller aborts, without retrying", async () => {
    hang.mockClear();
    const og = createClient({ baseUrl: "http://og.test", fetch: hang });
    const controller = new AbortController();
    const pending = og.geocode({ q: "x" }, { signal: controller.signal });
    controller.abort();
    const error = await caught(pending);
    expect(error.code).toBe("aborted");
    expect(error.cause).toBeInstanceOf(APIUserAbortError);
    expect(hang).toHaveBeenCalledTimes(1);
  });
});

describe("jobs", () => {
  it("uploads a CSV job asynchronously, asking for JSONL results", async () => {
    const fetch = fakeFetch({ status: 202, body: { id: "job-1", status: "running" } });
    const og = createClient({ baseUrl: "http://og.test", fetch });
    await og.jobs.create(
      { csv: "address\n10 King St W, Toronto" },
      { address: "address" },
      { output: "jsonl" },
    );
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("http://og.test/jobs?address=address");
    expect(init!.headers).toMatchObject({
      "content-type": "text/csv",
      prefer: "respond-async",
      accept: "application/jsonl",
    });
  });

  it("waits until the job stops", async () => {
    const fetch = fakeFetch(
      { body: { id: "j", status: "running" } },
      { body: { id: "j", status: "completed" } },
    );
    const final = await createClient({ baseUrl: "http://og.test", fetch }).jobs.wait("j", {
      interval: 1,
    });
    expect(final.status).toBe("completed");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("streams result lines as they arrive", async () => {
    const chunks = ['{"a":1}\n{"b"', ":2}\r\n", '{"c":3}'];
    const fetch = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk));
              c.close();
            },
          }),
        ),
    );
    const lines: string[] = [];
    for await (const line of createClient({ baseUrl: "http://og.test", fetch }).jobs.lines("j"))
      lines.push(line);
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });
});

describe("logging", () => {
  it("logs retries at info and stays quiet at the default level", async () => {
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    const fetch = fakeFetch({ status: 503, headers: fast }, { body: empty });
    await createClient({ baseUrl: "http://og.test", fetch, logger, logLevel: "info" }).geocode({
      q: "x",
    });
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("og answered 503"));
    const quiet = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    await createClient({
      baseUrl: "http://og.test",
      fetch: fakeFetch({ status: 503, headers: fast }, { body: empty }),
      logger: quiet,
    }).geocode({ q: "x" });
    expect(quiet.info).not.toHaveBeenCalled();
  });
});

// Runs against a real og server when OG_URL is set, for example OG_URL=http://127.0.0.1:8081.
// OG_TEST_ADDRESS names an address the server's Pack holds.
const liveQuery = process.env["OG_TEST_ADDRESS"] ?? "24 Sussex Drive Ottawa";
const liveClient = () => createClient({ baseUrl: process.env["OG_URL"]! });

describe.runIf(process.env["OG_URL"])("against a live og", () => {
  it("geocodes an address and returns the request id", async () => {
    const { data, requestId, server } = await liveClient()
      .geocode({ q: liveQuery, limit: 1 })
      .withResponse();
    expect(data.features[0]!.properties.label).toBeTruthy();
    expect(requestId).toBeTruthy();
    expect(server).toBe("og");
  });

  it("returns an extra only when it is included", async () => {
    const client = liveClient();
    const lean = await client.geocode({ q: liveQuery, limit: 1 });
    expect(lean.features[0]!.properties).not.toHaveProperty("address_lines");
    const full = await client.geocode({ q: liveQuery, limit: 1, include: ["address_lines"] });
    expect(full.features[0]!.properties.address_lines?.length).toBeGreaterThan(0);
  });

  it("reverses, suggests and looks a place up by id", async () => {
    const client = liveClient();
    const found = await client.geocode({ q: liveQuery, limit: 1 });
    const [lon, lat] = found.features[0]!.geometry.coordinates as [number, number];
    const near = await client.reverse({ lon, lat });
    expect(near.features.length).toBeGreaterThan(0);
    const typed = await client.autocomplete({ q: liveQuery.slice(0, 8), include: ["highlights"] });
    expect(typed.features.length).toBeGreaterThan(0);
    const place = await client.places({ q: "casino", limit: 1 });
    const same = await client.places({ ids: place.features[0]!.properties.id });
    expect(same.features[0]!.properties.id).toBe(place.features[0]!.properties.id);
  });

  it("answers a batch in one request, and fails only the bad item", async () => {
    const batch = await liveClient().batch.geocode([{ id: "good", q: liveQuery }, { id: "bad" }]);
    expect(batch.summary).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
    expect(batch.results[0]!.response!.features.length).toBeGreaterThan(0);
    expect(batch.results[1]!.error?.status).toBe(400);
  });

  it("runs a batch job end to end", async () => {
    const client = liveClient();
    const created = await client.jobs.create(
      { jsonl: `${JSON.stringify({ q: liveQuery })}\n` },
      { endpoint: "geocode" },
    );
    const final = await client.jobs.wait(created.id, { interval: 200 });
    expect(final.status).toBe("completed");
    const lines: string[] = [];
    for await (const line of client.jobs.lines(created.id)) lines.push(line);
    expect(lines.length).toBe(1);
    await client.jobs.delete(created.id);
  });

  it("fails with og's problem on a bad request", async () => {
    const error = await caught(liveClient().reverse({ lon: 999, lat: 0 }));
    expect(error.code).toBe("invalid_request");
    expect(error.problem?.error_code).toBeTruthy();
  });
});
