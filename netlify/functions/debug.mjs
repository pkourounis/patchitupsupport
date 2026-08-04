// Diagnostic: summarizes the RAW ServiceTitan estimate shape for one tenant so we can see
// exactly which "sold" signal is trustworthy and what the close rate SHOULD be.
//   GET /api/debug/<tenantId>        (no customer PII — sales-status fields only)
import { getConfig, configured } from './_shared/config.mjs';
import { readSnapshot } from './_shared/blobStore.mjs';
import { ServiceTitanClient } from '../../dashboard/server/src/servicetitan.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const statusName = (e) => (typeof e.status === 'string' ? e.status : (e.status?.name || e.status?.value || e.statusName || ''));
const validDate = (d) => { if (!d) return false; const t = Date.parse(d); return Number.isFinite(t) && new Date(t).getUTCFullYear() > 1900; };
const jobIdOf = (e) => e.jobId ?? e.job?.id ?? e.id;

export default async (req, context) => {
  const c = getConfig();
  if (!configured(c)) return Response.json({ error: 'not configured' });
  const t = c.tenants.find((x) => String(x.tenantId) === context.params.tenant) || c.tenants[0];
  if (!t) return Response.json({ error: 'no tenant' });

  const days = Number(new URL(req.url).searchParams.get('days') || 90);
  const client = new ServiceTitanClient({ env: c.env, appKey: c.appKey });
  const tenant = { tenantId: String(t.tenantId), clientId: t.clientId, clientSecret: t.clientSecret };
  const to = new Date(), from = new Date(to.getTime() - days * 86400000);

  try {
    // Pull a real sample (up to ~1500 rows) so the counts are meaningful, not just page 1.
    const rows = [];
    for (let page = 1; page <= 3; page++) {
      const json = await client.get(tenant, `/sales/v2/tenant/${tenant.tenantId}/estimates`,
        { createdOnOrAfter: from.toISOString(), createdBefore: to.toISOString(), page, pageSize: 500 });
      const data = json.data || [];
      rows.push(...data);
      if (!json.hasMore || data.length === 0) break;
    }

    // Distribution of every status value we see (this reveals the real vocabulary).
    const statusCounts = {};
    for (const e of rows) { const s = statusName(e) || '(empty)'; statusCounts[s] = (statusCounts[s] || 0) + 1; }

    const withRealSoldOn   = rows.filter((e) => validDate(e.soldOn)).length;
    const withRealSoldDate = rows.filter((e) => validDate(e.soldDate)).length;
    const soldByStatus     = rows.filter((e) => statusName(e) === 'Sold').length;
    // The smoking gun: rows a human would NOT call sold, but that have a real soldOn date.
    const realSoldOnButNotStatusSold = rows.filter((e) => statusName(e) !== 'Sold' && validDate(e.soldOn)).length;
    // How the CURRENT provider classifies "sold":
    const currentIsSold = (e) => statusName(e) === 'Sold' || validDate(e.soldOn) || validDate(e.soldDate);
    const soldByCurrentLogic = rows.filter(currentIsSold).length;

    // Close rate under each candidate definition (unique jobs).
    const uniq = (pred) => new Set(rows.filter(pred).map(jobIdOf)).size;
    const oppsJobs = uniq(() => true);
    const rate = (n) => oppsJobs ? +(n / oppsJobs * 100).toFixed(1) : 0;
    const closeRate = {
      opportunityJobs: oppsJobs,
      byStatusSold:      { convertedJobs: uniq((e) => statusName(e) === 'Sold'),      pct: rate(uniq((e) => statusName(e) === 'Sold')) },
      byRealSoldOn:      { convertedJobs: uniq((e) => validDate(e.soldOn)),           pct: rate(uniq((e) => validDate(e.soldOn))) },
      byCurrentProvider: { convertedJobs: uniq(currentIsSold),                        pct: rate(uniq(currentIsSold)) },
    };

    // A few raw rows so we can see the actual field shapes (status object, soldOn value, etc.).
    const sample = rows.slice(0, 6).map((e) => ({
      id: e.id, jobId: e.jobId, status: e.status, active: e.active,
      soldOn: e.soldOn, soldDate: e.soldDate, soldById: e.soldById,
      subtotal: e.subtotal, total: e.total, createdOn: e.createdOn, modifiedOn: e.modifiedOn,
      fields: Object.keys(e),
    }));

    // What's ACTUALLY stored in the snapshot the dashboard reads (vs. the live/fresh compute
    // above). If stored opps == wins, the dashboard is showing pre-fix data → the re-sync
    // hasn't taken effect. If stored differs from live, the snapshot is stale.
    let stored = null;
    try {
      const snap = await readSnapshot(tenant.tenantId);
      const daysObj = snap.days || {};
      const keys = Object.keys(daysObj).sort();
      const sumWin = (fromKey) => keys.filter((k) => k >= fromKey).reduce((a, k) => {
        const d = daysObj[k]; a.opps += d.opps || 0; a.wins += d.wins || 0; a.salesUSD += d.salesUSD || 0; a.revenueUSD += d.revenueUSD || 0; return a;
      }, { opps: 0, wins: 0, salesUSD: 0, revenueUSD: 0 });
      const iso = (n) => new Date(to.getTime() - n * 86400000).toISOString().slice(0, 10);
      stored = {
        updatedAt: snap.updatedAt, storedDays: keys.length,
        firstDay: keys[0] || null, lastDay: keys[keys.length - 1] || null,
        last90: sumWin(iso(90)), last30: sumWin(iso(30)),
        oppsEqualsWinsLast90: (() => { const s = sumWin(iso(90)); return s.opps === s.wins; })(),
      };
    } catch (e) { stored = { error: String(e.message || e) }; }

    return Response.json({
      tenant: t.name, windowDays: days, rowsSampled: rows.length,
      statusCounts, soldByStatus, withRealSoldOn, withRealSoldDate,
      realSoldOnButNotStatusSold, soldByCurrentLogic,
      closeRate, stored, sample,
    });
  } catch (e) {
    return Response.json({ tenant: t.name, error: String(e.message || e) });
  }
};

export const config = { path: '/api/debug/:tenant' };
