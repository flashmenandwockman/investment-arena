// Insiderkäufe und -verkäufe marktweit aus den Originalmeldungen der SEC (Formular 4), alle 30 Minuten.
// Quelle: der EDGAR-Feed der neuesten Form-4-Meldungen, je Meldung die XML-Datei mit Käufer, Titel, Stückzahl und Preis.
// Kostenlos, ohne API-Schlüssel; die SEC verlangt einen User-Agent mit Kontakt (SEC_USER_AGENT) und höchstens 10 Abrufe pro Sekunde.
const db = require('./db');
const config = require('./config');
const market = require('./market');
const fallback = require('./fallback/insiders.json');

db.exec(`
CREATE TABLE IF NOT EXISTS insider_tx (
  acc TEXT PRIMARY KEY,                 -- Accession-Nummer der Meldung
  sym TEXT NOT NULL, issuer TEXT NOT NULL, owner TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL,                   -- P = Kauf am Markt, S = Verkauf am Markt
  shares REAL NOT NULL, price REAL NOT NULL, value REAL NOT NULL,
  tdate TEXT NOT NULL, filed_at INTEGER NOT NULL, url TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS insider_tx_filed ON insider_tx(filed_at DESC);
CREATE TABLE IF NOT EXISTS insider_seen (acc TEXT PRIMARY KEY, at INTEGER NOT NULL);
`);
const q = {
  seen: db.prepare('SELECT 1 FROM insider_seen WHERE acc = ?'),
  markSeen: db.prepare('INSERT OR IGNORE INTO insider_seen (acc, at) VALUES (?, ?)'),
  ins: db.prepare('INSERT OR REPLACE INTO insider_tx (acc, sym, issuer, owner, title, code, shares, price, value, tdate, filed_at, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  latest: db.prepare('SELECT * FROM insider_tx WHERE filed_at > ? ORDER BY filed_at DESC LIMIT 400'),
  bySym: db.prepare('SELECT * FROM insider_tx WHERE sym = ? AND filed_at > ? ORDER BY filed_at DESC LIMIT 10'),
  prune: db.prepare('DELETE FROM insider_tx WHERE filed_at < ?'),
  pruneSeen: db.prepare('DELETE FROM insider_seen WHERE at < ?'),
};
const FEED = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&count=100&output=atom';
const MIN_BUY = 25_000, MIN_SELL = 250_000;
let state = {at: 0, ok: null, added: 0, error: ''};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${t}>`, 'i')); return m ? m[1] : ''; };
const val = (xml, t) => { const inner = tag(xml, t); return strip(tag(inner, 'value') || inner); };

async function sec(url) {
  const r = await fetch(url, {headers: {'User-Agent': config.secUserAgent, 'Accept-Encoding': 'gzip, deflate'}, signal: AbortSignal.timeout(20_000)});
  if (!r.ok) throw new Error(`SEC ${r.status}`);
  return r.text();
}

// SEC schreibt „STERNLICHT BARRY S“: lesbar als „Barry S. Sternlicht“ (Nachname zuerst nur bei Großschreibung)
function niceName(n) {
  if (!n || n !== n.toUpperCase() || /\b(LLC|LP|INC|TRUST|FUND|CAPITAL|PARTNERS|HOLDINGS|MANAGEMENT|GROUP|CORP)\b/.test(n)) return n;
  const parts = n.replace(/,/g, '').split(/\s+/).map(w => w.length === 1 ? w + '.' : w.charAt(0) + w.slice(1).toLowerCase().replace(/^(mc|mac|o')(\w)/i, (m, a, b) => a + b.toUpperCase()));
  return parts.length > 1 ? parts.slice(1).concat(parts[0]).join(' ') : parts[0];
}
// Eine Form-4-Meldung → je Transaktionsart (Kauf/Verkauf am Markt) eine Zeile mit Summe
function parseForm4(xml) {
  const issuer = strip(tag(xml, 'issuerName')), sym = strip(tag(xml, 'issuerTradingSymbol')).toUpperCase();
  const owner = niceName(strip(tag(xml, 'rptOwnerName'))), rel = tag(xml, 'reportingOwnerRelationship');
  const title = strip(tag(rel, 'officerTitle')) || (/<isDirector>\s*(1|true)/i.test(rel) ? 'Director' : /<isTenPercentOwner>\s*(1|true)/i.test(rel) ? 'Großaktionär' : 'Insider');
  const out = {};
  for (const b of xml.match(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/gi) || []) {
    const code = strip(tag(tag(b, 'transactionCoding'), 'transactionCode')).toUpperCase();
    if (code !== 'P' && code !== 'S') continue;
    const shares = Number(val(b, 'transactionShares')), price = Number(val(b, 'transactionPricePerShare')), date = val(b, 'transactionDate');
    if (!(shares > 0) || !(price > 0)) continue;
    const o = out[code] || (out[code] = {code, shares: 0, value: 0, tdate: date});
    o.shares += shares; o.value += shares * price; if (date > o.tdate) o.tdate = date;
  }
  return Object.values(out).map(o => ({...o, sym, issuer, owner, title, price: o.value / o.shares}));
}

async function sync() {
  if (config.offline) return state;
  try {
    const feed = await sec(FEED), now = Date.now();
    const links = [...new Set([...feed.matchAll(/href="(https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/\d+\/\d+)\/[^"]*-index\.htm"/g)].map(m => m[1]))];
    let added = 0, fetched = 0;
    for (const dir of links) {
      const acc = dir.split('/').pop();
      if (q.seen.get(acc)) continue;
      q.markSeen.run(acc, now);
      if (fetched >= 60) continue;   // der Rest kommt im nächsten Durchlauf
      try {
        await sleep(130);
        const idx = JSON.parse(await sec(`${dir}/index.json`));
        const file = (idx.directory.item || []).map(i => i.name).find(n => /\.xml$/i.test(n) && !/xsl/i.test(n));
        if (!file) continue;
        await sleep(130); fetched++;
        const rows = parseForm4(await sec(`${dir}/${file}`));
        for (const r of rows) {
          if (!r.sym || (r.code === 'P' && r.value < MIN_BUY) || (r.code === 'S' && r.value < MIN_SELL)) continue;
          q.ins.run(`${acc}-${r.code}`, r.sym, r.issuer, r.owner, r.title, r.code, r.shares, r.price, r.value, r.tdate, now, `${dir}/${file}`); added++;
        }
      } catch (e) {}
    }
    q.prune.run(now - 14 * 86400e3); q.pruneSeen.run(now - 3 * 86400e3);
    state = {at: now, ok: true, added, checked: links.length, error: ''};
  } catch (e) { state = {at: Date.now(), ok: false, added: 0, error: e.message}; }
  return state;
}

const view = r => ({acc: r.acc, sym: r.sym, issuer: r.issuer, owner: r.owner, title: r.title, code: r.code, shares: r.shares, price: r.price, value: r.value, date: r.tdate, filed: r.filed_at, url: r.url, known: !!market.INSTRUMENTS[r.sym]});
// Die größten Käufe und Verkäufe der letzten 7 Tage, Käufe zuerst
function latest(n = 30) {
  const rows = q.latest.all(Date.now() - 7 * 86400e3);
  const list = rows.length ? rows.map(view) : (fallback.items || []);
  const buys = list.filter(x => x.code === 'P').sort((a, b) => b.value - a.value), sells = list.filter(x => x.code === 'S').sort((a, b) => b.value - a.value);
  return {buys: buys.slice(0, n), sells: sells.slice(0, Math.ceil(n / 2)), live: rows.length > 0, ...state};
}
function forSymbol(sym) { return q.bySym.all(String(sym).toUpperCase(), Date.now() - 14 * 86400e3).map(view); }
function snapshot() { const l = latest(30); return {items: [...l.buys, ...l.sells]}; }

module.exports = {sync, latest, forSymbol, parseForm4, niceName, snapshot, status: () => state};
