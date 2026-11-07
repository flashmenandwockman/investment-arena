// Ende-zu-Ende-Tests der API mit Offline-Kursen und temporärer Datenbank
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-test-'));
process.env.MARKET_OFFLINE = '1';
process.env.PORT = '0';
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

test('Free-Homes-Login ist ohne Konfiguration aus', async () => {
  const r = await client()('/api/auth/freehomes/start');
  assert.strictEqual(r.status, 404);
});
