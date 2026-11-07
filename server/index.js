// Investment Arena – HTTP-Server (ohne Framework, nur Node-Bordmittel)
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const market = require('./market');
const radar = require('./radar');
const game = require('./game');
const store = require('./store');
const funds = require('./funds');
const bots = require('./bots');
const pkg = require('../package.json');

const PUBLIC = path.join(__dirname, '..', 'public');
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8'};

/* ---------- Helfer ---------- */
const send = (res, status, data, headers = {}) => {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers});
  res.end(JSON.stringify(data));
};
const fail = (res, e) => send(res, e.status || 400, {error: e.message || 'Fehler'});
async function body(req) {
  if (!/application\/json/.test(req.headers['content-type'] || '')) throw Object.assign(new Error('JSON erwartet'), {status: 415});
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 20000) throw Object.assign(new Error('Anfrage zu groß'), {status: 413}); }
  try { return raw ? JSON.parse(raw) : {}; } catch (e) { throw new Error('Ungültiges JSON'); }
}
function requireUser(req) {
  const u = auth.currentUser(req);
  if (!u) throw Object.assign(new Error('Bitte anmelden'), {status: 401});
  return u;
}
const publicUser = u => u && {id: u.id, name: u.name, provider: u.provider, color: u.color, email: u.email || null};

/* ---------- Ansichten ---------- */
function stateView(userId) {
  const st = store.load(userId), q = market.get();
  const positions = st.pos.map(p => {
    const v = game.value(p, 'now', funds.navOf), I = market.INSTRUMENTS[p.sym] || {};
    return {...p, value: v, pl: v - p.stake, label: game.label(p), name: p.kind === 'fund' ? p.fundName : I.n,
      price: p.kind === 'fund' ? funds.navOf(p.fundId) : q[p.sym] && q[p.sym].price, cur: p.kind === 'fund' ? 'NAV' : q[p.sym] && q[p.sym].cur,
      fees: game.feesOf(p)};
  });
  const eq = game.equity(st, 'now', funds.navOf), prev = game.equity(st, 'prev', funds.navOf);
  return {cash: st.cash, positions, hist: st.hist.slice(-40), realized: st.realized, badges: st.badges, xp: st.xp, active: st.active,
    follow: st.follow, mode: st.mode, equity: eq, eqPrev: prev, startCash: config.startCash};
}
function leaderboard(meId) {
  return store.all().map(u => {
    const eq = game.equity(u.st, 'now', funds.navOf), prev = game.equity(u.st, 'prev', funds.navOf);
    return {id: u.userId, name: u.name, sub: u.bio || (u.provider === 'freehomes' ? 'Free-Homes-Mitglied' : 'Mitglied'), color: u.color,
      eq, day: prev ? eq / prev - 1 : 0, tot: eq / config.startCash - 1, me: u.userId === meId, bot: u.isBot, badges: Object.keys(u.st.badges || {})};
  });
}
const qUser = db.prepare('SELECT * FROM users WHERE id = ?');
function profile(id) {
  const u = qUser.get(id); if (!u) return null;
  const st = store.load(id), eq = game.equity(st, 'now', funds.navOf);
  const items = st.pos.map(p => {
    const v = game.value(p, 'now', funds.navOf);
    return {name: p.kind === 'fund' ? p.fundName : (market.INSTRUMENTS[p.sym] || {}).n, sym: p.sym, dir: p.dir, kind: p.kind, label: game.label(p), value: v, weight: eq ? v / eq : 0, pl: v / p.stake - 1};
  });
  const own = funds.list().filter(f => f.ownerId === id).map(f => ({id: f.id, name: f.name, perf: f.perf}));
  return {id, name: u.name, sub: u.bio, color: u.color, badges: Object.keys(st.badges || {}), equity: eq, cashWeight: eq ? st.cash / eq : 0, items, funds: own};
}

