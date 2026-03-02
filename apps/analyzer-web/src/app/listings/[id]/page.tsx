"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { runRoiAnalysis } from "@rea/analysis";
import type { ListingAssumptions } from "@rea/shared";
import { formatCurrency, formatPct } from "@/lib/format";
import { listingRepository } from "@/lib/repository";
import type { StoredListing } from "@/lib/types";

type AssumptionField = keyof ListingAssumptions;

export default function ListingDetailPage({ params }: { params: { id: string } }) {
  const [stored, setStored] = useState<StoredListing | null>(null);
  const [assumptions, setAssumptions] = useState<ListingAssumptions | null>(null);

  useEffect(() => {
    const current = listingRepository.get(params.id) ?? null;
    setStored(current);
    setAssumptions(current?.assumptions ?? null);
  }, [params.id]);

  const latest = stored?.latestAnalysis;
  const scoreClass = latest ? `score-${latest.score}` : "";
  const previousRun = stored?.history?.[1];

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
    const result = runRoiAnalysis(stored.listing, assumptions);
    const next: StoredListing = {
      ...stored,
      assumptions,
      latestAnalysis: result,
      history: [result, ...stored.history]
    };
    listingRepository.upsert(next);
    setStored(next);
  }

  if (!stored || !assumptions || !latest) {
    return (
      <main>
        <h1>Listing not found</h1>
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
