// One-off: save raw samples of candidate sources to samples/ for offline inspection.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const ET = 'America/New_York';
const day = n => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA', { timeZone: ET });
const BS = { georgetown: 8353, hoffman: 7845, tysons: 9803, 'alamo-dc': 51802, 'alamo-cc': 52577, afi: 8500, miracle: 42899, angelika: 38754 };
const plain = [
  ['bigscreen-robots.txt', 'https://www.bigscreen.com/robots.txt'],
  ['fever-robots.txt', 'https://feverup.com/robots.txt'],
  ['miracle-robots.txt', 'https://themiracletheatre.com/robots.txt'],
  ['bigscreen-georgetown-full.html', `https://www.bigscreen.com/Marquee.php?theater=8353&view=sched&showdate=${day(0)}&sort=date`],
  ['bigscreen-georgetown-plus7.html', `https://www.bigscreen.com/Marquee.php?theater=8353&view=sched&printable=1&showdate=${day(7)}`],
  ...Object.entries(BS).map(([id, n]) => [`bigscreen-${id}.html`, `https://www.bigscreen.com/Marquee.php?theater=${n}&view=sched&printable=1&showdate=${day(0)}`]),
  ['fever-georgetown.html', 'https://feverup.com/movies/en/united-states/movie-theaters/amc-georgetown-14'],
  ['miracle-movies.html', 'https://themiracletheatre.com/event-category/in-theatre-movies/'],
];
await mkdir('samples', { recursive: true });
for (const [f, u] of plain) {
  try { const r = await fetch(u, { signal: AbortSignal.timeout(30000) }); await writeFile('samples/' + f, `<!-- ${u} HTTP ${r.status} -->\n` + await r.text()); console.log('saved', f, r.status); }
  catch (e) { console.log('fail', f, e.message); }
  await new Promise(r => setTimeout(r, 1500));
}
// Browser: record XHR URLs (and JSON bodies) for Alamo DC and Angelika DC.
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ timezoneId: ET, locale: 'en-US' });
for (const [name, url] of [['alamo', 'https://drafthouse.com/washington-dc'], ['angelika', 'https://angelikafilmcenter.com/dc']]) {
  const page = await ctx.newPage(); const log = []; let i = 0;
  page.on('response', async r => {
    const t = r.request().resourceType(); if (!['xhr', 'fetch'].includes(t)) return;
    log.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    if ((r.headers()['content-type'] || '').includes('json') && i < 12) { try { await writeFile(`samples/${name}-xhr-${++i}.json`, `// ${r.url()}\n` + await r.text()); } catch {} }
  });
  try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); await page.waitForTimeout(10000); await writeFile(`samples/${name}-page.html`, await page.content()); } catch (e) { log.push('ERR ' + e.message); }
  await writeFile(`samples/${name}-xhr.txt`, log.join('\n')); console.log(name, log.length, 'xhr');
  await page.close();
}
await browser.close();
