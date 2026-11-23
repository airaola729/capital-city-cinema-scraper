// Diagnostic (one-off, 2026-11-23): can the Avalon Theatre and Suns Cinema be read from GitHub's servers,
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
      if (r.ok && !/<html/i.test(t.slice(0, 500))) rules = parseRobots(t);
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
  const ls = (await links(p)).filter(l => /terms|privacy|polic/i.test(l.t) || /terms|privacy|polic/i.test(l.h));
  const foot = ls.filter(l => l.foot); const use = foot.length ? foot : ls;
  if (!foot.length) L('(no policy links inside a footer element; listing policy links found anywhere)');
  dumpLinks(use, 20);
  const t = use.find(l => /terms/i.test(l.t) || /terms/i.test(l.h));
  if (!t) { L('No terms page link found.'); return; }
  const r = await site.load(t.h, 'TERMS page');
  if (!r) return;
  const sents = r.text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/);
  const hits = sents.filter(s => /automat|scrap|robot|crawl|spider|reproduc|republish|data mining|harvest|\bbots?\b/i.test(s));
  L(`terms sentences on automated access / reproduction: ${hits.length}`);
  hits.slice(0, 25).forEach(s => L('  TERMS:', clip(s, 500)));
}

// ---------- Avalon ----------
async function avalon(ctx) {
  const site = makeSite('AVALON', ctx);
  try {
    const r = await site.load('https://theavalon.org/films', 'FILMS page');
    if (!r) return;
    const { p } = r;
    H('[AVALON] "Showing Today at the Theater" section (page text after marker)');
    after(r.text, 'Showing Today', 3000);
    H('[AVALON] "Showings by Calendar" (before scroll)');
    after(r.text, 'Showings by Calendar', 3000);
    // scroll to let any script-loaded calendar appear (no extra page load)
    L('-- scrolling page to bottom; network calls during scroll appear as [net] lines --');
    await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 150)); } });
    await p.waitForTimeout(4000);
    const text2 = await p.evaluate(() => document.body.innerText);
    H('[AVALON] "Showings by Calendar" (after scroll)');
    after(text2, 'Showings by Calendar', 3000);
    const iframes = await p.$$eval('iframe', fs => fs.map(f => f.src)); L('iframes:', JSON.stringify(iframes));
    H('[AVALON] films with Learn More / Buy Tickets');
    const films = await p.evaluate(() => {
      const out = []; const seen = new Set();
      for (const a of document.querySelectorAll('a')) {
        if (!/learn more/i.test(a.innerText)) continue;
        let c = a.parentElement, title = '';
        for (let i = 0; i < 8 && c; i++, c = c.parentElement) {
          const h = c.querySelector('h1,h2,h3,h4,h5,[class*="title"]');
          if (h && h.innerText.trim()) { title = h.innerText.trim(); break; }
        }
        const buy = c ? [...c.querySelectorAll('a')].find(b => /buy tickets|tickets/i.test(b.innerText)) : null;
        const k = a.href; if (seen.has(k)) continue; seen.add(k);
        out.push({ title, learn: a.href, buy: buy ? buy.href : null, block: c ? c.innerText.replace(/\s+/g, ' ').slice(0, 300) : '' });
      }
      return out;
    });
    L('Learn More links found:', films.length);
    films.slice(0, 5).forEach((f, i) => L(`  #${i + 1} title="${f.title}" learn=${f.learn} buy=${f.buy}\n      block: ${f.block}`));
    const all = await links(p);
    L('All "Buy Tickets" hrefs (first 10):'); all.filter(l => /buy tickets/i.test(l.t)).slice(0, 10).forEach(l => L('  ', l.h));
    H('[AVALON] link dump of films page'); dumpLinks(all, 120);
    H('[AVALON] date/time lines on films page'); dateTimeLines(text2, 60);

    await terms(site, p);

    const detail = films[0]?.learn;
    if (detail) {
      const d = await site.load(detail, `FILM DETAIL page (${films[0].title})`);
      if (d) {
        H('[AVALON] film detail: text head'); L(clip(d.text, 3000));
        H('[AVALON] film detail: date/time lines'); dateTimeLines(d.text, 80);
        const dl = await links(d.p); L('ticket links on detail page:'); dl.filter(l => /ticket|agile/i.test(l.t + l.h)).slice(0, 15).forEach(l => L(`  "${clip(l.t, 60)}" -> ${l.h}`));
      }
    } else L('No film detail link found.');

    const buy = films.map(f => f.buy).find(h => h && /agileticketing\.net/i.test(h)) || all.map(l => l.h).find(h => /agileticketing\.net/i.test(h));
    if (buy && !/cart|checkout|purchase|payment/i.test(buy)) {
      const t = await site.load(buy, 'AGILE TICKETING listing page (listing only, nothing clicked)');
      if (t) {
        H('[AVALON] agile listing: text head'); L(clip(t.text, 2500));
        H('[AVALON] agile listing: date/time lines'); dateTimeLines(t.text, 60);
        const html = await t.p.content();
        const feeds = [...new Set(html.match(/https?:\/\/[^"'\s<>]*(feed|\.xml|\.json|rss|xmlfeed|api)[^"'\s<>]*/gi) || [])];
        L('feed-like URLs in HTML:', feeds.length); feeds.slice(0, 20).forEach(f => L('  ', clip(f, 250)));
        L('JSON/XML responses in network log:'); site.net.filter(n => /agile/i.test(n.url) && /json|xml/i.test(n.ct)).forEach(n => L(`  ${n.status} ${n.ct} ${n.url}`));
      }
    } else L('No usable agileticketing Buy Tickets link found:', buy);
  } catch (e) {
    if (e instanceof Challenge) H(`[AVALON] BOT CHECK — stopped probing this site: ${e.message}`);
    else { H('[AVALON] ERROR'); L(e.stack || e.message); }
  } finally { L(`[AVALON] page loads used: ${site.loads}`); if (site.page) await site.page.close(); }
}

// ---------- Suns ----------
async function suns(ctx) {
  const site = makeSite('SUNS', ctx);
  const showFilms = async p => p.evaluate(() => {
    // generic: any element containing a /purchase/ link -> walk up to a block with a heading
    const out = []; const seen = new Set();
    for (const a of document.querySelectorAll('a[href*="/purchase/"]')) {
      let c = a.parentElement;
      for (let i = 0; i < 6 && c; i++, c = c.parentElement) if (c.querySelector('h1,h2,h3,h4,[class*="title"]')) break;
      const key = c ? c : a; if (seen.has(key)) continue; seen.add(key);
      const h = c?.querySelector('h1,h2,h3,h4,[class*="title"]');
      out.push({ title: h ? h.innerText.trim() : '', block: (c || a).innerText.replace(/\s+/g, ' ').slice(0, 300), times: [...(c || a).querySelectorAll('a[href*="/purchase/"]')].map(x => x.innerText.trim() + (x.className ? ` {${x.className}}` : '')).slice(0, 12) });
    }
    return out;
  });
  try {
    const r = await site.load('https://sunscinema.com/', 'HOME page');
    if (!r) return;
    const { p } = r;
    const all = await links(p);
    H('[SUNS] home: text head'); L(clip(r.text, 5000));
    H('[SUNS] home: link dump'); dumpLinks(all, 150);
    const fut = all.find(l => /future dates/i.test(l.t));
    L('Future Dates link:', fut ? fut.h : 'not found');
    const dayLinks = all.filter(l => !/\/purchase\//.test(l.h) && (/^(mon|tue|wed|thu|fri|sat|sun|today|tomorrow)/i.test(l.t) || /\d{4}-\d{2}-\d{2}|[?&](date|day)=/i.test(l.h)));
    L('Day links:'); dayLinks.forEach(l => L(`  "${l.t}" -> ${l.h}`));
    H('[SUNS] home: films (blocks around /purchase/ links; links NOT opened)');
    const f0 = await showFilms(p); f0.forEach((f, i) => L(`  #${i + 1} "${f.title}" times=${JSON.stringify(f.times)}\n      block: ${f.block}`));
    L('sold-out mentions:', (r.text.match(/sold out/gi) || []).length);
    H('[SUNS] home: date/time lines'); dateTimeLines(r.text, 60);

    await terms(site, p);

    const day = dayLinks.find(l => l.h.replace(/\/$/, '') !== 'https://sunscinema.com' && !/today/i.test(l.t)) || dayLinks[1];
    if (day) {
      const d = await site.load(day.h, `DAY page ("${day.t}")`);
      if (d) {
        H('[SUNS] day page: text head'); L(clip(d.text, 3000));
        H('[SUNS] day page: films'); (await showFilms(d.p)).forEach((f, i) => L(`  #${i + 1} "${f.title}" times=${JSON.stringify(f.times)}\n      block: ${f.block}`));
        L('sold-out mentions:', (d.text.match(/sold out/gi) || []).length);
      }
    } else L('No day link found.');

    if (fut) {
      const d = await site.load(fut.h, 'FUTURE DATES page');
      if (d) {
        H('[SUNS] future dates: text head'); L(clip(d.text, 6000));
        H('[SUNS] future dates: date/time lines'); dateTimeLines(d.text, 120);
        H('[SUNS] future dates: films'); (await showFilms(d.p)).slice(0, 40).forEach((f, i) => L(`  #${i + 1} "${f.title}" times=${JSON.stringify(f.times)}\n      block: ${f.block}`));
        L('sold-out mentions:', (d.text.match(/sold out/gi) || []).length);
        H('[SUNS] future dates: link dump'); dumpLinks(await links(d.p), 80);
      }
    }

    const filmLink = all.find(l => !/\/purchase\//.test(l.h) && /sunscinema\.com\/(movie|movies|film|films|event|events|show|shows)\/[^/]+/i.test(l.h));
    if (filmLink) {
      const d = await site.load(filmLink.h, `FILM page ("${filmLink.t}")`);
      if (d) {
        H('[SUNS] film page: text head'); L(clip(d.text, 3500));
        H('[SUNS] film page: date/time lines'); dateTimeLines(d.text, 60);
        L('runtime matches:', JSON.stringify(d.text.match(/\b\d{2,3}\s*(min|mins|minutes)\b|\b\d\s*h(r|our)?s?\s*\d{1,2}\s*m/gi)));
        L('format matches:', JSON.stringify([...new Set(d.text.match(/\b(35mm|70mm|16mm|DCP|digital|4K)\b/gi) || [])]));
        L('price matches:', JSON.stringify([...new Set(d.text.match(/\$\s?\d+(\.\d\d)?/g) || [])]));
        L('rating matches:', JSON.stringify([...new Set(d.text.match(/\b(Rated\s+)?(G|PG|PG-13|R|NC-17|NR|Not Rated|Unrated)\b(?=\s|,|$)/g) || [])].slice(0, 10)));
      }
    } else L('No film page link found among home links.');
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
