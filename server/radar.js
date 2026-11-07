// Smart-Money-Radar über die Finnhub-API (Free-Tarif):
// Insider-Trades (SEC Form 4), Insider-Stimmung, Analystenkonsens, Quartalstermine, News.
// Kongress-Trades, Options-Flow und Dark Pool sind im Free-Tarif nicht enthalten.
const config = require('./config');
const finnhub = require('./finnhub');
const fallback = require('./fallback/radar.json');

// App-Symbol → Finnhub-Symbol (deutsche Werte über ihr US-Kürzel)
const MAP = {
  'AAPL':'AAPL', 'NVDA':'NVDA', 'MSFT':'MSFT', 'AMZN':'AMZN', 'TSLA':'TSLA',
  'SAP.DE':'SAP', 'SIE.DE':'SIEGY', 'RHM.DE':'RNMBY', 'ALV.DE':'ALIZY', 'DBK.DE':'DB',
};
const US = ['AAPL', 'NVDA', 'MSFT', 'AMZN', 'TSLA'];

let data = fallback, live = false, updatedAt = 0;
const day = d => d.toISOString().slice(0, 10);

const fh = (path, priority = false) => finnhub.get(path, {priority});

async function forSymbol(app, priority = false) {
  const s = MAP[app] || app, now = new Date(), out = {};
  const fh2 = path => fh(path, priority);
  const ago = n => day(new Date(now - n * 864e5)), ahead = n => day(new Date(+now + n * 864e5));

  const rec = await fh2(`stock/recommendation?symbol=${s}`).catch(() => []);
  if (rec[0]) out.rec = {sb: rec[0].strongBuy, b: rec[0].buy, h: rec[0].hold, s: rec[0].sell, ss: rec[0].strongSell, period: rec[0].period};

  const cal = (await fh2(`calendar/earnings?symbol=${s}&from=${ago(120)}&to=${ahead(150)}`).catch(() => ({}))).earningsCalendar || [];
  const fut = cal.filter(e => e.date >= day(now)).sort((a, b) => a.date.localeCompare(b.date))[0];
  const past = cal.filter(e => e.date < day(now) && e.epsActual != null).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (fut) out.next = {date: fut.date, hour: fut.hour, eps: fut.epsEstimate};
  if (past) out.last = {date: past.date, act: past.epsActual, est: past.epsEstimate};

  if (US.includes(app) || !MAP[app]) {
    const tx = ((await fh2(`stock/insider-transactions?symbol=${s}&from=${ago(120)}`).catch(() => ({}))).data || [])
      .filter(t => !t.isDerivative && (t.transactionCode === 'P' || t.transactionCode === 'S') && t.transactionPrice > 0);
    const buys = tx.filter(t => t.transactionCode === 'P'), sells = tx.filter(t => t.transactionCode === 'S');
    const val = a => a.reduce((x, t) => x + Math.abs(t.change) * t.transactionPrice, 0);
    out.ins = {
      buys: buys.length, buyVal: val(buys), sells: sells.length, sellVal: val(sells),
      top: tx.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate)).slice(0, 4)
        .map(t => ({n: t.name, c: t.transactionCode, sh: Math.abs(t.change), p: t.transactionPrice, d: t.transactionDate})),
    };
    const ms = (await fh2(`stock/insider-sentiment?symbol=${s}&from=${ago(200)}&to=${day(now)}`).catch(() => ({}))).data || [];
    if (ms.length) out.ins.mspr = ms.at(-1).mspr;
    const news = await fh2(`company-news?symbol=${s}&from=${ago(5)}&to=${day(now)}`).catch(() => []);
    out.news = news.slice(0, 3).map(n => ({h: n.headline, src: n.source, url: n.url, t: n.datetime}));
  }
  return out;
}

// Rund 4 Abrufe je US-Wert und 2 je deutschem Wert: deutlich unter 60 Abrufen pro Minute
async function refresh() {
  if (config.offline) return data;
  const out = {};
  for (const app of Object.keys(MAP)) { try { out[app] = await forSymbol(app); } catch (e) {} }
  if (Object.values(out).some(v => v.rec || v.next)) { data = out; live = true; updatedAt = Date.now(); }
  return data;
}

// Einzelner Zusatztitel aus der Suche: Daten bei Bedarf holen und 30 Minuten zwischenspeichern
const extra = new Map();
async function one(sym) {
  if (data[sym]) return data[sym];
  const c = extra.get(sym); if (c && Date.now() - c.t < 30 * 60_000) return c.d;
  if (config.offline) return {};
  const d = await forSymbol(sym, true);
  extra.set(sym, {t: Date.now(), d});
  return d;
}

module.exports = {refresh, one, get: () => data, status: () => ({live, updatedAt})};
