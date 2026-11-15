import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../src/index.ts";
import { emptyAddress, Geocoder, type Adapter, type PlaceRecord } from "@open-geocode/client";
import type { OgAutocomplete, OgSelectEvent } from "../src/index.ts";

const feature = (label: string) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [-79.38, 43.65] },
  properties: { id: `osm:node:${label.length}`, layer: "address", label, name: label },
});

const suggestion = (id: string, label: string, located: boolean): PlaceRecord => ({
  id,
  type: "address",
  name: label,
  label,
  location: located ? { lat: 51.5, lon: -0.12 } : null,
  accuracy: null,
  confidence: null,
  distance: null,
  address: emptyAddress(),
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
    const { detail } = await picked;
    expect(detail.label).toBe("10 King St E, Toronto");
    expect(detail.location).toEqual({ lat: 43.65, lon: -79.38 });
    expect(el.value).toBe("10 King St E, Toronto");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("passes its attributes on as search options", async () => {
    const { el, input } = await mount();
    el.setAttribute("limit", "3");
    el.setAttribute("country", "ca, us");
    el.setAttribute("types", "address,street");
    el.setAttribute("focus", "-79.38,43.65");
    el.setAttribute("language", "fr");
    await type(input, "10 King");
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "10 King",
      limit: "3",
      country: "CA,US",
      focus: "-79.38,43.65",
      lang: "fr",
    });
  });

  it("works with any adapter, and fetches coordinates a suggestion came without", async () => {
    const sessions: (string | undefined)[] = [];
    const fields = { options: ["limit", "session"], fields: ["id", "location"] } as const;
    const vendor: Adapter = {
      id: "vendor",
      native: undefined,
      capabilities: { autocomplete: { ...fields, coordinates: false }, lookup: fields },
      async autocomplete(request) {
        sessions.push(request.session);
        return {
          results: [suggestion("a", "1 High St, London", false)],
          raw: null,
          response: undefined,
        };
      },
      async lookup(request) {
        sessions.push(request.session);
        return {
          results: [suggestion(request.ids[0]!, "1 High St, London", true)],
          raw: null,
          response: undefined,
        };
      },
    };
    const el = document.createElement("og-autocomplete") as OgAutocomplete;
    el.setAttribute("debounce", "0");
    el.geocoder = new Geocoder({ adapter: vendor });
    document.body.append(el);
    const input = el.shadowRoot!.querySelector("input")!;
    const picked = new Promise<OgSelectEvent>((resolve) =>
      el.addEventListener("og-select", (e) => resolve(e as OgSelectEvent)),
    );
    await type(input, "1 High");
    expect(fetch).not.toHaveBeenCalled();
    el.shadowRoot!.querySelector("li")!.click();
    const { detail } = await picked;
    expect(detail.id).toBe("a");
    expect(detail.location).toEqual({ lat: 51.5, lon: -0.12 });
    // The keystroke and the lookup that ends the search share one session.
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toBeTruthy();
    expect(sessions[1]).toBe(sessions[0]);
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
