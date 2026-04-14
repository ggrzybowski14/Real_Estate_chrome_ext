"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { DomExploreDiagnostics } from "@/lib/realtor-ca/realtor-dom-types";
import type { RealtorExploreListingPayload } from "@/lib/realtor-ca/types";
import { formatCurrency } from "@/lib/format";

const SCRAPER_STORAGE_KEY = "rea-explore-scraper";

type ExploreTimingProfile = {
  conservativeMode: boolean;
  delayProfile: string;
  caps: {
    maxSearchPages: number;
    recordsPerPage: number;
    maxDetailListings: number;
  };
  rangesMs: {
    detailDelay: { min: number; max: number };
    mapSettle: { min: number; max: number };
    searchPagePause: { min: number; max: number };
  };
};

type DomExploreMeta = {
  mode: "dom";
  mapUrl: string;
  cardsParsed: number;
  pagination: { rawTextSnippet: string; hasNext?: boolean; totalResultsHint?: number } | null;
  domWarnings: string[];
  manualChallengeMode?: boolean;
};

type ExploreResponse =
  | {
      ok: true;
      jobId: string;
      scraperUsed?: "api" | "dom";
      job: {
        geocodedLabel: string;
        center: { lat: number; lon: number };
        priceMaxTier: number;
        resultCount: number;
        truncated: boolean;
        searchPagesFetched: number;
        detailFetches: number;
        timingProfile?: ExploreTimingProfile;
        meta?: { dom?: DomExploreMeta };
      };
      listings: RealtorExploreListingPayload[];
    }
  | {
      ok?: false;
      error?: string;
      jobId?: string;
      scraperUsed?: "api" | "dom";
      diagnostics?: DomExploreDiagnostics;
    };

