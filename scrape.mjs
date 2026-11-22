// Capital City Cinema showtimes scraper.
// Runs in GitHub Actions every morning. Opens Atom Tickets, 4EYE Film Center and
// AFI Silver in Playwright Chromium and uses the same parsing code the old Claude
// scheduled task ran in the PC's built-in browser, so every file keeps the raw shape
// those scripts returned. Writes data/*.json plus data/meta.json.
//
// Atom: Cloudflare challenges background fetch() requests coming from GitHub's servers,
// while ordinary page loads in headed Chromium are served normally. So each Atom page
// is opened as a normal page load (one at a time, with a pause), and its HTML is parsed
// in the page with the original parse functions. 4EYE and AFI run the original
// in-page fetch scripts.
//
// A source that fails records its error in meta.json and keeps its last good file.
// It never tries to get past a CAPTCHA or bot check: a challenge page is recorded as
// "blocked", and no further requests are made to that site in the run.
//
// Env: MODE=headless|headed (headed needs xvfb-run), SOURCES=comma list to run a subset,
//      DATA_DIR (default ./data), ATOM_URL / FOUREYE_URL / AFI_URL (start pages, for testing),
//      CHROME_PATH (use a different Chromium binary, for testing), ATOM_PAUSE_MS (default 1500).

import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ET = 'America/New_York';
const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
const MODE = process.env.MODE === 'headed' ? 'headed' : 'headless';
const ONLY = (process.env.SOURCES || '').split(',').map(s => s.trim()).filter(Boolean);
const ATOM_URL = process.env.ATOM_URL || 'https://www.atomtickets.com/theaters/amc-georgetown-14/8353';
const FOUREYE_URL = process.env.FOUREYE_URL || 'https://4eyefilmcenter.org/now-playing/';
const AFI_URL = process.env.AFI_URL || 'https://silver.afi.com/now-playing/';
const ATOM_PAUSE_MS = +(process.env.ATOM_PAUSE_MS || 1500);

const SOURCES = ['atom', 'atom-presale-formats', 'atom-day-by-day', '4eye', 'afi'];
const ATOM_TH = { hoffman: "/theaters/amc-hoffman-center-22/7845", tysons: "/theaters/amc-tysons-corner-16/9803", georgetown: "/theaters/amc-georgetown-14/8353", "alamo-dc": "/theaters/alamo-drafthouse-cinema-dc-bryant-street/51802", "alamo-cc": "/theaters/alamo-drafthouse-cinema-crystal-city/52577", afi: "/theaters/afi-silver-theatre-cultural-center/8500" };
const ATOM_DBD_TH = { miracle: "/theaters/the-miracle-theatre/42899", angelika: "/theaters/angelika-pop-up-at-union-market/38754" };
const ATOM_IDS = Object.keys(ATOM_TH);
const DBD_IDS = Object.keys(ATOM_DBD_TH);

const todayET = () => new Date().toLocaleDateString('en-CA', { timeZone: ET });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

class BlockedError extends Error {}

// ---------------------------------------------------------------------------
// Atom parse functions. They run in the page (DOMParser) on one page's HTML.
// The parse/map code is unchanged from the old task prompt's STEP 2, 2e and 2a.
// ---------------------------------------------------------------------------

