# PatchitUP Corporate Dashboard

A single-screen (16:9) operations board for all PatchitUP locations. Auto-refreshes
hourly, filters by Day / Week / Month / Quarter / Year / Custom range, and shows a
90-day trend per location.

> **Status: v1 — layout + interaction, running on realistic _sample_ data.**
> This is the "start with that and I'll tweak" build. Everything you see (KPIs,
> filters, deltas, 90-day sparklines, per-location detail charts) is fully working
> against generated sample data so you can react to the layout and the metric
> definitions. Wiring the **real** numbers needs one decision from you (the data
> source) plus a small backend — see [Going live](#going-live).

## What's on screen

**Per location (7 locations):**

| KPI | Sample definition (confirm before go-live) |
|---|---|
| Sales | Booked value of **won** opportunities in the period |
| Revenue | Collected cash — modeled at ~86–95% of Sales until real invoices are wired |
| Closed Avg Sale | Sales ÷ Converted Jobs |
| Opp Job Avg | Total pipeline value ÷ Opportunities |
| Opportunities | Opportunities **created** in the period |
| Converted Jobs | Opportunities marked **won** |
| Close Rate | Converted Jobs ÷ Opportunities (color-coded: ≥38% green, 30–38% amber, <30% red) |

Plus a **company summary strip** (totals across all 7 locations with period-over-period
deltas), an **All Locations** footer row, and a **90-day revenue sparkline** on every
row. Click any location to open a detail drawer with a larger 90-day trend you can
switch between Revenue / Sales / Opportunities / Converted / Close Rate.

## Open it

Open `index.html` in any browser and put it full-screen (F11) on the wall display.
It's a single self-contained file — no build step, no external requests.

## Going live

The dashboard reads all data through **one seam**: the `Adapter` object at the bottom
of the `<script>` in `index.html`. Today `Adapter.source = MockSource`. To go live,
point it at a client that fetches from a backend:

```js
const ApiSource = {
  async getDailySeries(loc) {
    return fetch(`/api/locations/${loc.id}/daily`).then(r => r.json());
  }
};
Adapter.source = ApiSource;
```

The daily-record shape the dashboard expects (one row per location per day):

```json
{ "t": "2026-08-03", "opps": 7, "wins": 3, "salesUSD": 8900, "pipelineUSD": 18500, "revenueUSD": 8100 }
```

### Why a backend is required (and the secrets stay off this page)

The per-location credentials in the source spreadsheet (the 10-digit ID + `cid.…` +
`cs1.…`) are an **OAuth client id / client secret** pair. A client secret must never
ship in a browser page or be committed to git — anyone viewing source could pull every
location's data. So the architecture is:

```
  CRM API (per location)              backend (holds cid./cs1. secrets)         this dashboard
  ───────────────────────            ─────────────────────────────────         ──────────────
  location 1 ─┐                       hourly job:                               fetch /api/.../daily
  location 2 ─┼──  OAuth (cid/cs1) ──▶  • auth each location                 ──▶ render KPIs + trends
     …        │                         • pull opportunities/jobs
  location 7 ─┘                         • roll up to daily snapshots
                                        • store in a small DB
```

The hourly refresh in the UI just re-reads the latest stored snapshots — it does **not**
call the CRM directly. Storing **daily snapshots** is also what makes 90-day trends and
fast date filtering (day/week/month/quarter/year) instant.

### Recommended hosting

A hosted app + database is the clean fit: a scheduled hourly function does the pull, a
table stores `location × day` snapshots, and the dashboard reads them. **Base44** or
**Supabase** (both available in this workspace) can host the DB, the hourly job, and the
page together.

## Open questions for wiring real data

1. **Data source** — which platform do the `cid.`/`cs1.` credentials authenticate to?
   (The prior Charlotte analysis used GoHighLevel, but those IDs don't match GHL's format
   — likely a per-tenant CRM such as ServiceTitan. This decides the whole fetch layer.)
2. **Revenue basis** — booked value of won deals, actual collected cash from invoices,
   or show both side by side?
3. **Date basis** — count opportunities by created date, sales by won date, or a split of
   both?

Answer those and the same dashboard renders live numbers with no layout changes.
