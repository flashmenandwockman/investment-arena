// Marktdaten: Kurse, Tagesverläufe und Volumen
//  - US-Aktien in Echtzeit über Finnhub (Free-Tarif, gedrosselt über finnhub.js)
//  - DAX-Werte, Indizes, Gold, Volumen und Kursverläufe über Yahoo Finance (nur Prototyp, vor dem Start ersetzen)
//  - Krypto über ccxt (Kraken)
//  - Zusätzlich jede US-Aktie über die Suche: gesuchte Titel werden gespeichert und beobachtet,
//    solange sie jemand hält, sie in einem Fonds stecken oder sie kürzlich angesehen wurden.
// Schlägt ein Abruf fehl, bleiben die letzten Werte bzw. die mitgelieferten Fallback-Daten stehen.
const config = require('./config');
const db = require('./db');
const finnhub = require('./finnhub');
const fallback = require('./fallback/quotes.json');

const CORE = {
  'AAPL':{n:'Apple',t:'Aktie',g:'us',s:'AAPL'}, 'NVDA':{n:'NVIDIA',t:'Aktie',g:'us',s:'NVDA'}, 'MSFT':{n:'Microsoft',t:'Aktie',g:'us',s:'MSFT'},
  'AMZN':{n:'Amazon',t:'Aktie',g:'us',s:'AMZN'}, 'TSLA':{n:'Tesla',t:'Aktie',g:'us',s:'TSLA'},
  'SAP.DE':{n:'SAP',t:'Aktie',g:'de',s:'SAP'}, 'SIE.DE':{n:'Siemens',t:'Aktie',g:'de',s:'SIE'}, 'RHM.DE':{n:'Rheinmetall',t:'Aktie',g:'de',s:'RHM'},
  'ALV.DE':{n:'Allianz',t:'Aktie',g:'de',s:'ALV'}, 'DBK.DE':{n:'Deutsche Bank',t:'Aktie',g:'de',s:'DBK'},
  '^GDAXI':{n:'DAX',t:'Index',g:'idx',s:'DAX'}, '^GSPC':{n:'S&P 500',t:'Index',g:'idx',s:'SPX'}, 'GC=F':{n:'Gold',t:'Rohstoff',g:'idx',s:'XAU'},
  'BTC/EUR':{n:'Bitcoin',t:'Krypto',g:'crypto',s:'BTC'}, 'ETH/EUR':{n:'Ethereum',t:'Krypto',g:'crypto',s:'ETH'}, 'SOL/EUR':{n:'Solana',t:'Krypto',g:'crypto',s:'SOL'},
  'XRP/EUR':{n:'XRP',t:'Krypto',g:'crypto',s:'XRP'}, 'ADA/EUR':{n:'Cardano',t:'Krypto',g:'crypto',s:'ADA'}, 'DOGE/EUR':{n:'Dogecoin',t:'Krypto',g:'crypto',s:'DOGE'},
};
const INSTRUMENTS = {...CORE};
const YAHOO = Object.keys(CORE).filter(s => !s.includes('/')).concat(['EURUSD=X']);
const CRYPTO = Object.keys(CORE).filter(s => s.includes('/'));
const US = Object.keys(CORE).filter(s => CORE[s].g === 'us');
const SYMBOL = /^[A-Z]{1,5}$/;      // US-Kürzel, die Finnhub und Yahoo gleich schreiben

/* ---------- gesuchte Titel dauerhaft speichern ---------- */
db.exec('CREATE TABLE IF NOT EXISTS instruments (sym TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, added_at INTEGER NOT NULL)');
const qInstr = db.prepare('SELECT * FROM instruments');
const qAddInstr = db.prepare('INSERT OR IGNORE INTO instruments (sym, name, type, added_at) VALUES (?, ?, ?, ?)');
const meta = (sym, name, type) => ({n: name, t: type === 'ETP' ? 'ETF' : 'Aktie', g: 'us', s: sym, x: true});
for (const r of qInstr.all()) INSTRUMENTS[r.sym] = meta(r.sym, r.name, r.type);

let quotes = JSON.parse(JSON.stringify(fallback));
let live = false, updatedAt = 0, kraken = null, cryptoHist = {};
const viewed = new Map();            // Symbol → Zeitpunkt des letzten Aufrufs
const histAt = new Map();            // Symbol → Zeitpunkt des letzten Kursverlaufs von Yahoo
let heldProvider = () => new Set();  // wird von index.js gesetzt (Positionen und Fonds)
let rr = 0;                          // Round-Robin-Zeiger für viele beobachtete Titel

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
async function finnhubQuote(s, priority) {
  const q = await finnhub.get(`quote?symbol=${s}`, {priority});
  return q && q.c ? {price: q.c, prev: q.pc, time: q.t} : null;
}

/* ---------- welche Zusatztitel werden beobachtet? ---------- */
function watchedExtras() {
  const held = heldProvider(), now = Date.now(), out = [];
  for (const s of Object.keys(INSTRUMENTS)) {
    if (!INSTRUMENTS[s].x) continue;
    if (held.has(s) || now - (viewed.get(s) || 0) < 30 * 60_000) out.push(s);
  }
  return out;
}

