/**
 * Writes a one-file web page of what each provider supports, with one tab per operation.
 * It is built from the adapters' own capabilities, like the README tables.
 * `bun run docs:page` writes it to `docs-preview/index.html`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import type { Adapter, FieldName, Operation, OptionName } from "../src/index.ts";
import { adapters } from "./capabilities.ts";

const OPERATIONS: readonly Operation[] = ["geocode", "reverse", "autocomplete", "places", "lookup"];

const DEFAULT_FIELDS: readonly [FieldName, string][] = [
  ["id", "The provider's ID, usable with lookup"],
  ["location", "Latitude and longitude"],
  ["accuracy", "rooftop, interpolated, street, centroid or approximate"],
  ["confidence", "How sure the provider is, from 0 to 1"],
  ["distance", "Metres from the reverse point or from focus"],
  ["address", "House number, street, locality, region, postcode, country and codes"],
];
const OPT_IN_FIELDS: readonly [FieldName, string][] = [
  ["bbox", "The box that frames the result on a map"],
  ["context", "Containing areas with IDs and codes"],
  ["addressDetails", "Unit type, building, floor, sublocality, postcode suffix"],
  ["addressLines", "The address as postal lines"],
  ["streetParts", "Street name split into prefix, name, type, suffix"],
  ["categories", "POI categories"],
  ["brand", "The chain a place belongs to"],
  ["contact", "Phone, website, email"],
  ["openingHours", "Hours as text, and open now"],
  ["rating", "Average rating and count"],
  ["businessStatus", "Operational or closed"],
  ["timezone", "IANA name and UTC offset"],
  ["accessPoints", "Entrances and routing points"],
  ["match", "How each address part of the query matched"],
  ["highlights", "The parts of the label that match what was typed"],
  ["translations", "The name in further languages"],
];
const OPTIONS: readonly [OptionName, string][] = [
  ["limit", "The most results to return"],
  ["language", "Language of the results"],
  ["countries", "Return only results in these countries"],
  ["focus", "Prefer results near a point"],
  ["bounds", "Return only results inside a box"],
  ["types", "Return only results of these types"],
  ["session", "Group a search's keystrokes for billing"],
  ["structured", "An address given in parts"],
];

/**
 * Fields og cannot add whoever returns them.
 * No commercially usable open data holds a rating.
 * A business closed for good is not in a Pack at all, so og has no record to mark as closed.
 */
const NO_OPEN_DATA = new Set<FieldName>(["rating", "businessStatus"]);

/** A field is worth adding to og on an operation when at least this many of the vendors return it there. */
const VENDOR_BAR = 2;

/** How many of the vendors, og left out, return `field` on `operation`. */
function vendorsWith(list: Adapter[], operation: Operation, field: FieldName): number {
  return list.filter(
    (adapter) => adapter.id !== "og" && adapter.capabilities[operation]?.fields.includes(field),
  ).length;
}

type State = "yes" | "no" | "measured" | "planned" | "none";

function fieldState(
  list: Adapter[],
  adapter: Adapter,
  operation: Operation,
  field: FieldName,
): State {
  const capability = adapter.capabilities[operation];
  if (!capability) return "none";
  if (capability.fields.includes(field)) return "yes";
  // The Geocoder measures a distance wherever there is a location to measure to.
  if (field === "distance" && capability.fields.includes("location") && operation !== "lookup")
    return "measured";
  // og's gaps are judged against the vendors, operation by operation, never by what og could build.
  if (
    adapter.id === "og" &&
    !NO_OPEN_DATA.has(field) &&
    vendorsWith(list, operation, field) >= VENDOR_BAR
  )
    return "planned";
  return "no";
}

function optionState(adapter: Adapter, operation: Operation, option: OptionName): State {
  const capability = adapter.capabilities[operation];
  if (!capability) return "none";
  if (option === "structured" && operation !== "geocode") return "none";
  return capability.options.includes(option) ? "yes" : "no";
}

const LABELS: Record<State, string> = {
  yes: "Yes",
  no: "No",
  measured: "Measured",
  planned: "Can add",
  none: "n/a",
};

const cell = (state: State, hint = ""): string =>
  `<td><span class="pill ${state}">${LABELS[state]}</span>${hint ? `<small>${hint}</small>` : ""}</td>`;

