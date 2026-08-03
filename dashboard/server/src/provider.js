/**
 * Maps ServiceTitan entities → the daily-metric + technician shape the dashboard reads.
 *
 * KPI definitions (transparent, and easy to adjust here):
 *   opportunities  = unique jobs with an estimate CREATED that day
 *   converted jobs = unique jobs with an estimate SOLD that day
 *   salesUSD       = Σ subtotal of estimates SOLD that day        (booked value of won work)
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
  invAfter: 'invoicedOnOrAfter',
  invBefore: 'invoicedBefore',
};

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const day = (iso) => (iso ? String(iso).slice(0, 10) : null); // UTC calendar day

const estValue = (e) => num(e.subtotal ?? e.total ?? e.amount);
const estSoldOn = (e) => e.soldOn || e.soldDate || (statusName(e) === 'Sold' ? (e.modifiedOn || e.createdOn) : null);
const estCreatedOn = (e) => e.createdOn || e.createdDate || e.modifiedOn;
const estJobId = (e) => e.jobId ?? e.job?.id ?? e.id;
const statusName = (e) => (typeof e.status === 'string' ? e.status : (e.status?.name || e.status?.value || e.statusName || ''));
const isSold = (e) => statusName(e) === 'Sold' || !!(e.soldOn || e.soldDate);
const estTech = (e) => e.soldById ?? e.soldBy ?? e.owner?.id ?? e.createdById ?? null;

const invValue = (i) => num(i.total ?? i.subtotal ?? i.amount);
const invDate = (i) => i.invoiceDate || i.invoicedOn || i.createdOn;

function emptyDay() { return { opps: 0, wins: 0, salesUSD: 0, pipelineUSD: 0, revenueUSD: 0 }; }

/** Fetch the raw estimates + invoices for a window. */
export async function fetchWindow(client, tenant, from, to) {
  const fromISO = from.toISOString();
  const toISO = to.toISOString();
  const [estimates, invoices] = await Promise.all([
    client.estimates(tenant, { [PARAMS.estCreatedAfter]: fromISO, [PARAMS.estCreatedBefore]: toISO }),
    client.invoices(tenant, { [PARAMS.invAfter]: fromISO, [PARAMS.invBefore]: toISO }),
  ]);
  return { estimates, invoices };
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
    if (cd) { const b = bump(cd); b.pipelineUSD += estValue(e); const s = seen(oppSeen, cd); if (!s.has(estJobId(e))) { s.add(estJobId(e)); b.opps += 1; } }
    if (isSold(e)) {
      const sd = day(estSoldOn(e));
      if (sd) { const b = bump(sd); b.salesUSD += estValue(e); const s = seen(winSeen, sd); if (!s.has(estJobId(e))) { s.add(estJobId(e)); b.wins += 1; } }
    }
  }
  for (const i of invoices) { const d = day(invDate(i)); if (d) bump(d).revenueUSD += invValue(i); }
  return map;
}

/** Technician scorecards from raw entities (last-N-days window), joined to names + photos. */
export function buildTechnicians({ estimates }, infoById = {}) {
  const g = new Map();
  const get = (id) => { const k = id ?? 'unassigned'; if (!g.has(k)) g.set(k, { id: k, opps: 0, converted: 0, revenue: 0, pipeline: 0 }); return g.get(k); };
  for (const e of estimates) {
    const t = get(estTech(e));
    t.opps += 1; t.pipeline += estValue(e);
    if (isSold(e)) { t.converted += 1; t.revenue += estValue(e); }
  }
  return [...g.values()].map((t) => {
    const info = infoById[t.id] || {};
    const name = info.name || (t.id === 'unassigned' ? 'Unassigned' : `Technician ${t.id}`);
    return {
      name,
      photo: info.photo || null, // ServiceTitan avatar URL when available
      initials: name.split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase(),
      revenue: t.revenue,
      totalJobAvg: t.converted ? t.revenue / t.converted : 0,
      oppJobAvg: t.opps ? t.pipeline / t.opps : 0,
      oppConv: t.opps ? t.converted / t.opps : 0,
      opps: t.opps,
      converted: t.converted,
      csat: null, // no CSAT source wired yet — surfaces as N/A
    };
  }).sort((a, b) => b.revenue - a.revenue);
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
