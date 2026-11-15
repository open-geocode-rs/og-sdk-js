/**
 * Builds the "Which provider fills what" tables of the README from the adapters' own
 * capabilities, so the documentation cannot drift from the code.
 * `bun run docs:capabilities` rewrites the README, and a test fails when it is out of date.
 */
import {
  type Adapter,
  type Capabilities,
  type FieldName,
  Geocoder,
  type Operation,
  type OptionName,
} from "../src/index.ts";
import { google } from "../src/google.ts";
import { here } from "../src/here.ts";
import { mapbox } from "../src/mapbox.ts";
import { og } from "../src/og.ts";
import { precisely } from "../src/precisely.ts";

const OPERATIONS: readonly Operation[] = ["geocode", "reverse", "autocomplete", "places", "lookup"];
const FIELDS: readonly FieldName[] = [
  "id",
  "location",
  "accuracy",
  "confidence",
  "distance",
  "address",
  "bbox",
  "context",
  "addressDetails",
  "addressLines",
  "streetParts",
  "categories",
  "brand",
  "contact",
  "openingHours",
  "rating",
  "businessStatus",
  "timezone",
  "accessPoints",
  "match",
  "highlights",
  "translations",
  "plusCode",
];
const OPTIONS: readonly OptionName[] = [
  "limit",
  "language",
  "countries",
  "focus",
  "bounds",
  "types",
  "session",
  "structured",
];

/** The adapters, built with placeholder credentials. Nothing here sends a request. */
export function adapters(): Adapter[] {
  return [
    og({ baseUrl: "http://localhost" }),
    google({ apiKey: "key" }),
    mapbox({ accessToken: "token" }),
    here({ apiKey: "key" }),
    precisely({ apiKey: "key", apiSecret: "secret" }),
  ];
}

const line = (cells: string[]): string => `| ${cells.join(" | ")} |`;

function table(head: string[], rows: string[][]): string {
  return [line(head), line(head.map(() => "---")), ...rows.map(line)].join("\n");
}

/** The operations a provider supports something on, as their initials, or `no` for none. */
function initials(capabilities: Capabilities, has: (operation: Operation) => boolean): string {
  const all = OPERATIONS.filter((operation) => capabilities[operation]);
  const supported = all.filter(has);
  if (supported.length === 0) return "no";
  return supported.length === all.length
    ? "all"
    : supported.map((operation) => operation[0]).join(" ");
}

/** The Markdown that goes between the README's capability markers. */
export function capabilitiesMarkdown(list: Adapter[] = adapters()): string {
  // Read through a Geocoder, so the tables show what a caller gets, not the adapter alone.
  const providers = list.map((adapter) => new Geocoder({ adapter }).capabilities);
  const head = ["", ...list.map((adapter) => `\`${adapter.id}\``)];
  const operations = table(head, [
    ...OPERATIONS.map((operation) => [
      `\`${operation}\``,
      ...providers.map((capabilities) => {
        if (!capabilities[operation]) return "no";
        return operation === "autocomplete" && !capabilities.autocomplete?.coordinates
          ? "yes, location through `lookup`"
          : "yes";
      }),
    ]),
    ...(["geocode", "reverse"] as const).map((operation) => [
      `\`batch.${operation}\``,
      ...providers.map((capabilities) => capabilities.batch[operation] || "no"),
    ]),
  ]);
  const fields = table(
    ["Field", ...head.slice(1)],
    FIELDS.map((field) => [
      `\`${field}\``,
      ...providers.map((capabilities) =>
        initials(capabilities, (operation) => !!capabilities[operation]?.fields.includes(field)),
      ),
    ]),
  );
  const options = table(
    ["Option", ...head.slice(1)],
    OPTIONS.map((option) => [
      `\`${option}\``,
      ...providers.map((capabilities) =>
        initials(capabilities, (operation) => !!capabilities[operation]?.options.includes(option)),
      ),
    ]),
  );
  return [
    "Operations.",
    "",
    operations,
    "",
    "Fields.",
    "Each cell names the operations the provider fills the field on, by initial.",
    "`g` is geocode, `r` reverse, `a` autocomplete, `p` places and `l` lookup, `all` is every operation the provider has, and `no` is none.",
    "`type`, `name` and `label` are filled by every provider on every operation, and `raw` is always available.",
    "`distance` is the provider's own figure where the table lists it.",
    "Anywhere else it is measured here, from the reverse point or from `focus` to the result's `location`.",
    "",
    fields,
    "",
    "Options.",
    "`structured` is an address given in parts to `geocode`.",
    "A provider without it is sent the parts joined into one line.",
    "",
    options,
  ].join("\n");
}

const START = "<!-- capabilities:start -->";
const END = "<!-- capabilities:end -->";

/** `readme` with the tables between its markers replaced. */
export function withCapabilities(
  readme: string,
  markdown: string = capabilitiesMarkdown(),
): string {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start < 0 || end < 0) throw new Error("README has no capability markers");
  return `${readme.slice(0, start + START.length)}\n${markdown}\n${readme.slice(end)}`;
}
