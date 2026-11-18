import { describe, expect, it, vi } from "vitest";
import {
  APIConnectionTimeoutError,
  APIUserAbortError,
  createClient,
  Geocoder,
  type GeocoderError,
} from "../src/index.ts";
import { og } from "../src/og.ts";

type Fetch = typeof globalThis.fetch;

/** A fetch that never answers, and fails as a real one does when its signal fires. */
const hanging = (failWith?: (signal: AbortSignal) => unknown) =>
  vi.fn<Fetch>(
    (_input, init) =>
      new Promise((_resolve, reject) => {
        const signal = init!.signal!;
        const fail = (): void => reject(failWith ? failWith(signal) : signal.reason);
        if (signal.aborted) fail();
        else signal.addEventListener("abort", fail, { once: true });
      }),
  );

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const empty = {
  type: "FeatureCollection",
  geocoding: { version: "1", attribution: [] },
  features: [],
};
const quiet = { logLevel: "off" } as const;
const caught = async (promise: PromiseLike<unknown>): Promise<GeocoderError> =>
  (await Promise.resolve(promise).then(
    () => {
      throw new Error("the call did not fail");
    },
    (error: unknown) => error,
  )) as GeocoderError;

describe("cancellation by the caller", () => {
  it("ends the request as aborted, with the signal's own reason as the cause", async () => {
    const fetch = hanging();
    const controller = new AbortController();
    const call = createClient({ baseUrl: "http://og.test", fetch, ...quiet }).geocode(
      { q: "x" },
      { signal: controller.signal },
    );
    controller.abort();
    const error = await caught(call);
    expect(error).toBeInstanceOf(APIUserAbortError);
    expect(error.cause).toBe(controller.signal.reason);
    expect((error.cause as DOMException).name).toBe("AbortError");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("is aborted through a Geocoder, never retried, and never sent when already cancelled", async () => {
    const fetch = hanging();
    const geo = new Geocoder({
      adapter: og({ baseUrl: "http://og.test", fetch, maxRetries: 5, ...quiet }),
    });
    const controller = new AbortController();
    const call = geo.geocode("x", { signal: controller.signal });
    controller.abort();
    const error = await caught(call);
    expect(error.code).toBe("aborted");
    expect(error.retryable).toBe(false);
    expect(error.cause).toBeInstanceOf(APIUserAbortError);
    expect(fetch).toHaveBeenCalledTimes(1);

    const late = await caught(geo.geocode("x", { signal: AbortSignal.abort() }));
    expect(late.code).toBe("aborted");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("counts a caller's own timeout signal as a timeout", async () => {
    const fetch = hanging();
    const geo = new Geocoder({
      adapter: og({ baseUrl: "http://og.test", fetch, maxRetries: 3, ...quiet }),
    });
    const error = await caught(geo.geocode("x", { signal: AbortSignal.timeout(10) }));
    expect(error.code).toBe("timeout");
    expect(error.cause).toBeInstanceOf(APIConnectionTimeoutError);
    expect(((error.cause as Error).cause as DOMException).name).toBe("TimeoutError");
    // The caller's signal ends the call, so no retry follows it.
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("the timeout", () => {
  it("ends the request as a timeout, with the signal's TimeoutError as the cause", async () => {
    const fetch = hanging();
    const geo = new Geocoder({
      adapter: og({ baseUrl: "http://og.test", fetch, maxRetries: 0, ...quiet }),
      timeout: 10,
    });
    const error = await caught(geo.geocode("x"));
    expect(error.code).toBe("timeout");
    expect(error.message).toBe("og did not answer within 10 ms.");
    const transport = error.cause as APIConnectionTimeoutError;
    expect(transport).toBeInstanceOf(APIConnectionTimeoutError);
    expect((transport.cause as DOMException).name).toBe("TimeoutError");
  });

  it("is still a timeout where the runtime reports it as an AbortError", async () => {
    // Some browsers fail a fetch whose timeout signal fired with an AbortError.
    const fetch = hanging(asAbortError);
    const geo = new Geocoder({
      adapter: og({ baseUrl: "http://og.test", fetch, maxRetries: 0, ...quiet }),
    });
    const error = await caught(geo.geocode("x", { timeout: 10 }));
    expect(error.code).toBe("timeout");
    expect(error.cause).toBeInstanceOf(APIConnectionTimeoutError);
    // The cause is the signal's own reason, which says what happened.
    expect(((error.cause as Error).cause as DOMException).name).toBe("TimeoutError");
  });

  it("is retried, unlike a caller's abort", async () => {
    let calls = 0;
    const slowOnce = vi.fn<Fetch>((input, init) =>
      calls++ === 0 ? hanging()(input, init) : Promise.resolve(json(empty)),
    );
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    try {
      const client = createClient({
        baseUrl: "http://og.test",
        fetch: slowOnce,
        timeout: 10,
        maxRetries: 1,
        ...quiet,
      });
      const started = Date.now();
      await client.geocode({ q: "x" });
      expect(slowOnce).toHaveBeenCalledTimes(2);
      expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("sets no limit when it is Infinity or 0, and passes the caller's signal alone", async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    const fetch = vi.fn<Fetch>(async (_input, init) => {
      seen.push(init?.signal);
      return json(empty);
    });
    const client = createClient({ baseUrl: "http://og.test", fetch, ...quiet });
    const { signal } = new AbortController();
    await client.geocode({ q: "x" }, { timeout: Infinity });
    await client.geocode({ q: "x" }, { timeout: 0, signal });
    await client.geocode({ q: "x" }, { timeout: 50, signal });
    expect(seen[0]).toBeUndefined();
    expect(seen[1]).toBe(signal);
    expect(seen[2]).not.toBe(signal);
    expect(seen[2]).toBeInstanceOf(AbortSignal);
  });
});

const asAbortError = () => new DOMException("The operation was aborted.", "AbortError");

describe("a caller's abort and the timeout racing", () => {
  it("is read by the signal that fired first, whichever error the runtime throws", async () => {
    // The caller aborts first, then the timeout also fires before the error is read.
    const callerFirst = new AbortController();
    const first = createClient({
      baseUrl: "http://og.test",
      fetch: hanging(asAbortError),
      ...quiet,
    }).geocode({ q: "x" }, { signal: callerFirst.signal, timeout: 30, maxRetries: 0 });
    setTimeout(() => callerFirst.abort(), 5);
    expect(await caught(first)).toBeInstanceOf(APIUserAbortError);

    // The timeout fires first, and the caller aborts in the same instant it is handled.
    const timerFirst = new AbortController();
    const fetch = hanging((signal) => {
      timerFirst.abort();
      return signal.reason;
    });
    const second = await caught(
      new Geocoder({
        adapter: og({ baseUrl: "http://og.test", fetch, maxRetries: 3, ...quiet }),
      }).geocode("x", {
        signal: timerFirst.signal,
        timeout: 10,
      }),
    );
    expect(second.code).toBe("timeout");
    // The caller has given up by then, so the timeout is not retried.
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("an abort during a wait", () => {
  it("stops a retry wait at once, and sends no further attempt", async () => {
    const fetch = vi.fn<Fetch>(async () => json({}, 503));
    const controller = new AbortController();
    const client = createClient({ baseUrl: "http://og.test", fetch, maxRetries: 5, ...quiet });
    const started = Date.now();
    const call = client.geocode({ q: "x" }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    const error = await caught(call);
    expect(error).toBeInstanceOf(APIUserAbortError);
    expect(fetch).toHaveBeenCalledTimes(1);
    // The first retry wait is at least 375 ms, so the call ended inside it.
    expect(Date.now() - started).toBeLessThan(300);
  });

  it("stops the polling of a job", async () => {
    const fetch = vi.fn<Fetch>(async () => json({ id: "j1", status: "running" }));
    const controller = new AbortController();
    const client = createClient({ baseUrl: "http://og.test", fetch, ...quiet });
    const wait = client.jobs.wait("j1", { signal: controller.signal, interval: 10_000 });
    setTimeout(() => controller.abort(), 20);
    const error = await caught(wait);
    expect(error).toBeInstanceOf(APIUserAbortError);
    expect((error.cause as DOMException).name).toBe("AbortError");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("stops an emulated batch, and fails each item left as aborted", async () => {
    const controller = new AbortController();
    let calls = 0;
    const fetch = vi.fn<Fetch>((input, init) => {
      if (calls++ === 0) return Promise.resolve(json(empty));
      controller.abort();
      return hanging()(input, init);
    });
    const adapter = og({ baseUrl: "http://og.test", fetch, maxRetries: 3, ...quiet });
    // Without a batch of its own, the adapter's batch runs as single calls.
    delete adapter.batch;
    delete adapter.capabilities.batch;
    const batch = await new Geocoder({ adapter }).batch.geocode(["a", "b", "c", "d"], {
      concurrency: 1,
      signal: controller.signal,
    });
    expect(batch.mode).toBe("emulated");
    expect(batch.items.map((item) => item.error?.code ?? "ok")).toEqual([
      "ok",
      "aborted",
      "aborted",
      "aborted",
    ]);
    // The third and fourth items were never sent.
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("stops a native batch while its job runs, and still removes the job", async () => {
    const controller = new AbortController();
    const fetch = vi.fn<Fetch>((input, init) => {
      const url = String(input);
      if (init?.method === "POST")
        return Promise.resolve(json({ id: "j1", status: "running" }, 202));
      if (init?.method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
      if (url.endsWith("/results")) {
        setTimeout(() => controller.abort(), 10);
        return hanging()(input, init);
      }
      return Promise.resolve(json({ id: "j1", status: "running" }));
    });
    const geo = new Geocoder({ adapter: og({ baseUrl: "http://og.test", fetch, ...quiet }) });
    const error = await caught(geo.batch.geocode(["a"], { signal: controller.signal }));
    expect(error.code).toBe("aborted");
    expect(error.operation).toBe("batch.geocode");
    expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "GET", "DELETE"]);
  });
});

describe("a body cut short", () => {
  it("fails as the timeout that cut it, not as a parse error", async () => {
    const fetch = vi.fn<Fetch>(async (_input, init) => {
      const signal = init!.signal!;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"type":'));
          signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
        },
      });
      return new Response(body, { headers: { "content-type": "application/json" } });
    });
    const geo = new Geocoder({
      adapter: og({ baseUrl: "http://og.test", fetch, maxRetries: 0, ...quiet }),
    });
    const error = await caught(geo.geocode("x", { timeout: 20 }));
    expect(error.code).toBe("timeout");
    expect(error.cause).toBeInstanceOf(APIConnectionTimeoutError);
  });
});
