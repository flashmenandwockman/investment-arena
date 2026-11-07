// Finnhub-Client mit zentraler Drosselung: Der Free-Tarif erlaubt 60 Abrufe pro Minute.
// Alle Module (Kurse, Suche, Radar) holen ihre Daten hierüber, damit das Limit nie überschritten wird.
const config = require('./config');

// Hintergrundabrufe (Kurse, Radar) dürfen nur einen Teil des Limits nutzen,
// damit Suchen und neu geöffnete Titel nie auf ein ausgeschöpftes Kontingent warten.
const LIMIT = 55, BACKGROUND = 38, WINDOW = 60_000;
const stamps = [];
const queue = [];
let timer = null;

function pump() {
  timer = null;
  const now = Date.now();
  while (stamps.length && now - stamps[0] > WINDOW) stamps.shift();
  while (queue.length && stamps.length < (queue[0].priority ? LIMIT : BACKGROUND)) {
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
    // Hintergrundabrufe verfallen, wenn sie zu lange warten (der nächste Durchlauf holt sie ohnehin)
    if (!priority && queue.filter(j => !j.priority).length > 60) return reject(new Error('Finnhub-Warteschlange voll'));
    queue[priority ? 'unshift' : 'push']({run, resolve, reject, priority});
    pump();
  });
}

const pending = () => queue.length;
module.exports = {get, pending};
