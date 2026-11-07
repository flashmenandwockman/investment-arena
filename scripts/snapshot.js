// Aktualisiert die mitgelieferten Fallback-Daten (Kurse und Radar) aus den Live-Quellen.
// Aufruf: FINNHUB_KEY=... npm run snapshot
const fs = require('fs');
const path = require('path');
const market = require('../server/market');
const radar = require('../server/radar');

(async () => {
  const dir = path.join(__dirname, '..', 'server', 'fallback');
  const q = await market.refresh();
  fs.writeFileSync(path.join(dir, 'quotes.json'), JSON.stringify(q));
  const r = await radar.refresh();
  fs.writeFileSync(path.join(dir, 'radar.json'), JSON.stringify(r));
  console.log(`Kurse: ${Object.keys(q).length} Werte (live: ${market.status().live}), Radar: ${Object.keys(r).length} Werte (live: ${radar.status().live})`);
  process.exit(0);
})();
