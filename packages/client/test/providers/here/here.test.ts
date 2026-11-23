/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Plugin, Position } from "../../../src/base.ts";
import type { Outcome } from "../../../src/core.ts";
import {
  AuthenticationError,
  BadRequestError,
  GeocoderError,
  InternalServerError,
  NotFoundError,
} from "../../../src/errors.ts";
import { here, type HereClient } from "../../../src/providers/here/index.ts";
import { fakeFetch, type Fetch, headersOf, type Reply, urlOf } from "../../helpers.ts";

const read = (name: string): string =>
  readFileSync(new URL(`../../fixtures/here/${name}`, import.meta.url), "utf8");
const fixture = (name: string): unknown => JSON.parse(read(name));

const OG = "https://og.test";
const KEY = "here-key-never-sent-to-og";
const DAY = 24 * 60 * 60 * 1000;

const GEOCODE_HRN = "hrn:here:service::olp-here:search-geocode-7";
const JOB = "JOB-a05d82f7-1c36-4e9b-8d40-f7b29c6e1a35";
const NOTIFICATION = "NOTIFICATION-5b7e1c93-0d42-4a68-9f31-c2e8d4a6b017";

/** A synthetic answer of multi reverse geocode, with one sub-request that failed. */
const MULTI = {
  results: [
    {
      id: "first",
      items: [
        {
          title: "Vossenlaan 12, 1999 ZZ Merelveen, Nederland",
          id: "here:af:streetsection:Qw7.hT2mVbN8sLxK4pJcRd:CgcIBCDk9sYhEAEaAjEy",
          resultType: "houseNumber",
          houseNumberType: "PA",
          address: { label: "Vossenlaan 12, 1999 ZZ Merelveen, Nederland", countryCode: "NLD" },
          position: { lat: 52.18401, lng: 5.90522 },
          distance: 7,
        },
        {
          title: "Vossenlaan, 1999 ZZ Merelveen, Nederland",
          id: "here:af:street:Qw7.hT2mVbN8sLxK4pJcRd",
          resultType: "street",
          address: { label: "Vossenlaan, 1999 ZZ Merelveen, Nederland", countryCode: "NLD" },
          position: { lat: 52.1842, lng: 5.9055 },
          distance: 31,
        },
      ],
    },
    { id: "second", error: { title: "Illegal input for parameter 'at'" } },
    {
      id: "third",
      items: [
        {
          title: "Merelveen, Gelderland, Nederland",
          id: "here:cm:namedplace:29417306",
          resultType: "locality",
          localityType: "city",
          address: { label: "Merelveen, Gelderland, Nederland", countryCode: "NLD" },
          position: { lat: 52.18342, lng: 5.90417 },
          distance: 240,
        },
      ],
    },
    { id: "fourth", items: [] },
  ],
};

/** A synthetic answer of browse. Its second item has no position. */
const BROWSE = {
  items: [
    {
      title: "Bakkerij De Korenschoof",
      id: "here:pds:place:528u1k4f-0c7e41a9d2b6483f95e1a7c3d8f0b264",
      resultType: "place",
      address: { label: "Bakkerij De Korenschoof, Vossenlaan 3, 1999 ZZ Merelveen, Nederland" },
      position: { lat: 52.18377, lng: 5.90489 },
      distance: 48,
      categories: [{ id: "600-6300-0244", name: "Bakkerij", primary: true }],
    },
    {
      title: "Gelderland, Nederland",
      id: "here:cm:namedplace:29000117",
      resultType: "administrativeArea",
      administrativeAreaType: "state",
      address: { label: "Gelderland, Nederland" },
    },
  ],
};

const JOBS = { limit: 2, count: 1, items: [fixture("job-completed.json")] };
const DELETED = { total: 1, jobIds: [JOB] };
const JOB_DELETED = { id: JOB, serviceHrn: GEOCODE_HRN, billingTags: [], status: "deleted" };
const HOOK = {
  id: NOTIFICATION,
  type: "webHook",
  config: { url: "https://hooks.example.test/done?job=${JOB_ID}&status=${JOB_STATUS}" },
};
const VERSION = {
  apiVersion: "v7",
  serviceVersion: "7.0.99",
  dataVersions: [{ name: "synthetic-map", version: "26.40" }],
};
const OPENAPI = '{"openapi":"3.0.1","info":{"title":"A synthetic document"}}';

const INPUT = "recId|q|country\n1|Elmelyvej 73 Ravnsbæk|DNK\n";

interface Case {
  /** The method's name on the client, which is also the name plugins see. */
  name: string;
  call: (client: HereClient) => PromiseLike<unknown> & { withResponse(): Promise<Outcome> };
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** The HERE host the service is served from. */
  host: string;
  path: string;
  query?: Record<string, string>;
  body?: string;
  contentType?: string;
  reply: Reply;
  /** What the call resolves to. Default the reply's body. */
  data?: unknown;
}

