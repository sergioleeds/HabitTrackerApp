const { chromium } = require('playwright');
const { serve } = require('./gas_harness.js');
const APP = process.env.APP || 'http://127.0.0.1:8123/', TOKEN = 'secret-token-123', GAS = 'http://127.0.0.1:8124/exec';
let fails = 0, checks = 0;
function ok(label, cond, extra) { checks++; if (!cond) { fails++; console.log('FAIL', label, extra !== undefined ? JSON.stringify(extra) : ''); } else console.log('ok  ', label); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, label, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch (e) {} await sleep(100); } ok(label + ' (timeout)', false); return false; }

(async () => {
  const mock = await serve(8124, TOKEN);
  const browser = await chromium.launch();
  const errs = [];
  async function device(name) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-ES', isMobile: true, hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(name + ' pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|503/.test(m.text())) errs.push(name + ' console: ' + m.text()); });
    page.on('dialog', d => d.accept());
    await page.goto(APP);
    return { ctx, page, name };
  }
  const row = (p, name) => p.locator(`.row:has(.rname:text-is("${name}"))`);
  const tab = (p, t) => p.click(`.tab[data-tab=${t}]`);
  const pill = (p) => p.locator('#pilltext').innerText();

  // ================= A: first run, logging =================
  const A = await device('A'), pa = A.page;
  await pa.waitForSelector('.empty');
  ok('empty state shown first', await pa.locator('.empty h2').innerText() === 'Aún no tienes hábitos');
  ok('pill says device only', (await pill(pa)) === 'Solo en este dispositivo');

  // create a custom habit through the editor
  await pa.click('.empty >> text=Añadir hábito');
  await pa.waitForSelector('dialog[open]');
  await pa.click('dialog >> text=Guardar');
  ok('name validation', (await pa.locator('dialog .err').innerText()).includes('nombre'));
  await pa.fill('#f-name', 'Flexiones');
  await pa.click('dialog .segb:text-is("Cantidad")');
  await pa.fill('#f-unit', 'reps');
  await pa.fill('#f-goal', '50');
  await pa.click('dialog .segb:text-is("Promedio")');
  await pa.click('dialog >> text=Guardar');
  await pa.waitForSelector('dialog', { state: 'detached' });
  await pa.click('.tab[data-tab=habits] >> nth=0');
  await pa.click('text=Añadir hábito >> nth=0');
  await pa.waitForSelector('dialog[open]');
  await pa.fill('#f-name', 'Meditar');
  await pa.click('dialog >> text=Guardar');
  await pa.waitForSelector('dialog', { state: 'detached' });
  await tab(pa, 'today');
  ok('two habits listed', (await pa.locator('.row').count()) === 2);

  // checkbox
  const med = row(pa, 'Meditar');
  ok('unchecked initially', (await med.getAttribute('aria-checked')) === 'false');
  await med.click();
  ok('checked after tap', (await row(pa, 'Meditar').getAttribute('aria-checked')) === 'true');
  ok('strike-through style', (await row(pa, 'Meditar').locator('.rname').evaluate(e => getComputedStyle(e).textDecorationLine)) === 'line-through');
  ok('check row is touch-sized', (await row(pa, 'Meditar').boundingBox()).height >= 64);
  // number: stepper and typed value with a comma
  const fl = () => row(pa, 'Flexiones');
  await fl().locator('.step').nth(1).click();           // + (step 5)
  ok('stepper adds 5', (await fl().locator('.val').innerText()) === '5 reps');
  ok('step button is large', (await fl().locator('.step').nth(1).boundingBox()).height >= 48);
  await fl().locator('.val').click();
  await pa.fill('.valinput', '12,5'); await pa.press('.valinput', 'Enter');
  ok('typed decimal with comma', (await fl().locator('.val').innerText()) === '12,5 reps');
  await fl().locator('.val').click();
  await pa.fill('.valinput', 'abc'); await pa.press('.valinput', 'Enter');
  ok('invalid number rejected', (await fl().locator('.val').innerText()) === '12,5 reps' && (await pa.locator('#toast').innerText()).includes('número'));
  ok('average-method hint', (await fl().locator('.rsub').innerText()).includes('Te faltan'));
  const ring = await pa.locator('.ring-txt').textContent();
  ok('ring updates (1 of 2 daily, partial number)', ring === '63%', ring);   // (1 + 12.5/50)/2 = 62.5% -> 63%

  // ================= B: offline =================
  await pa.waitForTimeout(500);
  await pa.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await until(async () => (await pa.evaluate(() => navigator.serviceWorker.controller !== null)) || (await pa.reload() && false), 'service worker controls the page');
  await A.ctx.setOffline(true);
  await pa.reload();
  await pa.waitForSelector('.row');
  ok('opens offline after reload', (await pa.locator('.row').count()) === 2);
  ok('data survived reload (IndexedDB)', (await fl().locator('.val').innerText()) === '12,5 reps' && (await row(pa, 'Meditar').getAttribute('aria-checked')) === 'true');
  await row(pa, 'Meditar').click();                      // log while offline
  ok('can log offline', (await row(pa, 'Meditar').getAttribute('aria-checked')) === 'false');
  await A.ctx.setOffline(false);
  await row(pa, 'Meditar').click();

  // ================= C: dashboard / month / habits views render =================
  await tab(pa, 'panel'); await pa.waitForSelector('.kpis');
  ok('dashboard has charts', (await pa.locator('.chart svg').count()) >= 2);
  await pa.click('.linkbtn >> nth=0');
  ok('table view available', (await pa.locator('.dt').count()) === 1);
  await pa.click('.linkbtn >> nth=0');
  for (const p of ['Mes anterior', '6 meses', 'Todo', 'Este mes']) { await pa.click(`.chipbtn:text-is("${p}")`); await pa.waitForSelector('.kpis'); }
  await pa.click('.chipbtn:text-is("Elegir mes")'); ok('month picker appears', await pa.locator('.monthpick input').count() === 1);
  await pa.selectOption('#f-ph', { label: 'Flexiones' });
  ok('single-habit view shows its own KPIs', (await pa.locator('.kpis .kl').allInnerTexts()).includes('Total') && (await pa.locator('.top3').count()) === 0);
  ok('single-habit charts render', (await pa.locator('.chart svg').count()) >= 2);
  await pa.selectOption('#f-ph', 'all'); ok('back to all habits', (await pa.locator('.top3').count()) === 1);
  await tab(pa, 'month'); await pa.waitForSelector('.dayrow');
  ok('month list shows every day', (await pa.locator('.dayrow').count()) >= 28);
  await pa.click('.dayrow.now'); ok('tapping a day opens it', await pa.locator('.datebar .chip').count() === 1);
  await pa.click('.datebar .iconbtn >> nth=0'); ok('previous day shows way back chip', await pa.locator('.chip.link').count() === 1);
  await pa.click('.chip.link'); ok('back to today', await pa.locator('.datebar .chip:not(.link)').count() === 1);
  ok('cannot go into the future', await pa.locator('.datebar .iconbtn >> nth=1').isDisabled());

  // versioned edit: change goal from next month -> current month unchanged
  await tab(pa, 'habits');
  await pa.locator('.hrow:has-text("Flexiones") .iconbtn[aria-label^="Editar"]').click();
  await pa.fill('#f-goal', '80');
  await pa.click('dialog .seg.vertical .segb >> nth=1');
  await pa.click('dialog >> text=Guardar'); await pa.waitForSelector('dialog', { state: 'detached' });
  ok('current month keeps old goal', (await pa.locator('.hrow:has-text("Flexiones") .hr-sub').innerText()).includes('50'));
  // archive + undo
  await pa.locator('.hrow:has-text("Meditar") .iconbtn[aria-label^="Editar"]').click();
  await pa.click('dialog >> text=Archivar'); await pa.waitForSelector('dialog', { state: 'detached' });
  ok('archived habit leaves list', (await pa.locator('.hrow:has-text("Meditar")').count()) === 1 && (await pa.locator('h2.sect:text-is("Archivados")').count()) === 1);
  await pa.click('#toast >> text=Deshacer');
  ok('undo restores', (await pa.locator('h2.sect:text-is("Archivados")').count()) === 0);
  // language + theme
  await pa.click('.segb:text-is("English")'); ok('switch to English', (await pa.locator('.tab[data-tab=today]').innerText()).trim() === 'Today');
  await pa.click('.segb:text-is("Español")');
  await pa.click('.segb:text-is("Oscuro")'); ok('dark theme sets attribute', (await pa.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  await pa.click('.segb:text-is("Automático")');

  // ================= D: sync between two devices =================
  await pa.click('summary:text-is("Configuración manual")');
  await pa.fill('#f-url', 'http://not-https.example/exec'); await pa.fill('#f-tok', TOKEN);
  await pa.click('text=Guardar y sincronizar');
  ok('manual form rejects non-https address', (await pa.locator('#toast').innerText()).includes('https'));
  await pa.fill('#f-code', 'esto-no-es-un-codigo'); await pa.click('.btn:text-is("Conectar")');
  ok('bad code is rejected', (await pa.locator('#toast').innerText()).includes('no es válido'));
  mock.gas.run("WEB_APP_URL = '" + GAS + "'; APP_URL = '" + APP + "'");
  const setup = mock.gas.run('getSetupLink()');           // what the user copies from the Apps Script log
  await pa.fill('#f-code', setup.link); await pa.click('.btn:text-is("Conectar")');
  await pa.waitForSelector('.connected');
  ok('shows connected state', (await pa.locator('.connected').innerText()).includes('Dispositivo conectado'));
  await until(async () => (await pill(pa)) === 'Sincronizado', 'A synced');
  ok('server stored A\'s records', mock.gas.state.grid.length > 3, mock.gas.state.grid.length);

  await pa.click('.tab[data-tab=habits]');
  await pa.click('text=Copiar enlace para otro dispositivo');
  const link = await pa.evaluate(() => navigator.clipboard.readText());
  ok('link copied to clipboard', link.includes('#sync='));
  const B = await device('B'), pb = B.page;
  await pb.goto(link);
  await pb.waitForSelector('.row', { timeout: 10000 });
  ok('B imported settings and pulled habits', (await pb.locator('.row').count()) === 2 && (await pb.evaluate(() => location.hash)) === '');
  ok('B sees A\'s value', (await row(pb, 'Flexiones').locator('.val').innerText()) === '12,5 reps');
  ok('B sees A\'s check', (await row(pb, 'Meditar').getAttribute('aria-checked')) === 'true');
  ok('B synced pill', await until(async () => (await pill(pb)) === 'Sincronizado', 'B synced'));

  // both offline, conflicting edits
  await tab(pa, 'today');
  await A.ctx.setOffline(true); await B.ctx.setOffline(true);
  await row(pa, 'Meditar').click();                                     // A: uncheck
  await fl().locator('.val').click(); await pa.fill('.valinput', '30'); await pa.press('.valinput', 'Enter');    // A writes 30 first
  await sleep(30);
  await row(pb, 'Flexiones').locator('.val').click(); await pb.fill('.valinput', '45'); await pb.press('.valinput', 'Enter');  // B writes 45 later -> wins
  await pb.click('.tab[data-tab=habits]'); await pb.click('text=Añadir hábito >> nth=0'); await pb.fill('#f-name', 'Leer'); await pb.click('dialog >> text=Guardar'); await pb.waitForSelector('dialog', { state: 'detached' });
  await pb.click('.tab[data-tab=today]');
  await until(async () => /pendientes/.test(await pill(pa)), 'A shows offline pending');
  ok('A pill offline+pending', /Sin conexión · \d+ pendientes/.test(await pill(pa)), await pill(pa));
  await A.ctx.setOffline(false);
  await until(async () => (await pill(pa)) === 'Sincronizado', 'A back online and synced');
  await B.ctx.setOffline(false);
  await until(async () => (await pill(pb)) === 'Sincronizado', 'B back online and synced');
  await pa.evaluate(() => Store.sync());
  await until(async () => (await pa.locator('.row').count()) === 3, 'A receives B\'s new habit');
  ok('conflict: latest write wins on A', (await fl().locator('.val').innerText()) === '45 reps');
  ok('conflict: latest write wins on B', (await row(pb, 'Flexiones').locator('.val').innerText()) === '45 reps');
  ok('A\'s uncheck reached B', (await row(pb, 'Meditar').getAttribute('aria-checked')) === 'false');
  ok('B\'s new habit reached A', (await row(pa, 'Leer').count()) === 1);

  // server outage -> pending -> recovers
  mock.opts.down = true;
  await row(pa, 'Leer').click();
  await until(async () => /Error|No se alcanza|no es la app|pendientes/.test(await pill(pa)), 'A shows error or pending during outage');
  ok('outage visible, data kept', (await row(pa, 'Leer').getAttribute('aria-checked')) === 'true', await pill(pa));
  mock.opts.down = false;
  await pa.evaluate(() => Store.sync());
  await until(async () => (await pill(pa)) === 'Sincronizado', 'A recovers after outage');
  await pb.evaluate(() => Store.sync());
  await until(async () => (await row(pb, 'Leer').getAttribute('aria-checked')) === 'true', 'B gets the change made during outage');

  // wrong token
  const C = await device('C');
  await C.page.waitForSelector('.empty');
  await C.page.evaluate(([u]) => Store.configureSync(u, 'wrong-token-xyz'), [GAS]);
  await until(async () => /Clave/.test(await pill(C.page)), 'wrong token shows error');
  ok('wrong token is rejected by server', /Clave no válida/.test(await pill(C.page)));

  // sign out and reconnect with the bare code
  await C.page.click('.tab[data-tab=habits]');
  await C.page.click('.btn:text-is("Cerrar sesión")');
  await until(async () => (await pill(C.page)) === 'Solo en este dispositivo', 'sign out returns to local-only');
  await C.page.fill('#f-code', setup.code); await C.page.click('.btn:text-is("Conectar")');
  await until(async () => (await pill(C.page)) === 'Sincronizado', 'bare code connects and syncs');
  await C.page.click('.tab[data-tab=today]');
  await until(async () => (await C.page.locator('.row').count()) === 3, 'C received the account\'s habits');

  // server wiped -> client re-sends everything
  mock.gas.state.grid.length = 0; mock.gas.run('sheet_().getRange(1,1,1,4).setValues([["k","v","t","s"]])');
  await pa.evaluate(() => Store.sync());
  await until(async () => mock.gas.state.grid.length > 5, 'server repopulated after reset');
  ok('reset re-sent all records', mock.gas.state.grid.length - 1 >= 5, mock.gas.state.grid.length);

  // JS errors anywhere?
  ok('no JS errors in any device', errs.length === 0, errs);
  console.log(`${checks} checks, ${fails} failures`);
  await browser.close(); mock.server.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
