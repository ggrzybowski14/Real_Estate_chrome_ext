import { parseCsvRows, parseNumber, pickColumn } from "../csv";
import {
  mapStatcanGeographyToRegion,
  parseBedrooms,
  parsePeriod,
  parsePropertyType
} from "../geo-map";
import type { MarketRentBenchmarkInsert } from "../types";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function normalizeQuarterPeriod(rawPeriod: string): string | null {
  const parsed = parsePeriod(rawPeriod);
  if (parsed?.includes("Q")) {
    return parsed;
  }

  // Some StatCan downloads return YYYY-MM; map month to calendar quarter.
  const monthMatch = rawPeriod.trim().match(/^(20\d{2})-(0[1-9]|1[0-2])$/u);
  if (!monthMatch) {
    return null;
  }
  const year = monthMatch[1];
  const monthToken = monthMatch[2];
  if (!year || !monthToken) {
    return null;
  }
  const month = Number(monthToken);
  const quarter = Math.floor((month - 1) / 3) + 1;
  return `${year}-Q${quarter}`;
}

export async function fetchStatcanQuarterlyRentBenchmarks(
  fetchedAt: string
): Promise<MarketRentBenchmarkInsert[]> {
  const sourceUrl = requireEnv("STATCAN_QUARTERLY_RENTS_CSV_URL");
  const response = await fetch(sourceUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Quarterly StatCan fetch failed with ${response.status}`);
  }
  const csv = await response.text();
  const rows = parseCsvRows(csv);

  const inserts: MarketRentBenchmarkInsert[] = [];
  for (const row of rows) {
    const geography = pickColumn(row, ["geography", "geo", "region"]) ?? "";
    const mappedRegion = mapStatcanGeographyToRegion(geography);
    if (!mappedRegion) {
      continue;
    }

    const periodRaw = pickColumn(row, ["reference period", "ref date", "period"]) ?? "";
    const period = normalizeQuarterPeriod(periodRaw);
    if (!period) {
      continue;
    }

    const bedroomsRaw =
      pickColumn(row, [
        "number of bedrooms",
        "bedrooms",
        "rental unit type",
        "type of unit",
        "unit type"
      ]) ?? "";
    const bedrooms = parseBedrooms(bedroomsRaw);
    if (!bedrooms) {
      continue;
    }

    const valueRaw = pickColumn(row, ["value", "average asking rent", "asking rent"]) ?? "";
    const medianRent = parseNumber(valueRaw);
    if (!medianRent || medianRent <= 0) {
      continue;
    }

    const propertyType = parsePropertyType(
      pickColumn(row, ["dwelling type", "housing type", "rental unit type", "unit type"]) ??
        "apartment"
    );

    inserts.push({
      region_code: mappedRegion.regionCode,
      region_label: mappedRegion.regionLabel,
      property_type: propertyType,
      bedrooms,
      sqft_band: "unknown",
      year_built_band: null,
      period,
      median_rent: medianRent,
      p25_rent: null,
      p75_rent: null,
      source_name: "StatCan Quarterly Rent Statistics",
      source_publisher: "Statistics Canada",
      source_url: sourceUrl,
      source_fetched_at: fetchedAt,
      notes: "Asking rent benchmark from quarterly statistics program."
    });
  }

  return inserts;
}