async function refresh() {
  if (config.offline) return quotes;
  const next = {...quotes};
  let ok = 0;
  await Promise.all([
    ...YAHOO.map(async s => { try { next[s] = await yahoo(s); ok++; } catch (e) {} }),
    ...CRYPTO.map(async s => { try { next[s] = await crypto(s); ok++; } catch (e) {} }),
  ]);
  // Zusatztitel: höchstens 20 Finnhub-Kurse je Durchlauf (alle 30 s), der Rest kommt im nächsten Durchlauf dran
  const extras = watchedExtras(), batch = [];
  for (let i = 0; i < Math.min(20, extras.length); i++) batch.push(extras[(rr + i) % extras.length]);
  rr = extras.length ? (rr + batch.length) % extras.length : 0;
  await Promise.all([...US, ...batch].map(async s => {
    try {
      const q = await finnhubQuote(s); if (!q) return;
      next[s] = {...(next[s] || {cur: 'USD', hist: [], vol: []}), ...q, src: 'finnhub'}; ok++;
    } catch (e) {}
  }));
  // Kursverlauf und Volumen der Zusatztitel stündlich von Yahoo
  await Promise.all(batch.filter(s => Date.now() - (histAt.get(s) || 0) > 3600_000).slice(0, 10).map(async s => {
    try { const y = await yahoo(s); next[s] = {...y, ...(next[s] && next[s].src ? {price: next[s].price, prev: next[s].prev, time: next[s].time, src: 'finnhub'} : {})}; histAt.set(s, Date.now()); } catch (e) {}
  }));
  if (ok) { quotes = next; live = true; updatedAt = Date.now(); }
  return quotes;
}

// Firmennamen lesbar machen: „COCA-COLA CO/THE“ → „Coca-Cola“, „Netflix, Inc.“ → „Netflix“
function cleanName(raw) {
  let n = String(raw || '').trim();
  if (n === n.toUpperCase()) n = n.toLowerCase().replace(/(^|[\s.&/-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());
  n = n.replace(/-us$/i, '').replace(/^ss\s+/i, '')
    .replace(/\b(etf|spdr|usd|reit|adr|s&p|msci|esg|ai|qqq|dow|nyse)\b/gi, m => m.toUpperCase()).replace(/\bishares\b/gi, 'iShares');
  for (let i = 0; i < 3; i++) n = n.replace(/\s*\/the$/i, '').replace(/[,\s]+(inc|corp|corporation|co|company|plc|ltd|limited|sa|nv|ag|se|lp)\.?$/i, '').trim();
  return n;
}
/* ---------- Suche und Hinzufügen ---------- */
const searchCache = new Map();
async function search(q) {
  q = String(q || '').trim().slice(0, 40);
  if (q.length < 1) return [];
  const key = q.toLowerCase();
  const hit = searchCache.get(key); if (hit && Date.now() - hit.t < 3600_000) return hit.r;
  const local = Object.entries(INSTRUMENTS).filter(([s, m]) => s.toLowerCase().startsWith(key) || m.n.toLowerCase().includes(key))
    .slice(0, 5).map(([s, m]) => ({sym: s, name: m.n, type: m.t}));
  let remote = [];
  if (!config.offline) {
    try {
      const d = await finnhub.get(`search?q=${encodeURIComponent(q)}&exchange=US`, {priority: true});
      remote = (d.result || []).filter(r => SYMBOL.test(r.symbol) && ['Common Stock', 'ETP', 'ADR'].includes(r.type))
        .map(r => ({sym: r.symbol, name: cleanName(r.description) || r.symbol, type: r.type === 'ETP' ? 'ETF' : 'Aktie'}));
    } catch (e) {}
  }
  const seen = new Set(), r = [];
  for (const x of [...local, ...remote]) if (!seen.has(x.sym)) { seen.add(x.sym); r.push(x); }
  const out = r.slice(0, 10);
  searchCache.set(key, {t: Date.now(), r: out});
  return out;
}

async function add(sym) {
  sym = String(sym || '').toUpperCase();
  touch(sym);
  if (INSTRUMENTS[sym] && quotes[sym]) return {sym, meta: INSTRUMENTS[sym], quote: quotes[sym]};
  if (!SYMBOL.test(sym)) throw new Error('Unbekanntes Kürzel');
  if (config.offline) throw new Error('Im Offline-Modus sind keine weiteren Titel verfügbar');
  const q = await finnhubQuote(sym, true);
  if (!q) throw new Error('Für diesen Titel gibt es keinen Kurs');
  let name = sym, type = 'Common Stock';
  const found = (await search(sym)).find(x => x.sym === sym);
  if (found) { name = cleanName(found.name) || sym; type = found.type === 'ETF' ? 'ETP' : 'Common Stock'; }
  let hist = {hist: [q.prev, q.price], vol: []};
  try { hist = await yahoo(sym); histAt.set(sym, Date.now()); } catch (e) {}
  quotes = {...quotes, [sym]: {...hist, ...q, cur: 'USD', src: 'finnhub'}};
  qAddInstr.run(sym, name, type, Date.now());
  INSTRUMENTS[sym] = meta(sym, name, type);
  return {sym, meta: INSTRUMENTS[sym], quote: quotes[sym]};
}
function touch(sym) { if (INSTRUMENTS[sym] && INSTRUMENTS[sym].x) viewed.set(sym, Date.now()); }

// Was die App anzeigen soll: Kernauswahl plus beobachtete Zusatztitel
function visible() {
  const w = new Set(watchedExtras());
  const q = {}, inst = {};
  for (const s of Object.keys(INSTRUMENTS)) if (!INSTRUMENTS[s].x || w.has(s)) { inst[s] = INSTRUMENTS[s]; if (quotes[s]) q[s] = quotes[s]; }
  if (quotes['EURUSD=X']) q['EURUSD=X'] = quotes['EURUSD=X'];
  return {quotes: q, instruments: inst};
}

const fx = () => (quotes['EURUSD=X'] && quotes['EURUSD=X'].price) || 1.12;
module.exports = {INSTRUMENTS, US, refresh, search, add, touch, visible, cleanName, get: () => quotes, fx, status: () => ({live, updatedAt}),
  setHeldProvider: fn => { heldProvider = fn; }};
