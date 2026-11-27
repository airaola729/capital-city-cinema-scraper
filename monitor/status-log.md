# Daily status log

One line per day, written by the Claude watchdog task. Each line covers the previous day's publish and the legacy test, plus that morning's GitHub scrape.

Columns: date (ET) · GitHub scrape (theaters current / 9, AFI specials) · fixes or reruns · live site (publish task result, listings date) · legacy PC-browser test (task result, listings date, theaters ok) · notes

| Date | GitHub scrape | Fixes / reruns | Live site (prev. day) | Legacy test (prev. day) | Notes |
|---|---|---|---|---|---|
| 2026-11-23 | 9/9 current, AFI specials ok | none | publish SUCCEEDED 2026-11-22, listings 2026-11-22, public copy 2026-11-22, 39 films | legacy SUCCEEDED 2026-11-22, listings missing, 0/9 ok, 0 films | Scheduled 10:47 UTC run never fired; watchdog dispatched it manually at 11:44 UTC |
| 2026-11-24 | 10/10 current (incl. Suns), AFI specials ok | rerun fixed afi | publish SUCCEEDED 2026-11-23, listings 2026-11-23, public copy 2026-11-23, 38 films | legacy SUCCEEDED 2026-11-23, listings missing, 0/9 ok, 0 films | Schedule didn't fire (dispatched 11:44 UTC); first AFI pass hit 42×504; screenings task on hold |
| 2026-11-25 | 10/10 current (incl. Suns), AFI specials ok | none | publish SUCCEEDED 2026-11-24, listings 2026-11-24, public copy 2026-11-24, 36 films | legacy SUCCEEDED 2026-11-24, listings missing, 0/9 ok, 0 films | Schedule didn't fire (3rd day; dispatched 11:43 UTC); screenings task paused, last run Nov 19 |
| 2026-11-26 | 9/9 current (+Suns, 2 Smithsonian), AFI specials ok | none | publish SUCCEEDED 2026-11-25, listings 2026-11-25, public copy 2026-11-25, 36 films | legacy SUCCEEDED 2026-11-25, listings missing, 0/9 ok, 0 films | Schedule didn't fire (dispatched 11:44 UTC); Thanksgiving: 4EYE/Suns/SI dark; screenings paused since Nov 19 |
| 2026-11-27 | 9/9 current (+Suns, 2 Smithsonian), AFI specials ok | none | publish SUCCEEDED 2026-11-26, listings 2026-11-26, public copy 2026-11-26, 36 films | legacy SUCCEEDED 2026-11-26, listings missing, 0/9 ok, 0 films | Schedule hadn't fired by 11:44 UTC (dispatched); screenings task ran OK today |
