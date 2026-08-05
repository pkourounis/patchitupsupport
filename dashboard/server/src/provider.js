/**
 * Maps ServiceTitan entities → the daily-metric + technician shape the dashboard reads.
 *
 * KPI definitions — matched to ServiceTitan's own dashboard (verified against a tenant's
 * Modular Dashboard, per metric). Each metric is bucketed on the date ServiceTitan uses:
 *
 *   opportunities  = completed JOBS that day that aren't No-Charge (or are, but invoiced over $65)
 *   wins/converted = of those, the jobs whose INVOICE subtotal is over the $65 sold threshold
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
// Sold threshold: an invoice subtotal ABOVE this ($65) means the opportunity converted, and is
// what makes a No-Charge job count as an opportunity at all. This is ServiceTitan's tenant setting.
const SOLD_THRESHOLD = 65;
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


function emptyDay() { return { opps: 0, wins: 0, salesUSD: 0, closedSalesUSD: 0, pipelineUSD: 0, revenueUSD: 0, cancels: 0, memberships: 0 }; }

/** Fetch the raw entities for a window. Resilient: a failure in one endpoint (e.g. a missing
 *  scope) doesn't wipe the others — it's recorded in `errors`.
 *  - estimates: filtered by createdOn (opportunities + sales)
 *  - jobs: filtered by completedOn (Completed Revenue)
 *  - assignments: filtered by createdOn, widened, to attribute opportunities to technicians */
export async function fetchWindow(client, tenant, from, to) {
  const fromISO = from.toISOString();
  const toISO = to.toISOString();
  const asgFromISO = new Date(from.getTime() - 30 * 86400000).toISOString();
  // Invoices reach back well before the window: a job completing in-window can carry a DEPOSIT
  // invoice created months earlier, and revenue links each job to its own invoice by id. Fetching
  // that wider span only lets an under-counted job find its missing invoice — a job with its
  // invoice already in range is unchanged, so correct locations stay correct.
  const invFromISO = new Date(from.getTime() - 120 * 86400000).toISOString();
  // Jobs by COMPLETION date; invoices carry the "income items" that ServiceTitan counts as
  // revenue and uses to decide whether an opportunity converted (invoice subtotal ≥ threshold).
  // Appointments (by start date) feed the cancellations count; memberships feed memberships-sold.
  const [estRes, jobRes, invRes, asgRes, apptRes, memRes] = await Promise.allSettled([
    client.estimates(tenant, { createdOnOrAfter: fromISO, createdBefore: toISO }),
    client.jobs(tenant, { completedOnOrAfter: fromISO, completedBefore: toISO }),
    client.invoices(tenant, { createdOnOrAfter: invFromISO, createdBefore: toISO }),
    client.assignments(tenant, { createdOnOrAfter: asgFromISO, createdBefore: toISO }),
    client.appointments(tenant, { startsOnOrAfter: fromISO, startsBefore: toISO }),
    client.memberships(tenant, { createdOnOrAfter: fromISO, createdBefore: toISO }),
  ]);
  const errors = {};
  const pick = (res, key) => (res.status === 'fulfilled' ? res.value : ((errors[key] = String(res.reason?.message || res.reason)), []));
  const estimates = pick(estRes, 'estimates');
  const jobs = pick(jobRes, 'jobs');
  const invoices = pick(invRes, 'invoices');
  const assignments = pick(asgRes, 'assignments');
  const appointments = pick(apptRes, 'appointments');    // optional scope — absence just zeroes cancels
  const memberships = pick(memRes, 'memberships');        // optional scope — absence just zeroes memberships
  return { estimates, jobs, invoices, assignments, appointments, memberships, errors: Object.keys(errors).length ? errors : null };
}

/** Build the per-day metric map from raw entities, on ServiceTitan's bases (see file header).
 *  Returns Map<'YYYY-MM-DD', metrics>. */
