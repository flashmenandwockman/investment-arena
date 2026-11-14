// Discovery Engine: tägliche Recherche über US-Aktien, deutsche Aktien, ETFs, Rohstoffe und Devisen.
// Nach US-Börsenschluss (22:40 Berlin) werden die Märkte gescannt, Kandidaten je Anlageklasse bewertet (0–100),
// mit Risikoklasse, Begründung („Warum auffällig“) und Handlungsempfehlung („Was Sie tun können“) versehen und
// gespeichert. Die Tracking Engine misst, wie sich frühere Kandidaten seit der Entdeckung entwickelt haben.
// Quellen: Yahoo Finance (Tagesverlierer-Screening USA, Kursverläufe), Finnhub (Fundamentaldaten US-Titel).
// Die Punktzahl ist ein Rankinginstrument, keine Renditeprognose; Simulation zu Lernzwecken.
const db = require('./db');
const config = require('./config');
const market = require('./market');
const finnhub = require('./finnhub');
const U = require('./universe');
const fallback = require('./fallback/research.json');

db.exec(`
CREATE TABLE IF NOT EXISTS research_runs (day TEXT PRIMARY KEY, at INTEGER NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS research_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, cls TEXT NOT NULL, sym TEXT NOT NULL, name TEXT NOT NULL,
  score INTEGER NOT NULL, risk TEXT NOT NULL, price REAL, cur TEXT, first_seen TEXT NOT NULL, json TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '', note_action TEXT NOT NULL DEFAULT '', note_by TEXT NOT NULL DEFAULT '',
  UNIQUE(day, cls, sym)
);
CREATE INDEX IF NOT EXISTS research_cand_sym ON research_candidates(cls, sym, day);
`);
const q = {
  run: db.prepare('SELECT * FROM research_runs WHERE day = ?'),
  lastRun: db.prepare('SELECT * FROM research_runs ORDER BY day DESC LIMIT 1'),
  putRun: db.prepare('INSERT OR REPLACE INTO research_runs (day, at, json) VALUES (?, ?, ?)'),
  firstSeen: db.prepare('SELECT MIN(day) AS d, MIN(price) AS p FROM research_candidates WHERE cls = ? AND sym = ?'),
  firstRow: db.prepare('SELECT day, price, cur, name FROM research_candidates WHERE cls = ? AND sym = ? ORDER BY day LIMIT 1'),
  putCand: db.prepare('INSERT OR REPLACE INTO research_candidates (day, cls, sym, name, score, risk, price, cur, first_seen, json, note, note_action, note_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT note FROM research_candidates WHERE day = ? AND cls = ? AND sym = ?), \'\'), COALESCE((SELECT note_action FROM research_candidates WHERE day = ? AND cls = ? AND sym = ?), \'\'), COALESCE((SELECT note_by FROM research_candidates WHERE day = ? AND cls = ? AND sym = ?), \'\'))'),
  history: db.prepare('SELECT cls, sym, name, cur, MIN(day) AS first_seen, MAX(day) AS last_seen, COUNT(*) AS n FROM research_candidates WHERE day >= ? GROUP BY cls, sym ORDER BY first_seen DESC LIMIT 120'),
  firstPrice: db.prepare('SELECT price, score, risk FROM research_candidates WHERE cls = ? AND sym = ? ORDER BY day LIMIT 1'),
  note: db.prepare('UPDATE research_candidates SET note = ?, note_action = ?, note_by = ?, score = COALESCE(?, score) WHERE day = ? AND cls = ? AND sym = ?'),
  latestOf: db.prepare('SELECT day FROM research_candidates WHERE cls = ? AND sym = ? ORDER BY day DESC LIMIT 1'),
};

