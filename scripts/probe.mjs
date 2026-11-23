// Test run of scripts/rt.mjs on GitHub's servers (branch only): runs it, then prints a summary of data/rt.json.
import { readFileSync } from 'node:fs';
await import('./rt.mjs');
const j = JSON.parse(readFileSync('data/rt.json', 'utf8'));
console.log('=== rt.json summary ===');
console.log(JSON.stringify({ date: j.date, ok: j.ok, errors: j.errors, counts: Object.fromEntries(Object.entries(j.lists).map(([k, v]) => [k, v.length])) }));
for (const [k, v] of Object.entries(j.lists)) for (const t of v.slice(0, 12)) console.log(k, '|', t.title, '|', t.tm, '|', t.pm, '|', t.date, '|', t.url);
for (const [k, p] of Object.entries(j.pages)) console.log('page', k, JSON.stringify(p));
