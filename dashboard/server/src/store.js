import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/**
 * Snapshot store. Default: one JSON file per tenant under ./data.
 * Fine for the current franchise count; for 1,000+ tenants swap this module for
 * Postgres/Supabase (same 4-method interface). Nothing else needs to change.
 */
const dir = path.resolve(config.dataDir);
function ensure() { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
const file = (tenantId) => path.join(dir, `${tenantId}.json`);

export function readSnapshot(tenantId) {
  ensure();
  const f = file(tenantId);
  if (!fs.existsSync(f)) return { tenantId: String(tenantId), updatedAt: null, days: {}, technicians: [] };
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

export function writeSnapshot(tenantId, snap) {
  ensure();
  fs.writeFileSync(file(tenantId), JSON.stringify(snap));
}

/** Merge a freshly-computed day map into stored days (fresh values overwrite by date). */
export function mergeDays(tenantId, dayMap, technicians) {
  const snap = readSnapshot(tenantId);
  const days = snap.days || {};
  for (const [d, m] of dayMap) days[d] = m;
  const next = { tenantId: String(tenantId), updatedAt: new Date().toISOString(), days, technicians: technicians ?? snap.technicians ?? [] };
  writeSnapshot(tenantId, next);
  return next;
}

/** Stored days as a sorted [{ t:'YYYY-MM-DD', opps, wins, salesUSD, pipelineUSD, revenueUSD }]. */
export function seriesArray(tenantId) {
  const snap = readSnapshot(tenantId);
  return Object.entries(snap.days || {})
    .map(([t, m]) => ({ t, ...m }))
    .sort((a, b) => (a.t < b.t ? -1 : 1));
}
