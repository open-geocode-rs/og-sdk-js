// Bundles an app that imports one client, and fails if another vendor's code came along.
// Each vendor is recognised by the host name its client calls.
import { build } from "vite";

const HOSTS = {
  google: "googleapis.com",
  mapbox: "api.mapbox.com",
  here: "hereapi.com",
  precisely: "cloud.precisely.com",
};
// og calls no fixed host, so it is recognised by the job upload of its own client.
const OG = "respond-async";

const CASES = ["og", "google", "mapbox", "here", "precisely", "plugins", "widget"];

async function bundle(name) {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      lib: {
        entry: new URL(`./entries/${name}.js`, import.meta.url).pathname,
        formats: ["es"],
        fileName: name,
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  return outputs
    .flatMap((output) => output.output)
    .map((file) => file.code ?? "")
    .join("\n");
}

let failed = false;
for (const name of CASES) {
  const code = await bundle(name);
  const present = Object.entries(HOSTS)
    .filter(([, host]) => code.includes(host))
    .map(([provider]) => provider);
  if (code.includes(OG)) present.push("og");
  const allowed = name === "widget" ? ["og"] : name === "plugins" ? [] : [name];
  const extra = present.filter((provider) => !allowed.includes(provider));
  const missing = allowed.filter((provider) => !present.includes(provider));
  const ok = extra.length === 0 && missing.length === 0;
  failed ||= !ok;
  const size = `${(code.length / 1024).toFixed(1)} kB unminified`;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name.padEnd(9)} ${size.padStart(22)}  holds ${present.join(", ") || "no provider"}` +
      (extra.length ? `, must not hold ${extra.join(", ")}` : "") +
      (missing.length ? `, lacks ${missing.join(", ")}` : ""),
  );
}
if (failed) process.exit(1);
console.log("tree-shaking ok");
