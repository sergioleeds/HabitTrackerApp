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

// ---------- limits (dir 'max'), e.g. screen time <= 3 h ----------
const sx = { habits: {
  scr: { id: 'scr', name: 'Pantalla', type: 'number', unit: 'h', order: 1, created: '2026-10-01', versions: [{ from: '2026-10', goal: 3, period: 'daily', method: 'average', dir: 'max', weight: 1 }] },
  wk: { id: 'wk', name: 'Pantalla sem', type: 'number', unit: 'h', order: 2, created: '2026-10-01', versions: [{ from: '2026-10', goal: 21, period: 'weekly', method: 'strict', dir: 'max', weight: 1 }] },
  av: { id: 'av', name: 'Pantalla media', type: 'number', unit: 'h', order: 3, created: '2026-10-01', versions: [{ from: '2026-10', goal: 3, period: 'weekly', method: 'strict', basis: 'avg', dir: 'max', weight: 1 }] }
}, logs: {} };
const lx = (d, id, v) => { (sx.logs[d] = sx.logs[d] || {})[id] = v; };
lx('2026-11-09', 'scr', 2); lx('2026-11-10', 'scr', 6); lx('2026-11-11', 'scr', 0);   // within, double, zero
const hs = sx.habits.scr, cs = hs.versions[0];
eq('limit met under', E.met(hs, cs, 2) ? 1 : 0, 1); eq('limit met at', E.met(hs, cs, 3) ? 1 : 0, 1);
eq('limit not met over', E.met(hs, cs, 3.5) ? 1 : 0, 0); eq('limit not met unlogged', E.met(hs, cs, null) ? 1 : 0, 0);
eq('limit zero is met', E.met(hs, cs, 0) ? 1 : 0, 1);
eq('day score over is 0 (all or nothing)', E.dayScore({ habits: { scr: hs }, logs: sx.logs }, '2026-11-10'), 0);
eq('day score unlogged', E.dayScore({ habits: { scr: hs }, logs: sx.logs }, '2026-11-12'), 0);
w = E.weekStats(sx, '2026-11-09', '2026-11-11');
const ws_ = w.habits.find(h => h.id === 'scr');
eq('limit week pct = days within / days', ws_.pct, 2 / 3); eq('limit week met days', ws_.met, 2); eq('limit dir', ws_.dir === 'max' ? 1 : 0, 1);
eq('limit streak', E.habitStreak(sx, 'scr', '2026-11-11'), 1);
// weekly budget 21 h = 3 h/day, judged only on the logged days
lx('2026-11-09', 'wk', 2); lx('2026-11-10', 'wk', 3.5);   // 5.5 h in 2 logged days, 6 h allowed; Wed blank
eq('budget within (blank day not counted as 0 h)', E.weeklyHabitWeek(sx, sx.habits.wk, '2026-11-09', '2026-11-11').pct, 1);
lx('2026-11-11', 'wk', 6.5);   // 12 h in 3 days, 9 h allowed
eq('budget over', E.weeklyHabitWeek(sx, sx.habits.wk, '2026-11-09', '2026-11-11').pct, 9 / 12);
const s1 = JSON.parse(JSON.stringify(sx)); s1.logs = { '2026-11-09': { wk: 4 } };
eq('budget: one logged day over is over (was hidden by blank days before)', E.weeklyHabitWeek(s1, s1.habits.wk, '2026-11-09', '2026-11-11').pct, 3 / 4);
// weekly average limit: over logged days only
lx('2026-11-09', 'av', 2); lx('2026-11-10', 'av', 5);   // avg 3.5 over 2 logged days
r = E.weeklyHabitWeek(sx, sx.habits.av, '2026-11-09', '2026-11-11');
eq('avg limit avg', r.avg, 3.5); eq('avg limit pct', r.pct, 6 / 7);
eq('avg limit none logged', E.weeklyHabitWeek(sx, sx.habits.av, '2026-11-02', '2026-11-11').pct, null);
// month view of the daily limit: strict credit per day
mh = E.monthStats(sx, '2026-11', '2026-11-11').habits.find(h => h.id === 'scr');
eq('limit month pct = days within / days', mh.pct, 2 / 11);
// pending: only asks to log today's daily value
let px = E.pendingToday(sx, '2026-11-12');
eq('pending limit unlogged', px.filter(p => p.id === 'scr' && p.kind === 'check').length, 1);
eq('pending budgets never listed', px.filter(p => p.id !== 'scr').length, 0);
lx('2026-11-12', 'scr', 5);
eq('pending limit logged (even over)', E.pendingToday(sx, '2026-11-12').filter(p => p.id === 'scr').length, 0);

// ---------- limitStats: budget on logged days, coherence with the % ----------
{
  const L = { habits: { scr: { id: 'scr', name: 'Pantalla', type: 'number', unit: 'h', order: 1, created: '2026-10-01',
    versions: [{ from: '2026-10', goal: 3, period: 'daily', method: 'strict', dir: 'max', weight: 1 }] } }, logs: {} };
  const put = (d, v) => { (L.logs[d] = L.logs[d] || {}).scr = v; };
  put('2026-11-16', 4);                                     // Monday, 4 h, limit 3 h
  let ls = E.limitStats(L, L.habits.scr, '2026-11-16', '2026-11-22', '2026-11-16');
  eq('monday 4h limit 3h -> 1 h over', ls.diff, 1); eq('monday avg', ls.avg, 4); eq('monday over days', ls.over, 1); eq('monday within', ls.within, 0);
  put('2026-11-16', 2.5);
  ls = E.limitStats(L, L.habits.scr, '2026-11-16', '2026-11-22', '2026-11-16');
  eq('2.5h -> 0.5 h under', ls.diff, -0.5); eq('2.5h within', ls.within, 1);
  // Tuesday blank: does not count as 0 h within, and does not lower the average
  ls = E.limitStats(L, L.habits.scr, '2026-11-16', '2026-11-22', '2026-11-17');
  eq('blank day missing', ls.missing, 1); eq('blank day not within', ls.within, 1); eq('blank day days', ls.days, 2);
  eq('blank day leaves avg alone', ls.avg, 2.5); eq('blank day leaves diff alone', ls.diff, -0.5);
  eq('blank day: not met', E.met(L.habits.scr, L.habits.scr.versions[0], null) ? 1 : 0, 0);
  // the user's case: two days of 4.5 h -> 0 of 2 within must be 0 %, not 67 %
  put('2026-11-16', 4.5); put('2026-11-17', 4.5);
  const wkL = E.weekStats(L, '2026-11-16', '2026-11-17').habits[0];
  ls = E.limitStats(L, L.habits.scr, '2026-11-16', '2026-11-22', '2026-11-17');
  eq('0 of 2 within', ls.within, 0); eq('% coherent with 0 of 2', wkL.pct, 0); eq('week met = within', wkL.met, ls.within);
  eq('two days 4.5 -> 3 h over', ls.diff, 3);
  // coherence over a month with a mix
  put('2026-11-18', 2); put('2026-11-19', 3); put('2026-11-20', 1);   // 3 within
  const mL = E.monthStats(L, '2026-11', '2026-11-20').habits[0];
  ls = E.limitStats(L, L.habits.scr, '2026-11-01', '2026-11-30', '2026-11-20');
  eq('month % = within / days', mL.pct, ls.within / ls.days); eq('month within', ls.within, 3); eq('month days', ls.days, 20);
}

console.log(`${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
