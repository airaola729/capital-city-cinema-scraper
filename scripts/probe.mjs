// Diagnostic: what happens on a Fever theater page after a date tile is clicked.
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ timezoneId: 'America/New_York', locale: 'en-US', viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
const t0 = Date.now(); const ts = () => ((Date.now() - t0) / 1000).toFixed(2);
page.on('request', r => { if (['xhr', 'fetch'].includes(r.resourceType())) console.log(ts(), 'REQ', r.method(), r.url().slice(0, 200)); });
page.on('response', r => { if (['xhr', 'fetch'].includes(r.request().resourceType())) console.log(ts(), 'RES', r.status(), r.url().slice(0, 200)); });
await page.goto('https://feverup.com/movies/en/united-states/movie-theaters/amc-hoffman-center-22', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(4000);
const state = () => page.evaluate(() => ({
  active: document.querySelector('.date-tile--is-active time')?.getAttribute('datetime'),
  cards: document.querySelectorAll('[data-testid="showtimes-card"]').length,
  first: document.querySelector('[data-testid="showtimes-card"] .movie-info__title')?.textContent.trim(),
  times: document.querySelectorAll('[data-testid="movie-showtimes-item"]').length,
  loaders: document.querySelectorAll('[class*="skeleton"], [class*="loading"], [class*="spinner"], [aria-busy="true"]').length,
  empty: (document.querySelector('.theater-body')?.textContent.match(/no (showtimes|movies)[^.]{0,60}/i) || [])[0] || null,
  url: location.href,
}));
console.log(ts(), 'INITIAL', JSON.stringify(await state()));
for (const dt of ['2026-11-23', '2026-11-24', '2026-11-28']) {
  console.log(ts(), '--- click', dt);
  await page.evaluate(dt => document.querySelector(`[data-carousel="date-list"] time[datetime="${dt}"]`)?.closest('button')?.click(), dt);
  for (let i = 0; i < 24; i++) { await page.waitForTimeout(250); const s = await state(); if (i % 2 === 0 || i < 6) console.log(ts(), 'STATE', JSON.stringify(s)); }
}
await browser.close();
