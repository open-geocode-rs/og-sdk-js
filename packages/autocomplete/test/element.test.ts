import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../src/index.ts";
import { mapboxSource } from "@open-geocode/autocomplete-core";
import { mapbox } from "@open-geocode/client/mapbox";
import type { OgAutocomplete, OgSelectEvent } from "../src/index.ts";

const feature = (label: string) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [-79.38, 43.65] },
  properties: { id: `osm:node:${label.length}`, layer: "address", label, name: label },
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

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
    const { detail } = await picked;
    expect(detail.label).toBe("10 King St E, Toronto");
    expect(detail.location).toEqual({ lat: 43.65, lon: -79.38 });
    expect(el.value).toBe("10 King St E, Toronto");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("passes its attributes on as og parameters", async () => {
    const { el, input } = await mount();
    el.setAttribute("limit", "3");
    el.setAttribute("country", "ca, us");
    el.setAttribute("layer", "address");
    el.setAttribute("focus", "-79.38,43.65");
    el.setAttribute("lang", "fr, en");
    await type(input, "10 King");
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "10 King",
      limit: "3",
      country: "CA,US",
      layer: "address",
      focus: "-79.38,43.65",
      lang: "fr,en",
    });
  });

  it("works with a vendor client's source, and fetches coordinates a suggestion came without", async () => {
    fetch.mockImplementation(async (url: string) =>
      new URL(url).pathname.endsWith("/suggest")
        ? json({ suggestions: [{ mapbox_id: "a", name: "1 High St", place_formatted: "London" }] })
        : json({
            type: "FeatureCollection",
            features: [
              { type: "Feature", geometry: { type: "Point", coordinates: [-0.12, 51.5] } },
            ],
          }),
    );
    const el = document.createElement("og-autocomplete") as OgAutocomplete;
    el.setAttribute("debounce", "0");
    el.source = mapboxSource(mapbox({ baseUrl: "http://og.test" }));
    document.body.append(el);
    const input = el.shadowRoot!.querySelector("input")!;
    const picked = new Promise<OgSelectEvent>((resolve) =>
      el.addEventListener("og-select", (e) => resolve(e as OgSelectEvent)),
    );
    await type(input, "1 High");
    expect(el.shadowRoot!.querySelector("li")!.textContent).toBe("1 High St, London");
    el.shadowRoot!.querySelector("li")!.click();
    const { detail } = await picked;
    expect(detail.id).toBe("a");
    expect(detail.location).toEqual({ lat: 51.5, lon: -0.12 });
    // The keystroke and the lookup that ends the search share one session.
    const urls = fetch.mock.calls.map(([url]) => new URL(String(url)));
    expect(urls.map((url) => url.pathname)).toEqual([
      "/compat/mapbox/search/searchbox/v1/suggest",
      "/compat/mapbox/search/searchbox/v1/retrieve/a",
    ]);
    expect(urls[0]!.searchParams.get("session_token")).toBeTruthy();
    expect(urls[1]!.searchParams.get("session_token")).toBe(
      urls[0]!.searchParams.get("session_token"),
    );
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
