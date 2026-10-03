// Bundles the Functions app into api/deploy/: one app.js (handlers, workspace packages and SDKs included),
// plus host.json and package.json. Static Web Apps deploys that folder as its managed API.
// Run: npm run build:functions -w api
import { build } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const apiDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(apiDir, "deploy");

// Start clean so nothing stale, and never a local.settings.json with keys, gets deployed.
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await build({
  entryPoints: [join(apiDir, "src/functions/app.ts")],
  outfile: join(outDir, "app.js"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  // Provided by the Functions worker at run time.
  external: ["@azure/functions-core"],
  sourcemap: "linked",
  legalComments: "none",
  logLevel: "warning",
});

await cp(join(apiDir, "host.json"), join(outDir, "host.json"));
await writeFile(
  join(outDir, "package.json"),
  JSON.stringify({ name: "deeproot-functions", private: true, main: "app.js", engines: { node: ">=22" } }, null, 2) + "\n",
);

console.log(`Built ${outDir}`);
