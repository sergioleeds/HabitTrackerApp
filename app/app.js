/* Habit tracker UI. Vanilla JS, no build step, no network needed. */
(function () {
  'use strict';
  var E = HabitEngine, S = Store, C = Charts;

  // ---------- helpers ----------
  function $(sel, el) { return (el || document).querySelector(sel); }
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { add(el, x); });
    else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  function icon(name) {
    var paths = {
      check: 'M5 12.5l4.5 4.5L19 7.5', left: 'M14.5 6l-6 6 6 6', right: 'M9.5 6l6 6-6 6', plus: 'M12 5v14M5 12h14', minus: 'M5 12h14',
      today: 'M12 7v5l3 2', up: 'M6 14l6-6 6 6', down: 'M6 10l6 6 6-6', edit: 'M4 20h4l10-10-4-4L4 16v4z'
    };
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'ico'); svg.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', paths[name]); svg.appendChild(p);
    return svg;
  }
  var lang = 'es', locale = 'es-ES';
  function t(k, p) {
    var s = (I18N[lang] && I18N[lang][k]) || I18N.es[k] || k;
    if (p) Object.keys(p).forEach(function (x) { s = s.split('{' + x + '}').join(p[x]); });
    return s;
  }
  function nf(x) { return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(x); }
  function pc(x) { return x === null || x === undefined ? '–' : Math.round(x * 100) + '%'; }
  function dfmt(date, opts) { var p = date.split('-'); return new Intl.DateTimeFormat(locale, Object.assign({ timeZone: 'UTC' }, opts)).format(new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]))); }
  function mfmt(mk, opts) { return dfmt(mk + '-01', opts || { month: 'long', year: 'numeric' }); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function newId() { return 'h' + Math.random().toString(36).slice(2, 9); }

  var ui = { tab: 'today', date: null, month: null, period: '3', habit: 'all', chosen: null, tables: {}, editing: null };
  var draws = [], today = E.localToday();
  var view, tip, toastEl, installEvt = null;

  // ---------- toast / tooltip ----------
  var toastTimer;
  function toast(msg, actionLabel, action) {
    clearTimeout(toastTimer);
    toastEl.innerHTML = ''; toastEl.appendChild(h('span', { text: msg }));
    if (actionLabel) toastEl.appendChild(h('button', { class: 'toast-act', text: actionLabel, onclick: function () { toastEl.classList.remove('on'); action && action(); } }));
    toastEl.classList.add('on');
    toastTimer = setTimeout(function () { toastEl.classList.remove('on'); }, actionLabel ? 9000 : 2600);
  }
  var tipTimer;
  function showTip(target, x, y) {
    var txt = target.getAttribute('data-tip');
    if (!txt) return;
    tip.textContent = txt; tip.classList.add('on');
    var w = tip.offsetWidth, hh = tip.offsetHeight, vw = document.documentElement.clientWidth;
    var left = Math.max(8, Math.min(vw - w - 8, x - w / 2)), top = y - hh - 14;
    if (top < 8) top = y + 18;
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  }
  function hideTip() { tip.classList.remove('on'); }

  // ---------- data shortcuts ----------
  function thr() { return S.state().prefs.threshold; }
  function streakWord(n) { return t(n === 1 ? 'dayOne' : 'dayMany', { n: n }); }

  // ---------- TODAY ----------
  function viewToday() {
    var st = S.state(), date = ui.date || today, mk = E.monthKey(date);
    var isToday = date === today, ms = E.monthStats(st, mk, today), by = {};
    ms.habits.forEach(function (x) { by[x.id] = x; });
    var act = E.activeIn(st, mk);
    var score = E.dayScore(st, date);
    var streak = E.overallStreak(st, today, thr());
    var daily = act.filter(function (a) { return a.c.period === 'daily'; });
    var doneN = daily.filter(function (a) { return E.met(a.h, a.c, E.val(st, date, a.h.id)); }).length;

    var root = h('div', { class: 'page' });
    root.appendChild(h('div', { class: 'datebar' },
      h('button', { class: 'iconbtn', 'aria-label': t('prevDay'), onclick: function () { ui.date = E.addDays(date, -1); render(); } }, icon('left')),
      h('div', { class: 'datetitle' },
        h('h1', { text: cap(dfmt(date, { weekday: 'long' })) }),
        h('div', { class: 'datesub' }, dfmt(date, { day: 'numeric', month: 'long', year: 'numeric' }),
          isToday ? h('span', { class: 'chip', text: t('todayChip') }) : h('button', { class: 'chip link', text: t('backToday'), onclick: function () { ui.date = null; render(); } }))),
      h('button', { class: 'iconbtn', 'aria-label': t('nextDay'), disabled: date >= today, onclick: function () { ui.date = E.addDays(date, 1); render(); } }, icon('right'))));

    if (!act.length) {
      root.appendChild(emptyState());
      return root;
    }

    var ringBox = h('div', { class: 'ring' }); ringBox.innerHTML = C.ring(score, 92, t('dayScore') + ' ' + pc(score));
    root.appendChild(h('section', { class: 'summary' }, ringBox,
      h('div', { class: 'facts' },
        h('div', { class: 'fact-big' }, score === 1 ? t('dayComplete') : t('doneOf', { a: doneN, b: daily.length })),
        h('div', { class: 'fact' }, t('streakLabel') + ': ', h('strong', { text: streakWord(streak) })),
        h('div', { class: 'fact muted' }, t('monthSoFar') + ': ', h('strong', { text: pc(ms.weighted) })))));

    var dailyRows = act.filter(function (a) { return a.c.period === 'daily'; });
    var monthRows = act.filter(function (a) { return a.c.period === 'monthly'; });
    if (dailyRows.length) {
      root.appendChild(h('h2', { class: 'sect', text: t('daily') }));
      root.appendChild(h('div', { class: 'list' }, dailyRows.map(function (a) { return habitRow(a, date, by[a.h.id], mk); })));
    }
    if (monthRows.length) {
      root.appendChild(h('h2', { class: 'sect', text: t('monthly') }));
      root.appendChild(h('div', { class: 'list' }, monthRows.map(function (a) { return habitRow(a, date, by[a.h.id], mk); })));
    }
    return root;
  }

  function emptyState() {
    return h('section', { class: 'empty' },
      h('h2', { text: t('emptyTitle') }),
      h('p', { text: t('emptyBody') }),
      h('div', { class: 'btnrow' },
        h('button', { class: 'btn primary', text: t('addHabit'), onclick: function () { ui.tab = 'habits'; render(); openEditor(null); } }),
        h('button', { class: 'btn', text: t('loadExamples'), onclick: loadExamples })));
  }

  function habitRow(a, date, bm, mk) {
    var st = S.state(), hb = a.h, c = a.c, v = E.val(st, date, hb.id), id = hb.id;
    var isCur = mk === E.monthKey(today);
    if (hb.type === 'check') {
      var on = v === true, sub = '';
      if (c.period === 'monthly') sub = nf(bm.total) + ' / ' + nf(c.goal) + (hb.unit ? ' ' + hb.unit : '') + ' ' + t('thisMonth');
      else { var sk = E.habitStreak(st, id, today); if (sk >= 2 && date === today) sub = t('streakShort', { n: sk }); }
      return h('button', {
        class: 'row check' + (on ? ' on' : ''), role: 'checkbox', 'aria-checked': on ? 'true' : 'false',
        onclick: function () { S.setLog(date, id, on ? null : true); }
      },
        h('span', { class: 'box' }, icon('check')),
        h('span', { class: 'rtext' }, h('span', { class: 'rname', text: hb.name }), sub ? h('span', { class: 'rsub', text: sub }) : null),
        monthBadge(c, bm, isCur));
    }
    // number
    var x = typeof v === 'number' ? v : 0, step = hb.step || E.stepFor(c.goal);
    var fill = c.period === 'daily' ? Math.min(1, x / c.goal) : (bm.pct === null ? 0 : bm.pct);
    var sub2 = '';
    if (c.period === 'monthly') sub2 = nf(bm.total) + ' / ' + nf(c.goal) + (hb.unit ? ' ' + hb.unit : '') + ' ' + t('thisMonth');
    else if (c.method === 'average' && isCur) {
      var miss = c.goal * E.elapsedDays(mk, today) - bm.total;
      sub2 = miss > 0.0001 ? t('behind', { n: nf(Math.round(miss * 100) / 100), u: hb.unit || '' }) : t('onTrack');
    } else if (E.met(hb, c, v)) sub2 = t('goalMet');
    var unitTxt = hb.unit ? ' ' + hb.unit : '';
    var valBtn = h('button', { class: 'val', 'aria-label': t('editValue', { name: hb.name }), onclick: function (ev) { editValue(ev.currentTarget, date, id, x); } }, nf(x) + unitTxt);
    return h('div', { class: 'row num' + (E.met(hb, c, v) && c.period === 'daily' ? ' met' : ''), style: '--fill:' + Math.round(fill * 100) + '%' },
      h('div', { class: 'ntop' },
        h('div', { class: 'rtext' }, h('span', { class: 'rname', text: hb.name }), sub2 ? h('span', { class: 'rsub', text: sub2 }) : null),
        c.period === 'daily' ? h('span', { class: 'ngoal', text: t('ofGoal', { n: nf(c.goal) + unitTxt }) }) : null),
      h('div', { class: 'stepper' },
        h('button', { class: 'step', 'aria-label': t('minus', { name: hb.name }), disabled: x <= 0, onclick: function () { S.setLog(date, id, Math.max(0, E.clean(x - step)) || null); } }, icon('minus')),
        valBtn,
        h('button', { class: 'step', 'aria-label': t('plus', { name: hb.name }), onclick: function () { S.setLog(date, id, E.clean(x + step)); } }, icon('plus'))));
  }

  function monthBadge(c, bm, isCur) {
    if (c.period !== 'monthly' || !isCur || bm.pct === null) return null;
    var behind = bm.pct < 1 - 1e-9;
    return h('span', { class: 'badge ' + (behind ? 'warn' : 'ok'), text: behind ? t('belowPace') : t('onPace') });
  }

  function editValue(btn, date, id, current) {
    var inp = h('input', { class: 'valinput', type: 'text', inputmode: 'decimal', value: current ? String(current).replace('.', lang === 'es' ? ',' : '.') : '', 'aria-label': t('value') });
    var done = false;
    function commit() {
      if (done) return; done = true;
      var raw = inp.value.trim().replace(',', '.');
      if (raw === '') { S.setLog(date, id, null); return; }
      var n = Number(raw);
      if (!isFinite(n) || n < 0 || n > 1e7) { toast(t('badNumber')); render(); return; }
      S.setLog(date, id, E.clean(n));
    }
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { inp.blur(); } if (e.key === 'Escape') { done = true; render(); } });
    inp.addEventListener('blur', commit);
    btn.replaceWith(inp); inp.focus(); inp.select();
  }

  // ---------- MONTH ----------
  function viewMonth() {
    var st = S.state(), mk = ui.month || E.monthKey(today);
    var ms = E.monthStats(st, mk, today);
    var root = h('div', { class: 'page' });
    root.appendChild(h('div', { class: 'datebar' },
      h('button', { class: 'iconbtn', 'aria-label': t('prevMonth'), onclick: function () { ui.month = E.addMonths(mk, -1); render(); } }, icon('left')),
      h('div', { class: 'datetitle' }, h('h1', { text: cap(mfmt(mk, { month: 'long' })) }),
        h('div', { class: 'datesub' }, mk.slice(0, 4) + ' · ' + (ms.elapsed ? t('daysOf', { a: ms.elapsed, b: ms.dim }) : t('futureMonth')))),
      h('button', { class: 'iconbtn', 'aria-label': t('nextMonth'), disabled: mk >= E.monthKey(today), onclick: function () { ui.month = E.addMonths(mk, 1); render(); } }, icon('right'))));
    if (!ms.habits.length) { root.appendChild(h('p', { class: 'muted pad', text: t('noHabitsMonth') })); return root; }

    root.appendChild(h('section', { class: 'summary slim' },
      h('div', { class: 'facts' }, h('div', { class: 'fact-big', text: pc(ms.weighted) }), h('div', { class: 'fact muted', text: t('weightedMonth') }))));

    root.appendChild(h('h2', { class: 'sect', text: t('byHabit') }));
    root.appendChild(h('div', { class: 'card' }, ms.habits.map(function (x) {
      var tot = x.type === 'check' && x.period === 'daily' ? nf(x.total) + ' ' + t('daysWord') : nf(x.total) + (x.unit ? ' ' + x.unit : '');
      var tgt = x.period === 'monthly' ? ' / ' + nf(x.goal) : '';
      return h('div', { class: 'hline' },
        h('div', { class: 'hl-top' }, h('span', { class: 'hl-name', text: x.name }), h('span', { class: 'hl-pct', text: pc(x.pct) })),
        h('div', { class: 'bar' + (x.pct !== null && x.pct < 0.4 ? ' low' : '') }, h('i', { style: 'width:' + Math.round((x.pct || 0) * 100) + '%' })),
        h('div', { class: 'hl-sub muted', text: tot + tgt + ' · ' + t('avgDay', { n: nf(Math.round(x.avg * 100) / 100) }) }));
    })));

    root.appendChild(h('h2', { class: 'sect', text: t('daysTitle') }));
    root.appendChild(h('div', { class: 'card days' }, ms.days.map(function (d) {
      var cls = 'dayrow' + (d.date === today ? ' now' : '') + (d.future ? ' future' : '');
      return h('button', { class: cls, disabled: d.future, onclick: function () { ui.date = d.date; ui.tab = 'today'; render(); } },
        h('span', { class: 'dr-date', text: dfmt(d.date, { weekday: 'short', day: 'numeric' }) }),
        h('span', { class: 'bar thin' }, h('i', { style: 'width:' + Math.round((d.score || 0) * 100) + '%' })),
        h('span', { class: 'dr-pct', text: d.future ? '' : pc(d.score) }));
    })));
    return root;
  }

  // ---------- DASHBOARD ----------
  var PERIODS = ['cur', 'prev', '3', '6', '12', 'year', 'month', 'all'];
  function viewPanel() {
    var st = S.state(), cur = E.monthKey(today);
    var range = E.periodRange(st, ui.period === 'cur' ? 'x' : ui.period, today, ui.chosen);
    var ps = E.periodStats(st, range[0], range[1], today, thr());
    draws = [];
    var root = h('div', { class: 'page' });
    root.appendChild(h('h1', { class: 'pagetitle', text: t('panel') }));
    root.appendChild(h('div', { class: 'chips', role: 'tablist' }, PERIODS.map(function (p) {
      return h('button', { class: 'chipbtn' + (ui.period === p ? ' on' : ''), role: 'tab', 'aria-selected': ui.period === p ? 'true' : 'false', text: t('p_' + p), onclick: function () { ui.period = p; if (p === 'month' && !ui.chosen) ui.chosen = cur; S.setMeta('period', p); render(); } });
    })));
    if (ui.period === 'month') {
      root.appendChild(h('div', { class: 'monthpick' }, h('label', { text: t('chooseMonth') + ' ' }),
        h('input', { type: 'month', value: ui.chosen || cur, max: cur, onchange: function (e) { if (e.target.value) { ui.chosen = e.target.value; render(); } } })));
    }
    var rangeText = range[0] === range[1] ? cap(mfmt(range[0])) : cap(mfmt(range[0], { month: 'short', year: 'numeric' })) + ' – ' + cap(mfmt(range[1], { month: 'short', year: 'numeric' }));
    root.appendChild(h('div', { class: 'muted rangeline', text: rangeText }));

    if (!E.sortedHabits(st).length) { root.appendChild(emptyState()); return root; }

    var selId = ui.habit !== 'all' && st.habits[ui.habit] ? ui.habit : 'all';
    root.appendChild(habitPicker(st, selId));
    if (selId !== 'all') { habitPanel(root, st, ps, st.habits[selId], range); return root; }

    var todayScore = E.dayScore(st, today);
    root.appendChild(h('section', { class: 'kpis' },
      kpi(t('kAdherence'), pc(ps.overall), ps.overall),
      kpi(t('kStreak'), String(ps.streak), null, streakWord(ps.streak).replace(String(ps.streak), '').trim()),
      kpi(t('kToday'), pc(todayScore), todayScore),
      kpi(t('kMonths'), String(ps.included), null, t('kMonthsSub', { n: ps.months.length }))));

    // monthly evolution (only when the period spans months)
    var monthsShown = ps.months.slice(-12);
    if (monthsShown.length > 1) {
      var items = monthsShown.map(function (m) {
        var inc = m.elapsed > 0 && m.weighted !== null && (m.key === cur || E.hasLogs(st, m.key));
        return { label: cap(mfmt(m.key, { month: 'short' })).replace('.', ''), value: inc ? m.weighted : null, current: m.key === cur,
          tip: cap(mfmt(m.key)) + ': ' + (inc ? pc(m.weighted) : t('noData')) };
      });
      root.appendChild(chartBlock('months', t('cMonths'), function (w) { return C.bars(items, w, { label: t('cMonths'), labelW: 30 }); },
        tableOf([t('month'), t('adherence')], items.map(function (i) { return [i.tip.split(':')[0], i.value === null ? '–' : pc(i.value)]; }))));
    }

    // day by day for the last month in the range
    var lastKey = range[1], lm = ps.months[ps.months.length - 1];
    if (lm && lm.elapsed > 0) {
      var vals = lm.days.map(function (d) { return d.score; });
      var ma = vals.map(function (_, i) {
        var seg = vals.slice(Math.max(0, i - 6), i + 1).filter(function (v) { return v !== null; });
        return lm.days[i].future || seg.length < 3 ? null : seg.reduce(function (a, b) { return a + b; }, 0) / seg.length;
      });
      var ditems = lm.days.map(function (d) {
        return { label: String(d.day), value: d.future ? null : d.score, tip: dfmt(d.date, { weekday: 'short', day: 'numeric', month: 'short' }) + ': ' + (d.future ? '' : pc(d.score)) };
      });
      var title = t('cDaily', { m: cap(mfmt(lastKey)) });
      root.appendChild(chartBlock('daily', title, function (w) { return C.bars(ditems, w, { label: title, threshold: thr(), line: ma, labelW: 22 }); },
        tableOf([t('day'), t('dayScore')], lm.days.filter(function (d) { return !d.future; }).map(function (d) { return [dfmt(d.date, { day: 'numeric', month: 'short' }), pc(d.score)]; })),
        h('div', { class: 'legend' }, h('span', { class: 'lg bar-lg' }, t('lgDay')), h('span', { class: 'lg line-lg' }, t('lgAvg')), h('span', { class: 'lg thr-lg' }, t('lgThr', { n: Math.round(thr() * 100) })))));
    }

    // heatmap of recent weeks
    root.appendChild(chartBlock('heat', t('cHeat'), function (w) {
      var weeks = Math.max(8, Math.min(26, Math.floor((w - 18) / 17)));
      var dow = (E.weekday(today) + 6) % 7;                 // Monday = 0
      var startDate = E.addDays(today, -(dow + 7 * (weeks - 1)));
      var cells = [], d = startDate, last = E.addDays(today, 6 - dow);
      while (d <= last) {
        var fut = d > today, sc = fut ? null : E.dayScore(st, d);
        cells.push({ date: d, value: sc, future: fut, today: d === today, tip: dfmt(d, { weekday: 'short', day: 'numeric', month: 'short' }) + ': ' + (fut ? '' : pc(sc)) });
        d = E.addDays(d, 1);
      }
      var dows = []; for (var i = 0; i < 7; i++) dows.push(dfmt(E.addDays('2026-11-02', i), { weekday: 'narrow' }));
      return C.heat(cells, 0, w, { label: t('cHeat'), dows: dows });
    }, null, h('div', { class: 'legend scale' }, h('span', { text: t('less') }),
      [0, 1, 2, 3, 4].map(function (i) { return h('i', { class: 'sw hc-' + i }); }), h('span', { text: t('more') }))));

    // per habit
    if (ps.habits.length) {
      var hitems = ps.habits.slice().sort(function (a, b) { return (b.pct === null ? -1 : b.pct) - (a.pct === null ? -1 : a.pct); }).map(function (x) {
        return { label: x.name, value: x.pct, low: x.pct !== null && x.pct < 0.4, tip: x.name + ': ' + pc(x.pct) + (x.pct !== null && x.pct < 0.4 ? ' · ' + t('below40') : '') + ' · ' + t('avgDay', { n: nf(Math.round(x.avg * 100) / 100) }) + (x.unit ? ' ' + x.unit : '') };
      });
      root.appendChild(chartBlock('habits', t('cHabits'), function (w) { return C.hbars(hitems, w, { label: t('cHabits') }); },
        tableOf([t('habit'), t('adherence'), t('avgDayHead'), t('streakHead')], ps.habits.map(function (x) { return [x.name, pc(x.pct), nf(Math.round(x.avg * 100) / 100) + (x.unit ? ' ' + x.unit : ''), x.period === 'daily' ? String(x.streak) : '–']; })),
        h('div', { class: 'legend' }, h('span', { class: 'lg low-lg' }, t('below40')))));
    }

    if (ps.top.length) {
      root.appendChild(h('section', { class: 'card top3' }, h('h2', { class: 'sect in', text: t('top3') }),
        h('ol', null, ps.top.map(function (x) { return h('li', null, h('span', { class: 'tn', text: x.name }), h('strong', { text: pc(x.pct) })); }))));
    }
    return root;
  }


  // ---------- dashboard for one habit ----------
  function habitPicker(st, selId) {
    var cur = E.monthKey(today);
    var sel = h('select', { class: 'inp select', id: 'f-ph', 'aria-label': t('habitLabel'), onchange: function (e) { ui.habit = e.target.value; S.setMeta('panelHabit', ui.habit); render(); } },
      h('option', { value: 'all', text: t('allHabits') }),
      E.sortedHabits(st).map(function (x) {
        var arch = !E.cfgFor(x, cur) && x.archivedFrom && x.archivedFrom <= cur;
        return h('option', { value: x.id, text: x.name + (arch ? ' (' + t('archivedTag') + ')' : '') });
      }));
    sel.value = selId;
    return h('div', { class: 'habitpick' }, h('label', { for: 'f-ph', text: t('habitLabel') }), sel);
  }

  /** 0..1 for a habit on a date, or null when it did not exist / has no value to show. */
  function habitRatio(st, hb, d) {
    var c = E.cfgFor(hb, E.monthKey(d));
    if (!c || +d.slice(8, 10) < E.startDay(st, hb, E.monthKey(d))) return null;
    var v = E.val(st, d, hb.id);
    if (c.period === 'monthly') return v === true || (typeof v === 'number' && v > 0) ? 1 : 0;
    if (hb.type === 'check') return v === true ? 1 : 0;
    return c.goal > 0 ? Math.min(1, (typeof v === 'number' ? v : 0) / c.goal) : 0;
  }
  function habitValueText(st, hb, d) {
    var v = E.val(st, d, hb.id), u = hb.unit ? ' ' + hb.unit : '';
    if (hb.type === 'check') return v === true ? t('done') : t('notDone');
    return nf(typeof v === 'number' ? v : 0) + u;
  }

  function habitPanel(root, st, ps, hb, range) {
    var cur = E.monthKey(today), px = null;
    ps.habits.forEach(function (x) { if (x.id === hb.id) px = x; });
    var cfg = E.cfgFor(hb, range[1]) || E.cfgFor(hb, cur) || hb.versions[hb.versions.length - 1];
    var u = hb.unit ? ' ' + hb.unit : '', isCheck = hb.type === 'check', monthly = cfg.period === 'monthly';
    var r2 = function (x) { return nf(Math.round(x * 100) / 100); };
    var streak = monthly ? null : E.habitStreak(st, hb.id, today);
    var unitTxt = isCheck && !hb.unit ? t('daysWord') : (hb.unit || '');

    root.appendChild(h('section', { class: 'kpis' },
      kpi(t('kAdherence'), pc(px ? px.pct : null), px ? px.pct : null),
      kpi(t('kStreak'), streak === null ? '–' : String(streak), null, streak === null ? t('monthlyGoalShort') : streakWord(streak).replace(String(streak), '').trim()),
      kpi(t('kTotal'), px ? r2(px.total) : '–', null, unitTxt),
      kpi(t('kAvg'), px ? r2(px.avg) : '–', null, unitTxt ? unitTxt + '/' + t('dayShort') : '')));

    // adherence by month for this habit
    var months = ps.months.slice(-12);
    if (months.length > 1) {
      var items = months.map(function (m) {
        var x = null; m.habits.forEach(function (y) { if (y.id === hb.id) x = y; });
        var inc = x && x.pct !== null && (m.key === cur || E.hasLogs(st, m.key));
        return { label: cap(mfmt(m.key, { month: 'short' })).replace('.', ''), value: inc ? x.pct : null, current: m.key === cur,
          tip: cap(mfmt(m.key)) + ': ' + (inc ? pc(x.pct) + (x.period === 'monthly' || !isCheck ? ' · ' + r2(x.total) + (x.unit ? ' ' + x.unit : '') : '') : t('noData')) };
      });
      root.appendChild(chartBlock('hmonths', t('cMonths'), function (w) { return C.bars(items, w, { label: t('cMonths'), labelW: 30 }); },
        tableOf([t('month'), t('adherence')], items.map(function (i) { return [i.tip.split(':')[0], i.value === null ? '–' : pc(i.value)]; }))));
    }

    // day by day (or running total for a monthly goal) for the last month in the range
    var lm = ps.months[ps.months.length - 1];
    var c = lm ? E.cfgFor(hb, lm.key) : null;
    if (lm && c && lm.elapsed > 0) {
      var ditems = [], line = [], rows = [], cum = 0, ratios = [], i;
      lm.days.forEach(function (d) {
        var v = E.val(st, d.date, hb.id), ratio = d.future ? null : habitRatio(st, hb, d.date);
        ratios.push(ratio);
        var amount = hb.type === 'check' ? (v === true ? 1 : 0) : (typeof v === 'number' ? v : 0);
        if (c.period === 'monthly') {
          if (!d.future) cum += amount;
          var cr = Math.min(1, cum / c.goal);
          ditems.push({ label: String(d.day), value: d.future ? null : cr, tip: dfmt(d.date, { day: 'numeric', month: 'short' }) + ': ' + nf(Math.round(cum * 100) / 100) + ' / ' + nf(c.goal) + u });
          line.push(d.day / lm.dim);
        } else {
          ditems.push({ label: String(d.day), value: ratio, tip: dfmt(d.date, { weekday: 'short', day: 'numeric', month: 'short' }) + ': ' + (d.future ? '' : habitValueText(st, hb, d.date) + (hb.type === 'number' ? ' (' + pc(ratio) + ')' : '')) });
        }
        if (!d.future) rows.push([dfmt(d.date, { day: 'numeric', month: 'short' }), c.period === 'monthly' ? nf(Math.round(cum * 100) / 100) + ' / ' + nf(c.goal) + u : habitValueText(st, hb, d.date)]);
      });
      if (c.period !== 'monthly') {
        ratios.forEach(function (_, k) {
          var seg = ratios.slice(Math.max(0, k - 6), k + 1).filter(function (x) { return x !== null; });
          line.push(lm.days[k].future || seg.length < 3 ? null : seg.reduce(function (a, b) { return a + b; }, 0) / seg.length);
        });
      }
      var title = c.period === 'monthly' ? t('cCum', { m: cap(mfmt(lm.key)) }) : t('cHabitDaily', { m: cap(mfmt(lm.key)) });
      root.appendChild(chartBlock('hdaily', title, function (w) { return C.bars(ditems, w, { label: title, line: line, labelW: 22 }); },
        tableOf([t('day'), t('value')], rows),
        c.period === 'monthly'
          ? h('div', { class: 'legend' }, h('span', { class: 'lg bar-lg' }, t('lgCum')), h('span', { class: 'lg line-lg' }, t('lgPace')))
          : h('div', { class: 'legend' }, h('span', { class: 'lg bar-lg' }, hb.type === 'check' ? t('lgDone') : t('lgOfGoal')), h('span', { class: 'lg line-lg' }, t('lgAvg')))));
    }

    // heatmap for this habit
    root.appendChild(chartBlock('hheat', t('cHeat'), function (w) {
      var weeks = Math.max(8, Math.min(26, Math.floor((w - 18) / 17)));
      var dow = (E.weekday(today) + 6) % 7;
      var d = E.addDays(today, -(dow + 7 * (weeks - 1))), last = E.addDays(today, 6 - dow), cells = [];
      while (d <= last) {
        var fut = d > today, r = fut ? null : habitRatio(st, hb, d);
        cells.push({ date: d, value: r, future: fut, today: d === today, tip: dfmt(d, { weekday: 'short', day: 'numeric', month: 'short' }) + ': ' + (fut || r === null ? '' : habitValueText(st, hb, d)) });
        d = E.addDays(d, 1);
      }
      var dows = []; for (var j = 0; j < 7; j++) dows.push(dfmt(E.addDays('2026-11-02', j), { weekday: 'narrow' }));
      return C.heat(cells, 0, w, { label: t('cHeat'), dows: dows });
    }, null, h('div', { class: 'legend scale' }, h('span', { text: t('less') }),
      [0, 1, 2, 3, 4].map(function (k) { return h('i', { class: 'sw hc-' + k }); }), h('span', { text: t('more') }))));

    // habit settings in force
    var cfgTxt = (isCheck ? t('typeCheck') : t('typeNumber')) + ' · ' +
      (monthly ? t('goalMonthly', { n: nf(cfg.goal) + u }) : (isCheck ? t('everyDay') : t('goalDaily', { n: nf(cfg.goal) + u }))) +
      (!isCheck && !monthly ? ' · ' + (cfg.method === 'average' ? t('mAverage') : t('mStrict')) : '') + ' · ' + t('weightShort', { n: nf(cfg.weight) });
    root.appendChild(h('p', { class: 'muted rangeline', text: cfgTxt }));
  }

  function kpi(label, value, ratio, sub) {
    return h('div', { class: 'kpi' }, h('div', { class: 'kl', text: label }), h('div', { class: 'kv', text: value }),
      ratio !== null && ratio !== undefined ? h('div', { class: 'bar thin' }, h('i', { style: 'width:' + Math.round(ratio * 100) + '%' })) : h('div', { class: 'ks', text: sub || '' }));
  }
  function tableOf(head, rows) {
    return h('table', { class: 'dt' }, h('thead', null, h('tr', null, head.map(function (x) { return h('th', { text: x }); }))),
      h('tbody', null, rows.map(function (r) { return h('tr', null, r.map(function (c) { return h('td', { text: c }); })); })));
  }
  function chartBlock(key, title, drawFn, table, legend) {
    var asTable = !!ui.tables[key];
    var host = h('div', { class: 'chart', 'data-key': key });
    var sec = h('section', { class: 'card chartcard' },
      h('div', { class: 'ch-head' }, h('h2', { class: 'sect in', text: title }),
        h('button', { class: 'linkbtn', text: asTable ? t('showChart') : t('showTable'), onclick: function () { ui.tables[key] = !asTable; render(); } })),
      asTable ? h('div', { class: 'tablewrap' }, table) : host,
      !asTable ? legend : null);
    if (!asTable) draws.push({ host: host, fn: drawFn });
    return sec;
  }
  function drawCharts() {
    draws.forEach(function (d) {
      var w = Math.floor(d.host.clientWidth);
      if (w > 40) d.host.innerHTML = d.fn(w);
    });
  }

  // ---------- HABITS & SETTINGS ----------
  function viewHabits() {
    var st = S.state(), cur = E.monthKey(today);
    var all = E.sortedHabits(st);
    var activeList = all.filter(function (x) { return E.cfgFor(x, cur); });
    var archived = all.filter(function (x) { return !E.cfgFor(x, cur) && x.archivedFrom && x.archivedFrom <= cur; });
    var root = h('div', { class: 'page' });
    root.appendChild(h('div', { class: 'pagehead' }, h('h1', { class: 'pagetitle', text: t('habits') }),
      h('button', { class: 'btn primary', text: t('addHabit'), onclick: function () { openEditor(null); } })));

    if (!activeList.length) root.appendChild(emptyState());
    else root.appendChild(h('div', { class: 'card' }, activeList.map(function (hb, i) {
      var c = E.cfgFor(hb, cur);
      var desc = (hb.type === 'check' ? t('typeCheck') : t('typeNumber')) + ' · ' +
        (c.period === 'monthly' ? t('goalMonthly', { n: nf(c.goal) + (hb.unit ? ' ' + hb.unit : '') }) : (hb.type === 'number' ? t('goalDaily', { n: nf(c.goal) + (hb.unit ? ' ' + hb.unit : '') }) : t('everyDay'))) +
        (hb.type === 'number' && c.period === 'daily' ? ' · ' + (c.method === 'average' ? t('mAverage') : t('mStrict')) : '') + ' · ' + t('weightShort', { n: nf(c.weight) });
      return h('div', { class: 'hrow' },
        h('div', { class: 'hr-main' }, h('div', { class: 'hr-name', text: hb.name }), h('div', { class: 'hr-sub muted', text: desc })),
        h('div', { class: 'hr-act' },
          h('button', { class: 'iconbtn sm', 'aria-label': t('moveUp'), disabled: i === 0, onclick: function () { swapOrder(activeList[i - 1], hb); } }, icon('up')),
          h('button', { class: 'iconbtn sm', 'aria-label': t('moveDown'), disabled: i === activeList.length - 1, onclick: function () { swapOrder(hb, activeList[i + 1]); } }, icon('down')),
          h('button', { class: 'iconbtn sm', 'aria-label': t('edit') + ' ' + hb.name, onclick: function () { openEditor(hb.id); } }, icon('edit'))));
    })));

    if (archived.length) {
      root.appendChild(h('h2', { class: 'sect', text: t('archived') }));
      root.appendChild(h('div', { class: 'card' }, archived.map(function (hb) {
        return h('div', { class: 'hrow' }, h('div', { class: 'hr-main' }, h('div', { class: 'hr-name', text: hb.name }), h('div', { class: 'hr-sub muted', text: t('archivedSince', { m: cap(mfmt(hb.archivedFrom)) }) })),
          h('button', { class: 'btn small', text: t('restore'), onclick: function () { var c = clone(hb); c.archivedFrom = null; S.putHabit(c); toast(t('restored')); } }));
      })));
    }
    root.appendChild(settingsBlock());
    return root;
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function swapOrder(a, b) {
    var ca = clone(a), cb = clone(b), o = ca.order;
    ca.order = cb.order; cb.order = o;
    if (ca.order === cb.order) cb.order = ca.order + 0.5;
    delete ca.id; delete cb.id;
    S.putMany([['h:' + a.id, ca], ['h:' + b.id, cb]]);
  }

  function loadExamples() {
    var es = lang === 'es', mk = E.monthKey(today), pairs = [];
    var defs = [
      [es ? 'Despertar temprano' : 'Wake up early', 'check', '', 1, 'daily', 'strict'],
      [es ? 'Gimnasio' : 'Gym', 'check', es ? 'sesiones' : 'sessions', 12, 'monthly', 'strict'],
      [es ? 'Meditar' : 'Meditate', 'check', '', 1, 'daily', 'strict'],
      [es ? 'Leer 10 páginas' : 'Read 10 pages', 'check', '', 1, 'daily', 'strict'],
      [es ? 'Sin azúcar' : 'No sugar', 'check', '', 1, 'daily', 'strict'],
      [es ? 'Escribir diario' : 'Journal', 'check', '', 1, 'daily', 'strict'],
      [es ? 'Flexiones' : 'Push-ups', 'number', es ? 'reps' : 'reps', 50, 'daily', 'average'],
      [es ? 'Sueño' : 'Sleep', 'number', 'h', 8, 'daily', 'strict'],
      [es ? 'Agua' : 'Water', 'number', 'L', 2.5, 'daily', 'strict'],
      [es ? 'Pasos' : 'Steps', 'number', es ? 'pasos' : 'steps', 10000, 'daily', 'average']
    ];
    defs.forEach(function (d, i) {
      var id = newId();
      pairs.push(['h:' + id, { name: d[0], type: d[1], unit: d[2], order: i + 1, created: today, archivedFrom: null,
        versions: [{ from: mk, goal: d[3], period: d[4], method: d[5], weight: 1 }] }]);
    });
    S.putMany(pairs); toast(t('examplesLoaded'));
  }

  // ---------- habit editor ----------
  function openEditor(id) {
    var st = S.state(), cur = E.monthKey(today), hb = id ? st.habits[id] : null;
    var c = hb ? E.cfgFor(hb, cur) || hb.versions[hb.versions.length - 1] : { goal: 1, period: 'daily', method: 'strict', weight: 1 };
    var f = { name: hb ? hb.name : '', type: hb ? hb.type : 'check', unit: hb ? hb.unit || '' : '', period: c.period, goal: c.goal, method: c.method, weight: c.weight, scope: 'now' };
    var dlg = h('dialog', { class: 'sheet', 'aria-label': hb ? t('editHabit') : t('newHabit') });
    var body = h('div', { class: 'sheet-body' });
    dlg.appendChild(body);
    function seg(name, opts, locked) {
      return h('div', { class: 'seg', role: 'radiogroup' }, opts.map(function (o) {
        return h('button', { type: 'button', class: 'segb' + (f[name] === o[0] ? ' on' : ''), role: 'radio', 'aria-checked': f[name] === o[0] ? 'true' : 'false', disabled: locked, text: o[1],
          onclick: function () { f[name] = o[0]; paint(); } });
      }));
    }
    function paint() {
      body.innerHTML = '';
      var nameIn = h('input', { class: 'inp', id: 'f-name', type: 'text', value: f.name, maxlength: '40', autocomplete: 'off', oninput: function (e) { f.name = e.target.value; } });
      body.appendChild(h('h2', { text: hb ? t('editHabit') : t('newHabit') }));
      body.appendChild(field(t('fName'), nameIn, 'f-name'));
      body.appendChild(field(t('fType'), seg('type', [['check', t('typeCheck')], ['number', t('typeNumber')]], !!hb), null, hb ? t('typeLocked') : t('typeHelp')));
      if (f.type === 'number') body.appendChild(field(t('fUnit'), h('input', { class: 'inp', id: 'f-unit', type: 'text', value: f.unit, maxlength: '12', placeholder: 'reps, h, L…', oninput: function (e) { f.unit = e.target.value; } }), 'f-unit'));
      body.appendChild(field(t('fPeriod'), seg('period', [['daily', t('pDaily')], ['monthly', t('pMonthly')]]), null, f.period === 'monthly' ? t('pMonthlyHelp') : t('pDailyHelp')));
      if (f.type === 'number' || f.period === 'monthly') {
        var goalIn = h('input', { class: 'inp', id: 'f-goal', type: 'text', inputmode: 'decimal', value: String(f.goal).replace('.', lang === 'es' ? ',' : '.'), oninput: function (e) { f.goalRaw = e.target.value; } });
        body.appendChild(field(f.period === 'monthly' ? t('fGoalMonth') : t('fGoalDay'), goalIn, 'f-goal'));
      }
      if (f.type === 'number' && f.period === 'daily') {
        body.appendChild(field(t('fMethod'), seg('method', [['strict', t('mStrict')], ['average', t('mAverage')]]), null, f.method === 'average' ? t('mAverageHelp') : t('mStrictHelp')));
      }
      body.appendChild(field(t('fWeight'), h('input', { class: 'inp', id: 'f-weight', type: 'text', inputmode: 'decimal', value: String(f.weight).replace('.', lang === 'es' ? ',' : '.'), oninput: function (e) { f.weightRaw = e.target.value; } }), 'f-weight', t('weightHelp')));
      if (hb) {
        body.appendChild(field(t('fScope'), h('div', { class: 'seg vertical', role: 'radiogroup' }, [['now', t('scopeNow', { m: cap(mfmt(cur)) })], ['next', t('scopeNext', { m: cap(mfmt(E.addMonths(cur, 1))) })], ['fix', t('scopeFix')]].map(function (o) {
          return h('button', { type: 'button', class: 'segb' + (f.scope === o[0] ? ' on' : ''), role: 'radio', 'aria-checked': f.scope === o[0] ? 'true' : 'false', text: o[1], onclick: function () { f.scope = o[0]; paint(); } });
        })), null, t('scopeHelp')));
      }
      var err = h('div', { class: 'err', role: 'alert' });
      body.appendChild(err);
      body.appendChild(h('div', { class: 'btnrow end' },
        hb ? h('button', { type: 'button', class: 'btn danger', text: t('archive'), onclick: function () {
          var cc = clone(hb); cc.archivedFrom = cur; S.putHabit(cc); dlg.close(); toast(t('archivedToast', { name: hb.name }), t('undo'), function () { var u = clone(hb); S.putHabit(u); });
        } }) : null,
        h('span', { class: 'grow' }),
        h('button', { type: 'button', class: 'btn', text: t('cancel'), onclick: function () { dlg.close(); } }),
        h('button', { type: 'button', class: 'btn primary', text: t('save'), onclick: function () { save(err); } })));
    }
    function field(label, ctl, forId, help) {
      return h('div', { class: 'field' }, h('label', { for: forId, text: label }), ctl, help ? h('div', { class: 'help', text: help }) : null);
    }
    function parseNum(raw, fallback) {
      if (raw === undefined) return fallback;
      var n = Number(String(raw).trim().replace(',', '.'));
      return isFinite(n) && String(raw).trim() !== '' ? n : NaN;
    }
    function save(err) {
      var name = f.name.trim();
      if (!name) { err.textContent = t('errName'); return; }
      var goal = f.type === 'check' && f.period === 'daily' ? 1 : parseNum(f.goalRaw, f.goal);
      var weight = parseNum(f.weightRaw, f.weight);
      if (!(goal > 0) || goal > 1e7) { err.textContent = t('errGoal'); return; }
      if (!(weight > 0) || weight > 100) { err.textContent = t('errWeight'); return; }
      var method = f.type === 'number' && f.period === 'daily' ? f.method : 'strict';
      var ver = { goal: goal, period: f.period, method: method, weight: weight };
      if (!hb) {
        var all = E.sortedHabits(st), order = all.length ? all[all.length - 1].order + 1 : 1;
        S.putHabit({ id: newId(), name: name, type: f.type, unit: f.type === 'number' ? f.unit.trim() : (f.period === 'monthly' ? f.unit.trim() : ''), order: order, created: today, archivedFrom: null, versions: [Object.assign({ from: cur }, ver)] });
      } else {
        var n = clone(hb); n.name = name; n.unit = f.type === 'number' ? f.unit.trim() : n.unit;
        var same = ver.goal === c.goal && ver.period === c.period && ver.method === c.method && ver.weight === c.weight;
        if (!same) {
          if (f.scope === 'fix') n.versions = [Object.assign({ from: n.versions.reduce(function (m, v) { return v.from < m ? v.from : m; }, n.versions[0].from) }, ver)];
          else {
            var from = f.scope === 'next' ? E.addMonths(cur, 1) : cur;
            n.versions = n.versions.filter(function (v) { return v.from < from; });
            n.versions.push(Object.assign({ from: from }, ver));
          }
        }
        S.putHabit(n);
      }
      dlg.close(); toast(t('saved'));
    }
    paint();
    dlg.addEventListener('close', function () { dlg.remove(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    document.body.appendChild(dlg);
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    setTimeout(function () { var n = $('#f-name', dlg); if (n && !hb) n.focus(); }, 30);
  }

  // ---------- settings ----------
  function settingsBlock() {
    var info = S.syncInfo(), url = S.getMeta('syncUrl', ''), tok = S.getMeta('syncToken', '');
    var wrap = h('div', null);
    wrap.appendChild(h('h2', { class: 'sect', text: t('settings') }));

    wrap.appendChild(h('div', { class: 'card pad' },
      h('div', { class: 'field' }, h('label', { text: t('language') }), h('div', { class: 'seg' }, [['es', 'Español'], ['en', 'English']].map(function (o) {
        return h('button', { class: 'segb' + (lang === o[0] ? ' on' : ''), text: o[1], onclick: function () { setLang(o[0]); render(); } });
      }))),
      h('div', { class: 'field' }, h('label', { text: t('theme') }), h('div', { class: 'seg' }, [['auto', t('themeAuto')], ['light', t('themeLight')], ['dark', t('themeDark')]].map(function (o) {
        return h('button', { class: 'segb' + ((S.getMeta('theme', 'auto')) === o[0] ? ' on' : ''), text: o[1], onclick: function () { S.setMeta('theme', o[0]); applyTheme(); render(); } });
      }))),
      h('div', { class: 'field' }, h('label', { for: 'f-thr', text: t('threshold', { n: Math.round(thr() * 100) }) }),
        h('input', { id: 'f-thr', type: 'range', min: '50', max: '100', step: '5', value: String(Math.round(thr() * 100)),
          oninput: function (e) { $('label[for=f-thr]').textContent = t('threshold', { n: e.target.value }); },
          onchange: function (e) { S.setPrefs({ threshold: Number(e.target.value) / 100 }); } }),
        h('div', { class: 'help', text: t('thresholdHelp') }))));

    // account / sync
    var statusLine = h('div', { class: 'syncstatus ' + info.status, id: 'syncline', text: syncText(info, true) });
    var syncCard = h('div', { class: 'card pad' }, h('h3', { text: t('sync') }), h('p', { class: 'help', text: t('syncHelp') }));
    if (S.hasSync()) {
      syncCard.appendChild(h('div', { class: 'connected' }, h('i', { class: 'dot ok' }), h('strong', { text: t('connected') })));
      syncCard.appendChild(statusLine);
      syncCard.appendChild(h('p', { class: 'help', text: t('addDeviceHelp') }));
      syncCard.appendChild(h('div', { class: 'btnrow' },
        h('button', { class: 'btn primary', text: t('copyLink'), onclick: function () { copyText(connectLink(), t('linkCopied')); } }),
        h('button', { class: 'btn', text: t('copyCode'), onclick: function () { copyText(connectCode(), t('codeCopied')); } }),
        h('button', { class: 'btn', text: t('syncNow'), onclick: function () { S.sync().then(function (r) { toast(r.status === 'ok' ? t('syncOk') : r.status === 'offline' ? t('offlineToast') : t('syncFail')); }); } }),
        h('button', { class: 'btn danger', text: t('signOut'), onclick: function () {
          if (confirm(t('signOutConfirm'))) S.configureSync('', '').then(function () { toast(t('signedOut')); render(); });
        } })));
    } else {
      var codeIn = h('input', { class: 'inp', id: 'f-code', type: 'text', placeholder: t('codePlaceholder'), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
      syncCard.appendChild(h('div', { class: 'field' }, h('label', { for: 'f-code', text: t('codeLabel') }), codeIn, h('div', { class: 'help', text: t('codeHelp') })));
      syncCard.appendChild(h('div', { class: 'btnrow' }, h('button', { class: 'btn primary', text: t('connect'), onclick: function () {
        var o = parseConnect(codeIn.value);
        if (!o) { toast(t('badCode')); return; }
        S.configureSync(o.u, o.k).then(function (r) { toast(r.status === 'ok' ? t('syncOk') : t('syncFail')); render(); });
      } })));
      var urlIn = h('input', { class: 'inp', id: 'f-url', type: 'url', placeholder: 'https://script.google.com/macros/s/…/exec', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
      var tokIn = h('input', { class: 'inp', id: 'f-tok', type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
      syncCard.appendChild(h('details', { class: 'manual' }, h('summary', { text: t('manual') }),
        h('div', { class: 'field' }, h('label', { for: 'f-url', text: t('syncUrl') }), urlIn),
        h('div', { class: 'field' }, h('label', { for: 'f-tok', text: t('syncToken') }), tokIn),
        h('div', { class: 'btnrow' }, h('button', { class: 'btn', text: t('saveSync'), onclick: function () {
          var u = urlIn.value.trim(), k = tokIn.value.trim();
          if (!okUrl(u)) { toast(t('errUrl')); return; }
          if (!k) { toast(t('errToken')); return; }
          S.configureSync(u, k).then(function (r) { toast(r.status === 'ok' ? t('syncOk') : t('syncFail')); render(); });
        } }))));
    }
    wrap.appendChild(syncCard);

    // backup
    var fileIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: function (e) {
      var fl = e.target.files[0]; if (!fl) return;
      var rd = new FileReader();
      rd.onload = function () { try { var n = S.importData(JSON.parse(rd.result)); toast(t('imported', { n: n })); } catch (x) { toast(t('badFile')); } };
      rd.readAsText(fl); e.target.value = '';
    } });
    wrap.appendChild(h('div', { class: 'card pad' }, h('h3', { text: t('backup' ) }), h('p', { class: 'help', text: t('backupHelp') }),
      h('div', { class: 'btnrow' },
        h('button', { class: 'btn', text: t('exportJson'), onclick: function () { download('habit-tracker-' + today + '.json', JSON.stringify(S.exportData()), 'application/json'); } }),
        h('button', { class: 'btn', text: t('exportCsv'), onclick: function () { download('habit-tracker-' + today + '.csv', '﻿' + S.toCsv(), 'text/csv'); } }),
        h('button', { class: 'btn', text: t('importJson'), onclick: function () { fileIn.click(); } }), fileIn,
        h('button', { class: 'btn danger', text: t('wipe'), onclick: function () {
          if (confirm(S.hasSync() ? t('wipeConfirmSync') : t('wipeConfirm'))) { S.wipe(); toast(t('wiped')); }
        } }))));

    // install
    if (installEvt) wrap.appendChild(h('div', { class: 'card pad' }, h('h3', { text: t('install') }), h('p', { class: 'help', text: t('installHelp') }),
      h('button', { class: 'btn primary', text: t('installBtn'), onclick: function () { installEvt.prompt(); installEvt = null; render(); } })));
    else if (!window.matchMedia('(display-mode: standalone)').matches && /iPad|iPhone|iPod/.test(navigator.userAgent))
      wrap.appendChild(h('div', { class: 'card pad' }, h('h3', { text: t('install') }), h('p', { class: 'help', text: t('installIos') })));
    if (!S.isPersistent()) wrap.appendChild(h('p', { class: 'err pad', text: t('noStorage') }));
    return wrap;
  }
  function okUrl(u) { return /^https:\/\//.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)([:\/]|$)/.test(u); }   // http only for local testing
  function connectCode() { return btoa(unescape(encodeURIComponent(JSON.stringify({ u: S.getMeta('syncUrl', ''), k: S.getMeta('syncToken', '') })))); }
  function connectLink() { return location.origin + location.pathname + '#sync=' + connectCode(); }
  /** Accepts a full link, "#sync=..." or the bare code. Returns {u,k} or null. */
  function parseConnect(text) {
    var raw = String(text || '').trim(), i = raw.indexOf('#sync=');
    if (i >= 0) raw = raw.slice(i + 6);
    try {
      var o = JSON.parse(decodeURIComponent(escape(atob(raw.replace(/\s+/g, '')))));
      if (o && typeof o.u === 'string' && okUrl(o.u) && typeof o.k === 'string' && o.k) return { u: o.u, k: o.k };
    } catch (e) { /* not a code */ }
    return null;
  }
  function copyText(text, msg) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast(msg); }, function () { prompt(t('copyLink'), text); });
    else prompt(t('copyLink'), text);
  }
  function download(name, text, type) {
    var a = h('a', { href: URL.createObjectURL(new Blob([text], { type: type })), download: name });
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---------- sync pill ----------
  function syncText(info, long) {
    var p = info.pending;
    if (info.status === 'off') return t('syncOff');
    if (info.status === 'syncing') return t('syncing');
    if (info.status === 'offline') return p ? t('offlinePending', { n: p }) : t('offline');
    if (info.status === 'error') return t('syncError') + (long && info.error ? ': ' + info.error : '');
    if (p) return t('pending', { n: p });
    return t('synced') + (long && info.last ? ' · ' + new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(info.last)) : '');
  }
  function updatePill() {
    var info = S.syncInfo(), pill = $('#pill');
    if (!pill) return;
    if (S.hasSync() && navigator.onLine === false) info.status = 'offline';
    pill.className = 'pill ' + info.status + (info.pending ? ' pend' : '');
    $('#pilltext').textContent = syncText(info, false);
    var line = $('#syncline'); if (line) { line.textContent = syncText(info, true); line.className = 'syncstatus ' + info.status; }
  }

  // ---------- shell ----------
  var TABS = [['today', 'tabToday', 'M4 12.5l5 5L20 6.5'], ['month', 'tabMonth', 'M5 5h14v15H5zM5 10h14M9 3v4M15 3v4'], ['panel', 'tabPanel', 'M5 20V11M12 20V5M19 20v-8'], ['habits', 'tabHabits', 'M4 7h16M4 12h16M4 17h10']];
  function buildShell() {
    var app = $('#app'); app.innerHTML = '';
    var top = h('header', { class: 'topbar' }, h('div', { class: 'brand', text: t('appName') }),
      h('button', { id: 'pill', class: 'pill off', onclick: function () { if (S.hasSync()) S.sync(); else { ui.tab = 'habits'; render(); } } }, h('i', { class: 'dot' }), h('span', { id: 'pilltext' })));
    view = h('main', { id: 'view', tabindex: '-1' });
    var nav = h('nav', { class: 'tabs', 'aria-label': t('appName') }, TABS.map(function (tb) {
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'ico'); svg.setAttribute('aria-hidden', 'true');
      var p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', tb[2]); svg.appendChild(p);
      return h('button', { class: 'tab', 'data-tab': tb[0], onclick: function () { if (ui.tab === tb[0] && tb[0] === 'today') ui.date = null; ui.tab = tb[0]; render(); window.scrollTo(0, 0); } }, svg, h('span', { text: t(tb[1]) }));
    }));
    app.appendChild(top); app.appendChild(view); app.appendChild(nav);
    document.title = t('appName');
    document.documentElement.lang = lang;
  }

  function render() {
    var ae = document.activeElement;
    today = E.localToday();
    draws = [];
    var node;
    if (ui.tab === 'today') node = viewToday();
    else if (ui.tab === 'month') node = viewMonth();
    else if (ui.tab === 'panel') node = viewPanel();
    else node = viewHabits();
    var y = window.scrollY;
    view.innerHTML = ''; view.appendChild(node);
    document.querySelectorAll('.tab').forEach(function (b) { var on = b.getAttribute('data-tab') === ui.tab; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    drawCharts(); updatePill();
    window.scrollTo(0, y);
    document.body.dataset.tab = ui.tab;
  }

  function setLang(l) { lang = l; locale = l === 'es' ? 'es-ES' : 'en-GB'; S.setMeta('lang', l); buildShell(); }
  function applyTheme() {
    var th = S.getMeta('theme', 'auto'), root = document.documentElement;
    if (th === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', th);
    var dark = th === 'dark' || (th === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var m = $('meta[name=theme-color]'); if (m) m.setAttribute('content', dark ? '#12191E' : '#EEF2EE');
  }

  function focusedField() { var a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && view && view.contains(a); }

  // ---------- start ----------
  function importLinkFromHash() {
    if (location.hash.indexOf('#sync=') !== 0) return;
    var o = parseConnect(location.hash);
    history.replaceState(null, '', location.pathname + location.search);
    return o || undefined;
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      function watch(w) {
        w.addEventListener('statechange', function () {
          if (w.state === 'installed' && navigator.serviceWorker.controller) toast(t('updateReady'), t('updateNow'), function () { w.postMessage('skip'); });
        });
      }
      if (reg.waiting && navigator.serviceWorker.controller) toast(t('updateReady'), t('updateNow'), function () { reg.waiting.postMessage('skip'); });
      reg.addEventListener('updatefound', function () { if (reg.installing) watch(reg.installing); });
      setInterval(function () { reg.update().catch(function () {}); }, 3600 * 1000);
    }).catch(function () {});
    var reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () { if (reloading) return; reloading = true; location.reload(); });
  }

  function start() {
    tip = $('#tip'); toastEl = $('#toast');
    var link = importLinkFromHash();
    S.init().then(function () {
      if (link) { S.configureSync(link.u, link.k); }
      var nav = (navigator.language || 'es').toLowerCase();
      lang = S.getMeta('lang', nav.indexOf('en') === 0 ? 'en' : 'es'); locale = lang === 'es' ? 'es-ES' : 'en-GB';
      ui.period = S.getMeta('period', '3'); ui.habit = S.getMeta('panelHabit', 'all');
      applyTheme(); buildShell();
      S.on(function (src) {
        if (src === 'sync') { updatePill(); return; }
        if (focusedField()) { updatePill(); return; }
        render();
      });
      render();
      if (link) toast(t('linkImported'));
      if (!S.isPersistent()) toast(t('noStorage'));
      registerSW();
    });

    window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; if (ui.tab === 'habits') render(); });
    window.addEventListener('offline', updatePill); window.addEventListener('online', updatePill);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
    var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(drawCharts, 150); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && E.localToday() !== today) { ui.date = null; render(); }
    });
    // shared tooltip for chart marks
    document.addEventListener('pointerover', function (e) { var t_ = e.target.closest && e.target.closest('[data-tip]'); if (t_ && e.pointerType === 'mouse') showTip(t_, e.clientX, e.clientY); });
    document.addEventListener('pointermove', function (e) { var t_ = e.target.closest && e.target.closest('[data-tip]'); if (t_ && e.pointerType === 'mouse') showTip(t_, e.clientX, e.clientY); else if (e.pointerType === 'mouse') hideTip(); });
    document.addEventListener('click', function (e) {
      var t_ = e.target.closest && e.target.closest('[data-tip]');
      if (t_ && t_.getAttribute('data-tip')) { showTip(t_, e.clientX, e.clientY); clearTimeout(tipTimer); tipTimer = setTimeout(hideTip, 2800); }
      else hideTip();
    });
    window.addEventListener('scroll', hideTip, { passive: true });
  }

  window.HabitApp = { render: render, ui: ui };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
