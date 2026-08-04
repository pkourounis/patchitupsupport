/**
 * Maps ServiceTitan entities → the daily-metric + technician shape the dashboard reads.
 *
 * KPI definitions — matched to ServiceTitan's own dashboard (verified against a tenant's
 * Modular Dashboard, per metric). Each metric is bucketed on the date ServiceTitan uses:
 *
 *   opportunities  = completed JOBS that day that aren't No-Charge (or are, but were invoiced)
 *   wins/converted = of those, the jobs whose INVOICE subtotal met the sold threshold (≈ invoiced)
 *   revenueUSD     = Σ invoice income items (subtotal) on those completed jobs (Completed Revenue)
 *   salesUSD       = Σ subtotal of estimates SOLD that day           (Total Sales, by sold date)
 *   pipelineUSD    = Σ subtotal of estimates CREATED that day        (retained; not shown)
 *   closeRate      = converted / opportunities   (Opportunity Conversion Rate)
 *   closedAvgSale  = closedSalesUSD / converted   (sold value of closed opps / converted)
 *   oppJobAvg      = revenueUSD / opportunities    (Completed Revenue / Opportunities)
 *
 * Revenue and conversion key off the JOB INVOICES (ServiceTitan's "income items"), not the sold
 * estimate — job.total is empty in this tenant and the estimate misses post-sale add-ons. Sales
 * still comes from the sold estimate value. Bucketed on the completion/sold day, per ServiceTitan.
 *
 * NOTE: filter/field names below match the common ServiceTitan v2 schema; if your tenant
 * differs, adjust the field getters — they're all in this one file.
 */

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const day = (iso) => (iso ? String(iso).slice(0, 10) : null); // UTC calendar day
// A real date — ServiceTitan returns "0001-01-01T00:00:00Z" (min date) for unsold soldOn,
// which must NOT count as sold. Require a plausible year.
const validDate = (d) => { if (!d) return false; const t = Date.parse(d); return Number.isFinite(t) && new Date(t).getUTCFullYear() > 1900; };

const estValue = (e) => num(e.subtotal ?? e.total ?? e.amount);
const statusName = (e) => (typeof e.status === 'string' ? e.status : (e.status?.name || e.status?.value || e.statusName || ''));
const isSold = (e) => statusName(e) === 'Sold' || validDate(e.soldOn) || validDate(e.soldDate);
const estSoldOn = (e) => (validDate(e.soldOn) ? e.soldOn : validDate(e.soldDate) ? e.soldDate : (statusName(e) === 'Sold' ? (e.modifiedOn || e.createdOn) : null));
const estCreatedOn = (e) => e.createdOn || e.createdDate || e.modifiedOn;
const estJobId = (e) => e.jobId ?? e.job?.id ?? e.id;
const jobStatusName = (j) => (typeof j.jobStatus === 'string' ? j.jobStatus : (j.jobStatus?.name || j.status || ''));
// An estimate only names a technician (soldBy) once it's Sold, so it can't tell us who ran an
// unsold opportunity. Resolve the technician from the job's appointment assignment instead,
// falling back to the seller (soldBy) when we have no assignment for that job.
const estSeller = (e) => e.soldById ?? e.soldBy ?? null;
const estTechVia = (e, jobTech) => (jobTech && jobTech.get(estJobId(e))?.id) ?? estSeller(e) ?? null;

/** jobId → { id, name } for the technician who ran the job (from appointment assignments).
 *  If a job has several assignments/techs, keep the earliest assigned (the primary runner). */
export function buildJobTechMap(assignments = []) {
  const byJob = new Map();      // jobId -> { id, name, at }
  const nameById = {};
  for (const a of assignments) {
    const jid = a.jobId, tid = a.technicianId;
    if (jid == null || tid == null) continue;
    if (a.technicianName) nameById[tid] = a.technicianName;
    const at = Date.parse(a.assignedOn || a.createdOn || 0) || 0;
    const cur = byJob.get(jid);
    if (!cur || at < cur.at) byJob.set(jid, { id: tid, name: a.technicianName || `Technician ${tid}`, at });
  }
  return { jobTech: byJob, nameById };
}


function emptyDay() { return { opps: 0, wins: 0, salesUSD: 0, closedSalesUSD: 0, pipelineUSD: 0, revenueUSD: 0 }; }

