import { seriesArray } from './_shared/blobStore.mjs';

export default async (_req, context) => Response.json(await seriesArray(context.params.tenant));

export const config = { path: '/api/locations/:tenant/daily' };
