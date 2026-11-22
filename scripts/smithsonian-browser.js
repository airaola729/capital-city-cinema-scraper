// Reads the Smithsonian IMAX showtimes in a real browser tab on www.si.edu (used by the Claude scheduled task
// "Capital City Cinema Smithsonian (PC Chrome)"). Paste into the page with the browser tool; it runs in the
// background and leaves its JSON result in window.__si ("running" until done, "ERROR ..." on failure).
// Feature films only (75+ minutes); the NASM 50th Anniversary Film Series gets no IMAX label.
window.__si = 'running';
(async () => {
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const TERMS = { 'si-lockheed': 52, 'si-airbus': 53 }, DAYS = 15, MIN = 75;
const ctl = new AbortController(); setTimeout(() => ctl.abort(), 150000);
const P = s => new DOMParser().parseFromString(s, 'text/html');
const add = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const longDate = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const get = async u => { const r = await fetch(u, { signal: ctl.signal, credentials: 'same-origin' }); if (!r.ok) throw new Error(u + ' HTTP ' + r.status); const t = await r.text(); if (/<title>\s*Just a moment/i.test(t)) throw new Error(u + ' bot check page'); return t; };
const pool = async (jobs, n) => { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < jobs.length) { const k = i++; out[k] = await jobs[k]().catch(e => ({ err: String(e.message || e) })); } })); return out; };
const tm = s => { const m = (s || '').match(/(\d{1,2}):(\d\d)\s*([ap])/i); return m ? `${+m[1]}:${m[2]} ${m[3].toUpperCase()}M` : null; };
const mins = t => { const [, h, m, ap] = t.match(/(\d+):(\d+) ([AP])/); return (+h % 12 + (ap === 'P' ? 12 : 0)) * 60 + +m; };
const rtStr = n => n ? `${Math.floor(n / 60)}h ${n % 60}m`.replace(/ 0m$/, '') : null;
const normRating = s => { if (!s) return null; const m = String(s).match(/\b(PG-13|NC-17|PG|G|R|NR)\b/); return m ? m[1] : /not rated|unrated/i.test(s) ? 'NR' : null; };
const raw = {}, errs = [], films = {};
const jobs = [];
for (const [tid, term] of Object.entries(TERMS)) {
  raw[tid] = {};
  for (let n = 0; n < DAYS; n++) {
    const dt = add(today, n);
    jobs.push(async () => {
      const h = await get(`/taxonomy/term/${term}?field_day_value=${dt}`);
      if (!/c-film-teaser/.test(h)) throw new Error(`${tid} ${dt}: no film list`);
      const d = P(h), main = d.querySelector('main') || d.body;
      if (!main.textContent.replace(/\s+/g, ' ').includes(longDate(dt))) throw new Error(`${tid} ${dt}: page not for that date`);
      raw[tid][dt] = [...main.querySelectorAll('.c-film-teaser__title')].map(h2 => {
        const card = h2.closest('.c-film-teaser') || h2.parentElement;
        const a = h2.querySelector('a[href]') || card.querySelector('a[href*="/movie/"]');
        return { title: h2.textContent.replace(/\s+/g, ' ').trim(), path: a ? new URL(a.href, location.href).pathname : null, times: [...card.querySelectorAll('.c-film-teaser__time')].map(li => tm(li.textContent)).filter(Boolean) };
      });
    });
  }
}
(await pool(jobs, 3)).forEach(r => { if (r && r.err) errs.push(r.err); });
const paths = [...new Set(Object.values(raw).flatMap(b => Object.values(b).flat()).filter(f => f.path && f.times.length).map(f => f.path))];
(await pool(paths.map(p => async () => {
  const d = P(await get(p));
  const rt = d.querySelector('.field--name-field-runtime'), ra = d.querySelector('.field--name-field-rating');
  films[p] = { runtime: rt ? +(rt.textContent.match(/(\d{2,3})\s*min/i) || [])[1] || null : null, rating: ra ? ra.textContent.replace(/^\s*Rating\s*/i, '').trim() : null };
}), 3)).forEach(r => { if (r && r.err) errs.push(r.err); });
const theaters = {};
for (const tid of Object.keys(TERMS)) {
  const byDay = raw[tid];
  if (!byDay[today]) { theaters[tid] = { ok: false, error: "today's page couldn't be read" + (errs.length ? ': ' + errs.slice(0, 2).join('; ') : '') }; continue; }
  const days = {};
  for (const dt of Object.keys(byDay).sort()) for (const f of byDay[dt]) {
    const info = films[f.path] || {};
    if (!f.times.length || !(info.runtime >= MIN)) continue;
    const series = /50th (anniversary )?film series/i.test(f.title);
    const title = f.title.replace(/\s*[-–—:]\s*NASM 50th (Anniversary )?Film Series\s*$/i, '').trim();
    const list = days[dt] = days[dt] || [];
    let e = list.find(x => x.title === title);
    if (!e) list.push(e = { title, rating: normRating(info.rating), runtime: rtStr(info.runtime), released: null, groups: [[series ? '' : 'IMAX']] });
    e.groups[0].push(...f.times);
  }
  for (const list of Object.values(days)) for (const e of list) e.groups[0] = [e.groups[0][0], ...[...new Set(e.groups[0].slice(1))].sort((a, b) => mins(a) - mins(b))];
  theaters[tid] = { ok: true, dataDate: today, error: null, datesRead: Object.keys(byDay).length, days, soon: [] };
}
return JSON.stringify({ today, updatedAt: new Date().toISOString(), errs: errs.slice(0, 10), theaters });
})().then(r => { window.__si = r; }, e => { window.__si = 'ERROR ' + (e && e.message || e); });
'started'