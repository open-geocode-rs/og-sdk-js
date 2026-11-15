import { describe, expect, it, vi } from "vitest";
import {
  APIConnectionError,
  AuthenticationError,
  Geocoder,
  type GeocoderError,
  InternalServerError,
} from "../src/index.ts";
import {
  cache,
  compare,
  compareResults,
  type CompareReport,
  failover,
  memoryStore,
} from "../src/plugins/index.ts";
import { fakeAdapter, place } from "./helpers.ts";

const fail = () => Promise.reject(new InternalServerError("500", { status: 500 }));

describe("failover", () => {
  it("falls back when the first provider is down, and says who answered", async () => {
    const down = fakeAdapter("og", () => Promise.reject(new APIConnectionError("down")));
    const up = fakeAdapter("google", () => ({ results: [place()] }));
    const events: string[] = [];
    const geo = new Geocoder({
      adapter: down,
      plugins: [
        failover({
          to: up,
          onFailover: ({ from, to, error }) => events.push(`${from.id}>${to.id}:${error?.code}`),
        }),
      ],
    });
    const result = await geo.geocode("x", { limit: 1 });
    expect(result.provider).toBe("google");
    expect(result.results).toHaveLength(1);
    expect(up.native.calls[0]!.request).toEqual({ query: "x", limit: 1, include: [] });
    expect(events).toEqual(["og>google:connection"]);
  });

  it("walks a list of fallbacks in order", async () => {
    const geo = new Geocoder({
      adapter: fakeAdapter("a", fail),
      plugins: [failover({ to: [fakeAdapter("b", fail), fakeAdapter("c", () => ({}))] })],
    });
    expect((await geo.reverse({ lat: 1, lon: 2 })).provider).toBe("c");
  });

  it("does not fall back on an error the next provider would repeat", async () => {
    const other = fakeAdapter("b", () => ({}));
    const geo = new Geocoder({
      adapter: fakeAdapter("a", () =>
        Promise.reject(new AuthenticationError("bad key", { status: 401 })),
      ),
      plugins: [failover({ to: other })],
    });
    const error = (await geo.geocode("x").catch((thrown: unknown) => thrown)) as GeocoderError;
    expect(error.code).toBe("unauthenticated");
    expect(other.native.calls).toHaveLength(0);
  });

  it("throws the last error when every provider fails", async () => {
    const geo = new Geocoder({
      adapter: fakeAdapter("a", () => Promise.reject(new APIConnectionError("a down"))),
      plugins: [
        failover({ to: fakeAdapter("b", () => Promise.reject(new APIConnectionError("b down"))) }),
      ],
    });
    const error = (await geo.geocode("x").catch((thrown: unknown) => thrown)) as GeocoderError;
    expect(error.message).toBe("b down");
    expect(error.provider).toBe("b");
  });

  it("falls back on an empty answer when asked, and on a missing operation", async () => {
    const empty = fakeAdapter("a", () => ({ results: [] }));
    const full = fakeAdapter("b", () => ({ results: [place()] }));
    const onEmpty = new Geocoder({
      adapter: empty,
      plugins: [failover({ to: full, onEmpty: true })],
    });
    expect((await onEmpty.geocode("x")).provider).toBe("b");
    const plain = new Geocoder({ adapter: empty, plugins: [failover({ to: full })] });
    expect((await plain.geocode("x")).provider).toBe("a");

    const noPlaces = fakeAdapter("a", () => ({}));
    delete noPlaces.places;
    delete noPlaces.capabilities.places;
    const geo = new Geocoder({ adapter: noPlaces, plugins: [failover({ to: full })] });
    expect((await geo.places("x")).provider).toBe("b");
  });
});

