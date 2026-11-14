import { createClient, type Client, type ForwardCollection } from "@open-geocode/client";

/** One suggestion, as og returns it. */
export type Suggestion = ForwardCollection["features"][number];

/** Fired when the user picks a suggestion. `detail` is the suggestion. */
export type OgSelectEvent = CustomEvent<Suggestion>;

const STYLE = `
:host { display: block; position: relative; font: inherit; }
input { box-sizing: border-box; width: 100%; font: inherit; padding: 0.5em 0.75em; }
ul { position: absolute; z-index: 10; left: 0; right: 0; margin: 2px 0 0; padding: 0; list-style: none;
  background: Canvas; color: CanvasText; border: 1px solid GrayText; border-radius: 4px; max-height: 18em; overflow-y: auto; }
ul[hidden] { display: none; }
li { padding: 0.45em 0.75em; cursor: pointer; }
li[aria-selected="true"] { background: Highlight; color: HighlightText; }
`;

let nextId = 0;

/**
 * `<og-autocomplete>`: an input that suggests addresses and places from og as the user types.
 *
 * Attributes: `base-url` (required), `placeholder`, `limit`, `country`, `layer`, `focus`,
 * `debounce` (ms, default 150), `min-chars` (default 2), `name` (form field name).
 * Fires `og-select` with the chosen suggestion. Inside a `<form>`, its value is the chosen label.
 * Style it from outside with `::part(input)`, `::part(list)` and `::part(option)`.
 */
export class OgAutocomplete extends HTMLElement {
  static formAssociated = true;
  static readonly observedAttributes: string[] = ["placeholder", "base-url"];

  readonly #internals: ElementInternals;
  readonly #input: HTMLInputElement;
  readonly #list: HTMLUListElement;
  #client: Client | undefined;
  #results: Suggestion[] = [];
  #active = -1;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #pending: AbortController | undefined;

  constructor() {
    super();
    this.#internals = this.attachInternals();
    const root = this.attachShadow({ mode: "open" });
    const listId = `og-ac-list-${nextId++}`;
    root.innerHTML = `<style>${STYLE}</style>
<input part="input" type="text" role="combobox" autocomplete="off" spellcheck="false"
  aria-autocomplete="list" aria-expanded="false" aria-controls="${listId}">
<ul part="list" id="${listId}" role="listbox" hidden></ul>`;
    this.#input = root.querySelector("input")!;
    this.#list = root.querySelector("ul")!;
    this.#input.addEventListener("input", () => this.#schedule());
    this.#input.addEventListener("keydown", (event) => this.#onKey(event));
    this.#input.addEventListener("blur", () => this.#close());
    this.#list.addEventListener("pointerdown", (event) => event.preventDefault());
    this.#list.addEventListener("click", (event) => {
      const item = (event.target as Element).closest("li");
      if (item) this.#pick(Number(item.dataset["index"]));
    });
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (name === "placeholder") this.#input.placeholder = value ?? "";
    if (name === "base-url") this.#client = undefined;
  }

  /** The text in the input. */
  get value(): string {
    return this.#input.value;
  }

  set value(text: string) {
    this.#input.value = text;
    this.#internals.setFormValue(text);
  }

  #clientFor(): Client | undefined {
    const baseUrl = this.getAttribute("base-url");
    if (!baseUrl) return undefined;
    this.#client ??= createClient({ baseUrl });
    return this.#client;
  }

  #number(name: string, fallback: number): number {
    const value = Number(this.getAttribute(name));
    return Number.isFinite(value) && this.hasAttribute(name) ? value : fallback;
  }

  #schedule(): void {
    clearTimeout(this.#timer);
    this.#internals.setFormValue(this.#input.value);
    this.#timer = setTimeout(() => void this.#search(), this.#number("debounce", 150));
  }

  async #search(): Promise<void> {
    const q = this.#input.value.trim();
    const client = this.#clientFor();
    this.#pending?.abort();
    if (!client || q.length < this.#number("min-chars", 2)) {
      this.#render([]);
      return;
    }
    const pending = new AbortController();
    this.#pending = pending;
    const optional = (name: string): Record<string, string> => {
      const value = this.getAttribute(name);
      return value ? { [name]: value } : {};
    };
    try {
      const result = await client.autocomplete(
        {
          q,
          limit: this.#number("limit", 5),
          ...optional("country"),
          ...optional("layer"),
          ...optional("focus"),
        },
        { signal: pending.signal },
      );
      if (!pending.signal.aborted) this.#render(result.features);
    } catch (error) {
      if (!pending.signal.aborted) {
        this.#render([]);
        this.dispatchEvent(new CustomEvent("og-error", { detail: error }));
      }
    }
  }

  #render(results: Suggestion[]): void {
    this.#results = results;
    this.#active = -1;
    this.#list.replaceChildren(
      ...results.map((feature, index) => {
        const item = document.createElement("li");
        item.setAttribute("part", "option");
        item.setAttribute("role", "option");
        item.id = `${this.#list.id}-${index}`;
        item.dataset["index"] = String(index);
        item.textContent = feature.properties.label;
        return item;
      }),
    );
    const open = results.length > 0;
    this.#list.hidden = !open;
    this.#input.setAttribute("aria-expanded", String(open));
    this.#input.removeAttribute("aria-activedescendant");
  }

  #highlight(index: number): void {
    const items = this.#list.children;
    if (items.length === 0) return;
    this.#active = (index + items.length) % items.length;
    for (const [i, item] of Array.from(items).entries()) {
      item.setAttribute("aria-selected", String(i === this.#active));
    }
    const current = items[this.#active] as HTMLElement;
    current.scrollIntoView({ block: "nearest" });
    this.#input.setAttribute("aria-activedescendant", current.id);
  }

  #onKey(event: KeyboardEvent): void {
    if (this.#list.hidden) return;
    if (event.key === "ArrowDown") this.#highlight(this.#active + 1);
    else if (event.key === "ArrowUp") this.#highlight(this.#active - 1);
    else if (event.key === "Enter" && this.#active >= 0) this.#pick(this.#active);
    else if (event.key === "Escape") this.#close();
    else return;
    event.preventDefault();
  }

  #pick(index: number): void {
    const chosen = this.#results[index];
    if (!chosen) return;
    this.value = chosen.properties.label;
    this.#close();
    this.dispatchEvent(
      new CustomEvent("og-select", { detail: chosen, bubbles: true, composed: true }),
    );
  }

  #close(): void {
    this.#pending?.abort();
    this.#render([]);
  }
}
