# Probe, Nov 27 2026: Eventbrite and NGA from GitHub's servers

Goal: see whether the screenings refresh's two browser sources could move into the GitHub scraper, so that task no longer needs Abel's PC. Run: https://github.com/airaola729/capital-city-cinema-scraper/actions/runs/46005919347

## Eventbrite: blocked
- robots.txt allows `/d/dc--washington/...` listing pages.
- Every listing page returns HTTP 405 "Human Verification" (AWS WAF bot check), both as a plain request and in headless Chromium. No listing data available.

## National Gallery of Art: blocked
- robots.txt has `Disallow: /calendar?*`, which covers the filtered films listing (`/calendar?tab=all&type[103026]=103026`). Plain `/calendar` and the event pages (`/calendar/<slug>?evd=...`) are not disallowed.
- The filtered listing returned HTTP 403 with a Cloudflare "Just a moment..." challenge, as a plain request and in Chromium.
- Note: this probe requested the filtered listing despite logging it as disallowed (a bug in the probe; one request and one browser load). Future probes and scrapers should not request `/calendar?` URLs.

## Smithsonian (no probe needed)
The daily scrape already reads both Smithsonian IMAX theaters from CinemaClock (plain HTTP, about 7 days ahead) and writes `data/smithsonian.json`. The PC-Chrome Smithsonian task has not committed since Nov 22: it finds the file already current every day and stops.

## Conclusion
Neither screenings source can move to GitHub. The screenings refresh keeps needing Abel's PC browser.
