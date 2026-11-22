# Archived: Capital City Cinema showtimes refresh (PC browser version)

Scheduled task `trig_013kbCEx7QwnteDb5uBFswvk`, "Capital City Cinema showtimes refresh (PC)", daily 10:17 ET (CRON_TZ=America/New_York 17 10 * * *), model claude-opus-5-5, automatic approval. Created 2026-11-05, last successful data refresh 2026-11-13. Archived 2026-11-22, when the GitHub Actions version replaced it.

How it worked: the Claude task drove the built-in browser of the Claude desktop app on Abel's PC (AI-PC). It ran in-page JavaScript on Atom Tickets for the six big theaters, Atom's presale pages, and Atom's day-by-day listings for The Miracle and Angelika. It also read 4EYE's own site and AFI Silver's own site, then wrote the `listings`/`afi` documents and republished the public page. It needed the PC to be on with the desktop app open.

To restore it: re-enable that scheduled task if it still exists (it was disabled, not deleted), or create a new scheduled task that requires the PC, using the prompt below verbatim. The same browser scripts, ported to Playwright, are in the scraper repo's git history (commits before 610d49c, e.g. dfed2a2).

---

Refresh the Capital City Cinema showtimes for today (Washington, DC date), refresh the AFI Silver specials, then republish the public copy. The main page is the artifact https://claude.ai/artifact/Rpg1NVmEbcEYe3VPLzVZC7. Its Showtimes, New releases and Upcoming tabs read two database documents: collection "listings" doc "current" and collection "afi" doc "current". Update only those two with the ArtifactData tool (load it with ToolSearch "select:ArtifactData"). Do not republish or edit the main page, and do not touch any other collection (screenings, data/users). Work silently; nothing needs to be sent to anyone.

TOOLS. Atom Tickets, 4EYE and silver.afi.com detail pages are read through the Claude desktop app's built-in browser on the owner's PC: tools named mcp__remote-devices__Claude_Browser__* (or mcp__Claude_Browser__*). Load them all with ToolSearch query "mcp__remote-devices__Claude_Browser__" (max_results 64). WebFetch works for Rotten Tomatoes and silver.afi.com/now-playing. The shell has NO outbound internet; use Python locally only to assemble JSON. If the browser tools can't be reached at all, do not write the listings or afi documents (the pages then keep the previous day and label it); still do the PUBLIC PAGE step so the public copy stays in sync, and finish with a one-line summary saying the browser was unreachable.

LARGE RESULTS. Some browser scripts below end with "BEGINJSON"+JSON+"ENDJSON"+padding so the result is saved to a tool-results file. Read it in Python: t=json.load(open(FILE))[0]['text']; v,_=json.JSONDecoder().raw_decode(t) if t.startswith('"') else (t,0); data=json.loads(v[v.index('BEGINJSON')+9:v.index('ENDJSON')]).

