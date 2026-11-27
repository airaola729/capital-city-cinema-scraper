# capital-city-cinema-scraper

Daily showtimes data for Capital City Cinema. A GitHub Actions workflow (`.github/workflows/scrape.yml`) runs every morning at 10:47 UTC (5:47 EST / 6:47 EDT) and commits the results to `data/`. The Claude scheduled task reads these files at 10:17 ET. Nothing has to be running at home.

## Sources

Each theater has its own source, and every source is readable from GitHub's servers without a bot check.

| Theater | Source |
|---|---|
| Alamo Drafthouse DC Bryant Street, Crystal City | Alamo's own schedule JSON (`dc-metro-area` market) |
| AMC Hoffman Center 22, Tysons Corner 16, Georgetown 14 | AMC's own catalog API (`api.amctheatres.com`), with a key AMC issued for non-commercial listings. The key is the repository secret `AMC_API_KEY` and is never committed or logged. About six to eight weeks ahead. Titles are tidied ("Disney's Hexed" becomes "Hexed"; "…: Sensory Friendly Screening" becomes the Sensory label) |
| Angelika Pop-Up at Union Market | Angelika's own page (the scraper keeps the schedule JSON the page loads) |
| The Miracle Theatre | Its own site's event list |
| AFI Silver | Its own site (also saved raw as `data/afi.json` for the specials) |
| 4EYE Film Center | Its own site |
| Suns Cinema | Its own site's schema.org data (home page for today, Coming Soon page for later dates, plus the pages of films showing today). No ratings or formats are published. Its `/purchase/` ticket pages are disallowed by robots.txt and never fetched. The Avalon Theatre was probed too but not added: its Visitor Agreement bars robots and republishing without written consent (`docs/probe-2026-11-23-avalon-suns.md` on branch `probe/2026-11-23-avalon-suns`) |
| Smithsonian Lockheed Martin IMAX (National Air and Space Museum), Airbus IMAX (Udvar-Hazy Center) | CinemaClock's public theater pages (plain HTTP, about a week ahead), in the daily run; only feature films (75+ minutes) are kept; output is `data/smithsonian.json`. si.edu itself challenges GitHub's servers, so its reader (`ONLY=smithsonian`, `smithsonian.yml`, `scripts/smithsonian-browser.js`) is kept only for manual tests |

Atom Tickets was the original source, but Cloudflare challenges it from GitHub's servers, so it was dropped (Nov 2026; the old code is in the git history). The AMC theaters were then read from Fever's theater pages until AMC approved API access (27 Nov 2026); that code is in the git history too.

## Files

| File | Contents |
|---|---|
| `data/showtimes.json` | Per theater: `ok`, `dataDate`, `error`, `days` (`YYYY-MM-DD` → films `{title, rating, runtime, released, groups: [[label, "7:15 PM", …]]}`), and `soon` (first dates known without showtimes) |
| `data/afi.json` | AFI Silver films, raw: `{count, errs, films}` |
| `data/meta.json` | Run time, today's date (ET), per-source status, and a per-theater summary |

A theater is current only when `ok` is true and `dataDate` equals today's date in Eastern time. A theater whose source fails keeps its last good data with `ok: false`. Format labels are: `""`, IMAX, Dolby, Laser, Prime, XL, 4DX, 3D, Big Show, ScreenX, Open Caption, Sensory, 35mm, 70mm, 16mm and 4K.

The scraper never tries to get past a CAPTCHA or bot check. A challenge is recorded as `blocked`, and that source is skipped for the run.

To run it by hand, use **Actions → Scrape showtimes → Run workflow**. You can limit a run to some sources. **Actions → Probe sources** checks whether candidate sources are reachable.

## Monitoring

- The workflow's last step (`scripts/check-fresh.mjs`) fails the run when any theater, or the AFI specials, isn't current for today. The data is still committed first, so the site keeps the last good data for a broken source.
- The daily Claude watchdog task (Nov 22-27, 2026) and the legacy PC-browser test were retired on Nov 27, 2026. `monitor/status-log.md` keeps the watchdog's daily log for that period.

## Archive

`archive/pc-browser-task-prompt.md` is the original Claude scheduled-task prompt that scraped Atom Tickets, 4EYE and AFI through the browser on Abel's PC (in use until Nov 2026). `archive/github-task-prompt.md` is an early version of the publish task's prompt (it now also reads `data/smithsonian.json`). The Playwright port of the Atom scripts is in the git history before commit 610d49c.
