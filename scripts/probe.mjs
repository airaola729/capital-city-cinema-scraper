// Diagnostic (one-off, 2026-11-23, run 2): Avalon Theatre and Suns Cinema — schedule depth and fields.
// and where does each full schedule live? Read-only, light: robots.txt checked first, <=10 loads per site,
// 2 s between loads, no purchase/checkout steps, and it stops a site at the first sign of a bot check.
import { chromium } from 'playwright';

const UA = 'CapitalCityCinema/1.0 (+https://github.com/airaola729/capital-city-cinema-scraper)';
const PAUSE = 2000;
const MAX_LOADS = 10;
const CHALLENGE = /just a moment|verify you are human|captcha|access denied/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clip = (s, n) => (s == null ? '' : String(s).length > n ? String(s).slice(0, n) + ` …[+${String(s).length - n}]` : String(s));
const H = t => console.log(`\n========== ${t} ==========`);
const L = (...a) => console.log(...a);

class Challenge extends Error {}

// ---------- robots.txt ----------
function parseRobots(txt) {
  // returns rules for groups whose user-agent is * (or our bot name)
  const groups = []; let cur = null; let lastWasUA = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { if (!lastWasUA) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasUA = true; continue; }
    lastWasUA = false;
    if (!cur) continue;
    if (k === 'disallow' || k === 'allow') cur.rules.push({ allow: k === 'allow', path: v });
  }
  const mine = groups.filter(g => g.agents.some(a => a.includes('capitalcitycinema')));
  const star = groups.filter(g => g.agents.includes('*'));
  return (mine.length ? mine : star).flatMap(g => g.rules);
}
function allowed(rules, pathname) {
  let best = null;
  for (const r of rules) {
    if (!r.path) continue;
    const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(pathname) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

function makeSite(name, ctx) {
  const site = { name, loads: 0, robots: {}, page: null, net: [] };
  site.count = async () => {
    if (site.loads >= MAX_LOADS) throw new Error(`load budget (${MAX_LOADS}) reached for ${name}`);
    if (site.loads > 0) await sleep(PAUSE);
    site.loads++;
  };
  site.robotsFor = async origin => {
    if (site.robots[origin]) return site.robots[origin];
    await site.count();
    H(`[${name}] robots.txt ${origin}  (load #${site.loads})`);
    let rules = [];
    try {
      const r = await fetch(origin + '/robots.txt', { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      const t = await r.text();
      L('status', r.status, 'final', r.url, 'content-type', r.headers.get('content-type'));
      L(clip(t, 2000));
      if (!/<html/i.test(t.slice(0, 500)) && /user-agent/i.test(t)) { rules = parseRobots(t); if (!r.ok) L('(robots body served with non-200 status; rules applied anyway)'); }
      L('rules applied to us (User-agent: * unless our name is listed):', JSON.stringify(rules));
    } catch (e) { L('robots fetch error:', e.message); }
    site.robots[origin] = rules; return rules;
  };
  site.load = async (url, label) => {
    const u = new URL(url);
    const rules = await site.robotsFor(u.origin);
    if (!allowed(rules, u.pathname + u.search)) { H(`[${name}] ${label}: SKIPPED, robots.txt disallows ${u.pathname}${u.search}`); return null; }
    await site.count();
    H(`[${name}] ${label}  (load #${site.loads})  ${url}`);
    if (!site.page) {
      site.page = await ctx.newPage();
      site.page.on('response', async r => {
        const rt = r.request().resourceType();
        if (rt === 'xhr' || rt === 'fetch') {
          const ct = r.headers()['content-type'] || '';
          L(`  [net ${rt}] ${r.status()} ${clip(ct, 60)} ${clip(r.url(), 250)}`);
          site.net.push({ url: r.url(), status: r.status(), ct });
        }
      });
    }
    const p = site.page; let resp = null;
    try { resp = await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); }
    catch (e) { L('goto error:', e.message); return null; }
    try { await p.waitForLoadState('networkidle', { timeout: 15000 }); } catch { L('(networkidle not reached in 15 s)'); }
    await p.waitForTimeout(1500);
    const title = await p.title().catch(() => '');
    const text = await p.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
    const status = resp ? resp.status() : null;
    const chal = (title + '\n' + text.slice(0, 5000)).match(CHALLENGE);
    L('final URL:', p.url()); L('HTTP status:', status); L('title:', title);
    L('text length:', text.length);
    L('challenge signs:', chal ? `YES ("${chal[0]}")` : 'none');
    const ld = await p.$$eval('script[type="application/ld+json"]', els => els.map(e => e.textContent)).catch(() => []);
    L('JSON-LD blocks:', ld.length); ld.slice(0, 6).forEach((b, i) => L(`  JSON-LD #${i + 1}:`, clip(b.replace(/\s+/g, ' '), 1500)));
    const evs = [];
    for (const b of ld) { try { const j = JSON.parse(b); const walk = o => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (/Event/.test(o['@type'] || '')) evs.push(o); if (o['@graph']) walk(o['@graph']); } }; walk(j); } catch {} }
    if (evs.length) {
      const ds = evs.map(e => e.startDate).filter(Boolean).sort();
      L(`JSON-LD events: ${evs.length}, startDate range ${ds[0]} .. ${ds[ds.length - 1]}`);
      evs.slice(0, 40).forEach(e => L(`  ev: ${clip(e.name, 70)} | ${e.startDate} | ${[].concat(e.offers || []).map(o => (o.price ?? '') + ' ' + (o.availability || '').replace('https://schema.org/', '')).join(',')} | ${clip(e.url || [].concat(e.offers || [])[0]?.url, 90)}`));
    }
    if (chal || status === 403 || status === 429 || status === 503) {
      L('TEXT HEAD:', clip(text.replace(/\s+/g, ' '), 600));
      if (chal) throw new Challenge(`challenge on ${url}: ${chal[0]}`);
    }
    return { p, text, title, status };
  };
  return site;
}

const links = async p => p.$$eval('a[href]', as => as.map(a => ({ t: (a.innerText || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(), h: a.href, foot: !!a.closest('footer, [class*="footer"], #footer') })));
function dumpLinks(ls, n = 150) {
  const seen = new Set(); let i = 0;
  for (const l of ls) { const k = l.t + '|' + l.h; if (seen.has(k)) continue; seen.add(k); if (i++ >= n) { L(`  …more links (${ls.length} total)`); break; } L(`  link: "${clip(l.t, 80)}" -> ${clip(l.h, 200)}`); }
}
const TIME = /\b\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)\b/i;
const DATE = /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b|\b20\d\d-\d\d-\d\d\b|\btoday\b|\btomorrow\b/i;
function dateTimeLines(text, n = 80) {
  const out = [...new Set(text.split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(s => s && s.length < 300 && (TIME.test(s) || DATE.test(s))))];
  out.slice(0, n).forEach(s => L('  dt:', s)); if (out.length > n) L(`  …${out.length - n} more date/time lines`);
  return out;
}
function after(text, marker, n) {
  const i = text.toLowerCase().indexOf(marker.toLowerCase());
  if (i < 0) { L(`(marker "${marker}" not found in page text)`); return ''; }
  const s = text.slice(i, i + n); L(s); return s;
}

async function terms(site, p) {
  H(`[${site.name}] footer policy links`);
  const ls = (await links(p)).filter(l => /terms|privacy|polic|agreement/i.test(l.t) || /terms|privacy|polic|agreement/i.test(l.h));
  const foot = ls.filter(l => l.foot); const use = foot.length ? foot : ls;
  if (!foot.length) L('(no policy links inside a footer element; listing policy links found anywhere)');
  dumpLinks(use, 20);
  const t = use.find(l => /terms|agreement/i.test(l.t) || /terms|agreement/i.test(l.h));
  if (!t) { L('No terms page link found.'); return; }
  const r = await site.load(t.h, 'TERMS page');
  if (!r) return;
  const sents = r.text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/);
  const hits = sents.filter(s => /automat|scrap|robot|crawl|spider|reproduc|republish|data mining|harvest|\bbots?\b/i.test(s));
  L(`terms sentences on automated access / reproduction: ${hits.length}`);
  hits.slice(0, 25).forEach(s => L('  TERMS:', clip(s, 500)));
}

