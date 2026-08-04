import express from 'express';

/** A tiny fake ServiceTitan API for tests: token + estimates + invoices + technicians. */
export function startMockST(port = 8899) {
  const app = express();
  app.use(express.urlencoded({ extended: true }));

  app.post('/connect/token', (_req, res) => res.json({ access_token: 'mock-token', token_type: 'Bearer', expires_in: 900 }));

  const eachDay = (afterISO, beforeISO, fn) => {
    const a = new Date(afterISO), b = new Date(beforeISO || Date.now());
    for (let t = new Date(a.getFullYear(), a.getMonth(), a.getDate()); t <= b; t = new Date(t.getTime() + 86400000)) fn(t);
  };
  const seed = (s) => { let h = 1779033703 ^ s.length; for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); } let a = h >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; };
  const page = (rows, q) => { const ps = Number(q.pageSize || 500), p = Number(q.page || 1); const slice = rows.slice((p - 1) * ps, p * ps); return { page: p, pageSize: ps, hasMore: p * ps < rows.length, totalCount: rows.length, data: slice }; };

  // Stable jobId per (day, index) so the estimates and assignments endpoints agree on job ids
  // regardless of each call's date window.
  const jobIdFor = (t, i) => 1000000 + Math.round(t.getTime() / 86400000) * 100 + i;
  app.get('/sales/v2/tenant/:t/estimates', (req, res) => {
    const rows = [];
    eachDay(req.query.createdOnOrAfter, req.query.createdBefore, (t) => {
      const r = seed(req.params.t + t.toISOString().slice(0, 10));
      const n = 2 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const jid = jobIdFor(t, i);
        const iso = new Date(t.getTime() + 3600000 * (8 + i)).toISOString();
        const sold = r() < 0.4;
        // ~30% of won deals close a few days AFTER they were created (realistic sales lag),
        // so create-day and sold-day fall in different buckets — exercises the close-rate invariant.
        const lag = sold && r() < 0.3 ? (1 + Math.floor(r() * 5)) * 86400000 : 0;
        const soldOn = sold ? new Date(t.getTime() + 3600000 * (8 + i) + lag).toISOString() : null;
        // soldBy is set ONLY when sold (mirrors real ServiceTitan) — proves attribution comes
        // from assignments, not the estimate.
        rows.push({ id: jid, jobId: jid, createdOn: iso, subtotal: 1500 + Math.round(r() * 3000),
          status: { name: sold ? 'Sold' : 'Open' }, soldOn, soldBy: sold ? (101 + (jid % 3)) : null });
      }
    });
    res.json(page(rows, req.query));
  });

  app.get('/accounting/v2/tenant/:t/invoices', (req, res) => {
    const rows = []; let id = 1;
    eachDay(req.query.createdOnOrAfter || req.query.invoicedOnOrAfter, req.query.createdBefore || req.query.invoicedBefore, (t) => {
      const r = seed('inv' + req.params.t + t.toISOString().slice(0, 10));
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) rows.push({ id: id++, invoiceDate: t.toISOString(), total: 1200 + Math.round(r() * 4000) });
    });
    res.json(page(rows, req.query));
  });

  // Jobs: Completed Revenue source. Filterable by completedOn; each completed job carries a total.
  app.get('/jpm/v2/tenant/:t/jobs', (req, res) => {
    const rows = []; let id = 1;
    eachDay(req.query.completedOnOrAfter || req.query.createdOnOrAfter, req.query.completedBefore || req.query.createdBefore, (t) => {
      const r = seed('job' + req.params.t + t.toISOString().slice(0, 10));
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) rows.push({ id: id++, jobStatus: 'Completed', completedOn: t.toISOString(), total: 1200 + Math.round(r() * 4000) });
    });
    res.json(page(rows, req.query));
  });

  app.get('/settings/v2/tenant/:t/technicians', (_req, res) =>
    res.json({ page: 1, hasMore: false, data: [{ id: 101, name: 'Joshua Rivera' }, { id: 102, name: 'Freddy Martinez' }, { id: 103, name: 'Victor Galeano' }] }));

  // Appointment assignments: which tech ran each job. Every job is attributed to a tech by
  // jobId parity — independent of whether its estimate sold — so per-tech opportunities and
  // conversions diverge (the real-world case the scorecard must handle). Same seed/n and
  // jobIdFor() as the estimates route, so the job ids line up across any date window.
  const TECHS = [{ id: 101, name: 'Joshua Rivera' }, { id: 102, name: 'Freddy Martinez' }, { id: 103, name: 'Victor Galeano' }];
  app.get('/dispatch/v2/tenant/:t/appointment-assignments', (req, res) => {
    const rows = [];
    eachDay(req.query.createdOnOrAfter, req.query.createdBefore, (t) => {
      const r = seed(req.params.t + t.toISOString().slice(0, 10));
      const n = 2 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const jid = jobIdFor(t, i);
        const tech = TECHS[jid % TECHS.length];
        rows.push({ id: 900000000 + jid, technicianId: tech.id, technicianName: tech.name,
          jobId: jid, appointmentId: 500000000 + jid,
          assignedOn: new Date(t.getTime() + 3600000 * 7).toISOString(), active: true });
      }
    });
    res.json(page(rows, req.query));
  });

  return new Promise((resolve) => { const srv = app.listen(port, () => resolve(srv)); });
}