/** Fetch the raw entities for a window. Resilient: a failure in one endpoint (e.g. a missing
 *  scope) doesn't wipe the others — it's recorded in `errors`.
 *  - estimates: filtered by createdOn (opportunities + sales)
 *  - jobs: filtered by completedOn (Completed Revenue)
 *  - assignments: filtered by createdOn, widened, to attribute opportunities to technicians */
export async function fetchWindow(client, tenant, from, to) {
  const fromISO = from.toISOString();
  const toISO = to.toISOString();
  const asgFromISO = new Date(from.getTime() - 30 * 86400000).toISOString();
  const invFromISO = new Date(from.getTime() - 15 * 86400000).toISOString();
  // Jobs by COMPLETION date; invoices carry the "income items" that ServiceTitan counts as
  // revenue and uses to decide whether an opportunity converted (invoice subtotal ≥ threshold).
  const [estRes, jobRes, invRes, asgRes] = await Promise.allSettled([
    client.estimates(tenant, { createdOnOrAfter: fromISO, createdBefore: toISO }),
    client.jobs(tenant, { completedOnOrAfter: fromISO, completedBefore: toISO }),
    client.invoices(tenant, { createdOnOrAfter: invFromISO, createdBefore: toISO }),
    client.assignments(tenant, { createdOnOrAfter: asgFromISO, createdBefore: toISO }),
  ]);
  const errors = {};
  const estimates = estRes.status === 'fulfilled' ? estRes.value : ((errors.estimates = String(estRes.reason?.message || estRes.reason)), []);
  const jobs = jobRes.status === 'fulfilled' ? jobRes.value : ((errors.jobs = String(jobRes.reason?.message || jobRes.reason)), []);
  const invoices = invRes.status === 'fulfilled' ? invRes.value : ((errors.invoices = String(invRes.reason?.message || invRes.reason)), []);
  const assignments = asgRes.status === 'fulfilled' ? asgRes.value : ((errors.assignments = String(asgRes.reason?.message || asgRes.reason)), []);
  return { estimates, jobs, invoices, assignments, errors: Object.keys(errors).length ? errors : null };
}

/** Build the per-day metric map from raw entities, on ServiceTitan's bases (see file header).
 *  Returns Map<'YYYY-MM-DD', metrics>. */
export function buildDailyMap({ estimates, jobs, invoices }) {
  const map = new Map();
  const bump = (d) => { if (!map.has(d)) map.set(d, emptyDay()); return map.get(d); };

  // Invoice income items (subtotal) — ServiceTitan's Completed Revenue and its conversion test
  // both key off the job's own linked invoice (job.invoiceId). Verified correct against four
  // locations; summing every invoice that merely names the job (invoice.jobId) over-counted
  // add-on/secondary invoices ServiceTitan doesn't fold into Completed Revenue, so we don't.
  const invAmtById = new Map();
  for (const inv of (invoices || [])) invAmtById.set(inv.id, num(inv.subtotal ?? inv.total ?? inv.amount));
  const invSubOf = (j) => num(invAmtById.get(j.invoiceId ?? j.invoice?.id));

  // Sold estimate value per job (drives Total Sales + the Closed Avg numerator).
  const soldValueByJob = new Map();
  for (const e of estimates) if (isSold(e)) { const jid = estJobId(e); soldValueByJob.set(jid, (soldValueByJob.get(jid) || 0) + estValue(e)); }

  // Opportunities, conversions and Completed Revenue come from completed JOBS + their invoices:
  //   opportunity = completed job, not No Charge (or No Charge but invoiced)
  //   converted   = opportunity whose invoice subtotal meets the sold threshold (≈ invoice > 0)
  //   revenue     = invoice income items (subtotal) on completed jobs, on the completion day
  const closedOppJobIds = new Set();    // completed opportunity jobs (for Closed Avg Sale)
  for (const j of (jobs || [])) {
    if (jobStatusName(j) !== 'Completed') continue;
    const jobId = j.id ?? j.jobId;
    const invSub = invSubOf(j);
    if (j.noCharge && invSub <= 0) continue;            // No-Charge with no invoice → not an opportunity
    closedOppJobIds.add(jobId);
    const cod = day(j.completedOn);
    if (!cod) continue;
    const b = bump(cod);
    b.revenueUSD += invSub;             // Completed Revenue = invoice income items
    b.opps += 1;                        // opportunity
    if (invSub > 0) b.wins += 1;        // converted = invoice met the sold threshold
  }
  // Total Sales books on the SOLD day from the sold estimate value. closedSalesUSD is the subset
  // of that whose job is a completed opportunity (a "closed opportunity") — the Closed Avg Sale
  // numerator, which excludes sales on jobs not yet completed. pipeline retained (unused).
  for (const e of estimates) {
    const cd = day(estCreatedOn(e));
    if (cd) bump(cd).pipelineUSD += estValue(e);
    if (isSold(e)) {
      const sd = day(estSoldOn(e));
      if (sd) {
        const b = bump(sd);
        b.salesUSD += estValue(e);
        if (closedOppJobIds.has(estJobId(e))) b.closedSalesUSD += estValue(e);
      }
    }
  }
  return map;
}

