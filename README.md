# capital-city-cinema-scraper

Daily showtimes data for Capital City Cinema. A GitHub Actions workflow (`.github/workflows/scrape.yml`) runs every morning at 10:47 UTC (5:47 EST / 6:47 EDT) and commits the results to `data/`. The Claude scheduled task reads these files at 10:17 ET. Nothing has to be running at home.

## Sources

Each theater has its own source, and every source is readable from GitHub's servers without a bot check.

| Theater | Source |
|---|---|
| Alamo Drafthouse DC Bryant Street, Crystal City | Alamo's own schedule JSON (`dc-metro-area` market) |
| AMC Hoffman Center 22, Tysons Corner 16, Georgetown 14 | Fever theater pages (amctheatres.com blocks automated access) |
| Angelika Pop-Up at Union Market | Angelika's own page (the scraper keeps the schedule JSON the page loads) |
| The Miracle Theatre | Its own site's event list |
| AFI Silver | Its own site (also saved raw as `data/afi.json` for the specials) |
| 4EYE Film Center | Its own site |
| Suns Cinema | Its own site's schema.org data (home page for today, Coming Soon page for later dates, plus the pages of films showing today). No ratings or formats are published. Its `/purchase/` ticket pages are disallowed by robots.txt and never fetched. The Avalon Theatre was probed too but not added: its Visitor Agreement bars robots and republishing without written consent (`docs/probe-2026-11-23-avalon-suns.md` on branch `probe/2026-11-23-avalon-suns`) |
| Smithsonian Lockheed Martin IMAX (National Air and Space Museum), Airbus IMAX (Udvar-Hazy Center) | Smithsonian Theaters' own daily pages; only feature films (75+ minutes) are kept. Runs on a self-hosted runner at home (`smithsonian.yml`), because si.edu challenges GitHub's servers; output is `data/smithsonian.json` |

Atom Tickets was the original source, but Cloudflare challenges it from GitHub's servers, so it was dropped (Nov 2026; the old code is in the git history).

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
- A daily Claude watchdog task runs about an hour after the scrape (11:43 UTC), well before the 10:17 ET publish. It checks the run, re-runs a failed source once, and, if the source still fails, diagnoses it, tests a fix on a branch and merges it only if the test run validates. It also checks the previous day's publish and the live site, and reports problems to Abel. It never tries to get past a bot check.
- `monitor/status-log.md` gets one line per day from the watchdog: the GitHub pipeline's result and the legacy PC-browser test's result, for comparing the two methods.

## Archive

`archive/pc-browser-task-prompt.md` is the original Claude scheduled-task prompt that scraped Atom Tickets, 4EYE and AFI through the browser on Abel's PC (in use until Nov 2026). `archive/github-task-prompt.md` is the current task prompt, which reads this repo's data. The Playwright port of the Atom scripts is in the git history before commit 610d49c.
