"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export default function IngestPage() {
  const [message, setMessage] = useState("Waiting for listing payload...");
  const [targetListingId, setTargetListingId] = useState<string | null>(null);
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
        setMessage(`Saved listing and auto-ran ROI. Score: ${String(data.score).toUpperCase()}`);
      })
      .catch(() => setMessage("Could not ingest listing."));
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
