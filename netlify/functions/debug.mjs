// Diagnostic: summarizes the RAW ServiceTitan estimate shape for one tenant so we can see
// exactly which "sold" signal is trustworthy and what the close rate SHOULD be.
//   GET /api/debug/<tenantId>        (no customer PII — sales-status fields only)
import { getConfig, configured } from './_shared/config.mjs';
import { readSnapshot } from './_shared/blobStore.mjs';
import { ServiceTitanClient } from '../../dashboard/server/src/servicetitan.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const estValue = (e) => num(e.subtotal ?? e.total ?? e.amount);
const statusName = (e) => (typeof e.status === 'string' ? e.status : (e.status?.name || e.status?.value || e.statusName || ''));
const validDate = (d) => { if (!d) return false; const t = Date.parse(d); return Number.isFinite(t) && new Date(t).getUTCFullYear() > 1900; };
const jobIdOf = (e) => e.jobId ?? e.job?.id ?? e.id;

export default async (req, context) => {
  const c = getConfig();
  if (!configured(c)) return Response.json({ error: 'not configured' });
  // Match by tenantId, or by a friendly code/name (case-insensitive substring) so you can hit
  // /api/debug/charlotte instead of memorizing tenant ids.
  const key = decodeURIComponent(context.params.tenant || '').toLowerCase();
  const t = c.tenants.find((x) => String(x.tenantId) === context.params.tenant)
    || c.tenants.find((x) => (x.code || '').toLowerCase() === key || (x.name || '').toLowerCase().includes(key))
    || c.tenants[0];
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

    // MONTH-TO-DATE reconciliation vs ServiceTitan's own dashboard. Our provider buckets on the
    // estimate's CREATE day, so compute the MTD slice the same way, and pull this month's invoices
    // for revenue. Compare fresh-from-ST, what's stored, and the ServiceTitan reference.
    let monthToDate = null;
    try {
      const monthStart = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
      const mKey = monthStart.toISOString().slice(0, 10);
      const inMonth = (iso) => iso && new Date(iso) >= monthStart;
      const mRows = rows.filter((e) => inMonth(e.createdOn));
      const uniqJobs = (arr) => new Set(arr.map(jobIdOf)).size;
      const sum = (arr, f) => arr.reduce((a, e) => a + f(e), 0);
      const soldM = mRows.filter(currentIsSold);
      const mOpps = uniqJobs(mRows), mWins = uniqJobs(soldM);
      const mSales = sum(soldM, estValue), mPipe = sum(mRows, estValue);
      let mRevenue = 'err';
      try {
        const inv = await client.get(tenant, `/accounting/v2/tenant/${tenant.tenantId}/invoices`,
          { createdOnOrAfter: monthStart.toISOString(), createdBefore: to.toISOString(), page: 1, pageSize: 500 });
        mRevenue = Math.round((inv.data || []).reduce((a, i) => a + num(i.subTotal ?? i.subtotal ?? i.total ?? i.amount), 0));
      } catch (e) { mRevenue = 'err:' + String(e.message || e); }

      // Alternative bases to see which one matches ServiceTitan's dashboard:
      // (a) sales booked on the SOLD day (not the create day), (b) revenue from COMPLETED jobs.
      const soldInMonth = rows.filter((e) => validDate(e.soldOn) && new Date(e.soldOn) >= monthStart);
      const salesBySoldDate = Math.round(sum(soldInMonth, estValue));
      const winsBySoldDate = uniqJobs(soldInMonth);
      let completedRevenue = 'err', completedJobs = 0, oppJobsN = 0, convJobsN = 0, jobsCloseRatePct = 0, jobsOppJobAvg = 0, jobsClosedAvg = 0;
      let jobsBreakdown = null, jobFieldKeys = null, invFieldKeys = null;
      try {
        const jj = await client.get(tenant, `/jpm/v2/tenant/${tenant.tenantId}/jobs`,
          { completedOnOrAfter: monthStart.toISOString(), completedBefore: to.toISOString(), page: 1, pageSize: 500 });
        // Paginate the invoices (busy locations have far more than one page); a single page left
        // most jobs' invoices unfetched, so the per-job breakdown read $0.
        const invData = [];
        for (let p = 1; p <= 40; p++) {
          const inv = await client.get(tenant, `/accounting/v2/tenant/${tenant.tenantId}/invoices`,
            { createdOnOrAfter: new Date(monthStart.getTime() - 150 * 86400000).toISOString(), createdBefore: to.toISOString(), page: p, pageSize: 500 });
          const rowsP = inv.data || []; invData.push(...rowsP);
          if (!inv.hasMore || rowsP.length === 0) break;
        }
        const invSubById = new Map();
        for (const x of invData) invSubById.set(x.id, num(x.subTotal ?? x.subtotal ?? x.total ?? x.amount));   // invoice income items (pre-tax subTotal)
        const invSubOf = (j) => num(invSubById.get(j.invoiceId ?? j.invoice?.id));
        const done = (jj.data || []).filter((j) => (j.jobStatus === 'Completed') && j.completedOn && new Date(j.completedOn) >= monthStart);
        completedJobs = done.length;
        // The dashboard's model, with ServiceTitan's $65 sold threshold: opportunity = completed &
        // (not No-Charge, or No-Charge invoiced over $65); converted = invoice subtotal over $65;
        // revenue = invoice subtotal on opportunities.
        const SOLD_THRESHOLD = 65;
        const soldValueByJob = new Map();
        for (const e of rows) if (currentIsSold(e)) { const jid = jobIdOf(e); soldValueByJob.set(jid, (soldValueByJob.get(jid) || 0) + estValue(e)); }
        const soldVal = (j) => soldValueByJob.get(j.id ?? j.jobId) || 0;
        const opp = done.filter((j) => !(j.noCharge && invSubOf(j) <= SOLD_THRESHOLD));
        const conv = opp.filter((j) => invSubOf(j) > SOLD_THRESHOLD);
        oppJobsN = opp.length; convJobsN = conv.length;
        const oppRev = Math.round(opp.reduce((a, j) => a + invSubOf(j), 0));
        completedRevenue = oppRev;   // Completed Revenue = invoice income items on completed jobs
        jobsCloseRatePct = oppJobsN ? +(convJobsN / oppJobsN * 100).toFixed(1) : 0;
        jobsOppJobAvg = oppJobsN ? Math.round(oppRev / oppJobsN) : 0;
        // Closed Avg numerator = sold-estimate value on converted opportunities.
        const closedSales = Math.round(conv.reduce((a, j) => a + soldVal(j), 0));
        jobsClosedAvg = convJobsN ? Math.round(closedSales / convJobsN) : 0;
        // Per-job breakdown (no PII) — shows exactly which completed jobs we count as an
        // opportunity/conversion and their invoice amount + type/recall flags, so we can see
        // which jobs ServiceTitan includes or excludes vs. us. jobFieldKeys/invFieldKeys expose
        // whatever fields the tenant actually returns (opportunity flag? jobType? adjustments?).
        jobFieldKeys = done[0] ? Object.keys(done[0]) : (jj.data || [])[0] ? Object.keys(jj.data[0]) : [];
        invFieldKeys = invData[0] ? Object.keys(invData[0]) : [];
        jobsBreakdown = done.map((j) => {
          const s = invSubOf(j), sv = soldVal(j), isOpp = !(j.noCharge && s <= SOLD_THRESHOLD);
          return {
            id: j.id ?? j.jobId, completedOn: String(j.completedOn || '').slice(0, 10),
            invoiceId: j.invoiceId ?? j.invoice?.id ?? null, invSubtotal: s, soldValue: sv,
            noCharge: j.noCharge ?? null, recallForId: j.recallForId ?? null, warrantyId: j.warrantyId ?? null,
            jobTypeId: j.jobTypeId ?? j.jobType?.id ?? null, jobTypeName: j.jobType?.name ?? null,
            countedOpp: isOpp, countedConverted: isOpp && s > SOLD_THRESHOLD,
          };
        }).sort((a, b) => (a.completedOn < b.completedOn ? -1 : 1));
      } catch (e) { completedRevenue = 'err:' + String(e.message || e); }

      let storedMonth = null;
      try {
        const snap = await readSnapshot(tenant.tenantId);
        const daysObj = snap.days || {};
        storedMonth = Object.keys(daysObj).filter((k) => k >= mKey).reduce((a, k) => {
          const d = daysObj[k]; a.opps += d.opps || 0; a.wins += d.wins || 0; a.salesUSD += Math.round(d.salesUSD || 0); a.revenueUSD += Math.round(d.revenueUSD || 0); return a;
        }, { opps: 0, wins: 0, salesUSD: 0, revenueUSD: 0 });
      } catch { /* ignore */ }

      monthToDate = {
        monthStart: mKey,
        fresh: {
          // our current basis: bucket everything on the estimate CREATE day
          opps: mOpps, converted: mWins,
          salesUSD_createDay: Math.round(mSales), revenueUSD_invoices: mRevenue,
          oppJobAvg: mOpps ? Math.round(mPipe / mOpps) : 0,
          closedAvgSale_createDay: mWins ? Math.round(mSales / mWins) : 0,
          closeRatePct: mOpps ? +(mWins / mOpps * 100).toFixed(1) : 0,
          // candidate ServiceTitan-matching bases
          salesUSD_soldDay: salesBySoldDate, convertedJobs_soldDay: winsBySoldDate,
          closedAvgSale_soldDay: winsBySoldDate ? Math.round(salesBySoldDate / winsBySoldDate) : 0,
          revenueUSD_completedJobs: completedRevenue, completedJobs,
        },
        // The dashboard's actual model now: opportunities/conversions from JOBS.
        dashboardModel: {
          opportunities: oppJobsN, converted: convJobsN,
          closeRatePct: jobsCloseRatePct, oppJobAvg: jobsOppJobAvg,
          closedAvgSale: jobsClosedAvg, salesUSD: salesBySoldDate, revenueUSD: completedRevenue,
        },
        stored: storedMonth,
        jobFieldKeys, invFieldKeys, jobsBreakdown,
      };
    } catch (e) { monthToDate = { error: String(e.message || e) }; }

    return Response.json({
      tenant: t.name, windowDays: days, rowsSampled: rows.length,
      statusCounts, soldByStatus, withRealSoldOn, withRealSoldDate,
      realSoldOnButNotStatusSold, soldByCurrentLogic,
      closeRate, stored, monthToDate, techAttribution, jobsSample, assignments, appointments, sample,
    });
  } catch (e) {
    return Response.json({ tenant: t.name, error: String(e.message || e) });
  }
};

export const config = { path: '/api/debug/:tenant' };
