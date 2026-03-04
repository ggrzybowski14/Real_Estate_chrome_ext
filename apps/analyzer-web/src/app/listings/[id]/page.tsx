"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type {
  AssumptionField,
  AssumptionSourceDetail,
  AssumptionSources,
  BenchmarkContext,
  ListingAssumptions
} from "@rea/shared";
import { formatCurrency, formatPct } from "@/lib/format";
import { getListingDisplayData } from "@/lib/listing-display";
import type { StoredListing } from "@/lib/types";

export default function ListingDetailPage({ params }: { params: { id: string } }) {
  const [stored, setStored] = useState<StoredListing | null>(null);
  const [assumptions, setAssumptions] = useState<ListingAssumptions | null>(null);
  const [assumptionSources, setAssumptionSources] = useState<AssumptionSources>({});
  const [benchmarkContext, setBenchmarkContext] = useState<BenchmarkContext | undefined>(undefined);
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
        setAssumptionSources(current.latestAnalysis.assumptionSources ?? {});
        setBenchmarkContext(current.latestAnalysis.benchmarkContext);
      })
      .catch(() => setError("Could not load listing"));
  }, [params.id]);

  const latest = stored?.latestAnalysis;
  const scoreClass = latest ? `score-${latest.score}` : "";
  const previousRun = stored?.history?.[1];
  const display = stored ? getListingDisplayData(stored.listing) : null;
  const propertyCost = stored?.listing.price ?? 0;
  const downPaymentCost = propertyCost * ((assumptions?.downPaymentPct ?? 0) / 100);
  const closingCosts = propertyCost * ((assumptions?.closingCostsPct ?? 0) / 100);
  const financedAmount = Math.max(propertyCost - downPaymentCost, 0);
  const monthlyPropertyTax = (assumptions?.annualPropertyTax ?? 0) / 12;
  const monthlyMaintenance = (assumptions?.monthlyRent ?? 0) * ((assumptions?.maintenancePct ?? 0) / 100);
  const monthlyManagement = (assumptions?.monthlyRent ?? 0) * ((assumptions?.managementFeePct ?? 0) / 100);
  const monthlyStrataFees = stored?.listing.condoFeesMonthly ?? 0;
  const grossMonthlyUpkeepCost =
    monthlyMaintenance +
    monthlyPropertyTax +
    (assumptions?.monthlyInsurance ?? 0) +
    (assumptions?.monthlyUtilities ?? 0) +
    monthlyManagement +
    monthlyStrataFees;
  const grossAnnualUpkeepCost = grossMonthlyUpkeepCost * 12;
  const effectiveMonthlyRent = (assumptions?.monthlyRent ?? 0) * (1 - (assumptions?.vacancyPct ?? 0) / 100);
  const grossAnnualRentAfterVacancy = effectiveMonthlyRent * 12;
  const capRatePct = propertyCost > 0 ? (latest ? (latest.annualNOI / propertyCost) * 100 : 0) : 0;

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
    setAssumptionSources((previous) => {
      const existing = previous[key];
      const reference = existing?.reference ?? {
        publisher: "User input",
        dataset: "Manual override",
        metric: key,
        region: benchmarkContext?.regionLabel ?? "Custom",
        period: new Date().toISOString().slice(0, 10),
        url: "",
        fetchedAt: new Date().toISOString()
      };
      return {
        ...previous,
        [key]: {
          field: key,
          value,
          method: "manual",
          confidence: 1,
          notes: "User edited this value in assumptions.",
          reference
        }
      };
    });
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
      body: JSON.stringify({ assumptions, assumptionSources, benchmarkContext })
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
        setAssumptionSources(next.latestAnalysis.assumptionSources ?? {});
        setBenchmarkContext(next.latestAnalysis.benchmarkContext);
      })
      .catch(() => setError("Could not rerun analysis"));
  }

  function sourceFor(field: AssumptionField): AssumptionSourceDetail | undefined {
    return assumptionSources[field];
  }

  function SourceHelp({ field }: { field: AssumptionField }) {
    const source = sourceFor(field);
    if (!source) {
      return (
        <span className="source-help source-help-muted" title="No benchmark source available yet">
          ?
        </span>
      );
    }

    return (
      <span className="source-help-wrap">
        <span className="source-help" tabIndex={0} aria-label={`Source for ${field}`}>
          ?
        </span>
        <span className="source-help-popover">
          <strong>{source.reference.dataset}</strong>
          <br />
          {source.reference.publisher}
          <br />
          Region: {source.reference.region}
          <br />
          Period: {source.reference.period}
          <br />
          Method: {source.method}
          <br />
          Confidence: {Math.round(source.confidence * 100)}%
          {source.notes ? (
            <>
              <br />
              Note: {source.notes}
            </>
          ) : null}
          {source.reference.url ? (
            <>
              <br />
              <a href={source.reference.url} target="_blank" rel="noreferrer">
                Reference link
              </a>
            </>
          ) : null}
        </span>
      </span>
    );
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
            <div className="label">Building type</div>
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
        <h3>Investment indicators</h3>
        <table className="underwriting-table">
          <tbody>
            <tr>
              <td className="label">Score</td>
              <td className={`value ${scoreClass}`}>{latest.score.toUpperCase()}</td>
            </tr>
            <tr>
              <td className="label">ROI (cash-on-cash)</td>
              <td className="value">{formatPct(latest.annualCashOnCashRoiPct)}</td>
            </tr>
            <tr>
              <td className="label">Monthly cash flow</td>
              <td className="value">{formatCurrency(latest.monthlyCashFlow)}</td>
            </tr>
            <tr>
              <td className="label">Cap rate</td>
              <td className="value">{formatPct(capRatePct)}</td>
            </tr>
          </tbody>
        </table>
        {previousRun ? (
          <p>
            Since previous run: ROI{" "}
            {formatPct(latest.annualCashOnCashRoiPct - previousRun.annualCashOnCashRoiPct)} | Cash
            flow {formatCurrency(latest.monthlyCashFlow - previousRun.monthlyCashFlow)}
          </p>
        ) : null}
      </div>

      <div className="card">
        <h3>Underwriting summary</h3>
        <h4 className="underwriting-subtitle">Buying costs</h4>
        <table className="underwriting-table underwriting-table-section">
          <tbody>
            <tr>
              <td className="label">Property cost</td>
              <td className="value">{formatCurrency(propertyCost)}</td>
            </tr>
            <tr>
              <td className="label">Down payment ({assumptions.downPaymentPct}%)</td>
              <td className="value">
                {formatCurrency(downPaymentCost)} <SourceHelp field="downPaymentPct" />
              </td>
            </tr>
            <tr>
              <td className="label">Estimated closing costs ({assumptions.closingCostsPct}%)</td>
              <td className="value">{formatCurrency(closingCosts)}</td>
            </tr>
            <tr>
              <td className="label">Financed amount</td>
              <td className="value">{formatCurrency(financedAmount)}</td>
            </tr>
            <tr>
              <td className="label">Mortgage rate</td>
              <td className="value">
                {formatPct(assumptions.mortgageRatePct)} <SourceHelp field="mortgageRatePct" />
              </td>
            </tr>
            <tr>
              <td className="label">Amortization</td>
              <td className="value">
                {assumptions.amortizationYears} years <SourceHelp field="amortizationYears" />
              </td>
            </tr>
          </tbody>
        </table>

        <h4 className="underwriting-subtitle">Upkeep costs</h4>
        <table className="underwriting-table underwriting-table-section">
          <tbody>
            <tr>
              <td className="label">Maintenance</td>
              <td className="value">
                {formatCurrency(monthlyMaintenance)} / month <SourceHelp field="maintenancePct" />
              </td>
            </tr>
            <tr>
              <td className="label">Property tax</td>
              <td className="value">
                {formatCurrency(monthlyPropertyTax)} / month <SourceHelp field="annualPropertyTax" />
              </td>
            </tr>
            <tr>
              <td className="label">Insurance</td>
              <td className="value">
                {formatCurrency(assumptions.monthlyInsurance)} / month <SourceHelp field="monthlyInsurance" />
              </td>
            </tr>
            <tr>
              <td className="label">Utilities</td>
              <td className="value">
                {formatCurrency(assumptions.monthlyUtilities)} / month <SourceHelp field="monthlyUtilities" />
              </td>
            </tr>
            <tr>
              <td className="label">Management</td>
              <td className="value">
                {formatCurrency(monthlyManagement)} / month <SourceHelp field="managementFeePct" />
              </td>
            </tr>
            <tr>
              <td className="label">Strata / condo fees</td>
              <td className="value">{formatCurrency(monthlyStrataFees)} / month</td>
            </tr>
            <tr>
              <td className="label">Gross monthly upkeep cost</td>
              <td className="value">{formatCurrency(grossMonthlyUpkeepCost)}</td>
            </tr>
            <tr>
              <td className="label">Gross annual upkeep cost</td>
              <td className="value">{formatCurrency(grossAnnualUpkeepCost)}</td>
            </tr>
          </tbody>
        </table>

        <h4 className="underwriting-subtitle">Estimated income</h4>
        <table className="underwriting-table underwriting-table-section">
          <tbody>
            <tr>
              <td className="label">Monthly rent</td>
              <td className="value">
                {formatCurrency(assumptions.monthlyRent)} <SourceHelp field="monthlyRent" />
              </td>
            </tr>
            <tr>
              <td className="label">Vacancy rate</td>
              <td className="value">
                {formatPct(assumptions.vacancyPct)} <SourceHelp field="vacancyPct" />
              </td>
            </tr>
            <tr>
              <td className="label">Monthly rent after vacancy</td>
              <td className="value">{formatCurrency(effectiveMonthlyRent)}</td>
            </tr>
            <tr>
              <td className="label">Gross annual rent (after vacancy)</td>
              <td className="value">{formatCurrency(grossAnnualRentAfterVacancy)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Assumptions and rerun</h3>
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
