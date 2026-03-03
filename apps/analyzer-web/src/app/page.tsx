"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { StoredListing } from "@/lib/types";
import { formatCurrency, formatPct } from "@/lib/format";

export default function HomePage() {
  const [items, setItems] = useState<StoredListing[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/listings")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setItems(data as StoredListing[]);
        } else {
          setError(data?.error ?? "Could not load listings");
        }
      })
      .catch(() => setError("Could not load listings"));
  }, []);

  return (
    <main>
      <h1>Real Estate Analyzer</h1>
      <p>Captured listings and latest ROI score.</p>
      <div className="card">
        <Link href="/ingest">Open ingest page</Link>
      </div>
      {error ? <div className="card">{error}</div> : null}
      {items.length === 0 ? (
        <div className="card">No listings yet. Use the Chrome extension on realtor.ca.</div>
      ) : (
        items.map((item) => (
          <div key={item.listing.id} className="card">
            <h3>{item.listing.address ?? "Untitled listing"}</h3>
            <p>{item.listing.url}</p>
            <div className="grid">
              <div>
                <div className="label">Price</div>
                <div className="value">
                  {item.listing.price ? formatCurrency(item.listing.price) : "Unknown"}
                </div>
              </div>
              <div>
                <div className="label">ROI</div>
                <div className="value">
                  {formatPct(item.latestAnalysis.annualCashOnCashRoiPct)}
                </div>
              </div>
              <div>
                <div className="label">Cash flow</div>
                <div className="value">
                  {formatCurrency(item.latestAnalysis.monthlyCashFlow)}
                </div>
              </div>
              <div>
                <div className="label">Score</div>
                <div className={`value score-${item.latestAnalysis.score}`}>
                  {item.latestAnalysis.score.toUpperCase()}
                </div>
              </div>
            </div>
            <p>
              <Link href={`/listings/${item.listing.id}`}>Open details</Link>
            </p>
          </div>
        ))
      )}
    </main>
  );
}
