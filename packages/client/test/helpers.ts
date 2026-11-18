import { vi } from "vitest";
import type { Mock } from "vitest";
import {
  type Adapter,
  type AdapterResult,
  emptyAddress,
  type PlaceRecord,
  type ProviderId,
} from "../src/index.ts";

export type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };
export type Fetch = Mock<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>;

/** A fake fetch that answers with each reply in turn, and the last one from then on. */
export function fakeFetch(...replies: Reply[]): Fetch {
  let call = 0;
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const reply = replies[Math.min(call++, replies.length - 1)]!;
    const body = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? {});
    return new Response(body, {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  });
}

/** The URL of the nth request a fake fetch received. */
export function urlOf(fetch: Fetch, call = 0): URL {
  return new URL(String(fetch.mock.calls[call]![0]));
}

/** A place with every default field set, for tests to override. */
export function place(overrides: Partial<PlaceRecord> = {}): PlaceRecord {
  return {
    id: "p1",
    type: "address",
    name: "10 King St W",
    label: "10 King St W, Toronto",
    location: { lat: 43.6489, lon: -79.3789 },
    accuracy: "rooftop",
    confidence: 0.9,
    distance: null,
    address: { ...emptyAddress(), houseNumber: "10", street: "King St W", locality: "Toronto" },
    ...overrides,
  };
}

/** An adapter that answers every operation from `answer`, and records the requests it was sent. */
export function fakeAdapter(
  id: ProviderId,
  answer: (operation: string, request: unknown) => Partial<AdapterResult> | Promise<never>,
  overrides: Partial<Adapter> = {},
): Adapter<{ calls: { operation: string; request: unknown }[] }> {
  const calls: { operation: string; request: unknown }[] = [];
  const run = (operation: string) => async (request: unknown) => {
    calls.push({ operation, request });
    const result = await answer(operation, request);
    return { results: [], raw: { from: id }, response: new Response("{}"), ...result };
  };
  const all = {
    options: ["limit", "language", "focus"],
    fields: ["id", "location", "address"],
  } as const;
  return {
    id,
    native: { calls },
    capabilities: {
      geocode: all,
      reverse: all,
      autocomplete: { ...all, coordinates: true },
      places: all,
      lookup: all,
      cache: { maxTtl: Infinity },
    },
    geocode: run("geocode"),
    reverse: run("reverse"),
    autocomplete: run("autocomplete"),
    places: run("places"),
    lookup: run("lookup"),
    ...overrides,
  } as Adapter<{ calls: { operation: string; request: unknown }[] }>;
}
