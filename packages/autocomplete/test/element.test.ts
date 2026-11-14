import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../src/index.ts";
import type { OgAutocomplete, OgSelectEvent } from "../src/index.ts";

const feature = (label: string) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [-79.38, 43.65] },
  properties: { id: `osm:node:${label.length}`, layer: "address", label, name: label },
});

let fetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          type: "FeatureCollection",
          geocoding: {},
          features: [feature("10 King St W, Toronto"), feature("10 King St E, Toronto")],
        }),
        { headers: { "content-type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

async function mount(): Promise<{ el: OgAutocomplete; input: HTMLInputElement }> {
  const el = document.createElement("og-autocomplete") as OgAutocomplete;
  el.setAttribute("base-url", "http://og.test");
  el.setAttribute("debounce", "0");
  document.body.append(el);
  const input = el.shadowRoot!.querySelector("input")!;
  return { el, input };
}

async function type(input: HTMLInputElement, text: string): Promise<void> {
  input.focus();
  input.value = text;
  input.dispatchEvent(new Event("input"));
  await vi.waitFor(() => expect(input.getAttribute("aria-expanded")).toBe("true"));
}

describe("<og-autocomplete>", () => {
  it("asks og as the user types and lists the suggestions", async () => {
    const { el, input } = await mount();
    await type(input, "10 King");
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.pathname).toBe("/autocomplete");
    expect(url.searchParams.get("q")).toBe("10 King");
    const options = el.shadowRoot!.querySelectorAll("li");
    expect([...options].map((o) => o.textContent)).toEqual([
      "10 King St W, Toronto",
      "10 King St E, Toronto",
    ]);
  });

  it("does not search below min-chars", async () => {
    const { input } = await mount();
    input.value = "1";
    input.dispatchEvent(new Event("input"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("picks with the keyboard and fires og-select", async () => {
    const { el, input } = await mount();
    const picked = new Promise<OgSelectEvent>((resolve) =>
      el.addEventListener("og-select", (e) => resolve(e as OgSelectEvent)),
    );
    await type(input, "10 King");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect((await picked).detail.properties.label).toBe("10 King St E, Toronto");
    expect(el.value).toBe("10 King St E, Toronto");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("submits the chosen label with its form", async () => {
    const form = document.createElement("form");
    document.body.append(form);
    const { el, input } = await mount();
    el.setAttribute("name", "address");
    form.append(el);
    await type(input, "10 King");
    el.shadowRoot!.querySelector("li")!.click();
    expect(new FormData(form).get("address")).toBe("10 King St W, Toronto");
  });
});
