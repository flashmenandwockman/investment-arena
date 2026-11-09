// Spiellogik: Orders ausführen, Positionen bewerten, Stop-Loss/Knock-out/Verfall prüfen.
// Läuft ausschließlich auf dem Server mit Server-Kursen, damit die Challenge fair bleibt.
const config = require('./config');
const market = require('./market');

const DAY = 864e5, FEE_LEV = 0.0002, FEE_SHORT = 0.0001;
const LEVS = {easy: [2, 3, 5], pro: [2, 5, 10, 20]};
const TENORS = [21, 63, 126];
const BADGES = ['first', 'short', 'stop', 'lev', 'opt', 'crypto', 'profit', 'streak', 'fund', 'manager'];

const today = () => new Date().toISOString().slice(0, 10);
const fresh = () => ({cash: config.startCash, pos: [], hist: [], realized: 0, mode: null, badges: {}, xp: 0, active: {}, follow: {}, copies: [], watch: [], lessons: {}});
// Kopierte Anleger haben ein eigenes Guthaben innerhalb des Depots
const copyOf = (st, p) => p && p.copyId ? (st.copies || []).find(c => c.id === p.copyId) : null;

/* ---------- Preise ---------- */
function ncdf(x) { const t = 1 / (1 + .2316419 * Math.abs(x)), d = .3989423 * Math.exp(-x * x / 2); const p = d * t * (.3193815 + t * (-.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; }
function bs(S0, K, T, v, type) {
  const r = .03; if (T <= 0) return Math.max(type === 'call' ? S0 - K : K - S0, 0);
  const d1 = (Math.log(S0 / K) + (r + v * v / 2) * T) / (v * Math.sqrt(T)), d2 = d1 - v * Math.sqrt(T);
  return type === 'call' ? S0 * ncdf(d1) - K * Math.exp(-r * T) * ncdf(d2) : K * Math.exp(-r * T) * ncdf(-d2) - S0 * ncdf(-d1);
}
const roundK = k => { const st = k > 20000 ? 500 : k > 5000 ? 100 : k > 1000 ? 10 : k > 200 ? 5 : k > 50 ? 1 : k > 5 ? .5 : k > 1 ? .05 : .005; return Math.round(k / st) * st; };

function vol(sym) {   // annualisierte Volatilität aus 60 Tagesschlusskursen
  const q = market.get()[sym]; const h = (q && q.hist) || [];
  const r = []; for (let i = 1; i < h.length; i++) r.push(Math.log(h[i] / h[i - 1]));
  if (r.length < 5) return .3;
  const m = r.reduce((a, b) => a + b, 0) / r.length, sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1));
  return Math.max(sd * Math.sqrt(market.INSTRUMENTS[sym] && market.INSTRUMENTS[sym].g === 'crypto' ? 365 : 252), .12);
}
const px = (sym, at = 'now') => { const q = market.get()[sym]; return q ? (at === 'prev' ? q.prev : q.price) : null; };
const toEur = (v, sym) => { const q = market.get()[sym]; return q && q.cur === 'USD' ? v / market.fx() : v; };

/* ---------- Bewertung ---------- */
const feesOf = p => {
  const d = Math.max(0, (Date.now() - p.openedTs) / DAY);
  if (p.kind === 'lev') return p.stake * p.lev * FEE_LEV * d;
  if (p.kind === 'stock' && p.dir < 0) return p.stake * FEE_SHORT * d;
  return 0;
};
function value(p, at = 'now', navOf) {
  if (at === 'prev' && Date.now() - p.openedTs < DAY) return p.stake;
  if (p.kind === 'fund') { const nav = navOf ? navOf(p.fundId, at) : null; return nav ? p.units * nav : p.stake; }
  const P = px(p.sym, at); if (P == null) return p.stake;
  if (p.kind === 'option') {
    const T = Math.max(0, (p.expiryTs - Date.now()) / DAY + (at === 'prev' ? 1 : 0)) / 365;
    return p.units * toEur(bs(P, p.strike, T, vol(p.sym), p.opt), p.sym);
  }
  return Math.max(p.stake + p.dir * p.units * toEur(P - p.entry, p.sym) - feesOf(p), 0);
}
// Depotwert: Bargeld + vorgemerkte Limit-Orders + Kopier-Guthaben + Positionen
const equity = (st, at, navOf) => st.cash + (st.orders || []).reduce((a, o) => a + o.amt, 0) + (st.copies || []).reduce((a, c) => a + c.cash, 0) + st.pos.reduce((a, p) => a + value(p, at, navOf), 0);

