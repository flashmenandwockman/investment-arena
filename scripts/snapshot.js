// Aktualisiert die mitgelieferten Fallback-Daten (Kurse, Radar, 13F-Meldungen der Großinvestoren) aus den Live-Quellen.
// Aufruf: FINNHUB_KEY=... npm run snapshot
const fs = require('fs');
const path = require('path');
const market = require('../server/market');
const radar = require('../server/radar');
const gurus = require('../server/gurus');

(async () => {
  const dir = path.join(__dirname, '..', 'server', 'fallback');
  const q = await market.refresh();
  fs.writeFileSync(path.join(dir, 'quotes.json'), JSON.stringify(q));
  const r = await radar.refresh();
  fs.writeFileSync(path.join(dir, 'radar.json'), JSON.stringify(r));
  const g = await gurus.snapshot();
  if (Object.keys(g).length) fs.writeFileSync(gurus.FALLBACK, JSON.stringify(g, null, 1));
  console.log(`Großinvestoren: ${Object.keys(g).length} 13F-Meldungen`);
  console.log(`Kurse: ${Object.keys(q).length} Werte (live: ${market.status().live}), Radar: ${Object.keys(r).length} Werte (live: ${radar.status().live})`);
  process.exit(0);
})();
