// Fill a fresh page with example habits + ~75 days of plausible logs.
module.exports = async function seedPage(page) {
  await page.waitForSelector('.empty');
  await page.click('text=Cargar ejemplos');
  await page.waitForSelector('.row');
  await page.evaluate(() => {
    const E = HabitEngine, st = Store.state(), today = E.localToday();
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const habs = E.sortedHabits(st), pairs = [], first = E.addMonths(E.monthKey(today), -2);
    for (let i = 74; i >= 0; i--) {
      const d = E.addDays(today, -i);
      if (E.monthKey(d) < first) continue;
      habs.forEach(h => {
        const c = h.versions[0];
        if (h.type === 'check') { if (rnd() < (c.period === 'monthly' ? 0.3 : 0.72)) pairs.push(['l:' + d + ':' + h.id, true]); }
        else if (rnd() < 0.88) pairs.push(['l:' + d + ':' + h.id, Math.round(c.goal * (0.2 + rnd() * 1.4) * 10) / 10]);
      });
    }
    habs.forEach(h => { const c = JSON.parse(JSON.stringify(h)); delete c.id; c.versions[0].from = first; pairs.push(['h:' + h.id, c]); });
    Store.putMany(pairs);
  });
  await page.waitForTimeout(300);
};