export default function ExplorePage() {
  const [location, setLocation] = useState("Victoria, BC");
  const [maxPrice, setMaxPrice] = useState("1000000");
  const [radiusMiles, setRadiusMiles] = useState("10");
  const [scraper, setScraper] = useState<"api" | "dom">("api");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ExploreResponse | null>(null);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(SCRAPER_STORAGE_KEY);
      if (v === "dom" || v === "api") {
        setScraper(v);
      }
    } catch {
      /* ignore */
    }
  }, []);

  function setScraperPersist(next: "api" | "dom"): void {
    setScraper(next);
    try {
      window.localStorage.setItem(SCRAPER_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  function submit(): void {
    setLoading(true);
    setError(null);
    setData(null);
    const mp = Number(maxPrice.replace(/[^0-9.]/gu, ""));
    const rm = radiusMiles.trim() === "" ? undefined : Number(radiusMiles);
    void fetch("/api/explore/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location: location.trim(),
        maxPrice: mp,
        radiusMiles: rm,
        scraper
      })
    })
      .then(async (res) => {
        const text = await res.text();
        let json: ExploreResponse | null = null;
        try {
          json = JSON.parse(text) as ExploreResponse;
        } catch {
          setError(`Request failed (${res.status}): ${text.slice(0, 400)}`);
          return;
        }
        if (!res.ok) {
          setError(json.error ?? `Request failed (${res.status})`);
          setData(json);
          return;
        }
        setData(json);
      })
      .catch(() => setError("Network error"))
      .finally(() => setLoading(false));
  }

  const listings =
    data && "listings" in data && Array.isArray(data.listings) ? data.listings : [];

  return (
    <main>
      <h1>Realtor.ca listings explorer</h1>
      <p>
        Search for-sale listings by area and max price (MVP: ~10 mi radius). Results use the same
        fields as the Chrome extension scrape where the API provides them.
      </p>
      <p style={{ fontSize: 14, opacity: 0.88, lineHeight: 1.5 }}>
        Scraping runs in <strong>conservative mode</strong> (caps and jitter). Choose the backend below.
        Without a choice, the server falls back to <code>EXPLORE_USE_DOM_SCRAPER</code> env. Tune with{" "}
        <code>EXPLORE_*</code> variables. This does not guarantee avoiding site blocks.
      </p>
      <div className="card">
        <div className="label" id="scraper-label">
          Scraper
        </div>
        <div
          role="radiogroup"
          aria-labelledby="scraper-label"
          style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}
        >
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
            <input
              type="radio"
              name="scraper"
              checked={scraper === "api"}
              onChange={() => setScraperPersist("api")}
              disabled={loading}
            />
            <span>
              <strong>Map API</strong> (api37) — structured search + detail calls; same path as before.
            </span>
          </label>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
            <input
              type="radio"
              name="scraper"
              checked={scraper === "dom"}
              onChange={() => setScraperPersist("dom")}
              disabled={loading}
            />
            <span>
              <strong>DOM / map page</strong> — reads listing links from the rendered map (experimental; no
              api37). If the site shows a bot check, set{" "}
              <code>PLAYWRIGHT_HEADLESS=false</code> and{" "}
              <code>EXPLORE_DOM_MANUAL_CHALLENGE_MODE=true</code> on the server, restart, then complete the
              challenge in the browser window; the job polls until listings appear (up to{" "}
              <code>EXPLORE_DOM_MANUAL_CHALLENGE_MAX_MS</code>, default 15 minutes). For debugging,{" "}
              <code>EXPLORE_DOM_KEEP_BROWSER_OPEN=true</code> leaves Chromium open after the job finishes.
            </span>
          </label>
        </div>
        <div className="grid">
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="label">Location</span>
            <input
              name="location"
              className="explore-input"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="City, province or postal"
              disabled={loading}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="label">Max price (CAD)</span>
            <input
              name="maxPrice"
              className="explore-input"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              placeholder="1000000"
              disabled={loading}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="label">Radius (miles)</span>
            <input
              name="radiusMiles"
              className="explore-input"
              value={radiusMiles}
              onChange={(e) => setRadiusMiles(e.target.value)}
              placeholder="10"
              disabled={loading}
            />
          </label>
        </div>
        <p style={{ marginTop: 12, fontSize: 13, opacity: 0.8 }}>
          Requires Playwright browsers (`npx playwright install`) on the server and{" "}
          <code>supabase/explore_schema.sql</code> applied.
        </p>
        <button type="button" style={{ marginTop: 12 }} onClick={submit} disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      {error ? (
        <div className="card">
          <strong>Error:</strong> {error}
          {data && "scraperUsed" in data && data.scraperUsed ? (
            <p style={{ marginTop: 8, fontSize: 13, opacity: 0.85 }}>
              Scraper used: <code>{data.scraperUsed}</code>
            </p>
          ) : null}
          {data && "diagnostics" in data && data.diagnostics ? (
            <div style={{ marginTop: 12 }}>
              <div className="label">DOM snapshot (debug)</div>
              <p style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>
                Page title, URL, link count, and a short visible-text sample from Playwright — helps tell
                timeout vs wrong page vs empty search.
              </p>
              <pre
                style={{
                  fontSize: 11,
                  lineHeight: 1.4,
                  overflow: "auto",
                  maxHeight: 280,
                  padding: 12,
                  background: "rgba(0,0,0,0.35)",
                  borderRadius: 6
                }}
              >
                {JSON.stringify(data.diagnostics, null, 2)}
              </pre>
            </div>
          ) : null}
          {data?.jobId ? (
            <p style={{ marginTop: 8 }}>
              Job id: <code>{data.jobId}</code>
            </p>
          ) : null}
        </div>
      ) : null}

      {data && "ok" in data && data.ok && "job" in data && data.job ? (
        <div className="card">
          {data.scraperUsed ? (
            <p style={{ fontSize: 13, opacity: 0.85, marginBottom: 12 }}>
              Scraper used: <code>{data.scraperUsed}</code>
            </p>
          ) : null}
          <div className="label">Geocoded</div>
          <p>{data.job.geocodedLabel}</p>
          <div className="label">API max price tier</div>
          <p>{formatCurrency(data.job.priceMaxTier)}</p>
          <div className="label">Results</div>
          <p>
            {data.job.resultCount} listing(s)
            {data.job.truncated
              ? " (capped — raise EXPLORE_MAX_DETAIL_LISTINGS / related env on the server for more)"
              : ""}
          </p>
          <p style={{ fontSize: 13, opacity: 0.85 }}>
            Search pages: {data.job.searchPagesFetched} · Detail API calls: {data.job.detailFetches}
          </p>
          {data.job.meta?.dom ? (
            <p style={{ fontSize: 13, opacity: 0.85, marginTop: 8 }}>
              <strong>DOM mode:</strong> {data.job.meta.dom.cardsParsed} card(s) parsed · map URL length{" "}
              {data.job.meta.dom.mapUrl.length}
              {data.job.meta.dom.manualChallengeMode ? " · manual challenge wait enabled" : ""}
              {data.job.meta.dom.domWarnings.length > 0 ? (
                <>
                  {" "}
                  · warnings: {data.job.meta.dom.domWarnings.join("; ")}
                </>
              ) : null}
            </p>
          ) : null}
          {data.job.timingProfile?.caps ? (
            <p style={{ fontSize: 13, opacity: 0.82, marginTop: 8 }}>
              Conservative caps this run: up to {data.job.timingProfile.caps.maxSearchPages} search page(s),{" "}
              {data.job.timingProfile.caps.recordsPerPage} rows/page, {data.job.timingProfile.caps.maxDetailListings}{" "}
              detail fetch(es). Delay ranges (ms): map settle {data.job.timingProfile.rangesMs.mapSettle.min}–
              {data.job.timingProfile.rangesMs.mapSettle.max}, between details{" "}
              {data.job.timingProfile.rangesMs.detailDelay.min}–{data.job.timingProfile.rangesMs.detailDelay.max}.
            </p>
          ) : null}
        </div>
      ) : null}

      {listings.length > 0 ? (
        <section>
          <h2 className="underwriting-subtitle">Listings</h2>
          {listings.map((L) => (
            <div key={L.url} className="card">
              <h3 style={{ marginTop: 0 }}>{L.address ?? "Address unknown"}</h3>
              <p style={{ fontSize: 14, opacity: 0.9 }}>
                <a href={L.url} target="_blank" rel="noreferrer">
                  {L.url}
                </a>
              </p>
              <div className="grid">
                <div>
                  <div className="label">Price</div>
                  <div className="value">{L.price ? formatCurrency(L.price) : "—"}</div>
                </div>
                <div>
                  <div className="label">Beds / baths</div>
                  <div className="value">
                    {L.beds ?? "—"} / {L.baths ?? "—"}
                  </div>
                </div>
                <div>
                  <div className="label">Type</div>
                  <div className="value">{L.propertyType ?? "—"}</div>
                </div>
                <div>
                  <div className="label">Sq ft</div>
                  <div className="value">{L.sqft ?? "—"}</div>
                </div>
                <div>
                  <div className="label">Taxes / condo (est.)</div>
                  <div className="value">
                    {L.taxesAnnual ? `${formatCurrency(L.taxesAnnual)}/yr` : "—"} ·{" "}
                    {L.condoFeesMonthly ? `${formatCurrency(L.condoFeesMonthly)}/mo` : "—"}
                  </div>
                </div>
                <div>
                  <div className="label">Confidence</div>
                  <div className="value">{(L.scrapeConfidence * 100).toFixed(0)}%</div>
                </div>
              </div>
              {L.description ? (
                <p style={{ fontSize: 14, lineHeight: 1.45, opacity: 0.92 }}>{L.description.slice(0, 600)}</p>
              ) : null}
              {L.missingFields && L.missingFields.length > 0 ? (
                <p style={{ fontSize: 12, opacity: 0.75 }}>Missing: {L.missingFields.join(", ")}</p>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      <p style={{ marginTop: 24 }}>
        <Link href="/">← Back to listings</Link>
      </p>
    </main>
  );
}
