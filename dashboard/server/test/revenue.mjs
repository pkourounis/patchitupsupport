/**
 * Unit test for buildDailyMap sales-side vs revenue-side split.
 * Proves: Revenue = subtotal of the job's linked invoice (job.invoiceId); an opportunity is
 * CONVERTED when its estimate SOLD (same stream as Total Sales), NOT merely when an invoice
 * exists; Closed Avg numerator (closedSalesUSD) = the sold-estimate value on converted
 * opportunities. Run: node test/revenue.mjs
 */
import assert from 'node:assert';
import { buildDailyMap } from '../src/provider.js';

// ── Case A: converted = estimate sold; revenue = linked invoice subtotal ───────────────────
{
  const day = '2026-08-01';
  // job 1 completed, has a SOLD estimate (value 1800) and a linked invoice (subtotal 1000).
  const jobs = [{ id: 1, jobStatus: 'Completed', completedOn: `${day}T15:00:00Z`, noCharge: false, invoiceId: 91 }];
  const estimates = [{ id: 1, jobId: 1, status: { name: 'Sold' }, soldOn: `${day}T14:00:00Z`, subtotal: 1800 }];
  const invoices = [{ id: 91, subtotal: 1000, total: 1080 }];
  const d = buildDailyMap({ estimates, jobs, invoices }).get(day);
  assert.ok(d, 'day bucketed');
  assert.equal(d.opps, 1, 'one opportunity');
  assert.equal(d.wins, 1, 'converted — its estimate sold');
  assert.equal(d.revenueUSD, 1000, `revenue = linked invoice subtotal (got ${d.revenueUSD})`);
  assert.equal(d.closedSalesUSD, 1800, `Closed Avg numerator = sold-estimate value (got ${d.closedSalesUSD})`);
}

// ── Case B: an invoiced opportunity with NO sold estimate is NOT converted ─────────────────
{
  const day = '2026-08-02';
  // completed, invoiced (revenue counts) but no estimate ever sold → opportunity, not converted.
  const jobs = [{ id: 2, jobStatus: 'Completed', completedOn: `${day}T15:00:00Z`, noCharge: false, invoiceId: 200 }];
  const invoices = [{ id: 200, subtotal: 1500, total: 1620 }];
  const d = buildDailyMap({ estimates: [], jobs, invoices }).get(day);
  assert.equal(d.opps, 1, 'one opportunity');
  assert.equal(d.wins, 0, 'not converted — no sold estimate');
  assert.equal(d.revenueUSD, 1500, 'revenue still counts the invoice');
  assert.equal(d.closedSalesUSD, 0, 'no closed-sale value');
}

// ── Case C: No-Charge with no invoice is not an opportunity; with an invoice it is ──────────
{
  const day = '2026-08-03';
  const jobs = [
    { id: 4, jobStatus: 'Completed', completedOn: `${day}T15:00:00Z`, noCharge: true },              // free callback
    { id: 5, jobStatus: 'Completed', completedOn: `${day}T16:00:00Z`, noCharge: true, invoiceId: 500 }, // billed anyway
  ];
  const estimates = [{ id: 5, jobId: 5, status: { name: 'Sold' }, soldOn: `${day}T14:00:00Z`, subtotal: 900 }];
  const invoices = [{ id: 500, subtotal: 900, total: 972 }];
  const d = buildDailyMap({ estimates, jobs, invoices }).get(day);
  assert.equal(d.opps, 1, 'only the invoiced No-Charge job is an opportunity');
  assert.equal(d.wins, 1, 'and it converted (its estimate sold)');
  assert.equal(d.revenueUSD, 900, 'revenue from the billed No-Charge job');
}

console.log('✓ revenue OK — converted=estimate-sold, revenue=linked-invoice, No-Charge rule');
process.exit(0);
