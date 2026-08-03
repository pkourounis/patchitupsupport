import { getConfig, configured, publicTenant } from './_shared/config.mjs';
import { readSnapshot, readStatus } from './_shared/blobStore.mjs';

export default async () => {
  const c = getConfig();
  const isConfigured = configured(c);
  const status = await readStatus().catch(() => null);
  const byName = {};
  if (status && Array.isArray(status.results)) for (const r of status.results) byName[r.tenant] = r;

  const tenants = [];
  for (const t of c.tenants) {
    let updatedAt = null, days = 0;
    try { const s = await readSnapshot(t.tenantId); updatedAt = s.updatedAt; days = Object.keys(s.days || {}).length; } catch { /* blob may not exist yet */ }
    const r = byName[t.name] || {};
    tenants.push({ ...publicTenant(t), updatedAt, days, lastMode: r.mode || null, lastError: r.error || null, lastEndpointErrors: r.warn || null });
  }
  const hasData = tenants.some((t) => t.days > 0);
  // ok drives the dashboard's auto-switch to live: only flip once real data is stored.
  return Response.json({ ok: isConfigured && hasData, configured: isConfigured, hasData, env: c.env, appKeySet: !!c.appKey, lastSyncAt: status?.at || null, tenants });
};

export const config = { path: '/api/health' };
