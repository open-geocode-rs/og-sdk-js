/// <reference types="node" />
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GeocoderError } from "../src/errors.ts";
import { google } from "../src/providers/google/index.ts";
import { here, type JobDetailResponse } from "../src/providers/here/index.ts";
import { mapbox } from "../src/providers/mapbox/index.ts";
import { jobIdOf, precisely } from "../src/providers/precisely/index.ts";

const SERVERS = process.env["OG_URL"] ? [process.env["OG_URL"]] : [];

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const ROOT = resolve(SRC, "../../..");

/** What a test Pack holds, found by asking og where it has an address. */
interface Facts {
  /** The Pack it is. */
  name: string;
  /** A point og has an address at. */
  lat: number;
  lon: number;
  /** A word that names a POI of the Pack. */
  poi: string;
  /** The ISO 3166-1 alpha-3 code of its country. */
  iso3: string;
  /** Read from og's own answer at the point. */
  address: string;
  label: string;
  town: string;
  iso2: string;
}

/**
 * The Packs these tests know, each with a point og holds an address at.
 * The first one og answers an address for is the Pack it serves.
 */
const PACKS = [
  { name: "Monaco", lat: 43.7377547, lon: 7.4270688, poi: "casino", iso3: "MCO" },
] as const;

/** A category every known Pack has POIs of, in each vendor's words. */
const RESTAURANT = { google: "restaurant", mapbox: "restaurant", here: "100-1000" } as const;

const HERE_GEOCODE = "hrn:here:service::olp-here:search-geocode-7";

async function probe(base: string): Promise<Facts> {
  for (const pack of PACKS) {
    const url = `${base}/reverse?lon=${pack.lon}&lat=${pack.lat}&layer=address&limit=1`;
    const body = (await (await fetch(url)).json()) as {
      features: {
        geometry: { coordinates: [number, number] };
        properties: {
          name: string;
          label: string;
          context: { locality?: { name: string }; country?: { code?: string } };
        };
      }[];
    };
    const feature = body.features[0];
    if (feature === undefined) continue;
    const [lon, lat] = feature.geometry.coordinates;
    return {
      ...pack,
      lat,
      lon,
      address: feature.properties.name,
      label: feature.properties.label,
      town: feature.properties.context.locality?.name ?? "",
      iso2: feature.properties.context.country?.code ?? "",
    };
  }
  throw new Error(`og at ${base} holds none of the test Packs: ${PACKS.map((p) => p.name)}`);
}

/** One answer og gave, and the type the SDK declares for it. */
interface Answer {
  method: string;
  type: string;
  data: unknown;
}

/**
 * The answers as a TypeScript file, each a fresh literal that `satisfies` its declared type,
 * so a key the type lacks fails as surely as a required key og left out.
 */
function program(answers: readonly Answer[]): string {
  const lines = [
    `import type { APIPromise } from ${JSON.stringify(join(SRC, "core.ts"))};`,
    `import type { GoogleClient } from ${JSON.stringify(join(SRC, "providers/google/index.ts"))};`,
    `import type { MapboxClient } from ${JSON.stringify(join(SRC, "providers/mapbox/index.ts"))};`,
    `import type { HereClient } from ${JSON.stringify(join(SRC, "providers/here/index.ts"))};`,
    `import type { PreciselyClient } from ${JSON.stringify(join(SRC, "providers/precisely/index.ts"))};`,
    "type Answer<F> = F extends (...args: never[]) => APIPromise<infer T> ? T : never;",
  ];
  answers.forEach((answer, index) => {
    const literal = answer.data === undefined ? "undefined" : JSON.stringify(answer.data, null, 2);
    lines.push(`// ${answer.method}`);
    lines.push(`const answer${index} = ${literal} satisfies Answer<${answer.type}>;`);
  });
  return `${lines.join("\n")}\n`;
}

