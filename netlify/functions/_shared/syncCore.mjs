// Reuses the shared ServiceTitan client + KPI provider (same code the Node server + tests use).
import { ServiceTitanClient } from '../../../dashboard/server/src/servicetitan.js';
import { fetchWindow, buildDailyMap, buildTechnicians, buildTechDaily, buildJobTechMap, technicianInfoMap } from '../../../dashboard/server/src/provider.js';
import { readSnapshot, mergeDays } from './blobStore.mjs';

const DAY = 86400000;

export async function syncAll(cfg, opts = {}) {
  const client = new ServiceTitanClient({ env: cfg.env, appKey: cfg.appKey });
  const results = [];
  for (const t of cfg.tenants) {
    try {
      const tenant = { tenantId: String(t.tenantId), clientId: t.clientId, clientSecret: t.clientSecret };
      const existing = await readSnapshot(tenant.tenantId);
      const hasHistory = existing.updatedAt && Object.keys(existing.days || {}).length > 0;
      const span = (opts.force || !hasHistory) ? cfg.backfillDays : cfg.refreshDays;
      const to = new Date();
      const from = new Date(to.getTime() - span * DAY);

      const raw = await fetchWindow(client, tenant, from, to);
      const dayMap = buildDailyMap(raw);

      const techFrom = new Date(to.getTime() - 90 * DAY);
      const filtered = { estimates: (raw.estimates || []).filter((e) => new Date(e.createdOn || 0) >= techFrom) };
      const { jobTech, nameById } = buildJobTechMap(raw.assignments);   // jobId → who ran it
      let info = {};
      try { info = technicianInfoMap(await client.technicians(tenant)); } catch { /* settings scope optional */ }
      for (const [id, name] of Object.entries(nameById)) info[id] = { name: info[id]?.name || name, photo: info[id]?.photo || null };  // names from assignments, photos from settings

      const td = buildTechDaily(raw, info, jobTech);   // full window → any date range can be totaled
      const rebuild = opts.force || !hasHistory;   // full backfill → replace, so no stale days survive
      await mergeDays(tenant.tenantId, dayMap, buildTechnicians(filtered, info, jobTech), td.daily, td.roster, { replace: rebuild });
      results.push({ tenant: t.name, mode: hasHistory ? 'refresh' : 'backfill', days: Object.keys(dayMap).length, warn: raw.errors || undefined });
    } catch (err) {
      results.push({ tenant: t.name, error: String(err.message || err) });
    }
  }
  return results;
}