// ---------- Avalon ----------
// ---------- Avalon (run 2: calendar day pages, Visitor Agreement, full Agile list) ----------
async function avalon(ctx) {
  const site = makeSite('AVALON', ctx);
  try {
    const r = await site.load('https://theavalon.org/films', 'FILMS page');
    if (!r) return;
    const { p } = r;
    H('[AVALON] "Showing Today at the Theater" (structured)');
    after(r.text, 'Showing Today', 400);
    H('[AVALON] calendar: date links and controls');
    const cal = await p.evaluate(() => {
      const as = [...document.querySelectorAll('a[href*="?date=2"]')].map(a => ({ h: a.href, t: a.innerText.trim(), tip: (a.getAttribute('title') || a.getAttribute('data-title') || a.getAttribute('aria-label') || '').slice(0, 200) }));
      const m = [...document.querySelectorAll('*')].find(e => e.children.length < 4 && /showings by calendar/i.test(e.textContent || '') && (e.textContent || '').length < 60);
      let box = m; for (let i = 0; i < 4 && box && box.querySelectorAll('a[href*="?date=2"]').length === 0; i++) box = box.parentElement;
      const ctrls = box ? [...box.querySelectorAll('a,button')].filter(x => !/\?date=2/.test(x.href || '')).map(x => (x.tagName + ' "' + x.innerText.trim() + '" ' + (x.getAttribute('href') || '') + ' ' + (x.getAttribute('onclick') || '') + ' ' + (x.className || '')).slice(0, 200)) : [];
      return { as, ctrls, boxHtmlHead: box ? box.outerHTML.slice(0, 1500) : '' };
    });
    const dates = [...new Set(cal.as.map(a => (a.h.match(/date=(\d{8})/) || [])[1]).filter(Boolean))].sort();
    L(`calendar date links: ${dates.length} unique; first ${dates[0]} last ${dates[dates.length - 1]}`); L('  all:', dates.join(' '));
    cal.as.slice(0, 5).forEach(a => L(`  sample: "${a.t}" tip="${a.tip}" -> ${a.h}`));
    L('calendar controls (non-date links/buttons):'); cal.ctrls.forEach(c => L('  ', c));
    L('calendar HTML head:', cal.boxHtmlHead.replace(/\s+/g, ' '));
    const all = await links(p);
    L('"Buy Tickets" list link(s):'); [...new Set(all.filter(l => /list\.aspx/i.test(l.h)).map(l => l.h))].forEach(h => L('  ', h));

    await terms(site, p);

    // one day page a few days out, and the last calendar date
    const pick = [dates.find(d => d >= '20261126'), dates[dates.length - 1]].filter((d, i, a) => d && a.indexOf(d) === i);
    for (const d of pick) {
      const dp = await site.load(`https://www.theavalon.org/films/?date=${d}`, `CALENDAR DAY page ${d}`);
      if (!dp) continue;
      H(`[AVALON] day ${d}: text after the film menu`);
      const i = dp.text.search(/Now Playing and Coming Soon|Showing|Showtimes/i);
      L(clip(dp.text.slice(Math.max(0, i), Math.max(0, i) + 2500), 2500));
      H(`[AVALON] day ${d}: time links (title block + time + href)`);
      const tl = await dp.p.evaluate(() => [...document.querySelectorAll('a[href*="ticketsearchcriteria"], a[href*="evtinfo"]')].filter(a => /\d:\d\d/.test(a.innerText)).map(a => { let c = a.parentElement; for (let k = 0; k < 4 && c && !/min/.test(c.innerText); k++) c = c.parentElement; return { t: a.innerText.trim(), h: a.href, ctx: (c ? c.innerText : '').replace(/\s+/g, ' ').slice(0, 160) }; }));
      tl.slice(0, 30).forEach(x => L(`  ${x.t} | ${x.ctx} | ${clip(x.h, 120)}`));
    }

    // the full Agile list (one ticketing listing page; nothing clicked)
    const list = all.map(l => l.h).find(h => /agileticketing\.net\/websales\/pages\/list\.aspx/i.test(h));
    if (list) {
      const t = await site.load(list, 'AGILE TICKETING full list page (listing only, nothing clicked)');
      if (t) {
        H('[AVALON] agile list: text head'); L(clip(t.text, 5000));
        H('[AVALON] agile list: date/time lines'); const dl = dateTimeLines(t.text, 150);
        L('distinct dates seen:', [...new Set(dl.map(s => (s.match(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}/i) || [])[0]).filter(Boolean))].join(' | '));
        const html = await t.p.content();
        const feeds = [...new Set(html.match(/https?:\/\/[^"'\s<>]*(feed|\.xml|\.json|rss|xmlfeed)[^"'\s<>]*/gi) || [])];
        L('feed-like URLs in HTML:', feeds.length); feeds.slice(0, 20).forEach(f => L('  ', clip(f, 250)));
        L('agile JSON/XML responses:'); site.net.filter(n => /agile/i.test(n.url) && /json|xml/i.test(n.ct)).forEach(n => L(`  ${n.status} ${n.ct} ${n.url}`));
      }
    }
  } catch (e) {
    if (e instanceof Challenge) H(`[AVALON] BOT CHECK — stopped probing this site: ${e.message}`);
    else { H('[AVALON] ERROR'); L(e.stack || e.message); }
  } finally { L(`[AVALON] page loads used: ${site.loads}`); if (site.page) await site.page.close(); }
}

// ---------- Suns (run 2: future day pages, Future Dates control, Coming Soon, a repertory film page) ----------
async function suns(ctx) {
  const site = makeSite('SUNS', ctx);
  const block = async (p, label) => {
    H(`[SUNS] ${label}: films and times`);
    const rows = await p.evaluate(() => [...document.querySelectorAll('a[href*="/movies/"]')].filter(a => a.innerText.trim() && !/trailer|details/i.test(a.innerText)).map(a => {
      let c = a.parentElement; for (let k = 0; k < 5 && c && !/\d:\d\d/.test(c.innerText); k++) c = c.parentElement;
      return { title: a.innerText.trim(), ctx: c ? c.innerText.replace(/\s+/g, ' ').slice(0, 200) : '' };
    }));
    [...new Map(rows.map(r => [r.title, r])).values()].slice(0, 25).forEach(r => L(`  ${r.title} || ${r.ctx}`));
  };
  try {
    const r = await site.load('https://sunscinema.com/', 'HOME page');
    if (!r) return;
    const { p } = r;
    H('[SUNS] "Future Dates" element');
    const fd = await p.evaluate(() => {
      const el = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && /future dates/i.test(e.textContent || ''));
      if (!el) return null;
      let c = el; for (let i = 0; i < 3 && c.parentElement; i++) c = c.parentElement;
      return { tag: el.tagName, attrs: [...el.attributes].map(a => a.name + '=' + a.value).join(' '), parent: c.outerHTML.slice(0, 2500) };
    });
    L(fd ? `tag=${fd.tag} attrs=${fd.attrs}\nparent HTML: ${fd.parent.replace(/\s+/g, ' ')}` : 'not found');
    const opts = await p.$$eval('select option, [data-date], input[type="date"]', els => els.map(e => (e.tagName + ' ' + (e.value || '') + ' ' + (e.getAttribute('data-date') || '') + ' ' + e.textContent.trim()).slice(0, 120)));
    L('date options/data-date elements:', opts.length); opts.slice(0, 60).forEach(o => L('  ', o));

    for (const [u, lab] of [['https://sunscinema.com/2026-11-25', 'DAY page 2026-11-25 (2 days out)'], ['https://sunscinema.com/2026-11-29', 'DAY page 2026-11-29 (6 days out, past the 3 day links)'], ['https://sunscinema.com/2026-12-12', 'DAY page 2026-12-12 (19 days out)']]) {
      const d = await site.load(u, lab);
      if (d) { L('final URL:', d.p.url()); H(`[SUNS] ${lab}: text`); L(clip(d.text.replace(/^[\s\S]*?Future Dates/, ''), 1500)); await block(d.p, lab); }
    }

    const cs = await site.load('https://sunscinema.com/upcoming-films-3/', 'COMING SOON page');
    if (cs) {
      H('[SUNS] coming soon: text'); L(clip(cs.text, 4000));
      H('[SUNS] coming soon: date lines'); dateTimeLines(cs.text, 100);
    }

    for (const u of ['https://sunscinema.com/movies/edward-ii/', 'https://sunscinema.com/movies/swordsman/']) {
      const d = await site.load(u, 'FILM page');
      if (d) {
        H('[SUNS] film page: text'); L(clip(d.text.replace(/^[\s\S]*?Watch trailer\n/, ''), 2000));
        L('runtime matches:', JSON.stringify(d.text.match(/\b\d{2,3}\s*(min|mins|minutes)\b/gi)));
        L('format matches:', JSON.stringify([...new Set(d.text.match(/\b(35mm|70mm|16mm|DCP|digital|4K|Blu-?ray)\b/gi) || [])]));
        L('price in text:', JSON.stringify([...new Set(d.text.match(/\$\s?\d+(\.\d\d)?/g) || [])]));
        L('rating matches:', JSON.stringify([...new Set(d.text.match(/\b(Rated\s+)?(PG-13|NC-17|PG|G|R|NR|Not Rated|Unrated)\b(?=[\s,.)]|$)/g) || [])].slice(0, 10)));
      }
    }
  } catch (e) {
    if (e instanceof Challenge) H(`[SUNS] BOT CHECK — stopped probing this site: ${e.message}`);
    else { H('[SUNS] ERROR'); L(e.stack || e.message); }
  } finally { L(`[SUNS] page loads used: ${site.loads}`); if (site.page) await site.page.close(); }
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ timezoneId: 'America/New_York', locale: 'en-US', viewport: { width: 1366, height: 900 } });
try { await avalon(ctx); } catch (e) { L('avalon outer error', e); }
try { await suns(ctx); } catch (e) { L('suns outer error', e); }
await browser.close();
H('DONE');
