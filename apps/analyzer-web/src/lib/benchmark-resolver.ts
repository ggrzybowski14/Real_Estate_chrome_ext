import type {
  AssumptionEstimateMethod,
  AssumptionField,
  AssumptionSourceDetail,
  AssumptionSources,
  BenchmarkContext,
  ListingAssumptions,
  ListingRecord
} from "@rea/shared";
import { defaultAssumptionsFor } from "@rea/analysis";
import { getSupabaseAdminClient } from "./supabase-admin";

type RentBenchmarkRow = {
  region_code: string;
  region_label: string;
  property_type: string;
  bedrooms: number;
  sqft_band: string;
  year_built_band: string | null;
  period: string;
  median_rent: number;
  source_name: string;
  source_publisher: string;
  source_url: string;
  source_fetched_at: string;
};

type VacancyBenchmarkRow = {
  region_code: string;
  region_label: string;
  property_type: string;
  period: string;
  vacancy_pct: number;
  source_name: string;
  source_publisher: string;
  source_url: string;
  source_fetched_at: string;
};

type CostBenchmarkRow = {
  region_code: string;
  region_label: string;
  cost_type: string;
  property_type: string | null;
  period: string;
  value_monthly: number | null;
  value_annual: number | null;
  source_name: string;
  source_publisher: string;
  source_url: string;
  source_fetched_at: string;
};

type RegionRule = {
  regionCode: string;
  regionLabel: string;
  province: string;
  cities: string[];
  fsaPrefixes: string[];
};

const REGION_RULES: RegionRule[] = [
  {
    regionCode: "ca-on-gta",
    regionLabel: "Greater Toronto Area, ON",
    province: "ON",
    cities: ["toronto", "mississauga", "brampton", "markham", "vaughan", "richmond hill"],
    fsaPrefixes: ["M1", "M2", "M3", "M4", "M5", "M6", "M9", "L4", "L5", "L6"]
  },
  {
    regionCode: "ca-bc-vancouver",
    regionLabel: "Metro Vancouver, BC",
    province: "BC",
    cities: ["vancouver", "burnaby", "surrey", "richmond", "coquitlam", "new westminster"],
    fsaPrefixes: ["V3", "V4", "V5", "V6", "V7"]
  },
  {
    regionCode: "ca-bc-victoria",
    regionLabel: "Greater Victoria, BC",
    province: "BC",
    cities: ["victoria", "saanich", "sidney", "langford", "esquimalt", "oak bay"],
    fsaPrefixes: ["V8", "V9A", "V9B"]
  },
  {
    regionCode: "ca-ab-calgary",
    regionLabel: "Calgary, AB",
    province: "AB",
    cities: ["calgary"],
    fsaPrefixes: ["T1", "T2", "T3"]
  },
  {
    regionCode: "ca-ab-edmonton",
    regionLabel: "Edmonton, AB",
    province: "AB",
    cities: ["edmonton", "st. albert", "sherwood park"],
    fsaPrefixes: ["T5", "T6"]
  },
  {
    regionCode: "ca-qc-montreal",
    regionLabel: "Montreal, QC",
    province: "QC",
    cities: ["montreal", "laval", "longueuil"],
    fsaPrefixes: ["H1", "H2", "H3", "H4", "H7"]
  },
  {
    regionCode: "ca-on-ottawa",
    regionLabel: "Ottawa, ON",
    province: "ON",
    cities: ["ottawa", "kanata", "nepean", "orleans"],
    fsaPrefixes: ["K1", "K2", "K4"]
  }
];

const FALLBACK_REGION = {
  regionCode: "ca-generic-metro",
  regionLabel: "Canadian Metro Fallback"
};

