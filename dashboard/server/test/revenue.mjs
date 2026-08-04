/**
 * Unit test for buildDailyMap revenue linkage.
 * Proves Completed Revenue sums EVERY invoice that names a job (invoice.jobId), not just the
 * single job.invoiceId — so a job with a deposit + final invoice reports both. Also proves the
 * fallback to job.invoiceId when invoices carry no job reference (the mock/legacy shape).
 * Run: node test/revenue.mjs
 */
import assert from 'node:assert';
import { buildDailyMap } from '../src/provider.js';

// ── Case A: multi-invoice job, invoices carry jobId (real ServiceTitan shape) ──────────────
{
  const day = '2026-08-01';
  const jobs = [{ id: 1, jobStatus: 'Completed', completedOn: `${day}T15:00:00Z`, noCharge: false }];
  const invoices = [
    { id: 91, jobId: 1, subtotal: 1000, total: 1080 },   // deposit
    { id: 92, jobId: 1, subtotal: 1800, total: 1944 },   // final
  ];
  const map = buildDailyMap({ estimates: [], jobs, invoices });
  const d = map.get(day);
  assert.ok(d, 'day bucketed');
  assert.equal(d.opps, 1, 'one opportunity');
  assert.equal(d.wins, 1, 'converted (invoice > 0)');
  assert.equal(d.revenueUSD, 2800, `revenue sums BOTH invoices via jobId (got ${d.revenueUSD})`);
}

// ── Case B: invoices carry NO jobId → fall back to job.invoiceId (mock/legacy shape) ───────
{
  const day = '2026-08-02';
  const jobs = [
    { id: 2, jobStatus: 'Completed', completedOn: `${day}T15:00:00Z`, noCharge: false, invoiceId: 200 },
    { id: 3, jobStatus: 'Completed', completedOn: `${day}T16:00:00Z`, noCharge: false, invoiceId: null }, // uninvoiced
  ];
  const invoices = [{ id: 200, subtotal: 1500, total: 1620 }];   // no jobId field
  const map = buildDailyMap({ estimates: [], jobs, invoices });
  const d = map.get(day);
  assert.equal(d.opps, 2, 'two opportunities');
  assert.equal(d.wins, 1, 'only the invoiced job converts');
  assert.equal(d.revenueUSD, 1500, `fallback via job.invoiceId (got ${d.revenueUSD})`);
}

// ── Case C: No-Charge with no invoice is not an opportunity; with an invoice it is ──────────
{
  const day = '2026-08-03';
  const jobs = [
    { id: 4, jobStatus: 'Completed', completedOn: `${day}T15:00:00Z`, noCharge: true },              // free callback
    { id: 5, jobStatus: 'Completed', completedOn: `${day}T16:00:00Z`, noCharge: true, invoiceId: 500 }, // billed anyway
  ];
  const invoices = [{ id: 500, subtotal: 900, total: 972 }];
  const map = buildDailyMap({ estimates: [], jobs, invoices });
  const d = map.get(day);
  assert.equal(d.opps, 1, 'only the invoiced No-Charge job is an opportunity');
  assert.equal(d.revenueUSD, 900, 'revenue from the billed No-Charge job');
}

console.log('✓ revenue OK — multi-invoice jobId sum, job.invoiceId fallback, No-Charge rule');
process.exit(0);
