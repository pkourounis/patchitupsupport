/**
 * ServiceTitan API client (OAuth 2.0 client-credentials, machine-to-machine).
 * - Tokens expire in ~15 min and are cached per clientId.
 * - Every request needs Authorization: Bearer <token> and ST-App-Key: <appKey>.
 * - GET list endpoints are paginated via { data, hasMore, page }.
 * Config-free (no Node-only imports) so it bundles into serverless functions too.
 * Docs: https://developer.servicetitan.io/docs/oauth20/
 */
const AUTH = { production: 'https://auth.servicetitan.io/connect/token', integration: 'https://auth-integration.servicetitan.io/connect/token' };
const API = { production: 'https://api.servicetitan.io', integration: 'https://api-integration.servicetitan.io' };

export class ServiceTitanClient {
  constructor({ authUrl, apiBase, appKey = '', env = 'production' } = {}) {
    const e = env === 'integration' ? 'integration' : 'production';
    this.authUrl = authUrl || AUTH[e];
    this.apiBase = apiBase || API[e];
    this.appKey = appKey;
    this._tokens = new Map(); // clientId -> { token, expiresAt }
  }

  async _token(clientId, clientSecret) {
    const cached = this._tokens.get(clientId);
    if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;

    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret });
    const res = await fetch(this.authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`ServiceTitan auth failed (${res.status}): ${await res.text()}`);
    const json = await res.json();
    const token = json.access_token;
    const ttl = (json.expires_in || 900) * 1000;
    this._tokens.set(clientId, { token, expiresAt: Date.now() + ttl });
    return token;
  }

  /** Low-level GET with retry on 401 (token refresh) and 429 (rate limit). */
  async get(tenant, urlPath, query = {}, { retries = 3 } = {}) {
    const token = await this._token(tenant.clientId, tenant.clientSecret);
    const url = new URL(`${this.apiBase}${urlPath}`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, v);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'ST-App-Key': this.appKey } });

    if (res.status === 401 && retries > 0) { this._tokens.delete(tenant.clientId); return this.get(tenant, urlPath, query, { retries: retries - 1 }); }
    if (res.status === 429 && retries > 0) {
      const wait = Number(res.headers.get('Retry-After') || 2) * 1000;
      await new Promise(r => setTimeout(r, wait));
      return this.get(tenant, urlPath, query, { retries: retries - 1 });
    }
    if (!res.ok) throw new Error(`ServiceTitan GET ${urlPath} failed (${res.status}): ${await res.text()}`);
    return res.json();
  }

  /** Fetch every page of a list endpoint and return the concatenated `data`. */
  async getAll(tenant, urlPath, query = {}, { pageSize = 500, max = 100_000 } = {}) {
    const out = [];
    let page = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const json = await this.get(tenant, urlPath, { ...query, page, pageSize });
      const rows = json.data || [];
      out.push(...rows);
      if (!json.hasMore || rows.length === 0 || out.length >= max) break;
      page += 1;
    }
    return out;
  }

  // ── Endpoint helpers (module/v2/tenant/{tenantId}/...) ─────────────────────
  estimates(tenant, q)     { return this.getAll(tenant, `/sales/v2/tenant/${tenant.tenantId}/estimates`, q); }
  invoices(tenant, q)      { return this.getAll(tenant, `/accounting/v2/tenant/${tenant.tenantId}/invoices`, q); }
  jobs(tenant, q)          { return this.getAll(tenant, `/jpm/v2/tenant/${tenant.tenantId}/jobs`, q); }
  technicians(tenant, q)   { return this.getAll(tenant, `/settings/v2/tenant/${tenant.tenantId}/technicians`, q); }
  // Who ran each job's appointment → lets us attribute an opportunity to a technician even
  // before it sells (an estimate only names a technician once it's Sold).
  assignments(tenant, q)   { return this.getAll(tenant, `/dispatch/v2/tenant/${tenant.tenantId}/appointment-assignments`, q); }
  // Appointments (for the cancellations count) and memberships (for memberships sold).
  appointments(tenant, q)  { return this.getAll(tenant, `/jpm/v2/tenant/${tenant.tenantId}/appointments`, q); }
  memberships(tenant, q)   { return this.getAll(tenant, `/memberships/v2/tenant/${tenant.tenantId}/memberships`, q); }
}
