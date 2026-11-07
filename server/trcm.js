// TRCM-Portfolio: Musterdepot des Analystenteams von Florian Homm.
// Gepflegt über den Admin-Zugang (Titel hinzufügen, korrigieren, schließen, löschen).
// Die Wertentwicklung ist für alle sichtbar, die gehaltenen Titel nur für Free-Homes-Mitglieder und Admins.
const db = require('./db');
const market = require('./market');

db.exec(`
CREATE TABLE IF NOT EXISTS trcm_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trcm_holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sym TEXT NOT NULL,
  dir INTEGER NOT NULL DEFAULT 1,          -- 1 = long, -1 = short
  w REAL NOT NULL,                         -- Gewichtung in %
  p0 REAL NOT NULL,                        -- Einstiegskurs
  since INTEGER NOT NULL,                  -- Einstiegsdatum
  note TEXT NOT NULL DEFAULT '',
  closed_at INTEGER,                       -- gesetzt = Position geschlossen
  p1 REAL                                  -- Ausstiegskurs
);
CREATE TABLE IF NOT EXISTS trcm_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL, user_id INTEGER, user_name TEXT, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT ''
);
`);

const DEFAULTS = {name: 'TRCM Portfolio', team: 'Analystenteam von Florian Homm',
  strategy: 'Das Musterdepot des TRCM-Analystenteams. Long und short, aktiv gemanagt.'};
// Frühere Standardtexte mit Florians Namen durch die neuen ersetzen
const OLD = {team: 'Florian Homm & Analystenteam', strategy: 'Das Musterdepot von Florian Homm und dem TRCM-Analystenteam. Long und short, aktiv gemanagt.'};
const qMeta = db.prepare('SELECT v FROM trcm_meta WHERE k = ?');
const qSetMeta = db.prepare('INSERT INTO trcm_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v');
const meta = k => { const r = qMeta.get(k); return r && r.v !== OLD[k] ? r.v : DEFAULTS[k]; };

const qOpen = db.prepare('SELECT * FROM trcm_holdings WHERE closed_at IS NULL ORDER BY w DESC, id');
const qClosed = db.prepare('SELECT * FROM trcm_holdings WHERE closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 100');
const qOne = db.prepare('SELECT * FROM trcm_holdings WHERE id = ?');
const qIns = db.prepare('INSERT INTO trcm_holdings (sym, dir, w, p0, since, note) VALUES (?, ?, ?, ?, ?, ?)');
const qUpd = db.prepare('UPDATE trcm_holdings SET dir = ?, w = ?, p0 = ?, since = ?, note = ?, p1 = ? WHERE id = ?');
const qClose = db.prepare('UPDATE trcm_holdings SET closed_at = ?, p1 = ? WHERE id = ?');
const qDel = db.prepare('DELETE FROM trcm_holdings WHERE id = ?');
const qLog = db.prepare('INSERT INTO trcm_log (ts, user_id, user_name, action, detail) VALUES (?, ?, ?, ?, ?)');
const qLogs = db.prepare('SELECT * FROM trcm_log ORDER BY id DESC LIMIT 60');

const err = (msg, status = 400) => Object.assign(new Error(msg), {status});
const isAdmin = u => !!u && u.role === 'admin';
const isMember = u => !!u && (u.provider === 'freehomes' || isAdmin(u));
const name = sym => (market.INSTRUMENTS[sym] || {}).n || sym;

// Symbole, deren Kurse der Server für das Portfolio holen muss (nicht öffentlich gelistet)
function symbols() { return new Set(qOpen.all().map(h => h.sym)); }

function rowView(h, q) {
  const p = q[h.sym], price = h.closed_at ? h.p1 : p && p.price;
  return {id: h.id, sym: h.sym, name: name(h.sym), dir: h.dir, w: h.w, p0: h.p0, since: h.since, note: h.note,
    price: price || null, cur: p ? p.cur : null, perf: price ? h.dir * (price / h.p0 - 1) : null,
    day: !h.closed_at && p && p.prev ? h.dir * (p.price / p.prev - 1) : null, closedAt: h.closed_at || null};
}

function view(user) {
  const q = market.get(), open = qOpen.all().map(h => rowView(h, q));
  // Gewichte in % des Portfolios; nicht investierter Teil ist Barreserve (Rendite 0).
  // Summieren sich die Gewichte über 100 %, wird anteilig gerechnet.
  const tw = open.reduce((a, h) => a + h.w, 0), base = Math.max(100, tw);
  let sum = 0, daySum = 0;
  for (const h of open) if (h.perf != null) { sum += h.w * h.perf; daySum += h.w * (h.day || 0); }
  const out = {name: meta('name'), team: meta('team'), strategy: meta('strategy'), perf: sum / base, day: daySum / base,
    count: open.length, member: isMember(user), admin: isAdmin(user)};
  if (out.member) {
    out.cash = 1 - tw / base;
    out.holdings = open.map(h => ({...h, share: h.w / base}));
    out.closed = qClosed.all().map(h => rowView(h, q));
  }
  if (out.admin) out.log = qLogs.all().map(l => ({ts: l.ts, user: l.user_name, action: l.action, detail: l.detail}));
  return out;
}

