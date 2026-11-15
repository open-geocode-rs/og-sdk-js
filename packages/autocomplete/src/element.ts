import {
  createAutocomplete,
  geocoderSource,
  type Autocomplete,
  type GeocoderSource,
  type State,
} from "@open-geocode/autocomplete-core";
import { Geocoder, type Place, type PlaceType, type SearchOptions } from "@open-geocode/client";
import { og } from "@open-geocode/client/og";

/** One suggestion, in the unified format every adapter answers in. */
export type Suggestion = Place;

/** Fired when the user picks a suggestion. `detail` is the suggestion, with its coordinates. */
export type OgSelectEvent = CustomEvent<Suggestion>;

/** The search options the element passes on with every keystroke. */
export type SuggestOptions = Omit<SearchOptions, "signal" | "session" | "include">;

const STYLE = `
:host { display: block; position: relative; font: inherit; }
input { box-sizing: border-box; width: 100%; font: inherit; padding: 0.5em 0.75em; }
ul { position: absolute; z-index: 10; left: 0; right: 0; margin: 2px 0 0; padding: 0; list-style: none;
  background: Canvas; color: CanvasText; border: 1px solid GrayText; border-radius: 4px; max-height: 18em; overflow-y: auto; }
ul[hidden] { display: none; }
li { padding: 0.45em 0.75em; cursor: pointer; }
li[aria-selected="true"] { background: Highlight; color: HighlightText; }
`;

/**
 * `<og-autocomplete>` is an input that suggests addresses and places as the user types.
 * Built on `@open-geocode/autocomplete-core`, which owns the state, keyboard and ARIA.
 *
 * It asks og when `base-url` is set, or any provider when the `geocoder` property is set
 * to a `Geocoder` built with that provider's adapter.
 *
 * Its attributes are `base-url`, `placeholder`, `limit`, `country` (comma-separated ISO codes),
 * `types` (comma-separated result types), `focus` (`lon,lat`), `language`,
 * `debounce` (ms, default 150), `min-chars` (default 2), `name` (form field name).
 * Fires `og-select` with the chosen suggestion, and `og-error` when the provider fails.
 * A provider that suggests without coordinates is asked for them when the user picks.
 * Inside a `<form>`, its value is the chosen label.
 * Style it from outside with `::part(input)`, `::part(list)` and `::part(option)`.
 * While a search is slow, the host gets a `stalled` attribute for a spinner.
 */
export class OgAutocomplete extends HTMLElement {
  static formAssociated = true;
  static readonly observedAttributes: string[] = [
    "placeholder",
    "base-url",
    "debounce",
    "min-chars",
    "limit",
    "country",
    "types",
    "focus",
    "language",
  ];

  readonly #internals: ElementInternals;
  readonly #input: HTMLInputElement;
  readonly #list: HTMLUListElement;
  #core: Autocomplete<Suggestion> | undefined;
  #geocoder: Geocoder | undefined;
  #own: Geocoder | undefined;
  #source: GeocoderSource<Suggestion> | undefined;
  #painted: Suggestion[] | undefined;

