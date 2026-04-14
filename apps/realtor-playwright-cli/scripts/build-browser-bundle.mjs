import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "dist");
mkdirSync(outDir, { recursive: true });
const outfile = join(outDir, "listing-scrape.iife.js");

await esbuild.build({
  entryPoints: [join(root, "src/listing-scrape-iife-entry.ts")],
  outfile,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  logLevel: "info"
});

console.log("Wrote", outfile);
