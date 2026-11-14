import { OgAutocomplete } from "./element.ts";

export { OgAutocomplete, type OgSelectEvent, type Suggestion } from "./element.ts";

if (typeof customElements !== "undefined" && !customElements.get("og-autocomplete")) {
  customElements.define("og-autocomplete", OgAutocomplete);
}
