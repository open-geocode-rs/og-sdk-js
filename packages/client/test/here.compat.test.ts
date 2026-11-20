/// <reference types="node" />
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import type { Plugin, Position } from "../src/base.ts";
import { GeocoderError, NotFoundError } from "../src/errors.ts";
import {
  type BatchJsonlRecord,
  type GeocodeResultItem,
  here,
  type JobDetailResponse,
} from "../src/here.ts";

const OG_URL = process.env["OG_URL"];

/** The address the Monaco test Pack is asked for, and the point it lies at. */
const ADDRESS = "2 Avenue de Monte-Carlo";
const TITLE = "2 Avenue de Monte-Carlo, Monaco, 98000, MC";
const POINT = { lat: 43.7377547, lng: 7.4270688 };
const AT = `${POINT.lat},${POINT.lng}`;
const CASINO = "Casino de Monte Carlo";

const GEOCODE_HRN = "hrn:here:service::olp-here:search-geocode-7";
const REVGEOCODE_HRN = "hrn:here:service::olp-here:search-revgeocode-7";

const failure = async (promise: PromiseLike<unknown>): Promise<GeocoderError> => {
  const thrown = await Promise.resolve(promise).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(thrown).toBeInstanceOf(GeocoderError);
  return thrown as GeocoderError;
};

