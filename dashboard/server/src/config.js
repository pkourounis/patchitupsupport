import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';

const ENV = process.env.ST_ENV === 'integration' ? 'integration' : 'production';

const DEFAULT_AUTH = ENV === 'integration'
  ? 'https://auth-integration.servicetitan.io/connect/token'
  : 'https://auth.servicetitan.io/connect/token';
const DEFAULT_API = ENV === 'integration'
  ? 'https://api-integration.servicetitan.io'
  : 'https://api.servicetitan.io';

export const config = {
  env: ENV,
  authUrl: process.env.ST_AUTH_URL || DEFAULT_AUTH,
  apiBase: process.env.ST_API_BASE || DEFAULT_API,
  appKey: process.env.ST_APP_KEY || '',
  tenantsFile: process.env.TENANTS_FILE || './tenants.json',
  port: Number(process.env.PORT || 8787),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  backfillDays: Number(process.env.BACKFILL_DAYS || 400),
  refreshDays: Number(process.env.REFRESH_DAYS || 120),
  cronEnabled: String(process.env.CRON_ENABLED || 'true') === 'true',
  dataDir: process.env.DATA_DIR || './data',
};

/** Load tenant credentials + metadata. Secrets stay server-side only. */
export function loadTenants() {
  const file = path.resolve(config.tenantsFile);
  if (!fs.existsSync(file)) {
    throw new Error(`tenants file not found at ${file} — copy tenants.example.json to tenants.json and fill in real credentials.`);
  }
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(list) || !list.length) throw new Error('tenants file must be a non-empty JSON array');
  for (const t of list) {
    for (const k of ['name', 'tenantId', 'clientId', 'clientSecret']) {
      if (!t[k]) throw new Error(`tenant "${t.name || '?'}" is missing required field "${k}"`);
    }
  }
  return list;
}

/** Public metadata for a tenant — never includes secrets. */
export function publicTenant(t) {
  return { name: t.name, code: t.code || null, region: t.region || null, market: t.market || null, state: t.state || null, tenant: String(t.tenantId) };
}
