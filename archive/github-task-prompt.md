Refresh the Capital City Cinema showtimes for today (Washington, DC date), refresh the AFI Silver specials, then republish the public copy. The main page is the artifact https://claude.ai/artifact/Rpg1NVmEbcEYe3VPLzVZC7. Its Showtimes, New releases and Upcoming tabs read two database documents: collection "listings" doc "current" and collection "afi" doc "current". Update only those two with the ArtifactData tool (load it with ToolSearch "select:ArtifactData"). Do not republish or edit the main page, and do not touch any other collection (screenings, data/users). Work silently; nothing needs to be sent to anyone.

DATA SOURCE. The theater data is scraped every morning (13:05 UTC) by a GitHub Actions workflow in the public repo airaola729/capital-city-cinema-scraper, which commits JSON to its data/ folder. Each theater is read from its own source (Alamo's own schedule feed, Fever pages for the three AMCs, Angelika's own page, The Miracle's own site, AFI Silver's own site, 4EYE's own site). Download the files with curl in the shell. raw.githubusercontent.com is reachable from the shell. Do NOT use WebFetch for these files, because it summarizes instead of returning the raw JSON:
  mkdir -p gh && for f in showtimes afi meta; do curl -sSf --max-time 60 -o gh/$f.json "https://raw.githubusercontent.com/airaola729/capital-city-cinema-scraper/main/data/$f.json"; done
Read them with Python (json.load). No browser is used. WebFetch works for Rotten Tomatoes. Apart from raw.githubusercontent.com the shell has no outbound internet; use Python locally to assemble JSON.

gh/showtimes.json shape: {"today": "YYYY-MM-DD", "updatedAt": ISO, "theaters": {"<theaterId>": {"ok": bool, "dataDate": "YYYY-MM-DD"|null, "source": str, "error": str|null, "days": {"YYYY-MM-DD": [ {"title", "rating", "runtime", "released", "groups": [["<label>", "1:15 PM", "4:30 PM", ...], ...]} ]}, "soon": [ {"title", "date", ...} ]}}}. Theater ids: hoffman, tysons, georgetown, alamo-dc, alamo-cc, afi, miracle, angelika, 4eye. `days` holds today and later dates (up to ~60 days for some theaters, ~2 weeks for the AMCs). `soon` lists first dates known without showtimes (Angelika's coming-soon list). Labels are already normalized: "" (standard), IMAX, Dolby, Laser, Prime, XL, 4DX, 3D, Big Show, ScreenX, Open Caption, Sensory, 35mm, 70mm, 16mm, 4K. For AFI, 35mm/70mm/16mm/4K come only from how AFI itself presents the film (title or presentation note). Use the labels as given and never invent one.

FRESHNESS. A theater is current only if theaters[id].ok is true AND theaters[id].dataDate equals today's date in America/New_York. A theater that isn't current counts as failed for this run: keep its previous entries exactly as the failure rules below say. If showtimes.json can't be downloaded or parsed, or none of the nine theaters is current, do not write the listings document. If gh/afi.json isn't current (see STEP 2d), do not write the afi document. In those cases still do the PUBLIC PAGE step so the public copy stays in sync, and finish with a one-line summary saying the GitHub data wasn't available (include meta.json's runAt and any errors).

STEP 1 — Read the current listings document
ArtifactData "get", url above, collection "listings", doc_id "current" (without out_dir if it refuses out_dir). Note its `version` (if_version when writing). Keep the existing `baseline` and every film's `firstSeen` and `rt`.
Document shape (keep exactly):
{
  "asOf": "YYYY-MM-DD",            // today, ET
  "updatedAt": ISO-8601 UTC timestamp of this run,
  "baseline": "2026-10-24",         // never change
  "theaters": [ {id, name, short, where, site, ok: true|false, asOf?: "YYYY-MM-DD"} ... ],  // keep all nine entries and their order (hoffman, tysons, georgetown, alamo-dc, alamo-cc, afi, miracle, angelika, 4eye); only change ok/asOf, drop any old `src` field (no longer used), and make sure `site` is the theater's own website: afi = "https://silver.afi.com/", angelika = "https://angelikafilmcenter.com/dc" (the other seven already link to their own sites; keep them as they are)
  "films": { "<slug>": {
      "title": str, "rating": "R"|"PG-13"|"PG"|"G"|"NR"|null, "runtime": "1h 48m"|null,
      "released": "YYYY-MM-DD"|null,      // US theatrical opening date (original date for repertory films)
      "kind": "new" | "rep" | "event",     // new = current release; rep = older film/re-release/anniversary/classic; event = concert, live viewing, opera, ballet, sports/UFC, fan event, TV episodes
      "rt": {"tm": int|null, "pm": int|null, "url": str|null} | null,
      "firstSeen": "YYYY-MM-DD",
      "playing": { "<theaterId>": [ ["<format label or empty string>", "12:40 PM", "4:45 PM", ...], ... ] },   // today's showtimes only, times sorted
      "soon": { "<theaterId>": "YYYY-MM-DD" },   // first future date with shows/presale, only for dates AFTER today
      "soonFmt": { "<theaterId>": ["IMAX","Dolby",...] }   // optional: premium/film formats scheduled on that first date; omit when none
  } }
}
Slugs are lowercase-hyphenated titles (add the year for repertory titles, e.g. "the-omen-1976"). ALWAYS reuse an existing slug when the same film is already in the document (the page keys each viewer's watched / not-interested marks on the slug), and treat obvious variants as the same film (e.g. "Scream 30th Anniversary" = "Scream (1996)"; "Sense and Sensibility (2026)" = "Sense and Sensibility"; straight vs curly apostrophes; a trailing "(1953)"; "A Beautiful Mind 25th Anniversary" = "A Beautiful Mind (25th Anniversary)"; "Planes, Trains and Automobiles" = "Planes, Trains & Automobiles"). Different theaters' sources spell titles differently, so match case- and punctuation-insensitively, ignoring "&"/"and", a trailing year, "in 35mm/70mm", " - Unrated" and "(Open Caption)". Keep the existing film's title when matched. Some titles were converted from ALL CAPS by the scraper; for a new film, store a clean, normally capitalized title.

STEP 2 — Today's showtimes for all nine theaters (gh/showtimes.json)
For each theater id, in the document's order:
- If it is current: playing[id] = the groups of each film in days[today] (labels and times as given). For each film NOT playing there today, soon[id] = the earliest date after today on which it appears in that theater's `days`, or the date of a matching entry in that theater's `soon` list if earlier. soonFmt[id] = the labels among IMAX, Dolby, Prime, XL, Big Show, 70mm, 35mm found in that film's groups on that first date (from `days` only; omit when none). Set the theater's ok=true and remove its asOf.
- If it is not current: keep that theater's previous playing/soon/soonFmt entries unchanged in every film, set its ok=false and asOf to the date those times were for (the previous document's asOf, or its own asOf if already stale).
Use the scraper's rating and runtime for films that lack them. Its `released` is only a hint for genuinely new first-run titles (Angelika's dates for repertory screenings are screening dates, not release dates); for rep titles leave `released` null.
The Miracle, Angelika Pop-Up, 4EYE and AFI Silver mostly show older films: mark those "rep" with the original year in the slug; mark "new" only for current releases (e.g. a film opening this season). Look up the release date and RT for genuinely new titles in STEP 4.

