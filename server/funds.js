// Community-Fonds: Mitglieder stellen eigene Aktienpakete zusammen (long und short),
// andere Mitglieder investieren Spielgeld hinein. Der Anteilswert (NAV) startet bei 100.
const db = require('./db');
const market = require('./market');
const store = require('./store');

const qAll = db.prepare('SELECT f.*, u.name AS manager, u.color FROM funds f JOIN users u ON u.id = f.owner_id ORDER BY f.created_at');
const qOne = db.prepare('SELECT f.*, u.name AS manager, u.color FROM funds f JOIN users u ON u.id = f.owner_id WHERE f.id = ?');
const qByOwner = db.prepare('SELECT COUNT(*) AS n FROM funds WHERE owner_id = ?');
const qIns = db.prepare('INSERT INTO funds (owner_id, name, strategy, holdings, created_at) VALUES (?, ?, ?, ?, ?)');

function nav(fund, at = 'now') {
  const q = market.get(), hs = typeof fund.holdings === 'string' ? JSON.parse(fund.holdings) : fund.holdings;
  let sum = 0, wsum = 0;
  for (const h of hs) {
    const p = q[h.sym]; if (!p) continue;
    const P = at === 'prev' && Date.now() - Math.max(fund.created_at, fund.rebalanced_at || 0) > 864e5 ? p.prev : p.price;
    sum += h.w * (1 + h.dir * (P / h.p0 - 1)); wsum += h.w;
  }
  const base = fund.nav_base || 100;
  return wsum ? Math.max(base * sum / wsum, 0) : base;
}
const cache = new Map();
function navOf(fundId, at = 'now') {
  let f = cache.get(fundId);
  if (!f) { f = qOne.get(fundId); if (!f) return null; cache.set(fundId, f); }
  return nav(f, at);
}

function investors(fundId) {
  let n = 0, aum = 0;
  for (const u of store.all()) for (const p of u.st.pos) if (p.kind === 'fund' && p.fundId === fundId) { n++; aum += p.units * navOf(fundId); }
  return {n, aum};
}

function summary(f) {
  const hs = JSON.parse(f.holdings), now = nav(f), prev = nav(f, 'prev'), inv = investors(f.id);
  return {
    id: f.id, kind: f.kind || 'community', name: f.name, strategy: f.strategy, manager: f.manager, color: f.color, ownerId: f.owner_id,
    source: f.source ? JSON.parse(f.source) : null, rebalancedAt: f.rebalanced_at || null,
    createdAt: f.created_at, nav: now, perf: now / 100 - 1, day: prev ? now / prev - 1 : 0,
    investors: inv.n, aum: inv.aum, longs: hs.filter(h => h.dir > 0).length, shorts: hs.filter(h => h.dir < 0).length,
    top: hs.slice().sort((a, b) => b.w - a.w).slice(0, 3).map(h => ({sym: h.sym, name: (market.INSTRUMENTS[h.sym] || {}).n, dir: h.dir, w: h.w})),
  };
}
function list(kind = 'community') { return qAll.all().filter(f => (f.kind || 'community') === kind).map(summary).sort((a, b) => b.perf - a.perf); }
function detail(id) {
  const f = qOne.get(id); if (!f) return null;
  const q = market.get(), hs = JSON.parse(f.holdings), wsum = hs.reduce((a, h) => a + h.w, 0);
  return {...summary(f), holdings: hs.map(h => ({sym: h.sym, name: (market.INSTRUMENTS[h.sym] || {}).n, dir: h.dir, w: h.w / wsum, p0: h.p0, perf: q[h.sym] ? h.dir * (q[h.sym].price / h.p0 - 1) : 0}))};
}

function create(userId, body) {
  const name = String(body.name || '').trim().slice(0, 40), strategy = String(body.strategy || '').trim().slice(0, 400);
  if (name.length < 3) throw new Error('Bitte einen Fondsnamen mit mindestens 3 Zeichen angeben');
  if (qByOwner.get(userId).n >= 3) throw new Error('Maximal 3 eigene Fonds pro Mitglied');
  const q = market.get(), seen = new Set();
  const hs = (Array.isArray(body.holdings) ? body.holdings : []).map(h => ({sym: h.sym, dir: Number(h.dir) === -1 ? -1 : 1, w: Math.round(Number(h.w))}))
    .filter(h => market.INSTRUMENTS[h.sym] && q[h.sym] && h.w > 0 && !seen.has(h.sym) && seen.add(h.sym));
  if (hs.length < 3 || hs.length > 10) throw new Error('Ein Fonds braucht 3 bis 10 verschiedene Werte');
  const total = hs.reduce((a, h) => a + h.w, 0);
  if (Math.abs(total - 100) > 0.5) throw new Error(`Die Gewichte müssen zusammen 100 % ergeben (aktuell ${total} %)`);
  hs.forEach(h => { h.p0 = q[h.sym].price; });
  const r = qIns.run(userId, name, strategy, JSON.stringify(hs), Date.now());
  return Number(r.lastInsertRowid);
}

module.exports = {list, detail, create, navOf, cache};