/* ---------- Pflege (nur Admins) ---------- */
function requireAdmin(u) { if (!isAdmin(u)) throw err('Nur für Admins', 403); }
function log(u, action, detail) { qLog.run(Date.now(), u.id, u.name, action, detail); }
function num(v, label, min, max) {
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) throw err(`${label}: bitte einen Wert zwischen ${min} und ${max} angeben`);
  return n;
}
function date(v, fallback) {
  if (v == null || v === '') return fallback;
  const t = typeof v === 'number' ? v : Date.parse(v);
  if (!Number.isFinite(t) || t > Date.now() + 864e5 || t < Date.parse('2000-01-01')) throw err('Ungültiges Datum');
  return t;
}
const desc = h => `${h.dir > 0 ? 'Long' : 'Short'} ${name(h.sym)} (${h.sym}), ${h.w} %, Einstieg ${h.p0}`;

async function addHolding(u, b) {
  requireAdmin(u);
  const sym = String(b.sym || '').trim().toUpperCase();
  if (!market.INSTRUMENTS[sym] || !market.get()[sym]) await market.add(sym, {silent: true});
  if (qOpen.all().some(h => h.sym === sym)) throw err('Dieser Titel ist bereits im Portfolio. Bitte die bestehende Position bearbeiten.');
  const price = market.get()[sym] && market.get()[sym].price;
  const h = {sym, dir: Number(b.dir) === -1 ? -1 : 1, w: num(b.w, 'Gewichtung', 0.1, 100),
    p0: b.p0 == null || b.p0 === '' ? price : num(b.p0, 'Einstiegskurs', 1e-6, 1e9), since: date(b.since, Date.now()), note: String(b.note || '').trim().slice(0, 300)};
  if (!h.p0) throw err('Für diesen Titel gibt es keinen Kurs');
  const id = Number(qIns.run(h.sym, h.dir, h.w, h.p0, h.since, h.note).lastInsertRowid);
  log(u, 'Hinzugefügt', desc(h));
  return id;
}
function updateHolding(u, id, b) {
  requireAdmin(u);
  const h = qOne.get(id); if (!h) throw err('Position nicht gefunden', 404);
  const n = {...h,
    dir: b.dir == null ? h.dir : Number(b.dir) === -1 ? -1 : 1,
    w: b.w == null ? h.w : num(b.w, 'Gewichtung', 0.1, 100),
    p0: b.p0 == null ? h.p0 : num(b.p0, 'Einstiegskurs', 1e-6, 1e9),
    since: date(b.since, h.since),
    note: b.note == null ? h.note : String(b.note).trim().slice(0, 300),
    p1: h.closed_at && b.p1 != null ? num(b.p1, 'Ausstiegskurs', 1e-6, 1e9) : h.p1};
  qUpd.run(n.dir, n.w, n.p0, n.since, n.note, n.p1, id);
  const ch = [];
  if (n.dir !== h.dir) ch.push(`Richtung ${h.dir > 0 ? 'Long' : 'Short'} → ${n.dir > 0 ? 'Long' : 'Short'}`);
  if (n.w !== h.w) ch.push(`Gewichtung ${h.w} → ${n.w} %`);
  if (n.p0 !== h.p0) ch.push(`Einstieg ${h.p0} → ${n.p0}`);
  if (n.since !== h.since) ch.push(`Datum ${new Date(h.since).toISOString().slice(0, 10)} → ${new Date(n.since).toISOString().slice(0, 10)}`);
  if (n.p1 !== h.p1) ch.push(`Ausstieg ${h.p1} → ${n.p1}`);
  if (n.note !== h.note) ch.push('Notiz geändert');
  if (ch.length) log(u, 'Korrigiert', `${name(h.sym)}: ${ch.join(', ')}`);
}
function closeHolding(u, id, b) {
  requireAdmin(u);
  const h = qOne.get(id); if (!h || h.closed_at) throw err('Offene Position nicht gefunden', 404);
  const q = market.get()[h.sym];
  const p1 = b.p1 == null || b.p1 === '' ? q && q.price : num(b.p1, 'Ausstiegskurs', 1e-6, 1e9);
  if (!p1) throw err('Kein aktueller Kurs, bitte Ausstiegskurs angeben');
  qClose.run(Date.now(), p1, id);
  log(u, 'Verkauft', `${name(h.sym)} zu ${p1} (${(h.dir * (p1 / h.p0 - 1) * 100).toFixed(1)} %)`);
}
function deleteHolding(u, id) {
  requireAdmin(u);
  const h = qOne.get(id); if (!h) throw err('Position nicht gefunden', 404);
  qDel.run(id);
  log(u, 'Gelöscht', desc(h));
}
function updateMeta(u, b) {
  requireAdmin(u);
  for (const k of ['name', 'team', 'strategy']) if (b[k] != null) {
    const v = String(b[k]).trim().slice(0, k === 'strategy' ? 600 : 60);
    if (v.length < 2) throw err('Bitte einen Text angeben');
    if (v !== meta(k)) { qSetMeta.run(k, v); log(u, 'Beschreibung', `${k} geändert`); }
  }
}

module.exports = {view, symbols, isAdmin, isMember, addHolding, updateHolding, closeHolding, deleteHolding, updateMeta};
