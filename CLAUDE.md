# PatchitUP ServiceTitan Dashboards — project brief

Corporate + franchise dashboards that pull PatchitUP's ServiceTitan data and render KPI + technician
views. This file is the context pack: read it before touching metrics. The metric rules below were
verified against ServiceTitan's own dashboard, location by location — treat them as ground truth.

## Architecture

- **`dashboard/index.html`** — the entire front‑end: a single self‑contained HTML file (inline CSS +
  JS, no build step, no external requests). This is the design system — match its look and idioms.
  It runs in two modes: **live** (reads the API below) and **sample** (built‑in `MockSource` demo
  data for branding/preview). `Adapter` decides mode from `/api/health`.
- **Two backends share one KPI engine** (`dashboard/server/src/provider.js`):
  - **Netlify Functions** (`netlify/functions/`, prod) — v2 functions + Netlify Blobs storage. A
    scheduled `sync-hourly` (`@hourly`) triggers the background `sync` (`/api/sync`); data is served
    from `/api/locations`, `/api/locations/:t/daily`, `/technicians`, `/tech-daily`, `/api/health`.
    `/api/debug/:tenant` is a diagnostic dump (gate or remove for prod).
  - **Node/Express** (`dashboard/server/src/`) — the same provider for local dev + tests.
- **Shared core**: `provider.js` (KPI + technician math), `servicetitan.js` (OAuth client). Netlify
  imports these via relative path, so a fix lands in both backends at once.
- **Deploy**: pushing the branch auto‑deploys on Netlify (project `patchitup-zee-dashboard`,
  site id `576bcbee-b049-4ba0-8949-8de845b84a2d`). Verify a deploy via the Netlify MCP
  (`get-projects` → `currentDeploy`) before telling the user to sync. New backend fields need a
  **Sync data** click (or the hourly run) to backfill; front‑end‑only changes just need a reload.

## ServiceTitan API

- OAuth 2.0 **client‑credentials**. Tokens ~15 min, cached per clientId. Every request needs
  `Authorization: Bearer` + `ST-App-Key`. Base `https://api.servicetitan.io`.
- Endpoints used: estimates `/sales/v2`, jobs `/jpm/v2`, invoices `/accounting/v2`, appointments
  `/jpm/v2/.../appointments`, appointment‑assignments `/dispatch/v2`, memberships `/memberships/v2`,
  technicians `/settings/v2`. All list endpoints paginate — always fetch **all** pages (`getAll`).
- **Config + secrets live only in env vars** — never commit them. Netlify: `TENANTS_JSON` (array of
  `{name,code,region,market,state,tenantId,clientId,clientSecret}`), `ST_APP_KEY`, `ST_ENV`,
  `REFRESH_DAYS` (120), `BACKFILL_DAYS` (400). `.gitignore` excludes `.env`, `tenants.json`, `data/`.

## Metric definitions (VERIFIED — do not "improve" without data)

Bucket each metric on the ServiceTitan date noted. `SOLD_THRESHOLD = 65`.

- **Revenue (Completed Revenue)** = Σ invoice **`subTotal`** on completed opportunity jobs, on the
  **completion day**. ⚠️ The invoice income field is **`subTotal`** (capital T, pre‑tax). Reading
  `total` counts sales tax and overstates taxed locations — this was the single biggest bug.
- **Sales (Total Sales)** = Σ `subtotal` of estimates **sold** that day, on the **sold day**.
  (Estimates use lowercase `subtotal`; invoices use `subTotal`. Yes, really.)
- **Opportunity** = a completed job that isn't No‑Charge — or is No‑Charge but invoiced **over $65**.
- **Converted** = an opportunity whose invoice `subTotal` is **over $65** (meets the sold threshold).
- **Opportunity Conversion Rate (a.k.a. Close Rate)** = converted / opportunities.
- **Opp Job Avg** = Revenue / Opportunities.
- **Cancellations** = appointments with status Canceled, on the appointment day.
- **Memberships Sold** = memberships with a sold/created date in range.

### Technician metrics (per‑day breakdown in `buildTechDaily`, row = `[opps, converted, options, sales, pipeline, hours, jobs, completedRevenue]`)
- Attribution: the tech who **ran** a job = its appointment‑assignment (`jobTech` map), not the
  estimate's `soldBy`. This lets an *unsold* opportunity still be attributed to a technician.
- **Sales** (`revenue` field = sold estimate value) books on the **sold day**.
- **Opportunities + conversions** book on the estimate **create day**, so a range's close rate is a
  coherent cohort ≤ 100%.
- **Labor hours** = Σ appointment (`end` − `start`) durations for the tech's assignments. **Sales/hr
  = sales ÷ hours**. Shared jobs credit each assigned tech the full duration (no split).
- **Completed (invoice) revenue per tech** = `subTotal` on completed jobs the tech ran (distinct
  from their Sales) — used by the leaderboard "Top Revenue".
- All technician views are driven by the top toolbar's date‑range selector.

## Gotchas / lessons

- **Never let a periodic refresh fall back to sample data.** Only the initial load may set
  `mode='sample'`; a refresh keeps live mode and the last good data on any fetch blip (otherwise the
  15‑min tick flashes fabricated demo numbers).
- **UTC day bucketing.** Days are sliced from UTC ISO strings, so late‑evening‑local jobs can land a
  day off — matters mainly at month/quarter/year boundaries. Not yet localized per tenant.
- **Recalls/warranty** (`recallForId`/`warrantyId`) are currently counted as opportunities;
  ServiceTitan may exclude them — confirm before filtering.
- **"Total Revenue"** in ServiceTitan = completed + non‑job + adjustment revenue. We compute only
  completed‑job revenue; non‑job/adjustment isn't wired (was the likely Nassau shortfall).
- Not sourced live yet (render **N/A**, don't fake): CSAT, booking rate, per‑tech memberships.

## Dev workflow

- Tests: `cd dashboard/server && npm test` (mock ServiceTitan server + unit/pipeline tests). Add a
  test when you change metric math. Validate `index.html` by parsing its inline `<script>`.
- The mock (`dashboard/server/test/mock-st.js`) uses lowercase `subtotal`; the `subTotal ?? subtotal`
  fallback keeps both tests and live correct.
- Commit style: clear message, end with the Co‑Authored‑By + Claude‑Session trailers.
