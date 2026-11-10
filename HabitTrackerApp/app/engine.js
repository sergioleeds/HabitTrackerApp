/* Habit engine: pure calculation rules, no DOM, no storage.
 * Same rules as HabitTracker_v2.gs:
 *  - Daily habits feed the day score (weighted). Monthly habits are judged against a pace.
 *  - Numbers: "strict" caps each day at the goal, "average" lets a big day cover missed ones.
 *  - Streaks: day score >= threshold (overall) or goal met (per habit); today may still be open.
 * Dates are 'YYYY-MM-DD' strings, months are 'YYYY-MM'. Works in browser, Node and Apps Script. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HabitEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 86400000;

  // ---------- dates ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function parse(d) { var p = d.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function fmt(ms) { var x = new Date(ms); return x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate()); }
  function addDays(d, n) { return fmt(parse(d) + n * DAY); }
  function monthKey(d) { return d.slice(0, 7); }
  function addMonths(k, n) {
    var y = +k.slice(0, 4), m = +k.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + pad(m + 1);
  }
  function daysInMonth(k) { return new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7), 0)).getUTCDate(); }
  function monthStart(k) { return k + '-01'; }
  function monthEnd(k) { return k + '-' + pad(daysInMonth(k)); }
  function localToday(now) { // local calendar date of a JS Date
    now = now || new Date();
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  }
  function monthsBetween(a, b) { // inclusive list
    var out = [], k = a, guard = 0;
    while (k <= b && guard++ < 1200) { out.push(k); k = addMonths(k, 1); }
    return out;
  }
  function weekday(d) { return new Date(parse(d)).getUTCDay(); } // 0=Sun

  // ---------- habit config by month ----------
  /** Config of a habit in a month, or null if it does not exist then. */
  function cfgFor(h, mk) {
    if (!h || !h.versions || !h.versions.length) return null;
    if (h.archivedFrom && mk >= h.archivedFrom) return null;
    var c = null;
    for (var i = 0; i < h.versions.length; i++) {
      if (h.versions[i].from <= mk && (!c || h.versions[i].from >= c.from)) c = h.versions[i];
    }
    return c; // null when the month is before the first version
  }
  function sortedHabits(state) {
    var arr = [];
    for (var id in state.habits) if (state.habits.hasOwnProperty(id) && state.habits[id]) arr.push(state.habits[id]);
    arr.sort(function (a, b) { return (a.order - b.order) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
    return arr;
  }
  function activeIn(state, mk) {
    var out = [];
    sortedHabits(state).forEach(function (h) {
      var c = cfgFor(h, mk);
      if (c) out.push({ h: h, c: c });
    });
    return out;
  }
  function firstMonth(state) {
    var f = null;
    sortedHabits(state).forEach(function (h) {
      (h.versions || []).forEach(function (v) { if (!f || v.from < f) f = v.from; });
    });
    return f;
  }

  // ---------- values ----------
  function val(state, d, id) {
    var day = state.logs[d];
    return day && day[id] !== undefined ? day[id] : null;
  }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }
  /** Did the habit meet its goal that day (daily habits only)? */
  function met(h, c, v) {
    if (h.type === 'check') return v === true;
    return num(v) >= c.goal;
  }
  function fraction(h, c, v) { // 0..1 credit for the day score
    if (h.type === 'check') return v === true ? 1 : 0;
    return c.goal > 0 ? Math.min(1, num(v) / c.goal) : 0;
  }

  /** First day of the month a daily habit counts from: the day it was created (or an earlier day you logged). */
  function startDay(state, h, mk) {
    if (!h.created || monthKey(h.created) !== mk) return 1;
    var s = +h.created.slice(8, 10);
    for (var i = 1; i < s; i++) if (val(state, mk + '-' + pad(i), h.id) !== null) return i;
    return s;
  }

  // ---------- day score ----------
  /** Weighted completion of the daily habits on a date. null when there are none. */
  function dayScore(state, d) {
    var mk = monthKey(d), num_ = 0, den = 0;
    activeIn(state, mk).forEach(function (a) {
      if (a.c.period !== 'daily') return;
      if (+d.slice(8, 10) < startDay(state, a.h, mk)) return;     // habit did not exist yet that day
      var w = +a.c.weight || 0;
      den += w;
      num_ += w * fraction(a.h, a.c, val(state, d, a.h.id));
    });
    return den > 0 ? num_ / den : null;
  }

  // ---------- month stats ----------
  function elapsedDays(mk, today) {
    var dim = daysInMonth(mk);
    if (today < monthStart(mk)) return 0;
    if (today > monthEnd(mk)) return dim;
    return +today.slice(8, 10);
  }

  function habitMonth(state, a, mk, today) {
    var h = a.h, c = a.c, dim = daysInMonth(mk), el = elapsedDays(mk, today), i, d, v;
    var sd = c.period === 'daily' ? startDay(state, h, mk) : 1;       // daily habits count from their first day
    var el2 = Math.max(0, el - sd + 1), dim2 = dim - sd + 1;
    var tot = 0, capped = 0;
    for (i = 1; i <= dim; i++) {
      d = mk + '-' + pad(i); v = val(state, d, h.id);
      if (h.type === 'check') { if (v === true) tot += 1; }
      else {
        tot += num(v);
        if (i >= sd && i <= el) capped += Math.min(num(v), c.goal);
      }
    }
    var pct = null, target;
    if (c.period === 'monthly') {
      target = c.goal;
      if (el > 0) pct = Math.min(1, tot / (c.goal * el / dim));
    } else if (h.type === 'check') {
      target = dim2;
      if (el2 > 0) pct = Math.min(1, tot / el2);
    } else {
      target = c.goal * dim2;
      if (el2 > 0) {
        if (c.method === 'average') pct = Math.min(1, tot / (c.goal * el2));
        else pct = capped / (c.goal * el2);
      }
    }
    var span = c.period === 'daily' ? el2 : el;
    return {
      id: h.id, name: h.name, type: h.type, unit: h.unit || '', goal: c.goal, period: c.period,
      method: c.method, weight: c.weight, total: tot, target: target, pct: pct,
      avg: span > 0 ? tot / span : 0, days: span
    };
  }

  /** Everything about one month. `today` lets past/future months behave. */
  function monthStats(state, mk, today) {
    var dim = daysInMonth(mk), el = elapsedDays(mk, today), i;
    var act = activeIn(state, mk);
    var habits = act.map(function (a) { return habitMonth(state, a, mk, today); });
    var sw = 0, sp = 0;
    habits.forEach(function (x) { if (x.pct !== null) { sw += x.weight; sp += x.weight * x.pct; } });
    var days = [];
    for (i = 1; i <= dim; i++) {
      var d = mk + '-' + pad(i);
      days.push({ date: d, day: i, score: d <= today ? dayScore(state, d) : null, future: d > today });
    }
    return { key: mk, dim: dim, elapsed: el, habits: habits, weighted: sw > 0 ? sp / sw : null, days: days };
  }

  // ---------- streaks ----------
  function dayOk(state, d, threshold) {
    var s = dayScore(state, d);
    return s !== null && s >= threshold - 1e-12;
  }
  function habitDayOk(state, h, d) {
    var c = cfgFor(h, monthKey(d));
    if (!c || c.period !== 'daily') return false;
    return met(h, c, val(state, d, h.id));
  }
  function walkBack(today, okFn, floor) {
    // Count consecutive ok days ending today; if today is still open start from yesterday.
    var d = today, n = 0, guard = 0;
    if (!okFn(d)) d = addDays(d, -1);
    while (d >= floor && okFn(d) && guard++ < 4000) { n++; d = addDays(d, -1); }
    return n;
  }
  function overallStreak(state, today, threshold) {
    var f = firstMonth(state);
    if (!f) return 0;
    return walkBack(today, function (d) { return dayOk(state, d, threshold); }, monthStart(f));
  }
  function habitStreak(state, id, today) {
    var h = state.habits[id];
    if (!h) return 0;
    var f = h.versions && h.versions.length ? h.versions[0].from : null;
    for (var i = 1; h.versions && i < h.versions.length; i++) if (h.versions[i].from < f) f = h.versions[i].from;
    if (!f) return 0;
    return walkBack(today, function (d) { return habitDayOk(state, h, d); }, monthStart(f));
  }
  /** Overall streak value on a specific past date (consecutive ok days ending that date). */
  function overallStreakAt(state, d, threshold) {
    var f = firstMonth(state);
    if (!f) return 0;
    var n = 0, x = d, g = 0;
    while (x >= monthStart(f) && dayOk(state, x, threshold) && g++ < 4000) { n++; x = addDays(x, -1); }
    return n;
  }
  function habitStreakAt(state, id, d) {
    var h = state.habits[id], n = 0, x = d, g = 0;
    if (!h) return 0;
    while (g++ < 4000 && habitDayOk(state, h, x)) { n++; x = addDays(x, -1); }
    return n;
  }

  // ---------- periods ----------
  /** Resolve a named period to [fromKey, toKey]. */
  function periodRange(state, period, today, chosen) {
    var cur = monthKey(today), first = firstMonth(state) || cur;
    switch (period) {
      case 'prev': return [addMonths(cur, -1), addMonths(cur, -1)];
      case '3': return [addMonths(cur, -2), cur];
      case '6': return [addMonths(cur, -5), cur];
      case '12': return [addMonths(cur, -11), cur];
      case 'year': return [cur.slice(0, 4) + '-01', cur];
      case 'month': return [chosen || cur, chosen || cur];
      case 'all': return [first, cur];
      default: return [cur, cur];
    }
  }

  /** A month counts only if something was logged in it (like months that have a tab in the sheet) or it is the current one. */
  function hasLogs(state, mk) {
    for (var d in state.logs) {
      if (d.slice(0, 7) !== mk) continue;
      var day = state.logs[d];
      for (var id in day) if (day[id] !== null && day[id] !== undefined) return true;
    }
    return false;
  }

  /** Aggregate months in [from,to]. Months with no elapsed days, no habits or no logs are skipped. */
  function periodStats(state, from, to, today, threshold) {
    var months = [], included = [];
    monthsBetween(from, to).forEach(function (mk) {
      var ms = monthStats(state, mk, today);
      months.push(ms);
      if (ms.elapsed > 0 && ms.habits.length && ms.weighted !== null && (mk === monthKey(today) || hasLogs(state, mk))) included.push(ms);
    });
    var overall = included.length ? included.reduce(function (s, m) { return s + m.weighted; }, 0) / included.length : null;
    var per = {}, order = [];
    included.forEach(function (m) {
      m.habits.forEach(function (x) {
        if (!per[x.id]) { per[x.id] = { id: x.id, name: x.name, type: x.type, unit: x.unit, sum: 0, n: 0, total: 0, days: 0, weight: x.weight, period: x.period }; order.push(x.id); }
        var p = per[x.id];
        p.name = x.name; p.unit = x.unit; p.weight = x.weight; p.period = x.period;
        if (x.pct !== null) { p.sum += x.pct; p.n++; }
        p.total += x.total; p.days += x.days;
      });
    });
    var habits = order.map(function (id) {
      var p = per[id];
      return {
        id: id, name: p.name, type: p.type, unit: p.unit, weight: p.weight, period: p.period,
        pct: p.n ? p.sum / p.n : null, total: p.total, avg: p.days ? p.total / p.days : 0,
        streak: habitStreak(state, id, today)
      };
    });
    var ranked = habits.filter(function (x) { return x.pct !== null; })
      .sort(function (a, b) { return b.pct - a.pct; });
    return {
      from: from, to: to, months: months, included: included.length, overall: overall,
      habits: habits, top: ranked.slice(0, 3), streak: overallStreak(state, today, threshold)
    };
  }

  // ---------- today's to-do (also used by the reminder) ----------
  /** What is still pending today, as plain items. */
  function pendingToday(state, today) {
    var mk = monthKey(today), out = [];
    activeIn(state, mk).forEach(function (a) {
      var hm = habitMonth(state, a, mk, today), v = val(state, today, a.h.id);
      if (a.c.period === 'monthly') {
        var pace = a.c.goal * elapsedDays(mk, today) / daysInMonth(mk);
        if (hm.total < pace - 1e-9) out.push({ id: a.h.id, name: a.h.name, kind: 'pace', total: hm.total, goal: a.c.goal, unit: a.h.unit || '' });
      } else if (a.h.type === 'check') {
        if (v !== true) out.push({ id: a.h.id, name: a.h.name, kind: 'check' });
      } else if (a.c.method === 'average') {
        var missing = a.c.goal * hm.days - hm.total;
        if (missing > 1e-9) out.push({ id: a.h.id, name: a.h.name, kind: 'behind', missing: Math.round(missing * 100) / 100, unit: a.h.unit || '' });
      } else if (num(v) < a.c.goal) {
        out.push({ id: a.h.id, name: a.h.name, kind: 'number', value: num(v), goal: a.c.goal, unit: a.h.unit || '' });
      }
    });
    return out;
  }

  /** Sensible stepper size for a number habit. */
  function stepFor(goal) {
    if (goal >= 5000) return 500;
    if (goal >= 500) return 50;
    if (goal >= 50) return 5;
    if (goal >= 10) return 1;
    return 0.5;
  }

  /** Round to avoid 0.1+0.2 noise in stored numbers. */
  function clean(x) { return Math.round(x * 1000) / 1000; }

  return {
    pad: pad, addDays: addDays, monthKey: monthKey, addMonths: addMonths, daysInMonth: daysInMonth,
    monthStart: monthStart, monthEnd: monthEnd, localToday: localToday, monthsBetween: monthsBetween,
    weekday: weekday, cfgFor: cfgFor, sortedHabits: sortedHabits, activeIn: activeIn, firstMonth: firstMonth,
    dayScore: dayScore, monthStats: monthStats, elapsedDays: elapsedDays,
    overallStreak: overallStreak, habitStreak: habitStreak, overallStreakAt: overallStreakAt, habitStreakAt: habitStreakAt,
    periodRange: periodRange, periodStats: periodStats, pendingToday: pendingToday, stepFor: stepFor, clean: clean,
    val: val, met: met, hasLogs: hasLogs, startDay: startDay
  };
});
