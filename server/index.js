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
const trcm = require('./trcm');
const copy = require('./copy');
const gurus = require('./gurus');
const arenas = require('./arenas');
const talents = require('./talents');
const smart = require('./smart');
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
const publicUser = u => u && {id: u.id, name: u.name, provider: u.provider, color: u.color, email: u.email || null, admin: trcm.isAdmin(u), member: trcm.isMember(u)};
// Depot einer Anfrage: Hauptdepot oder eigenes Arena-Depot (?book=<Arena-ID>)
function bookOf(u, url) { const b = Number(url.searchParams.get('book')) || 0; return b ? arenas.loadBook(u.id, b) : null; }
const onlyMain = bk => { if (bk) throw Object.assign(new Error('Das geht nur im Hauptdepot. Bitte oben auf „Hauptdepot“ wechseln.'), {status: 400}); };
const posText = (p, verb) => `${verb} ${p.dir > 0 ? 'Long' : 'Short'} ${(market.INSTRUMENTS[p.sym] || {}).n || p.sym} · ${game.label(p)}`;

// Schutz vor zu vielen Such- und Kursanfragen je Adresse (Finnhub-Limit)
const hits = new Map();
function limit(req, max = 40, bucket = '') {
  const k = req.socket.remoteAddress + bucket, now = Date.now(), a = (hits.get(k) || []).filter(t => now - t < 60_000);
  if (a.length >= max) throw Object.assign(new Error('Zu viele Anfragen, bitte kurz warten'), {status: 429});
  a.push(now); hits.set(k, a);
}

