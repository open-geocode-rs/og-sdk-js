/// <reference types="node" />
import { describe, expect, it, vi } from "vitest";
import {
  APIConnectionTimeoutError,
  APIUserAbortError,
  BadRequestError,
  createClient,
  InternalServerError,
  NotFoundError,
  OgError,
  retryDelay,
} from "../src/index.ts";

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };

/** A fake fetch that answers with each reply in turn. */
function fakeFetch(...replies: Reply[]) {
  let call = 0;
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const reply = replies[Math.min(call++, replies.length - 1)]!;
    const body = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? {});
    return new Response(body, {
      status: reply.status ?? 200,
      headers: {
        "content-type": "application/json",
        "x-request-id": `req-${call}`,
        ...reply.headers,
      },
    });
  });
}

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

describe("responses", () => {
  it("adds og's request id to parsed objects, not enumerable", async () => {
    const og = createClient({ baseUrl: "http://og.test", fetch: fakeFetch({ body: empty }) });
    const result = await og.geocode({ q: "x" });
    expect(result._request_id).toBe("req-1");
    expect(Object.keys(result)).not.toContain("_request_id");
  });

  it("returns the raw response with withResponse() and asResponse()", async () => {
    const og = createClient({
      baseUrl: "http://og.test",
      fetch: fakeFetch({ body: empty, headers: { "x-og-pack": "p1" } }),
    });
    const { data, response, requestId } = await og.geocode({ q: "x" }).withResponse();
    expect(data.features).toEqual([]);
    expect(response.headers.get("x-og-pack")).toBe("p1");
    expect(requestId).toBe("req-1");
    const raw = await createClient({ baseUrl: "http://og.test", fetch: fakeFetch({ body: empty }) })
      .geocode({ q: "x" })
      .asResponse();
    expect(raw.bodyUsed).toBe(false);
  });
});

describe("errors", () => {
  it("throws the subclass for the status, with og's code and request id", async () => {
    const og = createClient({
      baseUrl: "http://og.test",
      fetch: fakeFetch({ status: 400, body: problem(400, "invalid_parameter") }),
    });
    const error = await og.geocode({ q: "" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestError);
    expect(error).toBeInstanceOf(OgError);
    expect(error).toMatchObject({
      status: 400,
      code: "invalid_parameter",
      requestId: "req-1",
      message: "failed invalid_parameter",
    });
  });

  it("maps 404 and 5xx", async () => {
    const og404 = createClient({
      baseUrl: "http://og.test",
      fetch: fakeFetch({ status: 404, body: problem(404, "not_found") }),
    });
    await expect(og404.jobs.status("nope")).rejects.toBeInstanceOf(NotFoundError);
    const og503 = createClient({
      baseUrl: "http://og.test",
      maxRetries: 0,
      fetch: fakeFetch({ status: 503, body: problem(503, "not_ready") }),
    });
    await expect(og503.geocode({ q: "x" })).rejects.toBeInstanceOf(InternalServerError);
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
    await expect(og.geocode({ q: "x" })).rejects.toBeInstanceOf(InternalServerError);
    expect(fetch).toHaveBeenCalledTimes(2);
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

  it("throws APIConnectionTimeoutError after timeout", async () => {
    const og = createClient({ baseUrl: "http://og.test", fetch: hang, timeout: 20, maxRetries: 0 });
    await expect(og.geocode({ q: "x" })).rejects.toBeInstanceOf(APIConnectionTimeoutError);
  });

  it("throws APIUserAbortError when the caller aborts, without retrying", async () => {
    hang.mockClear();
    const og = createClient({ baseUrl: "http://og.test", fetch: hang });
    const controller = new AbortController();
    const pending = og.geocode({ q: "x" }, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(APIUserAbortError);
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
    const result = await liveClient().geocode({ q: liveQuery, limit: 1 });
    expect(result.features[0]!.properties.label).toBeTruthy();
    expect(result._request_id).toBeTruthy();
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
});
