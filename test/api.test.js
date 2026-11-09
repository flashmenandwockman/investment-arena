// Ende-zu-Ende-Tests der API mit Offline-Kursen und temporärer Datenbank
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-test-'));
process.env.MARKET_OFFLINE = '1';
process.env.PORT = '0';
process.env.THROTTLE_OFF = '1';
const {start} = require('../server/index');

let base, server;
function client() {
  let cookie = '';
  return async (p, body, method) => {
    const r = await fetch(base + p, {method: method || (body ? 'POST' : 'GET'), headers: {...(body ? {'Content-Type': 'application/json'} : {}), ...(cookie ? {Cookie: cookie} : {})}, body: body ? JSON.stringify(body) : undefined, redirect: 'manual'});
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const data = await r.json().catch(() => null);
    return {status: r.status, data};
  };
}

test.before(async () => { server = await start(); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());

test('Konfiguration und Kurse sind öffentlich', async () => {
  const c = client();
  const cfg = await c('/api/config');
  assert.strictEqual(cfg.data.freehomes, false);
  const q = await c('/api/quotes');
  assert.ok(q.data.quotes.AAPL.price > 0);
  assert.ok(Object.keys(q.data.instruments).length >= 19);
});

test('Registrieren, Handeln, Schließen, Abmelden', async () => {
  const c = client();
  assert.strictEqual((await c('/api/state')).status, 401);
  assert.strictEqual((await c('/api/auth/register', {name: 'Test', email: 'a@b.de', password: 'kurz'})).status, 400);
  const reg = await c('/api/auth/register', {name: 'Test', email: 'a@b.de', password: 'geheim1234'});
  assert.strictEqual(reg.status, 200);
  assert.strictEqual((await c('/api/auth/register', {name: 'X', email: 'a@b.de', password: 'geheim1234'})).status, 400, 'E-Mail doppelt');

  const opt = await c('/api/orders', {sym: 'AAPL', dir: 1, kind: 'option', amt: 1000});
  assert.match(opt.data.error, /Profi-Modus/);
  const lev20 = await c('/api/orders', {sym: 'AAPL', dir: 1, kind: 'lev', lev: 20, amt: 1000});
  assert.strictEqual(lev20.status, 400, 'Hebel 20 nur im Profi-Modus');

  const o = await c('/api/orders', {sym: 'NVDA', dir: -1, kind: 'lev', lev: 5, amt: 5000, sl: 0.1});
  assert.strictEqual(o.status, 200);
  assert.strictEqual(o.data.state.cash, 95000);
  assert.ok(o.data.events.some(e => e.key === 'short'));
  assert.strictEqual((await c('/api/orders', {sym: 'NVDA', dir: 1, amt: 999999})).status, 400, 'nicht genug Geld');

  await c('/api/state', {mode: 'pro'}, 'PATCH');
  const call = await c('/api/orders', {sym: 'SAP.DE', dir: 1, kind: 'option', mny: 0.05, tenor: 63, amt: 2000});
  assert.strictEqual(call.status, 200);
  assert.ok(call.data.state.positions.find(p => p.kind === 'option').strike > 0);

  const id = o.data.state.positions[0].id;
  const cl = await c(`/api/positions/${id}/close`, {});
  assert.strictEqual(cl.status, 200);
  assert.ok(Math.abs(cl.data.state.cash - 98000) < 1);

  assert.strictEqual((await c('/api/state/reset', {})).status, 400, 'Zurücksetzen nur mit Bestätigung');
  assert.strictEqual((await c('/api/state')).data.positions.length, 1);
  const rs = await c('/api/state/reset', {confirm: true});
  assert.strictEqual(rs.data.positions.length, 0);
  assert.strictEqual(rs.data.cash, 100000);

  await c('/api/auth/logout', {});
  assert.strictEqual((await c('/api/state')).status, 401);
  assert.strictEqual((await c('/api/auth/login', {email: 'a@b.de', password: 'falsch123'})).status, 400);
  assert.strictEqual((await c('/api/auth/login', {email: 'a@b.de', password: 'geheim1234'})).status, 200);
});

test('Community-Fonds gründen und investieren', async () => {
  const manager = client(), anleger = client();
  await manager('/api/auth/demo', {});
  await anleger('/api/auth/demo', {});
  const bad = await manager('/api/funds', {name: 'Zu klein', holdings: [{sym: 'AAPL', dir: 1, w: 100}]});
  assert.strictEqual(bad.status, 400);
  const wrongSum = await manager('/api/funds', {name: 'Summe', holdings: [{sym: 'AAPL', dir: 1, w: 30}, {sym: 'TSLA', dir: -1, w: 30}, {sym: 'GC=F', dir: 1, w: 30}]});
  assert.match(wrongSum.data.error, /100 %/);
  const f = await manager('/api/funds', {name: 'Test-Fonds', strategy: 'Test', holdings: [{sym: 'AAPL', dir: 1, w: 40}, {sym: 'TSLA', dir: -1, w: 30}, {sym: 'GC=F', dir: 1, w: 30}]});
  assert.strictEqual(f.status, 200);
  const d = await anleger(`/api/funds/${f.data.id}`);
  assert.ok(Math.abs(d.data.nav - 100) < 1e-6);
  assert.strictEqual((await manager(`/api/funds/${f.data.id}/invest`, {amt: 1000})).status, 400, 'nicht in eigenen Fonds');
  const inv = await anleger(`/api/funds/${f.data.id}/invest`, {amt: 2500});
  assert.strictEqual(inv.status, 200);
  assert.strictEqual(inv.data.state.positions[0].kind, 'fund');
  const list = await anleger('/api/funds');
  assert.strictEqual(list.data.funds.find(x => x.id === f.data.id).investors, 1);
});

test('Rangliste und Profile', async () => {
  const c = client();
  await c('/api/auth/demo', {});
  const lb = await c('/api/leaderboard');
  assert.ok(lb.data.rows.length >= 10, 'Beispiel-Community vorhanden');
  assert.ok(lb.data.rows.some(r => r.me));
  const bot = lb.data.rows.find(r => r.bot);
  const pr = await c(`/api/profile/${bot.id}`);
  assert.ok(pr.data.equity > 0 && pr.data.items.length > 0);
});

test('Suche nach Titeln', async () => {
  const c = client();
  assert.strictEqual((await c('/api/search?q=apple')).status, 401, 'nur angemeldet');
  await c('/api/auth/demo', {});
  const r = await c('/api/search?q=nvid');
  assert.ok(r.data.results.some(x => x.sym === 'NVDA'), 'lokale Titel werden gefunden');
  const add = await c('/api/instrument/NVDA');
  assert.strictEqual(add.data.sym, 'NVDA');
  const bad = await c('/api/instrument/ZZZZZ');
  assert.strictEqual(bad.status, 400, 'offline keine neuen Titel');
});

test('Free-Homes-Login ist ohne Konfiguration aus', async () => {
  const r = await client()('/api/auth/freehomes/start');
  assert.strictEqual(r.status, 404);
});

test('TRCM-Portfolio: Admin pflegt, nur Mitglieder sehen die Titel', async () => {
  const db = require('../server/db');
  const admin = client(), member = client(), guest = client();
  await admin('/api/auth/register', {name: 'Analyst', email: 'analyst@trcm.de', password: 'geheim1234'});
  await member('/api/auth/register', {name: 'Mitglied', email: 'm@fh.de', password: 'geheim1234'});
  await guest('/api/auth/demo', {});

  // Ohne Admin-Rolle keine Pflege
  assert.strictEqual((await admin('/api/admin/trcm/holdings', {sym: 'AAPL', w: 10})).status, 403);
  db.prepare("UPDATE users SET role = 'admin' WHERE email = ?").run('analyst@trcm.de');
  db.prepare("UPDATE users SET provider = 'freehomes', provider_sub = 'fh-1' WHERE email = ?").run('m@fh.de');
  assert.strictEqual((await admin('/api/me')).data.user.admin, true);

  const a = await admin('/api/admin/trcm/holdings', {sym: 'AAPL', dir: 1, w: 20, note: 'Kernposition'});
  assert.strictEqual(a.status, 200);
  assert.strictEqual((await admin('/api/admin/trcm/holdings', {sym: 'AAPL', w: 5})).status, 400, 'kein Titel doppelt');
  const t = await admin('/api/admin/trcm/holdings', {sym: 'TSLA', dir: -1, w: 10, p0: '500,5', since: '2026-01-15'});
  const tsla = t.data.holdings.find(h => h.sym === 'TSLA');
  assert.strictEqual(tsla.p0, 500.5);
  assert.ok(tsla.perf > 0, 'Short gewinnt, wenn der Kurs unter dem Einstieg liegt');

  // Korrektur, Verkauf, Löschen
  const aapl = t.data.holdings.find(h => h.sym === 'AAPL');
  const c = await admin(`/api/admin/trcm/holdings/${aapl.id}`, {w: 25, p0: 100}, 'PATCH');
  assert.strictEqual(c.data.holdings.find(h => h.sym === 'AAPL').w, 25);
  const cl = await admin(`/api/admin/trcm/holdings/${tsla.id}/close`, {});
  assert.strictEqual(cl.data.holdings.length, 1);
  assert.strictEqual(cl.data.closed[0].sym, 'TSLA');
  assert.ok(cl.data.log.length >= 4, 'Änderungen werden protokolliert');

  // Sichtbarkeit
  const pub = await guest('/api/trcm');
  assert.strictEqual(pub.data.count, 1);
  assert.ok(pub.data.perf !== 0);
  assert.strictEqual(pub.data.holdings, undefined, 'Gäste sehen keine Titel');
  assert.strictEqual(pub.data.log, undefined);
  assert.strictEqual((await client()('/api/trcm')).data.holdings, undefined, 'ohne Anmeldung keine Titel');
  const mem = await member('/api/trcm');
  assert.strictEqual(mem.data.holdings[0].sym, 'AAPL');
  assert.strictEqual(mem.data.log, undefined, 'Protokoll nur für Admins');
  assert.strictEqual((await member(`/api/admin/trcm/holdings/${aapl.id}`, undefined, 'DELETE')).status, 403);

  assert.strictEqual((await admin(`/api/admin/trcm/holdings/${aapl.id}`, undefined, 'DELETE')).data.holdings.length, 0);
});

test('Copy Trading: Positionen übernehmen, nachbilden, beenden', async () => {
  const leader = client(), fan = client();
  const L = (await leader('/api/auth/register', {name: 'Vorbild', email: 'vorbild@x.de', password: 'geheim1234'})).data.user;
  await fan('/api/auth/register', {name: 'Fan', email: 'fan@x.de', password: 'geheim1234'});
  await leader('/api/orders', {sym: 'AAPL', dir: 1, amt: 20000});
  assert.strictEqual((await fan('/api/copy', {leaderId: L.id, amt: 100})).status, 400, 'Mindestbetrag');
  assert.strictEqual((await leader('/api/copy', {leaderId: L.id, amt: 1000})).status, 400, 'nicht sich selbst');
  const c = await fan('/api/copy', {leaderId: L.id, amt: 10000});
  assert.strictEqual(c.status, 200);
  const cs = c.data.state;
  assert.strictEqual(cs.cash, 90000);
  const mirrored = cs.positions.filter(p => p.copyId);
  assert.strictEqual(mirrored.length, 1);
  assert.ok(Math.abs(mirrored[0].stake - 2000) <= 1, '20 % des Vorbilds → 20 % der Kopie');
  assert.ok(Math.abs(cs.equity - 100000) < 1);
  assert.strictEqual((await fan('/api/copy', {leaderId: L.id, amt: 1000})).status, 400, 'nicht doppelt');

  // Neue Order des Vorbilds wird anteilig nachgebildet (Hebel auch im Einsteiger-Modus)
  const o = await leader('/api/orders', {sym: 'TSLA', dir: -1, kind: 'lev', lev: 2, amt: 8000});
  let st = (await fan('/api/state')).data;
  const t = st.positions.find(p => p.copyId && p.sym === 'TSLA');
  assert.ok(t && t.lev === 2 && t.dir === -1 && Math.abs(t.stake - 800) <= 1);

  // Vorbild schließt → Kopie schließt
  const lid = o.data.state.positions.find(p => p.sym === 'TSLA').id;
  await leader(`/api/positions/${lid}/close`, {});
  st = (await fan('/api/state')).data;
  assert.ok(!st.positions.some(p => p.copyId && p.sym === 'TSLA'));

  const d = await fan('/api/discover');
  const me = d.data.traders.find(x => x.id === L.id);
  assert.strictEqual(me.copiers, 1);
  assert.ok(me.risk >= 1 && me.risk <= 7);
  assert.ok(d.data.traders.find(x => x.id === L.id && !x.me) && me.copying === true);

  const s = await fan(`/api/copy/${st.copies[0].id}/stop`, {});
  assert.strictEqual(s.data.state.copies.length, 0);
  assert.ok(!s.data.state.positions.some(p => p.copyId));
  assert.ok(Math.abs(s.data.state.cash - 100000) < 5);
});

test('Großinvestoren aus 13F-Meldungen sind kopierbar', async () => {
  const c = client();
  await c('/api/auth/demo', {});
  const d = await c('/api/discover');
  assert.ok(d.data.gurus.length >= 1, 'mindestens ein Großinvestor aus den mitgelieferten Meldungen');
  const g = d.data.gurus[0];
  assert.strictEqual(g.kind, 'guru');
  assert.strictEqual(g.source.type, '13F');
  assert.ok(!(await c('/api/funds')).data.funds.some(f => f.kind === 'guru'), 'nicht bei den Community-Fonds');
  assert.ok(!(await c('/api/leaderboard')).data.rows.some(r => r.name === g.manager), 'nicht in der Rangliste');
  const inv = await c(`/api/funds/${g.id}/invest`, {amt: 5000});
  assert.strictEqual(inv.status, 200);
  assert.strictEqual(inv.data.state.positions[0].fundKind, 'guru');
});

test('Private Arenen: eröffnen, beitreten, Rangliste, Feed', async () => {
  const anna = client(), ben = client(), gast = client();
  await anna('/api/auth/register', {name: 'Anna', email: 'anna@x.de', password: 'geheim1234'});
  await ben('/api/auth/register', {name: 'Ben', email: 'ben@x.de', password: 'geheim1234'});
  assert.strictEqual((await anna('/api/arenas', {name: 'ab'})).status, 400, 'Name zu kurz');

  // Format „Hauptdepot“
  const a = (await anna('/api/arenas', {name: 'Büro-Bullen', period: '1m'})).data;
  assert.strictEqual(a.slug, 'buero-bullen');
  assert.strictEqual(a.members, 1);
  assert.ok(a.owner && a.rows[0].ret === 0);
  const pv = await gast('/api/arenas/by/buero-bullen');
  assert.ok(pv.data.preview && pv.data.rows === undefined, 'Vorschau ohne Mitgliedschaft');
  const j = await ben('/api/arenas/by/buero-bullen/join', {});
  assert.strictEqual(j.data.members, 2);
  await ben('/api/orders', {sym: 'AAPL', dir: 1, amt: 5000});
  const f = (await anna('/api/arenas/by/buero-bullen')).data.feed;
  assert.ok(f.some(x => /Long Apple/.test(x.text)), 'Trade erscheint im Feed');
  const r = await anna(`/api/arenas/feed/${f[0].id}/react`, {emoji: '🔥'});
  assert.strictEqual(r.data.feed[0].reactions['🔥'], 1);
  assert.strictEqual((await gast(`/api/arenas/feed/${f[0].id}/react`, {emoji: '🔥'})).status, 401);

  // Zurücksetzen löscht das Arena-Ergebnis nicht
  const before = (await ben('/api/arenas/by/buero-bullen')).data.rows.find(x => x.name === 'Ben').ret;
  await ben('/api/state/reset', {confirm: true});
  const after = (await ben('/api/arenas/by/buero-bullen')).data.rows.find(x => x.name === 'Ben').ret;
  assert.ok(Math.abs(after - before) < 1e-6);

  // Format „Eigenes Arena-Depot“: Kopie des Hauptdepots, getrennte Orders
  await anna('/api/orders', {sym: 'MSFT', dir: 1, amt: 10000});
  const o = (await anna('/api/arenas', {name: 'Strategie Zwei', mode: 'own', start: 'copy'})).data;
  let bk = (await anna(`/api/state?book=${o.id}`)).data;
  assert.strictEqual(bk.book, o.id);
  assert.ok(bk.positions.some(p => p.sym === 'MSFT'), 'Hauptdepot hineinkopiert');
  await anna(`/api/orders?book=${o.id}`, {sym: 'TSLA', dir: -1, amt: 3000});
  bk = (await anna(`/api/state?book=${o.id}`)).data;
  assert.ok(bk.positions.some(p => p.sym === 'TSLA'));
  assert.ok(!(await anna('/api/state')).data.positions.some(p => p.sym === 'TSLA'), 'Hauptdepot bleibt unberührt');
  assert.strictEqual((await anna(`/api/copy?book=${o.id}`, {leaderId: 1, amt: 1000})).status, 400, 'Kopieren nur im Hauptdepot');
  await ben('/api/arenas/by/strategie-zwei/join', {start: 'fresh'});
  assert.strictEqual((await ben(`/api/state?book=${o.id}`)).data.cash, 100000);

  const mine = (await anna('/api/arenas')).data.arenas;
  assert.strictEqual(mine.length, 2);
  assert.strictEqual((await ben(`/api/arenas/${a.id}`, {name: 'Gekapert'}, 'PATCH')).status, 403, 'nur der Gründer');
  assert.strictEqual((await ben(`/api/arenas/${a.id}/leave`, {})).status, 200);
});

test('Talent-Programm: Nachricht, Checkliste, Bewerbung nur mit Shortlist', async () => {
  const c = client();
  await c('/api/auth/register', {name: 'Talent', email: 'talent@x.de', password: 'geheim1234'});
  const t = (await c('/api/talents')).data;
  assert.ok(t.message.title && t.message.text.length >= 2);
  assert.strictEqual(t.me.stage, 'locked');
  assert.strictEqual(t.me.checklist.items.length, 4);
  assert.strictEqual(t.me.checklist.eligible, false);
  const ap = await c('/api/talents/apply', {realName: 'Max Muster', strategy: 'x'.repeat(50), bestTrade: 'y'.repeat(50), goal: 'z'.repeat(30), consent: true});
  assert.strictEqual(ap.status, 403);
  assert.strictEqual((await c('/api/admin/talents')).status, 403, 'Scouting-Board nur für Admins');
});

test('Talent-Programm: Shortlist, Vorstellung, Scouting-Board', async () => {
  const db = require('../server/db'), store = require('../server/store');
  const t = client(), admin = client();
  const u = (await t('/api/auth/register', {name: 'Profi', email: 'profi@x.de', password: 'geheim1234'})).data.user;
  await admin('/api/auth/register', {name: 'Scout', email: 'scout@x.de', password: 'geheim1234'});
  db.prepare("UPDATE users SET role = 'admin' WHERE email = 'scout@x.de'").run();
  // 40 Tage stetiger Verlauf, 25 Trades mit Stop-Loss und Begründung, Free-Homes-Konto
  db.prepare("UPDATE users SET provider = 'freehomes', provider_sub = 'fh-profi' WHERE id = ?").run(u.id);
  const ins = db.prepare('INSERT INTO equity_hist (user_id, day, eq) VALUES (?, ?, ?)');
  for (let i = 40; i >= 1; i--) ins.run(u.id, new Date(Date.now() - i * 864e5).toISOString().slice(0, 10), 100000 * (1 + (40 - i) * .001 + (i % 3 ? 0 : -.0005)));
  const st = store.load(u.id); st.ts = {n: 25, sl: 25, big: 0, notes: 25}; st.cash = 104000; store.save(u.id, st);
  require('../server/talents').invalidate();
  const v = (await t('/api/talents')).data;
  assert.strictEqual(v.me.checklist.eligible, true);
  assert.strictEqual(v.me.stage, 'shortlist', `Score ${v.me.score.total}`);
  const bad = await t('/api/talents/apply', {realName: 'Paula Profi', strategy: 'zu kurz', bestTrade: 'y'.repeat(50), goal: 'z'.repeat(30), consent: true});
  assert.strictEqual(bad.status, 400);
  const noConsent = await t('/api/talents/apply', {realName: 'Paula Profi', strategy: 'x'.repeat(50), bestTrade: 'y'.repeat(50), goal: 'z'.repeat(30)});
  assert.match(noConsent.data.error, /zustimmen/);
  const ok = await t('/api/talents/apply', {realName: 'Paula Profi', strategy: 'x'.repeat(50), bestTrade: 'y'.repeat(50), goal: 'z'.repeat(30), video: 'https://youtu.be/abc', consent: true});
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.data.me.application.status, 'neu');
  const b = (await admin('/api/admin/talents')).data;
  assert.strictEqual(b.apps.length, 1);
  assert.strictEqual(b.apps[0].realName, 'Paula Profi');
  const up = await admin(`/api/admin/talents/${b.apps[0].id}`, {status: 'gespraech', notes: 'Starker Risikomanager'}, 'PATCH');
  assert.strictEqual(up.data.apps[0].status, 'gespraech');
  assert.strictEqual((await t('/api/talents')).data.me.stage, 'pitch');
});