/** The compiler's complaints about `file`, each named by the method whose answer it is in. */
function diagnostics(file: string, source: string): string[] {
  const config = ts.readConfigFile(join(ROOT, "tsconfig.base.json"), ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT);
  const compiled = ts.createProgram([file], {
    ...options,
    noEmit: true,
    types: [],
    isolatedDeclarations: false,
    declaration: false,
  });
  const lines = source.split("\n");
  return ts.getPreEmitDiagnostics(compiled).map((diagnostic) => {
    const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    if (diagnostic.file === undefined || diagnostic.start === undefined) return text;
    const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    let at = line;
    while (at > 0 && !lines[at]!.startsWith("// ")) at--;
    const where =
      diagnostic.file.fileName === file ? lines[at]!.slice(3) : diagnostic.file.fileName;
    return `${where} (line ${line + 1}): ${text}`;
  });
}

/** The declared answer type of one method of `client`, as the checked file writes it. */
const answerType =
  (client: string) =>
  (method: string): string =>
    `${client}${method}`;

const hasFeatures = (data: { features: unknown[] }): boolean => data.features.length > 0;
const hasItems = (data: { items: unknown[] }): boolean => data.items.length > 0;
const predicted = (data: { response: { predictions?: unknown[] } }): boolean =>
  (data.response.predictions?.length ?? 0) > 0;

/** Whether a call failed with the HTTP status given, as og refuses what it cannot do. */
async function refused(call: PromiseLike<unknown>): Promise<number | undefined> {
  const outcome = await Promise.resolve(call).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(outcome).toBeInstanceOf(GeocoderError);
  return (outcome as GeocoderError).status;
}

