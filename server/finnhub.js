// Finnhub-Client mit zentraler Drosselung: Der Free-Tarif erlaubt 60 Abrufe pro Minute.
// Alle Module (Kurse, Suche, Radar) holen ihre Daten hierüber, damit das Limit nie überschritten wird.
const config = require('./config');

const LIMIT = 55, WINDOW = 60_000;
const stamps = [];
const queue = [];
let timer = null;

function pump() {
  timer = null;
  const now = Date.now();
  while (stamps.length && now - stamps[0] > WINDOW) stamps.shift();
  while (queue.length && stamps.length < LIMIT) {
    stamps.push(Date.now());
    const job = queue.shift();
    job.run().then(job.resolve, job.reject);
  }
  if (queue.length && !timer) timer = setTimeout(pump, Math.max(50, WINDOW - (Date.now() - stamps[0]) + 10));
}

// priority: true = vor anderen Abrufen einreihen (z. B. wenn ein Nutzer gerade wartet)
function get(path, {priority = false} = {}) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      const r = await fetch(`https://finnhub.io/api/v1/${path}`, {headers: {'X-Finnhub-Token': config.finnhubKey || 'proxy-injected'}, signal: AbortSignal.timeout(15000)});
      if (!r.ok) throw new Error(`Finnhub ${r.status}`);
      return r.json();
    };
    queue[priority ? 'unshift' : 'push']({run, resolve, reject});
    pump();
  });
}

const pending = () => queue.length;
module.exports = {get, pending};
