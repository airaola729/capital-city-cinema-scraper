// Diagnostic (branch only): how RT marks up scores on a movie page, and one browse tile.
const UA = 'CapitalCityCinema/1.0 (+https://github.com/airaola729/capital-city-cinema-scraper)';
const get = async p => (await fetch('https://www.rottentomatoes.com' + p, { headers: { 'user-agent': UA, accept: 'text/html' } })).text();
for (const p of ['/m/i_play_rocky', '/m/elsinore']) {
  const h = await get(p);
  console.log('=====', p, h.length);
  for (const re of [/<script[^>]*(?:scorecard|score)[^>]*>/gi, /(criticsScore|audienceScore|tomatometer|popcornmeter|criticsAll|audienceAll)[\s\S]{0,220}/gi]) {
    let n = 0;
    for (const m of h.matchAll(re)) { if (n++ > 10) break; console.log('  ', re.source.slice(0, 20), '::', m[0].replace(/\s+/g, ' ').slice(0, 260)); }
  }
  const i = h.indexOf('89%');
  console.log('  around 89%:', i, i > 0 ? h.slice(i - 400, i + 100).replace(/\s+/g, ' ') : '');
}
const b = await get('/browse/movies_in_theaters/sort:popular');
const i = b.indexOf('discovery-media-list-item-title');
console.log('===== tile', b.slice(i - 1500, i + 700).replace(/\s+/g, ' '));
const g = b.indexOf('God with Us');
console.log('===== god with us tile', g, b.slice(g - 1500, g + 300).replace(/\s+/g, ' '));