// These run against a real og server and check its answers against the SDK's declared types.
// With no server the suite is listed as skipped, so the file still holds one.
describe.runIf(SERVERS.length > 0).each(SERVERS.length > 0 ? SERVERS : ["no og server"])(
  "every /compat answer of og at %s fits the SDK's vendor types",
  (base) => {
    const answers: Answer[] = [];
    let facts: Facts;
    const hookCalls: string[] = [];
    const hookServer = createServer((request, response) => {
      hookCalls.push(request.url ?? "");
      response.writeHead(200).end();
    });
    let hookUrl = "";

    beforeAll(async () => {
      facts = await probe(base);
      await new Promise<void>((done) => hookServer.listen(0, "127.0.0.1", done));
      hookUrl = `http://127.0.0.1:${(hookServer.address() as AddressInfo).port}`;
    });
    afterAll(() => {
      hookServer.close();
    });

    /** Keeps an answer for the type check, once `filled` says it holds something. */
    const keep = async <T>(
      method: string,
      type: string,
      call: PromiseLike<T>,
      filled: (data: T) => boolean = () => true,
    ): Promise<T> => {
      const data = await call;
      expect(filled(data), `${method} answered nothing to check`).toBe(true);
      answers.push({ method, type, data });
      return data;
    };

    const opts = { logLevel: "off" } as const;
    const point = () => ({ latitude: facts.lat, longitude: facts.lon });

    it("google", async () => {
      const client = google({ baseUrl: base, ...opts });
      const t = answerType("GoogleClient");
      const text = await keep(
        "google places.searchText address",
        t(`["places"]["searchText"]`),
        client.places.searchText({ textQuery: facts.label, fieldMask: ["*"] }),
        (data) => (data.places?.length ?? 0) > 0,
      );
      const pois = await keep(
        "google places.searchText poi",
        t(`["places"]["searchText"]`),
        client.places.searchText({ textQuery: facts.poi, fieldMask: ["*"], pageSize: 5 }),
        (data) => (data.places?.length ?? 0) > 0,
      );
      await keep(
        "google places.autocomplete",
        t(`["places"]["autocomplete"]`),
        client.places.autocomplete({ input: facts.poi.slice(0, 4) }),
        (data) => (data.suggestions?.length ?? 0) > 0,
      );
      await keep(
        "google places.autocomplete address",
        t(`["places"]["autocomplete"]`),
        client.places.autocomplete({ input: facts.address }),
        (data) => (data.suggestions?.length ?? 0) > 0,
      );
      for (const place of [text.places![0]!, pois.places![0]!])
        await keep(
          "google places.get",
          t(`["places"]["get"]`),
          client.places.get({ name: `places/${place.id}`, fieldMask: ["*"] }),
        );
      await keep(
        "google places.searchNearby",
        t(`["places"]["searchNearby"]`),
        client.places.searchNearby({
          fieldMask: ["*"],
          includedTypes: [RESTAURANT.google],
          maxResultCount: 5,
          locationRestriction: { circle: { center: point(), radius: 2000 } },
        }),
        (data) => (data.places?.length ?? 0) > 0,
      );
      const geocoded = await keep(
        "google geocode.address",
        t(`["geocode"]["address"]`),
        client.geocode.address({ addressQuery: facts.label }),
        (data) => (data.results?.length ?? 0) > 0,
      );
      await keep(
        "google geocode.address town",
        t(`["geocode"]["address"]`),
        client.geocode.address({ addressQuery: facts.town }),
        (data) => (data.results?.length ?? 0) > 0,
      );
      await keep(
        "google geocode.address parts",
        t(`["geocode"]["address"]`),
        client.geocode.address({
          address: { addressLines: [facts.address], locality: facts.town, regionCode: facts.iso2 },
        }),
        (data) => (data.results?.length ?? 0) > 0,
      );
      await keep(
        "google geocode.location",
        t(`["geocode"]["location"]`),
        client.geocode.location({ locationQuery: `${facts.lat},${facts.lon}` }),
        (data) => (data.results?.length ?? 0) > 0,
      );
      await keep(
        "google geocode.place",
        t(`["geocode"]["place"]`),
        client.geocode.place({ place: `places/${geocoded.results![0]!.placeId}` }),
      );
      await keep(
        "google geocode.destinations address",
        t(`["geocode"]["destinations"]`),
        client.geocode.destinations({ addressQuery: { addressQuery: facts.label } }),
        (data) => (data.destinations?.length ?? 0) > 0,
      );
      await keep(
        "google geocode.destinations point",
        t(`["geocode"]["destinations"]`),
        client.geocode.destinations({ locationQuery: { location: point() } }),
        (data) => (data.destinations?.length ?? 0) > 0,
      );
      // og holds no photos, so no photo name can be asked for.
      expect(
        await refused(
          client.places.getPhotoMedia({
            name: `places/${pois.places![0]!.id}/photos/none/media`,
            maxWidthPx: 100,
          }),
        ),
      ).toBe(400);
    }, 120_000);

    it("mapbox", async () => {
      const client = mapbox({ baseUrl: base, ...opts });
      const t = answerType("MapboxClient");
      const has = hasFeatures;
      await keep(
        "mapbox geocoding.forward",
        t(`["geocoding"]["forward"]`),
        client.geocoding.forward({ q: facts.label, limit: 3 }),
        has,
      );
      await keep(
        "mapbox geocoding.forward town",
        t(`["geocoding"]["forward"]`),
        client.geocoding.forward({ q: facts.town, limit: 3 }),
        has,
      );
      await keep(
        "mapbox geocoding.forward parts",
        t(`["geocoding"]["forward"]`),
        client.geocoding.forward({
          address_line1: facts.address,
          place: facts.town,
          country: facts.iso2.toLowerCase(),
        }),
        has,
      );
      await keep(
        "mapbox geocoding.reverse",
        t(`["geocoding"]["reverse"]`),
        client.geocoding.reverse({ longitude: facts.lon, latitude: facts.lat }),
        has,
      );
      await keep(
        "mapbox geocoding.batch",
        t(`["geocoding"]["batch"]`),
        client.geocoding.batch({
          queries: [
            { q: facts.label, limit: 1 },
            { longitude: facts.lon, latitude: facts.lat, types: "address" },
            { q: "zzzzqqqq xxyyzz" },
          ],
        }),
        (data) => data.batch.length === 3,
      );
      const session_token = "types-check";
      for (const q of [facts.poi, facts.address]) {
        const suggested = await keep(
          "mapbox searchbox.suggest",
          t(`["searchbox"]["suggest"]`),
          client.searchbox.suggest({ q, session_token, limit: 5 }),
          (data) => data.suggestions.length > 0,
        );
        await keep(
          "mapbox searchbox.retrieve",
          t(`["searchbox"]["retrieve"]`),
          client.searchbox.retrieve({ id: suggested.suggestions[0]!.mapbox_id, session_token }),
          has,
        );
      }
      await keep(
        "mapbox searchbox.forward",
        t(`["searchbox"]["forward"]`),
        client.searchbox.forward({ q: facts.town, limit: 5 }),
        has,
      );
      await keep(
        "mapbox searchbox.reverse",
        t(`["searchbox"]["reverse"]`),
        client.searchbox.reverse({ longitude: facts.lon, latitude: facts.lat }),
        has,
      );
      await keep(
        "mapbox searchbox.category",
        t(`["searchbox"]["category"]`),
        client.searchbox.category({
          canonical_category_id: RESTAURANT.mapbox,
          proximity: [facts.lon, facts.lat],
          limit: 5,
        }),
        has,
      );
      await keep(
        "mapbox searchbox.listCategories",
        t(`["searchbox"]["listCategories"]`),
        client.searchbox.listCategories(),
        (data) => data.listItems.length > 0,
      );
    }, 120_000);

    it("here", async () => {
      const client = here({ baseUrl: base, ...opts });
      const t = answerType("HereClient");
      const at = `${facts.lat},${facts.lon}`;
      const has = hasItems;
      await keep("here geocode", t(`["geocode"]`), client.geocode({ q: facts.label }), has);
      await keep("here geocode town", t(`["geocode"]`), client.geocode({ q: facts.town }), has);
      await keep(
        "here geocode qq",
        t(`["geocode"]`),
        client.geocode({ qq: { street: facts.address, city: facts.town } }),
        has,
      );
      await keep("here revgeocode", t(`["revgeocode"]`), client.revgeocode({ at }), has);
      await keep(
        "here multiRevgeocode",
        t(`["multiRevgeocode"]`),
        client.multiRevgeocode({ body: `id=one&at=${at}` }),
        (data) => data.results.length > 0,
      );
      const suggested = await keep(
        "here autosuggest",
        t(`["autosuggest"]`),
        client.autosuggest({ q: facts.poi, at, limit: 5 }),
        has,
      );
      await keep(
        "here autosuggest address",
        t(`["autosuggest"]`),
        client.autosuggest({ q: facts.address, at, limit: 5 }),
        has,
      );
      await keep(
        "here autocomplete",
        t(`["autocomplete"]`),
        client.autocomplete({ q: facts.address.slice(0, -2), limit: 5 }),
        has,
      );
      const found = await keep(
        "here discover",
        t(`["discover"]`),
        client.discover({ q: facts.poi, at, limit: 5 }),
        has,
      );
      const ids = [found.items[0]!.id];
      // A search offered (`categoryQuery`, `chainQuery`) has no id to look up.
      const first = suggested.items.find(
        (item) => "position" in item && "id" in item && typeof item.id === "string",
      );
      if (first !== undefined && "id" in first) ids.push(first.id as string);
      for (const id of ids) await keep("here lookup", t(`["lookup"]`), client.lookup({ id }));
      await keep(
        "here browse",
        t(`["browse"]`),
        client.browse({ at, categories: [RESTAURANT.here], limit: 5 }),
        has,
      );
      // og keeps no record of what users did with results, so it has no signals route.
      expect(
        await refused(
          client.signals({
            body: "version=1&action=here:gs:action:view&resultId=none&correlationId=none",
          }),
        ),
      ).toBe(404);
      // Only HERE writes HERE's OpenAPI document.
      expect(await refused(client.batch.openapi())).toBe(404);

      await keep("here batch.version", t(`["batch"]["version"]`), client.batch.version());
      await keep("here batch.health", t(`["batch"]["health"]`), client.batch.health());

      const notification = await keep(
        "here batch.notifications.create",
        t(`["batch"]["notifications"]["create"]`),
        client.batch.notifications.create({ type: "webHook", config: { url: `${hookUrl}/done` } }),
      );
      const notificationId = notification.id;
      await keep(
        "here batch.notifications.get",
        t(`["batch"]["notifications"]["get"]`),
        client.batch.notifications.get({ notificationId }),
      );
      await keep(
        "here batch.notifications.list",
        t(`["batch"]["notifications"]["list"]`),
        client.batch.notifications.list(),
      );
      await keep(
        "here batch.notifications.update",
        t(`["batch"]["notifications"]["update"]`),
        client.batch.notifications.update({
          notificationId,
          config: { url: `${hookUrl}/again` },
        }),
      );
      await keep(
        "here batch.notifications.test",
        t(`["batch"]["notifications"]["test"]`),
        client.batch.notifications.test({ notificationId }),
      );

      const tag = `types-${Date.now()}`;
      const created = await keep(
        "here batch.create",
        t(`["batch"]["create"]`),
        client.batch.create({
          body: `recId|q\none|${facts.label}\n`,
          serviceHrn: HERE_GEOCODE,
          outputType: "jsonl",
          startJob: false,
          tag,
          notificationIds: [notificationId],
        }),
      );
      const jobId = created.id;
      await keep("here batch.status", t(`["batch"]["status"]`), client.batch.status({ jobId }));
      await keep("here batch.start", t(`["batch"]["start"]`), client.batch.start({ jobId }));
      let done: JobDetailResponse = await client.batch.status({ jobId });
      for (let tries = 0; tries < 150 && !["completed", "failed"].includes(done.status); tries++) {
        await new Promise((wait) => setTimeout(wait, 100));
        done = await client.batch.status({ jobId });
      }
      expect(done.status).toBe("completed");
      answers.push({
        method: "here batch.status ended",
        type: t(`["batch"]["status"]`),
        data: done,
      });
      await keep(
        "here batch.results",
        t(`["batch"]["results"]`),
        client.batch.results({ jobId }),
        (data) => data !== "",
      );
      await keep("here batch.errors", t(`["batch"]["errors"]`), client.batch.errors({ jobId }));
      await keep(
        "here batch.list",
        t(`["batch"]["list"]`),
        client.batch.list({ tag }),
        (data) => (data.items?.length ?? 0) > 0,
      );
      await keep("here batch.stop", t(`["batch"]["stop"]`), client.batch.stop({ jobId }));
      await keep("here batch.delete", t(`["batch"]["delete"]`), client.batch.delete({ jobId }));
      await keep(
        "here batch.deleteMany",
        t(`["batch"]["deleteMany"]`),
        client.batch.deleteMany({ status: "any", tag }),
      );
      await keep(
        "here batch.notifications.delete",
        t(`["batch"]["notifications"]["delete"]`),
        client.batch.notifications.delete({ notificationId }),
      );
    }, 120_000);

    it("precisely", async () => {
      const client = precisely({ baseUrl: base, ...opts });
      const t = answerType("PreciselyClient");
      const country = facts.iso3;
      type Responses = { responses: { results?: unknown[] }[] };
      const results = (data: Responses) => (data.responses[0]?.results?.length ?? 0) > 0;
      const geocoded = await keep(
        "precisely geocode",
        t(`["geocode"]`),
        client.geocode({
          addresses: [{ addressLines: [facts.address], city: facts.town, country }],
        }),
        results,
      );
      await keep(
        "precisely geocode one line",
        t(`["geocode"]`),
        client.geocode({ addresses: [{ addressLines: [facts.label], country }] }),
        results,
      );
      await keep(
        "precisely reverseGeocode",
        t(`["reverseGeocode"]`),
        client.reverseGeocode({
          locations: [{ longitude: facts.lon, latitude: facts.lat, country: facts.iso2 }],
        }),
        results,
      );
      const key = geocoded.responses[0]!.results![0]!.customFields?.["PB_KEY"] ?? "";
      await keep(
        "precisely lookup",
        t(`["lookup"]`),
        client.lookup({ keys: [{ key, type: "PB_KEY", country: facts.iso2 }] }),
        results,
      );
      const verified = await keep(
        "precisely verify",
        t(`["verify"]`),
        client.verify({
          addresses: [{ addressLines: [facts.address], city: facts.town, country }],
        }),
        results,
      );
      const typed = { address: { addressLines: [facts.address.slice(0, -2)], country } };
      await keep(
        "precisely autocomplete",
        t(`["autocomplete"]`),
        client.autocomplete(typed),
        predicted,
      );
      await keep(
        "precisely expressAutocomplete",
        t(`["expressAutocomplete"]`),
        client.expressAutocomplete(typed),
        predicted,
      );
      await keep(
        "precisely expressAutocompleteV2",
        t(`["expressAutocompleteV2"]`),
        client.expressAutocompleteV2(typed),
        predicted,
      );
      await keep(
        "precisely autocompletePostalCity",
        t(`["autocompletePostalCity"]`),
        client.autocompletePostalCity({
          address: { type: "CITY", postAddress: facts.town.slice(0, 4), country: facts.iso2 },
        }),
        predicted,
      );
      await keep(
        "precisely proximitySearch",
        t(`["proximitySearch"]`),
        client.proximitySearch({
          preferences: { dataset: "osm", distance: { value: 200, distanceUnit: "METER" } },
          location: { latitude: facts.lat, longitude: facts.lon, country },
        }),
        (data) => (data.response.results?.length ?? 0) > 0,
      );
      // A Pack never calibrated rates no match, so its verify answer has no code to read back.
      const code =
        verified.responses[0]!.results![0]!.customFields?.["SIMPLE_MATCH_CODE"] ??
        "V4-P4S4A0T4R4Z4C4-4";
      await keep(
        "precisely explainAddressCode",
        t(`["explainAddressCode"]`),
        client.explainAddressCode({
          codeType: "GlobalMatchCode",
          codes: [{ id: "c1", code }],
          responseOptions: { includeOfficialDescription: true },
        }),
        (data) => data.responses.length > 0,
      );

      const run = async (product: "geocode" | "verify"): Promise<void> => {
        const uploadUrl = await keep(
          "precisely bulk.uploadUrl",
          t(`["bulk"]["uploadUrl"]`),
          client.bulk.uploadUrl({ fileName: `types_${product}_${Date.now()}` }),
        );
        const { fileId, url } = uploadUrl;
        await keep(
          "precisely bulk.upload",
          t(`["bulk"]["upload"]`),
          client.bulk.upload({
            url,
            content: `addressId,address,city,country\nrow-1,${facts.address},${facts.town},${country}\n`,
          }),
        );
        await keep("precisely bulk.files", t(`["bulk"]["files"]`), client.bulk.files());
        const submitted = await keep(
          `precisely bulk.${product}`,
          t(`["bulk"]["${product}"]`),
          client.bulk[product]({ fileId, delimiter: "," }),
        );
        const jobId = jobIdOf(submitted.statusUrl);
        await keep(
          "precisely bulk.jobs",
          t(`["bulk"]["jobs"]`),
          client.bulk.jobs({ status: "all" }),
        );
        let status = await client.bulk.status({ jobId });
        for (let tries = 0; status.status === "RUNNING" && tries < 150; tries++) {
          await new Promise((wait) => setTimeout(wait, 100));
          status = await client.bulk.status({ jobId });
        }
        expect(status.status).toBe("COMPLETED");
        answers.push({
          method: "precisely bulk.status",
          type: t(`["bulk"]["status"]`),
          data: status,
        });
        await keep(
          "precisely bulk.results",
          t(`["bulk"]["results"]`),
          client.bulk.results({ downloadUrl: status.downloadUrl! }),
          (data) => data.trim().split("\n").length === 2,
        );
        // og starts every job at once, so none is left to cancel.
        expect(await refused(client.bulk.cancel({ jobId }))).toBe(400);
        await keep(
          "precisely bulk.deleteFile",
          t(`["bulk"]["deleteFile"]`),
          client.bulk.deleteFile({ fileId }),
        );
      };
      await run("geocode");
      await run("verify");
    }, 120_000);

    it("type-checks every answer against its declared type", () => {
      expect(answers.length).toBeGreaterThan(60);
      const dir = mkdtempSync(join(tmpdir(), "og-types-"));
      try {
        const file = join(dir, "answers.ts");
        const source = program(answers);
        writeFileSync(file, source);
        // `OG_TYPES_OUT` keeps the checked file, to read what failed.
        const out = process.env["OG_TYPES_OUT"];
        if (out !== undefined) writeFileSync(out, source);
        expect(diagnostics(file, source)).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true });
      }
    }, 120_000);
  },
);