describe("cache", () => {
  it("answers a repeated call from memory, with no response", async () => {
    const adapter = fakeAdapter("a", () => ({ results: [place()] }));
    const lookups: boolean[] = [];
    const geo = new Geocoder({
      adapter,
      plugins: [cache({ onLookup: ({ hit }) => lookups.push(hit) })],
    });
    const first = await geo.geocode("x", { limit: 1 }).withResponse();
    const second = await geo.geocode("x", { limit: 1 }).withResponse();
    expect(adapter.native.calls).toHaveLength(1);
    expect(second.data).toEqual(first.data);
    expect(first.response).toBeInstanceOf(Response);
    expect(second.response).toBeUndefined();
    expect(lookups).toEqual([false, true]);
  });

  it("keys on provider, operation and request, but not on the session", async () => {
    const adapter = fakeAdapter("a", () => ({ results: [place()] }));
    adapter.capabilities.autocomplete!.options = ["limit", "session"];
    const geo = new Geocoder({ adapter, plugins: [cache()] });
    await geo.autocomplete("x", { session: "s1" });
    await geo.autocomplete("x", { session: "s2" });
    await geo.autocomplete("x", { limit: 2 });
    await geo.places("x");
    expect(adapter.native.calls).toHaveLength(3);
  });

  it("hands out copies, so changing a result does not change the cache", async () => {
    const geo = new Geocoder({
      adapter: fakeAdapter("a", () => ({ results: [place()] })),
      plugins: [cache()],
    });
    (await geo.geocode("x")).results[0]!.name = "changed";
    (await geo.geocode("x")).results[0]!.name = "changed again";
    expect((await geo.geocode("x")).results[0]!.name).toBe("10 King St W");
  });

  it("expires entries, drops the least recently used, and does not cache errors", async () => {
    vi.useFakeTimers();
    try {
      const store = memoryStore(2);
      const value = { provider: "a", operation: "geocode" } as never;
      store.set("one", value, 1000);
      store.set("two", value, 1000);
      expect(store.get("one")).toBe(value);
      store.set("three", value, 1000);
      expect(store.get("two")).toBeUndefined();
      expect(store.get("one")).toBe(value);
      vi.advanceTimersByTime(1001);
      expect(store.get("one")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
    let calls = 0;
    const flaky = fakeAdapter("a", () =>
      calls++ === 0 ? Promise.reject(new APIConnectionError("down")) : ({ results: [] } as never),
    );
    const geo = new Geocoder({ adapter: flaky, plugins: [cache()] });
    await geo.geocode("x").catch(() => {});
    await geo.geocode("x");
    expect(calls).toBe(2);
  });

  it("caches only the operations listed", async () => {
    const adapter = fakeAdapter("a", () => ({}));
    const geo = new Geocoder({ adapter, plugins: [cache({ operations: ["geocode"] })] });
    await geo.geocode("x");
    await geo.geocode("x");
    await geo.autocomplete("x");
    await geo.autocomplete("x");
    expect(adapter.native.calls.map((call) => call.operation)).toEqual([
      "geocode",
      "autocomplete",
      "autocomplete",
    ]);
  });
});

describe("compare", () => {
  const here = place({ location: { lat: 43.6489, lon: -79.3789 } });
  const near = place({
    id: "other",
    location: { lat: 43.649, lon: -79.3789 },
    address: { ...here.address, locality: "TORONTO", postcode: "M5H 1A1" },
  });
  const far = place({ type: "street", location: { lat: 43.7, lon: -79.4 } });

  it("diffs two answers", () => {
    const same = compareResults([here], [near]);
    expect(same.agree).toBe(true);
    expect(same.topDistance).toBeGreaterThan(10);
    expect(same.topDistance).toBeLessThan(12);
    // Case differs but the text is the same, so only the postcode is reported.
    expect(same.address).toEqual({ postcode: { primary: null, candidate: "M5H 1A1" } });
    expect(same.missing).toEqual([]);
    const differ = compareResults([here, near], [far]);
    expect(differ.agree).toBe(false);
    expect(differ.type).toEqual({ primary: "address", candidate: "street" });
    expect(differ.counts).toEqual({ primary: 2, candidate: 1 });
    expect(differ.missing).toEqual([0, 1]);
    expect(compareResults([], [far]).topDistance).toBeNull();
  });

  it("runs the candidate on the same request and reports, without changing the answer", async () => {
    const primary = fakeAdapter("google", () => ({ results: [here] }));
    const candidate = fakeAdapter("og", () => ({ results: [near] }));
    const reports: CompareReport[] = [];
    const geo = new Geocoder({
      adapter: primary,
      plugins: [
        compare({ with: candidate, onReport: (report) => reports.push(report), wait: true }),
      ],
    });
    const result = await geo.geocode("10 King St W", { limit: 1 });
    expect(result.provider).toBe("google");
    expect(candidate.native.calls[0]!.request).toEqual(primary.native.calls[0]!.request);
    expect(reports).toHaveLength(1);
    expect(reports[0]!.primary.provider).toBe("google");
    expect(reports[0]!.candidate.provider).toBe("og");
    expect(reports[0]!.candidate.ms).toBeGreaterThanOrEqual(0);
    expect(reports[0]!.comparison?.agree).toBe(true);
  });

  it("never lets the candidate fail or slow the call", async () => {
    const gate: { open: () => void } = { open: () => {} };
    const slow = new Promise<void>((resolve) => (gate.open = resolve));
    const candidate = fakeAdapter("og", async () => {
      await slow;
      throw new APIConnectionError("og down");
    });
    const reports: CompareReport[] = [];
    const geo = new Geocoder({
      adapter: fakeAdapter("google", () => ({ results: [here] })),
      plugins: [compare({ with: candidate, onReport: (report) => reports.push(report) })],
    });
    expect((await geo.geocode("x")).results).toHaveLength(1);
    expect(reports).toHaveLength(0);
    gate.open();
    await vi.waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0]!.candidate.error?.code).toBe("connection");
    expect(reports[0]!.comparison).toBeUndefined();
  });

  it("still throws the primary's error, and skips operations and samples left out", async () => {
    const candidate = fakeAdapter("og", () => ({}));
    const onReport = vi.fn();
    const failing = new Geocoder({
      adapter: fakeAdapter("google", () => Promise.reject(new APIConnectionError("down"))),
      plugins: [compare({ with: candidate, onReport, wait: true })],
    });
    await expect(failing.geocode("x")).rejects.toMatchObject({ code: "connection" });
    expect(onReport).toHaveBeenCalledTimes(1);

    const quiet = new Geocoder({
      adapter: fakeAdapter("google", () => ({})),
      plugins: [compare({ with: candidate, onReport, sample: 0 })],
    });
    await quiet.geocode("x");
    const typing = new Geocoder({
      adapter: fakeAdapter("google", () => ({})),
      plugins: [compare({ with: candidate, onReport, wait: true })],
    });
    await typing.autocomplete("x");
    expect(onReport).toHaveBeenCalledTimes(1);
  });
});