function rows(
  list: Adapter[],
  names: readonly (readonly [string, string])[],
  state: (adapter: Adapter, name: string) => State,
  hint: (adapter: Adapter, name: string, state: State) => string = () => "",
): string {
  return (
    names
      .map(([name, meaning]) => ({
        name,
        meaning,
        states: list.map((adapter) => state(adapter, name)),
      }))
      // A row nobody fills on this operation says nothing, so it is left out.
      .filter((row) => row.states.some((value) => value !== "no" && value !== "none"))
      .map(
        (row) =>
          `<tr><th scope="row"><code>${row.name}</code><small>${row.meaning}</small></th>${row.states
            .map((value, index) => cell(value, hint(list[index] as Adapter, row.name, value)))
            .join("")}</tr>`,
      )
      .join("")
  );
}

function table(list: Adapter[], body: string): string {
  const head = list.map((adapter) => `<th scope="col">${adapter.id}</th>`).join("");
  return `<div class="scroll"><table><thead><tr><th scope="col"></th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

const group = (title: string, columns: number): string =>
  `<tr class="group"><th colspan="${columns + 1}">${title}</th></tr>`;

function operationPanel(list: Adapter[], operation: Operation): string {
  const missing = list.filter((adapter) => !adapter.capabilities[operation]).map((a) => a.id);
  const lookup = list
    .filter(
      (adapter) => operation === "autocomplete" && !adapter.capabilities.autocomplete?.coordinates,
    )
    .map((adapter) => adapter.id);
  const notes = [
    missing.length
      ? `<p class="note">${missing.join(", ")} has no <code>${operation}</code>.</p>`
      : "",
    lookup.length
      ? `<p class="note">Suggestions from ${lookup.join(", ")} carry no coordinates. Resolve the picked one with <code>lookup</code>.</p>`
      : "",
  ].join("");
  const fields =
    group("Default fields", list.length) +
    rows(list, DEFAULT_FIELDS, (adapter, name) =>
      fieldState(list, adapter, operation, name as FieldName),
    ) +
    group("Opt-in fields, asked for with <code>include</code>", list.length) +
    rows(
      list,
      OPT_IN_FIELDS,
      (adapter, name) => fieldState(list, adapter, operation, name as FieldName),
      (_adapter, name, state) =>
        state === "planned"
          ? `${vendorsWith(list, operation, name as FieldName)} of ${list.length - 1} vendors return it`
          : "",
    ) +
    group("Request options", list.length) +
    rows(list, OPTIONS, (adapter, name) => optionState(adapter, operation, name as OptionName));
  return notes + table(list, fields);
}

const pill = (state: State, text: string): string => `<span class="pill ${state}">${text}</span>`;

function overviewPanel(list: Adapter[]): string {
  const line = (name: string, state: (adapter: Adapter) => string): string =>
    `<tr><th scope="row"><code>${name}</code></th>${list.map((adapter) => `<td>${state(adapter)}</td>`).join("")}</tr>`;
  const body =
    OPERATIONS.map((operation) =>
      line(operation, (adapter) => {
        if (!adapter.capabilities[operation]) return pill("no", "No");
        return operation === "autocomplete" && !adapter.capabilities.autocomplete?.coordinates
          ? pill("yes", "Yes") + "<small>location through lookup</small>"
          : pill("yes", "Yes");
      }),
    ).join("") +
    (["geocode", "reverse"] as const)
      .map((operation) =>
        line(`batch.${operation}`, (adapter) =>
          adapter.capabilities.batch?.[operation]
            ? pill("yes", "Native")
            : adapter.capabilities[operation]
              ? pill("measured", "Emulated")
              : pill("no", "No"),
        ),
      )
      .join("");
  return table(list, body);
}

/** The whole page. */
export function page(list: Adapter[] = adapters()): string {
  const tabs = ["overview", ...OPERATIONS];
  const buttons = tabs
    .map(
      (tab, index) =>
        `<button role="tab" id="tab-${tab}" aria-controls="panel-${tab}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${tab}</button>`,
    )
    .join("");
  const panels = tabs
    .map(
      (tab, index) =>
        `<section role="tabpanel" id="panel-${tab}" aria-labelledby="tab-${tab}"${index === 0 ? "" : " hidden"}>${
          tab === "overview" ? overviewPanel(list) : operationPanel(list, tab as Operation)
        }</section>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Provider support</title>
<style>
:root{--bg:#fbfbfa;--fg:#1d1f22;--mut:#646a72;--line:#dcdfe3;--head:#f1f2f4;
--yes:#1f7a3f;--yes-bg:#e6f4ea;--no:#8a9099;--no-bg:#eef0f2;--mea:#2f55b8;--mea-bg:#e7edfb;--pla:#9a6a00;--pla-bg:#fbf1d9}
@media (prefers-color-scheme:dark){:root{--bg:#15171a;--fg:#e6e8eb;--mut:#9aa1aa;--line:#2c3036;--head:#1d2024;
--yes:#5cc78a;--yes-bg:#163222;--no:#7d848d;--no-bg:#22262b;--mea:#8fb0ff;--mea-bg:#1c2747;--pla:#e0b04a;--pla-bg:#33290f;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1040px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:26px;margin:0 0 4px}
p{margin:6px 0;max-width:72ch}.mut,.note{color:var(--mut)}
code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
.legend{display:flex;flex-wrap:wrap;gap:8px 20px;margin:16px 0 20px;padding:0;list-style:none;font-size:14px}
.legend li{display:flex;align-items:center;gap:8px}
[role=tablist]{display:flex;flex-wrap:wrap;gap:4px;border-bottom:1px solid var(--line);margin-bottom:16px}
[role=tab]{font:inherit;font-weight:600;color:var(--mut);background:none;border:0;border-bottom:2px solid transparent;padding:10px 14px;margin-bottom:-1px;cursor:pointer}
[role=tab][aria-selected=true]{color:var(--fg);border-bottom-color:var(--fg)}
[role=tab]:focus-visible{outline:2px solid var(--fg);outline-offset:2px}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%;min-width:680px}
th,td{padding:8px 12px;border-bottom:1px solid var(--line);text-align:center;vertical-align:middle}
tbody tr:last-child>*{border-bottom:0}
thead th{background:var(--head);font-size:13px;font-weight:600;position:sticky;top:0}
th[scope=row]{text-align:left;font-weight:400;width:38%}
th small,td small{display:block;color:var(--mut);font-size:12.5px}
tr.group th{background:var(--head);text-align:left;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}
.pill{display:inline-block;min-width:76px;padding:2px 10px;border-radius:999px;font-size:13px;font-weight:600}
.yes{color:var(--yes);background:var(--yes-bg)}.no,.none{color:var(--no);background:var(--no-bg)}
.measured{color:var(--mea);background:var(--mea-bg)}.planned{color:var(--pla);background:var(--pla-bg)}
.none{font-weight:400}
</style>
</head>
<body>
<main>
<h1>Provider support</h1>
<p class="mut">What each adapter of <code>@open-geocode/client</code> fills and honours, per operation. Built from the adapters' own capabilities.</p>
<ul class="legend">
<li><span class="pill yes">Yes</span> The provider returns it, or honours the option.</li>
<li><span class="pill no">No</span> The provider cannot. The field is <code>null</code> and listed in <code>unavailable</code>.</li>
<li><span class="pill measured">Measured</span> The provider sends none, so the SDK measures it.</li>
${
  panels.includes("pill planned")
    ? `<li><span class="pill planned">Can add</span> og lacks it, at least ${VENDOR_BAR} of the ${list.length - 1} vendors return it on this operation, and open data holds it.</li>\n`
    : ""
}<li><span class="pill none">n/a</span> Does not apply to this operation.</li>
</ul>
<div role="tablist" aria-label="Operation">${buttons}</div>
${panels}
</main>
<script>
const tabs = [...document.querySelectorAll("[role=tab]")];
function show(tab, focus) {
  for (const other of tabs) {
    const on = other === tab;
    other.setAttribute("aria-selected", String(on));
    other.tabIndex = on ? 0 : -1;
    document.getElementById(other.getAttribute("aria-controls")).hidden = !on;
  }
  if (focus) tab.focus();
  history.replaceState(null, "", "#" + tab.id.slice(4));
}
for (const tab of tabs) {
  tab.addEventListener("click", () => show(tab, false));
  tab.addEventListener("keydown", (event) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step) show(tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length], true);
  });
}
const start = document.getElementById("tab-" + location.hash.slice(1));
if (start) show(start, false);
</script>
</body>
</html>
`;
}

if (import.meta.main) {
  const directory = new URL("../../../docs-preview/", import.meta.url);
  mkdirSync(directory, { recursive: true });
  writeFileSync(new URL("index.html", directory), page());
  console.log("docs-preview/index.html written");
}
