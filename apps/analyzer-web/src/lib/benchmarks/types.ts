export type MarketRentBenchmarkInsert = {
  region_code: string;
  region_label: string;
  property_type: string;
  bedrooms: number;
  sqft_band: string;
  year_built_band: string | null;
  period: string;
  median_rent: number;
  p25_rent: number | null;
  p75_rent: number | null;
  source_name: string;
  source_publisher: string;
  source_url: string;
  source_fetched_at: string;
  notes: string | null;
};

export type StatcanRefreshSummary = {
  insertedMarketRents: number;
  deletedExistingMarketRents: number;
  quarterlyRows: number;
  cmhcRows: number;
  fetchedAt: string;
};