const CASES: Case[] = [
  {
    name: "geocode",
    call: (client) =>
      client.geocode({
        q: "17 Quillfield Lane Harrowmere",
        qq: { city: "Harrowmere", country: "Australia", houseNumber: undefined },
        at: "-37.48,144.9",
        in: "countryCode:AUS,NZL",
        addressNamesMode: "normalized",
        addressNamesVariant: { city: "administrative" },
        postalCodeMode: "cityLookup",
        types: ["address", "street"],
        with: ["MPA"],
        lang: ["en-AU", "en"],
        limit: 3,
        politicalView: "ARG",
        show: ["parsing", "tz"],
        showLocalizedNames: ["ja-Hira"],
        showMapReferences: ["adminIds", "segments"],
        showNavAttributes: ["access", "speedLimits"],
        showRelated: ["intersections"],
        showTranslations: ["city", "state"],
      }),
    method: "GET",
    host: "geocode",
    path: "/v1/geocode",
    query: {
      q: "17 Quillfield Lane Harrowmere",
      qq: "city=Harrowmere;country=Australia",
      at: "-37.48,144.9",
      in: "countryCode:AUS,NZL",
      addressNamesMode: "normalized",
      "addressNamesVariant[city]": "administrative",
      postalCodeMode: "cityLookup",
      types: "address,street",
      with: "MPA",
      lang: "en-AU,en",
      limit: "3",
      politicalView: "ARG",
      show: "parsing,tz",
      showLocalizedNames: "ja-Hira",
      showMapReferences: "adminIds,segments",
      showNavAttributes: "access,speedLimits",
      showRelated: "intersections",
      showTranslations: "city,state",
    },
    reply: { body: fixture("geocode.json") },
  },
  {
    name: "revgeocode",
    call: (client) =>
      client.revgeocode({
        at: "60.41273,5.30846",
        bearing: 42,
        types: ["street"],
        with: ["unnamedStreets"],
        lang: ["nb"],
        limit: 2,
        show: ["countryInfo", "streetInfo"],
        showRelated: ["nearbyAddress"],
      }),
    method: "GET",
    host: "revgeocode",
    path: "/v1/revgeocode",
    query: {
      at: "60.41273,5.30846",
      bearing: "42",
      types: "street",
      with: "unnamedStreets",
      lang: "nb",
      limit: "2",
      show: "countryInfo,streetInfo",
      showRelated: "nearbyAddress",
    },
    reply: { body: fixture("revgeocode.json") },
  },
  {
    name: "multiRevgeocode",
    call: (client) =>
      client.multiRevgeocode({
        lang: ["nl"],
        limit: 2,
        body: [
          { id: "first", at: "52.184,5.9052" },
          { id: "second", at: "999,999", bearing: 90 },
          { id: "third", in: "circle:52.18342,5.90417;r=250" },
          { id: "fourth", at: "0,0" },
        ],
      }),
    method: "POST",
    host: "multi-revgeocode",
    path: "/v1/multi-revgeocode",
    query: { lang: "nl", limit: "2" },
    body: [
      "id=first&at=52.184,5.9052",
      "id=second&at=999,999&bearing=90",
      "id=third&in=circle:52.18342,5.90417;r=250",
      "id=fourth&at=0,0",
    ].join("\n"),
    contentType: "text/plain; charset=UTF-8",
    reply: { body: MULTI },
  },
  {
    name: "autosuggest",
    call: (client) =>
      client.autosuggest({
        q: "park",
        at: "35.48213,-97.61054",
        in: "countryCode:USA",
        mobilityMode: "truck",
        termsLimit: 2,
        with: ["recommendPlaces"],
        evStation: {
          minPower: 50,
          connectorTypeIds: [29, 33],
          supplierNames: ["Voltwerk"],
          current: "DC",
          paymentMethodIds: ["creditCard"],
        },
        fuelStation: { fuelTypes: ["diesel", "truck_diesel"], minimumTruckClass: "heavy" },
        lang: ["en-US"],
        limit: 5,
        offset: 0,
        show: ["details", "tz"],
        showMapReferences: ["pointAddress"],
      }),
    method: "GET",
    host: "autosuggest",
    path: "/v1/autosuggest",
    query: {
      q: "park",
      at: "35.48213,-97.61054",
      in: "countryCode:USA",
      mobilityMode: "truck",
      termsLimit: "2",
      with: "recommendPlaces",
      "evStation[minPower]": "50",
      "evStation[connectorTypeIds]": "29,33",
      "evStation[supplierNames]": "Voltwerk",
      "evStation[current]": "DC",
      "evStation[paymentMethodIds]": "creditCard",
      "fuelStation[fuelTypes]": "diesel,truck_diesel",
      "fuelStation[minimumTruckClass]": "heavy",
      lang: "en-US",
      limit: "5",
      offset: "0",
      show: "details,tz",
      showMapReferences: "pointAddress",
    },
    reply: { body: fixture("autosuggest.json") },
  },
  {
    name: "autocomplete",
    call: (client) =>
      client.autocomplete({
        q: "quillfield la",
        at: "-37.48,144.9",
        in: "bbox:144.5,-38,145.5,-37",
        postalCodeMode: "districtLookup",
        types: ["address", "postalCode"],
        lang: ["en"],
        limit: 4,
        show: ["streetInfo"],
      }),
    method: "GET",
    host: "autocomplete",
    path: "/v1/autocomplete",
    query: {
      q: "quillfield la",
      at: "-37.48,144.9",
      in: "bbox:144.5,-38,145.5,-37",
      postalCodeMode: "districtLookup",
      types: "address,postalCode",
      lang: "en",
      limit: "4",
      show: "streetInfo",
    },
    reply: { body: fixture("autocomplete.json") },
  },
  {
    name: "discover",
    call: (client) =>
      client.discover({
        q: "coffee",
        in: "circle:44.61382,-122.90417;r=5000",
        lang: ["en-US"],
        limit: 2,
        show: ["phonemes", "tz"],
      }),
    method: "GET",
    host: "discover",
    path: "/v1/discover",
    query: {
      q: "coffee",
      in: "circle:44.61382,-122.90417;r=5000",
      lang: "en-US",
      limit: "2",
      show: "phonemes,tz",
    },
    reply: { body: fixture("discover.json") },
  },
  {
    name: "lookup",
    call: (client) =>
      client.lookup({
        id: "here:pds:place:528u1k4f-9a62d7e0c3b54815bf07e2d4c618a93b",
        lang: ["nl"],
        show: ["tz", "countryInfo", "ev"],
        showRelated: ["parentPA"],
      }),
    method: "GET",
    host: "lookup",
    path: "/v1/lookup",
    query: {
      id: "here:pds:place:528u1k4f-9a62d7e0c3b54815bf07e2d4c618a93b",
      lang: "nl",
      show: "tz,countryInfo,ev",
      showRelated: "parentPA",
    },
    reply: { body: fixture("lookup.json") },
  },
  {
    name: "browse",
    call: (client) =>
      client.browse({
        at: "52.18342,5.90417",
        categories: ["600-6300-0244", "!100-1000-0009"],
        chains: ["1566"],
        foodTypes: ["304-000"],
        name: "korenschoof",
        limit: 2,
      }),
    method: "GET",
    host: "browse",
    path: "/v1/browse",
    query: {
      at: "52.18342,5.90417",
      categories: "600-6300-0244,!100-1000-0009",
      chains: "1566",
      foodTypes: "304-000",
      name: "korenschoof",
      limit: "2",
    },
    reply: { body: BROWSE },
  },
  {
    name: "batch.create",
    call: (client) =>
      client.batch.create({
        body: INPUT,
        serviceHrn: GEOCODE_HRN,
        tag: "nightly",
        billingTags: ["teamA", "teamB"],
        inputDelimiter: "|",
        outputDelimiter: "\\t",
        outputColumns: ["recId", "position", "addressLabel"],
        startJob: false,
        outputType: "csv",
        notificationIds: [NOTIFICATION],
      }),
    method: "POST",
    host: "batch",
    path: "/v7/batch/jobs",
    query: {
      serviceHrn: GEOCODE_HRN,
      tag: "nightly",
      billingTags: "teamA,teamB",
      inputDelimiter: "|",
      outputDelimiter: "\\t",
      outputColumns: "recId\tposition\taddressLabel",
      startJob: "false",
      outputType: "csv",
      notificationIds: NOTIFICATION,
    },
    body: INPUT,
    contentType: "text/plain; charset=UTF-8",
    reply: { status: 201, body: fixture("job-created.json") },
  },
  {
    name: "batch.list",
    call: (client) =>
      client.batch.list({ limit: 2, offset: 4, status: "completed", tag: "nightly" }),
    method: "GET",
    host: "batch",
    path: "/v7/batch/jobs",
    query: { limit: "2", offset: "4", status: "completed", tag: "nightly" },
    reply: { body: JOBS },
  },
  {
    name: "batch.status",
    call: (client) => client.batch.status({ jobId: JOB }),
    method: "GET",
    host: "batch",
    path: `/v7/batch/jobs/${JOB}`,
    reply: { body: fixture("job-completed.json") },
  },
  {
    name: "batch.start",
    call: (client) => client.batch.start({ jobId: JOB }),
    method: "PUT",
    host: "batch",
    path: `/v7/batch/jobs/${JOB}/start`,
    reply: { body: fixture("job-created.json") },
  },
  {
    name: "batch.stop",
    call: (client) => client.batch.stop({ jobId: JOB }),
    method: "PUT",
    host: "batch",
    path: `/v7/batch/jobs/${JOB}/stop`,
    reply: { body: fixture("job-stopped.json") },
  },
  {
    name: "batch.delete",
    call: (client) => client.batch.delete({ jobId: JOB }),
    method: "DELETE",
    host: "batch",
    path: `/v7/batch/jobs/${JOB}`,
    reply: { body: JOB_DELETED },
  },
  {
    name: "batch.deleteMany",
    call: (client) => client.batch.deleteMany({ status: "stopped", tag: "nightly" }),
    method: "DELETE",
    host: "batch",
    path: "/v7/batch/jobs",
    query: { status: "stopped", tag: "nightly" },
    reply: { body: DELETED },
  },
  {
    name: "batch.results",
    call: (client) => client.batch.results({ jobId: JOB }),
    method: "GET",
    host: "batch",
    path: `/v7/batch/jobs/${JOB}/results`,
    reply: { body: read("job-results.jsonl"), headers: { "content-type": "text/plain" } },
    data: read("job-results.jsonl"),
  },
  {
    name: "batch.errors",
    call: (client) => client.batch.errors({ jobId: JOB }),
    method: "GET",
    host: "batch",
    path: `/v7/batch/jobs/${JOB}/errors`,
    reply: { body: read("job-errors-input.txt"), headers: { "content-type": "text/plain" } },
    data: read("job-errors-input.txt"),
  },
  {
    name: "batch.notifications.create",
    call: (client) => client.batch.notifications.create({ type: "webHook", config: HOOK.config }),
    method: "POST",
    host: "batch",
    path: "/v7/batch/notifications",
    body: JSON.stringify({ type: "webHook", config: HOOK.config }),
    contentType: "application/json",
    reply: { status: 201, body: HOOK },
  },
  {
    name: "batch.notifications.list",
    call: (client) => client.batch.notifications.list(),
    method: "GET",
    host: "batch",
    path: "/v7/batch/notifications",
    reply: { body: [HOOK] },
  },
  {
    name: "batch.notifications.get",
    call: (client) => client.batch.notifications.get({ notificationId: NOTIFICATION }),
    method: "GET",
    host: "batch",
    path: `/v7/batch/notifications/${NOTIFICATION}`,
    reply: { body: HOOK },
  },
  {
    name: "batch.notifications.update",
    call: (client) =>
      client.batch.notifications.update({ notificationId: NOTIFICATION, config: HOOK.config }),
    method: "PUT",
    host: "batch",
    path: `/v7/batch/notifications/${NOTIFICATION}`,
    // The ID is in the path only.
    body: JSON.stringify({ config: HOOK.config }),
    contentType: "application/json",
    reply: { body: HOOK },
  },
  {
    name: "batch.version",
    call: (client) => client.batch.version(),
    method: "GET",
    host: "batch",
    path: "/v7/version",
    reply: { body: VERSION },
  },
  {
    name: "batch.health",
    call: (client) => client.batch.health(),
    method: "GET",
    host: "batch",
    path: "/v7/health",
    reply: { body: { status: "ok" } },
  },
  {
    name: "batch.openapi",
    call: (client) => client.batch.openapi(),
    method: "GET",
    host: "batch",
    path: "/v7/openapi",
    reply: { body: OPENAPI },
    data: OPENAPI,
  },
];

