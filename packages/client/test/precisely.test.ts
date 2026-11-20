import { afterEach, describe, expect, it, vi } from "vitest";
import type { Plugin, Position } from "../src/base.ts";
import type { APIPromise } from "../src/core.ts";
import {
  AuthenticationError,
  BadRequestError,
  GeocoderError,
  type GeocoderErrorCode,
  OgError,
} from "../src/errors.ts";
import {
  jobIdOf,
  precisely,
  type PreciselyClient,
  type PreciselyOgOptions,
  type PreciselyVendorClient,
  type PreciselyVendorOptions,
} from "../src/precisely.ts";
import autocompleteFixture from "./fixtures/precisely/autocomplete-200.json" with { type: "json" };
import submitFixture from "./fixtures/precisely/bulk-submit-202.json" with { type: "json" };
import cancelFixture from "./fixtures/precisely/cancel-200.json" with { type: "json" };
import cancelErrorFixture from "./fixtures/precisely/cancel-400.json" with { type: "json" };
import deleteFileFixture from "./fixtures/precisely/delete-file-200.json" with { type: "json" };
import explainFixture from "./fixtures/precisely/explain-200.json" with { type: "json" };
import badRequestFixture from "./fixtures/precisely/error-400.json" with { type: "json" };
import unauthorizedFixture from "./fixtures/precisely/error-401.json" with { type: "json" };
import forbiddenFixture from "./fixtures/precisely/error-403.json" with { type: "json" };
import tooLargeFixture from "./fixtures/precisely/error-413.json" with { type: "json" };
import rateLimitFixture from "./fixtures/precisely/error-429.json" with { type: "json" };
import internalFixture from "./fixtures/precisely/error-500.json" with { type: "json" };
import unavailableFixture from "./fixtures/precisely/error-503.json" with { type: "json" };
import filesFixture from "./fixtures/precisely/files-200.json" with { type: "json" };
import geocodeFixture from "./fixtures/precisely/geocode-200.json" with { type: "json" };
import partialFixture from "./fixtures/precisely/geocode-206.json" with { type: "json" };
import jobStatusFixture from "./fixtures/precisely/job-status-200.json" with { type: "json" };
import jobsFixture from "./fixtures/precisely/jobs-200.json" with { type: "json" };
import lookupFixture from "./fixtures/precisely/lookup-200.json" with { type: "json" };
import postalCityFixture from "./fixtures/precisely/postal-city-200.json" with { type: "json" };
import proximityFixture from "./fixtures/precisely/proximity-200.json" with { type: "json" };
import reverseFixture from "./fixtures/precisely/reverse-200.json" with { type: "json" };
import tokenFixture from "./fixtures/precisely/token-200.json" with { type: "json" };
import tokenErrorFixture from "./fixtures/precisely/token-400.json" with { type: "json" };
import uploadUrlFixture from "./fixtures/precisely/upload-url-200.json" with { type: "json" };
import verifyFixture from "./fixtures/precisely/verify-200.json" with { type: "json" };
import { bodyOf, type Fetch, fakeFetch, headersOf, type Reply } from "./helpers.ts";

const HOST = "https://api.cloud.precisely.com";
const OG = "https://og.example.com";
const OG_ROOT = `${OG}/compat/precisely`;
const KEY = "ak-live-0001";
const SECRET = "shh-0002";
/** `Basic` and the base64 of the key, a colon and the secret. */
const BASIC = `Basic ${btoa(`${KEY}:${SECRET}`)}`;
const BEARER = `Bearer ${tokenFixture.access_token}`;
const TOKEN: Reply = { body: tokenFixture };
const DAY = 86_400_000;

/** A client that asks Precisely itself. Its first request is the token call. */
const onVendor = (
  fetch: Fetch,
  options: Partial<PreciselyVendorOptions> = {},
): PreciselyVendorClient =>
  precisely({ apiKey: KEY, apiSecret: SECRET, fetch, logLevel: "off", ...options });

/**
 * A client that asks og, which takes no key, secret or token. It keeps the key, secret and region a
 * caller already passes for Precisely, as a one-line switch does, and none of them may be sent.
 */
const onOg = (fetch: Fetch, options: Partial<PreciselyOgOptions> = {}): PreciselyClient =>
  precisely({
    baseUrl: `${OG}/`,
    apiKey: KEY,
    apiSecret: SECRET,
    region: "eu1",
    fetch,
    logLevel: "off",
    ...options,
  });

const methodOf = (fetch: Fetch, call = 0): string | undefined => fetch.mock.calls[call]![1]?.method;
const rawBodyOf = (fetch: Fetch, call = 0): unknown => fetch.mock.calls[call]![1]?.body;
const urlsOf = (fetch: Fetch): string[] => fetch.mock.calls.map((call) => String(call[0]));

const caught = (promise: PromiseLike<unknown>): Promise<GeocoderError> =>
  Promise.resolve(promise).then(
    () => {
      throw new Error("The call did not fail.");
    },
    (error: GeocoderError) => error,
  );

const address = { addressLines: ["4820 Kestrel Blvd Ste 210, Harrowmere OH"], country: "USA" };
const FILE_ID = "3c6e1a47-9d52-4b08-a7f3-61e0c5d2b894";
const JOB_ID = "7e2b94c1-05da-4f36-8a17-c3d6f0b952e8";

interface Case {
  /** The method's dotted name on the client. */
  name: string;
  call(client: PreciselyClient): APIPromise<unknown>;
  method: "GET" | "POST" | "DELETE";
  /** The path with its query, the same under Precisely's host and under og's root. */
  path: string;
  /** The JSON body, or `undefined` for a request without one. */
  body?: unknown;
  /** Headers the params turn into, with lower-case names. */
  headers?: Record<string, string>;
  reply: Reply;
}

