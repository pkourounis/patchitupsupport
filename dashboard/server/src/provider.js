/**
 * Maps ServiceTitan entities → the daily-metric + technician shape the dashboard reads.
 *
 * KPI definitions (transparent, and easy to adjust here):
 *   Metrics use an OPPORTUNITY-COHORT basis: an estimate is bucketed on the day it was
 *   CREATED, and — if its job later sells — its conversion + booked value land in that
 *   SAME day bucket. This keeps converted ⊆ opportunities in every window, so the close
 *   rate can never exceed 100%, and it matches how the technician scorecards count.
 *
 *   opportunities  = unique jobs with an estimate CREATED that day
 *   converted jobs = of those, the unique jobs whose estimate is SOLD (counted on create day)
 *   salesUSD       = Σ subtotal of SOLD estimates, on their CREATE day (booked value of won work)
 *   pipelineUSD    = Σ subtotal of estimates CREATED that day     (drives Opp Job Avg)
 *   revenueUSD     = Σ invoice total invoiced that day            (collected/billed revenue)
 *   closeRate      = converted / opportunities
 *   closedAvgSale  = salesUSD / converted
 *   oppJobAvg      = pipelineUSD / opportunities
 *
 * These mirror ServiceTitan's Sales/Performance reporting closely. If you want *exact*
 * parity with a specific ServiceTitan report (esp. the Technician Performance board),
 * swap this provider for a Reporting-API provider — see server/README.md.
 *
 * NOTE: filter/field names below match the common ServiceTitan v2 schema; if your tenant
 * differs, adjust the PARAMS / field getters — they're all in this one file.
 */

const PARAMS = {
  estCreatedAfter: 'createdOnOrAfter',
  estCreatedBefore: 'createdBefore',
  invAfter: 'createdOnOrAfter',   // filter invoices by createdOn (widely supported); bucket by invoiceDate
  invBefore: 'createdBefore',
};

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
const estTech = (e) => e.soldById ?? e.soldBy ?? e.owner?.id ?? e.createdById ?? null;

const invValue = (i) => num(i.total ?? i.subtotal ?? i.amount);
const invDate = (i) => i.invoiceDate || i.invoicedOn || i.createdOn;

function emptyDay() { return { opps: 0, wins: 0, salesUSD: 0, pipelineUSD: 0, revenueUSD: 0 }; }

/** Fetch the raw estimates + invoices for a window. Resilient: a failure in one
 *  endpoint (e.g. a missing scope) doesn't wipe the other — it's recorded in `errors`. */
export async function fetchWindow(client, tenant, from, to) {
  const fromISO = from.toISOString();
  const toISO = to.toISOString();
  const [estRes, invRes] = await Promise.allSettled([
    client.estimates(tenant, { [PARAMS.estCreatedAfter]: fromISO, [PARAMS.estCreatedBefore]: toISO }),
    client.invoices(tenant, { [PARAMS.invAfter]: fromISO, [PARAMS.invBefore]: toISO }),
  ]);
  const errors = {};
  const estimates = estRes.status === 'fulfilled' ? estRes.value : ((errors.estimates = String(estRes.reason?.message || estRes.reason)), []);
  const invoices = invRes.status === 'fulfilled' ? invRes.value : ((errors.invoices = String(invRes.reason?.message || invRes.reason)), []);
  return { estimates, invoices, errors: Object.keys(errors).length ? errors : null };
}

/** Build the per-day metric map from raw entities. Returns Map<'YYYY-MM-DD', metrics>. */
export function buildDailyMap({ estimates, invoices }) {
  const map = new Map();
  const bump = (d) => { if (!map.has(d)) map.set(d, emptyDay()); return map.get(d); };
  // unique-job tracking per day so opps/wins count jobs, not estimate rows
  const oppSeen = new Map(); // day -> Set(jobId)
  const winSeen = new Map();
  const seen = (m, d) => { if (!m.has(d)) m.set(d, new Set()); return m.get(d); };

  for (const e of estimates) {
    const cd = day(estCreatedOn(e));
    if (!cd) continue;                 // no create date → can't place the opportunity
    const b = bump(cd), jid = estJobId(e);
    b.pipelineUSD += estValue(e);
    { const s = seen(oppSeen, cd); if (!s.has(jid)) { s.add(jid); b.opps += 1; } }
    if (isSold(e)) {                    // conversion + booked value land in the SAME (create) bucket
      b.salesUSD += estValue(e);
      const s = seen(winSeen, cd); if (!s.has(jid)) { s.add(jid); b.wins += 1; }
    }
  }
  for (const i of invoices) { const d = day(invDate(i)); if (d) bump(d).revenueUSD += invValue(i); }
  return map;
}

/** Technician scorecards from raw entities (last-N-days window), joined to names + photos. */
export function buildTechnicians({ estimates }, infoById = {}) {
  const g = new Map();
  const get = (id) => { const k = id ?? 'unassigned'; if (!g.has(k)) g.set(k, { id: k, options: 0, revenue: 0, pipeline: 0, oppJobs: new Set(), convJobs: new Set() }); return g.get(k); };
  for (const e of estimates) {
    const t = get(estTech(e));
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
export function buildTechDaily({ estimates }, infoById = {}) {
  const roster = {};
  const daily = new Map(); // day -> Map(techId -> rec)
  const getDay = (d) => { if (!daily.has(d)) daily.set(d, new Map()); return daily.get(d); };
  const getRec = (m, id) => { const k = id ?? 'unassigned'; if (!m.has(k)) m.set(k, { oppJobs: new Set(), convJobs: new Set(), options: 0, revenue: 0, pipeline: 0 }); return m.get(k); };
  for (const e of estimates) {
    const cd = day(estCreatedOn(e)); if (!cd) continue;
    const id = estTech(e), jid = estJobId(e);
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
