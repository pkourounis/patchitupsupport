// Reuses the shared ServiceTitan client + KPI provider (same code the Node server + tests use).
import { ServiceTitanClient } from '../../../dashboard/server/src/servicetitan.js';
import { fetchWindow, buildDailyMap, buildTechnicians, technicianInfoMap } from '../../../dashboard/server/src/provider.js';
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
      let info = {};
      try { info = technicianInfoMap(await client.technicians(tenant)); } catch { /* settings scope optional */ }

      await mergeDays(tenant.tenantId, dayMap, buildTechnicians(filtered, info));
      results.push({ tenant: t.name, mode: hasHistory ? 'refresh' : 'backfill', days: Object.keys(dayMap).length, warn: raw.errors || undefined });
    } catch (err) {
      results.push({ tenant: t.name, error: String(err.message || err) });
    }
  }
  return results;
}