const TARGETS = [
  {
    target: "HERE",
    make: (fetch: Fetch) => here({ apiKey: KEY, fetch, logLevel: "off" }),
    origin: (host: string) => `https://${host}.search.hereapi.com`,
    prefix: "",
    key: { apiKey: KEY } as Record<string, string>,
  },
  {
    target: "og",
    // The key is given to show that og is never sent it.
    make: (fetch: Fetch) => here({ baseUrl: `${OG}/`, apiKey: KEY, fetch, logLevel: "off" }),
    origin: () => OG,
    prefix: "/compat/here",
    key: {} as Record<string, string>,
  },
];

/** A fetch that answers every request with no content. */
const noContent = (): Fetch => vi.fn(async () => new Response(null, { status: 204 })) as Fetch;

/** A reply whose retry comes at once, so a test of retries does not wait. */
const busy: Reply = {
  status: 503,
  body: { status: 503, title: "Service Unavailable" },
  headers: { "retry-after-ms": "1" },
};

const failure = async (promise: PromiseLike<unknown>): Promise<GeocoderError> => {
  const thrown = await Promise.resolve(promise).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(thrown).toBeInstanceOf(GeocoderError);
  return thrown as GeocoderError;
};

/** A client that asks HERE, or og when `baseUrl` is given. */
const asking = (fetch: Fetch, baseUrl?: string): HereClient =>
  here({ apiKey: KEY, baseUrl, fetch, logLevel: "off" });

