/**
 * Maps ServiceTitan entities → the daily-metric + technician shape the dashboard reads.
 *
 * KPI definitions — matched to ServiceTitan's own dashboard (verified against a tenant's
 * Modular Dashboard, per metric). Each metric is bucketed on the date ServiceTitan uses:
 *
 *   opportunities  = opportunity JOBS completed that day (completed, not recall/warranty/no-charge)
 *   wins/converted = of those, the jobs that SOLD (soldById set)
 *   revenueUSD     = Σ total of those completed jobs                 (Completed Revenue)
 *   salesUSD       = Σ subtotal of estimates SOLD that day           (Total Sales, by sold date)
 *   pipelineUSD    = Σ subtotal of estimates CREATED that day        (retained; not shown)
 *   closeRate      = converted / opportunities   (Opportunity Conversion Rate)
 *   closedAvgSale  = salesUSD / converted         (Total Sales / Converted Jobs)
 *   oppJobAvg      = revenueUSD / opportunities    (Completed Revenue / Opportunities)
 *
 * Opportunities/conversions come from the JOBS feed (an estimate only names its opportunity's
 * technician once sold, and jobs are how ServiceTitan counts opportunities). Sales stays on the
 * sold estimate value. All bucketed on the completed/sold day, matching ServiceTitan's dashboard.
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
// Opportunity job (ServiceTitan's definition): a COMPLETED job not marked No Charge. Revenue is
// the sum of its income items (job.total). Converted = an opportunity whose estimate sold.
const isOpportunityJob = (j) => jobStatusName(j) === 'Completed' && !j.noCharge;
const jobSold = (j) => j.soldById != null && j.soldById !== 0;   // converted = the opportunity sold
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


function emptyDay() { return { opps: 0, wins: 0, salesUSD: 0, pipelineUSD: 0, revenueUSD: 0 }; }

/** Fetch the raw entities for a window. Resilient: a failure in one endpoint (e.g. a missing
 *  scope) doesn't wipe the others — it's recorded in `errors`.
 *  - estimates: filtered by createdOn (opportunities + sales)
 *  - jobs: filtered by completedOn (Completed Revenue)
 *  - assignments: filtered by createdOn, widened, to attribute opportunities to technicians */
export async function fetchWindow(client, tenant, from, to) {
  const fromISO = from.toISOString();
  const toISO = to.toISOString();
  const asgFromISO = new Date(from.getTime() - 30 * 86400000).toISOString();
  // Jobs are filtered by createdOn (the reliably-supported param) with a buffer, because a job
  // completed inside the window may have been created earlier; we then keep only those actually
  // COMPLETED in [from, to] so revenue days stay inside the window.
  const jobFromISO = new Date(from.getTime() - 120 * 86400000).toISOString();
  const [estRes, jobRes, asgRes] = await Promise.allSettled([
    client.estimates(tenant, { createdOnOrAfter: fromISO, createdBefore: toISO }),
    client.jobs(tenant, { createdOnOrAfter: jobFromISO, createdBefore: toISO }),
    client.assignments(tenant, { createdOnOrAfter: asgFromISO, createdBefore: toISO }),
  ]);
  const errors = {};
  const estimates = estRes.status === 'fulfilled' ? estRes.value : ((errors.estimates = String(estRes.reason?.message || estRes.reason)), []);
  let jobs = jobRes.status === 'fulfilled' ? jobRes.value : ((errors.jobs = String(jobRes.reason?.message || jobRes.reason)), []);
  const fromT = from.getTime(), toT = to.getTime();
  jobs = jobs.filter((j) => { const c = Date.parse(j.completedOn); return Number.isFinite(c) && c >= fromT && c <= toT; });
  const assignments = asgRes.status === 'fulfilled' ? asgRes.value : ((errors.assignments = String(asgRes.reason?.message || asgRes.reason)), []);
  return { estimates, jobs, assignments, errors: Object.keys(errors).length ? errors : null };
}

/** Build the per-day metric map from raw entities, on ServiceTitan's bases (see file header).
 *  Returns Map<'YYYY-MM-DD', metrics>. */
export function buildDailyMap({ estimates, jobs }) {
  const map = new Map();
  const bump = (d) => { if (!map.has(d)) map.set(d, emptyDay()); return map.get(d); };

  // Opportunities, conversions and completed revenue all come from JOBS, bucketed on the
  // completed day — this is the "opportunity job" basis ServiceTitan's dashboard uses, so
  // #Opps / Converted / Close Rate / Opp Job Avg reconcile with it.
  for (const j of (jobs || [])) {
    if (!isOpportunityJob(j)) continue;
    const cod = day(j.completedOn);
    if (!cod) continue;
    const b = bump(cod);
    b.revenueUSD += num(j.total);       // Completed Revenue
    b.opps += 1;                        // opportunity
    if (jobSold(j)) b.wins += 1;        // converted
  }
  // Total Sales books on the SOLD day from the sold estimate value; pipeline retained (unused).
  for (const e of estimates) {
    const cd = day(estCreatedOn(e));
    if (cd) bump(cd).pipelineUSD += estValue(e);
    if (isSold(e)) { const sd = day(estSoldOn(e)); if (sd) bump(sd).salesUSD += estValue(e); }
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
