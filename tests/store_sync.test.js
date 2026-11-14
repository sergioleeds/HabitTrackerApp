/* Sync error diagnosis in app/store.js, with a fake fetch (no browser, no IndexedDB). */
let fails = 0, checks = 0;
function ok(label, cond, extra) { checks++; if (!cond) { fails++; console.log('FAIL', label, extra !== undefined ? JSON.stringify(extra) : ''); } }

const URL_ = 'https://script.example/exec';
const nav = { onLine: true };
let handler = null, calls = [];
const win = {
  navigator: nav, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  fetch: (url, opts) => { calls.push(opts || {}); return handler(url, opts || {}); }
};
new Function('self', require('fs').readFileSync(__dirname + '/../app/store.js', 'utf8'))(win);
const S = win.Store;

const reply = (status, text) => Promise.resolve({ ok: status >= 200 && status < 300, status, text: () => Promise.resolve(text) });
const json = (o) => reply(200, JSON.stringify(o));
const netFail = () => Promise.reject(new TypeError('Failed to fetch'));
const good = (url, o) => o.method === 'GET' ? json({ ok: true, app: 'habit-tracker-sync' }) : json({ ok: true, records: [], cursor: 0, more: false, reset: false });

(async () => {
  await S.init();
  handler = good;
  let r = await S.configureSync(URL_, 'secret-token-123');
  ok('sync ok', r.status === 'ok', r);
  ok('no last error after a clean sync', S.syncInfo().lastError === null);

  // device offline: not an error, nothing recorded
  nav.onLine = false; calls = [];
  r = await S.sync();
  ok('offline status', r.status === 'offline', r);
  ok('offline does not call fetch', calls.length === 0);
  ok('offline is not kept as an error', S.syncInfo().lastError === null);
  nav.onLine = true;

  // online but fetch fails: this used to be reported as "offline"
  handler = netFail;
  const before = Date.now();
  r = await S.sync();
  ok('fetch failure while online is an error', r.status === 'error' && r.code === 'unreachable', r);
  let info = S.syncInfo();
  ok('status carries the code', info.status === 'error' && info.code === 'unreachable', info);
  ok('last error keeps the real message', info.lastError && info.lastError.msg === 'Failed to fetch' && info.lastError.code === 'unreachable', info.lastError);
  ok('last error keeps the time', info.lastError.t >= before && info.lastError.t <= Date.now());

  // fetch fails because the network dropped mid-request
  handler = () => { nav.onLine = false; return netFail(); };
  r = await S.sync();
  ok('fetch failure with the device offline is offline', r.status === 'offline', r);
  ok('offline keeps the previous last error', S.syncInfo().lastError.code === 'unreachable');
  nav.onLine = true;

  handler = () => json({ ok: false, error: 'unauthorized' });
  r = await S.sync();
  ok('wrong key', r.status === 'error' && r.code === 'unauthorized', r);
  handler = () => json({ ok: false, error: 'server token not set' });
  ok('example token on server', (await S.sync()).code === 'tokenunset');
  handler = () => json({ ok: false, error: 'busy, try again' });
  r = await S.sync();
  ok('other server error', r.code === 'server' && r.error === 'busy, try again', r);
  handler = () => reply(503, 'down');
  r = await S.sync();
  ok('http error', r.code === 'http' && r.error === 'HTTP 503', r);
  handler = () => reply(200, '<!DOCTYPE html><html>  Sign in</html>');
  r = await S.sync();
  ok('html instead of json', r.code === 'notjson' && /^<!DOCTYPE html>/.test(r.error), r);
  ok('last error is the latest one', S.syncInfo().lastError.code === 'notjson');

  // a later success keeps the record of the last error
  handler = good;
  r = await S.sync();
  ok('recovers', r.status === 'ok' && S.syncInfo().status === 'ok' && S.syncInfo().code === '', S.syncInfo());
  ok('last error survives a success', S.syncInfo().lastError.code === 'notjson');

  // ---- testConnection ----
  calls = [];
  r = await S.testConnection();
  ok('test ok', r.result === 'ok', r);
  ok('test does a GET, then checks the key with an empty push', calls.length === 2 && calls[0].method === 'GET' && calls[1].method === 'POST' && JSON.parse(calls[1].body).push.length === 0, calls);

  nav.onLine = false; calls = [];
  r = await S.testConnection();
  ok('test: device offline', r.result === 'offline' && calls.length === 0, r);
  nav.onLine = true;

  handler = (u, o) => o.mode === 'no-cors' ? Promise.resolve({ ok: false, status: 0, type: 'opaque' }) : netFail();
  r = await S.testConnection();
  ok('test: host answers but the reply is unreadable', r.result === 'unreachable' && r.detail === 'Failed to fetch', r);
  handler = netFail;
  r = await S.testConnection();
  ok('test: nothing answers', r.result === 'nonet', r);

  handler = (u, o) => o.method === 'GET' ? good(u, o) : json({ ok: false, error: 'unauthorized' });
  ok('test: bad key', (await S.testConnection()).result === 'unauthorized');
  handler = (u, o) => o.method === 'GET' ? good(u, o) : json({ ok: false, error: 'server token not set' });
  ok('test: example token', (await S.testConnection()).result === 'tokenunset');
  handler = () => reply(200, '<html>login</html>');
  ok('test: not the app (html)', (await S.testConnection()).result === 'notapp');
  handler = () => reply(404, 'nope');
  r = await S.testConnection();
  ok('test: not the app (http)', r.result === 'notapp' && r.detail === 'HTTP 404', r);
  handler = () => json({ hello: 'world' });
  ok('test: not the app (other json)', (await S.testConnection()).result === 'notapp');
  ok('testing never records a sync error', S.syncInfo().lastError.code === 'notjson');

  // a new address forgets the old error; signing out too
  handler = good;
  await S.configureSync(URL_ + '2', 'secret-token-123');
  ok('new address clears last error', S.syncInfo().lastError === null);
  await S.configureSync('', '');
  ok('test without sync', (await S.testConnection()).result === 'off');

  // every string exists in both languages
  const I = require('../app/i18n.js');
  const missing = Object.keys(I.es).filter(k => !(k in I.en)).concat(Object.keys(I.en).filter(k => !(k in I.es)));
  ok('i18n keys match in es and en', missing.length === 0, missing);

  // addresses the app must refuse: Google's test (/dev) and editor addresses
  const src = require('fs').readFileSync(__dirname + '/../app/app.js', 'utf8');
  const notExec = new Function(/function notExec\(u\) \{.*\}/.exec(src)[0] + '; return notExec;')();
  ok('/exec is accepted', !notExec('https://script.google.com/macros/s/AKfyc_x/exec'));
  ok('/exec with a query is accepted', !notExec('https://script.google.com/macros/s/AKfyc_x/exec?a=1'));
  ok('/dev is refused', notExec('https://script.google.com/macros/s/AKfyc_x/dev'));
  ok('editor address is refused', notExec('https://script.google.com/home/projects/abc/edit'));
  ok('other hosts are left alone', !notExec('http://127.0.0.1:8124/exec') && !notExec('https://example.com/sync'));

  console.log(`${checks} checks, ${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
