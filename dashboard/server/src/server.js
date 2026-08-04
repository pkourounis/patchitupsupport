import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { config, loadTenants, publicTenant } from './config.js';
import { seriesArray, readSnapshot, techDailyGet } from './store.js';
import { syncAll } from './sync.js';

const app = express();
app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()) }));
app.use(express.json());

const tenantById = () => new Map(loadTenants().map((t) => [String(t.tenantId), t]));

app.get('/api/health', (_req, res) => {
  let tenants = [];
  try { tenants = loadTenants().map((t) => ({ ...publicTenant(t), updatedAt: readSnapshot(t.tenantId).updatedAt })); }
  catch (e) { return res.status(500).json({ ok: false, error: String(e.message) }); }
  res.json({ ok: true, env: config.env, appKeySet: !!config.appKey, tenants });
});

// List locations (public metadata only — no secrets)
app.get('/api/locations', (_req, res) => {
  try { res.json(loadTenants().map(publicTenant)); }
  catch (e) { res.status(500).json({ error: String(e.message) }); }
});

// Daily series for one tenant → exactly the shape the dashboard's Adapter consumes
app.get('/api/locations/:tenant/daily', (req, res) => {
  if (!tenantById().has(req.params.tenant)) return res.status(404).json({ error: 'unknown tenant' });
  res.json(seriesArray(req.params.tenant));
});

// Technician scorecards (last 90 days) for one tenant
app.get('/api/locations/:tenant/technicians', (req, res) => {
  if (!tenantById().has(req.params.tenant)) return res.status(404).json({ error: 'unknown tenant' });
  res.json(readSnapshot(req.params.tenant).technicians || []);
});

// Per-day-per-technician breakdown (for date-range technician leaderboards)
app.get('/api/locations/:tenant/tech-daily', (req, res) => {
  if (!tenantById().has(req.params.tenant)) return res.status(404).json({ error: 'unknown tenant' });
  res.json(techDailyGet(req.params.tenant));
});

// Trigger a sync on demand (secure this behind your infra / an auth header in production)
app.post('/api/sync', async (_req, res) => {
  try { res.json({ ok: true, results: await syncAll() }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e.message) }); }
});

// Optional: serve the dashboard itself from the same origin (so no CORS/config needed).
// Put index.html one level up (../) — comment out if you host the page elsewhere.
app.use('/', express.static(new URL('../..', import.meta.url).pathname));

export function start() {
  app.listen(config.port, () => {
    console.log(`PatchitUP dashboard API on :${config.port} (env=${config.env}, appKey=${config.appKey ? 'set' : 'MISSING'})`);
    // Kick an initial sync in the background, then hourly.
    syncAll().then((r) => console.log('initial sync:', JSON.stringify(r))).catch((e) => console.error('initial sync failed:', e.message));
    if (config.cronEnabled) {
      cron.schedule('0 * * * *', () => { syncAll().then((r) => console.log('hourly sync:', JSON.stringify(r))).catch((e) => console.error('hourly sync failed:', e.message)); });
      console.log('hourly cron enabled (0 * * * *)');
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) start();
export { app };
