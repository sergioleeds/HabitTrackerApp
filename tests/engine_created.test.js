// Habits created mid-month count from their first day (daily habits only).
const E = require('../app/engine.js');
let fails = 0, checks = 0;
const eq = (l, g, w, t = 1e-9) => { checks++; const ok = g === null || w === null ? g === w : Math.abs(g - w) <= t; if (!ok) { fails++; console.log('FAIL', l, g, w); } };
const today = '2026-11-20';
const mk = (o) => Object.assign({ order: 1, unit: '', archivedFrom: null }, o);
const st = { prefs: { threshold: .7 }, habits: {
  a: mk({ id: 'a', name: 'Old', type: 'check', created: '2026-10-01', versions: [{ from: '2026-10', goal: 1, period: 'daily', method: 'strict', weight: 1 }] }),
  n: mk({ id: 'n', name: 'New', type: 'check', created: '2026-11-15', versions: [{ from: '2026-11', goal: 1, period: 'daily', method: 'strict', weight: 1 }] }),
  r: mk({ id: 'r', name: 'Reps', type: 'number', created: '2026-11-15', versions: [{ from: '2026-11', goal: 50, period: 'daily', method: 'average', weight: 1 }] }),
  g: mk({ id: 'g', name: 'Gym', type: 'check', created: '2026-11-15', versions: [{ from: '2026-11', goal: 12, period: 'monthly', method: 'strict', weight: 1 }] })
}, logs: {} };
for (let d = 1; d <= 20; d++) st.logs['2026-11-' + String(d).padStart(2, '0')] = { a: true };
for (let d = 15; d <= 20; d++) { st.logs['2026-11-' + d].n = true; st.logs['2026-11-' + d].r = 50; }
const ms = E.monthStats(st, '2026-11', today), by = Object.fromEntries(ms.habits.map(h => [h.id, h]));
eq('new check: 6 of 6 days since creation', by.n.pct, 1);
eq('new number: 300/300', by.r.pct, 1);
eq('days counted', by.n.days, 6);
eq('avg per day uses days since creation', by.r.avg, 50);
eq('before creation only Old counts', E.dayScore(st, '2026-11-10'), 1);        // New/Reps absent -> 1 of 1
eq('after creation all count', E.dayScore(st, '2026-11-16'), 1);
st.logs['2026-11-16'].n = false; delete st.logs['2026-11-16'].r;
eq('weighted day after creation (Old+New fail? New missing, Reps 0)', E.dayScore(st, '2026-11-16'), 1 / 3);
// backfilled log before creation moves the start earlier
st.logs['2026-11-12'] = { a: true, n: true };
eq('backfill moves start to day 12', E.monthStats(st, '2026-11', today).habits.find(h => h.id === 'n').days, 9);
eq('Reps start unaffected (day 15)', E.monthStats(st, '2026-11', today).habits.find(h => h.id === 'r').days, 6);
// monthly habit is not shortened
eq('monthly keeps pace on whole month', by.g.pct, 0);
// pending uses the effective span
st.logs['2026-11-20'].r = 10;
const p = E.pendingToday(st, today).find(x => x.id === 'r');
eq('behind = goal*days - total (6 days, 210 done)', p.missing, 90);
console.log(`${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
