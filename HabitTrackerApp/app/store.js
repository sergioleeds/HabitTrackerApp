/* Local-first store: IndexedDB records + in-memory state + optional sync with the Apps Script backend.
 *
 * Records (one per fact, so merges never clobber unrelated edits):
 *   h:<habitId>          habit definition (versions, order, archivedFrom ...)
 *   l:<YYYY-MM-DD>:<id>  one day's value for one habit (true/false/number; null = cleared)
 *   s:prefs              shared preferences (streak threshold)
 * Each record: { k, v, t (client ms, last-write-wins), s (server sequence), d (1 = not yet pushed) }.
 * Device-only settings (language, theme, sync address...) live in the `meta` store and never sync. */
(function (root) {
  'use strict';

  var DB_NAME = 'habit-tracker', DB_VER = 1;
  var db = null, persistent = true;
  var mem = {};                 // key -> record
  var meta = {};                // device-only settings
  var state = { habits: {}, logs: {}, prefs: { threshold: 0.7 } };
  var listeners = [];
  var syncState = { status: 'off', last: null, error: '', syncing: false };
  var syncTimer = null, pollTimer = null, queue = Promise.resolve();

  // ---------- IndexedDB plumbing ----------
  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!root.indexedDB) return reject(new Error('no indexedDB'));
      var req = root.indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains('rec')) d.createObjectStore('rec', { keyPath: 'k' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'k' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error('blocked')); };
    });
  }
  function readAll(store) {
    return new Promise(function (resolve, reject) {
      var out = [], tx = db.transaction(store, 'readonly'), cur = tx.objectStore(store).openCursor();
      cur.onsuccess = function () {
        var c = cur.result;
        if (c) { out.push(c.value); c.continue(); } else resolve(out);
      };
      cur.onerror = function () { reject(cur.error); };
    });
  }
  function writeMany(store, rows, clear) {
    if (!db || !persistent) return Promise.resolve();
    queue = queue.then(function () {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(store, 'readwrite'), os = tx.objectStore(store);
          if (clear) os.clear();
          rows.forEach(function (r) { os.put(r); });
          tx.oncomplete = function () { resolve(); };
          tx.onerror = tx.onabort = function () { persistent = false; resolve(); };
        } catch (e) { persistent = false; resolve(); }
      });
    });
    return queue;
  }
  function saveMeta(k) { return writeMany('meta', [{ k: k, v: meta[k] }]); }

  // ---------- state derivation ----------
  function applyToState(rec) {
    var k = rec.k, p;
    if (k.charAt(0) === 'h') {
      p = k.slice(2);
      if (rec.v === null || rec.v === undefined) delete state.habits[p];
      else { state.habits[p] = rec.v; state.habits[p].id = p; }
    } else if (k.charAt(0) === 'l') {
      var a = k.split(':'), day = a[1], id = a[2];
      if (rec.v === null || rec.v === undefined) {
        if (state.logs[day]) { delete state.logs[day][id]; if (!Object.keys(state.logs[day]).length) delete state.logs[day]; }
      } else { (state.logs[day] = state.logs[day] || {})[id] = rec.v; }
    } else if (k === 's:prefs') {
      var v = rec.v || {};
      if (typeof v.threshold === 'number') state.prefs.threshold = v.threshold;
    }
  }
  function rebuild() {
    state.habits = {}; state.logs = {}; state.prefs = { threshold: 0.7 };
    Object.keys(mem).forEach(function (k) { applyToState(mem[k]); });
  }
  function emit(src) { listeners.forEach(function (f) { try { f(src); } catch (e) { if (root.console) console.error(e); } }); }

  // ---------- local writes ----------
  function stamp(k) { var cur = mem[k]; return Math.max(Date.now(), cur ? cur.t + 1 : 0); }
  function put(k, v) {
    var rec = { k: k, v: v, t: stamp(k), s: mem[k] ? mem[k].s : 0, d: 1 };
    mem[k] = rec; applyToState(rec); writeMany('rec', [rec]);
    scheduleSync(2000); emit('local');
    return rec;
  }
  function putMany(pairs) {
    var rows = [];
    pairs.forEach(function (p) {
      var rec = { k: p[0], v: p[1], t: stamp(p[0]), s: mem[p[0]] ? mem[p[0]].s : 0, d: 1 };
      mem[p[0]] = rec; applyToState(rec); rows.push(rec);
    });
    writeMany('rec', rows); scheduleSync(2000); emit('local');
  }
  function setLog(date, id, value) { put('l:' + date + ':' + id, value === undefined ? null : value); }
  function putHabit(h) { var c = JSON.parse(JSON.stringify(h)); delete c.id; put('h:' + h.id, c); }
  function setPrefs(p) { put('s:prefs', Object.assign({}, { threshold: state.prefs.threshold }, p)); }
  function pendingCount() { var n = 0; for (var k in mem) if (mem[k].d) n++; return n; }

  // ---------- settings (device only) ----------
  function getMeta(k, dflt) { return meta[k] === undefined ? dflt : meta[k]; }
  function setMeta(k, v) { meta[k] = v; saveMeta(k); }

  // ---------- init ----------
  function init() {
    return openDb().then(function (d) {
      db = d;
      return Promise.all([readAll('rec'), readAll('meta')]);
    }).then(function (r) {
      r[0].forEach(function (x) { mem[x.k] = x; });
      r[1].forEach(function (x) { meta[x.k] = x.v; });
    }).catch(function () { persistent = false; }).then(function () {
      if (!meta.device) { meta.device = Math.random().toString(36).slice(2, 10); saveMeta('device'); }
      rebuild();
      syncState.status = hasSync() ? 'idle' : 'off';
      if (hasSync()) startSync();
      return { persistent: persistent };
    });
  }

  // ---------- sync ----------
  function hasSync() { return !!(meta.syncUrl && meta.syncToken); }
  function setStatus(s, err) { syncState.status = s; syncState.error = err || ''; emit('sync'); }

  function scheduleSync(ms) {
    if (!hasSync()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { sync(); }, ms);
  }
  function startSync() {
    if (root.addEventListener) {
      root.addEventListener('online', function () { sync(); });
      root.document && root.document.addEventListener('visibilitychange', function () {
        if (root.document.visibilityState === 'visible') sync();
      });
    }
    clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      if (!root.document || root.document.visibilityState === 'visible') sync();
    }, 60000);
    sync();
  }

  function sync() {
    if (!hasSync()) { setStatus('off'); return Promise.resolve({ status: 'off' }); }
    if (syncState.syncing) { syncState.again = true; return Promise.resolve({ status: 'busy' }); }
    if (root.navigator && root.navigator.onLine === false) { setStatus('offline'); return Promise.resolve({ status: 'offline' }); }
    syncState.syncing = true; setStatus('syncing');
    var rounds = 0, changed = false;

    function round() {
      var dirty = Object.keys(mem).filter(function (k) { return mem[k].d; }).slice(0, 400).map(function (k) { return mem[k]; });
      var body = JSON.stringify({
        token: meta.syncToken, device: meta.device, since: meta.seq || 0,
        push: dirty.map(function (r) { return { k: r.k, v: r.v, t: r.t }; })
      });
      return root.fetch(meta.syncUrl, {
        method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body
      }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function (j) {
        if (!j || j.ok !== true) throw new Error((j && j.error) || 'bad response');
        var rows = [];
        dirty.forEach(function (r) { var cur = mem[r.k]; if (cur && cur.t === r.t) { cur.d = 0; rows.push(cur); } });
        if (j.reset) { // server was emptied or replaced: send everything again
          meta.seq = 0; saveMeta('seq');
          Object.keys(mem).forEach(function (k) { mem[k].d = 1; rows.push(mem[k]); });
        }
        (j.records || []).forEach(function (x) {
          var cur = mem[x.k];
          if (cur && cur.t > x.t) { cur.d = 1; rows.push(cur); return; }       // local is newer: push again
          if (cur && cur.t === x.t && JSON.stringify(cur.v) === JSON.stringify(x.v)) { if (cur.s !== x.s) { cur.s = x.s; rows.push(cur); } return; }
          var rec = { k: x.k, v: x.v, t: x.t, s: x.s, d: 0 };
          mem[x.k] = rec; rows.push(rec); changed = true;
        });
        if (!j.reset) { meta.seq = j.cursor; saveMeta('seq'); }
        if (rows.length) writeMany('rec', rows);
        rounds++;
        var left = Object.keys(mem).some(function (k) { return mem[k].d; });
        if ((j.more || (left && dirty.length)) && rounds < 40 && !j.reset) return round();
        if (j.reset && rounds < 3) return round();
      });
    }

    return round().then(function () {
      syncState.syncing = false; syncState.last = Date.now();
      if (changed) { rebuild(); }
      setStatus('ok'); if (changed) emit('remote');
      meta.lastSync = syncState.last; saveMeta('lastSync');
      if (syncState.again) { syncState.again = false; scheduleSync(500); }
      return { status: 'ok', changed: changed };
    }).catch(function (e) {
      syncState.syncing = false;
      var offline = !(root.navigator && root.navigator.onLine) || /Failed to fetch|NetworkError|Load failed/i.test(String(e && e.message));
      setStatus(offline ? 'offline' : 'error', String(e && e.message || e));
      return { status: offline ? 'offline' : 'error', error: String(e && e.message || e) };
    });
  }

  function configureSync(url, token) {
    meta.syncUrl = (url || '').trim(); meta.syncToken = (token || '').trim();
    meta.seq = 0;
    writeMany('meta', [{ k: 'syncUrl', v: meta.syncUrl }, { k: 'syncToken', v: meta.syncToken }, { k: 'seq', v: 0 }]);
    // first sync pushes everything this device has
    Object.keys(mem).forEach(function (k) { mem[k].d = 1; });
    writeMany('rec', Object.keys(mem).map(function (k) { return mem[k]; }));
    clearInterval(pollTimer);
    if (hasSync()) { startSync(); return sync(); }
    setStatus('off'); return Promise.resolve({ status: 'off' });
  }

  // ---------- backup ----------
  function exportData() {
    var recs = Object.keys(mem).map(function (k) { return { k: k, v: mem[k].v, t: mem[k].t }; });
    return { app: 'habit-tracker', version: 1, exported: new Date().toISOString(), records: recs };
  }
  /** Merge a backup: records win over local ones only when newer; returns how many were applied. */
  function importData(obj) {
    if (!obj || obj.app !== 'habit-tracker' || !Array.isArray(obj.records)) throw new Error('bad file');
    var n = 0, rows = [];
    obj.records.forEach(function (x) {
      if (typeof x.k !== 'string' || typeof x.t !== 'number') return;
      var cur = mem[x.k];
      if (cur && cur.t >= x.t) return;
      var rec = { k: x.k, v: x.v, t: x.t, s: cur ? cur.s : 0, d: 1 };
      mem[x.k] = rec; rows.push(rec); n++;
    });
    rebuild(); writeMany('rec', rows); scheduleSync(500); emit('local');
    return n;
  }
  function toCsv() {
    var rows = ['date,habit,value'], names = {};
    Object.keys(state.habits).forEach(function (id) { names[id] = state.habits[id].name; });
    Object.keys(state.logs).sort().forEach(function (d) {
      Object.keys(state.logs[d]).forEach(function (id) {
        var v = state.logs[d][id], n = '"' + String(names[id] || id).replace(/"/g, '""') + '"';
        rows.push(d + ',' + n + ',' + (v === true ? 1 : v === false ? 0 : v));
      });
    });
    return rows.join('\n');
  }
  function wipe() {
    mem = {}; state = { habits: {}, logs: {}, prefs: { threshold: 0.7 } };
    meta.seq = 0; saveMeta('seq');
    writeMany('rec', [], true); emit('local');
  }

  root.Store = {
    init: init, state: function () { return state; }, setLog: setLog, putHabit: putHabit, putMany: putMany,
    setPrefs: setPrefs, getMeta: getMeta, setMeta: setMeta, on: function (f) { listeners.push(f); },
    sync: sync, configureSync: configureSync, hasSync: hasSync, syncInfo: function () {
      return { status: syncState.status, last: syncState.last || meta.lastSync || null, error: syncState.error, pending: pendingCount() };
    },
    pending: pendingCount, exportData: exportData, importData: importData, toCsv: toCsv, wipe: wipe,
    isPersistent: function () { return persistent; }, _mem: function () { return mem; }
  };
})(typeof self !== 'undefined' ? self : this);
