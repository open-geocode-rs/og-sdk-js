/**
 * Headless autocomplete. It owns the state, debouncing, request cancellation, keyboard
 * handling and ARIA attributes, and renders nothing. A renderer (the `<og-autocomplete>`
 * Web Component, or your own React, Vue or Svelte component) draws the state and forwards
 * input events.
 */

/** Where the search is. `stalled` means loading for longer than `stallThreshold`. */
export type Status = "idle" | "loading" | "stalled" | "error";

/** Everything a renderer needs to draw the autocomplete. */
export interface State<Item> {
  query: string;
  items: Item[];
  /** Index of the highlighted item, or `null`. */
  activeIndex: number | null;
  isOpen: boolean;
  status: Status;
  /** The last error from `getItems`, when `status` is `error`. */
  error: unknown;
}

/** Options for {@link createAutocomplete}. */
export interface AutocompleteOptions<Item> {
  /** Fetches items for a query. Abort work when `signal` fires: a newer query replaced it. */
  getItems(query: string, context: { signal: AbortSignal }): Promise<Item[]>;
  /** Text shown for an item, and put in the input when it is picked. */
  getItemLabel(item: Item): string;
  /** Prefix for element ids. Must be unique on the page. Default `og-ac-<n>`. */
  id?: string | undefined;
  /** Milliseconds after the last keystroke before `getItems` runs. Default 150. */
  debounce?: number | undefined;
  /** Characters typed before the first search. Default 2. */
  minLength?: number | undefined;
  /** Milliseconds of loading before `status` becomes `stalled`, so a spinner shows only for slow answers. Default 300. */
  stallThreshold?: number | undefined;
  /** Called when the user picks an item. */
  onSelect?: ((item: Item) => void) | undefined;
  /** Called on every state change. */
  onStateChange?: ((state: State<Item>) => void) | undefined;
}

/** ARIA and id attributes for an element, as plain attribute names and values. */
export type Attributes = Record<string, string>;

/** The handle {@link createAutocomplete} returns. */
export interface Autocomplete<Item> {
  getState(): State<Item>;
  /** Calls `listener` on every state change. Returns an unsubscribe function. */
  subscribe(listener: (state: State<Item>) => void): () => void;
  /** Call on every input event with the input's new value. */
  onInput(value: string): void;
  /** Call on keydown with `event.key`. Returns `true` when handled: then call `event.preventDefault()`. */
  onKeyDown(key: string): boolean;
  /** Call when the input loses focus. */
  onBlur(): void;
  /** Picks the item at `index`, as a click on it does. */
  select(index: number): void;
  /** Highlights the item at `index`, as hovering does. */
  setActiveIndex(index: number | null): void;
  /** Closes the list and cancels any pending search. */
  close(): void;
  /** Cancels timers and requests. Call when the renderer is removed. */
  destroy(): void;
  /** Attributes for the `<input>`. */
  getInputAttributes(): Attributes;
  /** Attributes for the list element. */
  getListAttributes(): Attributes;
  /** Attributes for the item at `index`. */
  getItemAttributes(index: number): Attributes;
}

let instances = 0;

/** Creates a headless autocomplete. */
export function createAutocomplete<Item>(options: AutocompleteOptions<Item>): Autocomplete<Item> {
  const id = options.id ?? `og-ac-${instances++}`;
  const debounce = options.debounce ?? 150;
  const minLength = options.minLength ?? 2;
  const stallThreshold = options.stallThreshold ?? 300;
  const listeners = new Set<(state: State<Item>) => void>();
  if (options.onStateChange) listeners.add(options.onStateChange);

  let state: State<Item> = {
    query: "",
    items: [],
    activeIndex: null,
    isOpen: false,
    status: "idle",
    error: undefined,
  };
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  let pending: AbortController | undefined;

  function set(patch: Partial<State<Item>>): void {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  }

  function cancel(): void {
    clearTimeout(debounceTimer);
    clearTimeout(stallTimer);
    pending?.abort();
    pending = undefined;
  }

  async function search(query: string): Promise<void> {
    const controller = new AbortController();
    pending = controller;
    set({ status: "loading", error: undefined });
    stallTimer = setTimeout(() => {
      if (pending === controller) set({ status: "stalled" });
    }, stallThreshold);
    try {
      const items = await options.getItems(query, { signal: controller.signal });
      if (pending !== controller) return;
      set({ items, isOpen: items.length > 0, activeIndex: null, status: "idle" });
    } catch (error) {
      if (pending !== controller) return;
      set({ items: [], isOpen: false, activeIndex: null, status: "error", error });
    } finally {
      if (pending === controller) {
        clearTimeout(stallTimer);
        pending = undefined;
      }
    }
  }

  function move(delta: number): void {
    const count = state.items.length;
    if (count === 0) return;
    const from = state.activeIndex ?? (delta > 0 ? -1 : count);
    set({ activeIndex: (from + delta + count) % count });
  }

  const autocomplete: Autocomplete<Item> = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onInput(value) {
      cancel();
      set({ query: value });
      if (value.trim().length < minLength) {
        set({ items: [], isOpen: false, activeIndex: null, status: "idle" });
        return;
      }
      debounceTimer = setTimeout(() => void search(value.trim()), debounce);
    },
    onKeyDown(key) {
      if (!state.isOpen) return false;
      if (key === "ArrowDown") move(1);
      else if (key === "ArrowUp") move(-1);
      else if (key === "Enter" && state.activeIndex !== null)
        autocomplete.select(state.activeIndex);
      else if (key === "Escape") autocomplete.close();
      else return false;
      return true;
    },
    onBlur: () => autocomplete.close(),
    select(index) {
      const item = state.items[index];
      if (item === undefined) return;
      cancel();
      set({
        query: options.getItemLabel(item),
        items: [],
        isOpen: false,
        activeIndex: null,
        status: "idle",
      });
      options.onSelect?.(item);
    },
    setActiveIndex(index) {
      set({ activeIndex: index });
    },
    close() {
      cancel();
      set({
        isOpen: false,
        activeIndex: null,
        status: state.status === "error" ? "error" : "idle",
      });
    },
    destroy() {
      cancel();
      listeners.clear();
    },
    getInputAttributes() {
      const attributes: Attributes = {
        id: `${id}-input`,
        role: "combobox",
        autocomplete: "off",
        autocorrect: "off",
        autocapitalize: "off",
        spellcheck: "false",
        "aria-autocomplete": "list",
        "aria-controls": `${id}-list`,
        "aria-expanded": String(state.isOpen),
        "aria-busy": String(state.status === "loading" || state.status === "stalled"),
      };
      if (state.isOpen && state.activeIndex !== null)
        attributes["aria-activedescendant"] = `${id}-item-${state.activeIndex}`;
      return attributes;
    },
    getListAttributes: () => ({ id: `${id}-list`, role: "listbox" }),
    getItemAttributes: (index) => ({
      id: `${id}-item-${index}`,
      role: "option",
      "aria-selected": String(index === state.activeIndex),
    }),
  };
  return autocomplete;
}
