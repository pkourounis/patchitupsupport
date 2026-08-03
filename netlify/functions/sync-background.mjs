// Background function (15-min budget) that pulls ServiceTitan → Blobs.
// Triggered hourly by sync-hourly, or on demand: POST/GET /api/sync (returns 202 immediately).
import { getConfig, configured } from './_shared/config.mjs';
import { syncAll } from './_shared/syncCore.mjs';

export default async () => {
  const c = getConfig();
  if (!configured(c)) { console.log('ServiceTitan not configured (set ST_APP_KEY + TENANTS_JSON).'); return; }
  const results = await syncAll(c);
  console.log('sync complete:', JSON.stringify(results));
};

export const config = { path: '/api/sync' };
