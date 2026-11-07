// Großinvestoren kopieren: Depots bekannter Investoren aus den öffentlichen 13F-Meldungen an die US-Börsenaufsicht SEC.
// US-Vermögensverwalter mit mehr als 100 Mio. $ melden ihre Aktienpositionen vierteljährlich (bis 45 Tage nach Quartalsende).
// Wir übernehmen die 10 größten Aktienpositionen (nach Marktwert) als Musterdepot mit Anteilswert, das man kopieren kann.
// Bei einer neuen Meldung wird zum aktuellen Kurs umgeschichtet; der Anteilswert läuft ohne Sprung weiter.
// CUSIP → Börsenkürzel über OpenFIGI (kostenlos, ohne Schlüssel 25 Anfragen pro Minute).
const fs = require('fs');
const path = require('path');
const db = require('./db');
const config = require('./config');
const market = require('./market');
const funds = require('./funds');

const GURUS = [
  {cik: '1067983', person: 'Warren Buffett', firm: 'Berkshire Hathaway', style: 'Value, Qualität, sehr langfristig', c: '#e0c28a'},
  {cik: '1336528', person: 'Bill Ackman', firm: 'Pershing Square', style: 'Wenige große Wetten, aktivistisch', c: '#8fd3ff'},
  {cik: '1350694', person: 'Ray Dalio', firm: 'Bridgewater Associates', style: 'Makro, breit gestreut', c: '#a6f0c6'},
  {cik: '1536411', person: 'Stanley Druckenmiller', firm: 'Duquesne Family Office', style: 'Makro und Wachstum, flexibel', c: '#ffb38a'},
  {cik: '1656456', person: 'David Tepper', firm: 'Appaloosa', style: 'Opportunistisch, Tech und Finanzwerte', c: '#b7a6ff'},
  {cik: '921669', person: 'Carl Icahn', firm: 'Icahn Enterprises', style: 'Aktivist, konzentriert', c: '#ff9aa8'},
  {cik: '1040273', person: 'Dan Loeb', firm: 'Third Point', style: 'Event-Driven, aktivistisch', c: '#9fe3e0'},
  {cik: '1061768', person: 'Seth Klarman', firm: 'Baupost Group', style: 'Deep Value, Sicherheitsmarge', c: '#ffd48a'},
  {cik: '1709323', person: 'Li Lu', firm: 'Himalaya Capital', style: 'Value, sehr konzentriert', c: '#f3e2bd'},
  {cik: '1167483', person: 'Chase Coleman', firm: 'Tiger Global', style: 'Wachstum, Technologie', c: '#ffb38a'},
  {cik: '1697748', person: 'Cathie Wood', firm: 'ARK Invest', style: 'Disruptive Innovation', c: '#ff9aa8'},
  {cik: '1103804', person: 'Andreas Halvorsen', firm: 'Viking Global', style: 'Long/Short, Qualitätswachstum', c: '#a6f0c6'},
];
const TOP = 10, SYMBOL = /^[A-Z]{1,5}$/;
const FALLBACK = path.join(__dirname, 'fallback', 'gurus.json');

db.exec('CREATE TABLE IF NOT EXISTS cusips (cusip TEXT PRIMARY KEY, ticker TEXT, name TEXT, checked_at INTEGER NOT NULL)');
const qCusip = db.prepare('SELECT * FROM cusips WHERE cusip = ?');
const qPutCusip = db.prepare('INSERT INTO cusips (cusip, ticker, name, checked_at) VALUES (?, ?, ?, ?) ON CONFLICT(cusip) DO UPDATE SET ticker = excluded.ticker, name = excluded.name, checked_at = excluded.checked_at');
const qUser = db.prepare("SELECT * FROM users WHERE provider = 'guru' AND provider_sub = ?");
const qInsUser = db.prepare("INSERT INTO users (email, name, pass, provider, provider_sub, bio, color, is_bot, created_at) VALUES (NULL, ?, NULL, 'guru', ?, ?, ?, 1, ?)");
const qFund = db.prepare("SELECT * FROM funds WHERE kind = 'guru' AND owner_id = ?");
const qInsFund = db.prepare("INSERT INTO funds (owner_id, name, strategy, holdings, created_at, kind, nav_base, rebalanced_at, source) VALUES (?, ?, ?, ?, ?, 'guru', 100, ?, ?)");
const qUpdFund = db.prepare('UPDATE funds SET holdings = ?, nav_base = ?, rebalanced_at = ?, source = ? WHERE id = ?');

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function sec(url, json = true) {
  await sleep(150);   // SEC erlaubt höchstens 10 Anfragen pro Sekunde
  const r = await fetch(url, {headers: {'User-Agent': config.secUserAgent, 'Accept-Encoding': 'gzip, deflate'}, signal: AbortSignal.timeout(20000)});
  if (!r.ok) throw new Error(`SEC ${r.status} ${url}`);
  return json ? r.json() : r.text();
}

