// Aktuelle Nachrichten mit Wirkung auf Kurse und Wirtschaft, alle 240 Minuten aktualisiert.
// Quellen: Finnhub-Marktnachrichten (englisch) und RSS-Feeds (NEWS_FEEDS, Standard: tagesschau Wirtschaft).
// Nur Überschrift, Quelle, Zeit und Link werden übernommen, keine Texte. Eine Gewichtung nach Stichworten
// (Notenbanken, Zinsen, Inflation, Zölle, Öl, Quartalszahlen, Indizes ...) sortiert die marktbewegenden Meldungen nach vorn.
const config = require('./config');
const finnhub = require('./finnhub');
const fallback = require('./fallback/news.json');

const KEYWORDS = [
  [4, /\b(fed|ezb|ecb|notenbank|zentralbank|leitzins|zinsen|zinsentscheid|rate cut|rate hike|interest rate|powell|lagarde|fomc)\b/i],
  [4, /\b(inflation|verbraucherpreise|cpi|pce|erzeugerpreise|teuerung)\b/i],
  [4, /\b(zoll|zölle|tariff|tariffs|handelskrieg|trade war|sanktion|sanctions|export(?:verbot|kontrollen))\b/i],
  [3, /\b(dax|dow|s&p|nasdaq|börse|boerse|wall street|stocks?|aktien(?:markt)?|markets?|rally|ausverkauf|sell-?off|crash|allzeithoch|record high)\b/i],
  [3, /\b(öl|oel|oil|opec|gas|brent|wti|rohstoff|commodit(?:y|ies)|gold|kupfer|copper)\b/i],
  [3, /\b(quartal|quartalszahlen|earnings|gewinn|umsatz|revenue|guidance|prognose|forecast|profit warning)\b/i],
  [3, /\b(arbeitsmarkt|jobs report|payrolls|arbeitslos|unemployment|bip|gdp|konjunktur|rezession|recession|ifo|pmi|einkaufsmanager)\b/i],
  [2, /\b(anleihe|anleihen|bonds?|yields?|renditen?|treasur(?:y|ies)|bund)\b/i],
  [2, /\b(bitcoin|krypto|crypto|ether(?:eum)?|etf)\b/i],
  [2, /\b(nvidia|apple|microsoft|amazon|tesla|alphabet|google|meta|sap|siemens|rheinmetall|allianz|deutsche bank|volkswagen|bmw|mercedes|china|usa|trump|eu|bundesregierung|haushalt|budget|steuer|tax)\b/i],
  [1, /\b(bank|banken|fintech|ki\b|ai\b|chip|halbleiter|semiconductor|energie|energy|auto|immobilien|housing)\b/i],
];
const NOISE = /\b(cramer|top 10 things|menopause|horoskop|rezept|sport|fußball|celebrity|royal|wetter)\b/i;
const score = h => { let s = 0; for (const [w, re] of KEYWORDS) if (re.test(h)) s += w; if (NOISE.test(h)) s -= 5; return s; };

let items = fallback.items || [], live = false, updatedAt = 0;
const strip = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${t}>`, 'i')); return m ? m[1] : ''; };

function parseRss(xml, src) {
  const out = [];
  for (const b of xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || []) {
    const h = strip(tag(b, 'title')), url = strip(tag(b, 'link')) || strip(tag(b, 'guid'));
    const t = Math.floor((Date.parse(strip(tag(b, 'pubDate') || tag(b, 'dc:date'))) || Date.now()) / 1000);
    if (h && url) out.push({h, url, src, t, lang: 'de'});
  }
  return out;
}

// Marktbewegende Meldungen der letzten 36 Stunden, deutsch bevorzugt, höchstens 8
function pick(all) {
  const cutoff = Date.now() / 1000 - 36 * 3600, seen = new Set();
  return all.filter(n => n.t >= cutoff && n.h.length > 15)
    .map(n => ({...n, score: score(n.h) + (n.lang === 'de' ? 1 : 0)}))
    .filter(n => n.score >= 3)
    .sort((a, b) => b.score - a.score || b.t - a.t)
    .filter(n => { const k = n.h.toLowerCase().slice(0, 40); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 8)
    .sort((a, b) => b.t - a.t);
}

async function refresh() {
  if (config.offline) return items;
  const all = [];
  await Promise.all([
    finnhub.get('news?category=general').then(j => { for (const n of j || []) all.push({h: strip(n.headline), url: n.url, src: n.source, t: n.datetime, lang: 'en'}); }).catch(() => {}),
    ...config.newsFeeds.map(async u => {
      try {
        const r = await fetch(u, {headers: {'User-Agent': 'Mozilla/5.0 (compatible; InvestmentArena/1.0; +https://www.investment-arena.com)', Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5'}, signal: AbortSignal.timeout(15_000)});
        if (!r.ok) return;
        const xml = await r.text(), src = new URL(u).hostname.replace(/^www\./, '').replace(/\.[a-z]+$/, '');
        all.push(...parseRss(xml, src));
      } catch (e) {}
    }),
  ]);
  const next = pick(all);
  if (next.length >= 3) { items = next; live = true; updatedAt = Date.now(); }
  return items;
}

module.exports = {refresh, get: () => ({items, live, updatedAt}), pick, score, parseRss};
