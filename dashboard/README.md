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
  name/region, a close-rate health pill, a big **Revenue** figure with delta, a **last-3-
  months revenue bar chart** (current month drawn as a lighter in-progress bar, with a
  year-over-year hover tooltip), and a 6-stat mini-grid (Sales, Closed Avg, Opp Job Avg,
  Opportunities, Converted, Close Rate). A left edge-stripe is colored by close-rate health.
- **Click any block** → detail drawer with an **18-month / 18-week trend** bar chart
  (Month Trend / Week Trend toggle) with year-over-year hover tooltips, switchable between
  Revenue / Sales / Opportunities / Converted / Close Rate.

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

One shared PatchitUP logo, resolved from `./assets` via the `BRAND` object in `index.html`:

- `assets/patchitup-logo.png` → **top-left** horizontal wordmark.
- `assets/patchitup-badge.png` → the small circle on **every location card**.

Both fall back to a brand-styled placeholder if the file isn't present, so the board always
renders. See [`assets/README.md`](assets/README.md) for how to drop the real files in (and
why the hosted preview needs the image embedded as a `data:` URI).

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

## Going live — data source is ServiceTitan

PatchitUP franchisees run on **ServiceTitan**, and the credentials in the source
spreadsheet are its per-tenant auth trio:

- `2326750229` → **Tenant ID**
- `cid.…` → **Client ID**
- `cs1.…` → **Client Secret**

The dashboard reads all data through **one seam**: the `Adapter` object at the bottom of
`index.html`. Today `Adapter.source = MockSource`. To go live, point it at your backend:

```js
const ApiSource = {
  async getDailySeries(loc) {
    return fetch(`/api/locations/${loc.tenant}/daily`).then(r => r.json());
  }
};
Adapter.source = ApiSource;
```

Daily-record shape the dashboard expects (one row per location per day):

```json
{ "t": "2026-08-03", "opps": 7, "wins": 3, "salesUSD": 8900, "pipelineUSD": 18500, "revenueUSD": 8100 }
```

### Why a backend (and why secrets never touch this page)

A ServiceTitan **Client Secret** must never ship in a browser page or be committed to git.
So an hourly backend job authenticates each tenant, pulls jobs/opportunities from the
ServiceTitan API, rolls them up into daily snapshots, and stores them; the dashboard reads
those snapshots. Storing daily snapshots is also what makes 90-day trends and instant
date filtering possible. **Base44** or **Supabase** (both available here) can host the DB,
the hourly job, and this page together.

## Open questions for go-live

1. **Exact brand hex + logo** — confirm the six `--brand-*` values (or send the brand
   guide / logo files). One logo for all, or one per franchise?
2. **Revenue basis** — booked value of won deals, actual collected cash from ServiceTitan
   invoices, or show both?
3. **Date basis** — count opportunities by created date, sales by won date, or split?

Answer those and the same board renders live numbers with no layout changes.
