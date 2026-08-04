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
      soldOn: e.soldOn, soldDate: e.soldDate, soldBy: e.soldBy, soldById: e.soldById,
      subtotal: e.subtotal, total: e.total, createdOn: e.createdOn, modifiedOn: e.modifiedOn,
      fields: Object.keys(e),
    }));

    // TECH ATTRIBUTION: an estimate's only person field is `soldBy`. Is it set on OPEN
    // estimates (usable as the opportunity owner) or only once sold? If open estimates have
    // no tech, per-tech opps collapse to per-tech conversions (the "opps == converted" bug).
    const hasTech = (e) => e.soldBy != null && e.soldBy !== 0;
    const openRows = rows.filter((e) => statusName(e) !== 'Sold');
    const soldRows = rows.filter((e) => statusName(e) === 'Sold');
    const techAttribution = {
      soldBySample: (rows.find((e) => e.soldBy != null) || {}).soldBy ?? null,
      soldByType: typeof (rows.find((e) => e.soldBy != null) || {}).soldBy,
      openTotal: openRows.length, openWithSoldBy: openRows.filter(hasTech).length,
      soldTotal: soldRows.length, soldWithSoldBy: soldRows.filter(hasTech).length,
      distinctSoldBy: [...new Set(rows.filter(hasTech).map((e) => JSON.stringify(e.soldBy)))].slice(0, 15),
    };

    // JOBS: ServiceTitan attributes an opportunity to the tech on the JOB, not the estimate.
    // Pull a few jobs to see which field carries that technician so we can wire correct
    // per-tech opportunity counts.
    let jobsSample = null;
    try {
      const jj = await client.get(tenant, `/jpm/v2/tenant/${tenant.tenantId}/jobs`,
        { createdOnOrAfter: from.toISOString(), createdBefore: to.toISOString(), page: 1, pageSize: 3 });
      const jrows = jj.data || [];
      jobsSample = jrows.map((j) => ({
        id: j.id, jobStatus: j.jobStatus, businessUnitId: j.businessUnitId,
        soldById: j.soldById, technicianId: j.technicianId, createdById: j.createdById,
        leadCallId: j.leadCallId, campaignId: j.campaignId,
        fields: Object.keys(j),
      }));
    } catch (e) { jobsSample = { error: String(e.message || e) }; }

    // APPOINTMENT ASSIGNMENTS: the technician who actually ran the job's appointment — the
    // signal ServiceTitan uses to attribute an opportunity to a tech. Confirm the endpoint,
    // its scope, and whether a row carries {jobId, technicianId, technicianName}.
    const probe = async (label, path, query) => {
      try {
        const j = await client.get(tenant, path, { ...query, page: 1, pageSize: 5 });
        const d = j.data || [];
        return { ok: true, count: d.length, fields: d[0] ? Object.keys(d[0]) : [], sample: d.slice(0, 3) };
      } catch (e) { return { ok: false, error: String(e.message || e) }; }
    };
    const iso2 = (n) => new Date(to.getTime() - n * 86400000).toISOString();
    const assignments = await probe('assignments', `/dispatch/v2/tenant/${tenant.tenantId}/appointment-assignments`, { modifiedOnOrAfter: iso2(30) });
    const appointments = await probe('appointments', `/jpm/v2/tenant/${tenant.tenantId}/appointments`, { createdOnOrAfter: iso2(30) });

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
      // Stored TECHNICIAN scorecard (last 90 days) — the thing that showed opps == converted.
      // After the assignment-attribution fix, named techs should carry more opps than conversions.
      const techs = Array.isArray(snap.technicians) ? snap.technicians : [];
      const named = techs.filter((x) => x.name && x.name !== 'Unassigned');
      const techSummary = {
        count: techs.length,
        allNamedOppsEqualConverted: named.length > 0 && named.every((x) => x.opps === x.converted),
        top: techs.slice(0, 6).map((x) => ({ name: x.name, opps: x.opps, converted: x.converted, closePct: +((x.oppConv || 0) * 100).toFixed(1) })),
      };
      stored = {
        updatedAt: snap.updatedAt, storedDays: keys.length,
        firstDay: keys[0] || null, lastDay: keys[keys.length - 1] || null,
        last90: sumWin(iso(90)), last30: sumWin(iso(30)),
        oppsEqualsWinsLast90: (() => { const s = sumWin(iso(90)); return s.opps === s.wins; })(),
        technicians: techSummary,
      };
    } catch (e) { stored = { error: String(e.message || e) }; }

    return Response.json({
      tenant: t.name, windowDays: days, rowsSampled: rows.length,
      statusCounts, soldByStatus, withRealSoldOn, withRealSoldDate,
      realSoldOnButNotStatusSold, soldByCurrentLogic,
      closeRate, stored, techAttribution, jobsSample, assignments, appointments, sample,
    });
  } catch (e) {
    return Response.json({ tenant: t.name, error: String(e.message || e) });
  }
};

export const config = { path: '/api/debug/:tenant' };
