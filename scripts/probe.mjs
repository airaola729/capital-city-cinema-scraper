// Diagnostic round 2: CinemaClock accuracy and terms, NASM's IMAX page, and tickets.si.edu.
// Ordinary page loads only: no challenge solving, no stealth, no user-agent changes.
import { chromium } from 'playwright';

const CHALLENGE = /just a moment|verify you are human|captcha|access denied|attention required|cf-chl/i;
const log = (...a) => console.log(...a);
const toText = h => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d|\/td|\/span)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#039;|&rsquo;/g, "'").replace(/[ \t]+/g, ' ')
  .replace(/\n\s*/g, '\n').replace(/\n{2,}/g, '\n');

async function plain(url) {
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
    const t = await r.text();
    const title = (t.match(/<title[^>]*>([^<]*)/i) || [])[1];
    log(`PLAIN ${r.status} ${r.headers.get('content-type')} len=${t.length} title=${JSON.stringify(title)} challenge=${CHALLENGE.test(t.slice(0, 20000))} final=${r.url}`);
    return t;
  } catch (e) { log('PLAIN ERROR', url, e.message); return ''; }
}
async function section(name, fn) {
  log(`\n\n################ ${name}`);
  try { await fn(); } catch (e) { log('SECTION ERROR', e.stack); }
}

await section('CinemaClock full listings', async () => {
  const base = 'https://www.cinemaclock.com';
  const lock = await plain(base + '/movie-theaters/lockheed-martin-imax-theater');
  log(toText(lock).slice(0, 14000));
  // find the Airbus theater page and the terms page from links
  const hrefs = [...new Set([...lock.matchAll(/href="([^"]+)"/g)].map(m => m[1]))];
  log('LINKS terms/airbus/imax:', JSON.stringify(hrefs.filter(h => /term|condition|legal|airbus|imax|udvar/i.test(h)).slice(0, 40)));
  for (const slug of ['airbus-imax-theater', 'airbus-imax-theater-steven-f-udvar-hazy-center', 'smithsonian-airbus-imax-theater']) {
    log(`\n--- ${slug}`);
    const a = await plain(`${base}/movie-theaters/${slug}`);
    if (a && /Showtimes/i.test(a) && !/page not found/i.test(a)) { log(toText(a).slice(0, 9000)); break; }
  }
  const home = await plain(base + '/');
  const all = [...new Set([...(lock + home).matchAll(/href="([^"]+)"/g)].map(m => m[1]))].filter(h => /term|condition|legal|privacy|about/i.test(h));
  log('TERMS CANDIDATES:', JSON.stringify(all));
  for (const h of all.filter(h => /term|condition|legal/i.test(h)).slice(0, 3)) {
    const u = new URL(h, base).href; log(`\n--- terms ${u}`);
    const t = toText(await plain(u));
    const sents = t.replace(/\n/g, ' ').split(/(?<=[.!?])\s+/).filter(s => /automat|scrap|robot|crawl|spider|reproduc|republish|redistribut|commercial|copy|extract|data mining|framing/i.test(s));
    log(`  ${sents.length} relevant sentences:`); for (const s of sents.slice(0, 40)) log('  * ' + s.slice(0, 500));
  }
});

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ timezoneId: 'America/New_York', locale: 'en-US', viewport: { width: 1366, height: 900 } });
async function load(url, wait = 8000) {
  log(`\n=== ${url}`);
  await plain(url);
  const page = await ctx.newPage();
  const json = [];
  page.on('response', async r => {
    if (!['xhr', 'fetch'].includes(r.request().resourceType())) return;
    const u = r.url(); if (/google|doubleclick|clarity|stackadapt|fndrsp|verint|facebook|tiktok|bing|hotjar|cdn-cgi/i.test(u)) return;
    const ct = r.headers()['content-type'] || '';
    log(`  XHR ${r.status()} ${ct.split(';')[0]} ${u.slice(0, 220)}`);
    if (/json/.test(ct) && json.length < 8) { try { json.push([u, await r.text()]); } catch {} }
  });
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(wait);
    const info = await page.evaluate(() => ({ title: document.title, url: location.href, text: document.body ? document.body.innerText : '',
      links: [...document.querySelectorAll('a[href]')].map(a => [a.textContent.trim().replace(/\s+/g, ' ').slice(0, 80), a.href]) }));
    log(`  status=${resp && resp.status()} final=${info.url} title=${JSON.stringify(info.title)} challenge=${CHALLENGE.test(info.title + info.text.slice(0, 3000))}`);
    log('  TEXT:\n' + info.text.replace(/\n{2,}/g, '\n').slice(0, 5000));
    const rel = info.links.filter(([t, h]) => /imax|ticket|showtime|film|theat|event|movie/i.test(t + ' ' + h));
    log(`  relevant links (${rel.length}):`); for (const [t, h] of rel.slice(0, 60)) log(`    ${JSON.stringify(t)} -> ${h}`);
    for (const [u, b] of json) log(`  JSON ${u.slice(0, 220)}\n    ${b.slice(0, 2500)}`);
  } catch (e) { log('  LOAD ERROR', e.message); }
  await page.close();
}

await section('NASM IMAX page', async () => {
  await load('https://airandspace.si.edu/whats-on/imax-theaters-and-planetarium', 8000);
});

await section('tickets.si.edu', async () => {
  log((await plain('https://tickets.si.edu/robots.txt')).slice(0, 1500));
  await load('https://tickets.si.edu/', 8000);
  await load('https://tickets.si.edu/airandspace', 8000);
});

await browser.close();
