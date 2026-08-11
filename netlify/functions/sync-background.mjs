// Background function (15-min budget) that pulls ServiceTitan → Blobs.
// Triggered hourly by sync-hourly, or on demand: POST/GET /api/sync (returns 202 immediately).
import { getConfig, configured } from './_shared/config.mjs';
import { syncAll } from './_shared/syncCore.mjs';
import { writeStatus } from './_shared/blobStore.mjs';

export default async (req) => {
  const c = getConfig();
  if (!configured(c)) {
    console.log('ServiceTitan not configured (set ST_APP_KEY + TENANTS_JSON).');
    await writeStatus({ at: new Date().toISOString(), error: 'not configured', results: [] });
    return;
  }
  // Overlapping syncs (cron + an on-demand pull) just merge idempotently into the same snapshots,
  // so no lock — a lock only risks skipping a needed sync or wedging if it isn't released.
  // /api/sync?full=1 forces a full re-backfill (overwrites stored history) — use after a mapping fix.
  let force = false;
  try { force = new URL(req.url).searchParams.get('full') === '1'; } catch { /* no url */ }
  const results = await syncAll(c, { force });
  console.log('sync complete:', JSON.stringify(results));
  await writeStatus({ at: new Date().toISOString(), full: force, results });
};

export const config = { path: '/api/sync' };