/** Geocodes once and gives the outcome of an answer with these headers. */
const rule = async (headers: Record<string, string>, baseUrl?: string): Promise<Outcome> =>
  here({ apiKey: KEY, baseUrl, fetch: fakeFetch({ body: fixture("geocode.json"), headers }) })
    .geocode({ q: "x" })
    .withResponse();

/** A plugin that notes every call it sees and the points of its answer. */
const watcher = (): { plugin: Plugin; seen: { method: string; points: Position[] }[] } => {
  const seen: { method: string; points: Position[] }[] = [];
  return {
    seen,
    plugin: {
      name: "watcher",
      async handle(call, next) {
        const outcome = await next();
        seen.push({ method: call.method, points: call.positions(outcome.data) });
        return outcome;
      },
    },
  };
};

describe.each(TARGETS)("here client asking $target", ({ make, origin, prefix, key }) => {
  it.each(CASES)("sends $name as HERE names it", async (c) => {
    const fetch = fakeFetch(c.reply);
    const data = await c.call(make(fetch));

    expect(fetch).toHaveBeenCalledTimes(1);
    const url = urlOf(fetch);
    expect(url.origin).toBe(origin(c.host));
    expect(url.pathname).toBe(`${prefix}${c.path}`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ ...c.query, ...key });
    // HERE refuses a parameter sent twice.
    expect([...url.searchParams.keys()]).toHaveLength(new Set(url.searchParams.keys()).size);

    const init = fetch.mock.calls[0]![1]!;
    expect(init.method).toBe(c.method);
    expect(init.body).toBe(c.body);
    const headers = headersOf(fetch);
    expect(headers["content-type"]).toBe(c.contentType);
    expect(headers["accept"]).toBe("application/json");
    expect(headers["authorization"]).toBeUndefined();

    expect(data).toEqual(c.data ?? c.reply.body);
  });

  it("deletes and tests a notification, which answer with no content", async () => {
    const fetch = noContent();
    const client = make(fetch);
    await expect(
      client.batch.notifications.delete({ notificationId: NOTIFICATION }),
    ).resolves.toBeUndefined();
    await expect(
      client.batch.notifications.test({ notificationId: NOTIFICATION }),
    ).resolves.toBeUndefined();

    expect(
      fetch.mock.calls.map(([url, init]) => [init?.method, new URL(String(url)).pathname]),
    ).toEqual([
      ["DELETE", `${prefix}/v7/batch/notifications/${NOTIFICATION}`],
      ["GET", `${prefix}/v7/batch/notifications/${NOTIFICATION}/test`],
    ]);
    expect(urlOf(fetch).origin).toBe(origin("batch"));
  });

  it("sends signals as form lines with version 1, and never retries them", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 503 })) as Fetch;
    const client = make(fetch);
    const failed = await client
      .signals({
        body: [
          {
            action: "here:gs:action:navigate-to",
            correlationId: "c-1",
            resourceId: "here:pds:place:a b",
            rank: 2,
            timestamp: 1692625661000,
          },
          { action: "here:gs:action:view", correlationId: "c-2", resourceId: "r-2", rank: 0 },
        ],
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(failed).toBeInstanceOf(GeocoderError);
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = urlOf(fetch);
    expect(url.origin).toBe(origin("signals"));
    expect(url.pathname).toBe(`${prefix}/v1/signals`);
    expect(Object.fromEntries(url.searchParams)).toEqual(key);
    const init = fetch.mock.calls[0]![1]!;
    expect(init.method).toBe("POST");
    expect(headersOf(fetch)["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(init.body).toBe(
      "version=1&action=here:gs:action:navigate-to&correlationId=c-1&resourceId=here:pds:place:a%20b&rank=2&timestamp=1692625661000\n" +
        "version=1&action=here:gs:action:view&correlationId=c-2&resourceId=r-2&rank=0",
    );

    const sent = noContent();
    await expect(make(sent).signals({ body: "version=1&rank=0" })).resolves.toBeUndefined();
    expect(sent.mock.calls[0]![1]!.body).toBe("version=1&rank=0");
  });

  it("reads a job without results or errors as empty text", async () => {
    const client = make(noContent());
    await expect(client.batch.results({ jobId: JOB })).resolves.toBe("");
    await expect(client.batch.errors({ jobId: JOB })).resolves.toBe("");
  });

  it("sends a route in the body of a POST and never in the URL", async () => {
    const route = "BFoz5xJ67i1B1B7PzIhaxL7Y;w=5000";
    for (const [name, path, call] of [
      ["autosuggest", "/v1/autosuggest", (c: HereClient) => c.autosuggest({ q: "fuel", route })],
      [
        "discover",
        "/v1/discover",
        (c: HereClient) => c.discover({ q: "fuel", route, ranking: "excursionDistance" }),
      ],
      ["browse", "/v1/browse", (c: HereClient) => c.browse({ at: "52.5,13.4", route })],
    ] as const) {
      const fetch = fakeFetch({ body: { items: [], queryTerms: [] } });
      await call(make(fetch));
      const url = urlOf(fetch);
      expect(url.origin).toBe(origin(name));
      expect(url.pathname).toBe(`${prefix}${path}`);
      expect(url.searchParams.has("route")).toBe(false);
      const init = fetch.mock.calls[0]![1]!;
      expect(init.method).toBe("POST");
      expect(init.body).toBe("route=BFoz5xJ67i1B1B7PzIhaxL7Y%3Bw%3D5000");
      expect(new URLSearchParams(String(init.body)).get("route")).toBe(route);
      expect(headersOf(fetch)["content-type"]).toBe("application/x-www-form-urlencoded");
    }
  });

  it("sends a qualified query and a multi reverse geocode body given as HERE's own text", async () => {
    const fetch = fakeFetch({ body: { items: [] } }, { body: { results: [] } });
    const client = make(fetch);
    await client.geocode({ qq: "postalCode=6999;country=Danmark" });
    expect(urlOf(fetch).searchParams.get("qq")).toBe("postalCode=6999;country=Danmark");

    const body = "id=a&at=55.1,9.2\nid=b&in=circle:55.1,9.2;r=100";
    await client.multiRevgeocode({ body });
    expect(fetch.mock.calls[1]![1]!.body).toBe(body);
  });

  it("escapes what would break a line of a multi reverse geocode body", async () => {
    const fetch = fakeFetch({ body: { results: [] } });
    await make(fetch).multiRevgeocode({ body: [{ id: "a&b=c\nid=d", at: "1,2" }] });
    expect(fetch.mock.calls[0]![1]!.body).toBe("id=a%26b=c%0Aid=d&at=1,2");
  });

  it("sends a gzipped input with its content encoding", async () => {
    const fetch = fakeFetch({ status: 201, body: fixture("job-created.json") });
    const body = new Uint8Array([31, 139, 8, 0]);
    await make(fetch).batch.create({ body, contentEncoding: "gzip", serviceHrn: GEOCODE_HRN });
    expect(fetch.mock.calls[0]![1]!.body).toBe(body);
    expect(headersOf(fetch)).toMatchObject({
      "content-type": "text/plain; charset=UTF-8",
      "content-encoding": "gzip",
    });
  });

  it("lists jobs without any filter", async () => {
    const fetch = fakeFetch({ body: JOBS });
    await make(fetch).batch.list();
    expect(Object.fromEntries(urlOf(fetch).searchParams)).toEqual(key);
  });

  it("does not retry type-ahead unless asked, and retries other lookups", async () => {
    const empty: Reply = { body: { items: [], queryTerms: [] } };

    const suggest = fakeFetch(busy, empty);
    expect((await failure(make(suggest).autosuggest({ q: "pa", at: "1,2" }))).code).toBe(
      "unavailable",
    );
    expect(suggest).toHaveBeenCalledTimes(1);

    const complete = fakeFetch(busy, empty);
    await failure(make(complete).autocomplete({ q: "pa" }));
    expect(complete).toHaveBeenCalledTimes(1);

    const asked = fakeFetch(busy, empty);
    await make(asked).autocomplete({ q: "pa" }, { maxRetries: 1 });
    expect(asked).toHaveBeenCalledTimes(2);

    const geocode = fakeFetch(busy, empty);
    await make(geocode).geocode({ q: "pa" });
    expect(geocode).toHaveBeenCalledTimes(2);

    const multi = fakeFetch(busy, { body: { results: [] } });
    await make(multi).multiRevgeocode({ body: [{ id: "a", at: "1,2" }] });
    expect(multi).toHaveBeenCalledTimes(2);
  });

  it("never repeats the creation of a job or a notification, and repeats the other job calls", async () => {
    const create = fakeFetch(busy, { status: 201, body: fixture("job-created.json") });
    await failure(make(create).batch.create({ body: INPUT, serviceHrn: GEOCODE_HRN }));
    expect(create).toHaveBeenCalledTimes(1);

    const hook = fakeFetch(busy, { status: 201, body: HOOK });
    await failure(make(hook).batch.notifications.create({ config: HOOK.config }));
    expect(hook).toHaveBeenCalledTimes(1);

    for (const call of [
      (c: HereClient) => c.batch.start({ jobId: JOB }),
      (c: HereClient) => c.batch.stop({ jobId: JOB }),
      (c: HereClient) => c.batch.status({ jobId: JOB }),
      (c: HereClient) => c.batch.delete({ jobId: JOB }),
    ]) {
      const fetch = fakeFetch(busy, { body: fixture("job-created.json") });
      await call(make(fetch));
      expect(fetch).toHaveBeenCalledTimes(2);
    }
  });

  it("encodes an ID that goes in the path", async () => {
    const fetch = fakeFetch({ body: fixture("job-completed.json") });
    await make(fetch).batch.status({ jobId: "JOB a/b?c" });
    expect(String(fetch.mock.calls[0]![0])).toContain("/v7/batch/jobs/JOB%20a%2Fb%3Fc");
  });
});

