export type RealtorBoundingBox = ReturnType<typeof boundingBoxFromCenterMiles>;

/** Approximate degrees per mile at latitude (WGS84 rough). */
export function boundingBoxFromCenterMiles(
  lat: number,
  lon: number,
  radiusMiles: number
): {
  LatitudeMin: number;
  LatitudeMax: number;
  LongitudeMin: number;
  LongitudeMax: number;
} {
  const latDelta = radiusMiles / 69;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const lonScale = Math.max(Math.abs(cosLat), 0.2);
  const lonDelta = radiusMiles / (69 * lonScale);
  return {
    LatitudeMin: lat - latDelta,
    LatitudeMax: lat + latDelta,
    LongitudeMin: lon - lonDelta,
    LongitudeMax: lon + lonDelta
  };
}