const FALLBACK_VALUES: Record<string, Partial<ListingAssumptions>> = {
  "ca-on-gta": {
    monthlyRent: 3150,
    vacancyPct: 1.8,
    annualPropertyTax: 4300,
    monthlyInsurance: 125,
    monthlyUtilities: 210,
    maintenancePct: 5.5,
    managementFeePct: 8
  },
  "ca-bc-vancouver": {
    monthlyRent: 3050,
    vacancyPct: 1.2,
    annualPropertyTax: 3550,
    monthlyInsurance: 120,
    monthlyUtilities: 200,
    maintenancePct: 5.2,
    managementFeePct: 8
  },
  "ca-ab-calgary": {
    monthlyRent: 2450,
    vacancyPct: 3.4,
    annualPropertyTax: 3700,
    monthlyInsurance: 110,
    monthlyUtilities: 220,
    maintenancePct: 5.8,
    managementFeePct: 8
  },
  "ca-qc-montreal": {
    monthlyRent: 2200,
    vacancyPct: 2.3,
    annualPropertyTax: 3400,
    monthlyInsurance: 105,
    monthlyUtilities: 190,
    maintenancePct: 5.3,
    managementFeePct: 8
  },
  "ca-bc-victoria": {
    monthlyRent: 2400,
    vacancyPct: 1.4,
    annualPropertyTax: 3200,
    monthlyInsurance: 110,
    monthlyUtilities: 190,
    maintenancePct: 5.1,
    managementFeePct: 8
  },
  "ca-ab-edmonton": {
    monthlyRent: 2150,
    vacancyPct: 4.2,
    annualPropertyTax: 3300,
    monthlyInsurance: 105,
    monthlyUtilities: 210,
    maintenancePct: 5.9,
    managementFeePct: 8
  },
  "ca-on-ottawa": {
    monthlyRent: 2350,
    vacancyPct: 2.2,
    annualPropertyTax: 3900,
    monthlyInsurance: 115,
    monthlyUtilities: 200,
    maintenancePct: 5.2,
    managementFeePct: 8
  },
  [FALLBACK_REGION.regionCode]: {
    monthlyRent: 2500,
    vacancyPct: 2.5,
    annualPropertyTax: 3600,
    monthlyInsurance: 115,
    monthlyUtilities: 195,
    maintenancePct: 5,
    managementFeePct: 8
  }
};

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function normalizedPostalCode(postal: string): string {
  return postal.toUpperCase().replace(/\s+/gu, "");
}

function provinceFromPostal(postal: string): string | undefined {
  const first = postal.charAt(0).toUpperCase();
  if (["V"].includes(first)) return "BC";
  if (["T"].includes(first)) return "AB";
  if (["K", "L", "M", "N", "P"].includes(first)) return "ON";
  if (["H", "J"].includes(first)) return "QC";
  return undefined;
}

function extractPostalCode(rawPostal: string, address: string): string {
  const normalizedRaw = normalizedPostalCode(rawPostal);
  if (/^[A-Z]\d[A-Z]\d[A-Z]\d$/u.test(normalizedRaw)) {
    return normalizedRaw;
  }
  const match = address.toUpperCase().match(/[A-Z]\d[A-Z]\s?\d[A-Z]\d/u);
  if (match) {
    return normalizedPostalCode(match[0]);
  }
  return "";
}

export function inferRegion(listing: ListingRecord): { regionCode: string; regionLabel: string } {
  const raw = asObject(listing.rawSnapshot);
  const location = asObject(raw.location);
  const nested = asObject(raw.rawSnapshot);
  const nestedLocation = asObject(nested.location);
  const city = normalize(asString(location.city) || asString(nestedLocation.city));
  const rawProvince = asString(location.province) || asString(nestedLocation.province);
  const postalCode = extractPostalCode(
    asString(location.postalCode) || asString(nestedLocation.postalCode),
    listing.address ?? ""
  );
  const inferredProvince = provinceFromPostal(postalCode);
  const province = normalize(rawProvince || inferredProvince || "");
  const address = normalize(listing.address ?? "");
  const fsa = postalCode.slice(0, 3);

  for (const entry of REGION_RULES) {
    const inProvince = province ? normalize(entry.province) === province : true;
    if (!inProvince) {
      continue;
    }
    if (entry.cities.some((c) => city.includes(c) || address.includes(c))) {
      return { regionCode: entry.regionCode, regionLabel: entry.regionLabel };
    }
  }

  if (fsa) {
    for (const entry of REGION_RULES) {
      const inProvince = province ? normalize(entry.province) === province : true;
      if (!inProvince) {
        continue;
      }
      if (entry.fsaPrefixes.some((prefix) => fsa.startsWith(prefix))) {
        return { regionCode: entry.regionCode, regionLabel: entry.regionLabel };
      }
    }
  }

  return FALLBACK_REGION;
}

