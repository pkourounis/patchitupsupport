// Diagnostic: returns a few RAW estimate fields for one tenant so we can confirm the
// real ServiceTitan shape (status / soldOn) — no customer PII, just sales-status fields.
//   GET /api/debug/<tenantId>
import { getConfig, configured } from './_shared/config.mjs';
import { ServiceTitanClient } from '../../dashboard/server/src/servicetitan.js';

export default async (_req, context) => {
  const c = getConfig();
  if (!configured(c)) return Response.json({ error: 'not configured' });
  const t = c.tenants.find((x) => String(x.tenantId) === context.params.tenant) || c.tenants[0];
  if (!t) return Response.json({ error: 'no tenant' });

  const client = new ServiceTitanClient({ env: c.env, appKey: c.appKey });
  const tenant = { tenantId: String(t.tenantId), clientId: t.clientId, clientSecret: t.clientSecret };
  const to = new Date(), from = new Date(to.getTime() - 60 * 86400000);
  try {
    const json = await client.get(tenant, `/sales/v2/tenant/${tenant.tenantId}/estimates`,
      { createdOnOrAfter: from.toISOString(), createdBefore: to.toISOString(), page: 1, pageSize: 8 });
    const rows = json.data || [];
    const soldByStatus = rows.filter((e) => (typeof e.status === 'string' ? e.status : e.status?.name) === 'Sold').length;
    const soldByDate = rows.filter((e) => e.soldOn && new Date(e.soldOn).getUTCFullYear() > 1900).length;
    const sample = rows.slice(0, 6).map((e) => ({
      id: e.id, jobId: e.jobId, status: e.status, soldOn: e.soldOn, soldDate: e.soldDate,
      soldById: e.soldById, subtotal: e.subtotal, total: e.total, createdOn: e.createdOn, modifiedOn: e.modifiedOn,
    }));
    return Response.json({ tenant: t.name, totalOnPage: rows.length, soldByStatus, soldByDate, sample });
  } catch (e) {
    return Response.json({ tenant: t.name, error: String(e.message || e) });
  }
};

export const config = { path: '/api/debug/:tenant' };