STEP 1 — Read the current listings document
ArtifactData "get", url above, collection "listings", doc_id "current" (without out_dir if it refuses out_dir). Note its `version` (if_version when writing). Keep the existing `baseline` and every film's `firstSeen` and `rt`.
Document shape (keep exactly):
{
  "asOf": "YYYY-MM-DD",            // today, ET
  "updatedAt": ISO-8601 UTC timestamp of this run,
  "baseline": "2026-10-24",         // never change
  "theaters": [ {id, name, short, where, site, src, ok: true|false, asOf?: "YYYY-MM-DD"} ... ],  // keep all nine entries and their order (hoffman, tysons, georgetown, alamo-dc, alamo-cc, afi, miracle, angelika, 4eye); only change ok/asOf
  "films": { "<slug>": {
      "title": str, "rating": "R"|"PG-13"|"PG"|"G"|"NR"|null, "runtime": "1h 48m"|null,
      "released": "YYYY-MM-DD"|null,      // US theatrical opening date (original date for repertory films)
      "kind": "new" | "rep" | "event",     // new = current release; rep = older film/re-release/anniversary/classic; event = concert, live viewing, opera, ballet, sports/UFC, fan event, TV episodes
      "rt": {"tm": int|null, "pm": int|null, "url": str|null} | null,
      "firstSeen": "YYYY-MM-DD",
      "playing": { "<theaterId>": [ ["<format label or empty string>", "12:40 PM", "4:45 PM", ...], ... ] },   // today's showtimes only, times sorted
      "soon": { "<theaterId>": "YYYY-MM-DD" },   // first future date with shows/presale, only for dates AFTER today
      "soonFmt": { "<theaterId>": ["IMAX","Dolby",...] }   // optional: premium/film formats scheduled on that first date (STEP 2e); omit when none
  } }
}
Slugs are lowercase-hyphenated titles (add the year for repertory titles, e.g. "the-omen-1976"). ALWAYS reuse an existing slug when the same film is already in the document (the page keys each viewer's watched / not-interested marks on the slug), and treat obvious variants as the same film (e.g. "Scream 30th Anniversary" = "Scream (1996)"; "Sense and Sensibility (2026)" = "Sense and Sensibility"; straight vs curly apostrophes; a trailing "(1953)").

STEP 2 — Today's showtimes for the six big theaters (Atom Tickets, built-in browser)
Open https://www.atomtickets.com/theaters/amc-georgetown-14/8353 with preview_start, wait ~2 s, then run this with javascript_tool on that tab:
document.cookie="date=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
const TH={hoffman:"/theaters/amc-hoffman-center-22/7845",tysons:"/theaters/amc-tysons-corner-16/9803",georgetown:"/theaters/amc-georgetown-14/8353","alamo-dc":"/theaters/alamo-drafthouse-cinema-dc-bryant-street/51802","alamo-cc":"/theaters/alamo-drafthouse-cinema-crystal-city/52577",afi:"/theaters/afi-silver-theatre-cultural-center/8500"};
const MON={Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
const map=(f,a)=>{ if(/imax/i.test(f))return"IMAX"; if(/dolby/i.test(f))return"Dolby"; if(/laser/i.test(f))return"Laser"; if(/prime/i.test(f))return"Prime"; if(/^xl/i.test(f))return"XL"; if(/4dx/i.test(f))return"4DX"; if(/3d/i.test(f))return"3D"; if(/big show/i.test(f))return"Big Show"; if(/screenx/i.test(f))return"ScreenX"; if(/standard/i.test(f)||!f){ if(/open caption/i.test(a))return"Open Caption"; if(/sensory/i.test(a))return"Sensory"; return""; } return f; };
function parse(doc){ const films=[]; doc.querySelectorAll('.showtime-panel').forEach(panel=>{ const a=panel.querySelector('[data-qa="ProductionHeader_Container"] a[data-csm]'); let title=null; try{title=JSON.parse(a.getAttribute('data-csm')).productionName;}catch(e){} if(!title) return; const head=(panel.querySelector('[data-qa="ProductionHeader_Container"]')||panel).textContent.replace(/\s+/g,' '); const rt=(head.match(/(\d+hr(?: \d+m)?|\d+m)\b/)||[])[1]||null; let rating=null, rel=null; const g={}; panel.querySelectorAll('[data-qa="Showtimes_Wrapper"]').forEach(w=>{ const img=w.querySelector('img.format-icon'); const attrs=[...w.querySelectorAll('[data-qa="Showtimes_SecondaryAttribute"]')].map(x=>x.textContent.trim()).join(' '); const times=[...w.querySelectorAll('[data-qa="Showtimes_Button"]')].map(b=>{ try{const m=JSON.parse(b.getAttribute('data-product-metadata')); rating=rating||m.rating; rel=rel||m.releaseDate;}catch(e){} return b.textContent.trim();}); const k=map(img?img.alt:'',attrs); (g[k]=g[k]||[]).push(...times); }); let pre=null; const pw=panel.querySelector('[data-qa="PreorderShowtimes_Wrapper"]'); if(pw){ const m=pw.textContent.replace(/\s+/g,' ').match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})/); if(m) pre=[MON[m[1]],+m[2]]; } films.push([title,rt,rating,rel,Object.entries(g).map(([k,t])=>[k,...t]),pre]); }); return films; }
const ctl=new AbortController(); setTimeout(()=>ctl.abort(),38000);
const out={}, sel={};
await Promise.all(Object.entries(TH).map(async([id,path])=>{ try{ const h=await (await fetch(path+'?d='+Date.now(),{signal:ctl.signal,credentials:'include'})).text(); sel[id]=(h.match(/serverFormat&quot;:&quot;(\d{4}-\d\d-\d\d)&quot;,&quot;dayOfWeek&quot;:&quot;\w+&quot;,&quot;isSelected&quot;:true/)||[])[1]; out[id]=parse(new DOMParser().parseFromString(h,'text/html')); }catch(e){out[id]='ERR '+e;} }));
"BEGINJSON"+JSON.stringify({sel,out})+"ENDJSON"+Array.from({length:9000},(_,i)=>"pad"+i).join(" ")
`sel[id]` must equal today's date; `out[id]` is a list of films: [title, runtime, rating, atomReleaseDate, [[formatLabel, time, ...], ...], [month, day] of first presale or null]. A film with an empty showtimes list is presale-only (year: this year if the month is this month or later, else next year).
If a theater is an error string, has no films, or `sel` isn't today, re-run the script once. If it still fails, keep that theater's previous playing/soon/soonFmt entries unchanged in every film, set its ok=false and asOf to the date those times were for (the previous document's asOf, or its own asOf if already stale). On success set ok=true and remove asOf.
Atom's own percentage scores are NOT Rotten Tomatoes scores. Never use them.

STEP 2e — Premium formats and film prints scheduled for upcoming films (same Atom tab)
For films on presale in the next two weeks, Atom's pre-order button links to a small page with that day's formats. Run:
document.cookie="date=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
const END=new Date(Date.now()+14*864e5).toLocaleDateString('en-CA',{timeZone:'America/New_York'});
const TH={hoffman:"/theaters/amc-hoffman-center-22/7845",tysons:"/theaters/amc-tysons-corner-16/9803",georgetown:"/theaters/amc-georgetown-14/8353","alamo-dc":"/theaters/alamo-drafthouse-cinema-dc-bryant-street/51802","alamo-cc":"/theaters/alamo-drafthouse-cinema-crystal-city/52577",afi:"/theaters/afi-silver-theatre-cultural-center/8500"};
const map=(f)=>{ if(/imax/i.test(f))return"IMAX"; if(/dolby/i.test(f))return"Dolby"; if(/prime/i.test(f))return"Prime"; if(/^xl/i.test(f))return"XL"; if(/big show/i.test(f))return"Big Show"; if(/70\s?mm/i.test(f))return"70mm"; if(/35\s?mm/i.test(f))return"35mm"; return null; };
const ctl=new AbortController(); setTimeout(()=>ctl.abort(),40000);
const jobs=[];
await Promise.all(Object.entries(TH).map(async([id,path])=>{ const h=await (await fetch(path+'?d='+Date.now(),{signal:ctl.signal})).text(); const doc=new DOMParser().parseFromString(h,'text/html'); doc.querySelectorAll('.showtime-panel').forEach(panel=>{ let title=null; try{title=JSON.parse(panel.querySelector('[data-qa="ProductionHeader_Container"] a[data-csm]').getAttribute('data-csm')).productionName;}catch(e){} const a=panel.querySelector('[data-qa="PreorderShowtimes_Button"]'); if(title&&a){ const m=a.getAttribute('href').match(/localDate=(\d{4}-\d\d-\d\d)/); if(m && m[1] <= END) jobs.push([id,title,m[1],a.getAttribute('href')]); } }); }));
const res=await Promise.allSettled(jobs.map(async j=>{ const h=await (await fetch(j[3],{signal:ctl.signal})).text(); const doc=new DOMParser().parseFromString(h,'text/html'); const f=[...new Set([...doc.querySelectorAll('[data-qa="Showtimes_Wrapper"]')].map(w=>map((w.querySelector('img.format-icon')||{}).alt||'')).filter(Boolean))]; return [j[0],j[1],j[2],f]; }));
JSON.stringify({n:jobs.length, fail:res.filter(r=>r.status!=='fulfilled').length, hits:res.filter(r=>r.value&&r.value[3].length).map(r=>r.value)})
Each hit is [theaterId, title, date, formats]. Set soonFmt[theaterId] = formats on the matching film (same title matching as everywhere). Rebuild soonFmt from scratch each run for the six theaters (drop old entries). Only these labels are recorded: IMAX, Dolby, Prime, XL, Big Show, 70mm, 35mm. If this step fails, just leave soonFmt out; it is optional.

STEP 2a — The Miracle Theatre and Angelika Pop-Up (Atom, day by day)
These two only show a few films, often not every day, so read each listed day. In the same Atom tab run:
const TH={miracle:"/theaters/the-miracle-theatre/42899",angelika:"/theaters/angelika-pop-up-at-union-market/38754"};
const map=(f,a)=>{ if(/imax/i.test(f))return"IMAX"; if(/dolby/i.test(f))return"Dolby"; if(/laser/i.test(f))return"Laser"; if(/3d/i.test(f))return"3D"; if(/standard/i.test(f)||!f){ if(/open caption/i.test(a))return"Open Caption"; if(/sensory/i.test(a))return"Sensory"; return""; } return f; };
function parse(doc){ const films=[]; doc.querySelectorAll('.showtime-panel').forEach(panel=>{ const a=panel.querySelector('[data-qa="ProductionHeader_Container"] a[data-csm]'); let title=null; try{title=JSON.parse(a.getAttribute('data-csm')).productionName;}catch(e){} if(!title) return; const head=(panel.querySelector('[data-qa="ProductionHeader_Container"]')||panel).textContent.replace(/\s+/g,' '); const rt=(head.match(/(\d+hr(?: \d+m)?|\d+m)\b/)||[])[1]||null; let rating=null, rel=null; const g={}; panel.querySelectorAll('[data-qa="Showtimes_Wrapper"]').forEach(w=>{ const img=w.querySelector('img.format-icon'); const attrs=[...w.querySelectorAll('[data-qa="Showtimes_SecondaryAttribute"]')].map(x=>x.textContent.trim()).join(' '); const times=[...w.querySelectorAll('[data-qa="Showtimes_Button"]')].map(b=>{ try{const m=JSON.parse(b.getAttribute('data-product-metadata')); rating=rating||m.rating; rel=rel||m.releaseDate;}catch(e){} return b.textContent.trim();}); const k=map(img?img.alt:'',attrs); (g[k]=g[k]||[]).push(...times); }); films.push([title,rt,rating,rel,Object.entries(g).map(([k,t])=>[k,...t])]); }); return films; }
const ctl=new AbortController(); setTimeout(()=>ctl.abort(),42000);
const sel=h=>(h.match(/serverFormat&quot;:&quot;(\d{4}-\d\d-\d\d)&quot;,&quot;dayOfWeek&quot;:&quot;\w+&quot;,&quot;isSelected&quot;:true/)||[])[1];
const out={};
for (const [id,path] of Object.entries(TH)){
  try{
    document.cookie="date=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    const h=await (await fetch(path+'?d='+Date.now(),{signal:ctl.signal,credentials:'include'})).text();
    const dates=[...new Set([...h.matchAll(/serverFormat&quot;:&quot;(\d{4}-\d\d-\d\d)/g)].map(m=>m[1]))];
    const today=sel(h)||null; const days={};
    if(today) days[today]=parse(new DOMParser().parseFromString(h,'text/html'));
    for (const dt of dates.filter(x=>x!==today).slice(0,12)){
      document.cookie="date="+dt+"; path=/";
      const h2=await (await fetch(path+'?d='+Date.now(),{signal:ctl.signal,credentials:'include'})).text();
      if(sel(h2)===dt) days[dt]=parse(new DOMParser().parseFromString(h2,'text/html'));
    }
    out[id]={today,dates,days};
  }catch(e){out[id]='ERR '+e;}
}
document.cookie="date=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
"BEGINJSON"+JSON.stringify(out)+"ENDJSON"+Array.from({length:9000},(_,i)=>"pad"+i).join(" ")
For each theater: `days[today]` films go into playing[theaterId] (format groups as given); for each later date, a film not playing there today gets soon[theaterId] = its first date (and if that day's groups include IMAX/Dolby/70mm/35mm, put those in soonFmt[theaterId]). `today` is null when the theater has nothing today (that's normal, still ok=true). On an error string, keep that theater's previous entries and set ok=false/asOf as in STEP 2. Close the Atom tab afterwards (tabs_close).

STEP 2b — 4EYE Film Center (its own site)
Open https://4eyefilmcenter.org/now-playing/ with preview_start, wait ~2 s, then run:
const ctl=new AbortController(); setTimeout(()=>ctl.abort(),35000);
const h=await (await fetch('/now-playing/?d='+Date.now(),{signal:ctl.signal})).text();
const doc=new DOMParser().parseFromString(h,'text/html');
const rows=[];
doc.querySelectorAll('.showtimes__day[id^="day-"]').forEach(day=>{ const dt=day.id.slice(4); day.querySelectorAll('article.showtimes__card').forEach(c=>{ const title=c.querySelector('.showtimes__title')?.textContent.replace(/\s+/g,' ').trim(); const time=c.querySelector('.showtimes__when span')?.textContent.trim(); const chips=[...c.querySelectorAll('.showtimes__chips *')].filter(x=>!x.children.length).map(x=>x.textContent.trim()).filter(Boolean); if(title) rows.push([dt,title,time,chips]); }); });
JSON.stringify(rows)
Rows are [date, title, time, chips]. Today's rows → playing["4eye"] = [[label, times...]] where label is "35mm"/"70mm"/"16mm" only if a chip says so, else "". Later rows → soon["4eye"] = first date for films not playing there today (and soonFmt["4eye"] = ["35mm"] etc. if a chip on that first date says so). If the page fails, keep previous 4eye entries and set ok=false/asOf. Close the tab.
The Miracle, Angelika Pop-Up and 4EYE mostly show older films: mark those "rep" with the original year in the slug; mark "new" only for current releases (e.g. a film opening this season). Look up the release date and RT for genuinely new titles in STEP 4.

STEP 2c — Formats Atom doesn't list (35mm, 70mm, 4K)
Atom leaves AFI's film prints and 4K restorations unlabelled. WebFetch https://silver.afi.com/now-playing/ and ask for every title exactly as shown plus format words (e.g. "THE BARKER in 35mm", "DUNE: PART THREE in 70mm", "KEN RUSSELL'S THE DEVILS - New 4K Restoration"). For each AFI film in today's data whose AFI title says "in 35mm"/"in 70mm", set the label of its AFI showtime group(s) to "35mm"/"70mm"; if AFI presents it as a 4K restoration in the title, use "4K". Only label how it is PROJECTED, as stated in the title or presentation note, never production details, never a guess. For the Alamos, use 35mm/70mm only if Atom's title or label says so. Keep Atom's non-empty labels (IMAX, Dolby, Laser…). Match titles case/punctuation-insensitively, ignoring a trailing year and an "in 35mm/70mm" suffix; keep the film's existing slug and title.

STEP 2d — AFI Silver specials (collection "afi", doc "current")
Open https://silver.afi.com/now-playing/ with preview_start, wait ~2 s, then run:
const ctl=new AbortController(); setTimeout(()=>ctl.abort(),40000);
const get=async u=>{const r=await fetch(u,{signal:ctl.signal}); if(!r.ok) throw new Error(u+' '+r.status); return r.text();};
const P=s=>new DOMParser().parseFromString(s,'text/html');
const MON={January:1,February:2,March:3,April:4,May:5,June:6,July:7,August:8,September:9,October:10,November:11,December:12};
const iso=s=>{const m=(s||'').match(/([A-Z][a-z]+) (\d{1,2}), (\d{4})/); return m?`${m[3]}-${String(MON[m[1]]).padStart(2,'0')}-${m[2].padStart(2,'0')}`:null;};
const tm=s=>s.replace(/\s+/g,' ').trim().replace(/\s*a\.m\./i,' AM').replace(/\s*p\.m\./i,' PM');
const sent=(t,max)=>{ if(t.length<=max) return t; const cut=t.slice(0,max); const i=Math.max(cut.lastIndexOf('. '),cut.lastIndexOf('! '),cut.lastIndexOf('? ')); return i>80?cut.slice(0,i+1):cut.replace(/\s+\S*$/,'')+'…'; };
const lists=await Promise.allSettled(['/now-playing/','/calendar/'].map(get));
const ids=new Set(); lists.forEach(r=>{ if(r.status==='fulfilled') [...r.value.matchAll(/\/movies\/detail\/(\d{10})/g)].forEach(x=>ids.add(x[1])); });
const films=[], errs=[], series={};
await Promise.allSettled([...ids].map(async id=>{ try{ const d=P(await get('/movies/detail/'+id+'/')); const md=d.querySelector('.movie_detail'); if(!md){errs.push(id);return;}
  const title=md.querySelector('h1.movie-title')?.textContent.trim();
  let sf=[], blurbs=[], surl=null;
  md.querySelectorAll('p.blurb').forEach(p=>{ const t=p.textContent.replace(/\s+/g,' ').trim(); const a=p.querySelector('a[href*="/events/detail/"]'); if(/^Special Features:/.test(t)) sf=t.replace(/^Special Features:\s*/,'').split(/\s*\|\s*/).filter(Boolean); else if(a) surl=a.href; else if(t) blurbs.push(t); });
  const key={}; d.querySelectorAll('.attributes-list .attribute').forEach(a=>{ key[a.querySelector('img')?.alt]=a.querySelector('span')?.textContent.trim(); });
  const RX=/(?:\b(?:35mm|70mm|16mm)\b[^.]{0,60}\bprint\b|\bprint courtesy\b|\brestor(?:ed|ation)\b[^.]{0,80}\b(?:by|from|courtesy|supervised|carried out)\b)/i;
  const notes=blurbs.join(' ').split(/(?<=[a-z0-9)”"][.!?])\s+(?=[A-Z0-9“"])/).filter(x=>RX.test(x)&&x.length<240).map(x=>x.replace(/^(?:NOT RATED|RATED [A-Z0-9-]+)\s+/,'')).sort((a,b)=>/print/i.test(b)-/print/i.test(a));
  const shows=[...d.querySelectorAll('.show_wrap')].map(w=>[iso(w.querySelector('p')?.textContent), ...[...w.querySelectorAll('a.select_show')].map(a=>tm(a.textContent))]).filter(s=>s[0]);
  films.push({id,title,surl,sf,key:Object.values(key).filter(Boolean),desc:sent(blurbs[0]||'',300),note:notes[0]||'',
    rating:(md.querySelector('img.movie-rating')?.src||'').match(/RatingIconGraphic\/([^?]+)/)?.[1]||null,
    runtime:md.querySelector('.RunTime')?.textContent.replace(/Run Time:\s*/,'').trim()||null,
    url:'https://silver.afi.com/movies/detail/'+id+'/',shows});
  if(surl) series[surl]=null; }catch(e){errs.push(id+' '+e);} }));
