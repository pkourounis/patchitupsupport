/**
 * Demo mode — a working local URL with NO ServiceTitan credentials.
 * Starts the built-in mock ServiceTitan, seeds snapshots, and serves the real
 * dashboard + API so you can click through the *live plumbing* end-to-end.
 *
 *   npm run demo   →   http://localhost:8787/
 *
 * (For REAL data, use `npm start` with .env + tenants.json instead.)
 */
const MOCK = 8896;
const PORT = Number(process.env.PORT || 8787);

process.env.ST_AUTH_URL = `http://127.0.0.1:${MOCK}/connect/token`;
process.env.ST_API_BASE = `http://127.0.0.1:${MOCK}`;
process.env.ST_APP_KEY = 'demo-app-key';
process.env.TENANTS_FILE = process.env.TENANTS_FILE || new URL('./tenants.demo.json', import.meta.url).pathname;
process.env.DATA_DIR = process.env.DATA_DIR || new URL('./data-demo', import.meta.url).pathname;
process.env.CRON_ENABLED = 'false';
process.env.PORT = String(PORT);

const { startMockST } = await import('./test/mock-st.js');
await startMockST(MOCK);

const { syncAll } = await import('./src/sync.js');
console.log('Seeding demo data from mock ServiceTitan…');
const r = await syncAll();
console.log('  ' + r.map((x) => `${x.tenant}: ${x.error || x.days + 'd/' + x.technicians + 't'}`).join('\n  '));

const { start } = await import('./src/server.js');
start();
console.log(`\n▶  Demo dashboard:  http://localhost:${PORT}/index.html   (mock ServiceTitan, live plumbing)\n`);
