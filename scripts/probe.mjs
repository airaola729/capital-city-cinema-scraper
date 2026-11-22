// Diagnostic: can GitHub's servers read IMAX.com's pages for the two Smithsonian IMAX theaters?
import { chromium } from 'playwright';
const PAGES = [
  'https://www.imax.com/theatre/lockheed-martin-imax-national-air-space-museum',
  'https://www.imax.com/theatre/airbus-imax-steven-f-udvar-hazy-center',
];
const UA = 'CapitalCityCinema/1.0 (+https://github.com/airaola729/capital-city-cinema-scraper)';
for (const u of PAGES) {
  try {
    const r = await fetch(u, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(30000) });
    const h = await r.text();
    console.log('FETCH', r.status, u, 'title=', (h.match(/<title[^>]*>([^<]*)/i) || [])[1], 'len', h.length, 'nextData', /__NEXT_DATA__|self\.__next_f/.test(h), 'hunger', /hunger games/i.test(h));
  } catch (e) { console.log('FETCH ERR', u, String(e)); }
}
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ timezoneId: 'America/New_York', locale: 'en-US', viewport: { width: 1366, height: 900 } });
for (const u of PAGES) {
  const page = await ctx.newPage();
  const api = [];
  page.on('response', r => { const t = r.request().resourceType(); if (['xhr', 'fetch'].includes(t)) api.push(r.status() + ' ' + r.url().slice(0, 180)); });
  try {
    const resp = await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(6000);
    const txt = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
    console.log('PAGE', resp && resp.status(), u, 'title=', await page.title());
    console.log('  text:', txt.slice(0, 900));
    console.log('  times found:', (txt.match(/\b\d{1,2}:\d\d\s?[AP]M\b/gi) || []).slice(0, 12).join(', '));
    console.log('  api:', api.slice(0, 25).join('\n       '));
  } catch (e) { console.log('PAGE ERR', u, String(e)); }
  await page.close();
}
await browser.close();
