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
  var syncState = { status: 'off', last: null, error: '', code: '', syncing: false };
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
  function setStatus(s, err, code) { syncState.status = s; syncState.error = err || ''; syncState.code = code || ''; emit('sync'); }

  /* Why a request failed. Codes:
   *   offline      the device itself reports no network
   *   unreachable  the device is online but fetch could not get a readable answer from the address
   *                (Apps Script not deployed for "Anyone", wrong address, blocker: the browser hides which)
   *   http         the address answered with an HTTP error
   *   notjson      the address answered, but not with the backend's JSON (a login or error page)
   *   unauthorized the backend rejected the key
   *   tokenunset   the backend still has the example TOKEN
   *   server       any other error reported by the backend */
  function fail(code, msg) { var e = new Error(msg); e.code = code; return e; }
  function online() { return !(root.navigator && root.navigator.onLine === false); }
  function errMsg(e) { return String(e && e.message || e); }
  /** fetch the backend and parse its JSON; rejects with a coded error. */
  function request(opts) {
    return root.fetch(meta.syncUrl, opts).then(null, function (e) {
      throw fail(online() ? 'unreachable' : 'offline', errMsg(e));
    }).then(function (res) {
      if (!res.ok) throw fail('http', 'HTTP ' + res.status);
      return res.text().then(null, function (e) { throw fail(online() ? 'unreachable' : 'offline', errMsg(e)); });
    }).then(function (txt) {
      try { return JSON.parse(txt); }
      catch (e) { throw fail('notjson', String(txt).replace(/\s+/g, ' ').trim().slice(0, 80) || 'empty response'); }
    });
  }
  /** Throws a coded error unless the backend said ok. */
  function accepted(j) {
    if (j && j.ok === true) return j;
    var m = (j && j.error) || 'bad response';
    throw fail(m === 'unauthorized' ? 'unauthorized' : m === 'server token not set' ? 'tokenunset' : 'server', m);
  }
  function postOpts(body) {
    return { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) };
  }

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
    return sync();
  }

  function sync() {
    if (!hasSync()) { setStatus('off'); return Promise.resolve({ status: 'off' }); }
    if (syncState.syncing) { syncState.again = true; return Promise.resolve({ status: 'busy' }); }
    if (root.navigator && root.navigator.onLine === false) { setStatus('offline'); return Promise.resolve({ status: 'offline' }); }
    syncState.syncing = true; setStatus('syncing');
    var rounds = 0, changed = false;

    function round() {
      var dirty = Object.keys(mem).filter(function (k) { return mem[k].d; }).slice(0, 400).map(function (k) { return mem[k]; });
      return request(postOpts({
        token: meta.syncToken, device: meta.device, since: meta.seq || 0,
        push: dirty.map(function (r) { return { k: r.k, v: r.v, t: r.t }; })
      })).then(function (j) {
        accepted(j);
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
      // "offline" only when the device has no network; anything else is a real error worth showing and keeping
      var code = (e && e.code) || 'unknown', msg = errMsg(e), st = code === 'offline' ? 'offline' : 'error';
      if (st === 'error') { meta.lastError = { code: code, msg: msg, t: Date.now() }; saveMeta('lastError'); }
      setStatus(st, msg, code);
      return { status: st, code: code, error: msg };
    });
  }

  /** Checks the saved address step by step without touching local data.
   *  Resolves { result, detail }: ok | off | offline | nonet | unreachable | notapp | unauthorized | tokenunset | server */
  function testConnection() {
    if (!hasSync()) return Promise.resolve({ result: 'off', detail: '' });
    if (!online()) return Promise.resolve({ result: 'offline', detail: '' });
    return request({ method: 'GET', redirect: 'follow', cache: 'no-store' }).then(function (j) {
      if (!j || j.app !== 'habit-tracker-sync') throw fail('notapp', 'unexpected reply');
      // the health check does not look at the key: an empty push does
      return request(postOpts({ token: meta.syncToken, device: meta.device, since: meta.seq || 0, push: [] }));
    }).then(function (j) {
      accepted(j);
      return { result: 'ok', detail: '' };
    }).catch(function (e) {
      var code = (e && e.code) || 'server', msg = errMsg(e);
      if (code === 'http' || code === 'notjson') code = 'notapp';
      if (code === 'offline') return { result: 'offline', detail: msg };
      if (code !== 'unreachable') return { result: code, detail: msg };
      // Blind request: it succeeds whenever the host answers at all, so it tells "no route to the server"
      // apart from "the server answers but the browser may not read it" (private deployment, wrong address).
      return root.fetch(meta.syncUrl, { method: 'GET', mode: 'no-cors', cache: 'no-store' }).then(
        function () { return { result: 'unreachable', detail: msg }; },
        function () { return { result: online() ? 'nonet' : 'offline', detail: msg }; });
    });
  }

  function configureSync(url, token) {
    meta.syncUrl = (url || '').trim(); meta.syncToken = (token || '').trim();
    meta.seq = 0; meta.lastError = null;     // errors of the previous address say nothing about the new one
    writeMany('meta', [{ k: 'syncUrl', v: meta.syncUrl }, { k: 'syncToken', v: meta.syncToken }, { k: 'seq', v: 0 }, { k: 'lastError', v: null }]);
    // first sync pushes everything this device has
    Object.keys(mem).forEach(function (k) { mem[k].d = 1; });
    writeMany('rec', Object.keys(mem).map(function (k) { return mem[k]; }));
    clearInterval(pollTimer);
    if (hasSync()) return startSync();     // its first sync is the result (a second call would just say "busy")
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
      return { status: syncState.status, last: syncState.last || meta.lastSync || null, error: syncState.error, code: syncState.code,
        lastError: meta.lastError || null, pending: pendingCount() };
    }, testConnection: testConnection,
    pending: pendingCount, exportData: exportData, importData: importData, toCsv: toCsv, wipe: wipe,
    isPersistent: function () { return persistent; }, _mem: function () { return mem; }
  };
})(typeof self !== 'undefined' ? self : this);