describe("here credentials", () => {
  it("throws without an og server and without HERE's credentials", () => {
    let thrown: unknown;
    try {
      here({});
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GeocoderError);
    expect(thrown).toMatchObject({ code: "invalid_request", provider: "here" });
  });

  it("says which API it speaks and which server answers", () => {
    expect(here({ apiKey: KEY })).toMatchObject({ shape: "here", server: "here" });
    expect(here({ baseUrl: OG })).toMatchObject({ shape: "here", server: "og" });
    expect(here({ baseUrl: OG, apiKey: KEY })).toMatchObject({ shape: "here", server: "og" });
  });

  it("sends a bearer token to HERE in place of the key", async () => {
    const fetch = fakeFetch({ body: { items: [] } });
    await here({ apiKey: KEY, bearerToken: "token-1", fetch }).geocode({ q: "x" });
    expect(headersOf(fetch)["authorization"]).toBe("Bearer token-1");
    expect(urlOf(fetch).searchParams.has("apiKey")).toBe(false);
  });

  it("asks a token function again for every request", async () => {
    const fetch = fakeFetch({ body: { items: [] } });
    let issued = 0;
    const client = here({ bearerToken: async () => `token-${++issued}`, fetch });
    await client.geocode({ q: "x" });
    await client.batch.status({ jobId: JOB });
    expect(headersOf(fetch, 0)["authorization"]).toBe("Bearer token-1");
    expect(headersOf(fetch, 1)["authorization"]).toBe("Bearer token-2");
  });

  it("sends og neither the key nor the token", async () => {
    const fetch = fakeFetch({ body: { items: [] } });
    const token = vi.fn(() => "token-never-sent");
    const client = here({ baseUrl: OG, apiKey: KEY, bearerToken: token, fetch });
    await client.geocode({ q: "x" });
    await client.batch.status({ jobId: JOB });
    expect(token).not.toHaveBeenCalled();
    for (const index of [0, 1]) {
      const sent = `${String(fetch.mock.calls[index]![0])} ${JSON.stringify(headersOf(fetch, index))}`;
      expect(sent).not.toContain(KEY);
      expect(sent).not.toContain("token-never-sent");
      expect(sent).not.toContain("apiKey");
      expect(headersOf(fetch, index)["authorization"]).toBeUndefined();
    }
  });

  it("sends the caller's own headers with a call", async () => {
    const fetch = fakeFetch({ body: { items: [] } });
    await here({ apiKey: KEY, fetch, headers: { "x-gateway": "g" } }).geocode(
      { q: "x" },
      { headers: { "X-Request-ID": "caller-id-1" } },
    );
    expect(headersOf(fetch)).toMatchObject({ "x-gateway": "g", "x-request-id": "caller-id-1" });
  });
});

