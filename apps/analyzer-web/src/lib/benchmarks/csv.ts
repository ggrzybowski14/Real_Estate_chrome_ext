function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values.map((value) => value.trim());
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

export function parseCsvRows(rawCsv: string): Array<Record<string, string>> {
  const lines = rawCsv
    .replace(/\r\n/gu, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return [];
  }
  const headers = splitCsvLine(lines[0]).map(normalizeHeader);
  const rows: Array<Record<string, string>> = [];
  for (const line of lines.slice(1)) {
    const values = splitCsvLine(line);
    if (values.length === 0) {
      continue;
    }
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

export function pickColumn(
  row: Record<string, string>,
  candidates: string[]
): string | undefined {
  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    if (row[key] !== undefined && row[key] !== "") {
      return row[key];
    }
  }
  return undefined;
}

export function parseNumber(value?: string): number | null {
  if (!value) {
    return null;
  }
  const cleaned = value.replace(/[$,\s]/gu, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}
