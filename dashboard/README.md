# PatchitUP Corporate Dashboard

A single-screen (16:9) operations board for all PatchitUP locations, laid out as a
**grid of location widgets** — one block per franchise plus a company hero block.
Auto-refreshes hourly, filters by Day / Week / Month / Quarter / Year / Custom, and
shows a 90-day trend per location.

> **Status: v2 — widget/block layout + PatchitUP branding, running on _sample_ data.**
> Everything is interactive against generated sample data so you can react to the look
> and the metric definitions. Wiring the **real** numbers needs a small backend (below).

## Layout

- **Company hero block** (top-left, brand gradient): company-wide totals with
  period-over-period deltas and a 90-day company revenue trend.
- **7 location blocks** (4-across on a 16:9 TV): each shows a logo badge, the location
  name/region, a big **Revenue** figure (full amount, e.g. `$26,278`) with delta, a
  **6-month revenue bar chart** with labeled **X/Y axes** and hover that highlights the bar
  and shows the exact value with a year-over-year comparison (current month drawn as a
  lighter in-progress bar), a 6-stat mini-grid (Sales, Closed Avg, Opp Job Avg,
  Opportunities, Converted, Close Rate — the close-rate value is color-coded green/amber/red),
  and **Booking / Conversion** mini-bars.

### Location deep-dive (click any block)

Modeled on the ServiceTitan location dashboard:

- **Revenue gauge** — Total Revenue vs Missed (unconverted pipeline), with a needle + %.
- **18-month / 18-week trend** — Month Trend / Week Trend toggle, YoY hover tooltips,
  switchable across Revenue / Sales / Opportunities / Converted / Close Rate.
- **Location metrics** — Total Sales, Closed Avg Sale, Completed Revenue, Opportunity Job
  Avg, Non-Job Revenue, Adj. Revenue.
- **Rates & health** — Call Booking Rate, Total Conversion Rate, Customer Satisfaction,
  Total Cancellations, Memberships Converted.
- **Technician scorecards** (last 90 days) — a per-tech table with **Overview / Lead
  Generation / Memberships / Productivity / Sales** tabs and a **Table / Chart** toggle,
  including conversion-rate bars, satisfaction faces, and a Totals & Averages row.

## Scaling from 7 to 1,100+ locations

A single 16:9 screen can't show a thousand blocks, so the board is built to scale:

- **Add a location** = one line in the `LOCATIONS` array in `index.html` (`name`, `code`,
  `region`, `market`, `state`, `tenant`, plus optional seed knobs). It appears automatically.
- **Search / Sort / Density** — filter by name/market/state; sort by Revenue, Close Rate,
  Sales, Opportunities or Name; switch **Comfortable** (4-up rich cards) or **Compact**
  (6-up dense cards).
- **Pagination + Auto-rotate** — the grid pages through all locations; **Auto-rotate**
  cycles pages every 15s so a wall screen walks the whole company hands-free.
- **Regions view** — roll every location up into **region cards** (aggregate KPIs +
  3-month trend + location count). Click a region to **drill into** just its locations.
  This is the pattern that keeps 1,100 locations navigable: Company → Region → Location.
- The **company hero** always reflects the current filter (all locations, a search, or a
  drilled-in region).
- A **Scale demo · 200+** dataset (the dataset dropdown, top-right) synthesizes ~210
  locations across ~10 regions so you can see all of the above working at scale. The
  **Live · 7** dataset is the real franchise set.

Performance: only the current page of cards is rendered to the DOM (≤ ~18 at a time), so
the board stays light regardless of how many locations exist.

## Branding — PatchitUP design system

The board is built on the PatchitUP design system:

- **Fira Sans**, embedded directly in `index.html` as base64 `@font-face` (6 weights, incl.
  the heavy-italic display cut) — fully self-contained, no font CDN. Display/headlines are
  heavy italic (`.piu-display`); eyebrows are 700 uppercase, wide-tracked.
- **One hero blue `#2A7DD1`** with a sky→navy range (`--blue-400 … --blue-950`) and a
  **steel-gray** secondary (`#7E8488`). All defined as tokens at the top of the `<style>`.
- Generous radii, blue-tinted (never neutral-black) shadows, rounded pill controls.

Every color is a CSS token in `:root` (with a dark-theme block just below), so retheming
is a token edit, not a hunt through the markup.

## Logos

The real PatchitUP logos are **embedded** in `index.html` as base64 `data:` URIs on the
`BRAND` object (so they render everywhere, including the hosted preview — no external files
needed at runtime):

- `BRAND.headerLogoUrl` → the landscape wordmark, shown **top-left**.
- `BRAND.logoUrl` → the circular mascot mark, shown on **every location/region card** and in
  the deep-dive header.

Source art lives in [`assets/`](assets/) (`PIU Logo Landscape.png`, `PatchitUP Circle
Logo.png`). To update a logo, drop in a new file and re-embed it (downscaled + base64) into
the matching `BRAND.*` value. If a value is ever cleared, the board falls back to a
brand-styled Fira Sans placeholder so it still renders.

## Metric definitions (sample mapping — confirm before go-live)

| KPI | Definition |
|---|---|
| Revenue (big number) | Collected cash — modeled ~86–95% of Sales until real invoices are wired |
| Sales | Booked value of **won** opportunities in the period |
| Closed Avg | Sales ÷ Converted Jobs |
| Opp Job Avg | Total pipeline value ÷ Opportunities |
| Opportunities | Opportunities **created** in the period |
| Converted | Opportunities **won** |
| Close Rate | Converted ÷ Opportunities (≥38% green · 30–38% amber · <30% red) |

## Live data — ServiceTitan backend (built)

PatchitUP franchisees run on **ServiceTitan**; the spreadsheet credentials are its
per-tenant auth trio — **Tenant ID** (`2326750229`), **Client ID** (`cid.…`), **Client
Secret** (`cs1.…`).

A deployable backend lives in [`server/`](server/). It authenticates each tenant, pulls
estimates + invoices + technicians hourly, rolls them into **daily snapshots**, and serves
them. The dashboard **auto-detects** that API (via `/api/health`, same-origin or
`window.PIU_CONFIG.apiBase`) and switches from sample to **live** data — no code change; the
footer then reads "Live ServiceTitan data." If the API isn't reachable, the page stays on
sample data (so this hosted preview keeps working). **The client secrets stay on the server
and never reach the page.**

The whole chain is verified end-to-end against a mock ServiceTitan (`cd server && npm test`).
See [`server/README.md`](server/README.md) for setup, the exact KPI mapping, and how to
switch to the ServiceTitan **Reporting API** for report-exact parity.

Daily-record shape served to the page (one row per location per day):

```json
{ "t": "2026-08-03", "opps": 7, "wins": 3, "salesUSD": 8900, "pipelineUSD": 18500, "revenueUSD": 8100 }
```

### To turn it on

1. Create a ServiceTitan Developer Portal integration app → get the **App Key**.
2. `cd server`, fill `.env` (App Key) and `tenants.json` (per-location `cid./cs1.`).
3. `npm start` — it backfills, serves the API, and refreshes hourly; open the served page.

### Still worth confirming (defaults chosen, easy to change in `server/src/provider.js`)

- **Revenue basis** — currently invoice total (collected/billed). Can switch to booked value
  of won estimates, or show both.
- **Exact opportunity/converted rules** — matched to estimates created/sold; the Reporting
  API path makes these report-exact.
- **Time zone** — days bucket by UTC; can be set per-tenant.