/* ---------- Ansichten ---------- */
function stateView(userId, bk) {
  const st = bk ? bk.st : store.load(userId), q = market.get();
  const positions = st.pos.map(p => {
    const v = game.value(p, 'now', funds.navOf), I = market.INSTRUMENTS[p.sym] || {};
    return {...p, value: v, pl: v - p.stake, label: game.label(p), name: p.kind === 'fund' ? p.fundName : I.n,
      price: p.kind === 'fund' ? funds.navOf(p.fundId) : q[p.sym] && q[p.sym].price, cur: p.kind === 'fund' ? 'NAV' : q[p.sym] && q[p.sym].cur,
      fees: game.feesOf(p)};
  });
  const eq = game.equity(st, 'now', funds.navOf), prev = game.equity(st, 'prev', funds.navOf);
  const orders = (st.orders || []).map(o => ({...o, name: (market.INSTRUMENTS[o.sym] || {}).n || o.sym, price: q[o.sym] && q[o.sym].price, cur: q[o.sym] && q[o.sym].cur}));
  return {orders, cash: st.cash, positions, hist: st.hist.slice(-40), realized: st.realized, badges: st.badges, xp: st.xp, active: st.active,
    follow: st.follow, watch: (bk ? store.load(userId) : st).watch || [], lessons: (bk ? store.load(userId) : st).lessons || {}, mode: st.mode, equity: eq, eqPrev: prev, startCash: config.startCash, copies: copy.view(st), book: bk ? bk.arena.id : null};
}
function leaderboard(meId) {
  const ps = copy.periodStarts();
  return store.all().map(u => {
    const eq = game.equity(u.st, 'now', funds.navOf), prev = game.equity(u.st, 'prev', funds.navOf);
    const wk = eq / copy.baseline(u.userId, ps.week) - 1, mon = eq / copy.baseline(u.userId, ps.month) - 1;
    return {id: u.userId, name: u.name, sub: u.bio || (u.provider === 'freehomes' ? 'Free-Homes-Mitglied' : 'Mitglied'), color: u.color,
      eq, day: prev ? eq / prev - 1 : 0, wk, mon, tot: eq / config.startCash - 1, me: u.userId === meId, bot: u.isBot, badges: Object.keys(u.st.badges || {})};
  });
}
const qUser = db.prepare('SELECT * FROM users WHERE id = ?');
// Stimmung der 100 besten Trader (nach Depotwert) zu einem Titel: Anteil long und short, gewichtet nach Positionswert
let sentCache = {t: 0, map: new Map()};
function sentiment(sym) {
  if (Date.now() - sentCache.t > 120_000) {
    const map = new Map();
    const top = store.all().map(u => ({u, eq: game.equity(u.st, 'now', funds.navOf)})).sort((a, b) => b.eq - a.eq).slice(0, 100);
    for (const {u} of top) for (const p of u.st.pos) {
      if (!p.sym || p.copyId) continue;
      const v = game.value(p, 'now', funds.navOf) * (p.lev || 1), x = map.get(p.sym) || {long: 0, short: 0, traders: new Set()};
      if (p.dir > 0) x.long += v; else x.short += v; x.traders.add(u.userId); map.set(p.sym, x);
    }
    sentCache = {t: Date.now(), map};
  }
  const x = sentCache.map.get(sym);
  if (!x || x.long + x.short <= 0) return {sym, traders: 0};
  return {sym, traders: x.traders.size, long: x.long / (x.long + x.short), short: x.short / (x.long + x.short)};
}
function profile(id) {
  const u = qUser.get(id); if (!u) return null;
  const st = store.load(id), eq = game.equity(st, 'now', funds.navOf);
  const items = st.pos.map(p => {
    const v = game.value(p, 'now', funds.navOf);
    return {name: p.kind === 'fund' ? p.fundName : (market.INSTRUMENTS[p.sym] || {}).n, sym: p.sym, dir: p.dir, kind: p.kind, label: game.label(p), value: v, weight: eq ? v / eq : 0, pl: v / p.stake - 1};
  });
  const own = funds.list().filter(f => f.ownerId === id).map(f => ({id: f.id, name: f.name, perf: f.perf}));
  const copied = (st.copies || []).reduce((a, c) => a + c.cash, 0);
  return {id, name: u.name, sub: u.bio, color: u.color, badges: Object.keys(st.badges || {}), equity: eq, cashWeight: eq ? (st.cash + copied) / eq : 0, items, funds: own,
    stats: copy.statsOf(id), copying: (st.copies || []).map(c => c.leaderName)};
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
    if (p === '/api/quotes') return send(res, 200, {...market.visible(), ...market.status()});
    if (p === '/api/search') { requireUser(req); limit(req, 150, ':s'); /* Suche läuft lokal, darf öfter */ return send(res, 200, {results: await market.search(url.searchParams.get('q'))}); }
    if (/^\/api\/instrument\/[A-Za-z]{1,5}(\.[A-Za-z])?$/.test(p)) { requireUser(req); limit(req); return send(res, 200, await market.add(p.split('/').pop())); }
    if (/^\/api\/radar\/[A-Za-z]{1,5}$/.test(p)) { requireUser(req); limit(req); return send(res, 200, {sym: p.split('/').pop().toUpperCase(), radar: await radar.one(p.split('/').pop().toUpperCase())}); }
    if (p === '/api/chart') { limit(req); return send(res, 200, await market.chart(url.searchParams.get('sym') || '', url.searchParams.get('r'))); }
    if (/^\/api\/sentiment\/[\w.^=\/-]{1,20}$/.test(p)) return send(res, 200, sentiment(decodeURIComponent(p.slice('/api/sentiment/'.length))));
    if (p === '/api/smart') return send(res, 200, smart.overview());
    if (/^\/api\/smart\/[\w.^=\/-]{1,20}$/.test(p)) return send(res, 200, smart.forSymbol(decodeURIComponent(p.slice('/api/smart/'.length))));
    if (p === '/api/radar') return send(res, 200, {radar: radar.get(), ...radar.status()});
    if (p === '/api/audio') {
      const dir = path.join(PUBLIC, 'audio');
      return send(res, 200, {files: fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.(mp3|m4a)$/.test(f)) : []});
    }
    if (p === '/api/leaderboard') { const u = auth.currentUser(req); return send(res, 200, {rows: leaderboard(u && u.id)}); }
    if (p.startsWith('/api/profile/')) { const pr = profile(Number(p.split('/').pop())); return pr ? send(res, 200, pr) : send(res, 404, {error: 'Nicht gefunden'}); }
    // TRCM-Portfolio: Wertentwicklung öffentlich, Titel nur für Free-Homes-Mitglieder, Pflege nur für Admins
    if (p === '/api/trcm' && m === 'GET') return send(res, 200, trcm.view(auth.currentUser(req)));
    if (p.startsWith('/api/admin/trcm')) {
      const u = requireUser(req), b = m === 'GET' || m === 'DELETE' ? {} : await body(req), id = Number(p.split('/')[5]);
      if (p === '/api/admin/trcm' && m === 'PATCH') trcm.updateMeta(u, b);
      else if (p === '/api/admin/trcm/holdings' && m === 'POST') { limit(req); await trcm.addHolding(u, b); heldCache.t = 0; }
      else if (/^\/api\/admin\/trcm\/holdings\/\d+$/.test(p) && m === 'PATCH') trcm.updateHolding(u, id, b);
      else if (/^\/api\/admin\/trcm\/holdings\/\d+$/.test(p) && m === 'DELETE') trcm.deleteHolding(u, id);
      else if (/^\/api\/admin\/trcm\/holdings\/\d+\/close$/.test(p) && m === 'POST') trcm.closeHolding(u, id, b);
      else if (!trcm.isAdmin(u)) throw Object.assign(new Error('Nur für Admins'), {status: 403});
      else return send(res, 404, {error: 'Unbekannte Route'});
      return send(res, 200, trcm.view(u));
    }
    if (p === '/api/funds' && m === 'GET') return send(res, 200, {funds: funds.list()});
    if (p === '/api/arenas/league') { const u = auth.currentUser(req); return send(res, 200, {league: arenas.leagueView(u && u.id)}); }
    if (/^\/api\/arenas\/by\/[\w-]+$/.test(p) && m === 'GET') return send(res, 200, arenas.detail(p.split('/').pop(), auth.currentUser(req)));
    if (p === '/api/talents' && m === 'GET') return send(res, 200, talents.view(auth.currentUser(req)));
    if (p === '/api/discover') { const u = auth.currentUser(req); return send(res, 200, {traders: copy.discover(u && u.id), gurus: funds.list('guru'), min: copy.MIN}); }
    if (p === '/api/funds' && m === 'POST') {
      const u = requireUser(req), id = funds.create(u.id, await body(req));
      const st = store.load(u.id); const ev = []; if (!st.badges.manager) { st.badges.manager = true; st.xp += 40; ev.push({type: 'badge', key: 'manager', xp: 40}); } store.save(u.id, st);
      return send(res, 200, {id, events: ev});
    }
    if (/^\/api\/funds\/\d+$/.test(p)) { const d = funds.detail(Number(p.split('/').pop())); return d ? send(res, 200, d) : send(res, 404, {error: 'Nicht gefunden'}); }
    if (/^\/api\/funds\/\d+\/invest$/.test(p) && m === 'POST') {
      onlyMain(Number(url.searchParams.get('book')));
      const u = requireUser(req), fid = Number(p.split('/')[3]), f = funds.detail(fid);
      if (!f) throw Object.assign(new Error('Fonds nicht gefunden'), {status: 404});
      const amt = Math.floor(Number((await body(req)).amt) || 0), st = store.load(u.id);
      if (amt < 100) throw new Error('Mindesteinsatz 100 €');
      if (amt > st.cash + .01) throw new Error('Nicht genug verfügbares Spielgeld');
      if (f.ownerId === u.id) throw new Error('In den eigenen Fonds wird nicht investiert');
      st.cash -= amt;
      const eqBefore = game.equity(st, 'now', funds.navOf);
      const pos = {id: Date.now().toString(36), kind: 'fund', fundId: fid, fundName: f.name, fundKind: f.kind, dir: 1, stake: amt, units: amt / f.nav, entry: f.nav, openedTs: Date.now()};
      st.pos.push(pos);
      st.hist.push({t: f.kind === 'guru' ? `Kopiert: ${f.manager} · Großinvestor` : `Investiert: ${f.name} · Community-Fonds`, ts: Date.now(), d: 'eröffnet', stake: amt, pl: null});
      const ev = []; if (!st.badges.fund) { st.badges.fund = true; st.xp += 20; ev.push({type: 'badge', key: 'fund', xp: 20}); }
      store.save(u.id, st); copy.onOpen(u.id, pos, eqBefore); heldCache.t = 0;
      return send(res, 200, {state: stateView(u.id), events: ev});
    }
    // Ab hier nur mit Anmeldung
    const u = requireUser(req);
    if (p === '/api/state' && m === 'GET') { const bk = bookOf(u, url); return send(res, 200, stateView(u.id, bk)); }
    if (p === '/api/state' && m === 'PATCH') {
      const b = await body(req), st = store.load(u.id);
      if (['easy', 'pro'].includes(b.mode)) { st.mode = b.mode; for (const a of arenas.mine(u)) if (a.mode === 'own') { try { const bk = arenas.loadBook(u.id, a.id); bk.st.mode = b.mode; bk.save(); } catch (e) {} } }
      if (b.follow && typeof b.follow === 'object') for (const [k, v] of Object.entries(b.follow).slice(0, 50)) { if (v) st.follow[k] = true; else delete st.follow[k]; }
      // Watchlist: bis zu 60 Titel, nur bekannte Werte
      if (b.watch && typeof b.watch === 'object') {
        st.watch = Array.isArray(st.watch) ? st.watch : [];
        for (const [k, v] of Object.entries(b.watch).slice(0, 20)) {
          if (v && market.INSTRUMENTS[k] && !st.watch.includes(k)) { if (st.watch.length >= 60) throw new Error('Höchstens 60 Titel auf der Watchlist'); st.watch.push(k); }
          if (!v) st.watch = st.watch.filter(x => x !== k);
        }
        heldCache.t = 0;
      }
      if (typeof b.lesson === 'string' && /^\w{2,20}$/.test(b.lesson)) { st.lessons = st.lessons || {}; st.lessons[b.lesson] = Date.now(); }
      store.save(u.id, st); return send(res, 200, stateView(u.id));
    }
    if (p === '/api/state/reset' && m === 'POST') {
      // Nur mit ausdrücklicher Bestätigung: Positionen, Kopien, Verlauf, Abzeichen und Platz in der Rangliste gehen verloren
      if ((await body(req)).confirm !== true) throw new Error('Bitte das Zurücksetzen ausdrücklich bestätigen');
      const st = store.load(u.id), fresh = game.fresh(); fresh.mode = st.mode; fresh.resetAt = Date.now();
      arenas.onReset(u.id, game.equity(st, 'now', funds.navOf));   // Ergebnis bleibt in Arenen mit Hauptdepot stehen
      store.save(u.id, fresh);
      db.prepare('DELETE FROM equity_hist WHERE user_id = ?').run(u.id);
      return send(res, 200, stateView(u.id));
    }
    if (p === '/api/orders' && m === 'POST') {
      const b = await body(req);
      // Kurs fehlt (z. B. Titel gerade erst hinzugekommen)? Sofort nachholen statt abzubrechen
      if (b.sym && market.INSTRUMENTS[b.sym] && !market.get()[b.sym]) { try { await market.add(b.sym, {silent: true}); } catch (e) {} }
      const bk = bookOf(u, url), st = bk ? bk.st : store.load(u.id), eqBefore = game.equity(st, 'now', funds.navOf);
      const r = b.limit ? game.placeLimit(st, b, funds.navOf) : game.open(st, b, funds.navOf);
      if (bk) bk.save(); else store.save(u.id, st);
      heldCache.t = 0;
      if (r.position) { if (!bk) copy.onOpen(u.id, r.position, eqBefore); arenas.onTrade(u.id, bk && bk.arena.id, {kind: 'open', text: posText(r.position, 'eröffnet')}); }
      return send(res, 200, {state: stateView(u.id, bk), events: r.events, limit: b.limit ? {executed: !!r.executed} : undefined});
    }
    if (/^\/api\/orders\/[\w]+$/.test(p) && m === 'DELETE') {
      const bk = bookOf(u, url), st = bk ? bk.st : store.load(u.id);
      game.cancelLimit(st, p.split('/').pop());
      if (bk) bk.save(); else store.save(u.id, st);
      return send(res, 200, {state: stateView(u.id, bk)});
    }
    if (/^\/api\/positions\/[\w-]+\/close$/.test(p) && m === 'POST') {
      const pid = p.split('/')[3], bk = bookOf(u, url), st = bk ? bk.st : store.load(u.id), pos = st.pos.find(x => x.id === pid), own = !(pos || {}).copyId;
      const r = game.close(st, pid, null, funds.navOf);
      if (bk) bk.save(); else { store.save(u.id, st); if (own) copy.onClose(u.id, pid); }
      if (own && pos && pos.kind !== 'fund') arenas.onTrade(u.id, bk && bk.arena.id, {kind: 'close', text: `${posText(pos, 'schließt')} · ${r.pl >= 0 ? '+' : '−'}${Math.abs(r.pl / pos.stake * 100).toFixed(1).replace('.', ',')} %`, pl: r.pl / pos.stake});
      return send(res, 200, {state: stateView(u.id, bk), pl: r.pl, events: r.events});
    }
    // Private Arenen
    if (p === '/api/arenas' && m === 'GET') return send(res, 200, {arenas: arenas.mine(u), league: arenas.leagueView(u.id)});
    if (p === '/api/arenas' && m === 'POST') { const a = arenas.create(u, await body(req)); return send(res, 200, arenas.detail(a.slug, u)); }
    if (/^\/api\/arenas\/by\/[\w-]+\/join$/.test(p) && m === 'POST') { const a = arenas.join(u, p.split('/')[4], await body(req)); return send(res, 200, arenas.detail(a.slug, u)); }
    if (/^\/api\/arenas\/\d+(\/\w+)?$/.test(p) && m !== 'GET') {
      const id = Number(p.split('/')[3]), act = p.split('/')[4], b = m === 'DELETE' ? {} : await body(req);
      if (act === 'leave') arenas.leave(u, id);
      else if (act === 'round') arenas.newRound(u, id);
      else if (act === 'kick') arenas.kick(u, id, b.userId);
      else if (!act && m === 'PATCH') arenas.update(u, id, b);
      else if (!act && m === 'DELETE') arenas.remove(u, id);
      else return send(res, 404, {error: 'Unbekannte Route'});
      return send(res, 200, {ok: true});
    }
    if (/^\/api\/arenas\/feed\/\d+\/react$/.test(p) && m === 'POST') return send(res, 200, {feed: arenas.react(u, Number(p.split('/')[4]), (await body(req)).emoji)});
    // Scouting & Talents
    if (p === '/api/talents/apply' && m === 'POST') { talents.apply(u, await body(req)); return send(res, 200, talents.view(u)); }
    if (p === '/api/admin/talents' && m === 'GET') return send(res, 200, talents.board(u, url.searchParams.get('q')));
    if (/^\/api\/admin\/talents\/\d+$/.test(p) && m === 'PATCH') { talents.updateApp(u, Number(p.split('/').pop()), await body(req)); return send(res, 200, talents.board(u)); }
    if (p === '/api/copy' && m === 'POST') { onlyMain(Number(url.searchParams.get('book'))); const b = await body(req); copy.start(u.id, b.leaderId, b.amt); heldCache.t = 0; return send(res, 200, {state: stateView(u.id)}); }
    if (/^\/api\/copy\/[\w-]+\/stop$/.test(p) && m === 'POST') {
      const pl = copy.stop(u.id, p.split('/')[3]); return send(res, 200, {state: stateView(u.id), pl});
    }
    return send(res, 404, {error: 'Unbekannte Route'});
  } catch (e) { return fail(res, e); }
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
function serveArenaLink(res, slug) {
  const pv = arenas.preview(slug);
  let html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  if (pv) html = html.replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(pv.title)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(pv.description)}">`)
    .replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${config.baseUrl}/img/og-arena.jpg">
