import { config, loadTenants } from './config.js';
import { ServiceTitanClient } from './servicetitan.js';
import { fetchWindow, buildDailyMap, buildTechnicians, technicianNameMap } from './provider.js';
import { mergeDays, readSnapshot } from './store.js';

const DAY = 86400000;

/** Pull one tenant and merge into its snapshot. First run backfills; later runs refresh recent days. */
export async function syncTenant(client, tenant) {
  const existing = readSnapshot(tenant.tenantId);
  const hasHistory = existing.updatedAt && Object.keys(existing.days || {}).length > 0;
  const spanDays = hasHistory ? config.refreshDays : config.backfillDays;

  const to = new Date();
  const from = new Date(to.getTime() - spanDays * DAY);

  const raw = await fetchWindow(client, tenant, from, to);
  const dayMap = buildDailyMap(raw);

  // technicians: last 90 days
  const techFrom = new Date(to.getTime() - 90 * DAY);
  const techRaw = spanDays >= 90 ? raw : await fetchWindow(client, tenant, techFrom, to);
  const filtered = { estimates: (techRaw.estimates || []).filter((e) => new Date(e.createdOn || 0) >= techFrom) };
  let names = {};
  try { names = technicianNameMap(await client.technicians(tenant)); } catch { /* settings scope optional */ }
  const technicians = buildTechnicians(filtered, names);

  const snap = mergeDays(tenant.tenantId, dayMap, technicians);
  return { tenant: tenant.name, tenantId: tenant.tenantId, mode: hasHistory ? 'refresh' : 'backfill', days: Object.keys(snap.days).length, technicians: technicians.length };
}

/** Sync every tenant sequentially (gentle on rate limits). */
export async function syncAll() {
  const tenants = loadTenants();
  const client = new ServiceTitanClient();
  const results = [];
  for (const t of tenants) {
    try { results.push(await syncTenant(client, t)); }
    catch (err) { results.push({ tenant: t.name, tenantId: t.tenantId, error: String(err.message || err) }); }
  }
  return results;
}

// Allow `npm run sync` as a one-shot (also usable from an external scheduler).
if (import.meta.url === `file://${process.argv[1]}`) {
  syncAll().then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(r.some((x) => x.error) ? 1 : 0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
