import { createAutocomplete, type Autocomplete, type State } from "@open-geocode/autocomplete-core";
import {
  createClient,
  type AutocompleteParams,
  type Client,
  type ForwardCollection,
} from "@open-geocode/client";

/** One suggestion, as og returns it. */
export type Suggestion = ForwardCollection["features"][number];

/** Fired when the user picks a suggestion. `detail` is the suggestion. */
export type OgSelectEvent = CustomEvent<Suggestion>;

/** A `getItems` for `@open-geocode/autocomplete-core` that asks og's `/autocomplete`. */
export function ogItems(
  client: Client,
  params: Omit<AutocompleteParams, "q"> = {},
): (query: string, context: { signal: AbortSignal }) => Promise<Suggestion[]> {
  return async (q, { signal }) =>
    (await client.autocomplete({ ...params, q }, { signal })).features;
}

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
 * `<og-autocomplete>`: an input that suggests addresses and places from og as the user types.
 * Built on `@open-geocode/autocomplete-core`, which owns the state, keyboard and ARIA.
 *
 * Attributes: `base-url` (required), `placeholder`, `limit`, `country`, `layer`, `focus`,
 * `debounce` (ms, default 150), `min-chars` (default 2), `name` (form field name).
 * Fires `og-select` with the chosen suggestion, and `og-error` when og fails.
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
  ];

  readonly #internals: ElementInternals;
  readonly #input: HTMLInputElement;
  readonly #list: HTMLUListElement;
  #core: Autocomplete<Suggestion> | undefined;
  #client: Client | undefined;
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
      // Rebuild with the new settings on the next keystroke.
      if (name === "base-url") this.#client = undefined;
      this.#core?.destroy();
      this.#core = undefined;
      this.#paint(this.#ensureCore().getState());
    }
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

  #ensureCore(): Autocomplete<Suggestion> {
    if (this.#core) return this.#core;
    const params: Omit<AutocompleteParams, "q"> = { limit: this.#number("limit", 5) };
    for (const name of ["country", "layer", "focus"] as const) {
      const value = this.getAttribute(name);
      if (value) Object.assign(params, { [name]: value });
    }
    const baseUrl = this.getAttribute("base-url");
    if (baseUrl) this.#client ??= createClient({ baseUrl });
    const client = this.#client;
    this.#core = createAutocomplete<Suggestion>({
      getItems: client ? ogItems(client, params) : async () => [],
      getItemLabel: (item) => item.properties.label,
      debounce: this.#number("debounce", 150),
      minLength: this.#number("min-chars", 2),
      onSelect: (item) => {
        this.value = item.properties.label;
        this.dispatchEvent(
          new CustomEvent("og-select", { detail: item, bubbles: true, composed: true }),
        );
      },
      onStateChange: (state) => {
        this.#paint(state);
        if (state.status === "error")
          this.dispatchEvent(new CustomEvent("og-error", { detail: state.error }));
      },
    });
    return this.#core;
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
          li.textContent = item.properties.label;
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
