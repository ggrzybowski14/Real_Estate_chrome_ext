import { parseCsvRows, parseNumber, pickColumn } from "../csv";
import AdmZip from "adm-zip";
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

function looksLikeZip(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  );
}

function resolveCsvFromZip(zipBuffer: Buffer): string {
  const zip = new AdmZip(zipBuffer);
  const csvEntry = zip
    .getEntries()
    .find((entry) => !entry.isDirectory && entry.entryName.toLowerCase().endsWith(".csv"));
  if (!csvEntry) {
    throw new Error("CMHC ZIP did not contain a CSV file.");
  }
  return zip.readAsText(csvEntry, "utf8");
}

export async function fetchStatcanCmhcAverageRentBenchmarks(
  fetchedAt: string
): Promise<MarketRentBenchmarkInsert[]> {
  const sourceUrl = requireEnv("STATCAN_CMHC_AVERAGE_RENTS_CSV_URL");
  const response = await fetch(sourceUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`CMHC StatCan table fetch failed with ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const shouldUnzip =
    contentType.includes("zip") || sourceUrl.toLowerCase().endsWith(".zip") || looksLikeZip(bytes);

  const csv = shouldUnzip ? resolveCsvFromZip(bytes) : bytes.toString("utf8");
  const rows = parseCsvRows(csv);

  const inserts: MarketRentBenchmarkInsert[] = [];
  for (const row of rows) {
    const geography = pickColumn(row, ["geography", "geo", "region"]) ?? "";
    const mappedRegion = mapStatcanGeographyToRegion(geography);
    if (!mappedRegion) {
      continue;
    }

    const periodRaw = pickColumn(row, ["reference period", "ref date", "period"]) ?? "";
    const period = parsePeriod(periodRaw);
    if (!period || period.includes("Q")) {
      continue;
    }
    if (Number(period) < 2021) {
      continue;
    }

    const unitTypeRaw = pickColumn(row, ["type of unit", "unit type", "bedrooms"]) ?? "";
    const bedrooms = parseBedrooms(unitTypeRaw);
    if (!bedrooms) {
      continue;
    }

    const valueRaw = pickColumn(row, ["value", "average rent"]) ?? "";
    const medianRent = parseNumber(valueRaw);
    if (!medianRent || medianRent <= 0) {
      continue;
    }

    inserts.push({
      region_code: mappedRegion.regionCode,
      region_label: mappedRegion.regionLabel,
      property_type: parsePropertyType(unitTypeRaw),
      bedrooms,
      sqft_band: "unknown",
      year_built_band: null,
      period,
      median_rent: medianRent,
      p25_rent: null,
      p75_rent: null,
      source_name: "CMHC Average Rents (StatCan 34-10-0133-01)",
      source_publisher: "CMHC / Statistics Canada",
      source_url: sourceUrl,
      source_fetched_at: fetchedAt,
      notes: "Average rents baseline for areas with population 10,000+."
    });
  }

  return inserts;
}