export function normalizePropertyClass(value?: string): string {
  const text = normalize(value ?? "");
  if (text.includes("duplex")) return "duplex";
  if (text.includes("triplex")) return "multi_family";
  if (text.includes("fourplex")) return "multi_family";
  if (text.includes("town")) return "townhouse";
  if (text.includes("apartment") || text.includes("condo")) return "apartment";
  if (text.includes("house") || text.includes("detached") || text.includes("semi")) return "house";
  return "house";
}

export function bedroomBucket(beds?: number): number {
  if (!beds || beds <= 0) return 1;
  if (beds >= 4) return 4;
  return Math.round(beds);
}

export function sqftBucket(sqft?: number): string {
  if (!sqft || sqft <= 0) return "unknown";
  if (sqft < 600) return "lt_600";
  if (sqft < 900) return "600_899";
  if (sqft < 1200) return "900_1199";
  if (sqft < 1600) return "1200_1599";
  return "gte_1600";
}

export function yearBuiltBucket(listing: ListingRecord): string | undefined {
  const raw = asObject(listing.rawSnapshot);
  const yearBuiltRaw = raw.yearBuilt ?? asObject(raw.rawSnapshot).yearBuilt;
  const yearBuilt = Number(yearBuiltRaw);
  if (!Number.isFinite(yearBuilt)) return undefined;
  if (yearBuilt < 1980) return "pre_1980";
  if (yearBuilt < 2000) return "1980_1999";
  if (yearBuilt < 2015) return "2000_2014";
  return "2015_plus";
}

function scoreMethodRank(method: AssumptionEstimateMethod): number {
  if (method === "direct_match") return 4;
  if (method === "bucket_match") return 3;
  if (method === "regional_fallback") return 2;
  if (method === "default") return 1;
  return 0;
}

function buildSource(
  field: AssumptionField,
  value: number,
  method: AssumptionEstimateMethod,
  confidence: number,
  reference: {
    publisher: string;
    dataset: string;
    metric: string;
    region: string;
    period: string;
    url: string;
    fetchedAt: string;
  },
  notes?: string
): AssumptionSourceDetail {
  return { field, value, method, confidence, reference, notes };
}

function fallbackSource(
  field: AssumptionField,
  value: number,
  regionLabel: string,
  notes: string
): AssumptionSourceDetail {
  return buildSource(
    field,
    value,
    "regional_fallback",
    0.45,
    {
      publisher: "Internal baseline",
      dataset: "Major metro starter benchmark pack",
      metric: field,
      region: regionLabel,
      period: "2025",
      url: "https://www.cmhc-schl.gc.ca/",
      fetchedAt: new Date().toISOString()
    },
    notes
  );
}

export function pickBestRentRow(
  rows: RentBenchmarkRow[],
  propertyClass: string,
  beds: number,
  sqftBand: string,
  yearBand?: string
): { row: RentBenchmarkRow | null; method: AssumptionEstimateMethod; confidence: number } {
  const ordered = rows.slice().sort((a, b) => b.period.localeCompare(a.period));
  const direct = ordered.find(
    (row) =>
      row.property_type === propertyClass &&
      row.bedrooms === beds &&
      row.sqft_band === sqftBand &&
      (yearBand ? row.year_built_band === yearBand || row.year_built_band === null : true)
  );
  if (direct) return { row: direct, method: "direct_match", confidence: 0.95 };

  const bucket = ordered.find((row) => row.property_type === propertyClass && row.bedrooms === beds);
  if (bucket) return { row: bucket, method: "bucket_match", confidence: 0.8 };

  return { row: null, method: "default", confidence: 0.3 };
}

