/** Realtor.ca map search snaps prices to discrete tiers (see legacy realtorca npm package). */
const PRICE_TIERS = [
  0, 25000, 50000, 75000, 100000, 125000, 150000, 175000, 200000, 225000, 250000, 275000, 300000,
  325000, 350000, 375000, 400000, 425000, 450000, 475000, 500000, 550000, 600000, 650000, 700000,
  750000, 800000, 850000, 900000, 950000, 1000000, 1100000, 1200000, 1300000, 1400000, 1500000,
  1600000, 1700000, 1800000, 1900000, 2000000, 2500000, 3000000, 4000000, 5000000, 7500000, 10000000
];

export function snapPriceMaxToTier(max: number): number {
  if (max <= 0) return PRICE_TIERS[0] ?? 0;
  if (PRICE_TIERS.includes(max)) return max;
  const cap = PRICE_TIERS[PRICE_TIERS.length - 1] ?? max;
  if (max > cap) return cap;
  for (const tier of PRICE_TIERS) {
    if (tier >= max) return tier;
  }
  return max;
}

export function snapPriceMinToTier(min: number): number {
  if (min <= 0) return 0;
  if (PRICE_TIERS.includes(min)) return min;
  for (let i = PRICE_TIERS.length - 1; i >= 0; i -= 1) {
    const tier = PRICE_TIERS[i];
    if (tier !== undefined && tier <= min) return tier;
  }
  return 0;
}
