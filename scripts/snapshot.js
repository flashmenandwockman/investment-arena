// Aktualisiert die mitgelieferten Fallback-Daten (Kurse, Radar, 13F-Meldungen der Großinvestoren) aus den Live-Quellen.
// Aufruf: FINNHUB_KEY=... npm run snapshot
const fs = require('fs');
const path = require('path');
const market = require('../server/market');
const radar = require('../server/radar');
const gurus = require('../server/gurus');
const smart = require('../server/smart');
const news = require('../server/news');
const insiders = require('../server/insiders');
const voices = require('../server/voices');
const research = require('../server/research');

(async () => {
  const dir = path.join(__dirname, '..', 'server', 'fallback');
  const q = await market.refresh();
  fs.writeFileSync(path.join(dir, 'quotes.json'), JSON.stringify(q));
  const n = await news.refresh();
  fs.writeFileSync(path.join(dir, 'news.json'), JSON.stringify({items: n}));
  console.log(`Aktuell: ${n.length} Meldungen`);
  await insiders.sync(); fs.writeFileSync(path.join(dir, 'insiders.json'), JSON.stringify(insiders.snapshot()));
  const v = await voices.refresh(); fs.writeFileSync(path.join(dir, 'voices.json'), JSON.stringify({items: v}));
  console.log(`Insider: ${insiders.snapshot().items.length} Meldungen, Stimmen: ${v.length}`);
  const rs = await research.run(true); fs.writeFileSync(path.join(dir, 'research.json'), JSON.stringify({day: rs.day, at: rs.at, classes: rs.classes, trends: rs.trends, tracking: rs.tracking}));
  console.log(`Recherche: ${JSON.stringify(rs.counts)}`);
  const r = await radar.refresh();
  fs.writeFileSync(path.join(dir, 'radar.json'), JSON.stringify(r));
  const g = await gurus.snapshot();
  if (Object.keys(g).length) fs.writeFileSync(gurus.FALLBACK, JSON.stringify(g, null, 1));
  console.log(`Großinvestoren: ${Object.keys(g).length} 13F-Meldungen`);
  const sm = await smart.snapshot();
  if (Object.keys(sm.moves).length) fs.writeFileSync(smart.FALLBACK, JSON.stringify(sm));
  console.log(`Smart Money: ${Object.keys(sm.moves).length} Investoren mit Vorquartalsvergleich`);
  console.log(`Kurse: ${Object.keys(q).length} Werte (live: ${market.status().live}), Radar: ${Object.keys(r).length} Werte (live: ${radar.status().live})`);
  process.exit(0);
})();