STEP 2d — AFI Silver specials (collection "afi", doc "current"; gh/afi.json)
gh/afi.json is {count, errs, films}. It is current only if gh/meta.json's afiSpecials.ok is true and afiSpecials.dataDate equals today (ET). If it is current and `films` has at least 10 entries, write {"asOf": today, "updatedAt": now ISO UTC, "source": "https://silver.afi.com/now-playing/", "films": films} with ArtifactData "set", collection "afi", doc_id "current" (get it first for its version and pass if_version). The page itself picks which AFI films are "special" (35mm/70mm prints, restorations, live music, guest intros, anniversaries) from these fields, so store every film as scraped, unedited. Otherwise leave the afi document alone.

STEP 3 — Rebuild films
- Clear every film's `playing`, `soon` and `soonFmt` for the theaters that are current, then fill them from today's data (times sorted earliest first). A film's `soon` lists only theaters where it has no showtimes today and its first date there is after today.
- New films get firstSeen = today; existing films keep theirs.
- Drop films with no playing and no soon entries at any theater, and soon entries more than 120 days out. Remove empty soonFmt objects.
- Set `kind` sensibly (see the schema). For a brand-new first-run title, the scraper's `released` can be used until Rotten Tomatoes gives one; for rep titles leave `released` null rather than using a re-release or screening date.

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

Finish with a three-line summary: how many films are playing across the nine theaters; films that opened this week; any 35mm/70mm/4K showings today, upcoming premium-format/film showings found, the AFI specials count, any theater that wasn't current (with its error and the GitHub run time from meta.json), and whether the public page was republished.
