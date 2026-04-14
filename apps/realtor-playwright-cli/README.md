# Realtor.ca map scraper (Playwright CLI)

Standalone proof-of-concept: open a **map** URL you copied from the browser (with listings already in view), collect `/real-estate/` listing links, visit each **listing detail** page, and run the same DOM + JSON-LD scrape as the Chrome extension (`buildScrapeSource` + `parseListingPayload` from `apps/chrome-extension/src/content/scraper.ts`). Results are stored in Supabase tables `realtor_explore_jobs` and `realtor_explore_results` (see `apps/analyzer-web/supabase/explore_schema.sql`).

## Setup

1. From the repo root: `npm install`
2. Install Chromium for Playwright (run this exactly—do not append `#` comments on the same line, or your shell may pass extra tokens to the installer):

```bash
npx playwright install chromium
```

3. Env vars (same as analyzer-web): copy or symlink `apps/analyzer-web/.env.local` with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, or create `apps/realtor-playwright-cli/.env` (overrides).
4. **Supabase tables** (only when you will save results): run [`apps/analyzer-web/supabase/explore_schema.sql`](../analyzer-web/supabase/explore_schema.sql) in the Supabase SQL editor so `realtor_explore_jobs` and `realtor_explore_results` exist.

---

## Step-by-step: what to do next

Follow these in order the first time.

### Part A — One-time prerequisites

**Step A1.** Open a terminal and `cd` to the **repository root** (the folder that contains `package.json` and `apps/`).

**Step A2.** Install JavaScript dependencies:

```bash
npm install
```

**Step A3.** Install Playwright’s Chromium browser (once per machine). Run this line exactly, with nothing after `chromium`:

```bash
npx playwright install chromium
```

**Step A4.** For saving to Supabase later: confirm `apps/analyzer-web/.env.local` includes `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Skip this if you only use `--dry-run`.

**Step A5.** For saving to Supabase later: apply `explore_schema.sql` in the Supabase dashboard (Setup step 4).

---

### Part B — Build the map search in a normal browser

**Step B1.** In **Chrome or Safari** (not the Playwright window), open [realtor.ca/map](https://www.realtor.ca/map).

**Step B2.** Use the site’s controls to set **location**, **zoom**, **for sale / for rent**, **price range**, **property type**, etc., until you see **pins on the map or a list of homes** that matches what you want to scrape.

**Step B3.** Click once in the **address bar**, select all, and **copy** the URL. It must look like `https://www.realtor.ca/map#ZoomLevel=…&…&GeoName=…&…` with many `&` segments.

**Step B4.** Paste that URL somewhere (Notes, VS Code) and check that you still see **`GeoName=`** in the string. If you only see `…map#ZoomLevel=13` and nothing after the first `&`, you did not copy the full URL — go back to **B3**.

---

### Part C — Save the URL for the CLI (file method — recommended)

`npm` and the shell often **cut off** the URL at the first `&` when you paste it on the command line. Putting the URL in a **file** avoids that.

**Step C1.** In the repo root, create a file named `map-url.txt` (any name is fine).

**Step C2.** Paste the **entire** URL into that file as **one line** (no line break in the middle). Save.

**Step C3.** You will pass this path to `--url-file` in the commands below.

---

### Part D — First run: test without Supabase

**Step D1.** In the terminal, `cd` to the **repo root** or to **`apps/analyzer-web`**.

**Step D2.** Run:

```bash
npm run scrape:realtor-map -- --url-file map-url.txt --dry-run
```

If `map-url.txt` lives elsewhere, use its full or relative path.

**Step D3.** A **Chromium** window opens. You can watch it: cookies dismissed when possible, **GeoName** typed into search, search submitted, then **List** view. Do **not** click around unless a bot check appears (see Part F).

**Step D4.** Read the terminal output:

- `Map search: submitted for "Your City, BC"` (or similar) means the location step ran.
- `Collected N listing URL(s)` with **N > 0** means the scraper found links and will open listing pages.
- At the end, **JSON** prints to stdout (that is the dry-run result).

**Step D5.** If you see a **timeout** or **`listingLinkCount`: 0**, go to **Part F** before retrying the same command.

---

### Part E — Save to Supabase (after a successful dry run)

**Step E1.** Run the **same** command **without** `--dry-run`:

```bash
npm run scrape:realtor-map -- --url-file map-url.txt
```

**Step E2.** In Supabase, open **`realtor_explore_jobs`** (new job row) and **`realtor_explore_results`** (one row per listing).

**Step E3.** Optional: also save JSON to disk:

```bash
npm run scrape:realtor-map -- --url-file map-url.txt --out results.json
```

---

### Map URL: for sale vs for rent

