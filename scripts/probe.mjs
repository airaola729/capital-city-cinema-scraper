// Diagnostic (one-off, 2026-11-23, run 3): can the Avalon and Suns schedules be read with a plain HTTP request
// (no browser)? robots.txt checked first, 2 s between requests, listing pages only, no purchase/checkout pages.
const UA = 'CapitalCityCinema/1.0 (+https://github.com/airaola729/capital-city-cinema-scraper)';
const CHALLENGE = /just a moment|verify you are human|captcha|access denied|incapsula incident|_Incapsula_Resource/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const H = t => console.log(`\n========== ${t} ==========`);
const L = (...a) => console.log(...a);
const strip = h => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

async function get(site, n, url, label) {
  if (n.count > 0) await sleep(2000); n.count++;
  H(`[${site}] ${label} (request #${n.count}) ${url}`);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(45000) });
    const body = await r.text();
    L('status', r.status, '| final', r.url, '| content-type', r.headers.get('content-type'), '| bytes', body.length);
    const server = ['server', 'cf-ray', 'x-cdn', 'x-iinfo', 'set-cookie'].map(k => `${k}=${(r.headers.get(k) || '').slice(0, 80)}`).join(' | ');
    L('headers:', server);
    const ch = body.slice(0, 20000).match(CHALLENGE); L('challenge signs:', ch ? `YES ("${ch[0]}")` : 'none');
    return { status: r.status, body };
  } catch (e) { L('error:', e.message); return null; }
}
const ldEvents = html => {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const walk = o => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (/Event/.test(o['@type'] || '')) out.push(o); if (o['@graph']) walk(o['@graph']); } }; walk(JSON.parse(m[1])); } catch (e) { L('  (JSON-LD parse error:', e.message, ')'); }
  }
  return out;
};

async function avalon() {
  const n = { count: 0 };
  try {
    const rb = await get('AVALON', n, 'https://www.theavalon.org/robots.txt', 'robots.txt (www)');
    if (rb) L(rb.body.slice(0, 600));
    const f = await get('AVALON', n, 'https://www.theavalon.org/films/?date=20261126', 'CALENDAR DAY page, plain request');
    if (f) {
      const t = strip(f.body); const i = t.search(/Showings for/i);
      L('"Showings for" present:', i >= 0); if (i >= 0) L('text:', t.slice(i, i + 500));
      const times = [...f.body.matchAll(/ticketsearchcriteria\.aspx\?evtinfo=(\d+)[^"]*"[^>]*>\s*([\d:]+)\s*</g)].map(m => m[2] + ' #' + m[1]);
      L('time links in raw HTML:', times.length, times.slice(0, 12).join(', '));
      const cal = [...new Set([...f.body.matchAll(/\?date=(20\d{6})/g)].map(m => m[1]))].sort(); L('calendar dates in raw HTML:', cal.join(' '));
    }
    const rb2 = await get('AVALON', n, 'https://prod5.agileticketing.net/robots.txt', 'robots.txt (agile)');
    if (rb2) L(rb2.body.slice(0, 300).replace(/\s+/g, ' '));
    const a = await get('AVALON', n, 'https://prod5.agileticketing.net/websales/pages/list.aspx?epguid=ebe3acab-05c7-4109-9a69-78d1846b26af&', 'AGILE full list page, plain request (listing only)');
    if (a) {
      const t = strip(a.body);
      L('text head:', t.slice(0, 1500));
      const lines = [...t.matchAll(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun), (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}(, 20\d\d)?((\s*\d{1,2}:\d\d [AP]M)+)/g)].map(m => m[0]);
      L('date+time runs in raw HTML:', lines.length); lines.slice(0, 30).forEach(s => L('  ', s));
      const ev = ldEvents(a.body); L('JSON-LD events in raw HTML:', ev.length); ev.slice(0, 5).forEach(e => L('  ev:', e.name, e.startDate));
    }
  } catch (e) { H('[AVALON] ERROR'); L(e.stack || e.message); }
  L(`[AVALON] requests used: ${n.count}`);
}

async function suns() {
  const n = { count: 0 };
  try {
    const rb = await get('SUNS', n, 'https://sunscinema.com/robots.txt', 'robots.txt');
    if (rb) L(rb.body.slice(0, 600));
    const h = await get('SUNS', n, 'https://sunscinema.com/', 'HOME, plain request');
    if (h) {
      const ev = ldEvents(h.body); L('JSON-LD events in raw HTML:', ev.length);
      ev.forEach(e => L('  ev:', e.name, '|', e.startDate, '|', [].concat(e.offers || []).map(o => o.price + ' ' + (o.availability || '').replace('https://schema.org/', '')).join(',')));
      L('text:', strip(h.body).slice(0, 700));
    }
    const d = await get('SUNS', n, 'https://sunscinema.com/2026-11-28', 'DAY page 2026-11-28, plain request');
    if (d) { const t = strip(d.body); const i = t.indexOf('Future Dates'); L('text after date nav:', t.slice(i, i + 400)); }
    const c = await get('SUNS', n, 'https://sunscinema.com/upcoming-films-3/', 'COMING SOON, plain request');
    if (c) {
      const ev = ldEvents(c.body); const ds = ev.map(e => e.startDate).sort();
      L('JSON-LD events in raw HTML:', ev.length, 'range', ds[0], '..', ds[ds.length - 1]);
      ev.forEach(e => L('  ev:', e.name, '|', e.startDate, '|', [].concat(e.offers || []).map(o => o.price + ' ' + (o.availability || '').replace('https://schema.org/', '')).join(',')));
      L('"Run Time" mentions:', (c.body.match(/Run Time/g) || []).length, '| format words:', JSON.stringify([...new Set(strip(c.body).match(/\b(35mm|70mm|16mm|DCP|4K|restoration)\b/gi) || [])]));
    }
  } catch (e) { H('[SUNS] ERROR'); L(e.stack || e.message); }
  L(`[SUNS] requests used: ${n.count}`);
}

await avalon();
await suns();
H('DONE');
