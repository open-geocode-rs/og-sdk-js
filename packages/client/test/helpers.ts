import { vi } from "vitest";
import type { Mock } from "vitest";

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

/** The headers of the nth request a fake fetch received, with lower-case names. */
export function headersOf(fetch: Fetch, call = 0): Record<string, string> {
  const headers = fetch.mock.calls[call]![1]?.headers as Record<string, string> | undefined;
  return Object.fromEntries(Object.entries(headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
}

/** The JSON body of the nth request a fake fetch received. */
export function bodyOf(fetch: Fetch, call = 0): unknown {
  return JSON.parse(String(fetch.mock.calls[call]![1]?.body));
}
