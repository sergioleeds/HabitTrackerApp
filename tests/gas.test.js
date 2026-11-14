const { boot } = require('./gas_harness.js');
let fails = 0, checks = 0;
function ok(label, cond, extra) { checks++; if (!cond) { fails++; console.log('FAIL', label, extra !== undefined ? JSON.stringify(extra) : ''); } }
const TOKEN = 'secret-token-123';
const gas = boot({ token: TOKEN, now: new Date(2026, 10, 8, 21, 0, 0) });
gas.run('setup()');
const post = (o) => gas.post(Object.assign({ token: TOKEN }, o));

// --- auth & validation ---
ok('bad json', gas.post('{nope').error === 'bad request');
ok('no token', gas.post({ since: 0, push: [] }).error === 'unauthorized');
ok('wrong token', gas.post({ token: 'x', since: 0 }).error === 'unauthorized');
const unset = boot(); unset.run('sheet_()');
ok('default token refused', unset.post({ token: 'CAMBIA-ESTA-CLAVE' }).error === 'server token not set');
gas.run('PAGE_SIZE = 3');

// --- push + pull ---
let r = post({ since: 0, push: [
  { k: 'h:h1', v: { name: 'Meditar', type: 'check', unit: '', order: 1, versions: [{ from: '2026-11', goal: 1, period: 'daily', method: 'strict', weight: 1 }] }, t: 1000 },
  { k: 'l:2026-11-08:h1', v: true, t: 1001 },
  { k: 'l:2026-11-07:h1', v: false, t: 1002 },
  { k: 'l:2026-11-06:h1', v: 12.5, t: 1003 },
  { k: 'evil key', v: 1, t: 1 }, { k: 'l:2026-11-06:h1', v: 'old', t: 5 }, { k: 'l:bad', v: 1, t: 1 }
] });
ok('push ok', r.ok === true, r);
ok('paged (more)', r.more === true && r.records.length === 3, { more: r.more, n: r.records.length });
let cursor = r.cursor, all = r.records.slice();
while (r.more) { r = post({ since: cursor, push: [] }); cursor = r.cursor; all = all.concat(r.records); }
ok('4 valid records, invalid dropped', all.length === 4, all.map(x => x.k));
ok('types survive the sheet (true stays boolean)', all.find(x => x.k === 'l:2026-11-08:h1').v === true);
ok('false stays boolean', all.find(x => x.k === 'l:2026-11-07:h1').v === false);
ok('number stays number', all.find(x => x.k === 'l:2026-11-06:h1').v === 12.5);
ok('older write ignored', all.find(x => x.k === 'l:2026-11-06:h1').t === 1003);
ok('cursor equals seq', cursor === 4, cursor);

// --- LWW from a second device ---
r = post({ since: 4, push: [{ k: 'l:2026-11-08:h1', v: null, t: 2000 }, { k: 'l:2026-11-08:h1', v: true, t: 1500 }] });
ok('newer clear wins', r.records.length === 1 && r.records[0].v === null && r.records[0].t === 2000, r.records);
r = post({ since: 0, push: [] }); ok('server has 5 records after paging', r.records.length === 3 && r.more);
// equal timestamp does not overwrite
const before = gas.state.grid.length;
post({ since: 5, push: [{ k: 'l:2026-11-08:h1', v: true, t: 2000 }] });
r = post({ since: 4, push: [] }); ok('tie keeps existing', r.records[0].v === null, r.records);

// --- reset detection ---
r = post({ since: 999, push: [] });
ok('reset flagged when client is ahead', r.reset === true && r.records.length === 3, { reset: r.reset, n: r.records.length });

// --- bulk update path (>25 changed rows) ---
const bulk = []; for (let i = 1; i <= 40; i++) bulk.push({ k: 'l:2026-10-' + String(i % 28 + 1).padStart(2, '0') + ':h' + i, v: i, t: 3000 + i });
post({ since: 0, push: bulk });
post({ since: 0, push: bulk.map(b => ({ k: b.k, v: b.v + 100, t: b.t + 1000 })) });
gas.run('PAGE_SIZE = 500');
r = post({ since: 0, push: [] });
ok('bulk updated', r.records.filter(x => x.k.indexOf('l:2026-10') === 0).every(x => x.v > 100), r.records.length);
ok('no duplicate keys', new Set(r.records.map(x => x.k)).size === r.records.length);
ok('seq strictly unique', new Set(r.records.map(x => x.s)).size === r.records.length);