  constructor() {
    super();
    this.#internals = this.attachInternals();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${STYLE}</style><input part="input" type="text"><ul part="list" hidden></ul>`;
    this.#input = root.querySelector("input")!;
    this.#list = root.querySelector("ul")!;
    this.#input.addEventListener("input", () => {
      this.#internals.setFormValue(this.#input.value);
      this.#ensureCore().onInput(this.#input.value);
    });
    this.#input.addEventListener("keydown", (event) => {
      if (this.#ensureCore().onKeyDown(event.key)) event.preventDefault();
    });
    this.#input.addEventListener("blur", () => this.#core?.onBlur());
    this.#list.addEventListener("pointerdown", (event) => event.preventDefault());
    this.#list.addEventListener("click", (event) => {
      const item = (event.target as Element).closest("li");
      if (item) this.#core?.select(Number(item.dataset["index"]));
    });
    this.#list.addEventListener("pointermove", (event) => {
      const item = (event.target as Element).closest("li");
      if (item) this.#core?.setActiveIndex(Number(item.dataset["index"]));
    });
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (name === "placeholder") this.#input.placeholder = value ?? "";
    else {
      if (name === "base-url") this.#own = undefined;
      this.#rebuild();
    }
  }

  /**
   * The geocoder that answers. Set it to use any provider.
   * When unset, the element asks the og server at `base-url`.
   */
  get geocoder(): Geocoder | undefined {
    return this.#geocoder;
  }

  set geocoder(geocoder: Geocoder | undefined) {
    this.#geocoder = geocoder;
    this.#rebuild();
  }

  /** Rebuilds with the new settings, so the next keystroke uses them. */
  #rebuild(): void {
    this.#core?.destroy();
    this.#core = undefined;
    this.#paint(this.#ensureCore().getState());
  }

  disconnectedCallback(): void {
    this.#core?.destroy();
    this.#core = undefined;
  }

  /** The text in the input. */
  get value(): string {
    return this.#input.value;
  }

  set value(text: string) {
    this.#input.value = text;
    this.#internals.setFormValue(text);
  }

  #number(name: string, fallback: number): number {
    const value = Number(this.getAttribute(name));
    return this.hasAttribute(name) && Number.isFinite(value) ? value : fallback;
  }

  #options(): SuggestOptions {
    const options: SuggestOptions = { limit: this.#number("limit", 5) };
    const list = (name: string): string[] | undefined => {
      const items = (this.getAttribute(name) ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      return items.length > 0 ? items : undefined;
    };
    const countries = list("country");
    if (countries) options.countries = countries;
    const types = list("types");
    if (types) options.types = types as PlaceType[];
    const language = list("language");
    if (language) options.language = language;
    const [lon, lat] = (list("focus") ?? []).map(Number);
    if (lon !== undefined && lat !== undefined && Number.isFinite(lon) && Number.isFinite(lat))
      options.focus = { lat, lon };
    return options;
  }

  #ensureCore(): Autocomplete<Suggestion> {
    if (this.#core) return this.#core;
    const baseUrl = this.getAttribute("base-url");
    if (!this.#geocoder && baseUrl) this.#own ??= new Geocoder({ adapter: og({ baseUrl }) });
    const geocoder = this.#geocoder ?? this.#own;
    const source = geocoder ? geocoderSource(geocoder, this.#options()) : undefined;
    this.#source = source;
    const core = createAutocomplete<Suggestion>({
      getItems: source ? source.getItems : async () => [],
      getItemLabel: (item) => item.label,
      debounce: this.#number("debounce", 150),
      minLength: this.#number("min-chars", 2),
      onSelect: (item) => {
        this.value = item.label;
        void this.#select(item, source);
      },
      onStateChange: (state) => {
        this.#paint(state);
        if (state.status === "error")
          this.dispatchEvent(new CustomEvent("og-error", { detail: state.error }));
      },
    });
    this.#core = core;
    return core;
  }

  /** Fires `og-select`, after fetching the coordinates of a suggestion that came without them. */
  async #select(item: Suggestion, source: GeocoderSource<Suggestion> | undefined): Promise<void> {
    let detail = item;
    try {
      if (source) detail = await source.resolve(item);
    } catch (error) {
      this.dispatchEvent(new CustomEvent("og-error", { detail: error }));
      return;
    }
    // A newer geocoder or setting replaced this one while the lookup ran.
    if (source !== this.#source) return;
    this.dispatchEvent(new CustomEvent("og-select", { detail, bubbles: true, composed: true }));
  }

  #paint(state: State<Suggestion>): void {
    const core = this.#core;
    if (!core) return;
    const inputAttributes = core.getInputAttributes();
    for (const [name, value] of Object.entries(inputAttributes))
      this.#input.setAttribute(name, value);
    if (!("aria-activedescendant" in inputAttributes))
      this.#input.removeAttribute("aria-activedescendant");
    for (const [name, value] of Object.entries(core.getListAttributes()))
      this.#list.setAttribute(name, value);
    if (this.#painted !== state.items) {
      this.#painted = state.items;
      this.#list.replaceChildren(
        ...state.items.map((item, index) => {
          const li = document.createElement("li");
          li.setAttribute("part", "option");
          li.dataset["index"] = String(index);
          li.textContent = item.label;
          return li;
        }),
      );
    }
    for (const [index, li] of Array.from(this.#list.children).entries()) {
      for (const [name, value] of Object.entries(core.getItemAttributes(index)))
        li.setAttribute(name, value);
    }
    if (state.activeIndex !== null)
      (this.#list.children[state.activeIndex] as HTMLElement | undefined)?.scrollIntoView({
        block: "nearest",
      });
    this.#list.hidden = !state.isOpen;
    this.toggleAttribute("stalled", state.status === "stalled");
  }
}
