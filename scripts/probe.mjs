// Diagnostic (Nov 27, 2026): can Eventbrite's DC film listings and the National Gallery of Art's film calendar be read
// from GitHub's servers without a bot check? If so, the screenings refresh would no longer need Abel's PC.
// Rules: robots.txt is read first and disallowed paths are skipped; nothing gets past a challenge; light load
// (plain request first, one browser load only if needed, 2 s between requests, at most ~8 loads per site).
import { chromium } from 'playwright';
const UA = 'CapitalCityCinema/1.0 (+https://github.com/airaola729/capital-city-cinema-scraper)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const CH = /just a moment|verify you are human|captcha|access denied|attention required|cf-challenge|px-captcha|are you a robot/i;
const title = h => ((h.match(/<title[^>]*>([^<]*)/i) || [])[1] || '').trim();

function robotsRules(txt) {
  const groups = []; let cur = null, lastWasUA = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    const [k, ...v] = line.split(':'); const key = k.trim().toLowerCase(), val = v.join(':').trim();
    if (key === 'user-agent') { if (!lastWasUA) { cur = { ua: [], rules: [] }; groups.push(cur); } cur.ua.push(val.toLowerCase()); lastWasUA = true; continue; }
    lastWasUA = false;
    if (cur && (key === 'allow' || key === 'disallow')) cur.rules.push({ allow: key === 'allow', p: val });
  }
  const g = groups.find(g => g.ua.includes('capitalcitycinema')) || groups.find(g => g.ua.includes('*'));
  return g ? g.rules.filter(r => r.p) : [];
}
function allowed(rules, pathQ) {
  let best = null;
  for (const r of rules) {
    const re = new RegExp('^' + r.p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(pathQ) && (!best || r.p.length > best.p.length || (r.p.length === best.p.length && r.allow))) best = r;
  }
  return !best || best.allow;
}
async function get(url) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(40000), redirect: 'follow' });
    const body = await r.text();
    log(`  GET ${url} -> ${r.status} ${r.url !== url ? '(final ' + r.url + ') ' : ''}${body.length} bytes, ${Date.now() - t0} ms, title "${title(body).slice(0, 100)}", challenge: ${CH.test(title(body)) || (r.status === 403 && CH.test(body.slice(0, 5000))) ? 'YES' : 'no'}`);
    return { status: r.status, body };
  } catch (e) { log(`  GET ${url} -> ERROR ${e.message}`); return { status: 0, body: '' }; }
}
function ldjson(html) {
  return [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean);
}

async function site(name, origin, fn) {
  log(`\n========== ${name} ==========`);
  try {
    const rb = await get(origin + '/robots.txt');
    log('  robots.txt (first 2500 chars):\n' + rb.body.slice(0, 2500).split('\n').map(l => '    | ' + l).join('\n'));
    const rules = robotsRules(rb.body);
    await sleep(2000);
    await fn(p => { const ok = allowed(rules, p); log(`  robots for ${p}: ${ok ? 'allowed' : 'DISALLOWED'}`); return ok; });
  } catch (e) { log(`  ${name} FAILED: ${e.stack || e}`); }
}

let browser;
const browserLoad = async (url, extract) => {
  browser = browser || await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ timezoneId: 'America/New_York', locale: 'en-US', viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const xhr = [];
  page.on('response', r => { if (['xhr', 'fetch'].includes(r.request().resourceType())) xhr.push(`${r.status()} ${(r.headers()['content-type'] || '').slice(0, 30)} ${r.url().slice(0, 160)}`); });
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    const t = await page.title();
    log(`  BROWSER ${url} -> ${resp && resp.status()}, title "${t.slice(0, 100)}", challenge: ${CH.test(t) ? 'YES' : 'no'}`);
    log('  xhr/fetch:', xhr.slice(0, 25).join('\n    '));
    if (!CH.test(t) && extract) log('  extract:', JSON.stringify(await page.evaluate(extract)).slice(0, 3000));
  } catch (e) { log(`  BROWSER ${url} -> ERROR ${e.message}`); }
  await ctx.close();
};

await site('Eventbrite', 'https://www.eventbrite.com', async ok => {
  const paths = ['/d/dc--washington/film-and-media--screenings/', '/d/dc--washington/film-events/', '/d/dc--washington/embassy/'];
  let firstEvent = null, plainWorked = false;
  for (const p of paths) {
    if (!ok(p)) continue;
    const r = await get('https://www.eventbrite.com' + p);
    const lists = ldjson(r.body).flatMap(x => Array.isArray(x) ? x : [x]).filter(x => x['@type'] === 'ItemList');
    const items = lists.flatMap(l => l.itemListElement || []).map(e => e.item || e);
    log(`  ItemList items: ${items.length}`);
    items.slice(0, 5).forEach(i => log(`    - ${i.name} | ${i.startDate} | ${i.location?.name} | ${i.location?.address?.addressLocality} | ${i.url}`));
    if (items.length) { plainWorked = true; firstEvent = firstEvent || items[0].url; }
    await sleep(2000);
  }
  if (firstEvent && ok(new URL(firstEvent).pathname)) {
    const r = await get(firstEvent);
    const ev = ldjson(r.body).flatMap(x => Array.isArray(x) ? x : [x]).find(x => /Event/.test(x['@type'] || ''));
    log('  event ld+json:', ev ? JSON.stringify({ name: ev.name, startDate: ev.startDate, endDate: ev.endDate, location: ev.location?.name, addr: ev.location?.address, organizer: ev.organizer?.name, offers: ev.offers }).slice(0, 1200) : 'none');
    await sleep(2000);
  }
  if (!plainWorked && ok(paths[0])) await browserLoad('https://www.eventbrite.com' + paths[0], () => ({ ld: document.querySelectorAll('script[type="application/ld+json"]').length, cards: document.querySelectorAll('a[href*="/e/"]').length }));
});

await site('National Gallery of Art', 'https://www.nga.gov', async ok => {
  const p = '/calendar?tab=all&type%5B103026%5D=103026';
  if (!ok('/calendar') ) return;
  ok(p);
  const r = await get('https://www.nga.gov' + p);
  const links = [...new Set([...r.body.matchAll(/href="([^"]*\/calendar\/[^"]*evd=[^"]*)"/g)].map(m => m[1].replace(/&amp;/g, '&')))];
  log(`  film event links in plain HTML: ${links.length}`); links.slice(0, 8).forEach(l => log('    - ' + l));
  await sleep(2000);
  if (links[0]) {
    const u = new URL(links[0], 'https://www.nga.gov');
    if (ok(u.pathname + u.search)) {
      const e = await get(u.href);
      const txt = e.body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      log('  credit lines:', JSON.stringify([...txt.matchAll(/\([^()]{5,80}\b(19|20)\d\d\b[^()]{0,80}\)/g)].map(m => m[0]).slice(0, 6)));
      log('  date/time text:', JSON.stringify((txt.match(/(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,?\s+\w+\s+\d{1,2}[^.]{0,80}/) || [])[0] || null));
      await sleep(2000);
    }
  }
  if (!links.length || r.status !== 200) await browserLoad('https://www.nga.gov' + p, () => ({ links: [...new Set([...document.querySelectorAll('main a[href*="/calendar/"]')].map(a => a.href).filter(h => h.includes('evd=')))].slice(0, 10), text: document.querySelector('main')?.innerText.slice(0, 800) }));
});

if (browser) await browser.close();
log('\nDONE');