const CASES: Case[] = [
  {
    name: "geocode",
    call: (client) =>
      client.geocode({
        "X-Request-Id": "trace-1",
        preferences: { maxResults: 1, clientLocale: "en_US", matchMode: "RELAXED" },
        addresses: [{ addressId: "1", ...address }],
      }),
    method: "POST",
    path: "/v1/geocode",
    body: {
      preferences: { maxResults: 1, clientLocale: "en_US", matchMode: "RELAXED" },
      addresses: [{ addressId: "1", ...address }],
    },
    headers: { "x-request-id": "trace-1" },
    reply: { body: geocodeFixture },
  },
  {
    name: "reverseGeocode",
    call: (client) =>
      client.reverseGeocode({
        preferences: { distance: { value: 150, distanceUnit: "METER" } },
        locations: [
          { addressId: "1", longitude: -105.318274, latitude: 39.526618, country: "USA" },
        ],
      }),
    method: "POST",
    path: "/v1/reverse-geocode",
    body: {
      preferences: { distance: { value: 150, distanceUnit: "METER" } },
      locations: [{ addressId: "1", longitude: -105.318274, latitude: 39.526618, country: "USA" }],
    },
    reply: { body: reverseFixture },
  },
  {
    name: "lookup",
    call: (client) =>
      client.lookup({ keys: [{ key: "P0000ZZ9K3QX", type: "PB_KEY", country: "USA" }] }),
    method: "POST",
    path: "/v1/lookup",
    body: { keys: [{ key: "P0000ZZ9K3QX", type: "PB_KEY", country: "USA" }] },
    reply: { body: lookupFixture },
  },
  {
    name: "verify",
    call: (client) => client.verify({ addresses: [{ addressId: "1", ...address }] }),
    method: "POST",
    path: "/v1/verify",
    body: { addresses: [{ addressId: "1", ...address }] },
    reply: { body: verifyFixture },
  },
  {
    name: "autocomplete",
    call: (client) =>
      client.autocomplete({
        "X-Transaction-Id": "0b9f6f3e-52c1-4d0a-9a57-3f2f3c1d8e44",
        "X-Request-Id": "trace-2",
        preferences: { maxResults: 2 },
        address: { addressLines: ["612 Lark"], country: "USA" },
      }),
    method: "POST",
    path: "/v1/autocomplete",
    body: {
      preferences: { maxResults: 2 },
      address: { addressLines: ["612 Lark"], country: "USA" },
    },
    headers: {
      "x-transaction-id": "0b9f6f3e-52c1-4d0a-9a57-3f2f3c1d8e44",
      "x-request-id": "trace-2",
    },
    reply: { body: autocompleteFixture },
  },
  {
    name: "expressAutocomplete",
    call: (client) =>
      client.expressAutocomplete({ address: { addressLines: ["612 Lark"], country: "USA" } }),
    method: "POST",
    path: "/v1/express-autocomplete",
    body: { address: { addressLines: ["612 Lark"], country: "USA" } },
    reply: { body: autocompleteFixture },
  },
  {
    name: "expressAutocompleteV2",
    call: (client) =>
      client.expressAutocompleteV2({
        preferences: {
          filterBias: { type: "filter", fields: { include: { city: { value: "Harrowmere" } } } },
        },
        address: { addressLines: ["612 Lark"], country: "USA" },
      }),
    method: "POST",
    path: "/v2/express-autocomplete",
    body: {
      preferences: {
        filterBias: { type: "filter", fields: { include: { city: { value: "Harrowmere" } } } },
      },
      address: { addressLines: ["612 Lark"], country: "USA" },
    },
    reply: { body: autocompleteFixture },
  },
  {
    name: "autocompletePostalCity",
    call: (client) =>
      client.autocompletePostalCity({
        "X-Request-Id": "trace-4",
        preferences: { maxResults: 5 },
        address: { type: "POSTAL", postAddress: "5448", country: "USA" },
      }),
    method: "POST",
    path: "/v1/autocomplete/postal-city",
    body: {
      preferences: { maxResults: 5 },
      address: { type: "POSTAL", postAddress: "5448", country: "USA" },
    },
    headers: { "x-request-id": "trace-4" },
    reply: { body: postalCityFixture },
  },
  {
    name: "proximitySearch",
    call: (client) =>
      client.proximitySearch({
        preferences: {
          dataset: "premium-address-points",
          distance: { value: 1, distanceUnit: "KILOMETER" },
        },
        location: { addressId: "1", latitude: 44.5231, longitude: -89.5741, country: "USA" },
      }),
    method: "POST",
    path: "/v1/proximity-search",
    body: {
      preferences: {
        dataset: "premium-address-points",
        distance: { value: 1, distanceUnit: "KILOMETER" },
      },
      location: { addressId: "1", latitude: 44.5231, longitude: -89.5741, country: "USA" },
    },
    reply: { body: proximityFixture },
  },
  {
    name: "explainAddressCode",
    call: (client) =>
      client.explainAddressCode({
        codeType: "GlobalMatchCode",
        codes: [{ id: "1", code: "V3-P1S4T3C4-3" }],
        responseOptions: { includeOfficialDescription: true },
      }),
    method: "POST",
    path: "/v1/explain-addresscode",
    body: {
      codeType: "GlobalMatchCode",
      codes: [{ id: "1", code: "V3-P1S4T3C4-3" }],
      responseOptions: { includeOfficialDescription: true },
    },
    reply: { body: explainFixture },
  },
  {
    name: "bulk.uploadUrl",
    call: (client) => client.bulk.uploadUrl({ fileName: "harbour_batch" }),
    method: "POST",
    path: "/v2/files/upload-url",
    body: { fileName: "harbour_batch" },
    reply: { body: uploadUrlFixture },
  },
  {
    name: "bulk.files",
    call: (client) => client.bulk.files(),
    method: "GET",
    path: "/v2/files",
    reply: { body: filesFixture },
  },
  {
    name: "bulk.deleteFile",
    call: (client) => client.bulk.deleteFile({ fileId: "a b/c", "X-Request-Id": "trace-3" }),
    method: "DELETE",
    path: "/v2/files/a%20b%2Fc",
    headers: { "x-request-id": "trace-3" },
    reply: { body: deleteFileFixture },
  },
  {
    name: "bulk.geocode",
    call: (client) =>
      client.bulk.geocode({
        "X-CASS-FLOW": "no_report",
        fileId: FILE_ID,
        delimiter: ",",
        preferences: { maxResults: 1, customPreferences: { DATA_OPTION: "premium" } },
        notifyEmails: ["ops@example.com"],
      }),
    method: "POST",
    path: "/v2/bulk-geocode",
    body: {
      fileId: FILE_ID,
      delimiter: ",",
      preferences: { maxResults: 1, customPreferences: { DATA_OPTION: "premium" } },
      notifyEmails: ["ops@example.com"],
    },
    headers: { "x-cass-flow": "no_report" },
    reply: { status: 202, body: submitFixture },
  },
  {
    name: "bulk.verify",
    call: (client) =>
      client.bulk.verify({
        fileId: FILE_ID,
        reportDetails: { listProcessorName: "Harbour Mailing", listNameId: "file_1" },
      }),
    method: "POST",
    path: "/v2/bulk-verify",
    body: {
      fileId: FILE_ID,
      reportDetails: { listProcessorName: "Harbour Mailing", listNameId: "file_1" },
    },
    reply: { status: 202, body: submitFixture },
  },
  {
    name: "bulk.jobs",
    call: (client) => client.bulk.jobs({ status: "running" }),
    method: "GET",
    path: "/v2/bulk/jobs?status=running",
    reply: { body: jobsFixture },
  },
  {
    name: "bulk.jobs without a status",
    call: (client) => client.bulk.jobs(),
    method: "GET",
    path: "/v2/bulk/jobs",
    reply: { body: jobsFixture },
  },
  {
    name: "bulk.status",
    call: (client) => client.bulk.status({ jobId: JOB_ID }),
    method: "GET",
    path: `/v2/bulk/jobs/${JOB_ID}`,
    reply: { body: jobStatusFixture },
  },
  {
    name: "bulk.cancel",
    call: (client) => client.bulk.cancel({ jobId: JOB_ID }),
    method: "DELETE",
    path: `/v2/bulk/jobs/${JOB_ID}`,
    reply: { body: cancelFixture },
  },
];