// --- reminder (today = 2026-11-08, 21:00) ---
const R = boot({ token: TOKEN, now: new Date(2026, 10, 8, 21, 0, 0) });
R.run('setup()');
const rp = (o) => R.post(Object.assign({ token: TOKEN }, o));
const ver = (g, p, m, w) => [{ from: '2026-11', goal: g, period: p, method: m, weight: w }];
rp({ since: 0, push: [
  { k: 'h:a', v: { name: 'Meditar', type: 'check', unit: '', order: 1, versions: ver(1, 'daily', 'strict', 1) }, t: 1 },
  { k: 'h:b', v: { name: 'Flexiones', type: 'number', unit: 'reps', order: 2, versions: ver(50, 'daily', 'average', 1) }, t: 1 },
  { k: 'h:c', v: { name: 'Sueño', type: 'number', unit: 'h', order: 3, versions: ver(8, 'daily', 'strict', 1) }, t: 1 },
  { k: 'h:d', v: { name: 'Gimnasio', type: 'check', unit: 'sesiones', order: 4, versions: ver(12, 'monthly', 'strict', 1) }, t: 1 },
  { k: 'l:2026-11-08:c', v: 6, t: 2 }, { k: 'l:2026-11-08:b', v: 20, t: 2 }, { k: 'l:2026-11-01:d', v: true, t: 2 }
] });
let res = R.run('sendDailyReminder()');
ok('reminder sent', res.sent === true && R.state.mails.length === 1, res);
const mail = R.state.mails[0];
console.log('--- email ---\n' + mail.subject + '\n' + mail.body + '\n-------------');
ok('mail to owner', mail.to === 'serg@example.com');
ok('lists unchecked habit', /\[ \] Meditar/.test(mail.body));
ok('lists number below goal', /Sueño: 6 \/ 8 h/.test(mail.body));
ok('average habit shows catch-up', /Flexiones: te faltan 380 reps para ir al día/.test(mail.body), mail.body);
ok('monthly below pace', /Gimnasio: 1 \/ 12 sesiones este mes \(por debajo del ritmo\)/.test(mail.body), mail.body);
ok('subject counts', /Te quedan 4 hábitos hoy/.test(mail.subject), mail.subject);
// complete everything -> no mail
rp({ since: 0, push: [{ k: 'l:2026-11-08:a', v: true, t: 5 }, { k: 'l:2026-11-08:b', v: 400, t: 5 }, { k: 'l:2026-11-08:c', v: 8, t: 5 }, { k: 'l:2026-11-08:d', v: true, t: 5 },
  ...Array.from({ length: 7 }, (_, i) => ({ k: 'l:2026-11-0' + (i + 2) + ':d', v: true, t: 5 })) ] });
// flexiones: 20 -> 400 on day 8 means total 400 >= 50*8
R.state.mails.length = 0;
res = R.run('sendDailyReminder()');
ok('no mail when all done', res.sent === false && R.state.mails.length === 0, { res, mails: R.state.mails });
// triggers
R.run('installTriggers()'); R.run('installTriggers()');
ok('one trigger after reinstall', R.state.triggers.length === 1 && R.state.triggers[0].fn === 'sendDailyReminder');
R.run('removeTriggers()'); ok('triggers removed', R.state.triggers.length === 0);

// --- setup link ---
let threw = false; try { R.run('getSetupLink()'); } catch (e) { threw = true; }
ok('setup link needs WEB_APP_URL', threw);
R.state.deployUrl = 'https://script.google.com/macros/s/AKfyc_HEAD/dev';   // what getUrl() gives in the editor: must never be used
threw = false; try { R.run('getSetupLink()'); } catch (e) { threw = /WEB_APP_URL/.test(e.message); }
ok('setup link ignores ScriptApp getUrl', threw);
R.run("WEB_APP_URL = 'https://script.google.com/macros/s/AKfyc_HEAD/dev'");
threw = false; try { R.run('getSetupLink()'); } catch (e) { threw = /\/exec/.test(e.message); }
ok('setup link refuses a /dev address', threw);
R.run("WEB_APP_URL = 'https://script.google.com/home/projects/abc/edit'");
threw = false; try { R.run('getSetupLink()'); } catch (e) { threw = true; }
ok('setup link refuses the editor address', threw);
const EXEC = 'https://script.google.com/macros/s/AKfyc_TEST/exec';
R.run("WEB_APP_URL = '  " + EXEC + " '");
R.run("APP_URL = 'https://habits.example.app/'");
const sl = R.run('getSetupLink()');
const decoded = JSON.parse(decodeURIComponent(escape(Buffer.from(sl.code, 'base64').toString('binary'))));
ok('setup link carries URL and key', decoded.u === EXEC && decoded.k === TOKEN, decoded);
ok('setup link points at the app', sl.link === 'https://habits.example.app/#sync=' + sl.code);
console.log(`${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
