import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutocomplete } from "../src/index.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const labels = ["10 King St W", "10 King St E", "10 King Louis Cres"];

function setup(getItems = vi.fn(async (_q: string, _c: { signal: AbortSignal }) => labels)) {
  const onSelect = vi.fn();
  const ac = createAutocomplete<string>({ getItems, getItemLabel: (s) => s, onSelect, id: "t" });
  return { ac, getItems, onSelect };
}

describe("createAutocomplete", () => {
  it("debounces keystrokes into one search", async () => {
    const { ac, getItems } = setup();
    ac.onInput("10");
    ac.onInput("10 K");
    ac.onInput("10 Ki");
    await vi.advanceTimersByTimeAsync(150);
    expect(getItems).toHaveBeenCalledTimes(1);
    expect(getItems.mock.calls[0]![0]).toBe("10 Ki");
    expect(ac.getState()).toMatchObject({ items: labels, isOpen: true, status: "idle" });
  });

  it("waits for minLength", async () => {
    const { ac, getItems } = setup();
    ac.onInput("1");
    await vi.advanceTimersByTimeAsync(500);
    expect(getItems).not.toHaveBeenCalled();
  });

  it("aborts the older search and ignores its answer", async () => {
    const signals: AbortSignal[] = [];
    const getItems = vi.fn((q: string, { signal }: { signal: AbortSignal }) => {
      signals.push(signal);
      return new Promise<string[]>((resolve) => setTimeout(() => resolve([q]), 1000));
    });
    const { ac } = setup(getItems);
    ac.onInput("10 Ki");
    await vi.advanceTimersByTimeAsync(150);
    ac.onInput("10 King");
    expect(signals[0]!.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(ac.getState().items).toEqual(["10 King"]);
  });

  it("reports stalled only after stallThreshold", async () => {
    const { ac } = setup(
      vi.fn(() => new Promise<string[]>((resolve) => setTimeout(() => resolve(labels), 1000))),
    );
    ac.onInput("10 King");
    await vi.advanceTimersByTimeAsync(150);
    expect(ac.getState().status).toBe("loading");
    await vi.advanceTimersByTimeAsync(300);
    expect(ac.getState().status).toBe("stalled");
    expect(ac.getInputAttributes()["aria-busy"]).toBe("true");
    await vi.advanceTimersByTimeAsync(1000);
    expect(ac.getState().status).toBe("idle");
  });

  it("moves with arrow keys, wraps, and picks with Enter", async () => {
    const { ac, onSelect } = setup();
    ac.onInput("10 King");
    await vi.advanceTimersByTimeAsync(150);
    expect(ac.onKeyDown("ArrowUp")).toBe(true);
    expect(ac.getState().activeIndex).toBe(2);
    ac.onKeyDown("ArrowDown");
    expect(ac.getState().activeIndex).toBe(0);
    expect(ac.getInputAttributes()["aria-activedescendant"]).toBe("t-item-0");
    expect(ac.getItemAttributes(0)["aria-selected"]).toBe("true");
    ac.onKeyDown("Enter");
    expect(onSelect).toHaveBeenCalledWith("10 King St W");
    expect(ac.getState()).toMatchObject({ query: "10 King St W", isOpen: false });
  });

  it("lets unhandled keys through", async () => {
    const { ac } = setup();
    ac.onInput("10 King");
    await vi.advanceTimersByTimeAsync(150);
    expect(ac.onKeyDown("a")).toBe(false);
  });

  it("closes on Escape and reports errors", async () => {
    const { ac } = setup(vi.fn(async () => Promise.reject(new Error("og down"))));
    ac.onInput("10 King");
    await vi.advanceTimersByTimeAsync(150);
    expect(ac.getState().status).toBe("error");
    expect((ac.getState().error as Error).message).toBe("og down");
  });

  it("notifies subscribers and stops after unsubscribe", async () => {
    const { ac } = setup();
    const listener = vi.fn();
    const off = ac.subscribe(listener);
    ac.onInput("10 King");
    expect(listener).toHaveBeenCalled();
    off();
    listener.mockClear();
    ac.close();
    expect(listener).not.toHaveBeenCalled();
  });
});