/* ---------- Abzeichen & Aktivität ---------- */
function award(st, key, xp, events) { if (!st.badges[key]) { st.badges[key] = true; st.xp += xp; events.push({type: 'badge', key, xp}); } }
function markActive(st, events) {
  st.active[today()] = true;
  let k = 0; for (let i = 0; i < 30; i++) { const d = new Date(Date.now() - i * DAY).toISOString().slice(0, 10); if (st.active[d]) k++; else break; }
  if (k >= 5) award(st, 'streak', 50, events);
}

/* ---------- Order eröffnen ---------- */
// opts.copy: Order wird für einen kopierten Anleger nachgebildet (eigenes Guthaben, gleiche Bedingungen wie beim Vorbild)
function open(st, o, navOf, opts = {}) {
  const events = [], cp = opts.copy;
  const sym = o.sym, I = market.INSTRUMENTS[sym], P = px(sym);
  const amt = Math.floor(Number(o.amt) || 0), dir = Number(o.dir) === -1 ? -1 : 1;
  const mode = st.mode === 'pro' || cp ? 'pro' : 'easy', wallet = cp || st;
  if (!I || P == null) throw new Error('Unbekannter Wert');
  if (amt < (cp ? 10 : 100)) throw new Error('Mindesteinsatz 100 €');
  if (amt > wallet.cash + 0.01) throw new Error('Nicht genug verfügbares Spielgeld');
  const kind = ['stock', 'lev', 'option'].includes(o.kind) ? o.kind : 'stock';
  if (kind === 'option' && mode !== 'pro') throw new Error('Optionen gibt es im Profi-Modus');
  const p = {id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), sym, dir, kind, stake: amt, entry: P, openedTs: Date.now()};
  if (kind === 'lev') {
    const lev = Number(o.lev); if (!LEVS[mode].includes(lev)) throw new Error('Ungültiger Hebel');
    p.lev = lev; p.units = amt * lev / toEur(P, sym); p.ko = P * (1 - dir / lev); award(st, 'lev', 20, events);
  } else if (kind === 'option') {
    const tenor = TENORS.includes(Number(o.tenor)) ? Number(o.tenor) : 63, mny = [0, .05, .1].includes(Number(o.mny)) ? Number(o.mny) : 0;
    p.opt = dir > 0 ? 'call' : 'put'; p.strike = roundK(dir > 0 ? P * (1 + mny) : P * (1 - mny));
    p.expiryTs = Date.now() + tenor / 252 * 365 * DAY;
    if (cp && o.strike > 0 && o.expiryTs > Date.now()) { p.strike = o.strike; p.expiryTs = o.expiryTs; }   // gleiche Option wie das Vorbild
    const prem = bs(P, p.strike, (p.expiryTs - Date.now()) / DAY / 365, vol(sym), p.opt); if (!(prem > 0)) throw new Error('Option nicht handelbar');
    p.units = amt / toEur(prem, sym); award(st, 'opt', 25, events);
  } else {
    p.units = amt / toEur(P, sym);
  }
  // Stop-Loss und Kursziel in Prozent vom Einstieg (Stop 0,5–50 %, Ziel 0,5–500 %), gemessen am Kurs des Basiswerts
  const sl = Math.round(Number(o.sl) * 1e4) / 1e4, tp = Math.round(Number(o.tp) * 1e4) / 1e4;
  if (kind !== 'option' && sl >= .005 && sl <= .5) { p.sl = sl; award(st, 'stop', 20, events); }
  if (kind !== 'option' && tp >= .005 && tp <= 5) p.tp = tp;
  if (dir < 0) award(st, 'short', 20, events);
  if (I.g === 'crypto') award(st, 'crypto', 15, events);
  if (cp) { p.copyId = cp.id; p.src = opts.src; events.length = 0; }
  else {
    // Handelsverhalten für den Talent-Score: Stop-Loss, Positionsgröße, Begründung
    const t = st.ts = st.ts || {n: 0, sl: 0, big: 0, notes: 0}, E = equity(st, 'now', navOf);
    t.n++; if (p.sl) t.sl++; if (E && amt / E > .25) t.big++;
    const note = String(o.note || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (note) { p.note = note; if (note.length >= 10) t.notes++; }
    award(st, 'first', 10, events); st.xp += 5; markActive(st, events);
  }
  wallet.cash -= amt; st.pos.push(p);
  st.hist.push({t: `${cp ? `Kopie ${cp.leaderName}: ` : ''}${dir > 0 ? 'Long' : 'Short'} ${I.n} · ${label(p)}`, ts: Date.now(), d: 'eröffnet', stake: amt, pl: null});
  return {position: p, events};
}

