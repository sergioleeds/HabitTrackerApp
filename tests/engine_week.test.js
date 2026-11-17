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

// ---------- weekly-goal habits ----------
const sw = JSON.parse(JSON.stringify(st));
sw.habits.run = { id: 'run', name: 'Correr', type: 'check', unit: 'veces', order: 5, created: '2026-10-01', versions: [{ from: '2026-10', goal: 3, period: 'weekly', method: 'strict', weight: 1 }] };
sw.habits.min = { id: 'min', name: 'Bici', type: 'number', unit: 'min', order: 6, created: '2026-10-01', versions: [{ from: '2026-10', goal: 140, period: 'weekly', method: 'strict', weight: 1 }] };
const lw = (d, id, v) => { (sw.logs[d] = sw.logs[d] || {})[id] = v; };
// week 2026-11-02..08: ran 3 times (complete); week 11-09..15: ran once by Wed 11-11
lw('2026-11-02', 'run', true); lw('2026-11-04', 'run', true); lw('2026-11-07', 'run', true);
lw('2026-11-09', 'run', true); lw('2026-11-10', 'min', 30); lw('2026-11-11', 'min', 30);
let r = E.weeklyHabitWeek(sw, sw.habits.run, '2026-11-02', '2026-11-11');
eq('full week met', r.pct, 1); eq('full week total', r.total, 3);
r = E.weeklyHabitWeek(sw, sw.habits.run, '2026-11-09', '2026-11-11');
eq('mid-week pace (1 of 3*3/7)', r.pct, 1 / (3 * 3 / 7));
r = E.weeklyHabitWeek(sw, sw.habits.min, '2026-11-09', '2026-11-11');
eq('number mid-week pace', r.pct, 60 / 60);
// weekly habits stay out of the day score
eq('day score ignores weekly', E.dayScore(sw, '2026-11-09'), E.dayScore(st, '2026-11-09'));
// week stats include them, judged on pace
w = E.weekStats(sw, '2026-11-09', '2026-11-11');
const wr = w.habits.find(h => h.id === 'run');
eq('weekStats has weekly', wr ? 1 : 0, 1); eq('weekStats weekly pct', wr.pct, 7 / 9); eq('weekly period tag', wr.period === 'weekly' ? 1 : 0, 1);
// month: each day takes its week's result; a big week does not cover a missed one
const sm = JSON.parse(JSON.stringify(sw)); sm.logs = {};
const lm = (d) => { (sm.logs[d] = sm.logs[d] || {}).run = true; };
['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'].forEach(lm); // 6 runs in week of Oct 5
let mh = E.monthStats(sm, '2026-10', '2026-11-17').habits.find(h => h.id === 'run');
// Oct days: 1-4 -> week of Sep 28 (0 runs, its October days count: habit starts Oct 1 so 4 active days, pace 3*4/7) -> 0
// 5-11 -> 1; 12-18, 19-25 -> 0; 26-31 -> week of Oct 26 (0) => 7/31
eq('month = day-weighted week results', mh.pct, 7 / 31);
eq('month total', mh.total, 6);
// pendingToday: behind weekly pace
const pend = E.pendingToday(sw, '2026-11-11');
const pr = pend.find(p => p.id === 'run');
eq('pending weekly', pr && pr.kind === 'wpace' ? 1 : 0, 1);
eq('pending weekly bike on pace', pend.find(p => p.id === 'min') ? 1 : 0, 0);

// ---------- weekly/monthly goal as a daily average (basis 'avg') ----------
const sa = JSON.parse(JSON.stringify(st)); sa.logs = {};
sa.habits.zz = { id: 'zz', name: 'Sueño', type: 'number', unit: 'h', order: 7, created: '2026-10-01', versions: [{ from: '2026-10', goal: 8, period: 'weekly', method: 'strict', basis: 'avg', weight: 1 }] };
const la = (d, v) => { (sa.logs[d] = sa.logs[d] || {}).zz = v; };
la('2026-11-09', 9); la('2026-11-10', 6); la('2026-11-11', 8);   // 23 h in 3 days, goal 24
r = E.weeklyHabitWeek(sa, sa.habits.zz, '2026-11-09', '2026-11-11');
eq('avg weekly pct', r.pct, 23 / 24); eq('avg weekly avg', r.avg, 23 / 3); eq('avg weekly target', r.target, 56); eq('avg weekly pace', r.pace, 24);
w = E.weekStats(sa, '2026-11-09', '2026-11-11');
const za = w.habits.find(h => h.id === 'zz');
eq('weekStats avg basis', za.basis === 'avg' ? 1 : 0, 1); eq('weekStats avg missing', za.missing, 56 - 23);
// a long night next week does not cover this week (each week stands alone in the month)
la('2026-11-16', 16);
mh = E.monthStats(sa, '2026-11', '2026-11-17').habits.find(h => h.id === 'zz');
// Nov 1 (week of Oct 26: 0 h) 0; Nov 2-8 (0 h) 0; Nov 9-15: 23/(8*7)=0.4107; Nov 16-17 (as of 17th): 16/16=1
eq('avg month day-weighted', mh.pct, (7 * (23 / 56) + 2 * 1) / 17);
eq('avg month target', mh.target, 8 * 30);
// monthly goal as average: 8 h/day, 17 days elapsed -> pace 136
const sm2 = JSON.parse(JSON.stringify(sa)); sm2.habits.zz.versions[0].period = 'monthly';
mh = E.monthStats(sm2, '2026-11', '2026-11-17').habits.find(h => h.id === 'zz');
eq('avg monthly pct', mh.pct, 39 / 136); eq('avg monthly target', mh.target, 240);
let pm = E.pendingToday(sm2, '2026-11-17').find(p => p.id === 'zz');
eq('avg monthly pending total', pm.total, 39); eq('avg monthly pending goal is month total', pm.goal, 240);
// monthly average counts from the day the habit was created
const sm3 = JSON.parse(JSON.stringify(sm2)); sm3.habits.zz.created = '2026-11-16'; sm3.habits.zz.versions[0].from = '2026-11';
sm3.logs = {}; (sm3.logs['2026-11-16'] = {}).zz = 7; (sm3.logs['2026-11-17'] = {}).zz = 8.5;
mh = E.monthStats(sm3, '2026-11', '2026-11-17').habits.find(h => h.id === 'zz');
eq('avg monthly from creation: avg', mh.avg, 7.75); eq('avg monthly from creation: pct', mh.pct, 15.5 / 16); eq('avg monthly from creation: target', mh.target, 8 * 15);
pm = E.pendingToday(sm3, '2026-11-17').find(p => p.id === 'zz');
eq('avg monthly from creation: pending', pm ? pm.total : null, 15.5);
// default basis is still a total
const st2 = JSON.parse(JSON.stringify(sa)); delete st2.habits.zz.versions[0].basis; st2.habits.zz.versions[0].goal = 56;
eq('total basis same as avg*7', E.weeklyHabitWeek(st2, st2.habits.zz, '2026-11-09', '2026-11-11').pct, 23 / 24);

console.log(`${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
