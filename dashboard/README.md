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
  name/region, a close-rate health pill, a big **Revenue** figure with delta, a 6-stat
  mini-grid (Sales, Closed Avg, Opp Job Avg, Opportunities, Converted, Close Rate), and
  a 90-day revenue sparkline. A left edge-stripe is colored by close-rate health.
- **Click any block** → detail drawer with a larger 90-day trend you can switch between
  Revenue / Sales / Opportunities / Converted / Close Rate.

## Branding

All brand colors live in **six `--brand-*` tokens** at the very top of the `<style>` in
`index.html` (currently placeholder PatchitUP **navy + orange**). Replace those six hex
values with the exact brand colors and the entire board reskins — no other edits:

```css
--brand-primary:      #14608f;  /* PatchitUP blue  */
--brand-primary-deep: #0b2c49;  /* deep navy       */
--brand-accent:       #f47b20;  /* action orange   */
--brand-accent-deep:  #d8611a;
--brand-accent-wash:  #fdefe2;
--brand-on-primary:   #ffffff;
```

(The dark-theme block just below holds the dark equivalents.)

## Per-location logos

Each location in the `LOCATIONS` array has `code` (2-letter monogram) and `logoUrl`.
- `logoUrl: null` → renders a branded **monogram badge** (e.g. `NC`, `ND`) in brand navy.
- Set `logoUrl` to an image URL (or a `data:` URI) → that location's badge shows the real
  logo instead. The header PatchitUP mark swaps the same way.

Two logo strategies, both supported — tell me which you want:
1. **One PatchitUP logo everywhere** + location name/monogram to distinguish blocks (default).
2. **A distinct logo per franchise** — provide the 7 image files/URLs and I'll wire them in.

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
