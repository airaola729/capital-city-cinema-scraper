// Capital City Cinema showtimes scraper (runs daily in GitHub Actions).
//
// Sources, one per theater, all readable from GitHub's servers without bot checks:
//   alamo-dc, alamo-cc        Alamo Drafthouse's own schedule JSON (dc-metro-area market)
//   hoffman, tysons, georgetown   Fever theater pages (AMC's own site blocks automated access)
//   angelika                  Angelika's own page; the schedule JSON its page loads is captured
//   miracle                   The Miracle Theatre's own site (event list)
//   afi                       AFI Silver's own site (also saved raw as data/afi.json for the specials)
//   4eye                      4EYE Film Center's own site
//   suns                      Suns Cinema's own site (schema.org data on its home, Coming Soon and film pages;
//                             robots.txt disallows its /purchase/ ticket pages, which are never fetched)
//   si-lockheed, si-airbus    Smithsonian Theaters' own pages (Lockheed Martin IMAX on the Mall, Airbus IMAX at
//                             Udvar-Hazy); only feature films (75+ minutes) are kept, not the museum documentaries.
//                             si.edu sends GitHub's servers a Cloudflare check, so this source is opt-in (ONLY=smithsonian)
//                             and runs on a self-hosted runner at home (.github/workflows/smithsonian.yml). It writes
//                             data/smithsonian.json and leaves showtimes.json and meta.json alone.
//
// Output: data/showtimes.json (normalized per theater, per day), data/afi.json, data/meta.json.
// A theater whose source fails keeps its previous entry with ok:false; a theater is current only
// if ok is true and dataDate equals today (ET). It never tries to get past a CAPTCHA or bot check:
// a challenge is recorded as "blocked" and that source is skipped for the run. (For the Smithsonian only, the page is
// left open up to 30 s first, because si.edu's check moves on by itself for ordinary visitors; nothing more.)
//
// Env: ONLY=comma list of sources (alamo,fever,angelika,miracle,afi,4eye,suns,smithsonian), DATA_DIR (default ./data),
//      *_URL overrides and CHROME_PATH for testing, PAUSE_MS (default 1500).