await Promise.allSettled(Object.keys(series).map(async u=>{ try{ series[u]=P(await get(u)).querySelector('h1')?.textContent.trim()||null; }catch(e){} }));
films.forEach(f=>{ f.series=series[f.surl]||null; delete f.surl; });
films.sort((a,b)=>a.id.localeCompare(b.id));
"BEGINJSON"+JSON.stringify({count:ids.size,errs,films})+"ENDJSON"+Array.from({length:9000},(_,i)=>"pad"+i).join(" ")
If `films` has at least 10 entries, write {"asOf": today, "updatedAt": now ISO UTC, "source": "https://silver.afi.com/now-playing/", "films": films} with ArtifactData "set", collection "afi", doc_id "current" (get it first for its version and pass if_version). The page itself picks which AFI films are "special" (35mm/70mm prints, restorations, live music, guest intros, anniversaries) from these fields, so store every film as scraped, unedited. If the scrape fails, leave the afi document alone. Close the tab.

STEP 3 — Rebuild films
- Clear every film's `playing`, `soon` and `soonFmt` for the theaters you fetched successfully, then fill them from today's data (times sorted earliest first). A film's `soon` lists only theaters where it has no showtimes today and its first date there is after today.
- New films get firstSeen = today; existing films keep theirs.
- Drop films with no playing and no soon entries at any theater, and soon entries more than 120 days out. Remove empty soonFmt objects.
- Set `kind` sensibly (see the schema). For a brand-new title, Atom's releaseDate can be used for `released` until Rotten Tomatoes gives one; for rep titles leave `released` null rather than using a re-release date.

