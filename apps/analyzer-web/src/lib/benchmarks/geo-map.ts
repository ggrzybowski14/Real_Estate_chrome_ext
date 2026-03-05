type RegionMapEntry = {
  regionCode: string;
  regionLabel: string;
  aliases: string[];
};

const REGION_MAP: RegionMapEntry[] = [
  {
    regionCode: "ca-on-gta",
    regionLabel: "Greater Toronto Area, ON",
    aliases: ["toronto", "toronto cma", "greater toronto area", "mississauga", "brampton"]
  },
  {
    regionCode: "ca-bc-vancouver",
    regionLabel: "Metro Vancouver, BC",
    aliases: ["vancouver", "vancouver cma", "metro vancouver", "burnaby", "surrey", "richmond"]
  },
  {
    regionCode: "ca-bc-victoria",
    regionLabel: "Greater Victoria, BC",
    aliases: ["victoria", "victoria cma", "greater victoria", "sidney", "saanich", "langford"]
  },
  {
    regionCode: "ca-ab-calgary",
    regionLabel: "Calgary, AB",
    aliases: ["calgary", "calgary cma"]
  },
  {
    regionCode: "ca-ab-edmonton",
    regionLabel: "Edmonton, AB",
    aliases: ["edmonton", "edmonton cma"]
  },
  {
    regionCode: "ca-qc-montreal",
    regionLabel: "Montreal, QC",
    aliases: ["montreal", "montréal", "montreal cma", "laval", "longueuil"]
  },
  {
    regionCode: "ca-on-ottawa",
    regionLabel: "Ottawa, ON",
    aliases: ["ottawa", "ottawa cma", "ottawa gatineau", "ottawa-gatineau"]
  }
];

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

export function mapStatcanGeographyToRegion(
  geography: string
): { regionCode: string; regionLabel: string } | null {
  const normalized = normalize(geography);
  for (const entry of REGION_MAP) {
    if (entry.aliases.some((alias) => normalized.includes(normalize(alias)))) {
      return { regionCode: entry.regionCode, regionLabel: entry.regionLabel };
    }
  }
  return null;
}

export function parseBedrooms(text: string): number | null {
  const normalized = normalize(text);
  if (!normalized) {
    return null;
  }
  if (normalized.includes("bachelor") || normalized.includes("studio") || normalized.includes("0 bedroom")) {
    return 1;
  }
  if (normalized.includes("one bedroom") || normalized.includes("1 bedroom")) {
    return 1;
  }
  if (normalized.includes("two bedroom") || normalized.includes("2 bedroom")) {
    return 2;
  }
  if (normalized.includes("three bedroom") || normalized.includes("3 bedroom")) {
    return 3;
  }
  if (normalized.includes("four bedroom") || normalized.includes("4 bedroom") || normalized.includes("4+")) {
    return 4;
  }
  const explicit = normalized.match(/\b([1-4])\b/u);
  if (explicit) {
    return Number(explicit[1]);
  }
  return null;
}

export function parsePeriod(rawPeriod: string): string | null {
  const text = rawPeriod.trim();
  if (!text) {
    return null;
  }
  const quarterMatch = text.match(/(20\d{2})\s*[-/ ]?\s*q([1-4])/iu);
  if (quarterMatch) {
    return `${quarterMatch[1]}-Q${quarterMatch[2]}`;
  }
  const quarterWords = text.match(/(20\d{2}).*(first|second|third|fourth)/iu);
  if (quarterWords) {
    const quarterMap: Record<string, string> = {
      first: "Q1",
      second: "Q2",
      third: "Q3",
      fourth: "Q4"
    };
    return `${quarterWords[1]}-${quarterMap[quarterWords[2].toLowerCase()]}`;
  }
  const yearMatch = text.match(/\b(20\d{2})\b/u);
  if (yearMatch) {
    return yearMatch[1];
  }
  return null;
}

export function parsePropertyType(raw: string): string {
  const normalized = normalize(raw);
  if (!normalized) {
    return "apartment";
  }
  if (normalized.includes("town")) return "townhouse";
  if (normalized.includes("duplex")) return "duplex";
  if (normalized.includes("house") || normalized.includes("detached")) return "house";
  return "apartment";
}
