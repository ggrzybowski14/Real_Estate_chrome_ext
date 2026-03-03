"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ListingAssumptions } from "@rea/shared";
import { formatCurrency, formatPct } from "@/lib/format";
import { getListingDisplayData } from "@/lib/listing-display";
import type { StoredListing } from "@/lib/types";

type AssumptionField = keyof ListingAssumptions;

export default function ListingDetailPage({ params }: { params: { id: string } }) {
  const [stored, setStored] = useState<StoredListing | null>(null);
  const [assumptions, setAssumptions] = useState<ListingAssumptions | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/listings/${params.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.error) {
          setError(data.error);
          return;
        }
        const current = data as StoredListing;
        setStored(current);
        setAssumptions(current.assumptions);
      })
      .catch(() => setError("Could not load listing"));
  }, [params.id]);

  const latest = stored?.latestAnalysis;
  const scoreClass = latest ? `score-${latest.score}` : "";
  const previousRun = stored?.history?.[1];
  const display = stored ? getListingDisplayData(stored.listing) : null;

  const canRun = Boolean(stored && assumptions);
  const assumptionEntries = useMemo(
    () => Object.entries(assumptions ?? {}) as [AssumptionField, number][],
    [assumptions]
  );

  function updateField(key: AssumptionField, value: number): void {
    if (!assumptions) {
      return;
    }
    setAssumptions({ ...assumptions, [key]: value });
  }

  function rerunAnalysis(): void {
    if (!stored || !assumptions) {
      return;
    }
    void fetch(`/api/listings/${stored.listing.id}/rerun`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ assumptions })
    })
      .then((res) => res.json())
      .then((data) => {
        if (data?.error) {
          setError(data.error);
          return;
        }
        const next = data as StoredListing;
        setStored(next);
        setAssumptions(next.assumptions);
      })
      .catch(() => setError("Could not rerun analysis"));
  }

  if (!stored || !assumptions || !latest) {
    return (
      <main>
        <h1>{error ? "Could not load listing" : "Listing not found"}</h1>
        {error ? <p>{error}</p> : null}
        <p>
          <Link href="/">Back to listings</Link>
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>{stored.listing.address ?? "Untitled listing"}</h1>
      <p>
        <a href={stored.listing.url} target="_blank" rel="noreferrer">
          Open source listing
        </a>
      </p>
      {error ? <div className="card">{error}</div> : null}

      <div className="card">
        <h3>Listing details</h3>
        {display?.photoUrls?.length ? (
          <div>
            <p>
              <img
                src={display.photoUrls[0]}
                alt="Main listing photo"
                style={{
                  width: "100%",
                  maxWidth: 760,
                  maxHeight: 440,
                  objectFit: "cover",
                  borderRadius: 8
                }}
              />
            </p>
            {display.photoUrls.length > 1 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
                {display.photoUrls.slice(1, 9).map((photoUrl) => (
                  <img
                    key={photoUrl}
                    src={photoUrl}
                    alt="Listing gallery"
                    style={{ width: "100%", height: 96, objectFit: "cover", borderRadius: 6 }}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <p>
            No listing photos were captured for this property yet. Older listings ingested before
            photo capture was added will not have images until you re-open that listing on
            realtor.ca and run the extension again.
          </p>
        )}

        <div className="grid">
          <div>
            <div className="label">Price</div>
            <div className="value">
              {stored.listing.price ? formatCurrency(stored.listing.price) : "Unknown"}
            </div>
          </div>
          <div>
            <div className="label">Location</div>
            <div className="value">
              {[display?.street, display?.city, display?.province, display?.postalCode]
                .filter(Boolean)
                .join(", ") || stored.listing.address || "Unknown"}
            </div>
          </div>
          <div>
            <div className="label">Property type</div>
            <div className="value">{display?.propertyType ?? stored.listing.propertyType ?? "-"}</div>
          </div>
          <div>
            <div className="label">Beds / Baths</div>
            <div className="value">
              {stored.listing.beds ?? "-"} / {stored.listing.baths ?? "-"}
            </div>
          </div>
          <div>
            <div className="label">Square feet</div>
            <div className="value">{stored.listing.sqft ?? "-"}</div>
          </div>
        </div>
        <p>{display?.description ?? stored.listing.description ?? ""}</p>
      </div>

      <div className="card">
        <div className="grid">
          <div>
            <div className="label">Score</div>
            <div className={`value ${scoreClass}`}>{latest.score.toUpperCase()}</div>
          </div>
          <div>
            <div className="label">ROI</div>
            <div className="value">{formatPct(latest.annualCashOnCashRoiPct)}</div>
          </div>
          <div>
            <div className="label">Monthly cash flow</div>
            <div className="value">{formatCurrency(latest.monthlyCashFlow)}</div>
          </div>
          <div>
            <div className="label">Break-even occupancy</div>
            <div className="value">{formatPct(latest.breakEvenOccupancyPct)}</div>
          </div>
        </div>
        {previousRun ? (
          <p>
            Since previous run: ROI{" "}
            {formatPct(latest.annualCashOnCashRoiPct - previousRun.annualCashOnCashRoiPct)} | Cash
            flow {formatCurrency(latest.monthlyCashFlow - previousRun.monthlyCashFlow)}
          </p>
        ) : null}
      </div>

      <div className="card">
        <h3>Assumptions</h3>
        <div className="grid">
          {assumptionEntries.map(([key, value]) => (
            <label key={key}>
              <div className="label">{key}</div>
              <input
                value={value}
                type="number"
                onChange={(event) => updateField(key, Number(event.target.value))}
              />
            </label>
          ))}
        </div>
        <p>
          <button onClick={rerunAnalysis} disabled={!canRun}>
            Rerun analysis
          </button>
        </p>
      </div>

      <div className="card">
        <h3>Run history</h3>
        {stored.history.slice(0, 5).map((run, index) => (
          <p key={`${run.runAt}-${index}`}>
            {run.runAt} - {run.score.toUpperCase()} - ROI {formatPct(run.annualCashOnCashRoiPct)}
          </p>
        ))}
      </div>

      <p>
        <Link href="/">Back to listings</Link>
      </p>
    </main>
  );
}
