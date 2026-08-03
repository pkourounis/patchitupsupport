import { getConfig, configured, publicTenant } from './_shared/config.mjs';
import { readSnapshot } from './_shared/blobStore.mjs';

export default async () => {
  const c = getConfig();
  const isConfigured = configured(c);
  const tenants = [];
  for (const t of c.tenants) {
    let updatedAt = null;
    try { updatedAt = (await readSnapshot(t.tenantId)).updatedAt; } catch { /* blob may not exist yet */ }
    tenants.push({ ...publicTenant(t), updatedAt });
  }
  const hasData = tenants.some((t) => t.updatedAt);
  // ok drives the dashboard's auto-switch to live: only flip once real data is stored.
  return Response.json({ ok: isConfigured && hasData, configured: isConfigured, hasData, env: c.env, appKeySet: !!c.appKey, tenants });
};

export const config = { path: '/api/health' };