describe("here errors", () => {
  it("maps a refused parameter of Geocoding and Search", async () => {
    const body = fixture("error-400.json");
    const fetch = fakeFetch({
      status: 400,
      body,
      headers: { "x-correlation-id": "6d1e0b47-93c2-4fa8-b750-2e8a41c9d3f6" },
    });
    const error = await failure(asking(fetch).geocode({ q: "x", lang: ["xx_yy", "q"] }));
    expect(error).toMatchObject({
      code: "invalid_request",
      status: 400,
      provider: "here",
      operation: "geocode",
      requestId: "6d1e0b47-93c2-4fa8-b750-2e8a41c9d3f6",
      retryable: false,
    });
    // The title, the cause and the action make one message.
    expect(error.message).toBe(
      "Parameter 'lang' could not be read. Received value: 'xx_yy,q'. Send one BCP 47 language tag, such as 'en-GB'.",
    );
    expect(error.body).toEqual(body);
    expect(error.cause).toBeInstanceOf(BadRequestError);
    expect(error.cause).toMatchObject({ status: 400, body, provider: "here" });
    expect((error.cause as BadRequestError).headers?.get("x-correlation-id")).toBe(
      "6d1e0b47-93c2-4fa8-b750-2e8a41c9d3f6",
    );
  });

  it("maps missing credentials of the Batch API", async () => {
    const body = fixture("batch-401.json");
    const error = await failure(
      asking(fakeFetch({ status: 401, body })).batch.status({ jobId: JOB }),
    );
    expect(error).toMatchObject({
      code: "unauthenticated",
      status: 401,
      provider: "here",
      operation: "batch.status",
      message: "The request carried no credentials",
    });
    expect(error.cause).toBeInstanceOf(AuthenticationError);
  });

  it("maps a job that does not exist", async () => {
    const body = fixture("batch-404.json");
    const fetch = fakeFetch({
      status: 404,
      body,
      headers: { "x-request-id": "echoed-id", "x-correlation-id": "b28f5c10" },
    });
    const error = await failure(asking(fetch).batch.results({ jobId: JOB }));
    expect(error).toMatchObject({
      code: "not_found",
      status: 404,
      provider: "here",
      operation: "batch.results",
      message:
        "Unknown job. No job exists under the ID in the path. Check the job ID, then send the request again.",
    });
    expect(error.cause).toBeInstanceOf(NotFoundError);
    expect(error.body).toEqual(body);
    // HERE only echoes the caller's `x-request-id`, so its own correlation ID wins.
    expect(error.requestId).toBe("b28f5c10");
  });

  it("reads an input over the size limit, which the Batch API answers 400 for", async () => {
    const body = {
      title: "Input too large",
      status: 400,
      code: "E6004003",
      cause: "The input is larger than a job may take",
      action: "Split the input over several jobs",
      correlationId: "0f3a6c81-5d27-4b9e-a104-7e2c9b8d6f35",
    };
    const error = await failure(
      asking(fakeFetch({ status: 400, body })).batch.create({
        body: INPUT,
        serviceHrn: GEOCODE_HRN,
      }),
    );
    expect(error).toMatchObject({ code: "payload_too_large", status: 400, provider: "here" });
  });

  it("maps a rate limit and a failure of HERE as worth another try", async () => {
    const limited = await failure(
      asking(
        fakeFetch({ status: 429, body: { status: 429, title: "Rate limit exceeded" } }),
      ).lookup({ id: "here:x" }, { maxRetries: 0 }),
    );
    expect(limited).toMatchObject({ code: "rate_limited", status: 429, retryable: true });

    const broken = await failure(
      asking(fakeFetch({ status: 500, body: "<html>oops</html>" })).discover(
        { q: "x", at: "1,2" },
        { maxRetries: 0 },
      ),
    );
    expect(broken).toMatchObject({
      code: "provider_error",
      status: 500,
      body: "<html>oops</html>",
    });
    expect(broken.cause).toBeInstanceOf(InternalServerError);
  });

  it("maps an endpoint og does not serve to unsupported", async () => {
    const body = {
      status: 501,
      title: "Not Implemented",
      cause: "This server does not serve /compat/here/v1/browse",
      correlationId: "c0c75000",
      requestId: "c0c75000",
    };
    const fetch = fakeFetch({ status: 501, body, headers: { "x-request-id": "c0c75000" } });
    const error = await failure(asking(fetch, OG).browse({ at: "1,2" }, { maxRetries: 0 }));
    expect(error).toMatchObject({
      code: "unsupported",
      status: 501,
      provider: "og",
      operation: "browse",
      requestId: "c0c75000",
    });
    expect(error.body).toEqual(body);
  });

  it("fails with provider_error for an answer that is not JSON", async () => {
    const error = await failure(asking(fakeFetch({ body: "not json" })).geocode({ q: "x" }));
    expect(error).toMatchObject({ code: "provider_error", provider: "here", operation: "geocode" });
  });
});