export function buildDailyMap({ estimates, jobs, invoices, appointments, memberships }) {
  const map = new Map();
  const bump = (d) => { if (!map.has(d)) map.set(d, emptyDay()); return map.get(d); };

  // Invoice income items (subtotal) — ServiceTitan's Completed Revenue and its conversion test
  // both key off the job's own linked invoice (job.invoiceId). Verified correct against four
  // locations; summing every invoice that merely names the job (invoice.jobId) over-counted
  // add-on/secondary invoices ServiceTitan doesn't fold into Completed Revenue, so we don't.
  const invAmtById = new Map();
  // ServiceTitan invoices name the income-items subtotal `subTotal` (capital T); `total` INCLUDES
  // sales tax. Completed Revenue is the pre-tax income items, so read subTotal — falling back to
  // the mock/legacy spellings. (Reading `total` was adding tax, overstating taxed locations.)
  for (const inv of (invoices || [])) invAmtById.set(inv.id, num(inv.subTotal ?? inv.subtotal ?? inv.total ?? inv.amount));
  const invSubOf = (j) => num(invAmtById.get(j.invoiceId ?? j.invoice?.id));

  // Sold estimate value per job (Closed Avg numerator; Total Sales books from the estimate below).
  const soldValueByJob = new Map();
  for (const e of estimates) if (isSold(e)) { const jid = estJobId(e); soldValueByJob.set(jid, (soldValueByJob.get(jid) || 0) + estValue(e)); }

  // Opportunities, conversions and Completed Revenue come from completed JOBS + their invoices,
  // using ServiceTitan's $65 sold threshold (SOLD_THRESHOLD):
  //   opportunity = completed job, not No Charge (or No Charge invoiced over $65)
  //   converted   = opportunity whose invoice subtotal is over $65 (meets the sold threshold)
  //   revenue     = invoice income items (subtotal) on the opportunity, on the completion day
  //   closedSales = sold-estimate value on converted opportunities (Closed Avg Sale numerator)
  // Converted, closedSales bucket on the COMPLETION day alongside opportunities/revenue, so any
  // date range's Close Rate (wins/opps) and Closed Avg (closedSales/wins) stay coherent.
  for (const j of (jobs || [])) {
    if (jobStatusName(j) !== 'Completed') continue;
    const jobId = j.id ?? j.jobId;
    const invSub = invSubOf(j);
    if (j.noCharge && invSub <= SOLD_THRESHOLD) continue;   // No-Charge counts only if invoiced over $65
    const cod = day(j.completedOn);
    if (!cod) continue;
    const b = bump(cod);
    b.opps += 1;                        // opportunity
    b.revenueUSD += invSub;             // Completed Revenue = invoice income items
    if (invSub > SOLD_THRESHOLD) {      // converted = invoice subtotal meets the $65 sold threshold
      b.wins += 1;
      b.closedSalesUSD += (soldValueByJob.get(jobId) || 0);
    }
  }
  // Total Sales books on the SOLD day from the sold estimate value (unchanged — this is correct).
  // pipeline retained (unused).
  for (const e of estimates) {
    const cd = day(estCreatedOn(e));
    if (cd) bump(cd).pipelineUSD += estValue(e);
    if (isSold(e)) { const sd = day(estSoldOn(e)); if (sd) bump(sd).salesUSD += estValue(e); }
  }
  // Cancellations: appointments marked Canceled, on the appointment (start) day.
  for (const a of (appointments || [])) {
    const st = String(a.status?.name ?? a.status ?? '').toLowerCase();
    if (st !== 'canceled' && st !== 'cancelled') continue;
    const d = day(a.start ?? a.createdOn); if (d) bump(d).cancels += 1;
  }
  // Memberships sold, on the sold/created day (field name varies by tenant — try the common ones).
  for (const m of (memberships || [])) {
    const d = day(m.soldOn ?? m.from ?? m.createdOn ?? m.activeOn); if (d) bump(d).memberships += 1;
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

/** Per-day, per-technician breakdown so the dashboard can total any date range. Each row is
 *  [opps, converted, options, revenue(sales), pipeline, hours, jobs, completedRevenue] — hours/jobs
 *  come from appointment durations; completedRevenue is the invoice subtotal on completed jobs the
 *  tech RAN (distinct from their sold value). Returns { roster, daily }. */
export function buildTechDaily({ estimates, appointments, assignments, jobs, invoices }, infoById = {}, jobTech = null) {
  const roster = {};
  const daily = new Map(); // day -> Map(techId -> rec)
  const getDay = (d) => { if (!daily.has(d)) daily.set(d, new Map()); return daily.get(d); };
  const getRec = (m, id) => { const k = id ?? 'unassigned'; if (!m.has(k)) m.set(k, { oppJobs: new Set(), convJobs: new Set(), options: 0, revenue: 0, pipeline: 0, hours: 0, jobSet: new Set(), completedRev: 0 }); return m.get(k); };
  const ensureRoster = (id, name) => { if (id != null && !roster[id]) { const info = infoById[id] || {}; roster[id] = { name: info.name || name || `Technician ${id}`, photo: info.photo || null }; } };
  for (const e of estimates) {
    const id = estTechVia(e, jobTech), jid = estJobId(e);
    ensureRoster(id);
    // Opportunities/options/pipeline AND the conversion (for Close Rate) book on the estimate
    // CREATE day, so any date range's Close Rate (converted / opps) is a coherent cohort ≤ 100%.
    const cd = day(estCreatedOn(e));
    if (cd) { const rec = getRec(getDay(cd), id); rec.options += 1; rec.pipeline += estValue(e); rec.oppJobs.add(jid); if (isSold(e)) rec.convJobs.add(jid); }
    // SALES (sold value) book on the SOLD day — same basis as the location's Total Sales, so a
    // technician's sales total for any date range matches what actually sold in that range.
    if (isSold(e)) { const sd = day(estSoldOn(e)); if (sd) getRec(getDay(sd), id).revenue += estValue(e); }
  }
  // Labor hours + jobs run, from appointment durations attributed to the assigned technician.
  const apptById = new Map();   // appointmentId -> { hours, day, jobId }
  for (const a of (appointments || [])) {
    const s = Date.parse(a.start), e = Date.parse(a.end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;   // need a real start<end
    apptById.set(a.id, { hours: (e - s) / 3600000, day: day(a.start), jobId: a.jobId });
  }
  for (const asg of (assignments || [])) {
    const ap = apptById.get(asg.appointmentId);
    if (!ap || !ap.day) continue;
    const id = asg.technicianId;
    if (id == null) continue;
    ensureRoster(id, asg.technicianName);
    const rec = getRec(getDay(ap.day), id);
    rec.hours += ap.hours;
    if (ap.jobId != null) rec.jobSet.add(ap.jobId);
  }
  // Completed (invoice) revenue attributed to the technician who RAN each completed opportunity
  // job — the tech-level counterpart of the location's Completed Revenue, on the completion day.
  const invAmtById = new Map();
  for (const inv of (invoices || [])) invAmtById.set(inv.id, num(inv.subTotal ?? inv.subtotal ?? inv.total ?? inv.amount));
  const jt = jobTech || new Map();
  for (const j of (jobs || [])) {
    if (jobStatusName(j) !== 'Completed') continue;
    const jobId = j.id ?? j.jobId;
    const invSub = num(invAmtById.get(j.invoiceId ?? j.invoice?.id));
    if (j.noCharge && invSub <= SOLD_THRESHOLD) continue;   // same opportunity rule as the location
    const cod = day(j.completedOn); if (!cod) continue;
    const ran = jt.get(jobId); const id = ran?.id ?? null;
    ensureRoster(id, ran?.name);
    getRec(getDay(cod), id).completedRev += invSub;
  }
  const out = {};
  for (const [d, m] of daily) { out[d] = {}; for (const [id, r] of m) out[d][id] = [r.oppJobs.size, r.convJobs.size, r.options, Math.round(r.revenue), Math.round(r.pipeline), +r.hours.toFixed(2), r.jobSet.size, Math.round(r.completedRev)]; }
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