export function pickBestVacancyRow(
  rows: VacancyBenchmarkRow[],
  propertyClass: string
): { row: VacancyBenchmarkRow | null; method: AssumptionEstimateMethod; confidence: number } {
  const ordered = rows.slice().sort((a, b) => b.period.localeCompare(a.period));
  const direct = ordered.find((row) => row.property_type === propertyClass);
  if (direct) return { row: direct, method: "direct_match", confidence: 0.92 };
  const regional = ordered[0];
  if (regional) return { row: regional, method: "regional_fallback", confidence: 0.65 };
  return { row: null, method: "default", confidence: 0.3 };
}

export function pickCostValue(
  rows: CostBenchmarkRow[],
  costType: string,
  propertyClass: string
): { row: CostBenchmarkRow | null; method: AssumptionEstimateMethod; confidence: number } {
  const candidates = rows
    .filter((row) => row.cost_type === costType)
    .sort((a, b) => b.period.localeCompare(a.period));
  const direct = candidates.find((row) => row.property_type === propertyClass);
  if (direct) return { row: direct, method: "direct_match", confidence: 0.88 };
  const generic = candidates.find((row) => row.property_type === null);
  if (generic) return { row: generic, method: "regional_fallback", confidence: 0.68 };
  return { row: null, method: "default", confidence: 0.3 };
}