describe("here cache rule", () => {
  it("keeps an answer of HERE that says nothing for 30 days", async () => {
    const outcome = await rule({});
    expect(outcome.server).toBe("here");
    expect(outcome.cache).toEqual({ maxTtl: 30 * DAY });
    expect(outcome.data).toEqual(fixture("geocode.json"));
    expect(outcome.response?.status).toBe(200);
  });

  it.each([
    ["no-store", "no-store"],
    ["no-cache", "no-cache, max-age=600"],
    ["private", "private, max-age=600"],
    ["no-cache with a field name", 'no-cache="set-cookie", max-age=600'],
    ["upper case", "No-Store"],
  ])("keeps nothing under %s", async (_, control) => {
    expect((await rule({ "cache-control": control })).cache).toEqual({ maxTtl: 0 });
  });

  it("keeps an answer for its max-age, less the age it arrives with", async () => {
    expect((await rule({ "cache-control": "public, max-age=3600" })).cache).toEqual({
      maxTtl: 3_600_000,
    });
    expect((await rule({ "cache-control": "max-age=3600", age: "600" })).cache).toEqual({
      maxTtl: 3_000_000,
    });
    expect((await rule({ "cache-control": "max-age=60", age: "600" })).cache).toEqual({
      maxTtl: 0,
    });
    expect((await rule({ "cache-control": "max-age=0" })).cache).toEqual({ maxTtl: 0 });
    expect((await rule({ "cache-control": "max-age=soon" })).cache).toEqual({ maxTtl: 0 });
  });

  it("never keeps an answer longer than 30 days", async () => {
    expect((await rule({ "cache-control": "max-age=31536000" })).cache).toEqual({
      maxTtl: 30 * DAY,
    });
    expect(
      (
        await rule({
          date: "Wed, 04 Mar 2026 10:00:00 GMT",
          expires: "Thu, 04 Mar 2027 10:00:00 GMT",
        })
      ).cache,
    ).toEqual({ maxTtl: 30 * DAY });
  });

  it("reads Expires where there is no max-age", async () => {
    expect(
      (
        await rule({
          date: "Wed, 04 Mar 2026 10:00:00 GMT",
          expires: "Wed, 04 Mar 2026 10:05:00 GMT",
        })
      ).cache,
    ).toEqual({ maxTtl: 300_000 });
    // max-age wins over Expires.
    expect(
      (
        await rule({
          "cache-control": "max-age=10",
          date: "Wed, 04 Mar 2026 10:00:00 GMT",
          expires: "Wed, 04 Mar 2026 10:05:00 GMT",
        })
      ).cache,
    ).toEqual({ maxTtl: 10_000 });
    expect((await rule({ expires: "Wed, 04 Mar 2020 10:00:00 GMT" })).cache).toEqual({ maxTtl: 0 });
    expect((await rule({ expires: "0" })).cache).toEqual({ maxTtl: 0 });

    const ahead = new Date(Date.now() + 120_000).toUTCString();
    const { maxTtl } = (await rule({ expires: ahead })).cache;
    expect(maxTtl).toBeGreaterThan(110_000);
    expect(maxTtl).toBeLessThanOrEqual(120_000);
  });

  it("keeps an answer of og without limit, whatever its headers say", async () => {
    const outcome = await rule({ "cache-control": "no-store" }, OG);
    expect(outcome.server).toBe("og");
    expect(outcome.cache).toEqual({ maxTtl: Infinity });
  });

  it("applies the rule to every lookup and to no job call", async () => {
    const headers = { "cache-control": "max-age=120" };
    const lookups: ((client: HereClient) => { withResponse(): Promise<Outcome> })[] = [
      (c) => c.revgeocode({ at: "1,2" }),
      (c) => c.multiRevgeocode({ body: [{ id: "a", at: "1,2" }] }),
      (c) => c.autosuggest({ q: "x", at: "1,2" }),
      (c) => c.autocomplete({ q: "x" }),
      (c) => c.discover({ q: "x", at: "1,2" }),
      (c) => c.lookup({ id: "here:x" }),
      (c) => c.browse({ at: "1,2" }),
    ];
    for (const call of lookups) {
      const client = here({ apiKey: KEY, fetch: fakeFetch({ body: { items: [] }, headers }) });
      expect((await call(client).withResponse()).cache).toEqual({ maxTtl: 120_000 });
    }

    const jobs: ((client: HereClient) => { withResponse(): Promise<Outcome> })[] = [
      (c) => c.batch.status({ jobId: JOB }),
      (c) => c.batch.list(),
      (c) => c.batch.results({ jobId: JOB }),
      (c) => c.batch.health(),
    ];
    for (const call of jobs) {
      const client = here({ apiKey: KEY, fetch: fakeFetch({ body: {}, headers }) });
      const outcome = await call(client).withResponse();
      expect(outcome.cache).toEqual({ maxTtl: 0 });
      expect(outcome.server).toBe("here");
    }
  });

  it("gives the request ID with the answer", async () => {
    const outcome = await rule({ "x-correlation-id": "9c1d4e77-2b60-4f3a-8e15-a7d0c6b2f984" });
    expect(outcome.requestId).toBe("9c1d4e77-2b60-4f3a-8e15-a7d0c6b2f984");
  });
});

