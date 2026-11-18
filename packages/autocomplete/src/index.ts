import { OgAutocomplete } from "./element.ts";

export { OgAutocomplete, type OgSelectEvent, type SuggestParams } from "./element.ts";
export * from "@open-geocode/autocomplete-core";

if (typeof customElements !== "undefined" && !customElements.get("og-autocomplete")) {
  customElements.define("og-autocomplete", OgAutocomplete);
}
