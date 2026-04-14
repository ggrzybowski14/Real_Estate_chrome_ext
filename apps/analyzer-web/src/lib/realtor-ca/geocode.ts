export type GeocodeHit = {
  lat: number;
  lon: number;
  displayName: string;
};

/**
 * OpenStreetMap Nominatim (free). Use only for light volume; respect usage policy.
 */
export async function geocodeLocationQuery(query: string): Promise<GeocodeHit | null> {
  const q = query.trim();
  if (!q) return null;
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "ca");
  url.searchParams.set("q", q);

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": "RealEstateAnalyzer/1.0 (contact: local-dev)"
    },
    cache: "no-store"
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Array<{ lat: string; lon: string; display_name?: string }>;
  const first = data[0];
  if (!first) return null;
  const lat = Number(first.lat);
  const lon = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    lat,
    lon,
    displayName: first.display_name ?? q
  };
}