/** A local endpoint og can call, which keeps the path and query of every call. */
const hook = async (): Promise<{ url: string; calls: string[]; close: () => void }> => {
  const calls: string[] = [];
  const server = createServer((request, response) => {
    calls.push(request.url ?? "");
    response.writeHead(200).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, calls, close: () => server.close() };
};

const called = async (calls: string[], count: number): Promise<string[]> => {
  for (let attempt = 0; attempt < 100 && calls.length < count; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  return calls;
};

// These run against a real og server, which answers HERE's API under /compat/here.
describe.runIf(OG_URL)("here against og", () => {
  // A key is given to show that og is asked without it and answers all the same.
  const client = here({ baseUrl: OG_URL, apiKey: "here-key-never-sent", logLevel: "off" });

  /** Asks for a job's status until it has ended. */
  const ended = async (jobId: string): Promise<JobDetailResponse> => {
    for (let attempt = 0; attempt < 150; attempt++) {
      const job = await client.batch.status({ jobId });
      if (["completed", "failure", "stopped", "deleted"].includes(job.status)) return job;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`Job ${jobId} did not end in time.`);
  };

  it("points at og", () => {
    expect(client).toMatchObject({ shape: "here", server: "og" });
  });

  describe("geocode", () => {
    it("finds an address by free text", async () => {
      const outcome = await client.geocode({ q: ADDRESS, limit: 1 }).withResponse();
      expect(outcome.server).toBe("og");
      expect(outcome.cache).toEqual({ maxTtl: Infinity });
      expect(outcome.requestId).toEqual(expect.any(String));
      expect(outcome.response?.url).toContain("/compat/here/v1/geocode?");
      expect(outcome.response?.url).not.toContain("apiKey");

      expect(outcome.data.items).toHaveLength(1);
      const item = outcome.data.items[0]!;
      expect(item).toMatchObject({
        title: TITLE,
        id: expect.any(String),
        resultType: "houseNumber",
        houseNumberType: "PA",
        position: POINT,
        address: {
          label: TITLE,
          countryCode: "MCO",
          countryName: "Monaco",
          city: "Monaco",
          street: "Avenue de Monte-Carlo",
          postalCode: "98000",
          houseNumber: "2",
        },
      });
    });

    it("finds an address by a qualified query", async () => {
      const { items } = await client.geocode({
        qq: { city: "Monaco", street: "Avenue de Monte-Carlo", houseNumber: "2" },
        in: "countryCode:MCO",
        lang: ["fr"],
        limit: 1,
      });
      expect(items[0]).toMatchObject({ resultType: "houseNumber", position: POINT });
      expect(items[0]!.address.houseNumber).toBe("2");
    });

    it("honours the limit", async () => {
      const { items } = await client.geocode({ q: "avenue", limit: 3 });
      expect(items.length).toBeGreaterThan(1);
      expect(items.length).toBeLessThanOrEqual(3);
      for (const item of items) expect(item.address.label).toEqual(expect.any(String));
    });

    it("answers no match with an empty list", async () => {
      await expect(client.geocode({ q: "zzzzqqqqxxxx" })).resolves.toEqual({ items: [] });
    });

    it("refuses a request without a query, in HERE's error shape", async () => {
      const error = await failure(client.geocode({ limit: 1 }));
      expect(error).toMatchObject({
        code: "invalid_request",
        status: 400,
        provider: "og",
        operation: "geocode",
      });
      expect(error.requestId).toEqual(expect.any(String));
      expect(error.body).toMatchObject({
        status: 400,
        title: expect.any(String),
        correlationId: expect.any(String),
        requestId: expect.any(String),
      });
      expect(error.message).toContain((error.body as { title: string }).title);
    });

    it("refuses a limit HERE does not allow", async () => {
      const error = await failure(client.geocode({ q: ADDRESS, limit: 101 }));
      expect(error).toMatchObject({ code: "invalid_request", status: 400 });
      expect((error.body as { title: string }).title).toBe("Illegal input for parameter 'limit'");
    });
  });

  describe("revgeocode", () => {
    it("finds the address at a point", async () => {
      const { items } = await client.revgeocode({ at: AT, lang: ["fr"] });
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        title: TITLE,
        resultType: "houseNumber",
        position: POINT,
        distance: 0,
        address: { street: "Avenue de Monte-Carlo", houseNumber: "2", countryCode: "MCO" },
      });
    });

    it("searches within a circle", async () => {
      const { items } = await client.revgeocode({ in: `circle:${AT};r=100`, limit: 3 });
      expect(items.length).toBeGreaterThan(0);
      expect(items.length).toBeLessThanOrEqual(3);
      expect(items[0]).toMatchObject({ title: TITLE, distance: 0 });
      // An area around the point has no distance, since the point lies inside it.
      for (const item of items) expect(item.distance ?? 0).toBeLessThanOrEqual(100);
    });

    it("refuses a point that is none", async () => {
      const error = await failure(client.revgeocode({ at: "999,999" }));
      expect(error).toMatchObject({
        code: "invalid_request",
        status: 400,
        operation: "revgeocode",
      });
      expect((error.body as { title: string }).title).toBe("Illegal input for parameter 'at'");
    });
  });

  describe("multiRevgeocode", () => {
    it("answers every sub-request in one response, each by its own id", async () => {
      const outcome = await client
        .multiRevgeocode({
          limit: 1,
          body: [
            { id: "address", at: AT },
            { id: "circle", in: "circle:43.7391605,7.428023;r=50" },
            { id: "broken", at: "999,999" },
          ],
        })
        .withResponse();
      expect(outcome.response?.url).toContain("/compat/here/v1/multi-revgeocode?limit=1");

      const { results } = outcome.data;
      expect(results.map((result) => result.id)).toEqual(["address", "circle", "broken"]);
      const [address, circle, broken] = results;
      expect(address).toMatchObject({ items: [{ title: TITLE, position: POINT }] });
      expect("items" in circle! && circle.items).toHaveLength(1);
      expect("items" in circle! && circle.items[0]!.distance).toBeLessThanOrEqual(50);
      expect(broken).toEqual({
        id: "broken",
        error: { title: "Illegal input for parameter 'at'" },
      });
    });

    it("takes the body as HERE's own text", async () => {
      const { results } = await client.multiRevgeocode({ body: `id=one&at=${AT}` });
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ id: "one", items: [{ position: POINT }] });
    });
  });

  describe("autosuggest, autocomplete and lookup", () => {
    it("suggests a place by name, and looks it up by the ID of the suggestion", async () => {
      const suggested = await client.autosuggest({ q: "casino", at: AT, limit: 5 });
      expect(suggested.queryTerms).toEqual([]);
      expect(suggested.items.length).toBeGreaterThan(0);
      const item = suggested.items.find((candidate) => candidate.title === CASINO);
      expect(item).toMatchObject({
        resultType: "place",
        address: { label: expect.stringContaining(CASINO), countryCode: "MCO" },
        position: { lat: 43.7391605, lng: 7.428023 },
        distance: expect.any(Number),
      });

      const place = await client.lookup({ id: item!.id, lang: ["fr"] });
      expect(place).toMatchObject({
        id: item!.id,
        title: CASINO,
        resultType: "place",
        position: { lat: 43.7391605, lng: 7.428023 },
        address: { countryCode: "MCO", city: "Monaco" },
      });
    });

    it("pages suggestions when an offset is given", async () => {
      const page = await client.autosuggest({ q: "casino", at: AT, limit: 1, offset: 0 });
      expect(page).toMatchObject({ offset: 0, count: 1, limit: 1, nextOffset: 1 });
      expect(page.items).toHaveLength(1);

      const next = await client.autosuggest({ q: "casino", at: AT, limit: 1, offset: 1 });
      expect(next.offset).toBe(1);
      expect(next.items[0]!.id).not.toBe(page.items[0]!.id);
    });

    it("completes an address, and looks it up for the position it lacks", async () => {
      const completed = await client.autocomplete({ q: "avenue de monte", limit: 5 });
      expect(completed.items.length).toBeGreaterThan(0);
      for (const item of completed.items) {
        expect(item.address.street).toBe("Avenue de Monte-Carlo");
        expect(item).not.toHaveProperty("position");
      }
      const house = completed.items.find((item) => item.resultType === "houseNumber");
      expect(house).toMatchObject({ title: TITLE, address: { houseNumber: "2" } });

      const address = await client.lookup({ id: house!.id });
      expect(address).toMatchObject({
        id: house!.id,
        position: POINT,
        address: { street: "Avenue de Monte-Carlo", houseNumber: "2", countryCode: "MCO" },
      });
    });

    it("fails with not_found for an ID no item has", async () => {
      const error = await failure(client.lookup({ id: "here:no:such:item" }));
      expect(error).toMatchObject({
        code: "not_found",
        status: 404,
        provider: "og",
        operation: "lookup",
      });
      expect(error.cause).toBeInstanceOf(NotFoundError);
      expect(error.body).toMatchObject({ status: 404, title: "Requested id could not be found" });
    });
  });

  describe("discover", () => {
    it("searches places by free text around a point", async () => {
      const { items } = await client.discover({ q: CASINO, at: AT, limit: 3 });
      expect(items.length).toBeGreaterThan(0);
      expect(items[0]).toMatchObject({
        title: CASINO,
        resultType: "place",
        position: { lat: 43.7391605, lng: 7.428023 },
        distance: expect.any(Number),
      });
    });

    it("refuses a search along a route, which og cannot do", async () => {
      const error = await failure(
        client.discover({ q: CASINO, at: AT, limit: 1, route: "BFoz5xJ67i1B1B7PzIhaxL7Y" }),
      );
      expect(error).toMatchObject({ status: 400, operation: "discover" });
      expect(error.body).toMatchObject({ title: "Illegal input for parameter 'route'" });
    });
  });

  describe("browse", () => {
    it("lists the places of a category around a point, nearest first", async () => {
      const { items } = await client.browse({ at: AT, categories: ["100-1000"], limit: 5 });
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items.length).toBeLessThanOrEqual(5);
      for (const item of items) {
        expect(item.resultType).toBe("place");
        expect(item.categories?.[0]).toMatchObject({ primary: true, name: expect.any(String) });
        expect(item.categories?.[0]?.id.startsWith("100-1000-")).toBe(true);
      }
      const distances = items.map((item) => item.distance ?? 0);
      expect(distances.every((distance, at) => at === 0 || distances[at - 1]! <= distance)).toBe(
        true,
      );
    });

    it("leaves out a category after an exclamation mark, and refuses an id that is none", async () => {
      const { items } = await client.browse({
        at: AT,
        categories: ["100-1000", "!100-1000-0009"],
      });
      for (const item of items) expect(item.categories?.[0]?.id).not.toBe("100-1000-0009");
      const error = await failure(client.browse({ at: AT, categories: ["coffee"] }));
      expect(error).toMatchObject({ code: "invalid_request", status: 400, operation: "browse" });
    });
  });

  describe("what og does not serve", () => {
    it("fails a job for the lookup service, which og does not wrap", async () => {
      const error = await failure(
        client.batch.create({
          body: "recId|id\n1|x\n",
          serviceHrn: "hrn:here:service::olp-here:search-lookup-7",
        }),
      );
      expect(error).toMatchObject({ code: "not_found", status: 404, operation: "batch.create" });
      expect(error.body).toMatchObject({ code: "E6004043" });
    });
  });

  describe("signals", () => {
    it("is not served by og, which learns nothing from a signal", async () => {
      const error = await failure(
        client.signals({
          body: [
            {
              action: "here:gs:action:navigate-to",
              correlationId: "c",
              resourceId: "r",
              rank: 0,
              timestamp: Date.now(),
            },
          ],
        }),
      );
      expect(error).toMatchObject({ code: "not_found", status: 404, operation: "signals" });
    });
  });

  describe("batch notifications", () => {
    it("keeps a notification, calls it on a test and when a job ends, then deletes it", async () => {
      const endpoint = await hook();
      try {
        const url = `${endpoint.url}/done?id=\${JOB_ID}&status=\${JOB_STATUS}&ok=\${JOB_RECORDS_SUCCEEDED}`;
        const created = await client.batch.notifications.create({
          type: "webHook",
          config: { url },
        });
        expect(created).toEqual({
          id: expect.stringMatching(/^NOTIFICATION-/),
          type: "webHook",
          config: { url },
        });
        const notificationId = created.id;
        await expect(client.batch.notifications.get({ notificationId })).resolves.toEqual(created);
        const listed = await client.batch.notifications.list();
        expect(Array.isArray(listed) ? listed : [listed]).toContainEqual(created);

        await expect(client.batch.notifications.test({ notificationId })).resolves.toBeUndefined();
        expect(await called(endpoint.calls, 1)).toEqual([
          "/done?id=JOB-00000000-0000-0000-0000-000000000000&status=completed&ok=0",
        ]);
        const used = await client.batch.notifications.get({ notificationId });
        expect(used.lastUsedTime).toEqual(expect.stringMatching(/Z$/));

        const job = await client.batch.create({
          body: `recId|q\nmonte|${ADDRESS}\n`,
          serviceHrn: GEOCODE_HRN,
          notificationIds: [notificationId],
        });
        const done = await ended(job.id);
        expect(done).toMatchObject({ status: "completed", notificationIds: [notificationId] });
        expect((await called(endpoint.calls, 2))[1]).toBe(
          `/done?id=${job.id}&status=completed&ok=1`,
        );

        const replaced = await client.batch.notifications.update({
          notificationId,
          config: { url: `${endpoint.url}/v2` },
        });
        expect(replaced).toMatchObject({
          id: notificationId,
          config: { url: `${endpoint.url}/v2` },
        });

        await expect(
          client.batch.notifications.delete({ notificationId }),
        ).resolves.toBeUndefined();
        const gone = await failure(
          client.batch.notifications.get({ notificationId }, { maxRetries: 0 }),
        );
        expect(gone).toMatchObject({ code: "not_found", status: 404 });
        expect(gone.body).toMatchObject({ code: "E6004044", title: "Notification not found" });
      } finally {
        endpoint.close();
      }
    });

    it("refuses a job that names a notification og does not keep", async () => {
      const error = await failure(
        client.batch.create({
          body: `q\n${ADDRESS}\n`,
          serviceHrn: GEOCODE_HRN,
          notificationIds: ["NOTIFICATION-3fa85f64-5717-4562-b3fc-2c963f66afa6"],
        }),
      );
      expect(error).toMatchObject({ code: "invalid_request", status: 400 });
      expect(error.body).toMatchObject({ title: "Notification not found" });
    });
  });

  describe("batch", () => {
    const tag = `sdk-here-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    it("serves no OpenAPI document, which only HERE writes", async () => {
      const error = await failure(client.batch.openapi());
      expect(error).toMatchObject({ status: 404 });
    });

    it("reports its version and its health", async () => {
      await expect(client.batch.version()).resolves.toMatchObject({
        apiVersion: "v7",
        serviceVersion: expect.any(String),
      });
      await expect(client.batch.health()).resolves.toEqual({ status: "ok" });
    });

    it("runs a geocode job from its creation to its results", async () => {
      const created = await client.batch
        .create({
          body: `recId|q|limit\nmonte|${ADDRESS}|1\nnone|zzzzqqqqxxxx|1\n`,
          serviceHrn: GEOCODE_HRN,
          outputType: "jsonl",
          startJob: false,
          tag,
        })
        .withResponse();
      expect(created.response?.status).toBe(201);
      expect(created.response?.url).not.toContain("apiKey");
      const job = created.data;
      expect(job).toMatchObject({
        id: expect.stringMatching(/^JOB-/),
        serviceHrn: GEOCODE_HRN,
        status: "submitted",
        tag,
        billingTags: [],
        href: expect.stringContaining(`/v7/batch/jobs/${job.id}`),
      });
      const jobId = job.id;

      const waiting = await client.batch.status({ jobId });
      expect(waiting).toMatchObject({
        id: jobId,
        status: "submitted",
        outputType: "jsonl",
        created: expect.any(String),
        resultsHref: "",
        errorsHref: "",
        records: { total: 2, valid: 2, invalid: 0, processed: 0, pending: 2 },
      });
      expect(waiting).not.toHaveProperty("started");

      // A job has no results until it has ended.
      const early = await failure(client.batch.results({ jobId }));
      expect(early).toMatchObject({ code: "not_found", status: 404, operation: "batch.results" });
      expect(early.body).toMatchObject({ code: "E6004042", title: "Results unavailable" });

      const started = await client.batch.start({ jobId });
      expect(started.id).toBe(jobId);
      expect(["queued", "pending", "inProgress", "completed"]).toContain(started.status);

      const done = await ended(jobId);
      expect(done).toMatchObject({
        status: "completed",
        started: expect.any(String),
        ended: expect.any(String),
        resultsHref: expect.stringContaining(`/v7/batch/jobs/${jobId}/results`),
        records: {
          total: 2,
          valid: 2,
          invalid: 0,
          processed: 2,
          pending: 0,
          succeeded: 2,
          failed: 0,
        },
      });

      const results = await client.batch.results({ jobId }).withResponse();
      expect(results.response?.headers.get("content-type")).toContain("text/plain");
      expect(results.response?.headers.get("content-disposition")).toContain(`${jobId}-results`);
      // The lines come in no promised order, so each record is found by its `recId`.
      const records = new Map(
        results.data
          .split("\n")
          .filter((line) => line !== "")
          .map((line) => JSON.parse(line) as BatchJsonlRecord<GeocodeResultItem>)
          .map((record) => [record.recId, record]),
      );
      expect(new Set(records.keys())).toEqual(new Set(["monte", "none"]));
      expect(records.get("monte")!.results).toHaveLength(1);
      expect(records.get("monte")!.results[0]).toMatchObject({
        title: TITLE,
        resultType: "houseNumber",
        position: POINT,
        address: { houseNumber: "2", countryCode: "MCO" },
      });
      expect(records.get("none")).toEqual({ recId: "none", results: [] });

      // No record failed, so there is no error report.
      await expect(client.batch.errors({ jobId })).resolves.toBe("");

      const listed = await client.batch.list({ tag, status: "completed", limit: 10 });
      expect(listed.count).toBe(1);
      expect(listed.limit).toBe(10);
      expect(listed.items?.[0]).toMatchObject({ id: jobId, status: "completed", tag });

      // Stopping a job that has ended changes nothing.
      await expect(client.batch.stop({ jobId })).resolves.toMatchObject({
        id: jobId,
        status: "completed",
      });

      await expect(client.batch.delete({ jobId })).resolves.toMatchObject({
        id: jobId,
        status: "deleted",
      });
      await expect(client.batch.status({ jobId })).resolves.toMatchObject({ status: "deleted" });
      await expect(client.batch.list({ tag })).resolves.toMatchObject({ count: 0 });
    }, 60_000);

    it("runs a reverse geocode job that starts at once and answers in columns", async () => {
      const job = await client.batch.create({
        body: `recId|at\nhere|${AT}\nnowhere|999,999\n`,
        serviceHrn: REVGEOCODE_HRN,
        outputColumns: ["recId", "seqNumber", "seqLength", "position", "distance", "addressLabel"],
        outputDelimiter: ";",
        tag,
      });
      expect(job.serviceHrn).toBe(REVGEOCODE_HRN);
      expect(job.status).not.toBe("submitted");

      const done = await ended(job.id);
      expect(done).toMatchObject({ status: "completed", outputType: "csv" });
      expect(done.records).toMatchObject({ total: 2 });

      const lines = (await client.batch.results({ jobId: job.id })).split("\n").filter(Boolean);
      expect(lines[0]).toBe("recId;seqNumber;seqLength;position;distance;addressLabel");
      expect(lines).toContain(`here;1;1;(${POINT.lat},${POINT.lng});0;${TITLE}`);

      const report = (await client.batch.errors({ jobId: job.id })).split("\n").filter(Boolean);
      expect(report[0]).toBe("recId;errorCode;errorMessage");
      expect(report).toHaveLength(2);
      expect(report[1]).toMatch(/^nowhere;\d{3};\{/);

      // Every job of this run's tag goes at once.
      const deleted = await client.batch.deleteMany({ status: "any", tag });
      expect(deleted.jobIds).toContain(job.id);
      expect(deleted.total).toBe(deleted.jobIds.length);
      await expect(client.batch.list({ tag })).resolves.toMatchObject({ count: 0 });
    }, 60_000);

    it("fails with not_found for a job that does not exist", async () => {
      const jobId = "JOB-00000000-0000-4000-8000-000000000000";
      for (const call of [
        client.batch.status({ jobId }),
        client.batch.start({ jobId }),
        client.batch.stop({ jobId }),
        client.batch.delete({ jobId }),
        client.batch.results({ jobId }),
        client.batch.errors({ jobId }),
      ]) {
        const error = await failure(call);
        expect(error).toMatchObject({ code: "not_found", status: 404, provider: "og" });
        expect(error.body).toMatchObject({
          status: 404,
          code: expect.stringMatching(/^E60040/),
          correlationId: expect.any(String),
        });
      }
    });

    it("refuses an empty input", async () => {
      const error = await failure(client.batch.create({ body: "", serviceHrn: GEOCODE_HRN }));
      expect(error).toMatchObject({ code: "invalid_request", status: 400 });
    });
  });

  describe("plugins", () => {
    it("gives a plugin the points of a real answer", async () => {
      const seen: Record<string, Position[]> = {};
      const watcher: Plugin = {
        name: "watcher",
        async handle(call, next) {
          const outcome = await next();
          seen[call.method] = call.positions(outcome.data);
          return outcome;
        },
      };
      const watched = here({ baseUrl: OG_URL, plugins: [watcher], logLevel: "off" });
      const point = { lat: POINT.lat, lon: POINT.lng };

      await watched.geocode({ q: ADDRESS, limit: 1 });
      await watched.revgeocode({ at: AT });
      await watched.multiRevgeocode({
        body: [
          { id: "a", at: AT },
          { id: "b", at: "999,999" },
        ],
      });
      const suggested = await watched.autosuggest({ q: "casino", at: AT, limit: 3 });
      const found = await watched.discover({ q: CASINO, at: AT, limit: 2 });
      await watched.lookup({ id: found.items[0]!.id });
      await watched.autocomplete({ q: "avenue de monte" });

      expect(seen["geocode"]).toEqual([point]);
      expect(seen["revgeocode"]).toEqual([point]);
      expect(seen["multiRevgeocode"]).toEqual([point]);
      expect(seen["autosuggest"]).toHaveLength(suggested.items.length);
      expect(seen["discover"]).toHaveLength(found.items.length);
      expect(seen["lookup"]).toEqual([{ lat: 43.7391605, lon: 7.428023 }]);
      expect(seen["autocomplete"]).toEqual([]);
    });
  });
});
