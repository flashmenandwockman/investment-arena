// Smart Money aus Pflichtmeldungen: Was haben die großen Investoren zuletzt gekauft und verkauft?
// Quelle: SEC 13F (Quartalsmeldungen von US-Verwaltern über 100 Mio. $), Vergleich der letzten beiden Meldungen je Investor.
// Daraus: Bewegungen (neu, aufgestockt, reduziert, verkauft), Nettozuflüsse nach Branche, Halter je Titel.
// Branchen über Finnhub (Unternehmensprofil), einmal je Titel und zwischengespeichert.
// Hinweis: Options-Flow, Dark Pool und Kongress-Trades (z. B. Unusual Whales) brauchen eine kostenpflichtige Lizenz.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const config = require('./config');
const finnhub = require('./finnhub');
const market = require('./market');
const gurus = require('./gurus');

db.exec(`
CREATE TABLE IF NOT EXISTS smart_moves (
  cik TEXT NOT NULL, person TEXT NOT NULL, firm TEXT NOT NULL, sym TEXT NOT NULL, name TEXT NOT NULL,
  action TEXT NOT NULL,          -- neu | auf | ab | raus | gehalten
  chg REAL, weight REAL NOT NULL, value REAL NOT NULL, flow REAL NOT NULL,
  report_date TEXT NOT NULL, filing_date TEXT NOT NULL, prev_date TEXT,
  PRIMARY KEY (cik, sym)
);
CREATE TABLE IF NOT EXISTS smart_state (cik TEXT PRIMARY KEY, accession TEXT NOT NULL, synced_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS profiles (sym TEXT PRIMARY KEY, industry TEXT, checked_at INTEGER NOT NULL);
`);
const FALLBACK = path.join(__dirname, 'fallback', 'smart.json');
const TOP = 60;   // je Meldung die 60 größten Positionen vergleichen
const ALIAS = {'SAP.DE': 'SAP', 'SIE.DE': 'SIEGY', 'RHM.DE': 'RNMBY', 'ALV.DE': 'ALIZY', 'DBK.DE': 'DB'};

const SECTOR = {
  'Semiconductors': 'Halbleiter', 'Technology': 'Technologie', 'Banking': 'Banken', 'Financial Services': 'Finanzdienste', 'Insurance': 'Versicherungen',
  'Energy': 'Energie', 'Utilities': 'Versorger', 'Oil & Gas': 'Energie', 'Beverages': 'Konsumgüter', 'Food Products': 'Konsumgüter', 'Tobacco': 'Konsumgüter',
  'Consumer products': 'Konsumgüter', 'Textiles, Apparel & Luxury Goods': 'Konsumgüter', 'Retail': 'Handel & E-Commerce', 'Automobiles': 'Autos', 'Auto Components': 'Autos',
  'Health Care': 'Gesundheit', 'Pharmaceuticals': 'Gesundheit', 'Biotechnology': 'Gesundheit', 'Life Sciences Tools & Services': 'Gesundheit',
  'Media': 'Medien & Kommunikation', 'Communications': 'Medien & Kommunikation', 'Telecommunication': 'Medien & Kommunikation',
  'Electrical Equipment': 'Industrie', 'Machinery': 'Industrie', 'Industrial Conglomerates': 'Industrie', 'Aerospace & Defense': 'Industrie', 'Building': 'Industrie',
  'Construction': 'Industrie', 'Logistics & Transportation': 'Industrie', 'Airlines': 'Industrie', 'Road & Rail': 'Industrie', 'Transportation Infrastructure': 'Industrie',
  'Professional Services': 'Industrie', 'Commercial Services & Supplies': 'Industrie', 'Trading Companies & Distributors': 'Industrie',
  'Real Estate': 'Immobilien', 'Chemicals': 'Rohstoffe', 'Metals & Mining': 'Rohstoffe', 'Hotels, Restaurants & Leisure': 'Freizeit & Gastronomie',
};
const sectorOf = ind => ind == null ? 'ETFs & Fonds' : SECTOR[ind] || 'Sonstige';

