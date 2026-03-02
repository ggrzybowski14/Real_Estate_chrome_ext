import type { ListingAnalysisResult, ListingAssumptions, ListingRecord } from "@rea/shared";

export interface StoredListing {
  listing: ListingRecord;
  assumptions: ListingAssumptions;
  latestAnalysis: ListingAnalysisResult;
  history: ListingAnalysisResult[];
}
