// Scheduled hourly (30s budget) — kicks off the background sync so it can run for up to 15 min.
export default async () => {
  const base = Netlify.env.get('URL') || Netlify.env.get('DEPLOY_PRIME_URL');
  if (!base) return;
  try { await fetch(`${base}/api/sync`, { method: 'POST' }); } catch (e) { console.log('trigger failed:', e.message); }
};

export const config = { schedule: '@hourly' };
