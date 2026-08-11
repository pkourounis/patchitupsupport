// Snapshot storage on Netlify Blobs (persists across function invocations & deploys).
import { getStore } from '@netlify/blobs';

const store = () => getStore('piu-snapshots');
const key = (id) => `tenant_${id}`;

export async function readSnapshot(id) {
  const s = await store().get(key(id), { type: 'json' });
  return s || { tenantId: String(id), updatedAt: null, days: {}, technicians: [], techDaily: {}, techRoster: {} };
}
export async function writeSnapshot(id, snap) {
  await store().setJSON(key(id), snap);
}
export async function mergeDays(id, dayMap, technicians, techDaily, techRoster, opts = {}) {
  const snap = await readSnapshot(id);
  // replace: a forced/full backfill rebuilds the window from scratch, so drop any stale days
  // left behind by an earlier (buggy) mapping instead of merging on top of them.
  const days = opts.replace ? {} : (snap.days || {});
  for (const [d, m] of dayMap) days[d] = m;
  const td = opts.replace ? {} : (snap.techDaily || {});
  if (techDaily) for (const d in techDaily) td[d] = techDaily[d];
  const roster = opts.replace ? { ...(techRoster || {}) } : { ...(snap.techRoster || {}), ...(techRoster || {}) };
  const next = { tenantId: String(id), updatedAt: new Date().toISOString(), days, technicians: technicians ?? snap.technicians ?? [], techDaily: td, techRoster: roster };
  await writeSnapshot(id, next);
  return next;
}
export async function seriesArray(id) {
  const snap = await readSnapshot(id);
  return Object.entries(snap.days || {}).map(([t, m]) => ({ t, ...m })).sort((a, b) => (a.t < b.t ? -1 : 1));
}
// last-sync status (per-tenant results/errors) so /api/health is self-diagnosing
export async function writeStatus(status) { await store().setJSON('sync-status', status); }
export async function readStatus() { return (await store().get('sync-status', { type: 'json' })) || null; }
