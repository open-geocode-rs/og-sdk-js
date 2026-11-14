/// <reference types="node" />
import { describe, expect, it, vi } from "vitest";
import { createClient, OgError } from "../src/index.ts";

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
      }),
  );
}

const empty = { type: "FeatureCollection", features: [], geocoding: {} };

describe("createClient", () => {
  it("builds the query string and drops undefined parameters", async () => {
    const fetch = fakeFetch(200, empty);
    const og = createClient({ baseUrl: "http://og.test/", fetch });
    await og.autocomplete({ q: "10 King St", limit: 5, country: "CA,US", focus: undefined });
    expect(fetch.mock.calls[0]![0]).toBe(
      "http://og.test/autocomplete?q=10+King+St&limit=5&country=CA%2CUS",
    );
  });

  it("sends the configured headers on every call", async () => {
    const fetch = fakeFetch(200, empty);
    const og = createClient({
      baseUrl: "http://og.test",
      fetch,
      headers: { authorization: "Bearer gateway" },
    });
    await og.geocode({ q: "24 Sussex Drive" });
    const headers = fetch.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer gateway");
  });

  it("throws OgError with og's error code and request id", async () => {
    const problem = {
      type: "about:blank",
      title: "Bad Request",
      status: 400,
      detail: "q must not be empty",
      error_code: "invalid_parameter",
    };
    const fetch = fakeFetch(400, problem, { "x-request-id": "req-1" });
    const og = createClient({ baseUrl: "http://og.test", fetch });
    const error = await og.geocode({ q: "" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OgError);
    expect(error).toMatchObject({
      status: 400,
      code: "invalid_parameter",
      requestId: "req-1",
      message: "q must not be empty",
    });
  });

  it("uploads a CSV job asynchronously", async () => {
    const fetch = fakeFetch(202, { id: "job-1", status: "queued" });
    const og = createClient({ baseUrl: "http://og.test", fetch });
    await og.jobs.create({ csv: "address\n10 King St W, Toronto" }, { address: "address" });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("http://og.test/jobs?address=address");
    expect(init!.method).toBe("POST");
    expect(init!.headers).toMatchObject({ "content-type": "text/csv", prefer: "respond-async" });
  });
});

// Runs against a real og server when OG_URL is set, for example OG_URL=http://127.0.0.1:8080.
describe.runIf(process.env["OG_URL"])("against a live og", () => {
  it("geocodes an address", async () => {
    const og = createClient({ baseUrl: process.env["OG_URL"]! });
    const result = await og.geocode({ q: "24 Sussex Drive Ottawa", limit: 1 });
    expect(result.features.length).toBe(1);
    expect(result.features[0]!.properties.label).toMatch(/Sussex/);
  });
});