import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ET = 'America/New_York';
const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
const ONLY = (process.env.ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
const PAUSE_MS = +(process.env.PAUSE_MS || 1500);
const UA = 'CapitalCityCinema/1.0 (+https://github.com/airaola729/capital-city-cinema-scraper)';
const KEEP_DAYS = 60;

const URLS = {
  alamo: process.env.ALAMO_URL || 'https://drafthouse.com/s/mother/v2/schedule/market/dc-metro-area',
  fever: process.env.FEVER_BASE || 'https://feverup.com/movies/en/united-states/movie-theaters/',
  angelika: process.env.ANGELIKA_URL || 'https://angelikafilmcenter.com/dc',
  miracle: process.env.MIRACLE_URL || 'https://themiracletheatre.com/event-category/in-theatre-movies/',
  suns: process.env.SUNS_URL || 'https://sunscinema.com/',
  afi: process.env.AFI_URL || 'https://silver.afi.com/now-playing/',
  foureye: process.env.FOUREYE_URL || 'https://4eyefilmcenter.org/now-playing/',
  smithsonian: process.env.SI_URL || 'https://www.si.edu/theaters/lockheedmartin',
};
const ALAMO_CINEMAS = { '1101': 'alamo-dc', '1102': 'alamo-cc' };
const FEVER_THEATERS = { hoffman: 'amc-hoffman-center-22', tysons: 'amc-tysons-corner-16', georgetown: 'amc-georgetown-14' };
const SI_TERMS = { 'si-lockheed': 52, 'si-airbus': 53 };   // si.edu taxonomy terms of the two IMAX theaters
const SI_DAYS = 15;                                          // the Smithsonian posts showtimes about two weeks ahead
const SI_MIN_RUNTIME = 75;                                   // museum documentaries run 25-50 minutes; features 90+
const THEATERS = ['hoffman', 'tysons', 'georgetown', 'alamo-dc', 'alamo-cc', 'afi', 'miracle', 'angelika', '4eye', 'suns'];
const OPT_IN = ['smithsonian'];   // sources that only run when named in ONLY
const SOURCE_OF = { hoffman: 'fever', tysons: 'fever', georgetown: 'fever', 'alamo-dc': 'alamo', 'alamo-cc': 'alamo', afi: 'afi', miracle: 'miracle', angelika: 'angelika', '4eye': '4eye', suns: 'suns', 'si-lockheed': 'smithsonian', 'si-airbus': 'smithsonian' };

const today = new Date().toLocaleDateString('en-CA', { timeZone: ET });
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const want = src => ONLY.length ? ONLY.includes(src) : !OPT_IN.includes(src);
class BlockedError extends Error {}

// ---------------------------------------------------------------------------
// Normalizing helpers
// ---------------------------------------------------------------------------

// Format labels used by the site: "", IMAX, Dolby, Laser, Prime, XL, 4DX, 3D, Big Show, ScreenX,
// Open Caption, Sensory, 35mm, 70mm, 16mm, 4K. Same precedence as the old Atom mapping.
function mapFormat(f = '', a = '') {
  if (/70\s?mm/i.test(f)) return '70mm'; if (/35\s?mm/i.test(f)) return '35mm'; if (/16\s?mm/i.test(f)) return '16mm';
  if (/imax/i.test(f)) return 'IMAX'; if (/dolby/i.test(f)) return 'Dolby'; if (/laser/i.test(f)) return 'Laser';
  if (/prime/i.test(f)) return 'Prime'; if (/^xl/i.test(f)) return 'XL'; if (/4dx/i.test(f)) return '4DX';
  if (/3d/i.test(f)) return '3D'; if (/big.?show/i.test(f)) return 'Big Show'; if (/screenx/i.test(f)) return 'ScreenX';
  if (/open.?caption/i.test(f) || /open.?caption/i.test(a)) return 'Open Caption';
  if (/sensory/i.test(f) || /sensory/i.test(a)) return 'Sensory';
  return '';
}
function normTime(t) {
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})\s*([ap])\.?m?\.?$/i);
  return m ? `${+m[1]}:${m[2]} ${m[3].toUpperCase()}M` : String(t).trim();
}
function from24(hhmm) { let [h, m] = hhmm.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${String(m).padStart(2, '0')} ${ap}`; }
function minutes(t) { const m = t.match(/(\d{1,2}):(\d{2})\s*([AP])M/); return m ? (+m[1] % 12) * 60 + +m[2] + (m[3] === 'P' ? 720 : 0) : 9999; }
function runtimeFrom(x) {
  if (x == null || x === '') return null;
  if (typeof x === 'number' || /^\d+$/.test(String(x).trim())) { const n = +x; return n > 0 ? `${Math.floor(n / 60)}h ${n % 60}m` : null; }
  const s = String(x).trim();
  const mins = s.match(/^(\d+)\s*min/i); if (mins) return runtimeFrom(+mins[1]);
  const h = +(s.match(/(\d+)\s*h/i) || [])[1] || 0; const m = +(s.match(/(\d+)\s*m/i) || [])[1] || 0;
  return h || m ? `${h}h ${m}m` : null;
}
const SMALL = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'to', 'by', 'of', 'in', 'vs', 'vs.', 'with', 'from']);
function smartTitle(t) {
  t = String(t || '').replace(/\s+/g, ' ').trim();
  if (/[a-z]/.test(t)) return t; // only fix ALL-CAPS titles
  let first = true;
  return t.split(' ').map(w => {
    const lw = w.toLowerCase(); let out;
    if (/^(ii|iii|iv|vi|vii|viii|ix|x|xi|xii)[:,]?$/i.test(w)) out = w.toUpperCase();
    else if (/^\d/.test(w)) out = lw;
    else if (!first && SMALL.has(lw)) out = lw;
    else out = lw.replace(/(^|[-(“"])(\p{L})/gu, (m, p, c) => p + c.toUpperCase());
    first = /[:–—-]$/.test(w);
    return out;
  }).join(' ');
}
const unescape = s => String(s).replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;|&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

// Build one theater entry from raw items: {date, title, rating, runtime, released, label, time}
function buildDays(items) {
  const days = {};
  for (const it of items) {
    if (!it.date || it.date < today || it.date > addDays(today, KEEP_DAYS) || !it.title || !it.time) continue;
    const list = days[it.date] = days[it.date] || [];
    let f = list.find(x => x.title.toLowerCase() === it.title.toLowerCase());
    if (!f) { f = { title: it.title, rating: it.rating || null, runtime: it.runtime || null, released: it.released || null, groups: {} }; list.push(f); }
    f.rating = f.rating || it.rating || null; f.runtime = f.runtime || it.runtime || null; f.released = f.released || it.released || null;
    const g = f.groups[it.label || ''] = f.groups[it.label || ''] || new Set();
    g.add(normTime(it.time));
  }
  const out = {};
  for (const d of Object.keys(days).sort()) {
    out[d] = days[d].map(f => ({ ...f, groups: Object.entries(f.groups).map(([k, s]) => [k, ...[...s].sort((a, b) => minutes(a) - minutes(b))]) }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }
  return out;
}
const countFilms = days => days[today] ? days[today].length : 0;

// ---------------------------------------------------------------------------
// Bot-check detection and fetch helpers
// ---------------------------------------------------------------------------

const CH_TITLE = /just a moment|attention required|access denied|pardon our interruption|are you a (human|robot)|security check|verify you are human|request blocked|captcha/i;
const CH_HTML = /challenges\.cloudflare\.com\/turnstile|cf-chl-|cf_chl_opt|captcha-delivery\.com|px-captcha|_Incapsula_Resource|g-recaptcha|h-captcha/i;
function challengeIn(status, title, body) {
  if (CH_TITLE.test(title || '') || (body.length < 60000 && CH_HTML.test(body))) return `bot check page (HTTP ${status}, title "${title || ''}")`;
  return null;
}
async function getText(url, accept = 'text/html') {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept }, signal: AbortSignal.timeout(45000) });
  const body = await r.text();
  const ch = challengeIn(r.status, (body.match(/<title[^>]*>([^<]*)/i) || [])[1], body);
  if (ch) throw new BlockedError(ch);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return body;
}
// waitForClearMs: some sites show a "Just a moment..." page that a normal browser gets past on its own after a few
// seconds, with no click. With this set, the page is simply left open for up to that long to see whether it moves on
// by itself, as it would for any visitor. Nothing is clicked, solved or disguised; if it doesn't clear, it's blocked.
async function openPage(ctx, url, { waitForClearMs = 0 } = {}) {
  const page = await ctx.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    let status = resp ? resp.status() : 0;
    const check = async () => challengeIn(status, await page.title().catch(() => ''), await page.content().catch(() => ''));
    let ch = await check();
    if (ch && waitForClearMs > 0) {
      const until = Date.now() + waitForClearMs;
      log('challenge page; waiting up to', Math.round(waitForClearMs / 1000), 's for it to clear on its own:', url);
      while (ch && Date.now() < until) {
        await page.waitForTimeout(2000);
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        ch = await check();
      }
      if (!ch) { status = 200; log('challenge cleared on its own after', Math.round((waitForClearMs - (until - Date.now())) / 1000), 's'); await page.waitForTimeout(1500); }
    }
    if (ch) throw new BlockedError(ch + (waitForClearMs > 0 ? `; still there after waiting ${Math.round(waitForClearMs / 1000)} s` : ''));
    if (status >= 400) throw new Error(`HTTP ${status} for ${url}`);
    log('opened', url, status);
    return page;
  } catch (e) { await page.close().catch(() => {}); throw e; }
}
async function evalWithTimeout(page, fn, arg, timeoutMs) {
  let timer;
  const guard = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`script timed out after ${timeoutMs} ms`)), timeoutMs); });
  try { return await Promise.race([page.evaluate(fn, arg), guard]); } finally { clearTimeout(timer); }
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

// Alamo Drafthouse: one market JSON covers DC Bryant Street (1101) and Crystal City (1102).
async function scrapeAlamo() {
  const body = await getText(URLS.alamo, 'application/json');
  const d = JSON.parse(body).data;
  const P = Object.fromEntries(d.presentations.map(p => [p.slug, p]));
  const out = {};
  for (const [cid, tid] of Object.entries(ALAMO_CINEMAS)) {
    const items = [];
    for (const s of d.sessions) {
      if (s.cinemaId !== cid || s.isHidden) continue;
      const p = P[s.presentationSlug]; if (!p || p.isHidden) continue;
      let label = mapFormat(s.formatSlug || '');
      if (!label && s.ticketingExperience === 'SENSORY_FRIENDLY') label = 'Sensory';
      items.push({ date: s.businessDateClt, title: p.show.title, rating: p.show.certification || null, released: p.openingDateClt || null, label, time: from24(s.showTimeClt.slice(11, 16)) });
    }
    if (!items.length) { out[tid] = { error: `no sessions for cinema ${cid} in the market feed` }; continue; }
    out[tid] = { days: buildDays(items), soon: [] };
  }
  return out;
}

// Fever: AMC theater pages. Today is server-rendered; later dates load when a date tile is clicked.
function FEVER_PARSE() {
  const out = [];
  document.querySelectorAll('[data-testid="showtimes-card"]').forEach(card => {
    const title = card.querySelector('.movie-info__title')?.textContent.replace(/\s+/g, ' ').trim();
    if (!title) return;
    const rating = card.querySelector('.movie-info__rating')?.textContent.trim() || null;
    const runtime = card.querySelector('.movie-info__runtime')?.textContent.trim() || null;
    const groups = [];
    card.querySelectorAll('.showtimes-times').forEach(g => {
      const fmt = (g.querySelector('.showtimes-times__title')?.textContent || g.querySelector('img.format-logo')?.getAttribute('alt') || '').replace(/\s+/g, ' ').trim();
      const attrs = g.querySelector('.showtimes-times__attributes')?.textContent || '';
      const times = [...g.querySelectorAll('[data-testid="movie-showtimes-item"]')].map(b => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
      if (times.length) groups.push({ fmt, attrs, times });
    });
    out.push({ title, rating, runtime, groups });
  });
  return out;
}
async function scrapeFeverTheater(ctx, slug) {
  const page = await openPage(ctx, URLS.fever + slug);
  try {
    await page.waitForSelector('[data-testid="showtimes-card"]', { timeout: 20000 }).catch(() => {});
    await page.waitForFunction(() => !document.querySelector('[class*="skeleton"], [class*="loading"], [class*="spinner"], [aria-busy="true"]'), null, { timeout: 10000, polling: 200 }).catch(() => {});
    const dates =await page.$$eval('[data-carousel="date-list"] time[datetime]', ts => [...new Set(ts.map(t => t.getAttribute('datetime')))]).catch(() => []);
    const active = await page.$eval('.date-tile--is-active time[datetime]', t => t.getAttribute('datetime')).catch(() => null) || today;
    const items = [], notes = [];
    const take = (dt, films) => { for (const f of films) for (const g of f.groups) for (const t of g.times) items.push({ date: dt, title: f.title, rating: f.rating, runtime: runtimeFrom(f.runtime), label: mapFormat(g.fmt, g.attrs), time: t }); };
    const first = await page.evaluate(FEVER_PARSE);
    if (active !== today) notes.push(`page opened on ${active}, not today`);
    take(active, first);
    // After a click the page clears the cards, shows loading placeholders, requests
    // .../movie_sessions_for_date/<date>/ and renders the cards when it answers.
    const LOADERS = '[class*="skeleton"], [class*="loading"], [class*="spinner"], [aria-busy="true"]';
    for (const dt of dates.filter(x => x > active)) {
      await sleep(PAUSE_MS);
      const respP = page.waitForResponse(r => r.url().includes(`/movie_sessions_for_date/${dt}/`), { timeout: 20000 }).catch(() => null);
      const clicked = await page.evaluate(dt => { const t = document.querySelector(`[data-carousel="date-list"] time[datetime="${dt}"]`); const b = t && t.closest('button'); if (!b) return false; b.click(); return true; }, dt);
      if (!clicked) { notes.push(`no tile for ${dt}`); continue; }
      const resp = await respP;
      if (!resp) { notes.push(`no schedule response for ${dt}`); break; }
      if (resp.status() !== 200) {
        const body = await resp.text().catch(() => '');
        const ch = challengeIn(resp.status(), (body.match(/<title[^>]*>([^<]*)/i) || [])[1], body);
        if (ch) throw new BlockedError(ch + ' on a date request');
        notes.push(`HTTP ${resp.status()} for ${dt}`); continue;
      }
      const ready = await page.waitForFunction(({ dt, L }) => document.querySelector('.date-tile--is-active time')?.getAttribute('datetime') === dt && !document.querySelector(L), { dt, L: LOADERS }, { timeout: 10000, polling: 200 }).then(() => true, () => false);
      if (!ready) { notes.push(`date ${dt} did not finish rendering`); continue; }
      await page.waitForTimeout(300);
      take(dt, await page.evaluate(FEVER_PARSE));
    }
    if (!first.length) throw new Error('no films parsed for today' + (notes.length ? ' (' + notes.join('; ') + ')' : ''));
    return { days: buildDays(items), soon: [], notes, datesRead: new Set(items.map(i => i.date)).size };
  } finally { await page.close().catch(() => {}); }
}

// Angelika Pop-Up: render its own page and keep the schedule JSON the page itself loads.
async function scrapeAngelika(ctx) {
  const page = await ctx.newPage();
  try {
    const respP = page.waitForResponse(r => /\/films\?/.test(r.url()) && /status=getShows/.test(r.url()) && /cinemaId=0000000007/.test(r.url()), { timeout: 60000 });
    const resp = await page.goto(URLS.angelika, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const status = resp ? resp.status() : 0;
    const ch = challengeIn(status, await page.title().catch(() => ''), await page.content().catch(() => ''));
    if (ch) throw new BlockedError(ch);
    const r = await respP;
    if (!r.ok()) throw new Error(`schedule request returned HTTP ${r.status()}`);
    const j = await r.json();
    const items = [], soon = [];
    const fromMovies = movies => {
      for (const m of movies || []) {
        const title = smartTitle(unescape(m.name || ''));
        for (const sd of m.showdates || []) for (const st of sd.showtypes || []) for (const s of st.showtimes || []) {
          const dt = String(s.date_time || ''); const mm = dt.match(/^(\d{4}-\d\d-\d\d)T(\d\d:\d\d)/); if (!mm) continue;
          items.push({ date: mm[1], title, rating: m.ratingDescription || null, runtime: runtimeFrom(m.length), released: m.release_date || null, label: mapFormat(st.type || '', (st.amenities || []).join(' ')), time: from24(mm[2]) });
        }
      }
    };
    if (j.nowShowing?.statusCode !== 200) throw new Error('schedule JSON had no nowShowing data');
    fromMovies(j.nowShowing?.data?.movies);
    fromMovies(j.advanceTicket?.data?.movies);
    for (const m of (Array.isArray(j.comingSoon?.data) ? j.comingSoon.data : [])) {
      if (m.release_date && m.release_date > today) soon.push({ title: smartTitle(unescape(m.name || '')), date: m.release_date.slice(0, 10), rating: m.ratingDescription || null, runtime: runtimeFrom(m.length) });
    }
    return { days: buildDays(items), soon };
  } finally { await page.close().catch(() => {}); }
}

// Suns Cinema (Mount Pleasant): the schema.org data in its own pages. The home page lists today's screenings, the
// Coming Soon page every later one, and each film showing today also gets its own page read for its later dates.
// Each ScreeningEvent has a local start time ("2026-11-23T18:00:00-05:00"); runtime and release date come from the Movie.
// Suns gives no MPAA rating or projection format, so those stay empty. Ticket (/purchase/) pages are never fetched.
function ldObjects(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let j; try { j = JSON.parse(m[1]); } catch { continue; }
    const walk = o => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o['@type']) out.push(o); if (o['@graph']) walk(o['@graph']); } };
    walk(j);
  }
  return out;
}
const isoMinutes = d => { const m = String(d || '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?/i); return m && (m[1] || m[2]) ? (+m[1] || 0) * 60 + (+m[2] || 0) : null; };
async function scrapeSuns() {
  const base = new URL(URLS.suns);
  const types = o => [].concat(o['@type'] || []);
  const key = s => unescape(String(s || '')).toLowerCase().replace(/[’‘`]/g, "'").replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const movies = [], events = new Map();
  const take = html => {
    const objs = ldObjects(html);
    for (const o of objs) {
      if (types(o).includes('Movie') && o.name) movies.push(o);
      if (types(o).includes('ScreeningEvent') && o.startDate) events.set(o.url || `${o.name}|${o.startDate}`, o);
    }
    return objs;
  };
  const home = take(await getText(URLS.suns));
  if (!home.some(o => types(o).includes('MovieTheater'))) throw new Error('schema.org schedule data not found on the home page');
  const showingToday = [...new Set(movies.map(m => m.url).filter(u => { try { const x = new URL(u); return x.host === base.host && /^\/movies\/[^/]+\/?$/.test(x.pathname); } catch { return false; } }))];
  await sleep(PAUSE_MS);
  take(await getText(new URL('/upcoming-films-3/', base).href));
  let filmPages = 0;
  for (const u of showingToday.slice(0, 10)) { await sleep(PAUSE_MS); take(await getText(u)); filmPages++; }
  const byId = new Map(movies.filter(m => m['@id']).map(m => [m['@id'], m]));
  const byName = new Map(movies.map(m => [key(m.name), m]));
  const items = [];
  for (const e of events.values()) {
    if (/Cancelled|Postponed|MovedOnline/i.test(e.eventStatus || '')) continue;
    const mm = String(e.startDate).match(/^(\d{4}-\d\d-\d\d)T(\d\d:\d\d)/); if (!mm) continue;
    const evTitle = String(e.name || '').replace(/\s+-\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s*@.*$/, '').trim();
    const w = e.workPresented || {};
    const m = byId.get(w['@id']) || byName.get(key(w.name)) || byName.get(key(evTitle)) || {};
    const title = smartTitle(unescape(m.name || w.name || evTitle));
    if (!title) continue;
    items.push({ date: mm[1], title, rating: null, runtime: runtimeFrom(isoMinutes(m.duration)), released: /^\d{4}-\d\d-\d\d$/.test(m.dateCreated || '') ? m.dateCreated : null, label: '', time: from24(mm[2]) });
  }
  if (!items.length) throw new Error(`no screenings found in the schedule data (${movies.length} films, ${events.size} events)`);
  return { days: buildDays(items), soon: [], events: events.size, filmPages };
}

