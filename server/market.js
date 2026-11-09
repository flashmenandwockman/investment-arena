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
const SYMBOL = /^[A-Z]{1,5}(\.[A-Z])?$/;   // US-Kürzel, auch Aktienklassen wie BRK.B (bei Yahoo: BRK-B)
const CLASS = /^[A-Z]{1,5}\.[A-Z]$/;

/* ---------- gesuchte Titel dauerhaft speichern ---------- */
db.exec('CREATE TABLE IF NOT EXISTS instruments (sym TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, added_at INTEGER NOT NULL)');
const qInstr = db.prepare('SELECT * FROM instruments');
const qAddInstr = db.prepare('INSERT OR IGNORE INTO instruments (sym, name, type, added_at) VALUES (?, ?, ?, ?)');
const meta = (sym, name, type) => ({n: name, t: type === 'ETP' ? 'ETF' : 'Aktie', g: 'us', s: sym, x: true});
for (const r of qInstr.all()) INSTRUMENTS[r.sym] = meta(r.sym, cleanName(r.name), r.type);   // ältere Einträge nachträglich bereinigen

let quotes = JSON.parse(JSON.stringify(fallback));
let live = false, updatedAt = 0, kraken = null, cryptoHist = {};
const viewed = new Map();            // Symbol → Zeitpunkt des letzten Aufrufs
const histAt = new Map();            // Symbol → Zeitpunkt des letzten Kursverlaufs von Yahoo
let heldProvider = () => new Set();  // wird von index.js gesetzt (Positionen und Fonds)
let privateProvider = () => new Set(); // TRCM-Portfolio: Kurse holen, aber nicht öffentlich listen
let rr = 0;                          // Round-Robin-Zeiger für viele beobachtete Titel
const privAt = new Map();            // Symbol → letzter Yahoo-Abruf für private Titel