// STEP 2 parse: one theater page -> {sel, films}; film = [title, runtime, rating, atomReleaseDate, [[format, time...]...], [month, day] | null]
function ATOM_PARSE_TODAY(h) {
  const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  const map = (f, a) => { if (/imax/i.test(f)) return "IMAX"; if (/dolby/i.test(f)) return "Dolby"; if (/laser/i.test(f)) return "Laser"; if (/prime/i.test(f)) return "Prime"; if (/^xl/i.test(f)) return "XL"; if (/4dx/i.test(f)) return "4DX"; if (/3d/i.test(f)) return "3D"; if (/big show/i.test(f)) return "Big Show"; if (/screenx/i.test(f)) return "ScreenX"; if (/standard/i.test(f) || !f) { if (/open caption/i.test(a)) return "Open Caption"; if (/sensory/i.test(a)) return "Sensory"; return ""; } return f; };
  function parse(doc) {
    const films = [];
    doc.querySelectorAll('.showtime-panel').forEach(panel => {
      const a = panel.querySelector('[data-qa="ProductionHeader_Container"] a[data-csm]');
      let title = null; try { title = JSON.parse(a.getAttribute('data-csm')).productionName; } catch (e) {}
      if (!title) return;
      const head = (panel.querySelector('[data-qa="ProductionHeader_Container"]') || panel).textContent.replace(/\s+/g, ' ');
      const rt = (head.match(/(\d+hr(?: \d+m)?|\d+m)\b/) || [])[1] || null;
      let rating = null, rel = null; const g = {};
      panel.querySelectorAll('[data-qa="Showtimes_Wrapper"]').forEach(w => {
        const img = w.querySelector('img.format-icon');
        const attrs = [...w.querySelectorAll('[data-qa="Showtimes_SecondaryAttribute"]')].map(x => x.textContent.trim()).join(' ');
        const times = [...w.querySelectorAll('[data-qa="Showtimes_Button"]')].map(b => { try { const m = JSON.parse(b.getAttribute('data-product-metadata')); rating = rating || m.rating; rel = rel || m.releaseDate; } catch (e) {} return b.textContent.trim(); });
        const k = map(img ? img.alt : '', attrs); (g[k] = g[k] || []).push(...times);
      });
      let pre = null; const pw = panel.querySelector('[data-qa="PreorderShowtimes_Wrapper"]');
      if (pw) { const m = pw.textContent.replace(/\s+/g, ' ').match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})/); if (m) pre = [MON[m[1]], +m[2]]; }
      films.push([title, rt, rating, rel, Object.entries(g).map(([k, t]) => [k, ...t]), pre]);
    });
    return films;
  }
  const sel = (h.match(/serverFormat&quot;:&quot;(\d{4}-\d\d-\d\d)&quot;,&quot;dayOfWeek&quot;:&quot;\w+&quot;,&quot;isSelected&quot;:true/) || [])[1];
  return { sel, films: parse(new DOMParser().parseFromString(h, 'text/html')) };
}

// STEP 2e, part 1: presale links on one theater page dated on or before END -> [[title, date, href]...]
function ATOM_PRESALE_LINKS({ h, END }) {
  const jobs = [];
  const doc = new DOMParser().parseFromString(h, 'text/html');
  doc.querySelectorAll('.showtime-panel').forEach(panel => {
    let title = null; try { title = JSON.parse(panel.querySelector('[data-qa="ProductionHeader_Container"] a[data-csm]').getAttribute('data-csm')).productionName; } catch (e) {}
    const a = panel.querySelector('[data-qa="PreorderShowtimes_Button"]');
    if (title && a) { const m = a.getAttribute('href').match(/localDate=(\d{4}-\d\d-\d\d)/); if (m && m[1] <= END) jobs.push([title, m[1], a.getAttribute('href')]); }
  });
  return jobs;
}

// STEP 2e, part 2: formats on one presale page -> ["IMAX", ...]
function ATOM_PRESALE_FORMATS(h) {
  const map = (f) => { if (/imax/i.test(f)) return "IMAX"; if (/dolby/i.test(f)) return "Dolby"; if (/prime/i.test(f)) return "Prime"; if (/^xl/i.test(f)) return "XL"; if (/big show/i.test(f)) return "Big Show"; if (/70\s?mm/i.test(f)) return "70mm"; if (/35\s?mm/i.test(f)) return "35mm"; return null; };
  const doc = new DOMParser().parseFromString(h, 'text/html');
  return [...new Set([...doc.querySelectorAll('[data-qa="Showtimes_Wrapper"]')].map(w => map((w.querySelector('img.format-icon') || {}).alt || '')).filter(Boolean))];
}