/** Technician scorecards from raw entities (last-N-days window), joined to names + photos.
 *  jobTech (jobId → {id,name}) attributes each opportunity to the tech who ran the job. */
export function buildTechnicians({ estimates }, infoById = {}, jobTech = null) {
  const g = new Map();
  const get = (id) => { const k = id ?? 'unassigned'; if (!g.has(k)) g.set(k, { id: k, options: 0, revenue: 0, pipeline: 0, oppJobs: new Set(), convJobs: new Set() }); return g.get(k); };
  for (const e of estimates) {
    const t = get(estTechVia(e, jobTech));
    const jid = estJobId(e);
    t.options += 1;                 // each estimate is an "option"
    t.pipeline += estValue(e);
    t.oppJobs.add(jid);             // opportunities = unique jobs
    if (isSold(e)) { t.convJobs.add(jid); t.revenue += estValue(e); }
  }
  return [...g.values()].map((t) => {
    const info = infoById[t.id] || {};
    const name = info.name || (t.id === 'unassigned' ? 'Unassigned' : `Technician ${t.id}`);
    const opps = t.oppJobs.size, converted = t.convJobs.size;
    return {
      name,
      photo: info.photo || null, // ServiceTitan avatar URL when available
      initials: name.split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase(),
      revenue: t.revenue,
      totalJobAvg: converted ? t.revenue / converted : 0,
      oppJobAvg: opps ? t.pipeline / opps : 0,
      oppConv: opps ? converted / opps : 0,               // Close Rate = converted jobs / opportunities
      optionsPerOpp: opps ? t.options / opps : 0,          // avg estimate options per opportunity
      opps,
      converted,
      csat: null, // no CSAT source wired yet — surfaces as N/A
    };
  }).sort((a, b) => b.revenue - a.revenue);
}

/** Per-day, per-technician breakdown so the dashboard can total any date range.
 *  Returns { roster: {id:{name,photo}}, daily: {'YYYY-MM-DD': {id:[opps,converted,options,revenue,pipeline]}} } */
export function buildTechDaily({ estimates }, infoById = {}, jobTech = null) {
  const roster = {};
  const daily = new Map(); // day -> Map(techId -> rec)
  const getDay = (d) => { if (!daily.has(d)) daily.set(d, new Map()); return daily.get(d); };
  const getRec = (m, id) => { const k = id ?? 'unassigned'; if (!m.has(k)) m.set(k, { oppJobs: new Set(), convJobs: new Set(), options: 0, revenue: 0, pipeline: 0 }); return m.get(k); };
  for (const e of estimates) {
    const cd = day(estCreatedOn(e)); if (!cd) continue;
    const id = estTechVia(e, jobTech), jid = estJobId(e);
    if (id != null && !roster[id]) { const info = infoById[id] || {}; roster[id] = { name: info.name || `Technician ${id}`, photo: info.photo || null }; }
    const rec = getRec(getDay(cd), id);
    rec.options += 1; rec.pipeline += estValue(e); rec.oppJobs.add(jid);
    if (isSold(e)) { rec.convJobs.add(jid); rec.revenue += estValue(e); }
  }
  const out = {};
  for (const [d, m] of daily) { out[d] = {}; for (const [id, r] of m) out[d][id] = [r.oppJobs.size, r.convJobs.size, r.options, Math.round(r.revenue), Math.round(r.pipeline)]; }
  return { roster, daily: out };
}

/** Map ServiceTitan technicians list → { id: { name, photo } }. */
export function technicianInfoMap(list = []) {
  const m = {};
  for (const t of list) m[t.id] = {
    name: t.name || t.displayName || [t.firstName, t.lastName].filter(Boolean).join(' ') || String(t.id),
    photo: t.avatarUrl || t.profilePictureUrl || t.photoUrl || t.imageUrl || null,
  };
  return m;
}
