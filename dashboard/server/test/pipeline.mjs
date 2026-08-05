/**
 * End-to-end pipeline test against the mock ServiceTitan server.
 * Proves: OAuth flow → paginated fetch → KPI aggregation → snapshot store → HTTP API shape.
 * Run: npm test   (from server/)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { startMockST } from './mock-st.js';

const PORT = 8899;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piu-'));
const tenantsFile = path.join(tmp, 'tenants.json');
fs.writeFileSync(tenantsFile, JSON.stringify([
  { name: 'Test County', code: 'TC', region: 'Testville, TS', market: 'Test', state: 'TS', tenantId: '9999999999', clientId: 'cid.test', clientSecret: 'cs1.test' },
]));

// Configure env BEFORE importing the app modules (config.js reads env at import time).
process.env.ST_AUTH_URL = `http://127.0.0.1:${PORT}/connect/token`;
process.env.ST_API_BASE = `http://127.0.0.1:${PORT}`;
process.env.ST_APP_KEY = 'mock-app-key';
process.env.TENANTS_FILE = tenantsFile;
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.BACKFILL_DAYS = '120';
process.env.CRON_ENABLED = 'false';
process.env.PORT = '8790';

const srv = await startMockST(PORT);
const { syncAll } = await import('../src/sync.js');
const { seriesArray, readSnapshot } = await import('../src/store.js');

// 1) sync
const results = await syncAll();
assert.equal(results.length, 1, 'one tenant synced');
assert.ok(!results[0].error, 'no sync error: ' + results[0].error);
assert.equal(results[0].mode, 'backfill', 'first run backfills');

// 2) daily series shape + values
const series = seriesArray('9999999999');
assert.ok(series.length > 90, `has history (${series.length} days)`);
for (const d of series.slice(-5)) {
  for (const k of ['t', 'opps', 'wins', 'salesUSD', 'closedSalesUSD', 'pipelineUSD', 'revenueUSD']) assert.ok(k in d, `day has ${k}`);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(d.t), 'date is YYYY-MM-DD');
}
const tot = series.reduce((a, d) => ({ opps: a.opps + d.opps, wins: a.wins + d.wins, rev: a.rev + d.revenueUSD, sales: a.sales + d.salesUSD, closed: a.closed + d.closedSalesUSD, cancels: a.cancels + (d.cancels || 0), mem: a.mem + (d.memberships || 0) }), { opps: 0, wins: 0, rev: 0, sales: 0, closed: 0, cancels: 0, mem: 0 });
assert.ok(tot.opps > 0 && tot.wins > 0 && tot.rev > 0 && tot.sales > 0, 'non-zero totals');
assert.ok(tot.cancels > 0, `cancellations counted from appointments (${tot.cancels})`);
assert.ok(tot.mem > 0, `memberships-sold counted (${tot.mem})`);
// Closed-opportunity sales (numerator of Closed Avg) is a non-empty subset of total sales:
// sales on jobs still in progress are excluded, so it's > 0 and < total sales.
assert.ok(tot.closed > 0, `closedSalesUSD present (${Math.round(tot.closed)})`);
assert.ok(tot.closed < tot.sales, `closedSalesUSD (${Math.round(tot.closed)}) excludes sales on not-yet-completed jobs (< total ${Math.round(tot.sales)})`);

// ServiceTitan bases: opportunities + conversions + revenue come from JOBS; sales from sold
// estimates. So opps come from completed opportunity jobs and converted (sold jobs) is a strict
// subset → close rate is bounded 0..100%.
const soldDays = series.filter((d) => d.salesUSD > 0).length;
const revDays = series.filter((d) => d.revenueUSD > 0).length;
assert.ok(soldDays > 5, `sales booked across many days (${soldDays})`);
assert.ok(revDays > 5, `completed-job revenue across many days (${revDays})`);
assert.ok(tot.wins < tot.opps, `converted (${tot.wins}) is a subset of opportunities (${tot.opps})`);
const closePct = tot.wins / tot.opps;
assert.ok(closePct > 0.2 && closePct < 1, `close rate in a sane 0..100% band (${(closePct * 100).toFixed(0)}%)`);
assert.notStrictEqual(Math.round(tot.rev), Math.round(tot.sales), 'revenue (completed jobs) is a distinct stream from sales (sold estimates)');

// 3) technicians resolved to names
const techs = readSnapshot('9999999999').technicians;
assert.ok(techs.length >= 1, 'technicians present');
assert.ok(techs.some((t) => t.name === 'Joshua Rivera'), 'technician names resolved');
assert.ok(techs.every((t) => t.converted <= t.opps), 'tech converted <= opps');
// Attribution comes from appointment assignments (the tech who RAN the job), not the estimate's
// soldBy — so real techs must carry unsold opportunities too, i.e. opps strictly exceed
// conversions. (Regression guard for the "opps == converted / 100% per tech" bug.)
const named = techs.filter((t) => t.name !== 'Unassigned' && t.opps > 0);
assert.ok(named.length >= 2, 'multiple technicians attributed');
assert.ok(named.some((t) => t.opps > t.converted), 'a tech has more opportunities than conversions');
assert.ok(named.every((t) => t.opps >= t.converted), 'per-tech converted never exceeds opps');
const attributed = techs.filter((t) => t.name !== 'Unassigned').reduce((a, t) => a + t.opps, 0);
assert.ok(attributed > 0, 'opportunities attributed to real technicians, not just Unassigned');
// Per-tech labor hours + jobs (productivity/hour) come from appointment durations. Each techDaily
// row is [opps,converted,options,revenue,pipeline,hours,jobs]; hours must be populated.
const techDaily = readSnapshot('9999999999').techDaily || {};
let totHours = 0, totJobs = 0, totCompRev = 0;
for (const byTech of Object.values(techDaily)) for (const a of Object.values(byTech)) { totHours += a[5] || 0; totJobs += a[6] || 0; totCompRev += a[7] || 0; }
assert.ok(totHours > 0, `technician labor hours computed from appointments (${Math.round(totHours)}h)`);
assert.ok(totJobs > 0, `technician jobs-run computed (${totJobs})`);
assert.ok(totCompRev > 0, `per-technician completed (invoice) revenue attributed (${Math.round(totCompRev)})`);

// 4) refresh run merges (mode=refresh second time)
const r2 = await syncAll();
assert.equal(r2[0].mode, 'refresh', 'second run refreshes');

// 5) HTTP API returns the exact shape the dashboard consumes
const { app } = await import('../src/server.js');
const http = await import('node:http');
const listener = app.listen(0);
const base = `http://127.0.0.1:${listener.address().port}`;
const locs = await (await fetch(`${base}/api/locations`)).json();
assert.ok(Array.isArray(locs) && locs[0].tenant === '9999999999', '/api/locations ok');
assert.ok(!('clientSecret' in locs[0]), 'no secrets leaked in /api/locations');
const daily = await (await fetch(`${base}/api/locations/9999999999/daily`)).json();
assert.ok(Array.isArray(daily) && 'revenueUSD' in daily[0], '/api/daily ok');

listener.close(); srv.close();
console.log(`✓ pipeline OK — ${series.length} days, totals: opps=${tot.opps} wins=${tot.wins} rev=$${Math.round(tot.rev).toLocaleString()} sales=$${Math.round(tot.sales).toLocaleString()}, ${techs.length} techs`);
process.exit(0);
