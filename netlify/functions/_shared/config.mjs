// Config for the Netlify Functions backend. Secrets come from encrypted env vars.
//  ST_APP_KEY   — ServiceTitan app key (ST-App-Key header)
//  TENANTS_JSON — JSON array of { name, code, region, market, state, tenantId, clientId, clientSecret }
//  ST_ENV       — "production" (default) | "integration"
export function getConfig() {
  let tenants = [];
  try { tenants = JSON.parse(Netlify.env.get('TENANTS_JSON') || '[]'); } catch { tenants = []; }
  return {
    env: Netlify.env.get('ST_ENV') === 'integration' ? 'integration' : 'production',
    appKey: Netlify.env.get('ST_APP_KEY') || '',
    tenants,
    backfillDays: Number(Netlify.env.get('BACKFILL_DAYS') || 400),
    // Manual "Sync data" + hourly refresh recompute this many recent days for every location,
    // so a click brings Today/Week/Month/Last-Month/Quarter fully current. Year/history come
    // from the periodic full backfill (?full=1).
    refreshDays: Number(Netlify.env.get('REFRESH_DAYS') || 120),
  };
}
export const configured = (c) => !!(c.appKey && c.tenants.length);
export const publicTenant = (t) => ({ name: t.name, code: t.code || null, region: t.region || null, market: t.market || null, state: t.state || null, tenant: String(t.tenantId) });
