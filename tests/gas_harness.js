/* Runs the real server/Code.gs + server/Engine.gs inside a vm with stubbed Google services,
 * and exposes them as an HTTP endpoint (like an Apps Script /exec web app) for the browser tests.
 * The Sheet stub mimics the one Sheets behaviour that bites: text-looking values are converted
 * to booleans/numbers unless the column is formatted as plain text. */
const vm = require('vm'), fs = require('fs'), http = require('http'), path = require('path');
const SERVER = path.join(__dirname, '..', 'server');

function makeSheetStub() {
  const grid = [];                 // grid[r][c] 0-based
  const fmt = {};                  // col index -> '@'
  const sheet = {
    getLastRow: () => grid.length,
    getRange(a, b, c, d) {
      if (typeof a === 'string') { // 'A:B'
        const m = /^([A-Z]):([A-Z])$/.exec(a); const c0 = m[1].charCodeAt(0) - 65, c1 = m[2].charCodeAt(0) - 65;
        return { setNumberFormat: f => { for (let i = c0; i <= c1; i++) fmt[i] = f; return this; } };
      }
      const r0 = a - 1, c0 = b - 1, nr = c || 1, nc = d || 1;
      const rng = {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (grid[r0 + i] || [])[c0 + j] ?? '')),
        setValues: (vals) => {
          vals.forEach((row, i) => { grid[r0 + i] = grid[r0 + i] || []; row.forEach((v, j) => {
            const col = c0 + j;
            if (fmt[col] !== '@' && typeof v === 'string') { if (v === 'true') v = true; else if (v === 'false') v = false; else if (v !== '' && !isNaN(Number(v))) v = Number(v); }
            grid[r0 + i][col] = v;
          }); });
          return rng;
        },
        setFontWeight: () => rng, setNumberFormat: () => rng
      };
      return rng;
    },
    setFrozenRows: () => {}
  };
  return { sheet, grid };
}

function boot(opts = {}) {
  const { sheet, grid } = makeSheetStub();
  const state = { sheet, grid, mails: [], triggers: [], now: opts.now || new Date(), logs: [], sheets: { }, requests: 0 };
  let sh = null;
  const ctx = {
    console,
    Logger: { log: (m) => state.logs.push(String(m)) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getSheetByName: (n) => (n === 'Datos' ? sh : null),
      insertSheet: (n) => { sh = sheet; if (grid.length === 0) {} return sheet; }
    }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ t, setMimeType() { return this; }, getContent() { return t; } }) },
    Utilities: { Charset: { UTF_8: 'utf8' }, base64Encode: (str) => Buffer.from(str, 'utf8').toString('base64'), formatDate: (d, tz, f) => { const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); } },
    Session: { getScriptTimeZone: () => 'Europe/Madrid', getEffectiveUser: () => ({ getEmail: () => 'serg@example.com' }) },
    MailApp: { sendEmail: (to, subject, body) => state.mails.push({ to, subject, body }) },
    ScriptApp: {
      getService: () => ({ getUrl: () => state.deployUrl || '' }),
      getProjectTriggers: () => state.triggers,
      deleteTrigger: (t) => { state.triggers = state.triggers.filter(x => x !== t); },
      newTrigger: (fn) => { const t = { fn, getHandlerFunction: () => fn }; const b = { timeBased: () => b, everyDays: () => b, atHour: () => b, create: () => { state.triggers.push(t); return t; } }; return b; }
    },
    Date: class extends Date { constructor(...a) { if (a.length === 0) super(state.now); else super(...a); } }
  };
  vm.createContext(ctx);
  let code = fs.readFileSync(path.join(SERVER, 'Engine.gs'), 'utf8') + '\n' + fs.readFileSync(path.join(SERVER, 'Code.gs'), 'utf8');
  if (opts.token) code = code.replace("var TOKEN = 'CAMBIA-ESTA-CLAVE';", "var TOKEN = '" + opts.token + "';");
  vm.runInContext(code, ctx, { filename: 'Code.gs' });
  const post = (bodyObj) => {
    state.requests++;
    const out = ctx.doPost({ postData: { contents: typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj) } });
    return JSON.parse(out.getContent());
  };
  return { ctx, state, post, run: (fn) => vm.runInContext(fn, ctx) };
}

function serve(port, token, opts = {}) {
  const gas = boot({ token, ...opts });
  gas.run('setup()');
  const server = http.createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    if (opts.down) { res.writeHead(503, cors); return res.end('down'); }
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }  // real Apps Script has no preflight support; the app avoids it
    if (req.method === 'GET') { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); return res.end(JSON.stringify(JSON.parse(gas.ctx.doGet().getContent()))); }
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => {
      if ((req.headers['content-type'] || '').indexOf('text/plain') !== 0) { res.writeHead(400, cors); return res.end('non-simple content type'); }
      const j = gas.post(data);
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(j));
    });
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r({ server, gas, opts })));
}

module.exports = { boot, serve };
if (require.main === module) serve(8124, 'secret-token-123').then(() => console.log('mock Apps Script on 8124'));