STEP 4 — Release dates and Rotten Tomatoes scores
WebFetch these lists (Tomatometer, Popcornmeter and opening date per title):
- https://www.rottentomatoes.com/browse/movies_in_theaters/sort:newest
- https://www.rottentomatoes.com/browse/movies_in_theaters/sort:popular
- https://www.rottentomatoes.com/browse/movies_in_theaters/sort:top_box_office
- https://www.rottentomatoes.com/browse/movies_coming_soon/sort:newest
Match titles (case/punctuation-insensitive) and update rt.tm, rt.pm and released for every match. For "new" films still missing a score or release date, try https://www.rottentomatoes.com/m/<title_with_underscores> — at most 15 single-page lookups, prioritising films at the most theaters; store the URL in rt.url when it works and check the page's year matches. For rep films, only look up ones with no rt yet (at most 5) and never overwrite an existing rt on a rep film. If RT has no score, leave rt null. Never guess or use memory for scores.

STEP 5 — Write
ArtifactData "set", collection "listings", doc_id "current", file_path your JSON, if_version from Step 1. If the version changed, re-read, re-apply and write once more. Then "get" once to confirm asOf is today.

STEP 6 — PUBLIC PAGE (do this last, after your own writes)
The public page https://claude.ai/artifact/4pfBFbaiF7j4RBbb7rqa6i is a copy anyone can open signed out. It has no database: its data is written into the page inside <script type="application/json" id="cc-data">…</script>. Rebuild that block and republish:
1. ArtifactData "get" three docs of the main artifact https://claude.ai/artifact/Rpg1NVmEbcEYe3VPLzVZC7 — "listings"/"current", "screenings"/"current" and "afi"/"current" — and save each one's JSON to a local file (use out_dir if allowed; otherwise write the returned JSON to files yourself).
2. Artifact action "read" with url https://claude.ai/artifact/4pfBFbaiF7j4RBbb7rqa6i (no path) so the live version counts as viewed, then Artifact "read" again with the same url and path "index.html" — it saves the page source to a local file and tells you where.
3. Run this Python (fill in the four paths), which swaps in the new data and nothing else:
import json,re,datetime
LIST,SCR,AFI,PAGE="<listings json>","<screenings json>","<afi json>","<saved index.html>"
ld=lambda p:(lambda x:x.get('data',x))(json.load(open(p)))
L=ld(LIST); S=ld(SCR)
try: A=ld(AFI)
except Exception: A=None
lim=(datetime.date.fromisoformat(L['asOf'])+datetime.timedelta(days=30)).isoformat()
films={k:{kk:f.get(kk) for kk in ('title','rating','runtime','released','kind','rt','firstSeen','playing','soon','soonFmt')} for k,f in L['films'].items() if f.get('playing') or any(v<=lim for v in (f.get('soon') or {}).values())}
data={'listings':{'asOf':L['asOf'],'updatedAt':L.get('updatedAt'),'theaters':[{k:t.get(k) for k in ('id','name','site','ok','asOf')} for t in L['theaters']],'films':films},'screenings':S}
if A and A.get('films'): data['afi']=A
blob=json.dumps(data,ensure_ascii=False,separators=(',',':')).replace('</','<\\/')
h=open(PAGE).read()
h2,n=re.subn(r'(<script type="application/json" id="cc-data">).*?(</script>)',lambda m:m.group(1)+blob+m.group(2),h,count=1,flags=re.S)
assert n==1, "data block not found"
open(PAGE,'w').write(h2)
4. Artifact publish with url https://claude.ai/artifact/4pfBFbaiF7j4RBbb7rqa6i and file_path = that saved file. Pass no capabilities and no icon. If it's refused because a newer version exists, take the version it hands back, redo step 3 on it, and publish once more. Never add personal data (data/users docs, watched or not-interested marks) to the public page.

Finish with a three-line summary: how many films are playing across the nine theaters; films that opened this week; any 35mm/70mm/4K showings today, upcoming premium-format/film showings found, the AFI specials count, any theater that failed, and whether the public page was republished.
