# PatchitUP Dashboard — ServiceTitan backend

Pulls each franchise's ServiceTitan data on an **hourly** schedule, rolls it into
**daily snapshots**, and serves them to the dashboard. The dashboard auto-detects this
API and switches from sample data to **live** data. ServiceTitan **client secrets live
here, never in the browser page.**

```
 ServiceTitan API (per tenant)        this server (holds cid./cs1.)         dashboard/index.html
 ─────────────────────────────       ───────────────────────────────       ────────────────────
  estimates ─┐                         hourly cron:                          GET /api/locations
  invoices  ─┼─ OAuth (cid/cs1) ─────▶  • auth each tenant             ─────▶ GET /api/locations/:id/daily
  technicians┘   + ST-App-Key           • pull + aggregate → daily            GET /api/locations/:id/technicians
                                         • store JSON snapshots                (page auto-detects & goes live)
```

Verified end-to-end against a mock ServiceTitan (`npm test`): OAuth → paginated fetch →
KPI aggregation → snapshot store → HTTP API shape.

## What you need to provide

1. **A ServiceTitan Developer Portal integration app** → gives you an **App Key**
   (`ST-App-Key`). This is one app-level key used for every tenant. Put it in `ST_APP_KEY`.
2. **Per-tenant credentials** (already in your spreadsheet): **Tenant ID**, **Client ID**
   (`cid.…`), **Client Secret** (`cs1.…`) — one row per location in `tenants.json`.
3. **API scopes** on the app, matching the data we read:
   - **Sales / Estimates** (opportunities, converted, sales $, pipeline)
   - **Accounting / Invoices** (revenue)
   - **Settings / Technicians** (names for the scorecards — optional)

## Setup

```bash
cd dashboard/server
npm install
cp .env.example .env                 # set ST_APP_KEY, ST_ENV, PORT…
cp tenants.example.json tenants.json # fill in all 7 locations' tenantId + cid/cs1
npm test                             # optional: runs the mock-ST pipeline test
npm run sync                         # one-shot pull (backfills ~400 days)
npm start                            # serves the API + hourly cron
```

`.env`, `tenants.json`, and `data/` are git-ignored — secrets never get committed.

## Connecting the dashboard

- **Simplest:** the server also serves `../index.html` at `/`, so open
  `http://<host>:<port>/` — the page is same-origin with the API and **auto-detects** it
  (footer shows "Live ServiceTitan data").
- **Hosting the page elsewhere:** set the API base on the page before it loads:
  ```html
  <script>window.PIU_CONFIG = { apiBase: 'https://your-api-host' };</script>
  ```
  and set `CORS_ORIGIN` in `.env` to that page's origin. If `/api/health` isn't reachable,
  the page silently falls back to sample data.

## Endpoints

| Method & path | Returns |
|---|---|
| `GET /api/health` | env, whether the App Key is set, tenants + last-sync times |
| `GET /api/locations` | public location metadata (no secrets) |
| `GET /api/locations/:tenantId/daily` | `[{ t, opps, wins, salesUSD, pipelineUSD, revenueUSD }]` |
| `GET /api/locations/:tenantId/technicians` | technician scorecards (last 90 days) |
| `POST /api/sync` | trigger a sync now (secure this in production) |

## KPI definitions (and how to change them)

All mapping is in **`src/provider.js`**, documented at the top:

| KPI | From |
|---|---|
| Opportunities | unique jobs with an estimate **created** that day |
| Converted Jobs | unique jobs with an estimate **sold** that day |
| Sales | Σ subtotal of **sold** estimates |
| Pipeline → Opp Job Avg | Σ subtotal of **created** estimates ÷ opportunities |
| Revenue | Σ **invoice** total by invoice date |
| Close Rate | converted ÷ opportunities |

**Exact ServiceTitan parity:** ServiceTitan's own "Technician Performance" report defines
"opportunity/converted" with its business rules. To match it exactly, swap `provider.js`
for a **Reporting-API** provider (`POST /reporting/v2/tenant/{tenant}/report-category/{cat}/reports/{reportId}/data`)
and map the report columns. The interface (`fetchWindow`/`buildDailyMap`/`buildTechnicians`)
stays the same. Tell me your report identifiers and I'll wire it.

## Things to verify against your tenant

- **Filter/field names** in `provider.js` (`createdOnOrAfter`, `createdBefore`,
  `invoicedOnOrAfter`, `invoicedBefore`, `subtotal`, `total`, `soldOn`, `status.name`) match
  the common v2 schema; confirm against your API reference and adjust if your tenant differs.
- **Time zone:** days are bucketed by **UTC** calendar date. If you need local-time days,
  set a per-tenant offset (easy to add in `buildDailyMap`).
- **Technician attribution** (by `soldBy`) and **CSAT** (not yet sourced → shows N/A) are the
  two spots the Reporting-API path would make exact.

## Deployment & scale

- Runs on any Node 18+ host (Render, Railway, Fly.io, an EC2 box, etc.). Keep the process
  up so the hourly cron runs; or set `CRON_ENABLED=false` and call `npm run sync` from an
  external scheduler.
- Storage is one JSON file per tenant (`src/store.js`) — fine for the current franchise
  count. For 1,000+ tenants, swap `store.js` for Postgres/Supabase (same 4-method
  interface); nothing else changes.
- Secure `POST /api/sync` (auth header / network policy) before exposing publicly.