// STEP 2a parse: one Miracle/Angelika page -> {sel, dates, films}; film = [title, runtime, rating, atomReleaseDate, [[format, time...]...]]
function ATOM_PARSE_DAY(h) {
  const map = (f, a) => { if (/imax/i.test(f)) return "IMAX"; if (/dolby/i.test(f)) return "Dolby"; if (/laser/i.test(f)) return "Laser"; if (/3d/i.test(f)) return "3D"; if (/standard/i.test(f) || !f) { if (/open caption/i.test(a)) return "Open Caption"; if (/sensory/i.test(a)) return "Sensory"; return ""; } return f; };
  function parse(doc) {
    const films = [];
    doc.querySelectorAll('.showtime-panel').forEach(panel => {
      const a = panel.querySelector('[data-qa="ProductionHeader_Container"] a[data-csm]');
      let title = null; try { title = JSON.parse(a.getAttribute('data-csm')).productionName; } catch (e) {}
      if (!title) return;
      const head = (panel.querySelector('[data-qa="ProductionHeader_Container"]') || panel).textContent.replace(/\s+/g, ' ');
      const rt = (head.match(/(\d+hr(?: \d+m)?|\d+m)\b/) || [])[1] || null;
      let rating = null, rel = null; const g = {};
      panel.querySelectorAll('[data-qa="Showtimes_Wrapper"]').forEach(w => {
        const img = w.querySelector('img.format-icon');
        const attrs = [...w.querySelectorAll('[data-qa="Showtimes_SecondaryAttribute"]')].map(x => x.textContent.trim()).join(' ');
        const times = [...w.querySelectorAll('[data-qa="Showtimes_Button"]')].map(b => { try { const m = JSON.parse(b.getAttribute('data-product-metadata')); rating = rating || m.rating; rel = rel || m.releaseDate; } catch (e) {} return b.textContent.trim(); });
        const k = map(img ? img.alt : '', attrs); (g[k] = g[k] || []).push(...times);
      });
      films.push([title, rt, rating, rel, Object.entries(g).map(([k, t]) => [k, ...t])]);
    });
    return films;
  }
  const sel = (h.match(/serverFormat&quot;:&quot;(\d{4}-\d\d-\d\d)&quot;,&quot;dayOfWeek&quot;:&quot;\w+&quot;,&quot;isSelected&quot;:true/) || [])[1];
  const dates = [...new Set([...h.matchAll(/serverFormat&quot;:&quot;(\d{4}-\d\d-\d\d)/g)].map(m => m[1]))];
  return { sel, dates, films: parse(new DOMParser().parseFromString(h, 'text/html')) };
}

// ---------------------------------------------------------------------------
// 4EYE and AFI in-page scripts (unchanged from the old task prompt, except: they
// return objects instead of BEGINJSON strings, and the timeout is a parameter).
// ---------------------------------------------------------------------------

// STEP 2b: 4EYE Film Center -> rows [date, title, time, chips]
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

// STEP 2d: AFI Silver films -> {count, errs, films}
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

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

// Returns null if the page looks normal, else {challenge: bool, msg}.
async function checkPage(page, resp) {
  const status = resp ? resp.status() : null;
  const title = (await page.title().catch(() => '')) || '';
  const html = (await page.content().catch(() => '')) || '';
  const TITLE_RX = /just a moment|attention required|access denied|pardon our interruption|are you a (human|robot)|security check|verify you are human|request blocked|captcha/i;
  const HTML_RX = /challenges\.cloudflare\.com|cf-chl-|cf_chl_opt|captcha-delivery\.com|px-captcha|_Incapsula_Resource|g-recaptcha|h-captcha/i;
  if (TITLE_RX.test(title) || (html.length < 60000 && HTML_RX.test(html))) return { challenge: true, msg: `bot check page (HTTP ${status}, title "${title}")` };
  if (status && status >= 400) return { challenge: false, msg: `HTTP ${status} (title "${title}")` };
  return null;
}

async function openPage(ctx, url) {
  const page = await ctx.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    const bad = await checkPage(page, resp);
    if (bad) throw bad.challenge ? new BlockedError(bad.msg) : new Error(bad.msg);
    log('opened', url, '->', resp && resp.status(), JSON.stringify(await page.title()));
    return page;
  } catch (e) {
    await page.close().catch(() => {});
    throw e;
  }
}