/** What every request of a case must look like, whichever server it went to. */
function expectRequest(fetch: Fetch, call: number, root: string, expected: Case): void {
  expect(String(fetch.mock.calls[call]![0])).toBe(`${root}${expected.path}`);
  expect(methodOf(fetch, call)).toBe(expected.method);
  const headers = headersOf(fetch, call);
  expect(headers).toMatchObject({ accept: "application/json", ...expected.headers });
  if (expected.body === undefined) expect(rawBodyOf(fetch, call)).toBeUndefined();
  else {
    expect(bodyOf(fetch, call)).toEqual(expected.body);
    expect(headers["content-type"]).toBe("application/json");
  }
}

/** A plugin that records the points of every answer that passes it. */
const recorder = (): { plugin: Plugin; seen: Record<string, Position[]> } => {
  const seen: Record<string, Position[]> = {};
  return {
    seen,
    plugin: {
      name: "recorder",
      async handle(call, next) {
        const outcome = await next();
        seen[call.method] = call.positions(outcome.data);
        return outcome;
      },
    },
  };
};

describe("precisely", () => {
  describe("the client", () => {
    it("says which API it speaks and which server answers", () => {
      expect(onVendor(fakeFetch())).toMatchObject({ shape: "precisely", server: "precisely" });
      expect(onOg(fakeFetch())).toMatchObject({ shape: "precisely", server: "og" });
    });

    it("needs an og server or both the key and the secret", () => {
      for (const options of [{}, { apiKey: KEY }, { apiSecret: SECRET }]) {
        let thrown: unknown;
        try {
          // @ts-expect-error The types refuse these, so this is a JavaScript caller's mistake.
          precisely(options);
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(GeocoderError);
        expect(thrown).toMatchObject({ code: "invalid_request", provider: "precisely" });
      }
    });

    it("needs no key when an og server is given", async () => {
      const fetch = fakeFetch({ body: geocodeFixture });
      const client = precisely({ baseUrl: OG, fetch, logLevel: "off" });
      await client.geocode({ addresses: [address] });
      expect(urlsOf(fetch)).toEqual([`${OG_ROOT}/v1/geocode`]);
    });

    it("reads the job ID out of a status URL", () => {
      expect(jobIdOf(submitFixture.statusUrl)).toBe(JOB_ID);
      expect(jobIdOf(`${OG_ROOT}/v2/bulk/jobs/abc123/?x=1#y`)).toBe("abc123");
    });
  });

  describe.each(CASES)("$name", (expected) => {
    it("asks Precisely with a bearer token and hands back its answer untouched", async () => {
      const fetch = fakeFetch(TOKEN, expected.reply);
      const outcome = await expected.call(onVendor(fetch)).withResponse();
      expect(fetch).toHaveBeenCalledTimes(2);
      expectRequest(fetch, 1, HOST, expected);
      expect(headersOf(fetch, 1)["authorization"]).toBe(BEARER);
      expect(outcome.data).toEqual(expected.reply.body);
      expect(outcome.server).toBe("precisely");
      expect(outcome.response?.status).toBe(expected.reply.status ?? 200);
    });

    it("asks og with no token, no key and no secret", async () => {
      const fetch = fakeFetch(expected.reply);
      const outcome = await expected.call(onOg(fetch)).withResponse();
      expect(fetch).toHaveBeenCalledTimes(1);
      expectRequest(fetch, 0, OG_ROOT, expected);
      expect(headersOf(fetch)["authorization"]).toBeUndefined();
      const sent = JSON.stringify(fetch.mock.calls);
      for (const credential of [KEY, SECRET, BASIC.slice(6), "Bearer", "Basic"])
        expect(sent).not.toContain(credential);
      expect(outcome.data).toEqual(expected.reply.body);
      expect(outcome.server).toBe("og");
      expect(outcome.cache).toEqual({ maxTtl: Infinity });
    });
  });

  describe("token", () => {
    it("trades the key and secret at Precisely, as HTTP Basic with a form body", async () => {
      const fetch = fakeFetch(TOKEN);
      const outcome = await onVendor(fetch).token().withResponse();
      expect(urlsOf(fetch)).toEqual([`${HOST}/auth/v2/token`]);
      expect(methodOf(fetch)).toBe("POST");
      expect(headersOf(fetch)).toMatchObject({
        authorization: BASIC,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      });
      expect(rawBodyOf(fetch)).toBe("grant_type=client_credentials&scope=default");
      expect(outcome.data).toEqual(tokenFixture);
      expect(outcome.cache).toEqual({ maxTtl: 0 });
    });

    it("is not a call of the og client, which sends no token", () => {
      const client = onOg(fakeFetch());
      // @ts-expect-error og takes no token, so its client has no token call.
      expect(client.token).toBeUndefined();
      expect("token" in client).toBe(false);
    });
  });

  describe("the bearer token", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("is fetched once and kept for the calls that follow", async () => {
      const fetch = fakeFetch(TOKEN, { body: geocodeFixture });
      const client = onVendor(fetch);
      await client.geocode({ addresses: [address] });
      await client.bulk.files();
      await client.autocomplete({ address });
      expect(urlsOf(fetch)).toEqual([
        `${HOST}/auth/v2/token`,
        `${HOST}/v1/geocode`,
        `${HOST}/v2/files`,
        `${HOST}/v1/autocomplete`,
      ]);
      expect(headersOf(fetch, 0)["authorization"]).toBe(BASIC);
      for (const call of [1, 2, 3]) expect(headersOf(fetch, call)["authorization"]).toBe(BEARER);
    });

    it("is fetched once for calls made at the same time", async () => {
      const fetch = fakeFetch(TOKEN, { body: geocodeFixture });
      const client = onVendor(fetch);
      await Promise.all([
        client.geocode({ addresses: [address] }),
        client.lookup({ keys: [{ key: "k", type: "PB_KEY", country: "USA" }] }),
        client.bulk.jobs(),
      ]);
      const urls = urlsOf(fetch);
      expect(urls).toHaveLength(4);
      expect(urls.filter((url) => url.endsWith("/auth/v2/token"))).toHaveLength(1);
    });

    it("is renewed shortly before it expires", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const start = Date.now();
      const fetch = fakeFetch(
        TOKEN,
        { body: geocodeFixture },
        { body: geocodeFixture },
        { body: { ...tokenFixture, access_token: "second" } },
        { body: geocodeFixture },
      );
      const client = onVendor(fetch);
      await client.geocode({ addresses: [address] });
      // The token lasts 1800 seconds and is given up a minute early.
      vi.setSystemTime(start + 1739_000);
      await client.geocode({ addresses: [address] });
      vi.setSystemTime(start + 1741_000);
      await client.geocode({ addresses: [address] });
      expect(urlsOf(fetch).map((url) => url.slice(HOST.length))).toEqual([
        "/auth/v2/token",
        "/v1/geocode",
        "/v1/geocode",
        "/auth/v2/token",
        "/v1/geocode",
      ]);
      expect(headersOf(fetch, 2)["authorization"]).toBe(BEARER);
      expect(headersOf(fetch, 4)["authorization"]).toBe("Bearer second");
    });

    it("is replaced once when Precisely answers 401, and the call is sent again", async () => {
      const fetch = fakeFetch(
        TOKEN,
        { status: 401, body: unauthorizedFixture },
        { body: { ...tokenFixture, access_token: "second" } },
        { body: geocodeFixture },
      );
      const client = onVendor(fetch);
      expect(await client.geocode({ addresses: [address] })).toEqual(geocodeFixture);
      expect(urlsOf(fetch).map((url) => url.slice(HOST.length))).toEqual([
        "/auth/v2/token",
        "/v1/geocode",
        "/auth/v2/token",
        "/v1/geocode",
      ]);
      expect(headersOf(fetch, 1)["authorization"]).toBe(BEARER);
      expect(headersOf(fetch, 3)["authorization"]).toBe("Bearer second");
      // The fresh token is the one kept.
      await client.bulk.files();
      expect(headersOf(fetch, 4)["authorization"]).toBe("Bearer second");
    });

    it("is not replaced a second time for the same call", async () => {
      const fetch = fakeFetch(TOKEN, { status: 401, body: unauthorizedFixture }, TOKEN, {
        status: 401,
        body: unauthorizedFixture,
        headers: { "x-request-id": "req-401" },
      });
      const error = await caught(onVendor(fetch).geocode({ addresses: [address] }));
      expect(fetch).toHaveBeenCalledTimes(4);
      expect(error).toMatchObject({
        code: "unauthenticated",
        status: 401,
        provider: "precisely",
        operation: "geocode",
        requestId: "req-401",
      });
      expect(error.cause).toBeInstanceOf(AuthenticationError);
    });

    it("fails the call when the key or secret is refused", async () => {
      const fetch = fakeFetch({ status: 400, body: tokenErrorFixture });
      const error = await caught(onVendor(fetch).geocode({ addresses: [address] }));
      expect(fetch).toHaveBeenCalledTimes(1);
      // Precisely answers 400 here, and its own code says the credentials are the problem.
      expect(error).toMatchObject({
        code: "unauthenticated",
        status: 400,
        provider: "precisely",
        operation: "geocode",
        message: tokenErrorFixture.error_description,
        body: tokenErrorFixture,
      });
      expect(error.cause).toBeInstanceOf(BadRequestError);
    });

    it("fails the call when the token answer holds no token", async () => {
      const fetch = fakeFetch({ body: { token_type: "Bearer" } });
      const error = await caught(onVendor(fetch).geocode({ addresses: [address] }));
      expect(error).toMatchObject({ code: "provider_error", provider: "precisely" });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("is asked for again after a failed exchange", async () => {
      const fetch = fakeFetch({ status: 400, body: tokenErrorFixture }, TOKEN, {
        body: geocodeFixture,
      });
      const client = onVendor(fetch);
      await caught(client.geocode({ addresses: [address] }));
      expect(await client.geocode({ addresses: [address] })).toEqual(geocodeFixture);
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("lets a caller give up while the exchange is still under way", async () => {
      const fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as Fetch;
      const controller = new AbortController();
      const call = caught(
        onVendor(fetch).geocode({ addresses: [address] }, { signal: controller.signal }),
      );
      controller.abort();
      expect(await call).toMatchObject({ code: "aborted", operation: "geocode" });
    });

    it("is never asked for when og answers", async () => {
      const fetch = fakeFetch({ body: geocodeFixture });
      const client = onOg(fetch);
      await client.geocode({ addresses: [address] });
      await client.bulk.files();
      expect(urlsOf(fetch)).toEqual([`${OG_ROOT}/v1/geocode`, `${OG_ROOT}/v2/files`]);
    });
  });

  describe("a region", () => {
    it("answers the real-time calls, while the token and the bulk calls stay on the default host", async () => {
      const fetch = fakeFetch(TOKEN, { body: geocodeFixture });
      const client = onVendor(fetch, { region: "eu1" });
      await client.geocode({ addresses: [address] });
      await client.autocomplete({ address });
      await client.bulk.files();
      expect(urlsOf(fetch)).toEqual([
        `${HOST}/auth/v2/token`,
        "https://api.eu1.cloud.precisely.com/v1/geocode",
        "https://api.eu1.cloud.precisely.com/v1/autocomplete",
        `${HOST}/v2/files`,
      ]);
    });
  });

  describe("bulk.upload", () => {
    const csv = "addressId|address|country\n1|4820 Kestrel Blvd|USA\n";

    it("sends the file to the signed URL with no token and none of the client's headers", async () => {
      const fetch = fakeFetch({ body: "" });
      const client = onVendor(fetch, { headers: { "x-gateway": "g" } });
      const outcome = await client.bulk
        .upload({ url: uploadUrlFixture.url, content: csv })
        .withResponse();
      expect(urlsOf(fetch)).toEqual([uploadUrlFixture.url]);
      expect(methodOf(fetch)).toBe("PUT");
      expect(rawBodyOf(fetch)).toBe(csv);
      const headers = headersOf(fetch);
      expect(headers["content-type"]).toBe("text/csv");
      expect(headers["authorization"]).toBeUndefined();
      expect(headers["x-gateway"]).toBeUndefined();
      expect(outcome.data).toBeUndefined();
      expect(outcome.cache).toEqual({ maxTtl: 0 });
    });

    it("sends the content type asked for", async () => {
      const fetch = fakeFetch({ body: "" });
      await onVendor(fetch).bulk.upload({
        url: uploadUrlFixture.url,
        content: new Blob([csv]),
        contentType: "text/plain",
      });
      expect(headersOf(fetch)["content-type"]).toBe("text/plain");
      expect(rawBodyOf(fetch)).toBeInstanceOf(Blob);
    });

    it("sends the file to og's own URL the way every request to og goes", async () => {
      const url = `${OG_ROOT}/v2/files/${FILE_ID}/content`;
      const fetch = fakeFetch({ body: "" });
      await onOg(fetch, { headers: { "x-gateway": "g" } }).bulk.upload({ url, content: csv });
      expect(urlsOf(fetch)).toEqual([url]);
      expect(methodOf(fetch)).toBe("PUT");
      expect(headersOf(fetch)).toMatchObject({ "content-type": "text/csv", "x-gateway": "g" });
      expect(headersOf(fetch)["authorization"]).toBeUndefined();
    });

    it("is sent once, since a repeat is not known to be safe", async () => {
      const fetch = fakeFetch({
        status: 503,
        body: "",
        headers: { "x-amz-request-id": "store-1" },
      });
      const error = await caught(
        onVendor(fetch).bulk.upload({ url: uploadUrlFixture.url, content: csv }),
      );
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(error).toMatchObject({
        code: "unavailable",
        status: 503,
        provider: "precisely",
        operation: "bulk.upload",
        requestId: "store-1",
      });
    });
  });

  describe("bulk.results", () => {
    const csv = "addressId,status\n1,OK\n";

    it("reads the output file from the signed URL as text, with no token", async () => {
      const fetch = fakeFetch({ body: csv, headers: { "content-type": "text/csv" } });
      const client = onVendor(fetch, { headers: { "x-gateway": "g" } });
      const outcome = await client.bulk
        .results({ downloadUrl: jobStatusFixture.downloadUrl })
        .withResponse();
      expect(urlsOf(fetch)).toEqual([jobStatusFixture.downloadUrl]);
      expect(methodOf(fetch)).toBe("GET");
      expect(headersOf(fetch)).toEqual({ accept: "text/csv" });
      expect(outcome.data).toBe(csv);
      expect(outcome.cache).toEqual({ maxTtl: 0 });
    });

    it("reads the output file from og's own URL", async () => {
      const downloadUrl = `${OG_ROOT}/v2/bulk/jobs/abc/output`;
      const fetch = fakeFetch({ body: csv, headers: { "content-type": "text/csv" } });
      expect(await onOg(fetch).bulk.results({ downloadUrl })).toBe(csv);
      expect(urlsOf(fetch)).toEqual([downloadUrl]);
      expect(headersOf(fetch)["authorization"]).toBeUndefined();
    });
  });

  describe("headers", () => {
    it("sends the client's headers and the call's headers to og and to Precisely", async () => {
      const options = { headers: { "x-gateway": "g" } };
      const toVendor = fakeFetch(TOKEN, { body: geocodeFixture });
      const toOg = fakeFetch({ body: geocodeFixture });
      const call = { headers: { "x-call": "c" } };
      await onVendor(toVendor, options).geocode({ addresses: [address] }, call);
      await onOg(toOg, options).geocode({ addresses: [address] }, call);
      expect(headersOf(toVendor, 1)).toMatchObject({ "x-gateway": "g", "x-call": "c" });
      expect(headersOf(toOg, 0)).toMatchObject({ "x-gateway": "g", "x-call": "c" });
    });

    it("leaves a header field that is not set out of the request", async () => {
      const fetch = fakeFetch({ body: geocodeFixture });
      await onOg(fetch).geocode({ "X-Request-Id": undefined, addresses: [address] });
      expect(headersOf(fetch)).toEqual({
        accept: "application/json",
        "content-type": "application/json",
      });
      expect(bodyOf(fetch)).toEqual({ addresses: [address] });
    });
  });

  describe("retries", () => {
    const busy: Reply = {
      status: 503,
      body: unavailableFixture,
      headers: { "retry-after-ms": "1" },
    };

    it("repeats a lookup that failed for now", async () => {
      const fetch = fakeFetch(busy, { body: geocodeFixture });
      expect(await onOg(fetch).geocode({ addresses: [address] })).toEqual(geocodeFixture);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it.each(["autocomplete", "expressAutocomplete", "expressAutocompleteV2"] as const)(
      "sends %s once, since a retried keystroke is already stale",
      async (method) => {
        const fetch = fakeFetch(busy, { body: autocompleteFixture });
        const error = await caught(onOg(fetch)[method]({ address }));
        expect(error).toMatchObject({ code: "unavailable", operation: method });
        expect(fetch).toHaveBeenCalledTimes(1);
      },
    );

    it("sends autocompletePostalCity once, since a retried keystroke is already stale", async () => {
      const fetch = fakeFetch(busy, { body: postalCityFixture });
      const error = await caught(
        onOg(fetch).autocompletePostalCity({ address: { postAddress: "5448", country: "USA" } }),
      );
      expect(error).toMatchObject({ code: "unavailable", operation: "autocompletePostalCity" });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("repeats a type-ahead call when the caller asks for it", async () => {
      const fetch = fakeFetch(busy, { body: autocompleteFixture });
      expect(await onOg(fetch).autocomplete({ address }, { maxRetries: 1 })).toEqual(
        autocompleteFixture,
      );
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it.each(["geocode", "verify"] as const)(
      "never repeats bulk.%s, since that would start a second job",
      async (method) => {
        const fetch = fakeFetch(busy, { status: 202, body: submitFixture });
        const error = await caught(
          onOg(fetch).bulk[method]({ fileId: FILE_ID }, { maxRetries: 3 }),
        );
        expect(error).toMatchObject({ code: "unavailable", operation: `bulk.${method}` });
        expect(fetch).toHaveBeenCalledTimes(1);
      },
    );

    it("never repeats bulk.uploadUrl, since each call makes a new file", async () => {
      const fetch = fakeFetch(busy, { body: uploadUrlFixture });
      await caught(onOg(fetch).bulk.uploadUrl({ fileName: "f" }));
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("answers", () => {
    it("hands back a partly failed batch, sent with 206, as it is", async () => {
      const fetch = fakeFetch({ status: 206, body: partialFixture });
      const outcome = await onOg(fetch)
        .geocode({
          addresses: [
            { addressId: "1", country: "QQQ" },
            { addressId: "2", ...address },
          ],
        })
        .withResponse();
      expect(outcome.response?.status).toBe(206);
      expect(outcome.data).toEqual(partialFixture);
      expect(outcome.data.responses.map((item) => item.status)).toEqual(["INVALID_REQUEST", "OK"]);
    });

    it("carries the request ID of the answer", async () => {
      const fetch = fakeFetch({ body: geocodeFixture, headers: { "x-request-id": "req-7" } });
      const outcome = await onOg(fetch)
        .geocode({ addresses: [address] })
        .withResponse();
      expect(outcome.requestId).toBe("req-7");
    });
  });

  describe("how long an answer may be kept", () => {
    it("is 30 days for a lookup Precisely answered", async () => {
      const fetch = fakeFetch(TOKEN, { body: geocodeFixture });
      const client = onVendor(fetch);
      for (const call of [
        client.geocode({ addresses: [address] }),
        client.reverseGeocode({ locations: [{ longitude: 1, latitude: 2, country: "USA" }] }),
        client.lookup({ keys: [{ key: "k", type: "PB_KEY", country: "USA" }] }),
        client.verify({ addresses: [address] }),
        client.autocomplete({ address }),
      ]) {
        const outcome = await call.withResponse();
        expect(outcome.cache).toEqual({ maxTtl: 30 * DAY });
        expect(outcome.server).toBe("precisely");
      }
    });

    it("is never for a job's state or a file Precisely answered", async () => {
      const fetch = fakeFetch(TOKEN, { body: jobStatusFixture });
      const client = onVendor(fetch);
      for (const call of [
        client.bulk.status({ jobId: JOB_ID }),
        client.bulk.jobs(),
        client.bulk.files(),
        client.bulk.uploadUrl({ fileName: "f" }),
        client.bulk.geocode({ fileId: FILE_ID }),
      ])
        expect((await call.withResponse()).cache).toEqual({ maxTtl: 0 });
    });

    it("has no limit when og answered", async () => {
      const fetch = fakeFetch({ body: geocodeFixture });
      const outcome = await onOg(fetch)
        .geocode({ addresses: [address] })
        .withResponse();
      expect(outcome).toMatchObject({ server: "og", cache: { maxTtl: Infinity } });
    });
  });

  describe("errors", () => {
    const failures: [number, unknown, GeocoderErrorCode][] = [
      [400, badRequestFixture, "invalid_request"],
      [401, unauthorizedFixture, "unauthenticated"],
      [403, forbiddenFixture, "permission_denied"],
      [413, tooLargeFixture, "payload_too_large"],
      [429, rateLimitFixture, "rate_limited"],
      [500, internalFixture, "provider_error"],
      [503, unavailableFixture, "unavailable"],
      [
        501,
        { errors: [{ status: "NOT_IMPLEMENTED", errorMessage: "This API is not implemented" }] },
        "unsupported",
      ],
      [404, { errors: [{ status: "NOT_FOUND", errorMessage: "No such resource" }] }, "not_found"],
    ];

    it.each(failures)("reads a %i from og", async (status, body, code) => {
      const fetch = fakeFetch({ status, body, headers: { "x-request-id": "req-9" } });
      const error = await caught(
        onOg(fetch, { maxRetries: 0 }).reverseGeocode({
          locations: [{ longitude: 1, latitude: 2, country: "USA" }],
        }),
      );
      const message = (body as { errors: { errorMessage: string }[] }).errors[0]!.errorMessage;
      expect(error).toBeInstanceOf(GeocoderError);
      expect(error).toMatchObject({
        code,
        status,
        provider: "og",
        operation: "reverseGeocode",
        requestId: "req-9",
        message,
        body,
      });
      expect(error.cause).toBeInstanceOf(OgError);
      expect(error.cause).toMatchObject({ status, body, provider: "og", requestId: "req-9" });
      expect((error.cause as OgError).headers?.get("x-request-id")).toBe("req-9");
    });

    it("reads an error Precisely answered", async () => {
      const fetch = fakeFetch(TOKEN, {
        status: 400,
        body: cancelErrorFixture,
        headers: { "x-request-id": "req-3" },
      });
      const error = await caught(onVendor(fetch).bulk.cancel({ jobId: "nope" }));
      expect(error).toMatchObject({
        code: "invalid_request",
        status: 400,
        provider: "precisely",
        operation: "bulk.cancel",
        requestId: "req-3",
        message: cancelErrorFixture.errors[0]!.errorMessage,
      });
      expect(error.cause).toBeInstanceOf(BadRequestError);
      expect(error.cause).toMatchObject({ body: cancelErrorFixture, provider: "precisely" });
    });

    it("joins the messages of an error with several entries", async () => {
      const body = {
        errors: [
          { status: "INVALID_REQUEST", errorMessage: "First (DIS-LI-1015)" },
          { status: "INVALID_REQUEST", errorMessage: "Second (DIS-LI-1016)" },
        ],
      };
      const error = await caught(
        onOg(fakeFetch({ status: 400, body })).geocode({ addresses: [address] }),
      );
      expect(error.message).toBe("First (DIS-LI-1015) Second (DIS-LI-1016)");
    });

    it.each<[string, number, unknown, GeocoderErrorCode]>([
      [
        "a wrong key or secret sent with 400",
        400,
        { errors: [{ status: "INVALID_REQUEST", errorMessage: "Bad key or secret (DIS-1006)" }] },
        "unauthenticated",
      ],
      [
        "a used-up quota sent with 403",
        403,
        { errors: [{ status: "FORBIDDEN", errorMessage: "The quota is used up (DIS-1007)" }] },
        "rate_limited",
      ],
      [
        "an expired workspace sent with 400",
        400,
        { errors: [{ status: "INVALID_REQUEST", errorMessage: "Workspace expired (DIS-1010)" }] },
        "permission_denied",
      ],
      [
        "a lookup that ran out of time",
        503,
        { errors: [{ status: "REQUEST_TIMEOUT", errorMessage: "Try again (DIS-LI-1011)" }] },
        "timeout",
      ],
      [
        "an OAuth error that says the caller may not",
        400,
        { error: "access_denied", error_description: "The key may not do this" },
        "permission_denied",
      ],
      ["a body that is not Precisely's", 418, "short and stout", "invalid_request"],
    ])("reads %s by what the body says", async (_name, status, body, code) => {
      const fetch = fakeFetch({ status, body });
      const error = await caught(onOg(fetch, { maxRetries: 0 }).geocode({ addresses: [address] }));
      expect(error).toMatchObject({ code, status });
    });

    it("fails with provider_error when a 200 holds no JSON", async () => {
      const fetch = fakeFetch({ body: "<html>" });
      const error = await caught(onOg(fetch).geocode({ addresses: [address] }));
      expect(error).toMatchObject({ code: "provider_error", status: 200, operation: "geocode" });
    });
  });

  describe("plugins", () => {
    it("are told the point of every candidate when one item was asked for", async () => {
      const { plugin, seen } = recorder();
      const two = {
        responses: [
          {
            status: "OK",
            results: [
              geocodeFixture.responses[0]!.results[0],
              { address: {} },
              { location: { feature: { geometry: { type: "Point", coordinates: [7.5, 43.5] } } } },
            ],
          },
        ],
      };
      const fetch = fakeFetch(
        { body: two },
        { body: reverseFixture },
        { body: lookupFixture },
        { body: verifyFixture },
      );
      const client = onOg(fetch, { plugins: [plugin] });
      await client.geocode({ addresses: [address] });
      await client.reverseGeocode({ locations: [{ longitude: 1, latitude: 2, country: "USA" }] });
      await client.lookup({ keys: [{ key: "k", type: "PB_KEY", country: "USA" }] });
      await client.verify({ addresses: [address] });
      expect(seen).toEqual({
        // The candidate without a point is left out.
        geocode: [
          { lat: 40.117485, lon: -82.914362 },
          { lat: 43.5, lon: 7.5 },
        ],
        reverseGeocode: [{ lat: 39.526618, lon: -105.318274 }],
        lookup: [{ lat: 39.526618, lon: -105.318274 }],
        // Verify answers no location.
        verify: [],
      });
    });

    it("are told the points of a postal-city and a proximity answer, and none of an explanation", async () => {
      const { plugin, seen } = recorder();
      const fetch = fakeFetch(
        { body: postalCityFixture },
        { body: proximityFixture },
        { body: explainFixture },
      );
      const client = onOg(fetch, { plugins: [plugin] });
      await client.autocompletePostalCity({ address: { postAddress: "5448", country: "USA" } });
      await client.proximitySearch({
        preferences: { dataset: "premium-address-points" },
        location: { latitude: 44.5231, longitude: -89.5741, country: "USA" },
      });
      await client.explainAddressCode({
        codeType: "GlobalMatchCode",
        codes: [{ code: "V4-P4-5" }],
      });
      expect(seen).toEqual({
        autocompletePostalCity: [{ lat: 44.52307, lon: -89.57412 }],
        proximitySearch: [{ lat: 44.52311, lon: -89.57409 }],
        explainAddressCode: [],
      });
    });

    it("are told the first point of each item of a batch", async () => {
      const { plugin, seen } = recorder();
      const fetch = fakeFetch({ status: 206, body: partialFixture });
      await onOg(fetch, { plugins: [plugin] }).geocode({
        addresses: [{ country: "QQQ" }, address],
      });
      // The failed item has no point and is left out.
      expect(seen["geocode"]).toEqual([{ lat: 40.117485, lon: -82.914362 }]);
    });

    it.each(["autocomplete", "expressAutocomplete", "expressAutocompleteV2"] as const)(
      "are told the point of every prediction of %s",
      async (method) => {
        const { plugin, seen } = recorder();
        const fetch = fakeFetch({ body: autocompleteFixture });
        await onOg(fetch, { plugins: [plugin] })[method]({ address });
        expect(seen[method]).toEqual([
          { lat: 44.318639999999995, lon: -89.73128 },
          { lat: 45.061385, lon: -94.20716999999999 },
        ]);
      },
    );

    it("can send any lookup again on another client, by the name of its method", async () => {
      const lookups = CASES.slice(0, 10);
      for (const expected of lookups) {
        const second = fakeFetch(expected.reply);
        const other = onOg(second);
        const elsewhere: Plugin = { name: "elsewhere", handle: (call) => call.run(other) };
        const first = fakeFetch(TOKEN, { status: 500, body: internalFixture });
        const outcome = await expected
          .call(onVendor(first, { plugins: [elsewhere] }))
          .withResponse();
        expect(first).not.toHaveBeenCalled();
        expectRequest(second, 0, OG_ROOT, expected);
        expect(outcome.data).toEqual(expected.reply.body);
        expect(outcome.server).toBe("og");
      }
    });

    it("never see the file and job calls", async () => {
      const handle = vi.fn<Plugin["handle"]>((_call, next) => next());
      const fetch = fakeFetch({ body: jobStatusFixture });
      const client = onOg(fetch, { plugins: [{ name: "spy", handle }] });
      const url = `${OG_ROOT}/v2/files/${FILE_ID}/content`;
      await client.bulk.uploadUrl({ fileName: "f" });
      await client.bulk.upload({ url, content: "a" });
      await client.bulk.files();
      await client.bulk.deleteFile({ fileId: FILE_ID });
      await client.bulk.geocode({ fileId: FILE_ID });
      await client.bulk.verify({ fileId: FILE_ID });
      await client.bulk.jobs();
      await client.bulk.status({ jobId: JOB_ID });
      await client.bulk.cancel({ jobId: JOB_ID });
      await client.bulk.results({ downloadUrl: `${OG_ROOT}/v2/bulk/jobs/${JOB_ID}/output` });
      expect(fetch).toHaveBeenCalledTimes(10);
      expect(handle).not.toHaveBeenCalled();
      await client.geocode({ addresses: [address] });
      expect(handle).toHaveBeenCalledTimes(1);
    });
  });
});
