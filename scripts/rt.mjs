// Rotten Tomatoes scores for Capital City Cinema.
// Reads RT's public browse lists (in theaters: newest, popular, top box office; coming soon) and a few
// single movie pages for current first-run titles the lists miss, then writes data/rt.json.
// The daily Claude publish task reads that file instead of fetching RT itself.
// Plain HTTPS requests with an honest user agent; robots.txt is respected; a bot-check page is recorded, never bypassed.
// Usage: node scripts/rt.mjs   (exit code 0 even on failure; the file's "ok" and "errors" say what happened)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const UA = 'CapitalCityCinema/1.0 (+https://github.com/airaola729/capital-city-cinema-scraper)';
const BASE = 'https://www.rottentomatoes.com';
const OUT = 'data/rt.json';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const LISTS = {
  newest: '/browse/movies_in_theaters/sort:newest',
  popular: '/browse/movies_in_theaters/sort:popular',
  top_box_office: '/browse/movies_in_theaters/sort:top_box_office',
  coming_soon: '/browse/movies_coming_soon/sort:newest',
};
const PAGES = [1, 2, 3];          // RT's ?page=N; tiles are de-duplicated by URL
const MAX_LOOKUPS = 25;           // single /m/ pages per run
const PAUSE_MS = 1500;
const FIRST_RUN = ['hoffman', 'tysons', 'georgetown', 'alamo-dc', 'alamo-cc'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
const log = (...a) => console.log(...a);
const CH = /just a moment|attention required|access denied|pardon our interruption|are you a (human|robot)|verify you are human|request blocked|captcha/i;

class Blocked extends Error {}
async function get(path) {
  const r = await fetch(BASE + path, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(30000) });
  const body = await r.text();
  const title = (body.match(/<title[^>]*>([^<]*)/i) || [])[1] || '';
  if (CH.test(title) || (body.length < 60000 && /challenges\.cloudflare\.com|cf-chl-|captcha-delivery\.com|px-captcha|_Incapsula_Resource/i.test(body))) {
    throw new Blocked(`bot check page at ${path} (HTTP ${r.status}, title "${title.trim()}")`);
  }
  return { status: r.status, body, title };
}

