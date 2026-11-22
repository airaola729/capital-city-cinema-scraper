# capital-city-cinema-scraper

Daily showtimes data for Capital City Cinema. A GitHub Actions workflow (`.github/workflows/scrape.yml`) runs every morning at 13:05 UTC (8:05 EST / 9:05 EDT). It opens Atom Tickets, 4EYE Film Center and AFI Silver in Playwright Chromium and commits the raw results to `data/`. The Claude scheduled task reads these files about an hour later.

| File | Contents |
|---|---|
| `data/atom.json` | Today's showtimes for the six big theaters: `{sel, out}` |
| `data/atom-presale-formats.json` | Premium formats / film prints for presale films in the next 14 days: `{n, fail, hits}` |
| `data/atom-day-by-day.json` | The Miracle Theatre and Angelika Pop-Up, day by day: `{miracle:{today,dates,days}, angelika:{…}}` |
| `data/4eye.json` | 4EYE Film Center rows: `[date, title, time, chips]` |
| `data/afi.json` | AFI Silver films: `{count, errs, films}` |
| `data/meta.json` | Run time (UTC), today's date (ET), and per-source `ok` / `dataDate` / `error` |

A source counts as current only when `meta.json` says `ok: true` and its `dataDate` is today's date in Eastern time. A source that fails keeps its last good file, and its error is recorded in `meta.json`. The scraper never tries to get past a CAPTCHA or bot check. A challenge page is recorded as `blocked`.

To run it by hand, use **Actions → Scrape showtimes → Run workflow**. You can choose `headed` mode (Chromium under xvfb) or run only some sources.
