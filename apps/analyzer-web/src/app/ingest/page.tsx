"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function IngestPage() {
  const router = useRouter();
  const [message, setMessage] = useState("Processing listing capture...");
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
        setMessage("Opening listing summary...");
        router.replace(`/listings/${String(data.listingId)}`);
      })
      .catch(() => setMessage("Could not ingest listing."));
  }, [router]);

  return (
    <main>
      <h1>Opening Listing Summary</h1>
      <div className="card">
        <p>{message}</p>
        <p>If this takes longer than expected, return to the listings page and try once more.</p>
      </div>
    </main>
  );
}
