// One-off reachability probe: which candidate showtime sources can a GitHub runner read
// without a bot check? Each URL is requested once with plain HTTP and once as a page load
// in headless Chromium. Nothing is retried and no challenge is interacted with.
import { chromium } from 'playwright';

const ET = 'America/New_York';
const today = new Date().toLocaleDateString('en-CA', { timeZone: ET });
const C = [
  ['alamo-api washington-dc', 'https://drafthouse.com/s/mother/v2/schedule/market/washington-dc'],
  ['alamo-api dc', 'https://drafthouse.com/s/mother/v2/schedule/market/dc'],
  ['alamo-page', 'https://drafthouse.com/washington-dc'],
  ['amc-page georgetown', 'https://www.amctheatres.com/movie-theatres/washington-d-c/amc-georgetown-14/showtimes'],
  ['amc-api (no key)', 'https://api.amctheatres.com/v2/theatres?page-size=1'],
  ['atom-partner-api (no key)', 'https://api.atomtickets.com/partner/v1/venues/byIds?ids=8353'],
  ['miracle-rss', 'https://themiracletheatre.com/upcoming_productions'],
  ['miracle-home', 'https://themiracletheatre.com/'],
  ['miracle in-theatre list', 'https://themiracletheatre.com/event-category/in-theatre-movies/'],
  ['miracle tribe json', 'https://themiracletheatre.com/wp-json/tribe/events/v1/events?per_page=50'],
  ['miracle ical', 'https://themiracletheatre.com/events/?ical=1'],
  ['angelika-dc', 'https://angelikafilmcenter.com/dc'],
  ['bigscreen angelika 38754', `https://www.bigscreen.com/Marquee.php?theater=38754&view=sched&printable=1&showdate=${today}`],
  ['bigscreen georgetown 8353', `https://www.bigscreen.com/Marquee.php?theater=8353&view=sched&printable=1&showdate=${today}`],
  ['bigscreen alamo-dc 51802', `https://www.bigscreen.com/Marquee.php?theater=51802&view=sched&printable=1&showdate=${today}`],
  ['cinemaclock angelika', 'https://www.cinemaclock.com/movie-theaters/angelika-pop-up-at-union-market'],
  ['cinemaclock georgetown', 'https://www.cinemaclock.com/movie-theaters/amc-georgetown-14'],
  ['fever georgetown', 'https://feverup.com/movies/en/united-states/movie-theaters/amc-georgetown-14'],
];

const CH = /just a moment|attention required|cf-chl|cf_chl_opt|challenge-platform|captcha-delivery|px-captcha|_Incapsula_Resource|access denied|pardon our interruption/i;
const sum = (status, text, ct) => ({
  status, ct: (ct || '').split(';')[0], len: text.length,
  title: ((text.match(/<title[^>]*>([^<]*)/i) || [])[1] || '').trim().slice(0, 70),
  challenge: CH.test(text.slice(0, 20000)),
  times: (text.match(/\b\d{1,2}:\d{2}\s?(?:[ap]m?)?\b/gi) || []).length,
  head: text.replace(/\s+/g, ' ').slice(0, 140),
});

const out = {};
for (const [name, url] of C) {
  out[name] = {};
  try {
    const r = await fetch(url, { headers: { accept: 'text/html,application/json;q=0.9,*/*;q=0.8' }, signal: AbortSignal.timeout(30000) });
    out[name].http = sum(r.status, await r.text(), r.headers.get('content-type'));
  } catch (e) { out[name].http = { error: String(e.message || e).slice(0, 120) }; }
  await new Promise(r => setTimeout(r, 1000));
}
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ timezoneId: ET, locale: 'en-US' });
const page = await ctx.newPage();
const xhr = new Map();
page.on('request', r => { if (['xhr', 'fetch'].includes(r.resourceType())) { const u = new URL(r.url()); const k = u.host + u.pathname.split('/').slice(0, 4).join('/'); xhr.set(k, (xhr.get(k) || 0) + 1); } });
for (const [name, url] of C) {
  try {
    xhr.clear();
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(name.startsWith('angelika') ? 8000 : 2000);
    if (name.startsWith('angelika') || name.startsWith('amc-page') || name.startsWith('alamo-page')) out[name].xhr = [...xhr.entries()].slice(0, 25);
    out[name].browser = sum(resp ? resp.status() : 0, await page.content(), resp && resp.headers()['content-type']);
  } catch (e) { out[name].browser = { error: String(e.message || e).slice(0, 120) }; }
}
await browser.close();
for (const [name, r] of Object.entries(out)) {
  const f = x => x.error ? 'ERROR ' + x.error : `${x.status} ${x.ct} len=${x.len} times=${x.times}${x.challenge ? ' CHALLENGE' : ''} title="${x.title}"`;
  console.log(`PROBE ${name}\n   http:    ${f(r.http)}\n   browser: ${f(r.browser)}\n   head:    ${(r.http.head || r.browser.head || '').slice(0, 140)}${r.xhr ? '\n   xhr:     ' + JSON.stringify(r.xhr) : ''}`);
}