// page.evaluate has no timeout of its own; the scripts abort their fetches, this is a backstop.
async function evalWithTimeout(page, fn, timeoutMs) {
  let timer;
  const guard = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`script timed out after ${timeoutMs + 30000} ms`)), timeoutMs + 30000); });
  try { return await Promise.race([page.evaluate(fn, { timeoutMs }), guard]); }
  finally { clearTimeout(timer); }
}

// Loads Atom pages one at a time as normal page loads. Stops for the rest of the run
// as soon as any page comes back as a bot check.
class AtomSession {
  constructor(ctx, page) { this.ctx = ctx; this.page = page; this.origin = new URL(ATOM_URL).origin; this.blocked = null; this.loads = 0; this.cache = {}; }
  async html(pathOrUrl) {
    if (this.blocked) throw new BlockedError(this.blocked);
    if (this.loads++) await this.page.waitForTimeout(ATOM_PAUSE_MS + Math.floor(Math.random() * 1000));
    const url = new URL(pathOrUrl, this.origin).href;
    const resp = await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const bad = await checkPage(this.page, resp);
    if (bad && bad.challenge) { this.blocked = bad.msg + ' at ' + url; log('[atom] BLOCKED:', this.blocked); throw new BlockedError(this.blocked); }
    if (bad) throw new Error(bad.msg + ' at ' + url);
    return await resp.text();
  }
  async setDate(dt) {
    await this.ctx.clearCookies({ name: 'date' });
    if (dt) await this.ctx.addCookies([{ name: 'date', value: dt, url: this.origin + '/' }]);
  }
  parse(fn, arg) { return this.page.evaluate(fn, arg); }
}

const results = {};
async function runSource(name, fn) {
  if (ONLY.length && !ONLY.includes(name)) return;
  const t0 = Date.now();
  log(`[${name}] start`);
  try {
    const { data, summary, notes } = await fn();
    results[name] = { ok: true, data, summary, notes: notes || [], ms: Date.now() - t0 };
    log(`[${name}] ok`, JSON.stringify(summary), notes && notes.length ? JSON.stringify(notes) : '');
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 600);
    results[name] = { ok: false, error: msg, blocked: e instanceof BlockedError, ms: Date.now() - t0 };
    log(`[${name}] FAILED: ${msg}`);
    console.log(`::warning title=${name} failed::${msg.replace(/\r?\n/g, ' ')}`);
  }
}

async function readJSON(p) { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; } }

