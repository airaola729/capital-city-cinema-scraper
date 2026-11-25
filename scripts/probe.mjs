// Diagnostic: public sources other than si.edu that may list Smithsonian IMAX showtimes.
// Ordinary page loads only: no challenge solving, no stealth, no user-agent changes.
import { chromium } from 'playwright';

const CHALLENGE = /just a moment|verify you are human|captcha|access denied|attention required|cf-chl/i;
const TIME_RE = /\b\d{1,2}:\d{2}\s?(?:a\.?m\.?|p\.?m\.?)/gi;
const log = (...a) => console.log(...a);

async function plain(url) {
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
    const t = await r.text();
    const title = (t.match(/<title[^>]*>([^<]*)/i) || [])[1];
    log(`PLAIN ${r.status} ${r.headers.get('content-type')} len=${t.length} title=${JSON.stringify(title)} challenge=${CHALLENGE.test(t.slice(0, 20000))} final=${r.url}`);
    return t;
  } catch (e) { log('PLAIN ERROR', url, e.message); return ''; }
}

async function robots(origin) {
  log(`\n--- robots ${origin}`);
  const t = await plain(origin + '/robots.txt');
  log(t.slice(0, 2000));
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ timezoneId: 'America/New_York', locale: 'en-US', viewport: { width: 1366, height: 900 } });

async function load(url, { wait = 8000, keepJson = 6 } = {}) {
  log(`\n=== ${url}`);
  await plain(url);
  const page = await ctx.newPage();
  const json = [];
  page.on('response', async r => {
    const rt = r.request().resourceType();
    if (!['xhr', 'fetch'].includes(rt)) return;
    const ct = r.headers()['content-type'] || '';
    log(`  XHR ${r.status()} ${ct.split(';')[0]} ${r.url().slice(0, 220)}`);
    if (/json/.test(ct) && json.length < keepJson) {
      try { const b = await r.text(); json.push([r.url(), b]); } catch {}
    }
  });
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(wait);
    const info = await page.evaluate(() => {
      const text = document.body ? document.body.innerText : '';
      const links = [...document.querySelectorAll('a[href]')].map(a => [a.textContent.trim().replace(/\s+/g, ' ').slice(0, 80), a.href]);
      const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => s.textContent.slice(0, 1500));
      const next = document.getElementById('__NEXT_DATA__');
      return { title: document.title, url: location.href, text, links, ld, next: next ? next.textContent : null };
    });
    log(`  status=${resp && resp.status()} final=${info.url} title=${JSON.stringify(info.title)} challenge=${CHALLENGE.test(info.title + info.text.slice(0, 3000))} textLen=${info.text.length}`);
    const times = info.text.match(TIME_RE) || [];
    log(`  times found: ${times.length} sample=${JSON.stringify(times.slice(0, 15))}`);
    log('  TEXT:\n' + info.text.replace(/\n{2,}/g, '\n').slice(0, 3500));
    const rel = info.links.filter(([t, h]) => /imax|ticket|showtime|film|theat|terms|schedule|movie/i.test(t + ' ' + h));
    log(`  relevant links (${rel.length}):`);
    for (const [t, h] of rel.slice(0, 50)) log(`    ${JSON.stringify(t)} -> ${h}`);
    for (const l of info.ld) log('  LD-JSON: ' + l);
    if (info.next) {
      log(`  __NEXT_DATA__ len=${info.next.length}`);
      const nt = info.next.match(TIME_RE) || [];
      log(`  __NEXT_DATA__ times=${nt.length}; ISO datetimes=${(info.next.match(/20\d\d-\d\d-\d\dT\d\d:\d\d/g) || []).length}`);
      log('  __NEXT_DATA__ head: ' + info.next.slice(0, 2500));
    }
    for (const [u, b] of json) log(`  JSON ${u.slice(0, 200)}\n    ${b.slice(0, 1500)}`);
  } catch (e) { log('  LOAD ERROR', e.message); }
  await page.close();
}

async function section(name, fn) {
  log(`\n\n################ ${name}`);
  try { await fn(); } catch (e) { log('SECTION ERROR', e.message); }
}

await section('IMAX.com', async () => {
  await robots('https://www.imax.com');
  await load('https://www.imax.com/md/theatre/lockheed-martin-imax-national-air-space-museum', { wait: 10000 });
  await load('https://www.imax.com/md/theatre/airbus-imax-steven-f-udvar-hazy-center', { wait: 10000 });
  await load('https://www.imax.com/terms-of-use', { wait: 3000, keepJson: 0 });
});

await section('airandspace.si.edu (NASM site)', async () => {
  await robots('https://airandspace.si.edu');
  await load('https://airandspace.si.edu/', { wait: 6000, keepJson: 2 });
  await load('https://airandspace.si.edu/whats-on/events', { wait: 6000, keepJson: 2 });
});

await section('CinemaClock', async () => {
  await robots('https://www.cinemaclock.com');
  await load('https://www.cinemaclock.com/movie-theaters/lockheed-martin-imax-theater', { wait: 5000, keepJson: 2 });
});

await section('Atom (plain request only)', async () => {
  await plain('https://www.atomtickets.com/theaters/smithsonian-lockheed-martin-imax-theater/1251');
});

await browser.close();
