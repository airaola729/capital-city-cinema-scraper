// Merge a browser read of the Smithsonian IMAX showtimes (scripts/smithsonian-browser.js result, saved to a file)
// into data/smithsonian.json. Same rules as scrape.mjs: a theater that came back ok replaces its entry; a failed
// one keeps its previous days with ok:false. Usage: node scripts/merge-smithsonian.mjs <result.json>
import { readFile, writeFile } from 'node:fs/promises';

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const read = async p => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; } };
const r = await read(process.argv[2]);
if (!r || !r.theaters) { console.error('no usable result in', process.argv[2]); process.exit(2); }
if (r.today !== today) { console.error(`result is for ${r.today}, today is ${today}`); process.exit(2); }
const prev = (await read('data/smithsonian.json')) || { theaters: {} };
const out = {};
for (const tid of ['si-lockheed', 'si-airbus']) {
  const t = r.theaters[tid], p = prev.theaters?.[tid] || {};
  const good = !!(t && t.ok && t.dataDate === today && t.days);
  out[tid] = good
    ? { source: 'smithsonian', ok: true, dataDate: today, fetchedAt: r.updatedAt, error: null, days: t.days, soon: t.soon || [] }
    : { source: 'smithsonian', ok: false, dataDate: p.dataDate || null, fetchedAt: p.fetchedAt || null, error: (t && t.error) || 'not read', blocked: false, days: p.days || {}, soon: p.soon || [] };
}
const okN = Object.values(out).filter(t => t.ok).length;
await writeFile('data/smithsonian.json', JSON.stringify({ today, updatedAt: r.updatedAt, status: { ok: okN === 2, error: okN === 2 ? null : (r.errs || []).slice(0, 3).join('; ') || 'partial', via: 'PC Chrome' }, note: 'Same shape as showtimes.json theaters. Feature films only (75+ minutes).', theaters: out }) + '\n');
console.log(Object.entries(out).map(([k, v]) => `${k}: ${v.ok ? 'ok, ' + (v.days[today] || []).length + ' features today, ' + Object.keys(v.days).length + ' days' : 'FAILED ' + v.error}`).join('\n'));
process.exit(okN ? 0 : 1);