test('Kursziel, freier Stop, Watchlist, Stimmung, Kerzen', async () => {
  const c = client();
  await c('/api/auth/register', {name: 'Ziel', email: 'ziel@x.de', password: 'geheim1234'});
  const o = await c('/api/orders', {sym: 'AAPL', dir: 1, kind: 'lev', lev: 3, amt: 3000, sl: 0.03, tp: 0.09});
  const p = o.data.state.positions[0];
  assert.strictEqual(p.sl, 0.03); assert.strictEqual(p.tp, 0.09);
  const bad = await c('/api/orders', {sym: 'MSFT', dir: 1, amt: 1000, sl: 0.9});
  assert.strictEqual(bad.data.state.positions.find(x => x.sym === 'MSFT').sl, undefined, 'Stop über 50 % wird ignoriert');
  // Ziel erreicht: Kurs künstlich über das Ziel heben und Prüfung auslösen
  const market = require('../server/market'), game = require('../server/game'), store = require('../server/store'), funds = require('../server/funds');
  const q = market.get().AAPL, old = q.price; q.price = p.entry * 1.1;
  const u = (await c('/api/me')).data.user, st = store.load(u.id), ev = game.check(st, funds.navOf); q.price = old;
  assert.ok(ev.some(e => e.why === 'Ziel erreicht'));

  let w = await c('/api/state', {watch: {NVDA: true, 'BTC/EUR': true, NOPE: true}}, 'PATCH');
  assert.deepStrictEqual(w.data.watch, ['NVDA', 'BTC/EUR']);
  w = await c('/api/state', {watch: {NVDA: false}}, 'PATCH');
  assert.deepStrictEqual(w.data.watch, ['BTC/EUR']);
  w = await c('/api/state', {lesson: 'short'}, 'PATCH');
  assert.ok(w.data.lessons.short > 0);

  const s = (await client()('/api/sentiment/MSFT')).data;
  assert.ok(s.traders >= 1 && Math.abs(s.long + s.short - 1) < 1e-9);
  const ch = (await c('/api/chart?sym=AAPL&r=3mo')).data;
  assert.ok(ch.points.length > 10 && ch.points[0].length === 5, 'Kerzen mit Eröffnung, Hoch, Tief');
  assert.ok(ch.points.every(k => k[3] >= Math.max(k[1], k[2]) && k[4] <= Math.min(k[1], k[2])));
});
