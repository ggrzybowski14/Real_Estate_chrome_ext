import type { StoredListing } from "./types";

const STORAGE_KEY = "rea.listings.v1";

function readAll(): StoredListing[] {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw) as StoredListing[];
  } catch {
    return [];
  }
}

function writeAll(items: StoredListing[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export const listingRepository = {
  list(): StoredListing[] {
    return readAll().sort((a, b) =>
      a.listing.capturedAt < b.listing.capturedAt ? 1 : -1
    );
  },

  get(id: string): StoredListing | undefined {
    return readAll().find((item) => item.listing.id === id);
  },

  upsert(item: StoredListing): void {
    const existing = readAll();
    const idx = existing.findIndex((i) => i.listing.id === item.listing.id);
    if (idx >= 0) {
      existing[idx] = item;
    } else {
      existing.push(item);
    }
    writeAll(existing);
  }
};