const q = {
  del: db.prepare('DELETE FROM smart_moves WHERE cik = ?'),
  ins: db.prepare('INSERT OR REPLACE INTO smart_moves (cik, person, firm, sym, name, action, chg, weight, value, flow, report_date, filing_date, prev_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  state: db.prepare('SELECT * FROM smart_state WHERE cik = ?'),
  setState: db.prepare('INSERT OR REPLACE INTO smart_state (cik, accession, synced_at) VALUES (?, ?, ?)'),
  all: db.prepare('SELECT * FROM smart_moves'),
  count: db.prepare('SELECT COUNT(*) AS n FROM smart_moves'),
  bySym: db.prepare('SELECT * FROM smart_moves WHERE sym = ? ORDER BY value DESC'),
  prof: db.prepare('SELECT * FROM profiles WHERE sym = ?'),
  putProf: db.prepare('INSERT OR REPLACE INTO profiles (sym, industry, checked_at) VALUES (?, ?, ?)'),
  noProf: db.prepare('SELECT DISTINCT m.sym FROM smart_moves m LEFT JOIN profiles p ON p.sym = m.sym WHERE p.sym IS NULL'),
};

/* ---------- Bewegungen eines Investors aus zwei Meldungen ---------- */
async function movesOf(g) {
  const [cur, prev] = await gurus.lastTwo(g.cik);
  if (!cur || Date.now() - Date.parse(cur.filingDate) > 270 * 864e5) return null;
  const st = q.state.get(g.cik); if (st && st.accession === cur.accession) return null;
  const now = await gurus.infoTable(g.cik, cur.accession), before = prev ? await gurus.infoTable(g.cik, prev.accession) : [];
  const total = now.reduce((a, r) => a + r.value, 0) || 1;
  const N = new Map(now.map(r => [r.cusip, r])), B = new Map(before.map(r => [r.cusip, r]));
  const cusips = [...new Set([...now.slice(0, TOP), ...before.slice(0, TOP)].map(r => r.cusip))];
  const map = await gurus.tickers(cusips);
  const rows = [];
  for (const c of cusips) {
    const sym = map[c]; if (!sym) continue;
    const n = N.get(c), b = B.get(c), ns = n ? n.shares : 0, bs = b ? b.shares : 0;
    const px = n && n.shares ? n.value / n.shares : b && b.shares ? b.value / b.shares : 0;
    let action = 'gehalten', chg = null;
    if (!prev) action = 'gehalten';
    else if (!bs && ns) action = 'neu';
    else if (bs && !ns) { action = 'raus'; chg = -1; }
    else if (bs && ns) { chg = ns / bs - 1; action = Math.abs(chg) < .02 ? 'gehalten' : chg > 0 ? 'auf' : 'ab'; }
    const name = market.dirName(sym) || market.cleanName((n || b).name);
    rows.push({cik: g.cik, person: g.person, firm: g.firm, sym, name, action, chg, weight: n ? n.value / total : 0, value: n ? n.value : 0,
      flow: prev ? (ns - bs) * px : 0, report: cur.reportDate, filing: cur.filingDate, prevReport: prev ? prev.reportDate : null});
  }
  return {accession: cur.accession, rows};
}
function store(g, accession, rows) {
  q.del.run(g.cik);
  for (const r of rows) q.ins.run(r.cik, r.person, r.firm, r.sym, r.name, r.action, r.chg, r.weight, r.value, r.flow, r.report, r.filing, r.prevReport);
  q.setState.run(g.cik, accession, Date.now());
}

// Branchen nachladen (Hintergrund, schont das Finnhub-Kontingent)
async function loadProfiles() {
  if (config.offline) return;
  for (const {sym} of q.noProf.all().slice(0, 120)) {
    try { const p = await finnhub.get(`stock/profile2?symbol=${encodeURIComponent(sym)}`); q.putProf.run(sym, p && p.finnhubIndustry ? p.finnhubIndustry : null, Date.now()); cache.t = 0; }
    catch (e) { break; }
  }
}

let running = false;
async function sync() {
  if (!config.gurus || running) return;
  running = true;
  try {
    if (!q.count.get().n && fs.existsSync(FALLBACK)) {   // erster Start / ohne Netz: mitgelieferte Auswertung
      const fb = JSON.parse(fs.readFileSync(FALLBACK, 'utf8'));
      for (const g of gurus.GURUS) if (fb.moves[g.cik]) { store(g, 'fallback', fb.moves[g.cik]); }
      for (const [sym, ind] of Object.entries(fb.profiles || {})) q.putProf.run(sym, ind, Date.now());
      cache.t = 0;
    }
    if (config.offline) return;
    for (const g of gurus.GURUS) {
      try { const r = await movesOf(g); if (r) { store(g, r.accession, r.rows); cache.t = 0; } } catch (e) { console.warn('Smart Money', g.firm, e.message); }
    }
    await loadProfiles();
  } finally { running = false; }
}

/* ---------- Ansichten ---------- */
let cache = {t: 0, d: null};
function overview() {
  if (cache.d && Date.now() - cache.t < 10 * 60_000) return cache.d;
  const rows = q.all.all(), flows = new Map(), dates = {};
  for (const r of rows) {
    const p = q.prof.get(r.sym), sec = sectorOf(p ? p.industry : undefined);
    if (p) flows.set(sec, (flows.get(sec) || 0) + r.flow);
    dates[r.report_date] = (dates[r.report_date] || 0) + 1;
  }
  const report = Object.entries(dates).sort((a, b) => b[1] - a[1])[0];
  const moves = rows.filter(r => ['neu', 'auf', 'ab', 'raus'].includes(r.action))
    .sort((a, b) => Math.abs(b.flow) - Math.abs(a.flow)).slice(0, 80)
    .map(r => ({person: r.person, firm: r.firm, sym: r.sym, name: r.name, action: r.action, chg: r.chg, weight: r.weight, flow: r.flow, filing: r.filing_date, report: r.report_date}));
  const fl = [...flows.entries()].filter(([s]) => s !== 'Sonstige').map(([sector, net]) => ({sector, net})).sort((a, b) => b.net - a.net);
  const d = {report: report ? report[0] : null, investors: new Set(rows.map(r => r.cik)).size,
    flows: fl.length > 8 ? [...fl.slice(0, 4), ...fl.slice(-4)] : fl, moves};
  cache = {t: Date.now(), d};
  return d;
}
function forSymbol(sym) {
  const rows = q.bySym.all(ALIAS[sym] || sym);
  return {holders: rows.filter(r => r.action !== 'raus').map(r => ({person: r.person, firm: r.firm, weight: r.weight, action: r.action, chg: r.chg, report: r.report_date})),
    sold: rows.filter(r => r.action === 'raus').map(r => ({person: r.person, firm: r.firm, report: r.report_date})), of: gurus.GURUS.length};
}

// Für npm run snapshot: aktuelle Auswertung als Fallback speichern
async function snapshot() {
  const out = {moves: {}, profiles: {}};
  for (const g of gurus.GURUS) { try { q.state.get(g.cik) && db.prepare('DELETE FROM smart_state WHERE cik = ?').run(g.cik); const r = await movesOf(g); if (r) out.moves[g.cik] = r.rows; } catch (e) { console.warn(g.firm, e.message); } }
  const syms = new Set(Object.values(out.moves).flat().map(r => r.sym));
  for (const sym of syms) { try { const p = await finnhub.get(`stock/profile2?symbol=${encodeURIComponent(sym)}`); out.profiles[sym] = p && p.finnhubIndustry ? p.finnhubIndustry : null; } catch (e) {} }
  return out;
}

module.exports = {sync, overview, forSymbol, snapshot, FALLBACK};
