/**
 * Habit tracker · sync backend (Google Apps Script, bound to a Google Sheet).
 *
 * What it does
 *  - Stores every record the app syncs in the sheet "Datos" (one row per record: key, JSON value, time, sequence).
 *  - doPost: merges what a device sends (newest write wins per record) and returns what that device has not seen yet.
 *  - sendDailyReminder: optional email listing what is still pending today (uses Engine.gs, the same rules as the app).
 *
 * Setup (once): see README.md. In short:
 *  1. Put your own secret in TOKEN below.
 *  2. Run `setup` once and accept the permissions.
 *  3. Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone.
 *     Copy the web app URL (it ends in /exec) into WEB_APP_URL below, then run `getSetupLink`.
 *  4. Optional: run `installTriggers` for the daily email.
 *
 * The sheet is only reachable by someone who knows both the address and the TOKEN.
 */

// ---------- settings you may change ----------
var TOKEN = 'CAMBIA-ESTA-CLAVE';       // required: any long random text. Paste the same text in the app.
var WEB_APP_URL = '';                  // required for getSetupLink: the web app URL from Deploy > Manage deployments (ends in /exec)
var REMINDER_HOUR = 21;                // hour of the day (script time zone) for the reminder email
var REMINDER_LANG = 'es';              // 'es' or 'en'
var APP_URL = '';                      // optional: where you host the app, added to the email
var SHEET_NAME = 'Datos';
var PAGE_SIZE = 500;                   // records sent back per request
var MAX_PUSH = 1000;                   // records accepted per request

var DEFAULT_TOKEN_ = 'CAMBIA-ESTA-CLAVE';

// ---------- web app ----------
function doGet() {
  return json_({ ok: true, app: 'habit-tracker-sync' });   // health check, no data
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad request' }); }
  if (TOKEN === DEFAULT_TOKEN_ || TOKEN.length < 8) return json_({ ok: false, error: 'server token not set' });
  if (!body || !safeEqual_(String(body.token || ''), TOKEN)) return json_({ ok: false, error: 'unauthorized' });

  var lock = LockService.getScriptLock();
  try { lock.waitLock(25000); } catch (err) { return json_({ ok: false, error: 'busy, try again' }); }
  try {
    return json_(handle_(body));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function handle_(body) {
  var sh = sheet_();
  var last = sh.getLastRow();
  var rows = last > 1 ? sh.getRange(2, 1, last - 1, 4).getValues() : [];
  var index = {}, maxSeq = 0, i;
  for (i = 0; i < rows.length; i++) {
    index[rows[i][0]] = i;
    if (rows[i][3] > maxSeq) maxSeq = rows[i][3];
  }
  var since = Number(body.since) || 0;
  var reset = since > maxSeq;              // the device remembers more than this sheet has (sheet was emptied)
  if (reset) since = 0;

  // ---- merge pushed records: newest client time wins ----
  var push = Array.isArray(body.push) ? body.push.slice(0, MAX_PUSH) : [];
  var seq = maxSeq, changed = {}, originalLen = rows.length, nChanged = 0;
  push.forEach(function (p) {
    if (!p || typeof p.k !== 'string' || p.k.length > 120 || typeof p.t !== 'number' || !isFinite(p.t)) return;
    if (!/^(h:[A-Za-z0-9_-]+|l:\d{4}-\d{2}-\d{2}:[A-Za-z0-9_-]+|s:[A-Za-z0-9_-]+)$/.test(p.k)) return;
    var text = JSON.stringify(p.v === undefined ? null : p.v);
    if (text.length > 20000) return;
    var at = index[p.k];
    if (at === undefined) {
      seq++; rows.push([p.k, text, p.t, seq]); index[p.k] = rows.length - 1; nChanged++;
    } else if (p.t > rows[at][2]) {
      seq++; rows[at] = [p.k, text, p.t, seq]; changed[at] = true; nChanged++;
    }
  });
  if (nChanged) writeRows_(sh, rows, changed, originalLen);

  // ---- send back what the device has not seen ----
  var fresh = [];
  for (i = 0; i < rows.length; i++) if (rows[i][3] > since) fresh.push(rows[i]);
  fresh.sort(function (a, b) { return a[3] - b[3]; });
  var more = fresh.length > PAGE_SIZE;
  if (more) fresh = fresh.slice(0, PAGE_SIZE);
  var out = fresh.map(function (r) { return { k: r[0], v: JSON.parse(String(r[1])), t: Number(r[2]), s: Number(r[3]) }; });
  return { ok: true, records: out, cursor: more ? fresh[fresh.length - 1][3] : seq, more: more, reset: reset };
}

function writeRows_(sh, rows, changed, originalLen) {
  var idx = Object.keys(changed).map(Number);
  if (idx.length > 25) {                                   // many edits: one write for the whole table
    sh.getRange(2, 1, rows.length, 4).setValues(rows);
    return;
  }
  idx.forEach(function (i) { sh.getRange(i + 2, 1, 1, 4).setValues([rows[i]]); });
  if (rows.length > originalLen) sh.getRange(originalLen + 2, 1, rows.length - originalLen, 4).setValues(rows.slice(originalLen));
}

// ---------- sheet ----------
function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, 4).setValues([['k', 'v', 't', 's']]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:B').setNumberFormat('@');               // keep "true", "12" and JSON as text; Sheets must not convert them
  }
  return sh;
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}


