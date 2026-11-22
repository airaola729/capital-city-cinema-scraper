// Temporary: save raw samples of the new sources for parser development.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const UA = 'CapitalCityCinema/1.0 (+https://github.com/airaola729/capital-city-cinema-scraper)';
const plain = [
  ['alamo-dc-metro-area.json', 'https://drafthouse.com/s/mother/v2/schedule/market/dc-metro-area'],
  ['alamo-northern-virginia.json', 'https://drafthouse.com/s/mother/v2/schedule/market/northern-virginia'],
  ['fever-georgetown.html', 'https://feverup.com/movies/en/united-states/movie-theaters/amc-georgetown-14'],
  ['fever-hoffman.html', 'https://feverup.com/movies/en/united-states/movie-theaters/amc-hoffman-center-22'],
  ['fever-tysons.html', 'https://feverup.com/movies/en/united-states/movie-theaters/amc-tysons-corner-16'],
  ['miracle-movies.html', 'https://themiracletheatre.com/event-category/in-theatre-movies/'],
];
await mkdir('samples', { recursive: true });
for (const [f, u] of plain) {
  try { const r = await fetch(u, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) }); await writeFile('samples/' + f, await r.text()); console.log('saved', f, r.status); }
  catch (e) { console.log('fail', f, e.message); }
  await new Promise(r => setTimeout(r, 1500));
}
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ timezoneId: 'America/New_York', locale: 'en-US' });
const page = await ctx.newPage(); let i = 0; const log = [];
page.on('response', async r => {
  if (!r.url().includes('readingcinemas.com')) return;
  log.push(`${r.status()} ${r.url()}`);
  try { const t = await r.text(); if (t.length > 200) await writeFile(`samples/angelika-api-${++i}.json`, `// ${r.url()}\n` + t); } catch {}
});
try {
  await page.goto('https://angelikafilmcenter.com/dc', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(10000);
  await writeFile('samples/angelika-page.html', await page.content());
  // also the showtimes page if there is one
  const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => a.href).filter(h => /showtime|movies|now-playing/i.test(h)).slice(0, 30));
  log.push('LINKS ' + JSON.stringify(links));
} catch (e) { log.push('ERR ' + e.message); }
await writeFile('samples/angelika-log.txt', log.join('\n'));
await browser.close();
