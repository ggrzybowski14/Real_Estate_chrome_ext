import { createClient } from "@supabase/supabase-js";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

async function upsertRows(client, table, rows) {
  if (!rows.length) {
    return;
  }
  const { error } = await client.from(table).insert(rows);
  if (error) {
    throw new Error(`${table} insert failed: ${error.message}`);
  }
}

const nowIso = new Date().toISOString();

const marketRentRows = [
  {
    region_code: "ca-on-gta",
    region_label: "Greater Toronto Area, ON",
    property_type: "apartment",
    bedrooms: 2,
    sqft_band: "900_1199",
    year_built_band: null,
    period: "2025-Q1",
    median_rent: 3200,
    p25_rent: 2900,
    p75_rent: 3600,
    source_name: "CMHC Rental Market Report",
    source_publisher: "CMHC",
    source_url:
      "https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/market-reports/rental-market-report",
    source_fetched_at: nowIso
  },
  {
    region_code: "ca-bc-vancouver",
    region_label: "Metro Vancouver, BC",
    property_type: "apartment",
    bedrooms: 2,
    sqft_band: "900_1199",
    year_built_band: null,
    period: "2025-Q1",
    median_rent: 3050,
    p25_rent: 2800,
    p75_rent: 3400,
    source_name: "CMHC Rental Market Report",
    source_publisher: "CMHC",
    source_url:
      "https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/market-reports/rental-market-report",
    source_fetched_at: nowIso
  }
];

const vacancyRows = [
  {
    region_code: "ca-on-gta",
    region_label: "Greater Toronto Area, ON",
    property_type: "apartment",
    period: "2025-Q1",
    vacancy_pct: 1.8,
    source_name: "CMHC Rental Market Report",
    source_publisher: "CMHC",
    source_url:
      "https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/market-reports/rental-market-report",
    source_fetched_at: nowIso
  },
  {
    region_code: "ca-bc-vancouver",
    region_label: "Metro Vancouver, BC",
    property_type: "apartment",
    period: "2025-Q1",
    vacancy_pct: 1.2,
    source_name: "CMHC Rental Market Report",
    source_publisher: "CMHC",
    source_url:
      "https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/market-reports/rental-market-report",
    source_fetched_at: nowIso
  }
];

const costRows = [
  {
    region_code: "ca-on-gta",
    region_label: "Greater Toronto Area, ON",
    cost_type: "property_tax",
    property_type: null,
    period: "2025-Q1",
    value_monthly: null,
    value_annual: 4300,
    source_name: "Municipal tax aggregates + CMHC",
    source_publisher: "Municipal/CMHC",
    source_url: "https://www.cmhc-schl.gc.ca/",
    source_fetched_at: nowIso
  },
  {
    region_code: "ca-on-gta",
    region_label: "Greater Toronto Area, ON",
    cost_type: "utilities",
    property_type: null,
    period: "2025-Q1",
    value_monthly: 210,
    value_annual: null,
    source_name: "Utility bill averages",
    source_publisher: "Public utility reports",
    source_url: "https://www.hydroone.com/",
    source_fetched_at: nowIso
  }
];

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  await upsertRows(client, "market_rent_benchmarks", marketRentRows);
  await upsertRows(client, "vacancy_benchmarks", vacancyRows);
  await upsertRows(client, "cost_benchmarks", costRows);
  console.log("Benchmark refresh complete.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
