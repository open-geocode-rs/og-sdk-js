import {
  createAutocomplete,
  ogSource,
  type Autocomplete,
  type Source,
  type State,
  type Suggestion,
} from "@open-geocode/autocomplete-core";
import { type AutocompleteParams, createClient } from "@open-geocode/client";

export type { Suggestion };

/** Fired when the user picks a suggestion. `detail` is the suggestion, with its coordinates. */
export type OgSelectEvent = CustomEvent<Suggestion>;

/** The parameters the element sends to og with every keystroke, built from its attributes. */
export type SuggestParams = Omit<AutocompleteParams, "q">;

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
 * It asks the og server at `base-url`, or whatever its `source` property is set to,
 * which is how it works with a vendor client.
 *
 * Its attributes are `base-url`, `placeholder`, `debounce` (ms, default 150), `min-chars` (default 2)
 * and `name` (form field name).
 * The attributes `limit`, `country` (comma-separated ISO codes), `layer`, `focus` (`lon,lat`),
 * `bbox` and `lang` go to og with every keystroke, as og's own parameters.
 * A source of your own carries its own parameters, so they do not apply to it.
 * Fires `og-select` with the chosen suggestion, and `og-error` when the server fails.
 * An API that suggests without coordinates is asked for them when the user picks.
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
    "layer",
    "focus",
    "bbox",
    "lang",
  ];

  readonly #internals: ElementInternals;
  readonly #input: HTMLInputElement;
  readonly #list: HTMLUListElement;
  #core: Autocomplete<Suggestion> | undefined;
  #given: Source<Suggestion> | undefined;
  #source: Source<Suggestion> | undefined;
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
    else this.#rebuild();
  }

  /**
   * Where suggestions come from. Set it to a source from `@open-geocode/autocomplete-core`,
   * such as `mapboxSource(client)`, to use a vendor client.
   * When unset, the element asks the og server at `base-url`.
   */
  get source(): Source<Suggestion> | undefined {
    return this.#given;
  }

  set source(source: Source<Suggestion> | undefined) {
    this.#given = source;
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

  #params(): SuggestParams {
    const params: SuggestParams = { limit: this.#number("limit", 5) };
    for (const name of ["country", "layer", "focus", "bbox", "lang"] as const) {
      // A list written with spaces after its commas is still one og reads.
      const value = this.getAttribute(name)?.replace(/\s+/g, "");
      if (value)
        (params as Record<string, string>)[name] = name === "country" ? value.toUpperCase() : value;
    }
    return params;
  }

  #ensureCore(): Autocomplete<Suggestion> {
    if (this.#core) return this.#core;
    const baseUrl = this.getAttribute("base-url");
    const source: Source<Suggestion> | undefined =
      this.#given ?? (baseUrl ? ogSource(createClient({ baseUrl }), this.#params()) : undefined);
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
  async #select(item: Suggestion, source: Source<Suggestion> | undefined): Promise<void> {
    let detail = item;
    try {
      if (source) detail = await source.resolve(item);
    } catch (error) {
      this.dispatchEvent(new CustomEvent("og-error", { detail: error }));
      return;
    }
    // A newer source or setting replaced this one while the lookup ran.
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