<meta property="og:image:type" content="image/jpeg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Einladung in die Investment Arena mit Florian Homm"><meta property="og:type" content="website">
<meta property="og:url" content="${config.baseUrl}/a/${esc(slug)}"><meta property="og:site_name" content="Investment Arena">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${config.baseUrl}/img/og-arena.jpg">`)
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(pv.title)}</title>`);
  res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache'});
  res.end(html);
}
function serveStatic(req, res, url) {
  const al = url.pathname.match(/^\/a\/([\w-]{1,60})\/?$/); if (al) return serveArenaLink(res, al[1]);
  const qr = url.pathname.match(/^\/qr\/a\/([\w-]{1,60})\.svg$/);
  if (qr) return require('qrcode').toString(`${config.baseUrl}/a/${qr[1]}`, {type: 'svg', margin: 1, color: {dark: '#05070f', light: '#ffffff'}})
    .then(svg => { res.writeHead(200, {'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400'}); res.end(svg); });
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
  const closed = [];
  const filled = [];
  for (const u of store.all()) {
    const ev = game.check(u.st, funds.navOf), lo = game.checkOrders(u.st, funds.navOf); if (!ev.length && !lo.length) continue;
    store.save(u.userId, u.st);
    for (const e of ev) if (!e.copy) closed.push([u.userId, e.id, e.why]);
    for (const e of lo) if (e.type === 'filled') filled.push([u.userId, e]);
  }
  for (const [uid, e] of filled) { copy.onOpen(uid, e.position, e.eqBefore); arenas.onTrade(uid, null, {kind: 'open', text: posText(e.position, 'eröffnet (Limit)')}); }
  // Erst danach die Kopierer nachziehen, damit kein veralteter Spielstand gespeichert wird
  for (const [leader, id, why] of closed) { copy.onClose(leader, id, why); arenas.onTrade(leader, null, {kind: 'auto', text: `${why}: eine Position wurde automatisch geschlossen`}); }
  // Eigene Arena-Depots: Stop-Loss, Knock-out und Verfall ebenso
  for (const b of arenas.allBooks()) {
    const ev = game.check(b.st, funds.navOf), lo = game.checkOrders(b.st, funds.navOf); if (!ev.length && !lo.length) continue;
    try { const bk = arenas.loadBook(b.userId, b.arenaId); Object.assign(bk.st, {pos: b.st.pos, cash: b.st.cash, hist: b.st.hist, realized: b.st.realized, orders: b.st.orders, ts: b.st.ts, badges: b.st.badges, xp: b.st.xp}); bk.save(); } catch (e) {}
    for (const e of lo) if (e.type === 'filled') arenas.onTrade(b.userId, b.arenaId, {kind: 'open', text: posText(e.position, 'eröffnet (Limit)')});
    for (const e of ev) arenas.onTrade(b.userId, b.arenaId, {kind: 'auto', text: `${e.why}: eine Position wurde automatisch geschlossen`});
  }
}
async function tick() { await market.refresh(); checkAllBooks(); }

// Welche Titel werden gerade gehalten (Positionen und Fonds)? Für die Kursbeobachtung der Zusatztitel.
const qFundHoldings = db.prepare("SELECT holdings FROM funds WHERE kind != 'guru'");
let heldCache = {t: 0, set: new Set()};
function held() {
  if (Date.now() - heldCache.t < 30_000) return heldCache.set;
  const set = new Set();
  for (const u of store.all()) { for (const p of u.st.pos) if (p.sym) set.add(p.sym); for (const s of u.st.watch || []) set.add(s); for (const o of u.st.orders || []) set.add(o.sym); }
  for (const r of qFundHoldings.all()) for (const h of JSON.parse(r.holdings)) set.add(h.sym);
  for (const b of arenas.allBooks()) for (const p of b.st.pos) if (p.sym) set.add(p.sym);
  heldCache = {t: Date.now(), set};
  return set;
}

async function start() {
  market.setHeldProvider(held);
  // TRCM- und Großinvestoren-Titel: Kurse holen, aber die Marktliste nicht damit füllen
  market.setPrivateProvider(() => new Set([...trcm.symbols(), ...gurus.symbols()]));
  bots.seed();
  if (require.main === module) {
    await market.refresh().catch(() => {});
    radar.refresh().catch(() => {});
    setInterval(() => tick().catch(() => {}), 30_000);
    setInterval(() => radar.refresh().catch(() => {}), 30 * 60_000);
    setInterval(() => auth.cleanupDemo(), 60 * 60_000);
    market.loadDirectory(); setInterval(() => market.loadDirectory(), 6 * 3600_000);
    gurus.sync().then(() => { heldCache.t = 0; return smart.sync(); }).catch(() => {});
    setInterval(() => gurus.sync().then(() => { heldCache.t = 0; return smart.sync(); }).catch(() => {}), 12 * 3600_000);
    copy.snapshot(); arenas.snapshot();
    setInterval(() => { copy.snapshot(); arenas.snapshot(); talents.invalidate(); }, 10 * 60_000);
  }
  if (require.main !== module) { await gurus.sync(); await smart.sync(); }   // Tests: Großinvestoren aus den mitgelieferten Meldungen
  return new Promise(r => server.listen(config.port, () => { console.log(`Investment Arena läuft auf ${config.baseUrl} (Port ${server.address().port})`); r(server); }));
}

if (require.main === module) start();
module.exports = {start, server};
