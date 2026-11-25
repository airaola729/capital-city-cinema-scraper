// Diagnostic round 3: raw CinemaClock markup for the two Smithsonian IMAX theaters, fetched with the scraper's own
// user agent (plain HTTP; robots.txt only disallows /aw/, which is never requested).
const UA = 'CapitalCityCinema/1.0 (+https://github.com/airaola729/capital-city-cinema-scraper)';
for (const slug of ['lockheed-martin-imax-theater', 'airbus-imax-theater']) {
  const url = `https://www.cinemaclock.com/movie-theaters/${slug}`;
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(45000) });
  let h = await r.text();
  console.log(`\n\n######## ${slug} status=${r.status} len=${h.length} title=${(h.match(/<title[^>]*>([^<]*)/i) || [])[1]}`);
  h = h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<svg[\s\S]*?<\/svg>/gi, '<svg/>').replace(/\n\s*\n/g, '\n');
  const a = h.indexOf('sort by'); const hg = h.indexOf('Sunrise on the Reaping');
  console.log('---- from "sort by" (first two films):\n' + h.slice(a, a + 9000));
  console.log('\n---- around Hunger Games:\n' + h.slice(Math.max(0, hg - 2500), hg + 4500));
  const e = h.indexOf('subject to change'); console.log('\n---- end of list:\n' + h.slice(Math.max(0, e - 1500), e + 300));
}