/* ---------- Limit-Orders ---------- */
// Kauf-Limit (long): ausführen, sobald der Kurs auf oder unter das Limit fällt.
// Verkaufs-Limit (short): ausführen, sobald der Kurs auf oder über das Limit steigt.
// Der Betrag wird beim Erteilen vorgemerkt und bei Ausführung, Löschen oder Ablauf verrechnet.
const VALID = {1: 1, 7: 7, 30: 30};
const reached = (o, P) => o.dir > 0 ? P <= o.limit : P >= o.limit;
function placeLimit(st, o, navOf) {
  const sym = o.sym, I = market.INSTRUMENTS[sym], P = px(sym), amt = Math.floor(Number(o.amt) || 0), dir = Number(o.dir) === -1 ? -1 : 1;
  const limit = Number(o.limit), kind = o.kind === 'option' ? null : o.kind === 'lev' ? 'lev' : 'stock';
  if (!I || P == null) throw new Error('Unbekannter Wert');
  if (!kind) throw new Error('Limit-Orders gibt es für Aktien und Hebel, nicht für Optionen');
  if (!(limit > 0) || Math.abs(limit / P - 1) > .5) throw new Error('Das Limit muss innerhalb von 50 % um den aktuellen Kurs liegen');
  if (amt < 100) throw new Error('Mindesteinsatz 100 €');
  if (amt > st.cash + 0.01) throw new Error('Nicht genug verfügbares Spielgeld');
  if ((st.orders || []).length >= 20) throw new Error('Höchstens 20 offene Limit-Orders');
  const days = VALID[Number(o.valid)] || 7;
  const ord = {id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), sym, dir, kind, lev: o.lev, sl: o.sl, tp: o.tp, note: o.note, amt, limit,
    createdTs: Date.now(), expiresTs: Date.now() + days * DAY};
  if (kind === 'lev' && !(st.mode === 'pro' ? LEVS.pro : LEVS.easy).includes(Number(o.lev))) throw new Error('Ungültiger Hebel');
  // Limit schon erreicht? Dann sofort zum aktuellen Kurs ausführen
  if (reached(ord, P)) { const r = open(st, ord, navOf); r.position.limit = limit; return {executed: true, ...r}; }
  st.cash -= amt; st.orders = st.orders || []; st.orders.push(ord);
  st.hist.push({t: `Limit-Order: ${dir > 0 ? 'Kauf' : 'Leerverkauf'} ${I.n} bei ${limit.toLocaleString('de-DE', {maximumFractionDigits: 4})}`, ts: Date.now(), d: 'vorgemerkt', stake: amt, pl: null});
  return {executed: false, order: ord, events: []};
}
function cancelLimit(st, id, why) {
  const i = (st.orders || []).findIndex(o => o.id === id); if (i < 0) throw new Error('Order nicht gefunden');
  const o = st.orders[i]; st.orders.splice(i, 1); st.cash += o.amt;
  st.hist.push({t: `Limit-Order ${why || 'gelöscht'}: ${(market.INSTRUMENTS[o.sym] || {}).n || o.sym}`, ts: Date.now(), d: `${Math.round(o.amt).toLocaleString('de-DE')} € frei`, stake: o.amt, pl: null});
  return o;
}
// Bei jedem Kurs-Update: erreichte Limits ausführen, abgelaufene freigeben
function checkOrders(st, navOf) {
  const out = [];
  for (const o of (st.orders || []).slice()) {
    const P = px(o.sym);
    if (Date.now() > o.expiresTs) { cancelLimit(st, o.id, 'abgelaufen'); out.push({type: 'expired', sym: o.sym}); continue; }
    if (P == null || !reached(o, P)) continue;
    st.orders = st.orders.filter(x => x.id !== o.id); st.cash += o.amt;
    try { const eqBefore = equity(st, 'now', navOf), r = open(st, o, navOf); r.position.limit = o.limit; out.push({type: 'filled', sym: o.sym, position: r.position, eqBefore}); }
    catch (e) { out.push({type: 'failed', sym: o.sym}); }
  }
  return out;
}

