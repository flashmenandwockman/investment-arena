// Marktdaten: Kurse, Tagesverläufe und Volumen
//  - US-Aktien in Echtzeit über Finnhub (Free-Tarif)
//  - DAX-Werte, Indizes, Gold, Volumen über Yahoo Finance (nur Prototyp, vor dem Start ersetzen)
//  - Krypto über ccxt (Kraken)
// Schlägt ein Abruf fehl, bleiben die letzten Werte bzw. die mitgelieferten Fallback-Daten stehen.
const config = require('./config');
const fallback = require('./fallback/quotes.json');

const INSTRUMENTS = {
  'AAPL':{n:'Apple',t:'Aktie',g:'us',s:'AAPL'}, 'NVDA':{n:'NVIDIA',t:'Aktie',g:'us',s:'NVDA'}, 'MSFT':{n:'Microsoft',t:'Aktie',g:'us',s:'MSFT'},
  'AMZN':{n:'Amazon',t:'Aktie',g:'us',s:'AMZN'}, 'TSLA':{n:'Tesla',t:'Aktie',g:'us',s:'TSLA'},
  'SAP.DE':{n:'SAP',t:'Aktie',g:'de',s:'SAP'}, 'SIE.DE':{n:'Siemens',t:'Aktie',g:'de',s:'SIE'}, 'RHM.DE':{n:'Rheinmetall',t:'Aktie',g:'de',s:'RHM'},
  'ALV.DE':{n:'Allianz',t:'Aktie',g:'de',s:'ALV'}, 'DBK.DE':{n:'Deutsche Bank',t:'Aktie',g:'de',s:'DBK'},
  '^GDAXI':{n:'DAX',t:'Index',g:'idx',s:'DAX'}, '^GSPC':{n:'S&P 500',t:'Index',g:'idx',s:'SPX'}, 'GC=F':{n:'Gold',t:'Rohstoff',g:'idx',s:'XAU'},
  'BTC/EUR':{n:'Bitcoin',t:'Krypto',g:'crypto',s:'BTC'}, 'ETH/EUR':{n:'Ethereum',t:'Krypto',g:'crypto',s:'ETH'}, 'SOL/EUR':{n:'Solana',t:'Krypto',g:'crypto',s:'SOL'},
  'XRP/EUR':{n:'XRP',t:'Krypto',g:'crypto',s:'XRP'}, 'ADA/EUR':{n:'Cardano',t:'Krypto',g:'crypto',s:'ADA'}, 'DOGE/EUR':{n:'Dogecoin',t:'Krypto',g:'crypto',s:'DOGE'},
};
const YAHOO = Object.keys(INSTRUMENTS).filter(s => !s.includes('/')).concat(['EURUSD=X']);
const CRYPTO = Object.keys(INSTRUMENTS).filter(s => s.includes('/'));
const US = Object.keys(INSTRUMENTS).filter(s => INSTRUMENTS[s].g === 'us');

let quotes = JSON.parse(JSON.stringify(fallback));
let live = false, updatedAt = 0, kraken = null, cryptoHist = {};

async function getJson(url, headers = {}) {
  const r = await fetch(url, {headers: {'User-Agent': 'Mozilla/5.0', ...headers}, signal: AbortSignal.timeout(15000)});
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
async function yahoo(s) {
  const j = (await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=3mo&interval=1d`)).chart.result[0];
  const m = j.meta, q = j.indicators.quote[0];
  const closes = q.close.filter(c => c != null), vols = (q.volume || []).filter(v => v != null);
  return {price: m.regularMarketPrice, prev: closes.at(-2), cur: m.currency, time: m.regularMarketTime, hist: closes.slice(-60), vol: vols.slice(-21)};
}
async function crypto(s) {
  if (!kraken) { const ccxt = require('ccxt'); kraken = new ccxt.kraken(); }
  const t = await kraken.fetchTicker(s);
  if (!cryptoHist[s] || Date.now() - cryptoHist[s].t > 3600_000) {
    const o = await kraken.fetchOHLCV(s, '1d', undefined, 61);
    cryptoHist[s] = {t: Date.now(), closes: o.map(c => c[4]), vols: o.map(c => c[5])};
  }
  const h = cryptoHist[s];
  return {price: t.last, prev: h.closes.at(-2), cur: 'EUR', time: Math.floor((t.timestamp || Date.now()) / 1000), hist: h.closes.slice(-60), vol: h.vols.slice(-21)};
}
async function finnhubQuote(s) {
  const q = await getJson(`https://finnhub.io/api/v1/quote?symbol=${s}`, {'X-Finnhub-Token': config.finnhubKey || 'proxy-injected'});
  return q && q.c ? {price: q.c, prev: q.pc, time: q.t} : null;
}

async function refresh() {
  if (config.offline) return quotes;
  const next = {...quotes};
  let ok = 0;
  await Promise.all([
    ...YAHOO.map(async s => { try { next[s] = await yahoo(s); ok++; } catch (e) {} }),
    ...CRYPTO.map(async s => { try { next[s] = await crypto(s); ok++; } catch (e) {} }),
  ]);
  await Promise.all(US.map(async s => {
    try { const q = await finnhubQuote(s); if (q && next[s]) { next[s] = {...next[s], ...q, src: 'finnhub'}; ok++; } } catch (e) {}
  }));
  if (ok) { quotes = next; live = true; updatedAt = Date.now(); }
  return quotes;
}

const fx = () => (quotes['EURUSD=X'] && quotes['EURUSD=X'].price) || 1.12;
module.exports = {INSTRUMENTS, US, refresh, get: () => quotes, fx, status: () => ({live, updatedAt})};