describe("here plugins", () => {
  it("gives a plugin the points of each answer, in order", async () => {
    const { plugin, seen } = watcher();
    const fetch = fakeFetch(
      { body: fixture("geocode.json") },
      { body: fixture("revgeocode.json") },
      { body: fixture("autosuggest.json") },
      { body: fixture("discover.json") },
      { body: BROWSE },
      { body: fixture("lookup.json") },
      { body: MULTI },
      { body: fixture("autocomplete.json") },
    );
    const client = here({ apiKey: KEY, fetch, plugins: [plugin] });
    await client.geocode({ q: "x" });
    await client.revgeocode({ at: "1,2" });
    await client.autosuggest({ q: "x", at: "1,2" });
    await client.discover({ q: "x", at: "1,2" });
    await client.browse({ at: "1,2" });
    await client.lookup({ id: "here:x" });
    await client.multiRevgeocode({ body: [{ id: "first", at: "1,2" }] });
    await client.autocomplete({ q: "x" });

    const points = Object.fromEntries(seen.map((call) => [call.method, call.points]));
    expect(seen.map((call) => call.method)).toEqual([
      "geocode",
      "revgeocode",
      "autosuggest",
      "discover",
      "browse",
      "lookup",
      "multiRevgeocode",
      "autocomplete",
    ]);
    expect(points["geocode"]).toEqual([{ lat: -37.48216, lon: 144.90537 }]);
    expect(points["revgeocode"]).toEqual([{ lat: 60.41273, lon: 5.30846 }]);
    // The query items of autosuggest carry no position and are left out.
    expect(points["autosuggest"]).toEqual([
      { lat: 35.46877, lon: -97.60391 },
      { lat: 35.50942, lon: -97.61588 },
      { lat: 35.47604, lon: -97.58817 },
    ]);
    expect(points["discover"]?.[0]).toEqual({ lat: 44.61382, lon: -122.90417 });
    expect(points["browse"]).toEqual([{ lat: 52.18377, lon: 5.90489 }]);
    expect(points["lookup"]).toEqual([{ lat: 52.18342, lon: 5.90417 }]);
    // The first result of each sub-request. A failed one and an empty one are left out.
    expect(points["multiRevgeocode"]).toEqual([
      { lat: 52.18401, lon: 5.90522 },
      { lat: 52.18342, lon: 5.90417 },
    ]);
    expect(points["autocomplete"]).toEqual([]);
  });

  it("keeps every job call away from the plugins", async () => {
    const { plugin, seen } = watcher();
    const client = here({ apiKey: KEY, fetch: fakeFetch({ body: {} }), plugins: [plugin] });
    await client.batch.create({ body: INPUT, serviceHrn: GEOCODE_HRN });
    await client.batch.list();
    await client.batch.status({ jobId: JOB });
    await client.batch.start({ jobId: JOB });
    await client.batch.stop({ jobId: JOB });
    await client.batch.results({ jobId: JOB });
    await client.batch.errors({ jobId: JOB });
    await client.batch.delete({ jobId: JOB });
    await client.batch.deleteMany({ status: "any" });
    await client.batch.notifications.list();
    await client.batch.version();
    await client.batch.health();
    expect(seen).toEqual([]);
  });

  it("lets a plugin run the same call on another here client", async () => {
    const backupFetch = fakeFetch({ body: MULTI });
    const backup = here({ baseUrl: OG, fetch: backupFetch });
    const failover: Plugin = {
      name: "failover",
      handle: (call, next) => next().catch(() => call.run(backup)),
    };
    const fetch = fakeFetch({ status: 500, body: {} });
    const client = here({ apiKey: KEY, fetch, plugins: [failover], logLevel: "off" });
    const body = [{ id: "first", at: "52.184,5.9052" }];
    const outcome = await client
      .multiRevgeocode({ body, lang: ["nl"] }, { maxRetries: 0 })
      .withResponse();

    expect(outcome.server).toBe("og");
    expect(outcome.data).toEqual(MULTI);
    expect(urlOf(backupFetch).pathname).toBe("/compat/here/v1/multi-revgeocode");
    expect(urlOf(backupFetch).searchParams.get("lang")).toBe("nl");
    expect(backupFetch.mock.calls[0]![1]!.body).toBe("id=first&at=52.184,5.9052");
  });

  it("lets a plugin answer without a request", async () => {
    const cached: Plugin = {
      name: "cached",
      handle: async () => ({
        data: fixture("lookup.json"),
        response: undefined,
        requestId: undefined,
        server: "here",
        cache: { maxTtl: 0 },
      }),
    };
    const fetch = fakeFetch({ body: {} });
    const client = here({ apiKey: KEY, fetch, plugins: [cached] });
    await expect(client.lookup({ id: "here:x" })).resolves.toEqual(fixture("lookup.json"));
    expect(fetch).not.toHaveBeenCalled();
  });
});