function label(p) {
  if (p.kind === 'fund') return p.fundKind === 'guru' ? 'Großinvestor' : 'Community-Fonds';
  const I = market.INSTRUMENTS[p.sym] || {};
  if (p.kind === 'stock') return I.g === 'crypto' ? 'Spot' : I.t === 'Aktie' ? 'Aktie' : 'Direkt';
  if (p.kind === 'lev') return `Hebel ${p.lev}×`;
  return `${p.opt === 'call' ? 'Call' : 'Put'} ${p.strike}`;
}

function close(st, id, why, navOf) {
  const i = st.pos.findIndex(p => p.id === id); if (i < 0) throw new Error('Position nicht gefunden');
  const p = st.pos[i], v = value(p, 'now', navOf), pl = v - p.stake, events = [], cp = copyOf(st, p);
  (cp || st).cash += v; st.realized += pl; st.pos.splice(i, 1);
  if (pl > 0 && !cp) award(st, 'profit', 20, events);
  const name = p.kind === 'fund' ? p.fundName : (market.INSTRUMENTS[p.sym] || {}).n;
  st.hist.push({t: `${cp ? `Kopie ${cp.leaderName} · ` : ''}${why || 'Geschlossen'}: ${name} · ${label(p)}`, ts: Date.now(), d: `Erlös ${Math.round(v).toLocaleString('de-DE')} €`, pl});
  if (!why) markActive(st, events);
  return {pl, value: v, events};
}

// Stop-Loss, Knock-out, Zwangseindeckung und Verfall bei jedem Kurs-Update prüfen
function check(st, navOf) {
  const events = [];
  for (const p of st.pos.slice()) {
    if (p.kind === 'fund') continue;
    const P = px(p.sym); if (P == null) continue;
    const v = value(p, 'now', navOf); let why = null;
    if (p.kind === 'lev' && (v <= 0 || p.dir * (P - p.ko) <= 0)) why = 'Knock-out';
    else if (p.kind === 'stock' && p.dir < 0 && v <= 0) why = 'Zwangseindeckung';
    else if (p.kind === 'option' && Date.now() >= p.expiryTs) why = 'Verfall';
    else if (p.sl && p.dir * (P / p.entry - 1) <= -p.sl) why = 'Stop-Loss';
    else if (p.tp && p.dir * (P / p.entry - 1) >= p.tp) why = 'Ziel erreicht';
    if (why) { close(st, p.id, why, navOf); events.push({type: 'closed', why, sym: p.sym, id: p.id, copy: !!p.copyId}); }
  }
  return events;
}

module.exports = {placeLimit, cancelLimit, checkOrders, fresh, copyOf, open, close, check, value, equity, label, vol, bs, roundK, feesOf, BADGES, LEVS, DAY};