async function getJson(url, headers = {}) {
  const r = await fetch(url, {headers: {'User-Agent': 'Mozilla/5.0', ...headers}, signal: AbortSignal.timeout(15000)});
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
async function yahoo(s) {
  if (CLASS.test(s)) s = s.replace('.', '-');
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
// withPrivate: auch Titel, die nur intern beobachtet werden (TRCM-Portfolio) – sie erscheinen nicht in der öffentlichen Liste
function watchedExtras(withPrivate) {
  const held = heldProvider(), priv = withPrivate ? privateProvider() : new Set(), now = Date.now(), out = [];
  for (const s of Object.keys(INSTRUMENTS)) {
    if (!INSTRUMENTS[s].x) continue;
    if (held.has(s) || priv.has(s) || now - (viewed.get(s) || 0) < 30 * 60_000) out.push(s);
  }
  return out;
}

async function refresh() {
  if (config.offline) return quotes;
  const next = {...quotes}, before = new Set(Object.keys(quotes));
  let ok = 0;
  await Promise.all([
    ...YAHOO.map(async s => { try { next[s] = await yahoo(s); ok++; } catch (e) {} }),
    ...CRYPTO.map(async s => { try { next[s] = await crypto(s); ok++; } catch (e) {} }),
  ]);
  // Titel, die nur intern gebraucht werden (TRCM, Großinvestoren): alle 5 Minuten über Yahoo, schont das Finnhub-Kontingent
  const pub = new Set(watchedExtras(false));
  const priv = [...privateProvider()].filter(s => !pub.has(s) && INSTRUMENTS[s] && INSTRUMENTS[s].x && Date.now() - (privAt.get(s) || 0) > 5 * 60_000).slice(0, 15);
  await Promise.all(priv.map(async s => { try { next[s] = await yahoo(s); next[s].src = 'yahoo'; privAt.set(s, Date.now()); ok++; } catch (e) {} }));
  // Zusatztitel: höchstens 12 Finnhub-Kurse je Durchlauf (alle 30 s), der Rest kommt im nächsten Durchlauf dran
  const extras = [...pub], batch = [];
  for (let i = 0; i < Math.min(12, extras.length); i++) batch.push(extras[(rr + i) % extras.length]);
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
  if (ok) {
    // Titel, die während dieses Durchlaufs hinzugekommen sind (Suche, Watchlist, Smart Money), nicht verwerfen
    for (const k of Object.keys(quotes)) if (!before.has(k)) next[k] = quotes[k];
    quotes = next; live = true; updatedAt = Date.now();
  }
  return quotes;
}

// Firmennamen lesbar machen: „COCA-COLA CO/THE“ → „Coca-Cola“, „Netflix, Inc.“ → „Netflix“
function cleanName(raw) {
  let n = String(raw || '').trim();
  if (n === n.toUpperCase()) n = n.toLowerCase().replace(/(^|[\s.&/-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());
  n = n.replace(/-us$/i, '').replace(/^ss\s+/i, '')
    .replace(/\b(etf|spdr|usd|reit|adr|s&p|msci|esg|ai|qqq|dow|nyse)\b/gi, m => m.toUpperCase()).replace(/\bishares\b/gi, 'iShares');
  n = n.replace(/(?!^)\b(Of|And|The|De|For|In|On|At)\b/g, w => w.toLowerCase());   // „Bank of America“
  for (let i = 0; i < 3; i++) n = n.replace(/\s*\/the$/i, '').replace(/[-\s]+(cl(ass)?\.?\s*)?[a-c](\s+shares)?$/i, '').replace(/[,\s]+(inc|corp|corporation|co|company|plc|ltd|limited|sa|nv|ag|se|lp)\.?$/i, '').trim();
  return n;
}
/* ---------- Verzeichnis aller US-Aktien, ETFs und ADRs (einmal täglich, ein einziger Abruf) ---------- */
// Damit läuft die Suche lokal in Millisekunden statt über einen Finnhub-Abruf je Tastendruck.
const fs = require('fs');
const path = require('path');
const DIR_FILE = path.join(config.dataDir, 'symbols.json');
const MAJOR = new Set(['XNAS', 'XNYS', 'ARCX', 'BATS', 'XASE']);
let directory = [], dirBySym = new Map(), dirAt = 0;
function setDirectory(list, at) {
  directory = list.map(x => ({...x, k: x.n.toLowerCase(), ks: x.s.toLowerCase()}));
  dirBySym = new Map(directory.map(x => [x.s, x])); dirAt = at;
}
const DIR_VERSION = 3;   // erhöhen, wenn sich die Namensbereinigung ändert
try { const d = JSON.parse(fs.readFileSync(DIR_FILE, 'utf8')); if (d.v === DIR_VERSION) setDirectory(d.list, d.at); } catch (e) {}
async function loadDirectory() {
  if (config.offline || (directory.length && Date.now() - dirAt < 24 * 3600_000)) return;
  try {
    const raw = await finnhub.get('stock/symbol?exchange=US');
    const list = raw.filter(r => SYMBOL.test(r.symbol) && ['Common Stock', 'ETP', 'ADR'].includes(r.type))
      .map(r => ({s: r.symbol, n: cleanName(r.description) || r.symbol, t: r.type === 'ETP' ? 'ETF' : 'Aktie', m: MAJOR.has(r.mic) ? 1 : 0}));
    if (list.length < 1000) return;
    setDirectory(list, Date.now());
    fs.writeFileSync(DIR_FILE, JSON.stringify({v: DIR_VERSION, at: dirAt, list}));
  } catch (e) { console.warn('Symbolverzeichnis', e.message); }
}
// Treffer bewerten: Kürzel exakt > Name beginnt mit Suchwort > Kürzel beginnt > Wortanfang im Namen; Börse vor OTC, kurze Namen zuerst
function scoreDir(x, key) {
  let sc = x.ks === key ? 100 : x.k.startsWith(key) ? 60 : x.ks.startsWith(key) ? 45 : x.k.includes(' ' + key) || x.k.includes('-' + key) ? 30 : x.k.includes(key) ? 10 : 0;
  if (!sc) return 0;
  return sc + x.m * 25 + (x.t === 'Aktie' ? 5 : 0) - Math.min(x.n.length, 40) / 4;
}

/* ---------- Suche und Hinzufügen ---------- */
const searchCache = new Map();
async function search(q) {
  q = String(q || '').trim().slice(0, 40);
  if (q.length < 1) return [];
  const key = q.toLowerCase();
  const hit = searchCache.get(key); if (hit && Date.now() - hit.t < 3600_000) return hit.r;
  if (directory.length) {
    const local = Object.entries(INSTRUMENTS).filter(([s, m]) => !m.x && (s.toLowerCase().startsWith(key) || m.n.toLowerCase().includes(key)))
      .map(([s, m]) => ({sym: s, name: m.n, type: m.t}));
    const found = [];
    for (const x of directory) { const sc = scoreDir(x, key); if (sc > 0) found.push([sc + (INSTRUMENTS[x.s] ? 20 : 0), x]); }
    found.sort((a, b) => b[0] - a[0]);
    const seen = new Set(local.map(x => x.sym)), out = local.slice(0, 4);
    for (const [, x] of found) { if (out.length >= 10) break; if (!seen.has(x.s)) { seen.add(x.s); out.push({sym: x.s, name: x.n, type: x.t}); } }
    searchCache.set(key, {t: Date.now(), r: out});
    if (searchCache.size > 5000) searchCache.delete(searchCache.keys().next().value);
    return out;
  }
  // Ohne Verzeichnis (erster Start, Offline): wie bisher
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

async function add(sym, {silent} = {}) {
  sym = String(sym || '').toUpperCase();
  if (!silent) touch(sym);
  if (INSTRUMENTS[sym] && quotes[sym]) return {sym, meta: INSTRUMENTS[sym], quote: quotes[sym]};
  if (!SYMBOL.test(sym)) throw new Error('Unbekanntes Kürzel');
  if (config.offline) throw new Error('Im Offline-Modus sind keine weiteren Titel verfügbar');
  // Name aus dem Verzeichnis, Kurs und Verlauf in einem Abruf von Yahoo; Finnhub nur als Ersatz
  const d = dirBySym.get(sym);
  if (directory.length && !d) throw new Error('Unbekanntes Kürzel');
  let data = null;
  try { const y = await yahoo(sym); if (y.price) { data = {...y, cur: 'USD', src: 'yahoo'}; histAt.set(sym, Date.now()); } } catch (e) {}
  if (!data) { const q = await finnhubQuote(sym, true); if (q) data = {hist: [q.prev, q.price], vol: [], ...q, cur: 'USD', src: 'finnhub'}; }
  if (!data) throw new Error('Für diesen Titel gibt es keinen Kurs');
  let name = d ? d.n : sym, type = d && d.t === 'ETF' ? 'ETP' : 'Common Stock';
  if (!d) { const found = (await search(sym)).find(x => x.sym === sym); if (found) { name = cleanName(found.name) || sym; type = found.type === 'ETF' ? 'ETP' : 'Common Stock'; } }
  quotes = {...quotes, [sym]: data};
  qAddInstr.run(sym, name, type, Date.now());
  INSTRUMENTS[sym] = meta(sym, name, type);
  if (!silent) touch(sym);   // erst jetzt existiert der Titel: als angesehen markieren, damit er Kurse bekommt und in der Liste erscheint
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

/* ---------- Kursverlauf für den Chart: 24h, Woche, Monat, Jahr, 5 Jahre ---------- */
const RANGES = {'1d': ['1d', '5m', 120_000], '5d': ['5d', '30m', 600_000], '1mo': ['1mo', '60m', 1800_000], '3mo': ['3mo', '1d', 3 * 3600_000], '1y': ['1y', '1d', 6 * 3600_000], '5y': ['5y', '1wk', 12 * 3600_000]};
// Ersatzverlauf aus Tagesschlusskursen (ohne Live-Daten): Eröffnung = Vortagesschluss
const fromHist = h => h.map((v, i) => { const o = i ? h[i - 1] : v; return [Date.now() - (h.length - 1 - i) * 864e5, v, o, Math.max(o, v), Math.min(o, v)]; });
const chartCache = new Map();
const yahooSym = s => s.includes('/') ? s.replace('/', '-') : CLASS.test(s) ? s.replace('.', '-') : s;
async function chart(sym, r) {
  if (!INSTRUMENTS[sym]) throw Object.assign(new Error('Unbekannter Wert'), {status: 404});
  if (!RANGES[r]) r = '1mo';
  const key = sym + '|' + r, hit = chartCache.get(key), [range, interval, ttl] = RANGES[r];
  if (hit && Date.now() - hit.t < ttl) return hit.d;
  const q = quotes[sym] || {};
  let d;
  if (config.offline) {
    const h = q.hist || [];
    d = {sym, r, cur: q.cur, points: fromHist(h), daily: true};
  } else {
    try {
      const j = (await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym(sym))}?range=${range}&interval=${interval}`)).chart.result[0];
      const ts = j.timestamp || [], Q = j.indicators.quote[0], c = Q.close || [], pts = [];
      for (let i = 0; i < ts.length; i++) if (c[i] != null) {
        const o = Q.open && Q.open[i] != null ? Q.open[i] : c[i];
        pts.push([ts[i] * 1000, c[i], o, Math.max(o, c[i], (Q.high || [])[i] || 0), Math.min(o, c[i], (Q.low || [])[i] || Infinity)]);
      }
      // aktueller Kurs fließt in die letzte Kerze ein
      const last = pts[pts.length - 1];
      if (q.price && last && r !== '5y' && Date.now() - last[0] < 7 * 864e5) { last[1] = q.price; last[3] = Math.max(last[3], q.price); last[4] = Math.min(last[4], q.price); }
      d = {sym, r, cur: j.meta.currency || q.cur, points: pts, prevClose: r === '1d' ? j.meta.chartPreviousClose : null};
    } catch (e) {
      if (hit) return hit.d;
      d = {sym, r, cur: q.cur, points: fromHist(q.hist || []), daily: true};
    }
  }
  chartCache.set(key, {t: Date.now(), d});
  if (chartCache.size > 2000) chartCache.delete(chartCache.keys().next().value);
  return d;
}

const fx = () => (quotes['EURUSD=X'] && quotes['EURUSD=X'].price) || 1.12;
module.exports = {dirName: sym => (dirBySym.get(sym) || {}).n || null, INSTRUMENTS, US, refresh, search, add, loadDirectory, directorySize: () => directory.length, touch, visible, chart, cleanName, get: () => quotes, fx, status: () => ({live, updatedAt}),
  setHeldProvider: fn => { heldProvider = fn; }, setPrivateProvider: fn => { privateProvider = fn; }};
