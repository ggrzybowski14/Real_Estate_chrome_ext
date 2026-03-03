"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ListingAnalysisResult, ListingRecord } from "@rea/shared";
import { formatCurrency, formatPct } from "@/lib/format";
import { getListingDisplayData } from "@/lib/listing-display";

export default function IngestPage() {
  const [message, setMessage] = useState("Waiting for listing payload...");
  const [targetListingId, setTargetListingId] = useState<string | null>(null);
  const [listingPreview, setListingPreview] = useState<ListingRecord | null>(null);
  const [analysisPreview, setAnalysisPreview] = useState<ListingAnalysisResult | null>(null);
  const hasIngestedRef = useRef(false);

  useEffect(() => {
    if (hasIngestedRef.current) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const payload = params.get("payload");
    if (!payload) {
      setMessage("No payload found in URL.");
      return;
    }

    const decoded = decodeURIComponent(payload);
    let parsedPayload: unknown = null;
    try {
      parsedPayload = JSON.parse(decoded);
    } catch {
      setMessage("Payload was invalid and could not be parsed.");
      return;
    }

    hasIngestedRef.current = true;
    void fetch("/api/ingest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(parsedPayload)
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data?.listingId) {
          setMessage(data?.error ?? "Could not ingest listing.");
          return;
        }
        setTargetListingId(data.listingId as string);
        setListingPreview((data.listing as ListingRecord) ?? null);
        setAnalysisPreview((data.latestAnalysis as ListingAnalysisResult) ?? null);
        setMessage(`Saved listing and auto-ran ROI. Score: ${String(data.score).toUpperCase()}`);
      })
      .catch(() => setMessage("Could not ingest listing."));
  }, []);

  const display = listingPreview ? getListingDisplayData(listingPreview) : null;
  const heroPhoto = display?.photoUrls?.[0];

  return (
    <main>
      <h1>Listing Ingest</h1>
      <div className="card">
        <p>{message}</p>
        {targetListingId ? (
          <p>
            <Link href={`/listings/${targetListingId}`}>Open analyzed listing</Link>
          </p>
        ) : null}
        <p>
          <Link href="/">Back to listings</Link>
        </p>
      </div>
      {listingPreview ? (
        <div className="card">
          <h3>{listingPreview.address ?? "Captured listing"}</h3>
          {heroPhoto ? (
            <p>
              <img
                src={heroPhoto}
                alt="Listing"
                style={{
                  width: "100%",
                  maxWidth: 720,
                  maxHeight: 420,
                  objectFit: "cover",
                  borderRadius: 8
                }}
              />
            </p>
          ) : null}
          <div className="grid">
            <div>
              <div className="label">Price</div>
              <div className="value">
                {listingPreview.price ? formatCurrency(listingPreview.price) : "Unknown"}
              </div>
            </div>
            <div>
              <div className="label">Beds / Baths</div>
              <div className="value">
                {listingPreview.beds ?? "-"} / {listingPreview.baths ?? "-"}
              </div>
            </div>
            <div>
              <div className="label">Sqft</div>
              <div className="value">{listingPreview.sqft ?? "Unknown"}</div>
            </div>
            <div>
              <div className="label">Type</div>
              <div className="value">{display?.propertyType ?? listingPreview.propertyType ?? "-"}</div>
            </div>
          </div>
          <p>{display?.description ?? listingPreview.description ?? ""}</p>
          {analysisPreview ? (
            <div className="grid">
              <div>
                <div className="label">ROI</div>
                <div className="value">{formatPct(analysisPreview.annualCashOnCashRoiPct)}</div>
              </div>
              <div>
                <div className="label">Cash flow</div>
                <div className="value">{formatCurrency(analysisPreview.monthlyCashFlow)}</div>
              </div>
              <div>
                <div className="label">Score</div>
                <div className={`value score-${analysisPreview.score}`}>
                  {analysisPreview.score.toUpperCase()}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
