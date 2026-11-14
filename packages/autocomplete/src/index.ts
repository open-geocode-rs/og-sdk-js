import { OgAutocomplete } from "./element.ts";

export { OgAutocomplete, ogItems, type OgSelectEvent, type Suggestion } from "./element.ts";
export * from "@open-geocode/autocomplete-core";

if (typeof customElements !== "undefined" && !customElements.get("og-autocomplete")) {
  customElements.define("og-autocomplete", OgAutocomplete);
}
