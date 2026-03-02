"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ingestAndAnalyze, parseIncomingListing } from "@/lib/ingest";

export default function IngestPage() {
  const [message, setMessage] = useState("Waiting for listing payload...");
  const [targetListingId, setTargetListingId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payload = params.get("payload");
    if (!payload) {
      setMessage("No payload found in URL.");
      return;
    }

    const listing = parseIncomingListing(decodeURIComponent(payload));
    if (!listing) {
      setMessage("Payload was invalid and could not be parsed.");
      return;
    }

    const stored = ingestAndAnalyze(listing);
    setTargetListingId(stored.listing.id);
    setMessage(
      `Saved listing and auto-ran ROI. Score: ${stored.latestAnalysis.score.toUpperCase()}`
    );
  }, []);

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
    </main>
  );
}
