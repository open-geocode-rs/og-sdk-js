/// <reference types="node" />
import { describe, expect, it } from "vitest";
import type { Plugin, Position } from "../src/base.ts";
import { BadRequestError, GeocoderError, OgError } from "../src/errors.ts";
import { type ErrorResponse, jobIdOf, precisely, type Result } from "../src/precisely.ts";

const OG_URL = process.env["OG_URL"];

/** The address the Monaco test Pack is asked for, and the point it lies at. */
const ADDRESS = "2 Avenue de Monte-Carlo";
const LON = 7.4270688;
const LAT = 43.7377547;

const caught = (promise: PromiseLike<unknown>): Promise<GeocoderError> =>
  Promise.resolve(promise).then(
    () => {
      throw new Error("The call did not fail.");
    },
    (error: GeocoderError) => error,
  );

/** og's ID for a candidate, which it puts where Precisely puts its own key. */
const keyOf = (result: Result | undefined): string => result?.customFields?.["PB_KEY"] ?? "";

// These run against a real og server, which answers Precisely's API under /compat/precisely.
describe.runIf(OG_URL)("precisely against og", () => {
  /** Every request the client sent, to show what did and did not leave it. */
  const sent: { url: string; headers: Record<string, string> }[] = [];
  const recording: typeof globalThis.fetch = (url, init) => {
    sent.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) } });
    return fetch(url, init);
  };
  const seen: Record<string, Position[]> = {};
  const recorder: Plugin = {
    name: "recorder",
    async handle(call, next) {
      const outcome = await next();
      seen[call.method] = call.positions(outcome.data);
      return outcome;
    },
  };
  const client = precisely({
    baseUrl: OG_URL ?? "",
    fetch: recording,
    plugins: [recorder],
    logLevel: "off",
  });

  it("points at og", () => {
    expect(client).toMatchObject({ shape: "precisely", server: "og" });
  });

  describe("geocode", () => {
    it("finds an address written on one line", async () => {
      const outcome = await client
        .geocode({
          "X-Request-Id": "compat-geocode-1",
          addresses: [{ addressId: "a1", addressLines: [ADDRESS], country: "MCO" }],
        })
        .withResponse();
      expect(outcome.server).toBe("og");
      expect(outcome.cache).toEqual({ maxTtl: Infinity });
      expect(outcome.requestId).toEqual(expect.any(String));
      expect(outcome.response?.status).toBe(200);
      expect(outcome.response?.url).toBe(`${OG_URL}/compat/precisely/v1/geocode`);

      expect(outcome.data.responses).toHaveLength(1);
      const item = outcome.data.responses[0]!;
      expect(item).toMatchObject({ addressId: "a1", status: "OK" });
      expect(item.results).toHaveLength(1);
      const result = item.results![0]!;
      expect(result.address).toMatchObject({
        formattedStreetAddress: ADDRESS,
        addressNumber: "2",
        street: "Avenue de Monte-Carlo",
        city: { longName: "Monaco" },
        postalCode: "98000",
        country: {
          name: "Monaco",
          isoAlpha2Code: "MC",
          isoAlpha3Code: "MCO",
          isoNumericCode: "492",
        },
      });
      expect(result.address?.formattedAddress).toContain(ADDRESS);
      expect(result.location).toMatchObject({
        explanation: { type: "ADDRESS_POINT" },
        feature: {
          type: "Feature",
          properties: { crsName: "epsg:4326" },
          geometry: { type: "Point", coordinates: [LON, LAT] },
        },
      });
      expect(result.explanation?.addressMatch?.type).toBe("ADDRESS");
      expect(keyOf(result)).not.toBe("");
      expect(seen["geocode"]).toEqual([{ lat: LAT, lon: LON }]);
    });

    it("finds an address given part by part, with the country as a number", async () => {
      const { responses } = await client.geocode({
        addresses: [
          { addressNumber: "2", street: "Avenue de Monte-Carlo", city: "Monaco", country: "492" },
        ],
      });
      expect(responses[0]?.status).toBe("OK");
      expect(responses[0]?.results?.[0]?.address?.formattedStreetAddress).toBe(ADDRESS);
      expect(responses[0]?.results?.[0]?.location?.feature?.geometry.coordinates).toEqual([
        LON,
        LAT,
      ]);
    });

    it("answers as many candidates as maxResults allows", async () => {
      const { responses } = await client.geocode({
        preferences: { maxResults: 3 },
        addresses: [{ addressLines: ["Avenue de Monte-Carlo"], country: "MC" }],
      });
      const results = responses[0]?.results ?? [];
      expect(results).toHaveLength(3);
      for (const result of results)
        expect(result.address?.formattedAddress).toContain("Avenue de Monte-Carlo");
      expect(seen["geocode"]).toHaveLength(results.length);
    });

    it("answers 206 when one item of a batch fails, each item in its place", async () => {
      const outcome = await client
        .geocode({
          addresses: [
            { addressId: "bad", addressLines: [ADDRESS], country: "ZZZ" },
            { addressId: "good", addressLines: [ADDRESS], country: "MC" },
            { addressId: "none", addressLines: ["qqqqzzzz xxxxyyyy"], country: "MC" },
          ],
        })
        .withResponse();
      expect(outcome.response?.status).toBe(206);
      expect(outcome.data.responses).toHaveLength(3);
      const [bad, good, none] = outcome.data.responses;
      expect(bad).toEqual({
        addressId: "bad",
        status: "INVALID_REQUEST",
        errorMessage: "Not able to identify ZZZ country (DIS-LI-1016)",
      });
      expect(good).toMatchObject({ addressId: "good", status: "OK" });
      expect(none).toEqual({ addressId: "none", status: "ZERO_RESULTS", results: [] });
      // One point per item that has one, in the order of the items.
      expect(seen["geocode"]).toEqual([{ lat: LAT, lon: LON }]);
    });

    it("refuses more than 25 addresses", async () => {
      const addresses = Array.from({ length: 26 }, () => ({
        addressLines: [ADDRESS],
        country: "MC",
      }));
      const error = await caught(client.geocode({ addresses }));
      expect(error).toMatchObject({
        code: "payload_too_large",
        status: 413,
        provider: "og",
        operation: "geocode",
      });
      expect(error.requestId).toEqual(expect.any(String));
      expect(error.cause).toBeInstanceOf(OgError);
      expect(error.body as ErrorResponse).toEqual({
        errors: [
          {
            status: "BATCH_SIZE_EXCEEDED",
            errorMessage: "Batch size must not exceed 25 (DIS-LI-1014)",
          },
        ],
      });
      expect(error.message).toBe("Batch size must not exceed 25 (DIS-LI-1014)");
    });

    it("refuses a maxResults that is not a count", async () => {
      const error = await caught(
        client.geocode({
          preferences: { maxResults: 0 },
          addresses: [{ addressLines: [ADDRESS], country: "MC" }],
        }),
      );
      expect(error).toMatchObject({
        code: "invalid_request",
        status: 400,
        message: "Invalid value for maxResults (DIS-LI-1036)",
      });
      expect(error.cause).toBeInstanceOf(BadRequestError);
    });
  });

  describe("reverseGeocode", () => {
    it("finds the address at a point", async () => {
      const outcome = await client
        .reverseGeocode({
          locations: [{ addressId: "p1", longitude: LON, latitude: LAT, country: "MCO" }],
        })
        .withResponse();
      expect(outcome.response?.url).toBe(`${OG_URL}/compat/precisely/v1/reverse-geocode`);
      const item = outcome.data.responses[0]!;
      expect(item).toMatchObject({ addressId: "p1", status: "OK" });
      expect(item.results?.[0]?.address).toMatchObject({
        formattedStreetAddress: ADDRESS,
        addressNumber: "2",
        street: "Avenue de Monte-Carlo",
        country: { isoAlpha3Code: "MCO" },
      });
      expect(item.results?.[0]?.location?.feature?.geometry.coordinates).toEqual([LON, LAT]);
      expect(seen["reverseGeocode"]).toEqual([{ lat: LAT, lon: LON }]);
    });

    it("answers several points in the order sent", async () => {
      const { responses } = await client.reverseGeocode({
        locations: [
          { addressId: "first", longitude: LON, latitude: LAT, country: "MC" },
          { addressId: "second", longitude: 7.4275979, latitude: 43.7394242, country: "MC" },
        ],
      });
      expect(responses.map((item) => [item.addressId, item.status])).toEqual([
        ["first", "OK"],
        ["second", "OK"],
      ]);
      expect(seen["reverseGeocode"]).toHaveLength(2);
    });
  });

  describe("lookup", () => {
    it("finds a candidate again by the key its answer carried", async () => {
      const geocoded = await client.geocode({
        addresses: [{ addressLines: [ADDRESS], country: "MC" }],
      });
      const key = keyOf(geocoded.responses[0]?.results?.[0]);
      expect(key).not.toBe("");

      const outcome = await client
        .lookup({ keys: [{ key, type: "PB_KEY", country: "MC" }] })
        .withResponse();
      expect(outcome.response?.url).toBe(`${OG_URL}/compat/precisely/v1/lookup`);
      const item = outcome.data.responses[0]!;
      expect(item.status).toBe("OK");
      // Lookup keys carry no ID, so the answer has none to echo.
      expect(item.addressId).toBeUndefined();
      expect(item.results).toHaveLength(1);
      expect(keyOf(item.results?.[0])).toBe(key);
      expect(item.results?.[0]?.address?.formattedAddress).toContain(ADDRESS);
      expect(item.results?.[0]?.location?.feature?.geometry.coordinates).toEqual([LON, LAT]);
      expect(seen["lookup"]).toEqual([{ lat: LAT, lon: LON }]);
    });

    it("finds nothing for a key og never gave out", async () => {
      const { responses } = await client.lookup({
        keys: [{ key: "P0000ZZ9K3QX", type: "PB_KEY", country: "MC" }],
      });
      expect(responses).toEqual([{ status: "ZERO_RESULTS", results: [] }]);
    });
  });

  describe("autocomplete", () => {
    it("predicts places by the start of their name, and each prediction can be looked up", async () => {
      const outcome = await client
        .autocomplete({
          "X-Transaction-Id": "0b9f6f3e-52c1-4d0a-9a57-3f2f3c1d8e44",
          preferences: { maxResults: 3 },
          address: { addressLines: ["casino"], country: "MC" },
        })
        .withResponse();
      expect(outcome.response?.url).toBe(`${OG_URL}/compat/precisely/v1/autocomplete`);
      expect(outcome.data.response.status).toBe("OK");
      const predictions = outcome.data.response.predictions ?? [];
      expect(predictions.length).toBeGreaterThan(0);
      expect(predictions.length).toBeLessThanOrEqual(3);
      for (const prediction of predictions) {
        expect(prediction.prediction?.toLowerCase()).toContain("casino");
        expect(prediction.prediction).toBe(prediction.address?.formattedAddress);
        expect(prediction.address?.country?.isoAlpha2Code).toBe("MC");
        expect(prediction.location?.feature?.geometry.coordinates).toEqual([
          expect.any(Number),
          expect.any(Number),
        ]);
      }
      expect(seen["autocomplete"]).toHaveLength(predictions.length);

      const first = predictions[0]!;
      const looked = await client.lookup({
        keys: [{ key: keyOf(first), type: "PB_KEY", country: "MC" }],
      });
      expect(looked.responses[0]?.status).toBe("OK");
      expect(keyOf(looked.responses[0]?.results?.[0])).toBe(keyOf(first));
      expect(looked.responses[0]?.results?.[0]?.location?.feature?.geometry.coordinates).toEqual(
        first.location?.feature?.geometry.coordinates,
      );
    });

    it("predicts an address from its first words", async () => {
      const { response } = await client.autocomplete({
        address: { addressLines: ["2 Avenue de Monte"], country: "MCO" },
      });
      expect(response.status).toBe("OK");
      expect(response.predictions?.[0]?.prediction).toContain(ADDRESS);
      expect(response.predictions?.[0]?.location?.feature?.geometry.coordinates).toEqual([
        LON,
        LAT,
      ]);
    });

    it("answers ZERO_RESULTS when nothing starts that way", async () => {
      const { response } = await client.autocomplete({
        address: { addressLines: ["qqqqzzzz xxxxyyyy"], country: "MC" },
      });
      expect(response).toEqual({ status: "ZERO_RESULTS", predictions: [] });
    });

    it.each([
      ["expressAutocomplete", "/v1/express-autocomplete"],
      ["expressAutocompleteV2", "/v2/express-autocomplete"],
    ] as const)("answers %s the same way", async (method, path) => {
      const outcome = await client[method]({
        address: { addressLines: ["2 Avenue de Monte"], country: "MC" },
      }).withResponse();
      expect(outcome.response?.url).toBe(`${OG_URL}/compat/precisely${path}`);
      expect(outcome.data.response.status).toBe("OK");
      expect(outcome.data.response.predictions?.[0]?.prediction).toContain(ADDRESS);
      expect(seen[method]?.[0]).toEqual({ lat: LAT, lon: LON });
    });
  });

  describe("verify", () => {
    it("answers the address og matched, standardized, with no point", async () => {
      const outcome = await client
        .verify({ addresses: [{ addressId: "v1", addressLines: [ADDRESS], country: "MCO" }] })
        .withResponse();
      expect(outcome.response?.status).toBe(200);
      expect(outcome.response?.url).toBe(`${OG_URL}/compat/precisely/v1/verify`);
      const item = outcome.data.responses[0]!;
      expect(item).toMatchObject({ addressId: "v1", status: "OK" });
      const result = item.results![0]!;
      expect(result.address).toMatchObject({
        formattedStreetAddress: ADDRESS,
        addressNumber: "2",
        street: "Avenue de Monte-Carlo",
        country: { isoAlpha2Code: "MC", isoAlpha3Code: "MCO" },
      });
      expect(result.location).toBeUndefined();
      expect(result.addressLines?.[0]).toBe(ADDRESS);
      expect(result.explanation?.addressMatch?.description).toEqual(
        expect.arrayContaining([
          { label: "addressNumber", matchType: "EXACT" },
          { label: "street", matchType: "EXACT" },
        ]),
      );
      expect(keyOf(result)).not.toBe("");
      // The Monaco Pack is not calibrated, and a match code ends in the confidence
      // only a calibrated score gives, so there is none. The company flows check one.
      expect(result.score).toBeUndefined();
      expect(result.customFields?.["SIMPLE_MATCH_CODE"]).toBeUndefined();
      expect(seen["verify"]).toEqual([]);

      // A code reads back as words. The company flows read back one verify gave.
      const code = "V4-P4S4A6T4R6Z6C4-4";
      const explained = await client.explainAddressCode({
        codeType: "GlobalMatchCode",
        codes: [{ id: "c1", code }],
        responseOptions: { includeOfficialDescription: true },
      });
      const first = explained.responses[0]!;
      expect(first).toMatchObject({
        id: "c1",
        status: "OK",
        result: { codeType: "GlobalMatchCode" },
      });
      expect(first.result?.customerInsightSummary).toMatch(/^Address premise verified with /);
      expect(first.result?.officialDescription?.componentMatchStatus?.["S"]).toEqual({
        label: "Street",
        value: 4,
        meaning: "Verified without changes",
      });
      expect(explained.generatedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    });
  });

  describe("explainAddressCode", () => {
    it("refuses a malformed code", async () => {
      const error = await caught(
        client.explainAddressCode({ codeType: "GlobalMatchCode", codes: [{ code: "V5-P4-5" }] }),
      );
      expect(error).toMatchObject({ code: "invalid_request", status: 400 });
      expect(error.message).toContain("(DIS-LI-1040)");
    });

    it("answers a code type og issues none of as not explained", async () => {
      const outcome = await client
        .explainAddressCode({ codeType: "ForwardResultCode", codes: [{ code: "S8HPNTSCZA" }] })
        .withResponse();
      expect(outcome.response?.status).toBe(206);
      expect(outcome.data.responses[0]?.status).toBe("ERROR");
    });
  });

  describe("autocompletePostalCity", () => {
    it("completes a postal code with its town", async () => {
      const outcome = await client
        .autocompletePostalCity({
          preferences: { maxResults: 3 },
          address: { type: "POSTAL", postAddress: "980", country: "MCO" },
        })
        .withResponse();
      expect(outcome.response?.url).toBe(`${OG_URL}/compat/precisely/v1/autocomplete/postal-city`);
      const { response } = outcome.data;
      expect(response.status).toBe("OK");
      expect(response.predictions?.[0]?.address).toMatchObject({
        country: { isoAlpha3Code: "MCO" },
        postalCode: expect.stringMatching(/^980/),
      });
      expect(seen["autocompletePostalCity"]?.length).toBe(response.predictions?.length);
    });

    it("completes a town", async () => {
      const { response } = await client.autocompletePostalCity({
        address: { type: "CITY", postAddress: "Mona", country: "MC" },
      });
      expect(response.status).toBe("OK");
      expect(response.predictions?.[0]?.address?.city?.longName).toBe("Monaco");
    });
  });

  describe("proximitySearch", () => {
    it("finds the nearest address, its distance in the unit asked", async () => {
      const outcome = await client
        .proximitySearch({
          preferences: {
            dataset: "osm",
            distance: { value: 100, distanceUnit: "METER" },
          },
          location: { addressId: "p1", latitude: LAT, longitude: LON, country: "MCO" },
        })
        .withResponse();
      expect(outcome.response?.url).toBe(`${OG_URL}/compat/precisely/v1/proximity-search`);
      const { response } = outcome.data;
      expect(response).toMatchObject({ addressId: "p1", status: "OK" });
      const result = response.results![0]!;
      expect(result.distance).toBeGreaterThanOrEqual(0);
      expect(result.distance).toBeLessThan(100);
      expect(result.metadata).toMatchObject({ COUNTRY: "MCO", PBKEY: expect.any(String) });
      expect(seen["proximitySearch"]).toEqual([
        { lat: result.location!.latitude, lon: result.location!.longitude },
      ]);
    });

    it("refuses a dataset og does not hold", async () => {
      const error = await caught(
        client.proximitySearch({
          preferences: { dataset: "premium-address-points" },
          location: { latitude: LAT, longitude: LON, country: "MCO" },
        }),
      );
      expect(error).toMatchObject({ code: "invalid_request", status: 400 });
      expect(error.message).toContain("premium-address-points");
    });

    it("refuses a search without a dataset", async () => {
      const error = await caught(
        client.proximitySearch({
          preferences: { dataset: "" },
          location: { latitude: LAT, longitude: LON, country: "MCO" },
        }),
      );
      expect(error).toMatchObject({ code: "invalid_request", status: 400 });
      expect(error.message).toContain("(DIS-LI-1031)");
    });
  });

  describe("bulk", () => {
    it("runs a geocode job from the upload to the output file", async () => {
      const fileName = `compat_${Date.now()}`;
      const uploadUrl = await client.bulk.uploadUrl({ fileName });
      expect(uploadUrl).toEqual({
        fileId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        url: `${OG_URL}/compat/precisely/v2/files/${uploadUrl.fileId}/content`,
        message: expect.any(String),
      });
      const { fileId, url } = uploadUrl;

      // A file is not listed before it is uploaded.
      const before = await client.bulk.files();
      expect(before.results.map((file) => file.fileId)).not.toContain(fileId);

      const rows = [
        "addressId,address,city,country",
        `row-1,${ADDRESS},Monaco,MCO`,
        "row-2,qqqqzzzz xxxxyyyy,,MCO",
        `row-3,${ADDRESS},,ZZZ`,
      ];
      const uploaded = await client.bulk
        .upload({ url, content: `${rows.join("\n")}\n` })
        .withResponse();
      expect(uploaded.data).toBeUndefined();
      expect(uploaded.response?.status).toBe(200);

      const files = await client.bulk.files();
      expect(files.results).toContainEqual({ fileId, fileName });

      const submitted = await client.bulk
        .geocode({ fileId, delimiter: ",", preferences: { maxResults: 1 } })
        .withResponse();
      expect(submitted.response?.status).toBe(202);
      const jobId = jobIdOf(submitted.data.statusUrl);
      expect(jobId).not.toBe("");
      expect(submitted.data).toEqual({
        statusUrl: `${OG_URL}/compat/precisely/v2/bulk/jobs/${jobId}`,
      });

      const jobs = await client.bulk.jobs({ status: "all" });
      expect(Array.isArray(jobs.jobs)).toBe(true);
      for (const job of jobs.jobs)
        expect(job).toMatchObject({
          jobId: expect.any(String),
          fileId: expect.any(String),
          fileName: expect.any(String),
          status: "RUNNING",
          submittedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/),
        });

      let status = await client.bulk.status({ jobId });
      for (let tries = 0; status.status === "RUNNING" && tries < 100; tries++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        status = await client.bulk.status({ jobId });
      }
      expect(status).toEqual({
        status: "COMPLETED",
        downloadUrl: `${OG_URL}/compat/precisely/v2/bulk/jobs/${jobId}/output`,
      });

      const results = await client.bulk
        .results({ downloadUrl: status.downloadUrl! })
        .withResponse();
      expect(results.response?.headers.get("content-type")).toContain("text/csv");
      const lines = results.data.trim().split("\n");
      expect(lines).toHaveLength(4);
      const header = lines[0]!.split(",");
      expect(header.slice(0, 5)).toEqual([
        "addressId",
        "status",
        "errorMessage",
        "score",
        "formattedAddress",
      ]);
      expect(header).toEqual(expect.arrayContaining(["latitude", "longitude", "customFields"]));
      expect(lines[1]).toMatch(/^row-1,OK,,/);
      expect(lines[1]).toContain(ADDRESS);
      expect(lines[1]).toContain(`,${LAT},${LON},epsg:4326,Point,ADDRESS_POINT,ADDRESS,`);
      expect(lines[2]).toMatch(/^row-2,ZERO_RESULTS,/);
      expect(lines[3]).toMatch(
        /^row-3,INVALID_REQUEST,Not able to identify requested country \(DIS-LI-1016\),/,
      );

      // A finished job is no longer listed, and can no longer be cancelled.
      const after = await client.bulk.jobs({ status: "running" });
      expect(after.jobs.map((job) => job.jobId)).not.toContain(jobId);
      const cancel = await caught(client.bulk.cancel({ jobId }));
      expect(cancel).toMatchObject({
        code: "invalid_request",
        status: 400,
        operation: "bulk.cancel",
        message: "Job is COMPLETED and can no longer be canceled",
      });

      expect(await client.bulk.deleteFile({ fileId })).toEqual({
        status: "SUCCESS",
        message: "File Deleted Successfully",
      });
      const gone = await client.bulk.files();
      expect(gone.results.map((file) => file.fileId)).not.toContain(fileId);
    });

    it("runs a verify job, whose output has no point", async () => {
      const { fileId, url } = await client.bulk.uploadUrl({
        fileName: `compat_verify_${Date.now()}`,
      });
      await client.bulk.upload({
        url,
        content: `addressId,address,city,country\nrow-1,${ADDRESS},Monaco,MCO\n`,
      });
      const submitted = await client.bulk.verify({ fileId, delimiter: "," }).withResponse();
      expect(submitted.response?.status).toBe(202);
      const jobId = jobIdOf(submitted.data.statusUrl);
      let status = await client.bulk.status({ jobId });
      for (let tries = 0; status.status === "RUNNING" && tries < 100; tries++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        status = await client.bulk.status({ jobId });
      }
      expect(status.status).toBe("COMPLETED");
      const lines = (await client.bulk.results({ downloadUrl: status.downloadUrl! }))
        .trim()
        .split("\n");
      expect(lines).toHaveLength(2);
      const header = lines[0]!.split(",");
      expect(header).not.toContain("latitude");
      expect(header).not.toContain("longitude");
      expect(header).toContain("customFields");
      expect(lines[1]).toMatch(/^row-1,OK,,/);
      expect(lines[1]).toContain(ADDRESS);
      expect(lines[1]).not.toContain("simpleMatchCode");
      await client.bulk.deleteFile({ fileId });
    });

    it("lists no job as scheduled, since og starts every job at once", async () => {
      expect(await client.bulk.jobs({ status: "scheduled" })).toEqual({ jobs: [] });
    });

    it("refuses a job ID, a file ID and a file name it does not know", async () => {
      const status = await caught(client.bulk.status({ jobId: "no-such-job" }));
      expect(status).toMatchObject({
        code: "invalid_request",
        status: 400,
        operation: "bulk.status",
        message: "Invalid Job Id (DIS-LI-1051)",
      });
      const cancel = await caught(client.bulk.cancel({ jobId: "no-such-job" }));
      expect((cancel.body as ErrorResponse).errors[0]).toEqual({
        status: "BAD_REQUEST",
        errorMessage: "Invalid Job Id (DIS-LI-1051)",
      });
      const fileId = "00000000-0000-4000-8000-000000000000";
      for (const call of [client.bulk.deleteFile({ fileId }), client.bulk.geocode({ fileId })])
        expect(await caught(call)).toMatchObject({
          code: "invalid_request",
          status: 400,
          message: "Invalid File Id (DIS-LI-1052)",
        });
      const upload = await caught(client.bulk.uploadUrl({ fileName: "" }));
      expect((upload.body as ErrorResponse).errors[0]?.status).toBe("INVALID_CLIENT_INPUT");
    });

    it("refuses a file without the columns a job needs", async () => {
      const { fileId, url } = await client.bulk.uploadUrl({ fileName: "compat_headless" });
      await client.bulk.upload({ url, content: "id|where\n1|somewhere\n" });
      const error = await caught(client.bulk.geocode({ fileId }));
      expect(error).toMatchObject({ code: "invalid_request", status: 400 });
      expect(error.message).toContain("(DIS-LI-1053)");
      await client.bulk.deleteFile({ fileId });
    });
  });

  // This runs last, over everything the tests above sent.
  it("never asked for a token and never sent one", () => {
    expect(sent.length).toBeGreaterThan(20);
    for (const request of sent) {
      expect(request.url.startsWith(`${OG_URL}/compat/precisely/`)).toBe(true);
      expect(request.url).not.toContain("/auth/");
      const all = JSON.stringify(request);
      for (const credential of ["Bearer", "Basic"]) expect(all).not.toContain(credential);
      expect(Object.keys(request.headers).map((name) => name.toLowerCase())).not.toContain(
        "authorization",
      );
    }
  });
});