// ---------- connection link for the app ----------
/**
 * Run this after deploying the web app. Open View > Logs (or Execution log) and copy the link:
 * opening it on any device connects that device to this sheet (it is like signing in).
 * Keep the link private: it contains your key.
 */
function getSetupLink() {
  if (TOKEN === DEFAULT_TOKEN_ || TOKEN.length < 8) throw new Error('Edit TOKEN at the top of Code.gs first (at least 8 characters).');
  // Not ScriptApp.getService().getUrl(): run from the editor it can return the test address (/dev) or another
  // deployment's, which only answer to a signed-in owner, so the app could never reach them.
  var url = String(WEB_APP_URL || '').trim();
  if (!url) throw new Error('Paste the web app URL in WEB_APP_URL at the top of Code.gs: Deploy > Manage deployments > Web app URL (it ends in /exec). Deploy first if you have not (Deploy > New deployment > Web app, access: Anyone).');
  if (!/^https?:\/\/[^\s]+\/exec$/.test(url)) throw new Error('WEB_APP_URL must be the web app URL that ends in /exec (not /dev, and not the editor address). Copy it from Deploy > Manage deployments.');
  var code = Utilities.base64Encode(JSON.stringify({ u: url, k: TOKEN }), Utilities.Charset.UTF_8);
  var link = (APP_URL || 'https://YOUR-APP-ADDRESS/') + '#sync=' + code;
  Logger.log('Code (paste it in the app: Habits > Account):\n' + code);
  Logger.log('Link (open it on each device):\n' + link);
  return { code: code, link: link };
}

// ---------- one-time setup ----------
function setup() {
  if (TOKEN === DEFAULT_TOKEN_ || TOKEN.length < 8) throw new Error('Edit TOKEN at the top of Code.gs first (at least 8 characters).');
  sheet_().getRange('A:B').setNumberFormat('@');
  Logger.log('Ready. Now deploy as a web app (Execute as: Me, Access: Anyone) and paste the /exec address in the app.');
}

// ---------- daily reminder ----------
function loadState_() {
  var sh = sheet_(), last = sh.getLastRow();
  var rows = last > 1 ? sh.getRange(2, 1, last - 1, 2).getValues() : [];
  var state = { habits: {}, logs: {}, prefs: { threshold: 0.7 } };
  rows.forEach(function (r) {
    var k = String(r[0]), v;
    try { v = JSON.parse(String(r[1])); } catch (e) { return; }
    if (v === null) return;
    if (k.indexOf('h:') === 0) { v.id = k.slice(2); state.habits[v.id] = v; }
    else if (k.indexOf('l:') === 0) {
      var p = k.split(':');
      (state.logs[p[1]] = state.logs[p[1]] || {})[p[2]] = v;
    } else if (k === 's:prefs' && typeof v.threshold === 'number') state.prefs.threshold = v.threshold;
  });
  return state;
}

function reminderLines_(pending) {
  var es = REMINDER_LANG === 'es';
  return pending.map(function (p) {
    var u = p.unit ? ' ' + p.unit : '';
    if (p.kind === 'check') return '[ ] ' + p.name;
    if (p.kind === 'number') return p.name + ': ' + p.value + ' / ' + p.goal + u;
    if (p.kind === 'behind') return p.name + (es ? ': te faltan ' : ': ') + p.missing + u + (es ? ' para ir al día' : ' to catch up');
    return p.name + ': ' + p.total + ' / ' + p.goal + u + (es ? ' este mes (por debajo del ritmo)' : ' this month (behind pace)');
  });
}

/** Sends one email with what is still pending today. Does nothing if everything is done. */
function sendDailyReminder() {
  var state = loadState_();
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var pending = HabitEngine.pendingToday(state, today);
  if (!pending.length) return { sent: false };
  var es = REMINDER_LANG === 'es';
  var subject = es ? 'Te quedan ' + pending.length + (pending.length === 1 ? ' hábito hoy' : ' hábitos hoy')
                   : pending.length + (pending.length === 1 ? ' habit left today' : ' habits left today');
  var body = reminderLines_(pending).join('\n') + (APP_URL ? '\n\n' + (es ? 'Abrir la app: ' : 'Open the app: ') + APP_URL : '');
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), subject, body);
  return { sent: true, count: pending.length };
}

/** Run once to schedule the daily email. Check the script time zone in Project settings. */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDailyReminder') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDailyReminder').timeBased().everyDays(1).atHour(REMINDER_HOUR).create();
}

function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDailyReminder') ScriptApp.deleteTrigger(t);
  });
}