// Neueste 13F-HR-Meldung eines Verwalters (nur Meldungen der letzten 9 Monate)
async function latestFiling(cik) {
  const d = await sec(`https://data.sec.gov/submissions/CIK${cik.padStart(10, '0')}.json`), r = d.filings.recent;
  for (let i = 0; i < r.form.length; i++) if (r.form[i] === '13F-HR') {
    if (Date.now() - Date.parse(r.filingDate[i]) > 270 * 864e5) return null;
    return {accession: r.accessionNumber[i], reportDate: r.reportDate[i], filingDate: r.filingDate[i]};
  }
  return null;
}
async function infoTable(cik, accession) {
  const base = `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, '')}`;
  const items = (await sec(`${base}/index.json`)).directory.item;
  const file = items.map(i => i.name).find(n => /\.xml$/i.test(n) && !/primary_doc/i.test(n));
  if (!file) throw new Error('Keine Informationstabelle');
  const xml = await sec(`${base}/${file}`, false), rows = new Map();
  for (const m of xml.matchAll(/<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/g)) {
    const tag = t => { const x = m[1].match(new RegExp(`<(?:\\w+:)?${t}>([^<]*)<`)); return x ? x[1].trim() : ''; };
    if (tag('putCall')) continue;                                   // Optionen auslassen, nur Aktien
    const cusip = tag('cusip').toUpperCase(), value = Number(tag('value')) || 0;
    const x = rows.get(cusip) || {cusip, name: tag('nameOfIssuer'), value: 0}; x.value += value; rows.set(cusip, x);
  }
  return [...rows.values()].sort((a, b) => b.value - a.value);
}
async function tickers(cusips) {
  const todo = cusips.filter(c => { const r = qCusip.get(c); return !r || (!r.ticker && Date.now() - r.checked_at > 30 * 864e5); });
  for (let i = 0; i < todo.length; i += 10) {
    const batch = todo.slice(i, i + 10);
    try {
      const r = await fetch('https://api.openfigi.com/v3/mapping', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(batch.map(c => ({idType: 'ID_CUSIP', idValue: c, exchCode: 'US'}))), signal: AbortSignal.timeout(20000)});
      if (!r.ok) throw new Error('OpenFIGI ' + r.status);
      (await r.json()).forEach((res, k) => {
        const d = (res.data || []).find(x => SYMBOL.test(x.ticker || '')) || null;
        qPutCusip.run(batch[k], d ? d.ticker : null, d ? d.name : null, Date.now());
      });
    } catch (e) { break; }
    await sleep(2600);   // ohne Schlüssel 25 Anfragen pro Minute
  }
  return Object.fromEntries(cusips.map(c => [c, (qCusip.get(c) || {}).ticker || null]));
}

// Musterdepot eines Großinvestors anlegen oder nach neuer Meldung umschichten
async function apply(g, filing, picks) {
  let u = qUser.get(g.cik);
  if (!u) { qInsUser.run(g.person, g.cik, `${g.firm} · ${g.style}`, g.c, Date.now()); u = qUser.get(g.cik); }
  const q = market.get(), hs = [];
  for (const p of picks) {
    if (!market.INSTRUMENTS[p.sym] || !q[p.sym]) { try { await market.add(p.sym, {silent: true}); } catch (e) { continue; } }
    if (market.get()[p.sym]) hs.push({sym: p.sym, dir: 1, w: p.w, p0: market.get()[p.sym].price});
    if (hs.length >= TOP) break;
  }
  if (hs.length < 3) return false;
  const tot = hs.reduce((a, h) => a + h.w, 0); hs.forEach(h => { h.w = Math.round(h.w / tot * 1000) / 10; });
  const source = JSON.stringify({type: '13F', firm: g.firm, ...filing});
  const f = qFund.get(u.id), name = `${g.person} · ${g.firm}`;
  const strategy = `${g.style}. Die ${hs.length} größten Aktienpositionen laut 13F-Meldung an die SEC (Stichtag ${filing.reportDate}).`;
  if (!f) { qInsFund.run(u.id, name, strategy, JSON.stringify(hs), Date.now(), Date.now(), source); return true; }
  const prev = f.source ? JSON.parse(f.source) : {};
  if (prev.accession === filing.accession) return false;
  const nav = funds.navOf(f.id);
  qUpdFund.run(JSON.stringify(hs), nav || 100, Date.now(), source, f.id);
  db.prepare('UPDATE funds SET strategy = ? WHERE id = ?').run(strategy, f.id);
  funds.cache.delete(f.id);
  return true;
}

async function syncOne(g) {
  const filing = await latestFiling(g.cik); if (!filing) return null;
  const u = qUser.get(g.cik), f = u && qFund.get(u.id);
  if (f && f.source && JSON.parse(f.source).accession === filing.accession) return null;
  const rows = (await infoTable(g.cik, filing.accession)).slice(0, 25), tot = rows.reduce((a, r) => a + r.value, 0);
  const map = await tickers(rows.map(r => r.cusip));
  const picks = rows.filter(r => map[r.cusip] && r.value / tot >= .005).map(r => ({sym: map[r.cusip], name: r.name, w: r.value / tot * 100}));
  return {filing, picks};
}

let running = false;
async function sync() {
  if (!config.gurus || running) return;
  running = true;
  const fb = fs.existsSync(FALLBACK) ? JSON.parse(fs.readFileSync(FALLBACK, 'utf8')) : {};
  try {
    for (const g of GURUS) {
      let r = null;
      if (!config.offline) { try { r = await syncOne(g); } catch (e) { console.warn('13F', g.firm, e.message); } }
      // Ohne Netz: mitgelieferte Meldung verwenden, falls noch kein Depot existiert
      const u = qUser.get(g.cik);
      if (!r && fb[g.cik] && !(u && qFund.get(u.id))) r = fb[g.cik];
      if (r) await apply(g, r.filing, r.picks).catch(e => console.warn('13F', g.firm, e.message));
    }
  } finally { running = false; }
}

// Für npm run snapshot: aktuelle Meldungen als Fallback speichern
async function snapshot() {
  const out = {};
  for (const g of GURUS) { try { const r = await syncOne(g); if (r) out[g.cik] = r; } catch (e) { console.warn(g.firm, e.message); } }
  return out;
}
function symbols() {
  const s = new Set();
  for (const f of db.prepare("SELECT holdings FROM funds WHERE kind = 'guru'").all()) for (const h of JSON.parse(f.holdings)) s.add(h.sym);
  return s;
}

module.exports = {sync, snapshot, symbols, GURUS, FALLBACK};