Realtor’s map hash uses **`TransactionTypeId`**: **`2` = for sale**, **`3` = for rent** (same convention as their MLS `Listing.svc` payloads). The repo’s `map-url.txt` uses **`TransactionTypeId=2`** for **sale only**. Use **`PropertySearchTypeId=1`** for **residential** ( **`0`** = no preference).

The CLI also ensures **`view=list`** in the hash (and clicks **List** when it can). **Map-only** mode often shows an empty gray sidebar until the list panel is active — if you paste a URL manually, include **`view=list`** or click **List** next to **Map**.

---

### Part F — If it fails (timeouts, blank map)

If the page shows **“Results: 0 Listings”** (or **“Results: 0 Listing”**) but the map chrome loaded, that usually means **MLS APIs did not return data** in this browser session (often **403** on `api2.realtor.ca` in DevTools → Network), **not** that the area has no homes. The CLI will print an **api2.realtor.ca** summary on failure. Fix by using **`REALTOR_PW_CHANNEL=chrome`** or **`REALTOR_PW_CDP_ENDPOINT`** with your normal Chrome (see the Console section below).

Try in order:

1. **Open `map-url.txt`** — Confirm the line still includes **`GeoName=`** and lots of **`&`**.
2. **Longer waits:**

   ```bash
   npm run scrape:realtor-map -- --url-file map-url.txt --post-goto-wait-ms 8000 --map-wait-ms 120000 --dry-run
   ```

3. **WAF / challenge page** — Run with `--manual-challenge`, complete the check in the browser, wait until listings show; the tool polls up to **15 minutes**.

4. **Quoted URL instead of a file** — Single quotes protect `&`:

   ```bash
   npm run scrape:realtor-map -- --url 'https://www.realtor.ca/map#ZoomLevel=…&GeoName=…' --dry-run
   ```

5. **Env var** — Set `REALTOR_MAP_URL` to the full URL and run without `--url` / `--url-file`.

6. **Still no pins or `/real-estate/` links** — Listings come from Realtor’s MLS APIs (`api2.realtor.ca`, etc.). The edge may return **403 Forbidden** to automated Chromium even when the map shell loads. DevTools often also prints **“CORS policy”** next to the same request: that is usually a **symptom** of a failed response (403 bodies often omit `Access-Control-Allow-Origin`), not something `--disable-web-security` can fix. Try **`REALTOR_PW_CHANNEL=chrome`**, or attach to your **normal Chrome** with **`REALTOR_PW_CDP_ENDPOINT`** (see the Console section below). If nothing works, use the Chrome extension / analyzer path or another network.

Do **not** add `--skip-search-typing` unless you know you need hash-only loading.

---

### What the tool does in plain language

It loads your map URL, clears cookies when it can, **types the place name from `GeoName`** into Realtor’s search (because hash-only often does not load MLS data in automated Chrome), waits for network activity, switches to **List** so real `/real-estate/` links appear, collects those URLs, opens each **listing detail** page, runs the same scrape as the Chrome extension, then writes to Supabase (unless `--dry-run`). When the script **finishes**, it **closes** the browser — that is expected.

---

## Quick reference (commands)

From the **repo root** or **`apps/analyzer-web`**:

```bash
npm run scrape:realtor-map -- --url-file map-url.txt --dry-run
```

From **`apps/realtor-playwright-cli`**:

```bash
npm start -- --url-file map-url.txt --dry-run
```