// The Miracle Theatre: Modern Events Calendar list (month dividers + "04 Dec" + "4:30 pm").
async function scrapeMiracle() {
  const h = await getText(URLS.miracle);
  if (!/mec-skin-list|mec-event-list/.test(h)) throw new Error('event list not found on the page');
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const items = [];
  let year = +today.slice(0, 4);
  const re = /mec-month-divider[^>]*><h5[^>]*>\s*([A-Za-z]+)\s+(\d{4})\s*<|<article class="mec-event-article[\s\S]*?<\/article>/g;
  let m;
  while ((m = re.exec(h))) {
    if (m[2]) { year = +m[2]; continue; }
    const a = m[0];
    let title = unescape((a.match(/mec-event-title">\s*<a[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const dm = a.match(/mec-event-d">(?:\s*<i[^>]*><\/i>)?\s*(\d{1,2})\s+([A-Za-z]{3})/);
    const tm = a.match(/mec-start-time">\s*([^<]+?)\s*</);
    if (!title || !dm || !tm) continue;
    const mon = MON[dm[2].toLowerCase()]; let y = year;
    const date = `${y}-${String(mon).padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
    let label = '';
    if (/open.?caption/i.test(title)) { label = 'Open Caption'; title = title.replace(/\s*[-–—(]*\s*open.?captions?\)?\s*$/i, '').trim(); }
    items.push({ date, title, label, time: tm[1] });
  }
  return { days: buildDays(items), soon: [], events: items.length };
}

// AFI Silver and 4EYE: original in-page scripts from the old task prompt.
async function FOUREYE({ timeoutMs }) {
  const ctl = new AbortController(); setTimeout(() => ctl.abort(), timeoutMs);
  const h = await (await fetch('/now-playing/?d=' + Date.now(), { signal: ctl.signal })).text();
  const doc = new DOMParser().parseFromString(h, 'text/html');
  const rows = [];
  doc.querySelectorAll('.showtimes__day[id^="day-"]').forEach(day => {
    const dt = day.id.slice(4);
    day.querySelectorAll('article.showtimes__card').forEach(c => {
      const title = c.querySelector('.showtimes__title')?.textContent.replace(/\s+/g, ' ').trim();
      const time = c.querySelector('.showtimes__when span')?.textContent.trim();
      const chips = [...c.querySelectorAll('.showtimes__chips *')].filter(x => !x.children.length).map(x => x.textContent.trim()).filter(Boolean);
      if (title) rows.push([dt, title, time, chips]);
    });
  });
  return rows;
}
async function AFI({ timeoutMs }) {
  const ctl = new AbortController(); setTimeout(() => ctl.abort(), timeoutMs);
  const get = async u => { const r = await fetch(u, { signal: ctl.signal }); if (!r.ok) throw new Error(u + ' ' + r.status); return r.text(); };
  const P = s => new DOMParser().parseFromString(s, 'text/html');
  const MON = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };
  const iso = s => { const m = (s || '').match(/([A-Z][a-z]+) (\d{1,2}), (\d{4})/); return m ? `${m[3]}-${String(MON[m[1]]).padStart(2, '0')}-${m[2].padStart(2, '0')}` : null; };
  const tm = s => s.replace(/\s+/g, ' ').trim().replace(/\s*a\.m\./i, ' AM').replace(/\s*p\.m\./i, ' PM');
  const sent = (t, max) => { if (t.length <= max) return t; const cut = t.slice(0, max); const i = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? ')); return i > 80 ? cut.slice(0, i + 1) : cut.replace(/\s+\S*$/, '') + '…'; };
  const lists = await Promise.allSettled(['/now-playing/', '/calendar/'].map(get));
  const ids = new Set(); lists.forEach(r => { if (r.status === 'fulfilled') [...r.value.matchAll(/\/movies\/detail\/(\d{10})/g)].forEach(x => ids.add(x[1])); });
  const films = [], errs = [], series = {};
  await Promise.allSettled([...ids].map(async id => {
    try {
      const d = P(await get('/movies/detail/' + id + '/')); const md = d.querySelector('.movie_detail'); if (!md) { errs.push(id); return; }
      const title = md.querySelector('h1.movie-title')?.textContent.trim();
      let sf = [], blurbs = [], surl = null;
      md.querySelectorAll('p.blurb').forEach(p => { const t = p.textContent.replace(/\s+/g, ' ').trim(); const a = p.querySelector('a[href*="/events/detail/"]'); if (/^Special Features:/.test(t)) sf = t.replace(/^Special Features:\s*/, '').split(/\s*\|\s*/).filter(Boolean); else if (a) surl = a.href; else if (t) blurbs.push(t); });
      const key = {}; d.querySelectorAll('.attributes-list .attribute').forEach(a => { key[a.querySelector('img')?.alt] = a.querySelector('span')?.textContent.trim(); });
      const RX = /(?:\b(?:35mm|70mm|16mm)\b[^.]{0,60}\bprint\b|\bprint courtesy\b|\brestor(?:ed|ation)\b[^.]{0,80}\b(?:by|from|courtesy|supervised|carried out)\b)/i;
      const notes = blurbs.join(' ').split(/(?<=[a-z0-9)”"][.!?])\s+(?=[A-Z0-9“"])/).filter(x => RX.test(x) && x.length < 240).map(x => x.replace(/^(?:NOT RATED|RATED [A-Z0-9-]+)\s+/, '')).sort((a, b) => /print/i.test(b) - /print/i.test(a));
      const shows = [...d.querySelectorAll('.show_wrap')].map(w => [iso(w.querySelector('p')?.textContent), ...[...w.querySelectorAll('a.select_show')].map(a => tm(a.textContent))]).filter(s => s[0]);
      films.push({
        id, title, surl, sf, key: Object.values(key).filter(Boolean), desc: sent(blurbs[0] || '', 300), note: notes[0] || '',
        rating: (md.querySelector('img.movie-rating')?.src || '').match(/RatingIconGraphic\/([^?]+)/)?.[1] || null,
        runtime: md.querySelector('.RunTime')?.textContent.replace(/Run Time:\s*/, '').trim() || null,
        url: 'https://silver.afi.com/movies/detail/' + id + '/', shows
      });
      if (surl) series[surl] = null;
    } catch (e) { errs.push(id + ' ' + e); }
  }));
  await Promise.allSettled(Object.keys(series).map(async u => { try { series[u] = P(await get(u)).querySelector('h1')?.textContent.trim() || null; } catch (e) {} }));
  films.forEach(f => { f.series = series[f.surl] || null; delete f.surl; });
  films.sort((a, b) => a.id.localeCompare(b.id));
  return { count: ids.size, errs, films };
}
// AFI theater showtimes from the AFI scrape. Label only how a film is projected, as AFI states it.
function afiTheater(afi) {
  const items = [];
  for (const f of afi.films) {
    const raw = f.title || '';
    let label = '';
    const fm = raw.match(/\bin (35|70|16)\s?mm\b/i);
    if (fm) label = fm[1] + 'mm';
    else if (/\b4K\b.*restor|restor.*\b4K\b/i.test(raw + ' ' + (f.sf || []).join(' '))) label = '4K';
    const title = smartTitle(raw.replace(/\s*[-–—]?\s*\bin (35|70|16)\s?mm\b/i, '').trim());
    for (const s of f.shows || []) for (const t of s.slice(1)) items.push({ date: s[0], title, rating: f.rating, runtime: runtimeFrom(f.runtime), label, time: t });
  }
  return { days: buildDays(items), soon: [] };
}
function foureyeTheater(rows) {
  const items = rows.map(([date, title, time, chips]) => {
    let label = (chips.find(c => /^(35|70|16)\s?mm$/i.test(c)) || '').replace(/\s/g, '').toLowerCase();
    let t = title;
    if (/open.?caption/i.test(t)) { t = t.replace(/\s*[-–—(]*\s*open.?captions?\)?\s*$/i, '').trim(); if (!label) label = 'Open Caption'; }
    return { date, title: t, label, time };
  });
  return { days: buildDays(items), soon: [] };
}

// Smithsonian Theaters: one page per theater per day (/taxonomy/term/<id>?field_day_value=YYYY-MM-DD) with a card per
// film; each film's own page has its runtime. Runs inside a si.edu page so the site's own cookies apply.
async function SMITHSONIAN({ terms, start, days, timeoutMs }) {
  const ctl = new AbortController(); setTimeout(() => ctl.abort(), timeoutMs);
  const P = s => new DOMParser().parseFromString(s, 'text/html');
  const add = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const longDate = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const get = async u => { const r = await fetch(u, { signal: ctl.signal, credentials: 'same-origin' }); if (!r.ok) throw new Error(u + ' HTTP ' + r.status); return r.text(); };
  const pool = async (jobs, n) => { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < jobs.length) { const k = i++; out[k] = await jobs[k]().catch(e => ({ err: String(e) })); } })); return out; };
  const result = { days: {}, films: {}, errs: [], pages: 0 };
  const jobs = [];
  for (const [tid, term] of Object.entries(terms)) {
    result.days[tid] = {};
    for (let n = 0; n < days; n++) {
      const dt = add(start, n);
      jobs.push(async () => {
        const h = await get(`/taxonomy/term/${term}?field_day_value=${dt}`);
        if (!/c-film-teaser/.test(h)) throw new Error(`${tid} ${dt}: no film list on the page`);
        const d = P(h);
        const main = d.querySelector('main') || d.body;
        if (!main.textContent.replace(/\s+/g, ' ').includes(longDate(dt))) throw new Error(`${tid} ${dt}: page is not for that date`);
        result.pages++;
        const films = [];
        main.querySelectorAll('.c-film-teaser__title').forEach(h2 => {
          const card = h2.closest('.c-film-teaser') || h2.parentElement;
          const a = h2.querySelector('a[href]') || card.querySelector('a[href*="/movie/"]');
          const times = [...card.querySelectorAll('.c-film-teaser__time')].map(li => ({ t: (li.textContent.match(/\d{1,2}:\d\d\s*[ap]\.?m/i) || [])[0], onsite: /--onsite/.test(li.className) })).filter(x => x.t);
          films.push({ title: h2.textContent.replace(/\s+/g, ' ').trim(), path: a ? new URL(a.href, location.href).pathname : null, times, text: card.textContent.replace(/\s+/g, ' ').trim().slice(0, 400) });
        });
        result.days[tid][dt] = films;
      });
    }
  }
  (await pool(jobs, 3)).forEach(r => { if (r && r.err) result.errs.push(r.err); });
  const paths = [...new Set(Object.values(result.days).flatMap(byDay => Object.values(byDay).flat()).filter(f => f.path && f.times.length).map(f => f.path))];
  (await pool(paths.map(p => async () => {
    const d = P(await get(p));
    const rt = d.querySelector('.field--name-field-runtime');
    const ra = d.querySelector('.field--name-field-rating');
    const mins = rt && +(rt.textContent.match(/(\d{2,3})\s*min/i) || [])[1];
    result.films[p] = { runtime: mins || null, rating: ra ? ra.textContent.replace(/^\s*Rating\s*/i, '').replace(/\s+/g, ' ').trim() : null };
  }), 3)).forEach(r => { if (r && r.err) result.errs.push(r.err); });
  return result;
}
function normRating(s) {
  if (!s) return null;
  const m = String(s).match(/\b(PG-13|NC-17|PG|G|R|NR)\b/);
  return m ? m[1] : /not rated|unrated/i.test(s) ? 'NR' : null;
}
// Keep feature films only. Everything at these two theaters is projected in IMAX except the NASM 50th Anniversary
// Film Series, which the museum says are not IMAX presentations, so those get no label.
function smithsonianTheaters(raw) {
  const out = {};
  for (const tid of Object.keys(SI_TERMS)) {
    const byDay = raw.days[tid] || {};
    if (!byDay[today]) { out[tid] = { error: `today's page couldn't be read${raw.errs.length ? ' (' + raw.errs.slice(0, 2).join('; ') + ')' : ''}` }; continue; }
    const items = [];
    for (const [dt, films] of Object.entries(byDay)) for (const f of films) {
      const info = raw.films[f.path] || {};
      if (!f.times.length || !(info.runtime >= SI_MIN_RUNTIME)) continue;
      const series = /50th (anniversary )?film series/i.test(f.title);
      const title = smartTitle(f.title.replace(/\s*[-–—]\s*NASM 50th (Anniversary )?Film Series\s*$/i, '').trim());
      for (const x of f.times) items.push({ date: dt, title, rating: normRating(info.rating), runtime: runtimeFrom(info.runtime), label: series ? '' : 'IMAX', time: x.t });
    }
    out[tid] = { days: buildDays(items), soon: [], datesRead: Object.keys(byDay).length };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function readJSON(p) { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; } }

async function main() {
  const runAt = new Date().toISOString();
  log(`run ${runAt}, today (ET) ${today}${ONLY.length ? ', only ' + ONLY.join(',') : ''}`);
  await mkdir(DATA_DIR, { recursive: true });
  const results = {}; // theaterId -> {days, soon, notes} | {error, blocked}
  const status = {};  // source -> {ok, error, blocked, ms, summary}
  let afiRaw = null;

  const run = async (src, fn) => {
    if (!want(src)) return;
    const t0 = Date.now(); log(`[${src}] start`);
    try { const summary = await fn(); status[src] = { ok: true, ms: Date.now() - t0, summary }; log(`[${src}] ok`, JSON.stringify(summary)); }
    catch (e) {
      const msg = String((e && e.message) || e).slice(0, 500);
      status[src] = { ok: false, error: msg, blocked: e instanceof BlockedError, ms: Date.now() - t0 };
      log(`[${src}] FAILED: ${msg}`); console.log(`::warning title=${src} failed::${msg.replace(/\r?\n/g, ' ')}`);
      for (const [tid, s] of Object.entries(SOURCE_OF)) if (s === src && !results[tid]) results[tid] = { error: msg, blocked: e instanceof BlockedError };
    }
  };

  // Plain HTTP sources first.
  await run('alamo', async () => { const r = await scrapeAlamo(); Object.assign(results, r); return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.error || `${countFilms(v.days)} films today, ${Object.keys(v.days).length} days`])); });
  await run('miracle', async () => { const r = await scrapeMiracle(); results.miracle = r; return { events: r.events, days: Object.keys(r.days).length, today: countFilms(r.days) }; });
  await run('suns', async () => { const r = await scrapeSuns(); results.suns = r; return { events: r.events, filmPages: r.filmPages, days: Object.keys(r.days).length, today: countFilms(r.days) }; });

  // Browser sources.
  let browser = null, ctx = null;
  if (['fever', 'angelika', 'afi', '4eye', 'smithsonian'].some(want)) {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });
    ctx = await browser.newContext({ timezoneId: ET, locale: 'en-US', viewport: { width: 1366, height: 900 } });
  }
  await run('fever', async () => {
    const sum = {}; let blocked = null;
    for (const [tid, slug] of Object.entries(FEVER_THEATERS)) {
      if (blocked) { results[tid] = { error: blocked, blocked: true }; sum[tid] = 'skipped (blocked)'; continue; }
      try { const r = await scrapeFeverTheater(ctx, slug); results[tid] = r; sum[tid] = `${countFilms(r.days)} films today, ${r.datesRead} dates read${r.notes.length ? ', notes: ' + r.notes.join('; ') : ''}`; }
      catch (e) { const msg = String(e.message || e).slice(0, 300); results[tid] = { error: msg, blocked: e instanceof BlockedError }; sum[tid] = 'FAILED ' + msg; if (e instanceof BlockedError) blocked = msg; }
      await sleep(PAUSE_MS);
    }
    if (FEVER_THEATERS && Object.keys(FEVER_THEATERS).every(t => results[t].error)) throw (blocked ? new BlockedError(blocked) : new Error('all three AMC theaters failed: ' + JSON.stringify(sum)));
    return sum;
  });
  await run('angelika', async () => { const r = await scrapeAngelika(ctx); results.angelika = r; return { today: countFilms(r.days), days: Object.keys(r.days).length, soon: r.soon.length }; });
  await run('afi', async () => {
    const page = await openPage(ctx, URLS.afi);
    try {
      const r = await evalWithTimeout(page, AFI, { timeoutMs: 150000 }, 180000);
      if (r.films.length < 10) throw new Error(`only ${r.films.length} films parsed (ids found ${r.count}, errors ${r.errs.length})`);
      afiRaw = r; results.afi = afiTheater(r);
      return { films: r.films.length, errs: r.errs.length, today: countFilms(results.afi.days), days: Object.keys(results.afi.days).length };
    } finally { await page.close().catch(() => {}); }
  });
  await run('4eye', async () => {
    const page = await openPage(ctx, URLS.foureye);
    try {
      const rows = await evalWithTimeout(page, FOUREYE, { timeoutMs: 90000 }, 120000);
      if (!rows.length) throw new Error('no showtimes parsed from /now-playing/');
      results['4eye'] = foureyeTheater(rows);
      return { rows: rows.length, today: countFilms(results['4eye'].days) };
    } finally { await page.close().catch(() => {}); }
  });
  await run('smithsonian', async () => {
    const page = await openPage(ctx, URLS.smithsonian, { waitForClearMs: 30000 });
    try {
      const raw = await evalWithTimeout(page, SMITHSONIAN, { terms: SI_TERMS, start: today, days: SI_DAYS, timeoutMs: 150000 }, 180000);
      if (!raw.pages) throw new Error('no showtime pages could be read' + (raw.errs.length ? ': ' + raw.errs.slice(0, 3).join('; ') : ''));
      const r = smithsonianTheaters(raw);
      Object.assign(results, r);
      return { pages: raw.pages, errs: raw.errs.length, ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.error || `${countFilms(v.days)} features today, ${Object.keys(v.days).length} days with features, ${v.datesRead} dates read`])) };
    } finally { await page.close().catch(() => {}); }
  });
  if (browser) await browser.close().catch(() => {});

  // Smithsonian theaters go to their own file (written by the home runner), merged like the others.
  if (want('smithsonian')) {
    const prevSi = (await readJSON(path.join(DATA_DIR, 'smithsonian.json'))) || { theaters: {} };
    const siTheaters = {};
    for (const tid of Object.keys(SI_TERMS)) {
      const r = results[tid], p = prevSi.theaters?.[tid] || {};
      const base = { source: 'smithsonian' };
      if (!r || r.error) siTheaters[tid] = { ...base, ok: false, dataDate: p.dataDate || null, fetchedAt: p.fetchedAt || null, error: (r && r.error) || 'not run', blocked: !!(r && r.blocked), days: p.days || {}, soon: p.soon || [] };
      else siTheaters[tid] = { ...base, ok: true, dataDate: today, fetchedAt: runAt, error: null, days: r.days, soon: r.soon || [] };
    }
    await writeFile(path.join(DATA_DIR, 'smithsonian.json'), JSON.stringify({ today, updatedAt: runAt, status: status.smithsonian || null, note: 'Same shape as showtimes.json theaters. Feature films only (75+ minutes).', theaters: siTheaters }) + '\n');
    log(`smithsonian: ${Object.entries(siTheaters).map(([k, v]) => `${k}:${v.ok ? v.days?.[today]?.length || 0 : 'X ' + v.error}`).join(' ')}`);
    if (ONLY.length && ONLY.every(s => OPT_IN.includes(s))) return;   // home-runner run: leave the other files alone
  }

  // Merge with the previous file: failed or skipped theaters keep their last good data.
  const prev = (await readJSON(path.join(DATA_DIR, 'showtimes.json'))) || { theaters: {} };
  const theaters = {};
  for (const tid of THEATERS) {
    const r = results[tid], p = prev.theaters?.[tid] || {};
    const base = { source: SOURCE_OF[tid] };
    if (!r) theaters[tid] = { ...base, ...p, skippedThisRun: true };
    else if (r.error) theaters[tid] = { ...base, ok: false, dataDate: p.dataDate || null, fetchedAt: p.fetchedAt || null, error: r.error, blocked: !!r.blocked, days: p.days || {}, soon: p.soon || [] };
    else theaters[tid] = { ...base, ok: true, dataDate: today, fetchedAt: runAt, error: null, days: r.days, soon: r.soon || [] };
  }
  const showtimes = {
    today, updatedAt: runAt,
    note: 'A theater is current only if ok is true and dataDate equals today (ET). days maps YYYY-MM-DD to films [{title, rating, runtime, released, groups: [[label, "7:15 PM", ...]]}]. soon lists first dates known without showtimes.',
    theaters,
  };
  await writeFile(path.join(DATA_DIR, 'showtimes.json'), JSON.stringify(showtimes) + '\n');
  if (afiRaw) await writeFile(path.join(DATA_DIR, 'afi.json'), JSON.stringify(afiRaw) + '\n');

  const prevMeta = (await readJSON(path.join(DATA_DIR, 'meta.json'))) || {};
  const meta = {
    runAt, today,
    runUrl: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
    afiSpecials: afiRaw ? { ok: true, dataDate: today, films: afiRaw.films.length, error: null }
      : status.afi ? { ok: false, dataDate: prevMeta.afiSpecials?.dataDate || null, films: prevMeta.afiSpecials?.films || null, error: status.afi.error }
      : (prevMeta.afiSpecials || { ok: false, dataDate: null, error: 'not run' }),
    sources: Object.fromEntries(Object.entries(status)),
    theaters: Object.fromEntries(Object.entries(theaters).map(([k, v]) => [k, { ok: v.ok, dataDate: v.dataDate, source: v.source, filmsToday: v.days?.[today]?.length || 0, days: Object.keys(v.days || {}).length, error: v.error || null }])),
  };
  await writeFile(path.join(DATA_DIR, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

  const okT = THEATERS.filter(t => theaters[t].ok && theaters[t].dataDate === today);
  log(`done: ${okT.length}/${THEATERS.length} theaters current — ${THEATERS.map(t => `${t}:${theaters[t].ok && theaters[t].dataDate === today ? theaters[t].days?.[today]?.length || 0 : 'X'}`).join(' ')}`);
  if (!okT.length && !ONLY.length) console.log('::error title=All theaters failed::No theater returned data this run; see meta.json.');
}

main().catch(e => { console.error(e); process.exit(1); });