const CLASSES = {us: 'US-Aktien', de: 'Deutsche Aktien', etf: 'ETFs', cmd: 'Rohstoffe', fx: 'Devisen', crypto: 'Krypto'};
const RUN_VERSION = 3;   // bei neuer Bewertungslogik erhöhen: der Tageslauf wird dann nach dem Deploy einmal neu gerechnet
const sleep = ms => new Promise(r => setTimeout(r, ms));
const berlinDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit'}).format(d);
const berlinHour = () => { const p = new Intl.DateTimeFormat('de-DE', {timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false}).formatToParts(new Date()); return Number(p.find(x => x.type === 'hour').value) + Number(p.find(x => x.type === 'minute').value) / 60; };
const pc = v => (v == null || !isFinite(v)) ? null : Math.round(v * 1000) / 10;   // Anteil → Prozent mit einer Stelle
const fmtP = v => v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('de-DE', {maximumFractionDigits: 1})} %`;
let state = {at: 0, ok: null, error: '', day: ''};
let cache = null;

async function getJson(url) {
  const r = await fetch(url, {headers: {'User-Agent': 'Mozilla/5.0', Accept: 'application/json'}, signal: AbortSignal.timeout(20_000)});
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

/* ---------- Kursverlauf eines Jahres mit Kennzahlen ---------- */
async function chart(sym) {
  const j = (await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1y&interval=1d`)).chart.result;
  if (!j || !j[0]) return null;
  const m = j[0].meta, qq = j[0].indicators.quote[0];
  const closes = qq.close.filter(c => c != null), vols = (qq.volume || []).filter(v => v != null);
  if (closes.length < 30) return null;
  const price = m.regularMarketPrice || closes.at(-1), at = n => closes.at(-1 - n) || closes[0];
  const r = [], h = closes.slice(-61); for (let i = 1; i < h.length; i++) r.push(Math.log(h[i] / h[i - 1]));
  const mean = r.reduce((a, b) => a + b, 0) / r.length, sd = Math.sqrt(r.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, r.length - 1));
  const hi = m.fiftyTwoWeekHigh || Math.max(...closes), lo = m.fiftyTwoWeekLow || Math.min(...closes), avgVol = vols.slice(-20).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(20, vols.length));
  return {sym, name: m.longName || m.shortName || sym, cur: m.currency, price, d1: price / at(1) - 1, w1: price / at(5) - 1, m1: price / at(21) - 1, m3: price / at(63) - 1, y1: price / closes[0] - 1,
    fromHigh: price / hi - 1, fromLow: price / lo - 1, hi, lo, vol30: sd * Math.sqrt(252), avgVol, turnover: avgVol * price, hist: closes.slice(-60)};
}
// Yahoo quoteSummary braucht ein Sitzungs-Cookie und einen „Crumb“; beides wird eine Stunde zwischengespeichert
let yc = {cookie: '', crumb: '', at: 0};
async function yahooCrumb() {
  if (yc.crumb && Date.now() - yc.at < 3600e3) return yc;
  const r1 = await fetch('https://fc.yahoo.com', {headers: {'User-Agent': 'Mozilla/5.0'}, redirect: 'manual', signal: AbortSignal.timeout(15_000)});
  const cookie = (r1.headers.getSetCookie ? r1.headers.getSetCookie() : [r1.headers.get('set-cookie') || '']).map(c => c.split(';')[0]).filter(Boolean).join('; ');
  const r2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {headers: {'User-Agent': 'Mozilla/5.0', Cookie: cookie}, signal: AbortSignal.timeout(15_000)});
  const crumb = (await r2.text()).trim();
  if (!r2.ok || !crumb || crumb.includes('<')) throw new Error('Yahoo-Crumb nicht erhalten');
  yc = {cookie, crumb, at: Date.now()};
  return yc;
}
async function fundamentals(sym) {
  const {cookie, crumb} = await yahooCrumb();
  const r = await fetch(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=financialData,defaultKeyStatistics,summaryProfile&crumb=${encodeURIComponent(crumb)}`, {headers: {'User-Agent': 'Mozilla/5.0', Cookie: cookie}, signal: AbortSignal.timeout(15_000)});
  if (!r.ok) throw new Error(`quoteSummary ${r.status}`);
  const d = (((await r.json()).quoteSummary || {}).result || [])[0] || {}, f = d.financialData || {}, k = d.defaultKeyStatistics || {}, p = d.summaryProfile || {};
  const g = o => o && o.raw != null ? o.raw : null;
  const pct = v => v == null ? null : v * 100;
  return {revGrowth: pct(g(f.revenueGrowth)), netMargin: pct(g(f.profitMargins)), roe: pct(g(f.returnOnEquity)), debtEq: g(f.debtToEquity) == null ? null : g(f.debtToEquity) / 100, curRatio: g(f.currentRatio),
    fwdPE: g(k.forwardPE), pe: g(k.trailingPE), pb: g(k.priceToBook), industry: p.industry || '', rating: {strong_buy: 'Strong Buy', buy: 'Buy', hold: 'Hold', sell: 'Sell', strong_sell: 'Strong Sell', underperform: 'Underperform'}[f.recommendationKey] || null};
}
async function charts(syms, ms = 140) { const out = {}; for (const s of syms) { try { const c = await chart(s); if (c) out[s] = c; } catch (e) {} await sleep(ms); } return out; }

/* ---------- Bewertung ---------- */
function riskOf(c, f = {}) {
  if ((f.netMargin != null && f.netMargin < 0 && c.fromHigh < -0.5) || (f.mcap != null && f.mcap < 1e9)) return 'spekulativ';
  if (c.vol30 > 0.6 || (f.netMargin != null && f.netMargin < 0)) return 'hoch';
  if (c.vol30 > 0.35) return 'mittel';
  return 'niedrig';
}
// Aktien: 25 Wachstum, 25 Bilanz, 20 Bewertung, 15 Marktposition, 15 Rücksetzer
function scoreStock(c, f) {
  const parts = {};
  const g = f.revGrowth; parts.wachstum = g == null ? 8 : g >= 25 ? 25 : g >= 10 ? 18 : g >= 0 ? 10 : 3;
  let b = 0; if (f.netMargin != null) b += f.netMargin >= 15 ? 10 : f.netMargin >= 5 ? 6 : f.netMargin >= 0 ? 3 : 0; else b += 4;
  if (f.debtEq != null) b += f.debtEq <= 0.5 ? 8 : f.debtEq <= 1.5 ? 5 : 1; else b += 3;
  if (f.curRatio != null) b += f.curRatio >= 1.5 ? 7 : f.curRatio >= 1 ? 4 : 1; else b += 3;
  parts.bilanz = b;
  const pe = f.fwdPE || f.pe; parts.bewertung = pe == null ? 7 : pe <= 0 ? 3 : pe <= 12 ? 20 : pe <= 18 ? 15 : pe <= 25 ? 10 : pe <= 40 ? 5 : 2;
  parts.position = f.roe == null ? 6 : f.roe >= 20 ? 15 : f.roe >= 10 ? 10 : f.roe >= 0 ? 5 : 1;
  parts.ruecksetzer = c.fromHigh <= -0.4 ? 15 : c.fromHigh <= -0.25 ? 11 : c.fromHigh <= -0.15 ? 7 : 3;
  const total = Object.values(parts).reduce((a, x) => a + x, 0);
  return {score: total, parts, fundamentals: f.revGrowth != null || f.netMargin != null || pe != null};
}
// ETFs: Rücksetzer 40, Jahrestrend 20, Schwankung 20, Stabilisierung 20
function scoreEtf(c) {
  const parts = {ruecksetzer: c.fromHigh <= -0.3 ? 40 : c.fromHigh <= -0.2 ? 32 : c.fromHigh <= -0.1 ? 22 : c.fromHigh <= -0.05 ? 10 : 4,
    jahrestrend: c.y1 >= 0.15 ? 20 : c.y1 >= 0 ? 14 : c.y1 >= -0.15 ? 8 : 3, schwankung: c.vol30 <= 0.15 ? 20 : c.vol30 <= 0.25 ? 14 : c.vol30 <= 0.4 ? 8 : 3,
    stabilisierung: c.w1 >= 0 && c.m1 < 0 ? 20 : c.w1 >= -0.01 ? 12 : 5};
  return {score: Object.values(parts).reduce((a, x) => a + x, 0), parts};
}

/* ---------- Texte: Warum auffällig, was tun ---------- */
const PRAXIS = 'Für die Arena: kleine Position, Stop-Loss 10 %, Begründung notieren. Das zählt für den Talent-Score.';
function textStock(c, f, cls) {
  const why = [], act = [];
  why.push(`${fmtP(pc(c.d1))} am Tag, ${fmtP(pc(c.fromHigh))} unter dem 52-Wochen-Hoch`);
  if (f.revGrowth != null) why.push(`Umsatzwachstum ${fmtP(f.revGrowth)}`);
  if (f.netMargin != null) why.push(`Nettomarge ${fmtP(f.netMargin)}`);
  if ((f.fwdPE || f.pe) != null) why.push(`KGV ${(f.fwdPE || f.pe).toLocaleString('de-DE', {maximumFractionDigits: 1})}${f.fwdPE ? ' (erwartet)' : ''}`);
  if (f.rating) why.push(`Analysten: ${f.rating}`);
  if (f.earningsSoon) why.push('Quartalszahlen in den nächsten Tagen');
  if (f.target) why.push('Zielbranche der Recherche');
  const good = f.revGrowth != null && f.revGrowth > 10 && f.netMargin != null && f.netMargin > 5;
  if (f.earningsSoon) act.push('Vor den Zahlen abwarten: Der Kurs kann in beide Richtungen springen.');
  else if (good && c.fromHigh <= -0.25) act.push('Qualität mit Rücksetzer: auf die Watchlist, Einstieg in zwei bis drei Schritten statt auf einmal.');
  else if (good) act.push('Solides Unternehmen nach einem schwachen Tag: beobachten, bei Stabilisierung über dem Tagestief einsteigen.');
  else if (f.netMargin != null && f.netMargin < 0 && c.fromHigh <= -0.4) act.push('Verlustbringer im Abwärtstrend: eher Short-Kandidat als Schnäppchen. Nur mit engem Stop.');
  else act.push('Grund für den Kursrutsch prüfen (Zahlen, Prognose, Branche). Ohne klaren Grund: abwarten, nicht ins fallende Messer greifen.');
  act.push(PRAXIS);
  return {why: why.join(' · '), action: act.join(' ')};
}
function textEtf(c, cat) {
  const why = `${cat}: ${fmtP(pc(c.m1))} im Monat, ${fmtP(pc(c.fromHigh))} unter dem Hoch, ${fmtP(pc(c.y1))} im Jahr`;
  const action = c.fromHigh <= -0.2 && c.y1 >= 0 ? 'Deutlicher Rücksetzer in einem intakten Jahrestrend: Klassischer Fall für einen gestaffelten Einstieg über mehrere Wochen.'
    : c.fromHigh <= -0.2 ? 'Tief gefallen und Jahrestrend negativ: Erst auf eine Bodenbildung warten (zwei Wochen ohne neues Tief), dann in Tranchen.'
    : c.m1 <= -0.06 ? 'Kurzer Rücksetzer: beobachten, ob der Markt die Verluste innerhalb einer Woche aufholt. Für Sparpläne kein Grund zum Aussetzen.'
    : c.y1 >= 0.25 ? 'Starker Trend: nicht hinterherlaufen, Rücksetzer von 5 bis 10 % abwarten.'
    : 'Normale Bewegung, keine Eile. Als Baustein für die Streuung im Blick behalten.';
  return {why, action: action + ' ' + PRAXIS};
}
function textCmd(c, name, cat, related) {
  const big = Math.abs(c.d1) >= 0.02 || Math.abs(c.w1) >= 0.05;
  const why = `${name}: ${fmtP(pc(c.d1))} am Tag, ${fmtP(pc(c.w1))} in der Woche, ${fmtP(pc(c.m3))} in drei Monaten, ${fmtP(pc(c.fromHigh))} unter dem Hoch`;
  let action = c.d1 <= -0.03 ? `Starker Tagesverlust. Betroffen sind Förderer und Zulieferer${related.length ? ` (${related.join(', ')})` : ''}: Dort entstehen Chancen, wenn der Preis sich fängt, und Short-Gelegenheiten, solange er fällt.`
    : c.d1 >= 0.03 ? `Starker Tagesgewinn. Profiteure sind Förderer und Minen${related.length ? ` (${related.join(', ')})` : ''}; prüfen, ob die Bewegung durch Angebot (Förderausfall, Sanktionen) oder Nachfrage getrieben ist.`
    : c.fromHigh <= -0.3 ? 'Weit unter dem Hoch: Rohstoffe laufen in Zyklen, Produktionskosten der Anbieter sind die Untergrenze. Geduldig, in kleinen Schritten.'
    : c.fromHigh >= -0.03 ? 'Nahe am Jahreshoch: Trendfolge möglich, aber Gewinnmitnahmen sind wahrscheinlich. Stop nachziehen.'
    : 'Keine außergewöhnliche Bewegung. Im Auge behalten.';
  if (!big && c.fromHigh > -0.3 && c.fromHigh < -0.03) action = 'Keine außergewöhnliche Bewegung. Im Auge behalten.';
  return {why, action: action + ' In der Arena handelbar über Gold, Öl und die genannten Titel.'};
}
function textFx(c, name) {
  const base = name.slice(0, 3), quote = name.slice(4, 7);
  const dirTxt = c.w1 > 0 ? `${base} stärker gegen ${quote}` : `${base} schwächer gegen ${quote}`;
  const why = `${name}: ${fmtP(pc(c.d1))} am Tag, ${fmtP(pc(c.w1))} in der Woche, ${fmtP(pc(c.m1))} im Monat, ${fmtP(pc(c.fromHigh))} unter dem Jahreshoch`;
  let action = `${dirTxt}. `;
  if (/USD/.test(name) && /EUR|CHF|GBP/.test(name)) action += (name.startsWith('EUR') || name.startsWith('GBP') ? (c.m1 > 0 ? 'Ein schwächerer Dollar drückt den Euro-Wert von US-Aktien und US-ETFs im Depot; europäische Exporteure verlieren Preisvorteil.' : 'Ein stärkerer Dollar hebt den Euro-Wert von US-Aktien im Depot und hilft Exporteuren aus Europa.') : (c.m1 > 0 ? 'Ein stärkerer Dollar belastet Rohstoffe und Schwellenländer, hilft europäischen Exporteuren.' : 'Ein schwächerer Dollar hilft Rohstoffen und Schwellenländern.'));
  if (/CHF/.test(name)) action += ' Der Franken ist die klassische Fluchtwährung: Stärke zeigt Risikoscheu, Schwäche Risikoappetit. Schweizer Exporteure leiden unter starkem Franken.';
  if (/JPY/.test(name)) action += ' Beim Yen entscheidet die Zinsdifferenz: Steigende japanische Zinsen beenden Carry-Trades und können Aktienmärkte weltweit belasten.';
  action += ` Devisen bewegen sich in Zehntelprozent: Hebel nur mit engem Stop, Zinsdifferenz und Notenbanktermine prüfen. ${PRAXIS}`;
  return {why, action};
}

function textCrypto(c, name) {
  const why = `${name}: ${fmtP(pc(c.d1))} am Tag, ${fmtP(pc(c.w1))} in der Woche, ${fmtP(pc(c.m1))} im Monat, ${fmtP(pc(c.fromHigh))} unter dem Jahreshoch, Schwankung ${Math.round(pc(c.vol30))} % p. a.`;
  let action = c.d1 <= -0.05 ? 'Starker Tagesverlust. Krypto fällt meist mit dem Risikoappetit (Nasdaq, Hebelabbau): Nicht ins fallende Messer greifen, auf Stabilisierung über mehrere Tage warten.'
    : c.d1 >= 0.05 ? 'Starker Tagesgewinn. Prüfen, ob eine Nachricht (ETF-Zuflüsse, Regulierung, Notenbank) dahintersteht; ohne Grund sind solche Sprünge oft Short-Squeezes und werden zurückgenommen.'
    : c.fromHigh <= -0.4 ? 'Weit unter dem Hoch. Bitcoin hat jeden Zyklus 50 bis 80 Prozent verloren und sich erholt; Altcoins nicht immer. Nur Kapital einsetzen, dessen Totalverlust verkraftbar ist.'
    : c.fromHigh >= -0.03 ? 'Nahe am Jahreshoch: Trendfolge möglich, aber die Volatilität ist drei- bis fünfmal so hoch wie bei Aktien. Positionsgröße klein, Stop weit genug.'
    : 'Keine außergewöhnliche Bewegung. Im Auge behalten.';
  action += ` Krypto handelt rund um die Uhr, auch am Wochenende: Stop-Loss setzen, Hebel vermeiden. ${PRAXIS}`;
  return {why, action};
}

/* ---------- Screening je Anlageklasse ---------- */
async function screenUS() {
  const j = await getJson('https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=day_losers&count=100');
  const rows = (((j.finance || {}).result || [])[0] || {}).quotes || [];
  const liquid = rows.filter(r => (r.averageDailyVolume3Month || 0) >= 1e6 && (r.averageDailyVolume3Month || 0) * (r.regularMarketPrice || 0) >= 5e7 && (r.marketCap || 0) >= 3e8 && (r.regularMarketPrice || 0) >= 2 && r.quoteType === 'EQUITY')
    .sort((a, b) => a.regularMarketChangePercent - b.regularMarketChangePercent).slice(0, 14);
  // Yahoo liefert Tages- und Jahresänderung in Prozent, den Abstand zum Hoch als Anteil
  const out = [];
  for (const r of liquid) {
    const f = {mcap: r.marketCap, fwdPE: r.forwardPE, pe: r.trailingPE, rating: r.averageAnalystRating ? String(r.averageAnalystRating).replace(/^[\d.]+ - /, '') : null,
      earningsSoon: r.earningsTimestamp ? Math.abs(r.earningsTimestamp * 1000 - Date.now()) < 7 * 86400e3 : false};
    try {
      const m = (await finnhub.get(`stock/metric?symbol=${r.symbol}&metric=all`)).metric || {};
      f.revGrowth = m.revenueGrowthTTMYoy ?? null; f.netMargin = m.netProfitMarginTTM ?? null; f.roe = m.roeTTM ?? null; f.debtEq = m['totalDebt/totalEquityAnnual'] ?? null; f.curRatio = m.currentRatioAnnual ?? null; f.beta = m.beta ?? null;
      if (f.pe == null) f.pe = m.peTTM ?? null;
    } catch (e) {}
    try { const p = await finnhub.get(`stock/profile2?symbol=${r.symbol}`); f.industry = p.finnhubIndustry || ''; } catch (e) {}
    f.target = U.TARGET.test(`${f.industry || ''} ${r.longName || ''}`);
    const c = {sym: r.symbol, name: r.longName || r.shortName || r.symbol, cur: r.currency || 'USD', price: r.regularMarketPrice, d1: r.regularMarketChangePercent / 100, w1: null, m1: null, m3: null,
      y1: (r.fiftyTwoWeekChangePercent || 0) / 100, fromHigh: r.fiftyTwoWeekHighChangePercent || 0, fromLow: r.fiftyTwoWeekLowChangePercent || 0, vol30: f.beta ? Math.min(1.2, 0.25 * f.beta) : 0.4, avgVol: r.averageDailyVolume3Month, turnover: r.averageDailyVolume3Month * r.regularMarketPrice};
    const sc = scoreStock(c, f), t = textStock(c, f, 'us');
    out.push({cls: 'us', sym: c.sym, name: c.name, cur: c.cur, price: c.price, score: sc.score + (f.target ? 3 : 0), parts: sc.parts, risk: riskOf(c, f), fundamentals: sc.fundamentals, metrics: {d1: pc(c.d1), y1: pc(c.y1), fromHigh: pc(c.fromHigh), mcap: f.mcap, fwdPE: f.fwdPE, pe: f.pe, revGrowth: f.revGrowth, netMargin: f.netMargin, roe: f.roe, debtEq: f.debtEq, industry: f.industry, rating: f.rating, turnover: c.turnover}, ...t, tradable: true});
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}
async function screenDE(cache) {
  const cs = await charts(U.DE);
  Object.assign(cache, cs);
  const liquid = Object.values(cs).filter(c => c.turnover >= 5e6);
  const losers = liquid.filter(c => c.d1 <= -0.02).sort((a, b) => a.d1 - b.d1).slice(0, 10);
  const fallen = liquid.filter(c => c.fromHigh <= -0.35 && !losers.includes(c)).sort((a, b) => a.fromHigh - b.fromHigh).slice(0, 4);
  const out = [];
  for (const c of [...losers, ...fallen]) {
    let f = {};
    try { f = await fundamentals(c.sym); await sleep(200); } catch (e) {}
    f.target = U.TARGET.test(`${f.industry || ''} ${c.name}`);
    const sc = scoreStock(c, f), t = textStock(c, f, 'de');
    out.push({cls: 'de', sym: c.sym, name: c.name, cur: c.cur, price: c.price, score: Math.min(100, sc.score + (f.target ? 3 : 0)), parts: sc.parts, risk: riskOf(c, f), fundamentals: sc.fundamentals,
      metrics: {d1: pc(c.d1), w1: pc(c.w1), m1: pc(c.m1), y1: pc(c.y1), fromHigh: pc(c.fromHigh), vol30: pc(c.vol30), turnover: c.turnover, revGrowth: f.revGrowth, netMargin: f.netMargin, roe: f.roe, debtEq: f.debtEq, fwdPE: f.fwdPE, pe: f.pe, industry: f.industry, rating: f.rating}, ...t, tradable: !!market.INSTRUMENTS[c.sym]});
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}
async function screenETF(cache) {
  const cs = await charts(Object.keys(U.ETF));
  Object.assign(cache, cs);
  const all = Object.values(cs).map(c => { const [name, cat] = U.ETF[c.sym]; const sc = scoreEtf(c), t = textEtf(c, name); return {cls: 'etf', sym: c.sym, name, cat, cur: c.cur, price: c.price, score: sc.score, parts: sc.parts, risk: c.vol30 > 0.35 ? 'hoch' : c.vol30 > 0.2 ? 'mittel' : 'niedrig', metrics: {d1: pc(c.d1), w1: pc(c.w1), m1: pc(c.m1), m3: pc(c.m3), y1: pc(c.y1), fromHigh: pc(c.fromHigh), vol30: pc(c.vol30)}, ...t, tradable: true}; });
  const interesting = all.filter(x => x.metrics.fromHigh <= -8 || x.metrics.m1 <= -5 || x.metrics.y1 >= 30).sort((a, b) => b.score - a.score).slice(0, 4);
  // Trends: Durchschnitt je Kategorie
  const cats = {};
  for (const x of all) { const g = cats[x.cat] || (cats[x.cat] = {cat: x.cat, n: 0, m1: 0, y1: 0, fromHigh: 0, syms: []}); g.n++; g.m1 += x.metrics.m1; g.y1 += x.metrics.y1; g.fromHigh += x.metrics.fromHigh; g.syms.push(x.sym); }
  const trends = Object.values(cats).map(g => ({cat: g.cat, m1: Math.round(g.m1 / g.n * 10) / 10, y1: Math.round(g.y1 / g.n * 10) / 10, fromHigh: Math.round(g.fromHigh / g.n * 10) / 10, syms: g.syms})).sort((a, b) => Math.abs(b.m1) - Math.abs(a.m1));
  return {cands: interesting, trends, all};
}
async function screenCMD(cache) {
  const cs = await charts(Object.keys(U.CMD));
  Object.assign(cache, cs);
  return Object.values(cs).map(c => { const [name, cat, related] = U.CMD[c.sym]; const t = textCmd(c, name, cat, related);
    const score = Math.min(100, Math.round(30 + Math.min(40, Math.abs(c.w1) * 400) + Math.min(30, Math.abs(c.fromHigh) * 60)));
    return {cls: 'cmd', sym: c.sym, name, cat, related, cur: c.cur, price: c.price, score, risk: c.vol30 > 0.4 ? 'hoch' : c.vol30 > 0.2 ? 'mittel' : 'niedrig', metrics: {d1: pc(c.d1), w1: pc(c.w1), m1: pc(c.m1), m3: pc(c.m3), y1: pc(c.y1), fromHigh: pc(c.fromHigh), vol30: pc(c.vol30)}, ...t, tradable: !!market.INSTRUMENTS[c.sym], notable: Math.abs(c.d1) >= 0.02 || Math.abs(c.w1) >= 0.05 || c.fromHigh <= -0.3 || c.fromHigh >= -0.03}; })
    .filter(x => x.notable).sort((a, b) => Math.abs(b.metrics.w1) - Math.abs(a.metrics.w1)).slice(0, 4);
}
async function screenFX(cache) {
  const cs = await charts(U.FX);
  Object.assign(cache, cs);
  return Object.values(cs).map(c => { const name = (market.INSTRUMENTS[c.sym] || {}).n || c.sym.replace('=X', '').replace(/(...)(...)/, '$1/$2'); const t = textFx(c, name);
    const score = Math.min(100, Math.round(30 + Math.min(40, Math.abs(c.m1) * 800) + Math.min(30, Math.abs(c.w1) * 1500)));
    return {cls: 'fx', sym: c.sym, name, cur: c.cur, price: c.price, score, risk: 'hoch (Hebel)', metrics: {d1: pc(c.d1), w1: pc(c.w1), m1: pc(c.m1), m3: pc(c.m3), y1: pc(c.y1), fromHigh: pc(c.fromHigh), fromLow: pc(c.fromLow)}, ...t, tradable: !!market.INSTRUMENTS[c.sym], notable: Math.abs(c.w1) >= 0.01 || Math.abs(c.m1) >= 0.025 || c.fromHigh >= -0.005 || c.fromLow <= 0.005}; })
    .filter(x => x.notable).sort((a, b) => Math.abs(b.metrics.w1) - Math.abs(a.metrics.w1)).slice(0, 3);
}

async function screenCrypto(cache) {
  const cs = await charts(Object.keys(U.CRYPTO));
  Object.assign(cache, cs);
  return Object.values(cs).map(c => { const [name, arena] = U.CRYPTO[c.sym]; const t = textCrypto(c, name);
    const score = Math.min(100, Math.round(25 + Math.min(40, Math.abs(c.w1) * 250) + Math.min(20, Math.abs(c.fromHigh) * 40) + (c.sym === 'BTC-EUR' || c.sym === 'ETH-EUR' ? 15 : 5)));
    return {cls: 'crypto', sym: arena, ysym: c.sym, name, cur: c.cur, price: c.price, score, risk: c.vol30 > 0.8 ? 'spekulativ' : 'hoch', metrics: {d1: pc(c.d1), w1: pc(c.w1), m1: pc(c.m1), m3: pc(c.m3), y1: pc(c.y1), fromHigh: pc(c.fromHigh), vol30: pc(c.vol30)}, ...t, tradable: !!market.INSTRUMENTS[arena], notable: Math.abs(c.d1) >= 0.04 || Math.abs(c.w1) >= 0.08 || c.fromHigh <= -0.4 || c.fromHigh >= -0.03}; })
    .filter(x => x.notable).sort((a, b) => Math.abs(b.metrics.w1) - Math.abs(a.metrics.w1)).slice(0, 4);
}

/* ---------- Tracking: Entwicklung früherer Kandidaten ---------- */
async function track(cache, today) {
  const hist = q.history.all(berlinDay(new Date(Date.now() - 365 * 86400e3)));
  const out = []; let fetched = 0;
  for (const h of hist) {
    if (h.first_seen === today) continue;
    const first = q.firstPrice.get(h.cls, h.sym); if (!first || !first.price) continue;
    const ysym = h.cls === 'crypto' ? h.sym.replace('/', '-') : h.sym;   // Krypto: Arena-Kürzel BTC/EUR, bei Yahoo BTC-EUR
    let c = cache[ysym];
    if (!c && fetched < 60) { try { c = await chart(ysym); fetched++; await sleep(140); } catch (e) {} }
    if (!c) continue;
    const days = Math.round((Date.parse(today) - Date.parse(h.first_seen)) / 86400e3);
    out.push({cls: h.cls, sym: h.sym, name: h.name, firstSeen: h.first_seen, days, p0: first.price, price: c.price, cur: h.cur, perf: c.price / first.price - 1, score: first.score, risk: first.risk});
  }
  const stats = {};
  for (const t of out) { const s = stats[t.cls] || (stats[t.cls] = {n: 0, pos: 0, sum: 0}); s.n++; if (t.perf > 0) s.pos++; s.sum += t.perf; }
  for (const k in stats) { stats[k].hit = stats[k].pos / stats[k].n; stats[k].avg = stats[k].sum / stats[k].n; }
  return {items: out.sort((a, b) => b.perf - a.perf), stats};
}

/* ---------- Tageslauf ---------- */
async function run(force = false) {
  const today = berlinDay();
  if (!force && q.run.get(today)) return load();
  if (config.offline) return load();
  const started = Date.now(), cacheC = {}, errors = [];
  const safe = async (fn, name) => { try { return await fn(); } catch (e) { errors.push(`${name}: ${e.message}`); return null; } };
  const us = (await safe(() => screenUS(), 'us')) || [];
  const de = (await safe(() => screenDE(cacheC), 'de')) || [];
  const etf = (await safe(() => screenETF(cacheC), 'etf')) || {cands: [], trends: []};
  const crypto = (await safe(() => screenCrypto(cacheC), 'crypto')) || [];
  const cmd = (await safe(() => screenCMD(cacheC), 'cmd')) || [];
  const fx = (await safe(() => screenFX(cacheC), 'fx')) || [];
  const classes = {us, de, etf: etf.cands, cmd, fx, crypto};
  for (const [cls, list] of Object.entries(classes)) for (const x of list) {
    const first = q.firstRow.get(cls, x.sym);
    x.firstSeen = first ? first.day : today; x.isNew = !first;
    q.putCand.run(today, cls, x.sym, x.name, x.score, x.risk, x.price, x.cur, x.firstSeen, JSON.stringify(x), today, cls, x.sym, today, cls, x.sym, today, cls, x.sym);
  }
  const tracking = (await safe(() => track(cacheC, today), 'track')) || {items: [], stats: {}};
  const result = {day: today, at: Date.now(), version: RUN_VERSION, durationMs: Date.now() - started, classes, trends: etf.trends, tracking, errors, counts: Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, v.length]))};
  q.putRun.run(today, result.at, JSON.stringify(result));
  cache = null; state = {at: Date.now(), ok: errors.length < 5, error: errors.join('; '), day: today};
  return load();
}

// Der Tageslauf startet nach US-Börsenschluss (22:40 Berlin), sonst beim ersten Start ohne Daten
async function tick() {
  const today = berlinDay();
  const cur = q.run.get(today);
  if (cur) { if ((JSON.parse(cur.json).version || 1) !== RUN_VERSION) await run(true); return; }   // Lauf von älterer Logik: neu rechnen
  const last = q.lastRun.get();
  if (!last || berlinHour() >= 22.67) await run();
}

function withNotes(result) {
  // Hinweise aus dem Admin-Bereich (z. B. tägliche Einordnung) an die Kandidaten hängen
  for (const [cls, list] of Object.entries(result.classes || {})) for (const x of list) {
    const row = db.prepare('SELECT note, note_action, note_by, score FROM research_candidates WHERE day = ? AND cls = ? AND sym = ?').get(result.day, cls, x.sym);
    if (row && (row.note || row.note_action)) { x.note = row.note; x.noteAction = row.note_action; x.noteBy = row.note_by; x.score = row.score; }
  }
  return result;
}
function load() {
  if (cache) return cache;
  const last = q.lastRun.get();
  const r = last ? withNotes(JSON.parse(last.json)) : {...fallback, fallback: true};
  cache = {...r, classNames: CLASSES, status: state};
  return cache;
}
function addNote(u, day, cls, sym, note, action, score) {
  const d = day || load().day; const clean = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 800);
  const r = q.note.run(clean(note), clean(action), u.name || 'Admin', score == null ? null : Math.max(0, Math.min(100, Math.round(Number(score)))), d, cls, sym);
  if (!r.changes) throw Object.assign(new Error('Kandidat nicht gefunden'), {status: 404});
  cache = null;
}

module.exports = {run, tick, load, addNote, scoreStock, scoreEtf, textStock, textFx, textCrypto, screenCrypto, fundamentals, CLASSES, status: () => state};