`npm start` runs `build:browser` first (esbuild bundle for the in-page scraper).

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--url` | | Full map URL (or use `--url-file` / `REALTOR_MAP_URL`) |
| `--url-file` | | Read URL from a file (one line; avoids `&` issues with npm). If the path is not found in the current directory, the CLI also looks at the **monorepo root**, so `map-url.txt` next to the root `package.json` works when npm runs the workspace from `apps/realtor-playwright-cli`. |
| `--skip-search-typing` | off | Do not type `GeoName` / submit (hash-only) |
| `--max-listings` | `24` | Max listing detail pages to fetch |
| `--scroll-rounds` | `6` | Scroll / “show more” passes on the map |
| `--map-wait-ms` | `90000` | Timeout for the first `/real-estate/` link |
| `--post-goto-wait-ms` | `3500` | Pause after load before cookie + List toggle |
| `--listing-wait-ms` | `45000` | Max wait per listing detail page for SPA content before scrape |
| `--headed` | on | Headed Chromium (recommended; many environments block headless) |
| `--headless` | | Force headless |
| `--dry-run` | | Print JSON; do not write Supabase |
| `--out file.json` | | Save full payload array to a file |
| `--manual-challenge` | | After load, poll up to 15 minutes for listing links so you can complete a WAF challenge in the window |

### WAF / blocking

Headless automation often returns an empty page or zero listing links (similar to `REALTOR_DOM_BLOCKED_OR_INCOMPLETE` in the analyzer-web DOM explore path). Prefer **headed** mode (default). If you hit Incapsula or another challenge, run with `--manual-challenge`, complete the check in the visible browser, and wait until listing links appear.

**“Additional security check” / CAPTCHA (“looks like a robot”):** That is Realtor’s edge, not a bug in your URL. **Complete the challenge in the Chrome window** (same tab the script opened). Then either let the run continue or restart with **`--manual-challenge`** so the tool polls for up to **15 minutes** while you finish any follow-up checks. There is **no reliable way to “mask” past** modern bot challenges in code alone; **`REALTOR_PW_CDP_ENDPOINT`** with real Chrome + human verification when prompted is the practical approach. Follow Realtor.ca’s terms of use.

This mirrors the intent of `EXPLORE_DOM_MANUAL_CHALLENGE_MODE` / headed Chromium described in `apps/analyzer-web/src/lib/realtor-ca/run-explore-job-dom.ts`.

### Same URL works in Chrome / Incognito but not in Playwright

If copy-pasting the map URL into **normal Chrome** or **Incognito** shows **hundreds of listings**, but the Playwright-driven window shows **“Results: 0 Listings”** or never gets `/real-estate/` links, the problem is **not** your `map-url.txt` text. Realtor’s edge often treats **automation** (Playwright’s default Chromium, `navigator.webdriver`, etc.) differently than a human-driven session and may **refuse MLS `api2` calls** (often **403** in Network).

**What to do:** use **`REALTOR_PW_CDP_ENDPOINT`** so the CLI attaches to **your** Chrome (started with `--remote-debugging-port=9222`), not a separate Playwright-launched browser. That is the most reliable way to match “it works when I paste the link.” `REALTOR_PW_CHANNEL=chrome` helps sometimes but is still a fresh automation profile; CDP reuses the real browser process.

Logging in is **not** required for public search (Incognito works in your tests); focus on **which browser process** runs the page.

### Listing detail scrape looks empty (no address, price, beds)

Listing pages are **client-rendered**. The extension usually runs after you have already stared at the page; Playwright was firing the scraper at `load`, often **before** React (or similar) filled price, `og:title`, and body copy.

The CLI now **waits for hydration** on each listing URL (`networkidle` + checks for body text, price/`$`, and title/meta) up to **`--listing-wait-ms`** (default **45000** ms). If fields are still empty, try a larger value, e.g. `--listing-wait-ms 60000`.

### “Real person / real Chrome” — what you’re actually doing

- **`REALTOR_PW_CDP_ENDPOINT`** + Chrome started with `--remote-debugging-port` **is** using your **real Google Chrome binary** and process. Playwright attaches over CDP; it does **not** launch Playwright’s bundled Chromium for that run. That is the main reason MLS and `api2` behave like a normal tab.
- Playwright still opens a **new browser context** (isolated storage) with a **fixed user agent string** — fine for scraping, not identical to your default profile’s every setting.
- Optional: **`REALTOR_PW_STEALTH=1`** runs a tiny init script that masks `navigator.webdriver`. It is a minor polish; it does not replace CDP. Respect Realtor.ca’s terms of service.

### Debugging “Results: 0 Listings” / no api2

- After map prep, the CLI prints **`MLS AsyncPropertySearch_Post (wait heuristic): confirmed | not confirmed`** — if **not confirmed**, the primary MLS search POST may never have completed (timing, block, or SPA).
- On failure, **Diagnostics** JSON includes **`mapHashParams`** (from the **live** address bar hash) so you can compare `TransactionTypeId`, `GeoName`, etc. to your `map-url.txt` after the SPA rewrites the URL.
- If there is **no api2** but other hosts respond, the log may list **other `*.realtor.ca` API hosts** (e.g. api37) with response counts.
- **`REALTOR_PW_DEBUG=1`** — logs each **api2.realtor.ca** response (`status` + path) as it arrives (verbose).
- **`request failed … net::ERR_FAILED` / `ERR_ABORTED`** on api2 during the first seconds of load is **often normal**: the map SPA cancels in-flight requests when the URL hash updates or the page navigates. What matters is whether you **later** see successful **api2** responses (HTTP **200** in the summary) and listing links. **`ERR_BLOCKED_BY_CLIENT`** usually means an **extension** blocked the request.

### Location bar and cookie banners

Chrome’s **“Know your location”** strip is a **native browser permission UI**, not a normal HTML button — Playwright cannot target it with CSS like the cookie banner. The CLI **grants geolocation permission** for `https://www.realtor.ca` **before** navigation and sets lat/lon from your URL’s **`Center=`** hash parameter so that prompt should not appear.

