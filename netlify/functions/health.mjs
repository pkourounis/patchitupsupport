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
    let updatedAt = null;
    try { updatedAt = (await readSnapshot(t.tenantId)).updatedAt; } catch { /* blob may not exist yet */ }
    const r = byName[t.name] || {};
    tenants.push({ ...publicTenant(t), updatedAt, lastError: r.error || null, lastDays: r.days ?? null, lastMode: r.mode || null });
  }
  const hasData = tenants.some((t) => t.updatedAt);
  // ok drives the dashboard's auto-switch to live: only flip once real data is stored.
  return Response.json({ ok: isConfigured && hasData, configured: isConfigured, hasData, env: c.env, appKeySet: !!c.appKey, lastSyncAt: status?.at || null, tenants });
};

export const config = { path: '/api/health' };
