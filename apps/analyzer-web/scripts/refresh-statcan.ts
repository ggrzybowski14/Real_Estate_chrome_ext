import { refreshStatcanBenchmarks } from "../src/lib/benchmarks/refresh-statcan";

async function main() {
  const summary = await refreshStatcanBenchmarks({
    dryRun: process.argv.includes("--dry-run"),
    replaceExisting: !process.argv.includes("--append")
  });
  console.log("StatCan benchmark refresh complete.");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