export async function resolveBenchmarkAssumptions(listing: ListingRecord): Promise<{
  assumptions: ListingAssumptions;
  assumptionSources: AssumptionSources;
  benchmarkContext: BenchmarkContext;
}> {
  const defaults = defaultAssumptionsFor(listing);
  const region = inferRegion(listing);
  const propertyClass = normalizePropertyClass(listing.propertyType);
  const beds = bedroomBucket(listing.beds);
  const sizeBand = sqftBucket(listing.sqft);
  const builtBand = yearBuiltBucket(listing);
  const supabase = getSupabaseAdminClient();

  const [rentResult, vacancyResult, costsResult] = await Promise.all([
    supabase.from("market_rent_benchmarks").select("*").eq("region_code", region.regionCode).limit(250),
    supabase.from("vacancy_benchmarks").select("*").eq("region_code", region.regionCode).limit(100),
    supabase.from("cost_benchmarks").select("*").eq("region_code", region.regionCode).limit(250)
  ]);

  const rentRows = (rentResult.data ?? []) as RentBenchmarkRow[];
  const vacancyRows = (vacancyResult.data ?? []) as VacancyBenchmarkRow[];
  const costRows = (costsResult.data ?? []) as CostBenchmarkRow[];
  const fallbackValues: Partial<ListingAssumptions> =
    FALLBACK_VALUES[region.regionCode] ??
    FALLBACK_VALUES[FALLBACK_REGION.regionCode] ??
    FALLBACK_VALUES["ca-on-gta"] ??
    {};

  const assumptionSources: AssumptionSources = {};
  const assumptions: ListingAssumptions = { ...defaults };

  const rentSelection = pickBestRentRow(rentRows, propertyClass, beds, sizeBand, builtBand);
  if (rentSelection.row) {
    assumptions.monthlyRent = Number(rentSelection.row.median_rent) || defaults.monthlyRent;
    assumptionSources.monthlyRent = buildSource(
      "monthlyRent",
      assumptions.monthlyRent,
      rentSelection.method,
      rentSelection.confidence,
      {
        publisher: rentSelection.row.source_publisher,
        dataset: rentSelection.row.source_name,
        metric: "median_rent",
        region: rentSelection.row.region_label,
        period: rentSelection.row.period,
        url: rentSelection.row.source_url,
        fetchedAt: rentSelection.row.source_fetched_at
      }
    );
  } else {
    assumptions.monthlyRent = 0;
    assumptionSources.monthlyRent = buildSource(
      "monthlyRent",
      assumptions.monthlyRent,
      "default",
      0,
      {
        publisher: "No benchmark match",
        dataset: "StatCan benchmark coverage",
        metric: "median_rent",
        region: region.regionLabel,
        period: "n/a",
        url: "",
        fetchedAt: new Date().toISOString()
      },
      "No rent benchmark found for this property type + bedroom + size bucket."
    );
  }

  const vacancySelection = pickBestVacancyRow(vacancyRows, propertyClass);
  if (vacancySelection.row) {
    assumptions.vacancyPct = Number(vacancySelection.row.vacancy_pct) || defaults.vacancyPct;
    assumptionSources.vacancyPct = buildSource(
      "vacancyPct",
      assumptions.vacancyPct,
      vacancySelection.method,
      vacancySelection.confidence,
      {
        publisher: vacancySelection.row.source_publisher,
        dataset: vacancySelection.row.source_name,
        metric: "vacancy_pct",
        region: vacancySelection.row.region_label,
        period: vacancySelection.row.period,
        url: vacancySelection.row.source_url,
        fetchedAt: vacancySelection.row.source_fetched_at
      }
    );
  } else if (fallbackValues.vacancyPct !== undefined) {
    assumptions.vacancyPct = fallbackValues.vacancyPct;
    assumptionSources.vacancyPct = fallbackSource(
      "vacancyPct",
      assumptions.vacancyPct,
      region.regionLabel,
      "No vacancy benchmark row found for this property class."
    );
  }

  const taxSelection = pickCostValue(costRows, "property_tax", propertyClass);
  if (taxSelection.row) {
    assumptions.annualPropertyTax =
      Number(taxSelection.row.value_annual) ||
      Number(taxSelection.row.value_monthly) * 12 ||
      defaults.annualPropertyTax;
    assumptionSources.annualPropertyTax = buildSource(
      "annualPropertyTax",
      assumptions.annualPropertyTax,
      taxSelection.method,
      taxSelection.confidence,
      {
        publisher: taxSelection.row.source_publisher,
        dataset: taxSelection.row.source_name,
        metric: "property_tax",
        region: taxSelection.row.region_label,
        period: taxSelection.row.period,
        url: taxSelection.row.source_url,
        fetchedAt: taxSelection.row.source_fetched_at
      }
    );
  } else if (fallbackValues.annualPropertyTax) {
    assumptions.annualPropertyTax = fallbackValues.annualPropertyTax;
    assumptionSources.annualPropertyTax = fallbackSource(
      "annualPropertyTax",
      assumptions.annualPropertyTax,
      region.regionLabel,
      "Fallback annual property tax benchmark."
    );
  }

  const insuranceSelection = pickCostValue(costRows, "insurance", propertyClass);
  if (insuranceSelection.row) {
    assumptions.monthlyInsurance =
      Number(insuranceSelection.row.value_monthly) ||
      Number(insuranceSelection.row.value_annual) / 12 ||
      defaults.monthlyInsurance;
    assumptionSources.monthlyInsurance = buildSource(
      "monthlyInsurance",
      assumptions.monthlyInsurance,
      insuranceSelection.method,
      insuranceSelection.confidence,
      {
        publisher: insuranceSelection.row.source_publisher,
        dataset: insuranceSelection.row.source_name,
        metric: "insurance",
        region: insuranceSelection.row.region_label,
        period: insuranceSelection.row.period,
        url: insuranceSelection.row.source_url,
        fetchedAt: insuranceSelection.row.source_fetched_at
      }
    );
  } else if (fallbackValues.monthlyInsurance) {
    assumptions.monthlyInsurance = fallbackValues.monthlyInsurance;
    assumptionSources.monthlyInsurance = fallbackSource(
      "monthlyInsurance",
      assumptions.monthlyInsurance,
      region.regionLabel,
      "Fallback insurance benchmark."
    );
  }

  const utilitiesSelection = pickCostValue(costRows, "utilities", propertyClass);
  if (utilitiesSelection.row) {
    assumptions.monthlyUtilities =
      Number(utilitiesSelection.row.value_monthly) ||
      Number(utilitiesSelection.row.value_annual) / 12 ||
      defaults.monthlyUtilities;
    assumptionSources.monthlyUtilities = buildSource(
      "monthlyUtilities",
      assumptions.monthlyUtilities,
      utilitiesSelection.method,
      utilitiesSelection.confidence,
      {
        publisher: utilitiesSelection.row.source_publisher,
        dataset: utilitiesSelection.row.source_name,
        metric: "utilities",
        region: utilitiesSelection.row.region_label,
        period: utilitiesSelection.row.period,
        url: utilitiesSelection.row.source_url,
        fetchedAt: utilitiesSelection.row.source_fetched_at
      }
    );
  } else if (fallbackValues.monthlyUtilities) {
    assumptions.monthlyUtilities = fallbackValues.monthlyUtilities;
    assumptionSources.monthlyUtilities = fallbackSource(
      "monthlyUtilities",
      assumptions.monthlyUtilities,
      region.regionLabel,
      "Fallback utilities benchmark."
    );
  }

  const maintenanceSelection = pickCostValue(costRows, "maintenance_pct", propertyClass);
  if (maintenanceSelection.row) {
    assumptions.maintenancePct =
      Number(maintenanceSelection.row.value_monthly) ||
      Number(maintenanceSelection.row.value_annual) ||
      defaults.maintenancePct;
    assumptionSources.maintenancePct = buildSource(
      "maintenancePct",
      assumptions.maintenancePct,
      maintenanceSelection.method,
      maintenanceSelection.confidence,
      {
        publisher: maintenanceSelection.row.source_publisher,
        dataset: maintenanceSelection.row.source_name,
        metric: "maintenance_pct",
        region: maintenanceSelection.row.region_label,
        period: maintenanceSelection.row.period,
        url: maintenanceSelection.row.source_url,
        fetchedAt: maintenanceSelection.row.source_fetched_at
      }
    );
  } else if (fallbackValues.maintenancePct !== undefined) {
    assumptions.maintenancePct = fallbackValues.maintenancePct;
    assumptionSources.maintenancePct = fallbackSource(
      "maintenancePct",
      assumptions.maintenancePct,
      region.regionLabel,
      "Fallback maintenance benchmark."
    );
  }

  const managementSelection = pickCostValue(costRows, "management_fee_pct", propertyClass);
  if (managementSelection.row) {
    assumptions.managementFeePct =
      Number(managementSelection.row.value_monthly) ||
      Number(managementSelection.row.value_annual) ||
      defaults.managementFeePct;
    assumptionSources.managementFeePct = buildSource(
      "managementFeePct",
      assumptions.managementFeePct,
      managementSelection.method,
      managementSelection.confidence,
      {
        publisher: managementSelection.row.source_publisher,
        dataset: managementSelection.row.source_name,
        metric: "management_fee_pct",
        region: managementSelection.row.region_label,
        period: managementSelection.row.period,
        url: managementSelection.row.source_url,
        fetchedAt: managementSelection.row.source_fetched_at
      }
    );
  } else if (fallbackValues.managementFeePct !== undefined) {
    assumptions.managementFeePct = fallbackValues.managementFeePct;
    assumptionSources.managementFeePct = fallbackSource(
      "managementFeePct",
      assumptions.managementFeePct,
      region.regionLabel,
      "Fallback management fee benchmark."
    );
  }

  const context: BenchmarkContext = {
    regionCode: region.regionCode,
    regionLabel: region.regionLabel,
    propertyClass,
    bedroomBucket: beds,
    sqftBucket: sizeBand,
    yearBuiltBucket: builtBand
  };

  for (const [field, value] of Object.entries(assumptions) as Array<[AssumptionField, number]>) {
    if (assumptionSources[field]) {
      continue;
    }
    const defaultMethod = scoreMethodRank("default");
    assumptionSources[field] = buildSource(
      field,
      value,
      "default",
      defaultMethod / 10,
      {
        publisher: "App default assumptions",
        dataset: "REA internal defaults",
        metric: field,
        region: context.regionLabel,
        period: "static",
        url: "https://www.cmhc-schl.gc.ca/",
        fetchedAt: new Date().toISOString()
      },
      "No benchmark found; using application default."
    );
  }

  return {
    assumptions,
    assumptionSources,
    benchmarkContext: context
  };
}
