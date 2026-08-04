/**
 * Unit test for buildDailyMap sales-side vs revenue-side split, on ServiceTitan's $65 sold
 * threshold. Proves: opportunity = completed & (not No-Charge, or No-Charge invoiced over $65);
 * converted = opportunity whose invoice subtotal is over $65; revenue = the job's linked invoice
 * subtotal; Closed Avg numerator = sold-estimate value on converted opps. Run: node test/revenue.mjs
 */
import assert from 'node:assert';
import { buildDailyMap } from '../src/provider.js';

// ── Case A: invoice over $65 converts; revenue = linked invoice subtotal ────────────────────
{
  const day = '2026-08-01';
  const jobs = [{ id: 1, jobStatus: 'Completed', completedOn: `${day}T15:00:00Z`, noCharge: false, invoiceId: 91 }];
  const estimates = [{ id: 1, jobId: 1, status: { name: 'Sold' }, soldOn: `${day}T14:00:00Z`, subtotal: 1800 }];
  const invoices = [{ id: 91, subtotal: 1000, total: 1080 }];
  const d = buildDailyMap({ estimates, jobs, invoices }).get(day);
  assert.ok(d, 'day bucketed');
  assert.equal(d.opps, 1, 'one opportunity');
  assert.equal(d.wins, 1, 'converted — invoice over $65');
  assert.equal(d.revenueUSD, 1000, `revenue = linked invoice subtotal (got ${d.revenueUSD})`);
  assert.equal(d.closedSalesUSD, 1800, `Closed Avg numerator = sold-estimate value (got ${d.closedSalesUSD})`);
}

// ── Case B: an opportunity invoiced at/under $65 is NOT converted ───────────────────────────
{
  const day = '2026-08-02';
  const jobs = [
    { id: 2, jobStatus: 'Completed', completedOn: `${day}T15:00:00Z`, noCharge: false, invoiceId: 200 }, // $50 — under threshold
    { id: 3, jobStatus: 'Completed', completedOn: `${day}T16:00:00Z`, noCharge: false, invoiceId: 201 }, // $65 exactly — not over
  ];
  const invoices = [{ id: 200, subtotal: 50 }, { id: 201, subtotal: 65 }];
  const d = buildDailyMap({ estimates: [], jobs, invoices }).get(day);
  assert.equal(d.opps, 2, 'both are opportunities (completed, not No-Charge)');
  assert.equal(d.wins, 0, 'neither converts — invoice not over $65');
  assert.equal(d.revenueUSD, 115, 'revenue still counts both invoices');
}

// ── Case C: No-Charge counts only when invoiced over $65 ───────────────────────────────────
{
  const day = '2026-08-03';
  const jobs = [
    { id: 4, jobStatus: 'Completed', completedOn: `${day}T15:00:00Z`, noCharge: true, invoiceId: 499 }, // $40 → not an opportunity
    { id: 5, jobStatus: 'Completed', completedOn: `${day}T16:00:00Z`, noCharge: true, invoiceId: 500 }, // $900 → opportunity + converted
  ];
  const invoices = [{ id: 499, subtotal: 40 }, { id: 500, subtotal: 900, total: 972 }];
  const d = buildDailyMap({ estimates: [], jobs, invoices }).get(day);
  assert.equal(d.opps, 1, 'only the No-Charge job invoiced over $65 is an opportunity');
  assert.equal(d.wins, 1, 'and it converts');
  assert.equal(d.revenueUSD, 900, 'revenue from the billed No-Charge job only');
}

// ── Case E: revenue uses the pre-tax subTotal, never the tax-included total ─────────────────
{
  const day = '2026-08-06';
  const jobs = [{ id: 20, jobStatus: 'Completed', completedOn: `${day}T15:00:00Z`, noCharge: false, invoiceId: 700 }];
  // Real ServiceTitan shape: `subTotal` (capital T, pre-tax) + `salesTax` + `total` (tax-included).
  const invoices = [{ id: 700, subTotal: 1000, salesTax: 77.5, total: 1077.5 }];
  const d = buildDailyMap({ estimates: [], jobs, invoices }).get(day);
  assert.equal(d.revenueUSD, 1000, `revenue = pre-tax subTotal, not the $1077.50 total (got ${d.revenueUSD})`);
}

// ── Case D: cancellations (Canceled appointments) and memberships sold, by day ─────────────
{
  const day = '2026-08-05';
  const appointments = [
    { id: 1, start: `${day}T15:00:00Z`, status: 'Canceled' },
    { id: 2, start: `${day}T16:00:00Z`, status: { name: 'Scheduled' } },
    { id: 3, start: `${day}T17:00:00Z`, status: 'Cancelled' },   // British spelling tolerated
  ];
  const memberships = [{ id: 9, soldOn: `${day}T12:00:00Z` }, { id: 10, createdOn: `${day}T13:00:00Z` }];
  const d = buildDailyMap({ estimates: [], jobs: [], invoices: [], appointments, memberships }).get(day);
  assert.equal(d.cancels, 2, `two canceled appointments (got ${d.cancels})`);
  assert.equal(d.memberships, 2, `two memberships sold (got ${d.memberships})`);
}

console.log('✓ revenue OK — $65 threshold (opp/convert), linked-invoice revenue, cancels+memberships');
process.exit(0);
