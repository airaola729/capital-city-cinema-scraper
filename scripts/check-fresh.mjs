// Fails the workflow run (exit 1) when any theater's data, or the AFI specials,
// isn't current for today's date in Washington, DC. The scraper itself keeps the
// last good data for a failed theater, so without this check a broken source would
// look like a successful run. Usage: node scripts/check-fresh.mjs [path/to/meta.json]
import { readFileSync, appendFileSync } from 'node:fs';

const metaPath = process.argv[2] || 'data/meta.json';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const meta = JSON.parse(readFileSync(metaPath, 'utf8'));

const rows = [];
const problems = [];
for (const [id, t] of Object.entries(meta.theaters || {})) {
  const current = t.ok === true && t.dataDate === today;
  rows.push(`| ${id} | ${current ? 'current' : 'NOT CURRENT'} | ${t.dataDate ?? '-'} | ${t.filmsToday ?? '-'} | ${t.error ? String(t.error).slice(0, 120) : ''} |`);
  if (!current) problems.push(`${id}: ${t.error || `data is for ${t.dataDate ?? 'no date'}`}`);
}
const a = meta.afiSpecials || {};
const afiCurrent = a.ok === true && a.dataDate === today;
rows.push(`| afi specials | ${afiCurrent ? 'current' : 'NOT CURRENT'} | ${a.dataDate ?? '-'} | ${a.films ?? '-'} | ${a.error ? String(a.error).slice(0, 120) : ''} |`);
if (!afiCurrent) problems.push(`afi specials: ${a.error || `data is for ${a.dataDate ?? 'no date'}`}`);
if (!Object.keys(meta.theaters || {}).length) problems.push('meta.json lists no theaters');

const summary = [
  `### Freshness check for ${today}`,
  problems.length ? `**${problems.length} problem(s):**\n${problems.map(p => `- ${p}`).join('\n')}` : 'All theaters current.',
  '',
  '| source | status | data date | films today | error |',
  '|---|---|---|---|---|',
  ...rows,
].join('\n');

console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
if (problems.length) {
  for (const p of problems) console.log(`::error title=Not current::${p}`);
  process.exit(1);
}