// --- robots.txt (User-agent: * group) -------------------------------------
let disallow = [];
async function loadRobots() {
  try {
    const { status, body } = await get('/robots.txt');
    log('robots.txt HTTP', status, body.length, 'bytes');
    let star = false;
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.replace(/#.*/, '').trim();
      const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
      if (!m) continue;
      const k = m[1].toLowerCase(), v = m[2].trim();
      if (k === 'user-agent') star = v === '*';
      else if (star && k === 'disallow' && v) disallow.push(v);
    }
    log('robots disallow (*):', disallow.join(' | ').slice(0, 1500));
  } catch (e) {
    if (e instanceof Blocked) throw e;
    errors.push('robots.txt: ' + e.message);
  }
}
function allowed(path) {
  return !disallow.some(rule => {
    const re = new RegExp('^' + rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    return re.test(path);
  });
}

// --- parsing helpers ---------------------------------------------------------
const ent = s => s.replace(/&amp;/g, '&').replace(/&#39;|&apos;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const text = s => ent(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
function isoDate(s) {
  const m = (s || '').match(/\b([A-Z][a-z]{2})[a-z]* (\d{1,2}), (\d{4})/);
  return m && MON[m[1]] ? `${m[3]}-${String(MON[m[1]]).padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}
const pct = s => { const m = String(s ?? '').match(/(\d{1,3})/); return m ? +m[1] : null; };

function parseTiles(html) {
  // Each movie tile links to /m/<slug>; split the page at those links and read each chunk.
  const out = [];
  const re = /<a\b[^>]*href="(\/m\/[a-z0-9_\-]+)"[^>]*>/gi;
  const idx = [];
  let m;
  while ((m = re.exec(html))) idx.push([m.index, m[1]]);
  const seen = new Set();
  for (let i = 0; i < idx.length; i++) {
    const [pos, url] = idx[i];
    const chunk = html.slice(pos, i + 1 < idx.length ? idx[i + 1][0] : pos + 6000);
    const titleM = chunk.match(/data-qa="discovery-media-list-item-title"[^>]*>([\s\S]*?)<\/span>/i);
    if (!titleM) continue;
    const title = text(titleM[1]);
    if (!title) continue;
    const dateM = chunk.match(/data-qa="discovery-media-list-item-start-date"[^>]*>([\s\S]*?)<\/span>/i);
    const dateText = dateM ? text(dateM[1]) : null;
    let tm = null, pm = null;
    const a1 = chunk.match(/criticsscore="(\d*)"/i), a2 = chunk.match(/audiencescore="(\d*)"/i);
    if (a1) tm = pct(a1[1]);
    if (a2) pm = pct(a2[1]);
    const s1 = chunk.match(/slot="criticsScore"[^>]*>([\s\S]*?)<\//i), s2 = chunk.match(/slot="audienceScore"[^>]*>([\s\S]*?)<\//i);
    if (tm == null && s1) tm = pct(text(s1[1]));
    if (pm == null && s2) pm = pct(text(s2[1]));
    const key = url + '|' + title;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, tm, pm, date: dateText, released: isoDate(dateText), rerelease: /re-?releas/i.test(dateText || ''), url: BASE + url });
  }
  return out;
}

function parseMoviePage(html, path) {
  const res = { url: BASE + path, title: null, year: null, released: null, tm: null, pm: null };
  const sc = html.match(/<script[^>]*id="media-scorecard-json"[^>]*>([\s\S]*?)<\/script>/i);
  if (sc) {
    try {
      const j = JSON.parse(sc[1]);
      res.tm = pct(j?.criticsScore?.score);
      res.pm = pct(j?.audienceScore?.score);
      res.title = j?.scoreboard?.title || null;
      const info = j?.scoreboard?.info || '';
      const y = String(info).match(/\b(19|20)\d{2}\b/);
      if (y) res.year = +y[0];
    } catch (e) { /* fall through */ }
  }
  for (const block of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(block[1]);
      const items = Array.isArray(j) ? j : (j['@graph'] || [j]);
      for (const it of items) {
        if (it && it['@type'] === 'Movie') {
          res.title = res.title || it.name || null;
          if (it.dateCreated) { res.released = String(it.dateCreated).slice(0, 10); res.year = res.year || +String(it.dateCreated).slice(0, 4); }
        }
      }
    } catch (e) { /* ignore */ }
  }
  const rel = html.match(/Release Date \(Theaters\)[\s\S]{0,400}?([A-Z][a-z]{2} \d{1,2}, \d{4})/);
  if (rel) res.released = isoDate(rel[1]) || res.released;
  if (!res.title) res.title = text((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '') || null;
  return res;
}

const norm = t => ent(t).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[‘’]/g, "'").replace(/\(?\b\d+(st|nd|rd|th)?\s+anniversary\)?/g, ' ')
  .replace(/\s*\(\d{4}\)\s*$/, '').replace(/&/g, ' ').replace(/\band\b/g, ' ').replace(/[^a-z0-9]/g, '');
const slugify = t => ent(t).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\s*\(\d{4}\)\s*$/, '').replace(/&/g, 'and').replace(/['’.!?,:;]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

// --- main ------------------------------------------------------------------
const result = { date: today, fetchedAt: new Date().toISOString(), ok: false, source: BASE, errors, lists: {}, pages: {} };
let blocked = null;
try {
  await loadRobots();
  for (const [name, path] of Object.entries(LISTS)) {
    const tiles = [];
    const urls = new Set();
    for (const p of PAGES) {
      const q = p === 1 ? path : `${path}?page=${p}`;
      if (!allowed(q.split('?')[0])) { errors.push(`robots.txt disallows ${q}`); break; }
      await sleep(PAUSE_MS);
      try {
        const { status, body } = await get(q);
        const got = parseTiles(body);
        let added = 0;
        for (const t of got) if (!urls.has(t.url)) { urls.add(t.url); tiles.push(t); added++; }
        log(`${name} page ${p}: HTTP ${status}, ${body.length} bytes, ${got.length} tiles, ${added} new`);
        if (p === 1 && !got.length) log('  sample:', body.slice(body.indexOf('/m/') - 300, body.indexOf('/m/') + 1200).replace(/\s+/g, ' '));
        if (!added) break;
      } catch (e) {
        if (e instanceof Blocked) throw e;
        errors.push(`${name} page ${p}: ${e.message}`);
        break;
      }
    }
    result.lists[name] = tiles;
  }

  // Single pages for current first-run titles the lists don't cover.
  const listed = new Set(Object.values(result.lists).flat().map(t => norm(t.title)));
  const wanted = new Map();
  if (existsSync('data/showtimes.json')) {
    const s = JSON.parse(readFileSync('data/showtimes.json', 'utf8'));
    for (const id of FIRST_RUN) {
      for (const [d, films] of Object.entries(s.theaters?.[id]?.days || {})) {
        if (d < today) continue;
        for (const f of films) {
          const k = norm(f.title);
          if (!k || listed.has(k)) continue;
          if (/anniversary|\(\d{4}\)|live viewing|opera|concert|episode|series|sneak peek|party|insider|marathon/i.test(f.title)) continue;
          wanted.set(k, { title: f.title, n: (wanted.get(k)?.n || 0) + 1 });
        }
      }
    }
  }
  const order = [...wanted.values()].sort((a, b) => b.n - a.n);
  const thisYear = +today.slice(0, 4);
  let lookups = 0;
  for (const w of order) {
    if (lookups >= MAX_LOOKUPS) break;
    const base = slugify(w.title);
    if (!base) continue;
    for (const cand of [`/m/${base}_${thisYear}`, `/m/${base}`]) {
      if (lookups >= MAX_LOOKUPS) break;
      if (!allowed(cand)) { errors.push(`robots.txt disallows ${cand}`); break; }
      await sleep(PAUSE_MS);
      lookups++;
      try {
        const r = await fetch(BASE + cand, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(30000), redirect: 'follow' });
        const body = await r.text();
        const title = (body.match(/<title[^>]*>([^<]*)/i) || [])[1] || '';
        if (CH.test(title)) throw new Blocked(`bot check page at ${cand} (HTTP ${r.status})`);
        if (r.status !== 200) { log(`lookup ${cand}: HTTP ${r.status}`); continue; }
        const page = parseMoviePage(body, new URL(r.url).pathname);
        log(`lookup ${cand}: ${JSON.stringify(page)}`);
        if (page.year && page.year >= thisYear - 1) { page.for = w.title; result.pages[norm(w.title)] = page; break; }
      } catch (e) {
        if (e instanceof Blocked) throw e;
        errors.push(`lookup ${cand}: ${e.message}`);
      }
    }
  }
} catch (e) {
  if (e instanceof Blocked) { blocked = e.message; errors.push(e.message); }
  else errors.push(String(e && e.stack || e));
}

const total = Object.values(result.lists).reduce((n, l) => n + l.length, 0);
result.ok = !blocked && total >= 20;
log(`RT: ok=${result.ok}, ${total} list tiles (${Object.entries(result.lists).map(([k, v]) => k + ' ' + v.length).join(', ')}), ${Object.keys(result.pages).length} single pages, ${errors.length} errors`);
for (const e of errors) log('  error:', e);
if (result.ok || !existsSync(OUT)) writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n');
else {
  // keep the last good lists, but record today's failure
  const prev = JSON.parse(readFileSync(OUT, 'utf8'));
  prev.lastAttempt = { at: result.fetchedAt, ok: false, errors };
  writeFileSync(OUT, JSON.stringify(prev, null, 1) + '\n');
}
