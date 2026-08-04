/**
 * Unit test for buildDailyMap revenue linkage.
 * Proves Completed Revenue = subtotal of the job's own linked invoice (job.invoiceId) — the basis
 * verified correct against four locations. A secondary invoice that merely names the job (shares a
 * jobId) is NOT folded in, matching ServiceTitan's Completed Revenue. Run: node test/revenue.mjs
 */
import assert from 'node:assert';
import { buildDailyMap } from '../src/provider.js';

// ── Case A: only the job's linked invoice counts; a second invoice sharing the jobId does not ─
{
  const day = '2026-08-01';
  const jobs = [{ id: 1, jobStatus: 'Completed', completedOn: `${day}T15:00:00Z`, noCharge: false, invoiceId: 91 }];
  const invoices = [
    { id: 91, jobId: 1, subtotal: 1000, total: 1080 },   // the job's invoice (linked via job.invoiceId)
    { id: 92, jobId: 1, subtotal: 1800, total: 1944 },   // a secondary invoice ST doesn't fold in
  ];
  const map = buildDailyMap({ estimates: [], jobs, invoices });
  const d = map.get(day);
  assert.ok(d, 'day bucketed');
  assert.equal(d.opps, 1, 'one opportunity');
  assert.equal(d.wins, 1, 'converted (invoice > 0)');
  assert.equal(d.revenueUSD, 1000, `revenue = the linked invoice only (got ${d.revenueUSD})`);
}

// ── Case B: an invoiced job counts, an uninvoiced completed job does not convert ───────────
{
  const day = '2026-08-02';
  const jobs = [
    { id: 2, jobStatus: 'Completed', completedOn: `${day}T15:00:00Z`, noCharge: false, invoiceId: 200 },
    { id: 3, jobStatus: 'Completed', completedOn: `${day}T16:00:00Z`, noCharge: false, invoiceId: null }, // uninvoiced
  ];
  const invoices = [{ id: 200, subtotal: 1500, total: 1620 }];
  const map = buildDailyMap({ estimates: [], jobs, invoices });
  const d = map.get(day);
  assert.equal(d.opps, 2, 'two opportunities');
  assert.equal(d.wins, 1, 'only the invoiced job converts');
  assert.equal(d.revenueUSD, 1500, `revenue via job.invoiceId (got ${d.revenueUSD})`);
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

console.log('✓ revenue OK — linked-invoice only, uninvoiced non-conversion, No-Charge rule');
process.exit(0);