Cookie / OneTrust bars are in the DOM; the tool runs **multiple passes** with **Accept / Dismiss / OneTrust** selectors and **forced** clicks. If anything still blocks the viewport, run with **`--manual-challenge`** and dismiss it once yourself, then let the script continue.

### Console: `CORS` / `403` / `api2.realtor.ca` / `AsyncPropertySearch_Post`

If DevTools shows:

`Access to XMLHttpRequest at 'https://api2.realtor.ca/...' from origin 'https://www.realtor.ca' has been blocked by CORS policy`

check the **Network** tab for the same URL. If the status is **403 Forbidden** (or **401**), the **server** refused the request. Chrome then surfaces a **CORS-style** message because the error response often does **not** include `Access-Control-Allow-Origin`. That is **not** fixed by `--disable-web-security` — that flag only affects how the **browser** treats cross-origin reads, not whether `api2.realtor.ca` returns 403.

When those MLS calls fail, the map **cannot load search results** — you may see a basemap and autocomplete, but **no price pins** and **no `/real-estate/` links** for the scraper.

**What this CLI does by default:** it launches Chromium with **`--disable-web-security`** (and related flags) so cross-origin XHRs are not blocked by the browser during automation. That helps when the issue is purely browser-side; it does **not** override a **403** from Realtor. To use normal Chromium security instead:

```bash
REALTOR_PW_STRICT_CORS=1 npm run scrape:realtor-map -- --url-file map-url.txt --dry-run
```

**Try system Chrome** instead of bundled Chromium (different fingerprint; sometimes avoids 403):

```bash
REALTOR_PW_CHANNEL=chrome npm run scrape:realtor-map -- --url-file map-url.txt --dry-run
```

**Attach to your own Chrome** (same cookies and reputation as manual browsing — often the most reliable when Playwright’s Chromium gets 403):

**Recommended: dedicated profile + CDP** (keeps scraper cookies/session separate from your main Chrome; avoids “profile already in use” when your main Chrome is open):

1. **Terminal A — start Chrome** with remote debugging and a **dedicated user data directory**:

   From the **repo root**:

   ```bash
   npm run chrome:realtor-cdp
   ```

   This runs `apps/realtor-playwright-cli/scripts/start-chrome-cdp.sh`, which defaults to:

   - `--remote-debugging-port=9222` (override with `REALTOR_CDP_PORT`)
   - `--user-data-dir=$HOME/.rea-realtor-scraper-chrome` (override with `REALTOR_CHROME_USER_DATA_DIR`)

   On macOS you can still set `CHROME_PATH` if Chrome is not under `/Applications`.

2. **Terminal B — run Playwright** against that browser (no bundled Chromium):

   ```bash
   REALTOR_PW_CDP_ENDPOINT=http://127.0.0.1:9222 npm run scrape:realtor-map -- --url-file map-url.txt --dry-run
   ```

   If you changed the port: `REALTOR_PW_CDP_ENDPOINT=http://127.0.0.1:$REALTOR_CDP_PORT` with the same value as in step 1.

**Minimal variant** (no script — uses your default Chrome profile; quit other Chrome windows first):

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

When `REALTOR_PW_CDP_ENDPOINT` is set, the CLI **connects over CDP** and does **not** launch Playwright’s browser (`--headed` / `--headless` and `REALTOR_PW_CHANNEL` are ignored for that run).

The CLI also logs once if it sees **403/401** on `api2.realtor.ca` and reminds you of these options.

If pins still never appear, Realtor may be blocking at the **network/API** layer; use the Chrome extension + analyzer flow or another network as noted in troubleshooting.

## Supabase

After a successful **`--dry-run`**, save results by running the **same command without** `--dry-run` (requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `apps/analyzer-web/.env.local`):

```bash
REALTOR_PW_CDP_ENDPOINT=http://127.0.0.1:9222 npm run scrape:realtor-map -- --url-file map-url.txt
```

- **Jobs**: One row in `realtor_explore_jobs` per CLI run with `meta.source = "playwright-cli"` and `meta.inputMapUrl` set to your pasted URL.
- **`max_price`**: The table requires `max_price NOT NULL`. This CLI inserts **`999999999`** as a sentinel meaning “not used; filters are in the map URL hash,” documented in `meta.note`.
- **Results**: One row per successfully scraped listing in `realtor_explore_results` (`payload` JSON matches the extension scrape, plus optional `rawSnapshot.landSizeHint` from a best-effort line match).

Optional: add a dedicated column for the input URL instead of relying on `meta`:

```sql
alter table public.realtor_explore_jobs
  add column if not exists input_map_url text;
```

## Land / lot size

The extension payload does not define a top-level land field. The bundled scraper adds `rawSnapshot.landSizeHint` when it finds a likely “lot size” / “land” line in the page body.

## Legal

Use only in line with Realtor.ca’s terms of service; this tool is for internal prototyping.
