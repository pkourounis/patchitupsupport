import { readSnapshot } from './_shared/blobStore.mjs';

export default async (_req, context) => Response.json((await readSnapshot(context.params.tenant)).technicians || []);

export const config = { path: '/api/locations/:tenant/technicians' };
