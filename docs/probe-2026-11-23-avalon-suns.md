# Probe 2026-11-23: Avalon Theatre and Suns Cinema

Branch `probe/2026-11-23-avalon-suns`. Three Probe workflow runs on GitHub's servers:
45222216204 (Chromium), 45222874035 (Chromium), 45223412774 (plain HTTP, no browser).
Limits kept: robots.txt checked first, at most 8 loads per site per run, 2 s between loads, no /purchase/ or checkout pages.
One Agile ticketing listing page per run (run 1: a film's info.aspx page; run 2 and run 3: the full list.aspx page).

## Avalon Theatre (theavalon.org + prod5.agileticketing.net)

- **Reachable:** yes, HTTP 200 on every page, no challenge text. Agile sits behind Imperva/Incapsula (x-cdn: Imperva header, `_Incapsula_Resource` script, the word "captcha" in its raw HTML), but it served the full page with HTTP 200 every time. On one film detail page, the embedded Vimeo trailer made calls to Cloudflare's challenge-platform. The Avalon page itself loaded normally.
- **robots.txt:** theavalon.org blocks only one JSON file (`/wp-content/uploads/wpo/wpo-plugins-tables-list.json`). prod5.agileticketing.net has no robots.txt (404).
- **Where the schedule lives:**
  - Per day: `https://www.theavalon.org/films/?date=YYYYMMDD` ("Showings for Thursday, November 26, 2026", then title, rating, runtime and times).
  - Everything on one page: `https://prod5.agileticketing.net/websales/pages/list.aspx?epguid=ebe3acab-05c7-4109-9a69-78d1846b26af&`.
  - The regular runs are listed through Sun Nov 29 (6 days ahead). Special screenings go out to Tue Jan 26, 2027 (64 days ahead). The raw HTML of the calendar lists dates 20261123–20270126.
- **Fields:**
  - Day pages: title, date, time, runtime, rating ("( R ) 111 min"), series label (e.g. Science on Screen) and a ticket link for each time (`ticketsearchcriteria.aspx?evtinfo=…`).
  - Detail pages add notes such as "CC, AD, Open Caps", the aspect ratio and the distributor.
  - No "sold out" label seen. On Agile, one past-start show said "Purchase Tickets at Box Office".
  - Agile's JSON-LD gets the times wrong: it drops PM (2:00 PM is written as `T02:00:00`), so don't use it.
- **Best method:** a plain request works for both the day pages and the Agile list (run 3). **Easy to medium.**
- **Terms (Visitor Agreement, /visitor-agreement/):** "You may not use any data mining, robots, or similar data gathering and extraction tools on the Content, … or reproduce, reprint, copy, store, publicly display, … publish … or otherwise distribute the Content without our prior written consent."
- **Samples (from the log):**
  - Wild Horse Nine (R, 118 min): Mon Nov 23, 11:15 AM, 2:00 PM, 4:45 PM, 7:30 PM
  - You Can See Everything (R, 175 min): Mon Nov 23, 11:30 AM, 3:10 PM, 7:00 PM
  - Elsinore (R, 111 min): Thu Nov 26, 4:45 PM, 7:30 PM

## Suns Cinema (sunscinema.com, Filmbot/WordPress)

- **Reachable:** yes, HTTP 200 on every page, no challenge text, no bot-protection headers.
- **robots.txt:** served with HTTP status 404, but the file has rules: `Disallow: /wp-admin/` and `Disallow: */purchase/`. The schedule pages (home, `/YYYY-MM-DD`, `/movies/…`, `/upcoming-films-3/`) are allowed.
- **Where the schedule lives:**
  - Per day: `https://sunscinema.com/YYYY-MM-DD`. The home page links 3 days plus a "Future Dates" date picker.
  - Everything upcoming: `https://sunscinema.com/upcoming-films-3/` ("Coming Soon"). Its JSON-LD lists 12 ScreeningEvents, Nov 24–Nov 30. The home page's JSON-LD covers today.
  - About 7 days ahead: 2026-12-12 says "There are no showtimes Sat, Dec 12."
  - Day pages carry today's JSON-LD, not that day's, so use their visible text or the Coming Soon page.
- **Fields:**
  - Title, date and time.
  - Runtime ("Run Time: 91 min." and JSON-LD duration), director, year and language.
  - Sold out: shown in the page text and as JSON-LD availability SoldOut.
  - Price: $13.50 in JSON-LD.
  - Ticket link: `/purchase/<id>/`. Link to it only; robots.txt disallows fetching it.
  - No rating. No format shown on the pages checked (Edward II's text says "new restoration").
- **Best method:** a plain request (run 3 got all the JSON-LD without a browser). **Easy.**
- **Terms:** no terms or policy link found on the site.
- **Samples (from the log):**
  - AMERICAN DOCTOR: Mon Nov 23, 6:00 pm, Sold Out
  - WHO KILLED ALEX ODEH?: Mon Nov 23, 8:15 pm
  - EDWARD II: Tue Nov 24, 7:00 pm
  - YI YI: Fri Nov 27, 9:00 pm, Sold Out

## Verdict

Ready to add: Suns Cinema. The Avalon is not ready: its Visitor Agreement bars robots and republishing without prior written consent. Ask the Avalon for permission first. The site itself would be easy to scrape.
