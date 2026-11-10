const E = require('../app/engine.js');
const fx = require('./fixture.json');
const { state, today, threshold: THR, exp } = fx;
let fails = 0, checks = 0;
function eq(label, got, want, tol = 1e-9) {
  checks++;
  const ok = (got === null || want === null) ? got === want : Math.abs(got - want) <= tol;
  if (!ok) { fails++; if (fails < 25) console.log('FAIL', label, 'got', got, 'want', want); }
}

for (const mk of Object.keys(exp)) {
  const e = exp[mk], ms = E.monthStats(state, mk, today);
  eq(mk + ' dim', ms.dim, e.dim); eq(mk + ' elapsed', ms.elapsed, e.elapsed);
  eq(mk + ' weighted', ms.weighted, e.pond);
  for (const h of ms.habits) {
    eq(`${mk} ${h.id} total`, h.total, e.tot[h.id], 1e-7);
    eq(`${mk} ${h.id} pct`, h.pct, e.pct[h.id], 1e-9);
  }
  for (let d = 1; d <= e.elapsed; d++) {
    const date = mk + '-' + String(d).padStart(2, '0');
    eq(`${mk} day ${d} score`, E.dayScore(state, date), e.day[d]);
    eq(`${mk} day ${d} streak`, E.overallStreakAt(state, date, THR), e.streak[d]);
    for (const id of Object.keys(e.slot_streak)) {
      const got = E.habitStreakAt(state, id, date), ref = e.slot_streak[id][d];
      // sheet restarts per-habit streaks each month; the app counts across months (>= ref, equal when it does not touch day 1)
      if (ref < d) eq(`${mk} ${id} d${d} slot streak`, got, ref); else { checks++; if (got < ref) { fails++; console.log('FAIL slot>=', mk, id, d, got, ref); } }
    }
  }
}

// period aggregation: average of monthly weighted values over months that have logs
const months = Object.keys(exp);
const avg = (keys) => keys.reduce((s, k) => s + exp[k].pond, 0) / keys.length;
let ps = E.periodStats(state, ...E.periodRange(state, 'all', today), today, THR);
eq('all overall', ps.overall, avg(months)); eq('all included', ps.included, 4);
ps = E.periodStats(state, ...E.periodRange(state, '3', today), today, THR);
eq('3m overall (Aug-Oct, Jul has no logs)', ps.overall, avg(['2026-08', '2026-09', '2026-10'])); eq('3m included', ps.included, 3);
ps = E.periodStats(state, ...E.periodRange(state, 'month', today, '2026-09'), today, THR);
eq('chosen month', ps.overall, exp['2026-09'].pond);
ps = E.periodStats(state, ...E.periodRange(state, 'prev', today), today, THR);
eq('prev month', ps.overall, exp['2026-09'].pond);
ps = E.periodStats(state, ...E.periodRange(state, 'year', today), today, THR);
eq('year', ps.overall, avg(months));
// per-habit period pct = mean of monthly pct
ps = E.periodStats(state, ...E.periodRange(state, 'all', today), today, THR);
for (const h of ps.habits) {
  const vals = months.map(k => exp[k].pct[h.id]).filter(v => v !== null && v !== undefined);
  eq('all pct ' + h.id, h.pct, vals.reduce((a, b) => a + b, 0) / vals.length);
}
// top 3 sorted desc
const t = ps.top.map(x => x.pct); eq('top sorted', t[0] >= t[1] && t[1] >= t[2] ? 1 : 0, 1);

// streak today-or-yesterday grace: today open does not break the streak
const s2 = JSON.parse(JSON.stringify(state)); delete s2.logs[today];
const yesterday = E.addDays(today, -1);
eq('streak grace', E.overallStreak(s2, today, THR), E.overallStreakAt(s2, yesterday, THR));

// versioned config: changing goal from Nov does not alter Oct
const s3 = JSON.parse(JSON.stringify(state)); s3.habits.s9.versions.push({ from: '2026-11', goal: 1, period: 'daily', method: 'strict', weight: 1 });
eq('old month unchanged', E.monthStats(s3, '2026-10', today).weighted, exp['2026-10'].pond);
// archived: gone from archive month, kept before
s3.habits.s9.archivedFrom = '2026-10';
eq('archived keeps past', E.monthStats(s3, '2026-09', today).habits.filter(h => h.id === 's9').length, 1);
eq('archived hides', E.monthStats(s3, '2026-10', today).habits.filter(h => h.id === 's9').length, 0);

// dates
eq('addDays', E.addDays('2026-03-01', -1) === '2026-02-28' ? 1 : 0, 1);
eq('addMonths', E.addMonths('2026-01', -2) === '2025-11' ? 1 : 0, 1);
eq('leap', E.daysInMonth('2028-02'), 29);
console.log(`${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
