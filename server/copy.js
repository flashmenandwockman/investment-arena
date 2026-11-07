// Copy Trading: Mitglieder kopieren andere Arena-Trader.
// Beim Start werden alle offenen Positionen des Vorbilds anteilig übernommen, danach jede neue Order
// und jedes Schließen automatisch nachgebildet. Kopien laufen über ein eigenes Guthaben im Depot.
// Kennzahlen für „Anleger entdecken“: Rendite über 1 Woche und 1 Monat, Risikowert 1–7, größter Rückgang, Kopierer.
const db = require('./db');
const config = require('./config');
const game = require('./game');
const store = require('./store');
const funds = require('./funds');

const MIN = 500, MAX_COPIES = 5;
const err = (m, status = 400) => Object.assign(new Error(m), {status});
const qUser = db.prepare('SELECT * FROM users WHERE id = ?');

const copyEquity = (st, c) => c.cash + st.pos.filter(p => p.copyId === c.id).reduce((a, p) => a + game.value(p, 'now', funds.navOf), 0);

// Eine Position des Vorbilds mit dem Einsatz `stake` im Kopier-Guthaben nachbilden
function mirror(st, c, lp, stake) {
  stake = Math.floor(Math.min(stake, c.cash));
  if (stake < 10) return;
  if (lp.kind === 'fund') {
    const nav = funds.navOf(lp.fundId); if (!nav) return;
    c.cash -= stake;
    st.pos.push({id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), kind: 'fund', fundId: lp.fundId, fundName: lp.fundName, fundKind: lp.fundKind,
      dir: 1, stake, units: stake / nav, entry: nav, openedTs: Date.now(), copyId: c.id, src: lp.id});
    return;
  }
  try {
    game.open(st, {sym: lp.sym, dir: lp.dir, kind: lp.kind, lev: lp.lev, sl: lp.sl, strike: lp.strike, expiryTs: lp.expiryTs, amt: stake}, funds.navOf, {copy: c, src: lp.id});
  } catch (e) { /* z. B. kein Kurs: Position wird ausgelassen */ }
}

function start(userId, leaderId, amt) {
  leaderId = Number(leaderId); amt = Math.floor(Number(amt) || 0);
  const leader = qUser.get(leaderId);
  if (!leader) throw err('Trader nicht gefunden', 404);
  if (leaderId === userId) throw err('Sich selbst kann man nicht kopieren');
  const st = store.load(userId);
  st.copies = st.copies || [];
  if (st.copies.some(c => c.leaderId === leaderId)) throw err(`Sie kopieren ${leader.name} bereits`);
  if (st.copies.length >= MAX_COPIES) throw err(`Höchstens ${MAX_COPIES} Anleger gleichzeitig kopieren`);
  if (amt < MIN) throw err(`Mindestbetrag zum Kopieren: ${MIN} €`);
  if (amt > st.cash + .01) throw err('Nicht genug verfügbares Spielgeld');
  const L = store.load(leaderId), E = game.equity(L, 'now', funds.navOf);
  const c = {id: 'c' + Date.now().toString(36), leaderId, leaderName: leader.name, cash: amt, amt, ts: Date.now()};
  st.cash -= amt; st.copies.push(c);
  // Nur eigene Positionen des Vorbilds, keine Kopien von Kopien
  for (const lp of L.pos.filter(p => !p.copyId)) mirror(st, c, lp, amt * game.value(lp, 'now', funds.navOf) / E);
  st.hist.push({t: `Kopieren gestartet: ${leader.name}`, ts: Date.now(), d: `${amt.toLocaleString('de-DE')} € zugeteilt`, stake: amt, pl: null});
  store.save(userId, st);
}

function stop(userId, copyId) {
  const st = store.load(userId), c = (st.copies || []).find(x => x.id === copyId);
  if (!c) throw err('Kopie nicht gefunden', 404);
  for (const p of st.pos.filter(p => p.copyId === c.id)) game.close(st, p.id, 'Kopie beendet', funds.navOf);
  const pl = c.cash - c.amt;
  st.cash += c.cash; st.copies = st.copies.filter(x => x !== c);
  st.hist.push({t: `Kopieren beendet: ${c.leaderName}`, ts: Date.now(), d: `Rückfluss ${Math.round(c.cash).toLocaleString('de-DE')} €`, pl});
  store.save(userId, st);
  return pl;
}

function followersOf(leaderId) { return store.all().filter(u => (u.st.copies || []).some(c => c.leaderId === leaderId)); }

// Vorbild hat eine Position eröffnet: bei allen Kopierern im gleichen Verhältnis zum Depotwert nachbilden
function onOpen(leaderId, lp, leaderEqBefore) {
  if (!leaderEqBefore) return;
  for (const f of followersOf(leaderId)) {
    const st = store.load(f.userId), c = st.copies.find(x => x.leaderId === leaderId);
    mirror(st, c, lp, lp.stake / leaderEqBefore * copyEquity(st, c));
    store.save(f.userId, st);
  }
}
// Vorbild hat eine Position geschlossen (selbst oder durch Stop-Loss/Knock-out/Verfall)
function onClose(leaderId, leaderPosId, why) {
  for (const f of followersOf(leaderId)) {
    const st = store.load(f.userId), c = st.copies.find(x => x.leaderId === leaderId);
    const mine = st.pos.filter(p => p.copyId === c.id && p.src === leaderPosId);
    if (!mine.length) continue;
    for (const p of mine) game.close(st, p.id, why || 'Vorbild hat geschlossen', funds.navOf);
    store.save(f.userId, st);
  }
}