async function main() {
  const runAt = new Date().toISOString();
  const today = todayET();
  log(`run ${runAt}, today (ET) ${today}, mode ${MODE}${ONLY.length ? ', only ' + ONLY.join(',') : ''}`);
  await mkdir(DATA_DIR, { recursive: true });

  let browser = null, ctx = null, userAgent = null, launchErr = null;
  try {
    browser = await chromium.launch({ headless: MODE === 'headless', executablePath: process.env.CHROME_PATH || undefined });
    ctx = await browser.newContext({ timezoneId: ET, locale: 'en-US', viewport: { width: 1366, height: 900 } });
    const p = await ctx.newPage(); userAgent = await p.evaluate(() => navigator.userAgent); await p.close();
    log('user agent:', userAgent);
  } catch (e) { launchErr = e; log('browser launch failed:', e.message); }

  const need = names => !ONLY.length || names.some(n => ONLY.includes(n));
  const errText = e => String((e && e.message) || e).slice(0, 200);

  // --- Atom Tickets (STEP 2, 2e, 2a in the old order, one tab) ---
  let atom = null;
  if (!launchErr && need(['atom', 'atom-presale-formats', 'atom-day-by-day'])) atom = new AtomSession(ctx, await ctx.newPage());
  const atomGuard = () => { if (launchErr) throw launchErr; if (atom.blocked) throw new BlockedError(atom.blocked); };

  await runSource('atom', async () => {
    atomGuard();
    await atom.setDate(null);
    const sel = {}, out = {};
    const readOne = async id => {
      try {
        const h = await atom.html(ATOM_TH[id] + '?d=' + Date.now());
        const r = await atom.parse(ATOM_PARSE_TODAY, h);
        sel[id] = r.sel; out[id] = r.films; atom.cache[id] = h;
      } catch (e) { delete sel[id]; out[id] = 'ERR ' + errText(e); }
    };
    const bad = () => ATOM_IDS.filter(id => !Array.isArray(out[id]) || !out[id].length || sel[id] !== today);
    for (const id of ATOM_IDS) await readOne(id);
    let failed = bad();
    if (failed.length && !atom.blocked) {
      log(`[atom] retrying ${failed.join(', ')}`);
      for (const id of failed) await readOne(id);
      failed = bad();
    }
    const describe = id => Array.isArray(out[id]) ? `${id}: ${out[id].length} films, selected date ${sel[id] || 'none'}` : `${id}: ${out[id]}`;
    if (failed.length === ATOM_IDS.length) {
      const msg = 'all six theaters failed — ' + failed.map(describe).join('; ');
      throw atom.blocked ? new BlockedError(msg) : new Error(msg);
    }
    return {
      data: { sel, out },
      summary: Object.fromEntries(ATOM_IDS.map(id => [id, Array.isArray(out[id]) ? out[id].length : 'ERR'])),
      notes: failed.map(id => 'failed ' + describe(id)),
    };
  });

  await runSource('atom-presale-formats', async () => {
    atomGuard();
    await atom.setDate(null);
    const END = new Date(Date.now() + 14 * 864e5).toLocaleDateString('en-CA', { timeZone: ET });
    const jobs = [];
    for (const id of ATOM_IDS) {
      const h = atom.cache[id] || await atom.html(ATOM_TH[id] + '?d=' + Date.now()); // a theater page that can't be read fails the step, as before
      for (const [title, date, href] of await atom.parse(ATOM_PRESALE_LINKS, { h, END })) jobs.push([id, title, date, href]);
    }
    const res = [];
    for (const j of jobs) {
      try { res.push({ status: 'fulfilled', value: [j[0], j[1], j[2], await atom.parse(ATOM_PRESALE_FORMATS, await atom.html(j[3]))] }); }
      catch (e) { res.push({ status: 'rejected', reason: errText(e) }); }
    }
    if (atom.blocked) throw new BlockedError(atom.blocked);
    const r = { n: jobs.length, fail: res.filter(x => x.status !== 'fulfilled').length, hits: res.filter(x => x.value && x.value[3].length).map(x => x.value) };
    // An empty result can't be told apart from a failed read unless the main Atom read worked this run.
    if (r.n === 0 && !(results.atom && results.atom.ok)) throw new Error('no presale links found and the main Atom read did not succeed this run, so the result is not trustworthy');
    return { data: r, summary: { n: r.n, fail: r.fail, hits: r.hits.length } };
  });

  await runSource('atom-day-by-day', async () => {
    atomGuard();
    const isErr = v => typeof v === 'string';
    const out = {};
    const readTheater = async id => {
      const p = ATOM_DBD_TH[id];
      try {
        await atom.setDate(null);
        const r = await atom.parse(ATOM_PARSE_DAY, await atom.html(p + '?d=' + Date.now()));
        // A theater page always lists its dates; none found means the read failed.
        if (!r.dates.length) throw new Error('no dates found on the theater page');
        const today2 = r.sel || null; const days = {};
        if (today2) days[today2] = r.films;
        for (const dt of r.dates.filter(x => x !== today2).slice(0, 12)) {
          await atom.setDate(dt);
          const r2 = await atom.parse(ATOM_PARSE_DAY, await atom.html(p + '?d=' + Date.now()));
          if (r2.sel === dt) days[dt] = r2.films;
        }
        out[id] = { today: today2, dates: r.dates, days };
      } catch (e) { out[id] = 'ERR ' + errText(e); }
    };
    for (const id of DBD_IDS) await readTheater(id);
    const failed = DBD_IDS.filter(id => isErr(out[id]));
    if (failed.length && !atom.blocked) { log(`[atom-day-by-day] retrying ${failed.join(', ')}`); for (const id of failed) await readTheater(id); }
    await atom.setDate(null);
    const still = DBD_IDS.filter(id => isErr(out[id]));
    if (still.length === DBD_IDS.length) {
      const msg = 'both theaters failed — ' + still.map(id => `${id}: ${out[id]}`).join('; ');
      throw atom.blocked ? new BlockedError(msg) : new Error(msg);
    }
    return {
      data: out,
      summary: Object.fromEntries(DBD_IDS.map(id => [id, isErr(out[id]) ? 'ERR' : { today: out[id].today, days: Object.keys(out[id].days).length }])),
      notes: still.map(id => `failed ${id}: ${out[id]}`),
    };
  });
  if (atom) { log(`[atom] ${atom.loads} page loads`); await atom.page.close().catch(() => {}); }

  // --- 4EYE Film Center ---
  await runSource('4eye', async () => {
    if (launchErr) throw launchErr;
    const page = await openPage(ctx, FOUREYE_URL);
    try {
      const rows = await evalWithTimeout(page, FOUREYE, 90000);
      if (!rows.length) throw new Error('no showtimes parsed from /now-playing/');
      return { data: rows, summary: { rows: rows.length, dates: new Set(rows.map(r => r[0])).size } };
    } finally { await page.close().catch(() => {}); }
  });

  // --- AFI Silver ---
  await runSource('afi', async () => {
    if (launchErr) throw launchErr;
    const page = await openPage(ctx, AFI_URL);
    try {
      const r = await evalWithTimeout(page, AFI, 150000);
      if (r.films.length < 10) throw new Error(`only ${r.films.length} films parsed (ids found ${r.count}, errors ${r.errs.length}${r.errs.length ? ': ' + r.errs.slice(0, 3).join(' | ') : ''})`);
      return { data: r, summary: { ids: r.count, films: r.films.length, errs: r.errs.length } };
    } finally { await page.close().catch(() => {}); }
  });

  if (browser) await browser.close().catch(() => {});

  // --- Write data files (only for sources that succeeded) and meta.json ---
  const prev = (await readJSON(path.join(DATA_DIR, 'meta.json'))) || {};
  const meta = {
    runAt,
    today,
    mode: MODE,
    userAgent,
    runUrl: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
    note: 'A source is current only if sources[name].ok is true and sources[name].dataDate equals today (ET). Failed sources keep their last good file; dataDate/dataAt say when that file was written.',
    sources: {},
  };
  for (const name of SOURCES) {
    const r = results[name];
    const p = (prev.sources && prev.sources[name]) || {};
    if (!r) { meta.sources[name] = { ...p, skippedThisRun: true }; continue; }
    if (r.ok) {
      await writeFile(path.join(DATA_DIR, `${name}.json`), JSON.stringify(r.data) + '\n');
      meta.sources[name] = { ok: true, file: `${name}.json`, dataDate: today, dataAt: runAt, error: null, summary: r.summary, notes: r.notes, ms: r.ms };
    } else {
      meta.sources[name] = { ok: false, file: `${name}.json`, dataDate: p.dataDate || null, dataAt: p.dataAt || null, error: r.error, blocked: r.blocked, ms: r.ms };
    }
  }
  await writeFile(path.join(DATA_DIR, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

  const ran = SOURCES.filter(n => results[n]);
  const okN = ran.filter(n => results[n].ok).length;
  log(`done: ${okN}/${ran.length} sources ok`);
  for (const n of ran) log(`  ${n}: ${results[n].ok ? 'ok ' + JSON.stringify(results[n].summary) : 'FAILED ' + results[n].error}`);
  if (ran.length && okN === 0) console.log('::error title=All sources failed::No source returned data this run; see meta.json.');
}

main().catch(e => { console.error(e); process.exit(1); });