/* ---------- Routen ---------- */
async function api(req, res, url) {
  const m = req.method, p = url.pathname;
  try {
    if (p === '/api/config') return send(res, 200, {version: pkg.version, startCash: config.startCash, freehomes: config.freehomes.enabled});
    if (p === '/api/me') return send(res, 200, {user: publicUser(auth.currentUser(req))});
    if (p === '/api/auth/register' && m === 'POST') { auth.throttle('reg:' + req.socket.remoteAddress); const id = auth.register(await body(req)); auth.startSession(res, id); return send(res, 200, {user: publicUser(qUser.get(id))}); }
    if (p === '/api/auth/login' && m === 'POST') { const b = await body(req); auth.throttle('login:' + req.socket.remoteAddress); const id = auth.login(b); auth.startSession(res, id); return send(res, 200, {user: publicUser(qUser.get(id))}); }
    if (p === '/api/auth/demo' && m === 'POST') { auth.throttle('demo:' + req.socket.remoteAddress); const id = auth.demo(); auth.startSession(res, id); return send(res, 200, {user: publicUser(qUser.get(id))}); }
    if (p === '/api/auth/logout' && m === 'POST') { auth.logout(req, res); return send(res, 200, {ok: true}); }
    if (p === '/api/auth/freehomes/start') {
      if (!config.freehomes.enabled) throw Object.assign(new Error('Free-Homes-Login ist noch nicht freigeschaltet'), {status: 404});
      res.writeHead(302, {Location: await auth.freehomesStart()}); return res.end();
    }
    if (p === '/api/auth/freehomes/callback') {
      try { const id = await auth.freehomesCallback(url.searchParams); auth.startSession(res, id); res.writeHead(302, {Location: '/'}); }
      catch (e) { res.writeHead(302, {Location: '/?login=fehler'}); }
      return res.end();
    }
    if (p === '/api/quotes') return send(res, 200, {quotes: market.get(), instruments: market.INSTRUMENTS, ...market.status()});
    if (p === '/api/radar') return send(res, 200, {radar: radar.get(), ...radar.status()});
    if (p === '/api/audio') {
      const dir = path.join(PUBLIC, 'audio');
      return send(res, 200, {files: fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.(mp3|m4a)$/.test(f)) : []});
    }
    if (p === '/api/leaderboard') { const u = auth.currentUser(req); return send(res, 200, {rows: leaderboard(u && u.id)}); }
    if (p.startsWith('/api/profile/')) { const pr = profile(Number(p.split('/').pop())); return pr ? send(res, 200, pr) : send(res, 404, {error: 'Nicht gefunden'}); }
    if (p === '/api/funds' && m === 'GET') return send(res, 200, {funds: funds.list()});
    if (p === '/api/funds' && m === 'POST') {
      const u = requireUser(req), id = funds.create(u.id, await body(req));
      const st = store.load(u.id); const ev = []; if (!st.badges.manager) { st.badges.manager = true; st.xp += 40; ev.push({type: 'badge', key: 'manager', xp: 40}); } store.save(u.id, st);
      return send(res, 200, {id, events: ev});
    }
    if (/^\/api\/funds\/\d+$/.test(p)) { const d = funds.detail(Number(p.split('/').pop())); return d ? send(res, 200, d) : send(res, 404, {error: 'Nicht gefunden'}); }
    if (/^\/api\/funds\/\d+\/invest$/.test(p) && m === 'POST') {
      const u = requireUser(req), fid = Number(p.split('/')[3]), f = funds.detail(fid);
      if (!f) throw Object.assign(new Error('Fonds nicht gefunden'), {status: 404});
      const amt = Math.floor(Number((await body(req)).amt) || 0), st = store.load(u.id);
      if (amt < 100) throw new Error('Mindesteinsatz 100 €');
      if (amt > st.cash + .01) throw new Error('Nicht genug verfügbares Spielgeld');
      if (f.ownerId === u.id) throw new Error('In den eigenen Fonds wird nicht investiert');
      st.cash -= amt;
      st.pos.push({id: Date.now().toString(36), kind: 'fund', fundId: fid, fundName: f.name, dir: 1, stake: amt, units: amt / f.nav, entry: f.nav, openedTs: Date.now()});
      st.hist.push({t: `Investiert: ${f.name} · Community-Fonds`, ts: Date.now(), d: 'eröffnet', stake: amt, pl: null});
      const ev = []; if (!st.badges.fund) { st.badges.fund = true; st.xp += 20; ev.push({type: 'badge', key: 'fund', xp: 20}); }
      store.save(u.id, st); return send(res, 200, {state: stateView(u.id), events: ev});
    }
    // Ab hier nur mit Anmeldung
    const u = requireUser(req);
    if (p === '/api/state' && m === 'GET') return send(res, 200, stateView(u.id));
    if (p === '/api/state' && m === 'PATCH') {
      const b = await body(req), st = store.load(u.id);
      if (['easy', 'pro'].includes(b.mode)) st.mode = b.mode;
      if (b.follow && typeof b.follow === 'object') for (const [k, v] of Object.entries(b.follow).slice(0, 50)) { if (v) st.follow[k] = true; else delete st.follow[k]; }
      store.save(u.id, st); return send(res, 200, stateView(u.id));
    }
    if (p === '/api/state/reset' && m === 'POST') { const st = store.load(u.id), fresh = game.fresh(); fresh.mode = st.mode; store.save(u.id, fresh); return send(res, 200, stateView(u.id)); }
    if (p === '/api/orders' && m === 'POST') {
      const st = store.load(u.id), r = game.open(st, await body(req), funds.navOf); store.save(u.id, st);
      return send(res, 200, {state: stateView(u.id), events: r.events});
    }
    if (/^\/api\/positions\/[\w-]+\/close$/.test(p) && m === 'POST') {
      const st = store.load(u.id), r = game.close(st, p.split('/')[3], null, funds.navOf); store.save(u.id, st);
      return send(res, 200, {state: stateView(u.id), pl: r.pl, events: r.events});
    }
    return send(res, 404, {error: 'Unbekannte Route'});
  } catch (e) { return fail(res, e); }
}

function serveStatic(req, res, url) {
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
  const ext = path.extname(file);
  res.writeHead(200, {'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'});
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  const url = new URL(req.url, config.baseUrl);
  if (url.pathname === '/healthz') return send(res, 200, {ok: true, market: market.status(), radar: radar.status()});
  if (url.pathname.startsWith('/api/')) return api(req, res, url);
  return serveStatic(req, res, url);
});

/* ---------- Hintergrund-Aufgaben ---------- */
function checkAllBooks() {
  for (const u of store.all()) { const ev = game.check(u.st, funds.navOf); if (ev.length) store.save(u.userId, u.st); }
}
async function tick() { await market.refresh(); checkAllBooks(); }

async function start() {
  bots.seed();
  if (require.main === module) {
    await market.refresh().catch(() => {});
    radar.refresh().catch(() => {});
    setInterval(() => tick().catch(() => {}), 30_000);
    setInterval(() => radar.refresh().catch(() => {}), 30 * 60_000);
    setInterval(() => auth.cleanupDemo(), 60 * 60_000);
  }
  return new Promise(r => server.listen(config.port, () => { console.log(`Investment Arena läuft auf ${config.baseUrl} (Port ${server.address().port})`); r(server); }));
}

if (require.main === module) start();
module.exports = {start, server};
