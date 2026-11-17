// Weekly stats: Monday-Sunday, same rules as months (strict caps each day, average lets big days cover short ones).
const E = require('../app/engine.js');
let fails = 0, checks = 0;
function eq(label, got, want, tol = 1e-9) {
  checks++;
  const ok = (got === null || want === null) ? got === want : Math.abs(got - want) <= tol;
  if (!ok) { fails++; console.log('FAIL', label, 'got', got, 'want', want); }
}
const st = {
  habits: {
    sleep: { id: 'sleep', name: 'Dormir', type: 'number', unit: 'h', order: 1, created: '2026-10-01', versions: [{ from: '2026-10', goal: 8, period: 'daily', method: 'average', weight: 1 }] },
    read: { id: 'read', name: 'Leer', type: 'check', order: 2, created: '2026-10-01', versions: [{ from: '2026-10', goal: 1, period: 'daily', method: 'strict', weight: 1 }] },
    push: { id: 'push', name: 'Flexiones', type: 'number', order: 3, created: '2026-10-01', versions: [{ from: '2026-10', goal: 20, period: 'daily', method: 'strict', weight: 2 }] },
    gym: { id: 'gym', name: 'Gimnasio', type: 'check', order: 4, created: '2026-10-01', versions: [{ from: '2026-10', goal: 12, period: 'monthly', method: 'strict', weight: 1 }] }
  },
  logs: {}
};
const log = (d, id, v) => { (st.logs[d] = st.logs[d] || {})[id] = v; };
// Week Mon 2026-11-09 .. Sun 11-15, today Wed 11-11 (3 days elapsed)
log('2026-11-09', 'sleep', 7); log('2026-11-10', 'sleep', 9); log('2026-11-11', 'sleep', 6);
log('2026-11-09', 'read', true); log('2026-11-11', 'read', true);
log('2026-11-09', 'push', 30); log('2026-11-10', 'push', 10);
log('2026-11-10', 'gym', true);

eq('weekStart Wed', E.weekStart('2026-11-11') === '2026-11-09' ? 1 : 0, 1);
eq('weekStart Sun', E.weekStart('2026-11-15') === '2026-11-09' ? 1 : 0, 1);
eq('weekStart Mon', E.weekStart('2026-11-09') === '2026-11-09' ? 1 : 0, 1);

let w = E.weekStats(st, '2026-11-11', '2026-11-11');
const by = Object.fromEntries(w.habits.map(h => [h.id, h]));
eq('elapsed', w.elapsed, 3);
eq('monthly habit excluded', by.gym ? 1 : 0, 0);
eq('sleep avg pct', by.sleep.pct, 22 / 24);
eq('sleep avg', by.sleep.avg, 22 / 3);
eq('sleep missing', by.sleep.missing, 2);
eq('sleep met days', by.sleep.met, 1);
eq('read pct', by.read.pct, 2 / 3);
eq('push strict pct', by.push.pct, (20 + 10 + 0) / 60);
eq('weighted', w.weighted, (22 / 24 + 2 / 3 + 2 * 0.5) / 4);
eq('future day has no score', w.days[3].score, null);

// Week spanning months, goal change from November: Mon 2026-10-26 .. Sun 11-01
const s2 = JSON.parse(JSON.stringify(st));
s2.habits.sleep.versions.push({ from: '2026-11', goal: 7, period: 'daily', method: 'average', weight: 1 });
for (let i = 0; i < 7; i++) { const d = E.addDays('2026-10-26', i); (s2.logs[d] = s2.logs[d] || {}).sleep = 7; }
w = E.weekStats(s2, '2026-10-26', '2026-11-17');
const sl = w.habits.find(h => h.id === 'sleep');
eq('span target uses each month goal', sl.target, 6 * 8 + 7);
eq('span pct', sl.pct, 49 / 55);
eq('span met days (only Nov 1)', sl.met, 1);

// Habit created mid-week counts from its first day
const s3 = JSON.parse(JSON.stringify(st));
s3.habits.read.created = '2026-11-11'; s3.habits.read.versions[0].from = '2026-11'; delete s3.logs['2026-11-09'].read;
w = E.weekStats(s3, '2026-11-09', '2026-11-11');
eq('created mid-week days', w.habits.find(h => h.id === 'read').days, 1);
eq('created mid-week pct', w.habits.find(h => h.id === 'read').pct, 1);

// Future week: nothing elapsed
w = E.weekStats(st, '2026-11-16', '2026-11-11');
eq('future week elapsed', w.elapsed, 0); eq('future week weighted', w.weighted, null);

console.log(`${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
