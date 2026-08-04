import { readSnapshot } from './_shared/blobStore.mjs';

// Per-day-per-technician breakdown so the dashboard can total any date range.
export default async (_req, context) => {
  const s = await readSnapshot(context.params.tenant);
  return Response.json({ roster: s.techRoster || {}, daily: s.techDaily || {} });
};

export const config = { path: '/api/locations/:tenant/tech-daily' };
