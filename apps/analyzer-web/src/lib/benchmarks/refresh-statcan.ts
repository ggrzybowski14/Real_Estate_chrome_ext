import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { fetchStatcanCmhcAverageRentBenchmarks } from "./providers/statcan-cmhc-rents";
import { fetchStatcanQuarterlyRentBenchmarks } from "./providers/statcan-quarterly";
import type { MarketRentBenchmarkInsert, StatcanRefreshSummary } from "./types";

function dedupeRentRows(rows: MarketRentBenchmarkInsert[]): MarketRentBenchmarkInsert[] {
  const byKey = new Map<string, MarketRentBenchmarkInsert>();
  for (const row of rows) {
    const key = [
      row.region_code,
      row.property_type,
      row.bedrooms,
      row.sqft_band,
      row.year_built_band ?? "",
      row.period,
      row.source_name
    ].join("|");
    byKey.set(key, row);
  }
  return Array.from(byKey.values());
}

async function insertInBatches(rows: MarketRentBenchmarkInsert[]): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const batchSize = 200;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from("market_rent_benchmarks").insert(batch);
    if (error) {
      throw new Error(`market_rent_benchmarks insert failed: ${error.message}`);
    }
  }
}

export async function refreshStatcanBenchmarks(options?: {
  dryRun?: boolean;
  replaceExisting?: boolean;
}): Promise<StatcanRefreshSummary> {
  const fetchedAt = new Date().toISOString();
  const [quarterlyRows, cmhcRows] = await Promise.all([
    fetchStatcanQuarterlyRentBenchmarks(fetchedAt),
    fetchStatcanCmhcAverageRentBenchmarks(fetchedAt)
  ]);
  const allRows = dedupeRentRows([...quarterlyRows, ...cmhcRows]);

  let deletedExistingMarketRents = 0;
  if (!options?.dryRun) {
    const supabase = getSupabaseAdminClient();
    if (options?.replaceExisting ?? true) {
      const { data: existingRows } = await supabase
        .from("market_rent_benchmarks")
        .select("id")
        .in("source_name", [
          "StatCan Quarterly Rent Statistics",
          "CMHC Average Rents (StatCan 34-10-0133-01)"
        ]);
      deletedExistingMarketRents = existingRows?.length ?? 0;
      const { error: deleteError } = await supabase
        .from("market_rent_benchmarks")
        .delete()
        .in("source_name", [
          "StatCan Quarterly Rent Statistics",
          "CMHC Average Rents (StatCan 34-10-0133-01)"
        ]);
      if (deleteError) {
        throw new Error(`Failed clearing prior StatCan rows: ${deleteError.message}`);
      }
    }
    await insertInBatches(allRows);
  }

  return {
    insertedMarketRents: allRows.length,
    deletedExistingMarketRents,
    quarterlyRows: quarterlyRows.length,
    cmhcRows: cmhcRows.length,
    fetchedAt
  };
}