function view(st) {
  return (st.copies || []).map(c => {
    const u = qUser.get(c.leaderId), v = copyEquity(st, c);
    return {id: c.id, leaderId: c.leaderId, leaderName: c.leaderName, color: u && u.color, amt: c.amt, cash: c.cash, value: v, pl: v - c.amt, ts: c.ts};
  });
}

/* ---------- Kennzahlen ---------- */
const qPutHist = db.prepare('INSERT INTO equity_hist (user_id, day, eq) VALUES (?, ?, ?) ON CONFLICT(user_id, day) DO UPDATE SET eq = excluded.eq');
const qHist = db.prepare('SELECT day, eq FROM equity_hist WHERE user_id = ? AND day >= ? ORDER BY day');
const qOldHist = db.prepare('DELETE FROM equity_hist WHERE day < ?');
const dayStr = (ago = 0) => new Date(Date.now() - ago * 864e5).toISOString().slice(0, 10);

// Depotwert zu Beginn eines Zeitraums: letzter Tageswert vor dem Stichtag, sonst Startkapital (Einstieg im laufenden Zeitraum)
const qBase = db.prepare('SELECT eq FROM equity_hist WHERE user_id = ? AND day < ? ORDER BY day DESC LIMIT 1');
function baseline(userId, day) { const r = qBase.get(userId, day); return r ? r.eq : config.startCash; }
function periodStarts(now = new Date()) {
  const m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), w = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  w.setUTCDate(w.getUTCDate() - ((w.getUTCDay() + 6) % 7));   // Montag
  return {month: m.toISOString().slice(0, 10), week: w.toISOString().slice(0, 10)};
}

function snapshot() {
  const d = dayStr();
  for (const u of store.all()) qPutHist.run(u.userId, d, game.equity(u.st, 'now', funds.navOf));
  qOldHist.run(dayStr(400));
}

// Risikowert 1–7 aus der Schwankung des Depots (Volatilität × Hebel, gewichtet), ähnlich wie bei Social-Trading-Plattformen
function risk(st) {
  const E = game.equity(st, 'now', funds.navOf); if (!E) return 1;
  let v = 0;
  for (const p of st.pos) {
    const w = game.value(p, 'now', funds.navOf) / E;
    const f = p.kind === 'fund' ? .2 : game.vol(p.sym) * (p.kind === 'lev' ? p.lev : p.kind === 'option' ? 6 : 1);
    v += w * f;
  }
  const pct = v * 100;
  return [5, 10, 15, 25, 35, 50].filter(t => pct >= t).length + 1;
}

function stats(u, copiers) {
  const eq = game.equity(u.st, 'now', funds.navOf), hist = qHist.all(u.userId, dayStr(31));
  const at = days => { const d = dayStr(days), h = hist.find(x => x.day >= d); return h && h.day <= dayStr(days - 2) ? h.eq : config.startCash; };
  let peak = config.startCash, dd = 0;
  for (const h of hist.concat([{eq}])) { peak = Math.max(peak, h.eq); dd = Math.min(dd, h.eq / peak - 1); }
  return {eq, tot: eq / config.startCash - 1, w1: eq / at(7) - 1, m1: eq / at(30) - 1, dd, risk: risk(u.st),
    copiers: copiers.n, copiedAum: copiers.aum, positions: u.st.pos.filter(p => !p.copyId).length, trades: (u.st.hist || []).filter(h => h.d === 'eröffnet' && !/^Kopie/.test(h.t)).length};
}

function discover(meId) {
  const all = store.all(), cnt = new Map();
  for (const u of all) for (const c of u.st.copies || []) {
    const x = cnt.get(c.leaderId) || {n: 0, aum: 0}; x.n++; x.aum += copyEquity(u.st, c); cnt.set(c.leaderId, x);
  }
  const mine = new Set(((all.find(u => u.userId === meId) || {}).st || {copies: []}).copies.map(c => c.leaderId));
  return all.filter(u => u.provider !== 'guru' && (u.st.pos.some(p => !p.copyId) || (u.st.hist || []).length))
    .map(u => ({id: u.userId, name: u.name, sub: u.bio || (u.provider === 'freehomes' ? 'Free-Homes-Mitglied' : 'Mitglied'), color: u.color, bot: u.isBot,
      me: u.userId === meId, copying: mine.has(u.userId), ...stats(u, cnt.get(u.userId) || {n: 0, aum: 0})}));
}
function statsOf(userId) { return discover(null).find(x => x.id === userId) || null; }

module.exports = {baseline, periodStarts, start, stop, onOpen, onClose, view, snapshot, discover, statsOf, MIN};
