// Stimmen aus Notenbanken und Research: öffentliche Feeds (Fed, EZB, Investmenthäuser, Marktberichte), stündlich.
// Nur Überschrift, Quelle, Zeit und Link. Liste über SMART_FEEDS als „Name|URL“, kommagetrennt.
const config = require('./config');
const news = require('./news');
const fallback = require('./fallback/voices.json');

let items = fallback.items || [], updatedAt = 0, live = false;

async function refresh() {
  if (config.offline) return items;
  const all = [];
  await Promise.all(config.smartFeeds.map(async ({name, url}) => {
    try {
      const r = await fetch(url, {headers: {'User-Agent': 'Mozilla/5.0 (compatible; InvestmentArena/1.0; +https://www.investment-arena.com)', Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5'}, signal: AbortSignal.timeout(15_000)});
      if (!r.ok) return;
      const xml = await r.text();
      for (const it of news.parseRss(xml, name).slice(0, 8)) all.push({...it, lang: /ecb|ezb|bundesbank/i.test(name) && /[äöüß]/.test(it.h) ? 'de' : 'en'});
    } catch (e) {}
  }));
  const cutoff = Date.now() / 1000 - 10 * 86400, seen = new Set();
  const next = all.filter(n => n.t >= cutoff && n.h.length > 12).sort((a, b) => b.t - a.t)
    .filter(n => { const k = n.h.toLowerCase().slice(0, 50); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 16);
  if (next.length >= 3) { items = next; updatedAt = Date.now(); live = true; }
  return items;
}

module.exports = {refresh, get: () => ({items, updatedAt, live})};
