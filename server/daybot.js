// Täglicher Test-Trader: Jeden Tag entsteht ein neues Bot-Konto, das aus den Tagesnachrichten handelt.
// Es liest „Aktuell“ und die Postings von Florian Homm, erkennt die genannten Titel, entscheidet nach dem Ton der
// Schlagzeile zwischen Long und Short, hebelt (2× bis 5×), setzt Stop und Ziel und steigt im Lauf des Tages aus.
// Ältere Test-Trader werden nach 14 Tagen gelöscht. Ersetzt die frühere Beispiel-Community.
const db = require('./db');
const market = require('./market');
const game = require('./game');
const store = require('./store');
const funds = require('./funds');
const news = require('./news');
const homm = require('./homm');

const qToday = db.prepare("SELECT id FROM users WHERE provider = 'daybot' AND provider_sub = ?");
const qAll = db.prepare("SELECT id, provider_sub, created_at FROM users WHERE provider = 'daybot' ORDER BY created_at DESC");
const qIns = db.prepare("INSERT INTO users (email, name, pass, provider, provider_sub, bio, color, is_bot, created_at) VALUES (NULL, ?, NULL, 'daybot', ?, ?, ?, 1, ?)");
const qDel = db.prepare('DELETE FROM users WHERE id = ?');
const qOldExamples = db.prepare("DELETE FROM users WHERE provider = 'bot'");

const COLORS = ['#8fd3ff', '#f3e2bd', '#ffb38a', '#b7a6ff', '#a6f0c6', '#ff9aa8', '#e0c28a', '#9fe3e0', '#ffd48a'];
const POS = /\b(rekord|record|allzeithoch|rally|rallye|steigt|steigen|surge|surges|soars|jumps|beats|übertrifft|übertroffen|gewinn|boom|erholt|recover|stabil|hoch|high|kaufen|buy|upgrade|zinssenkung|rate cut)\b/i;
const NEG = /\b(fällt|fallen|sinkt|crash|sell-?off|ausverkauf|warnt|warnung|drops|slips|falls|schwächelt|schwäche|verfehlt|misses|rezession|recession|sorgen|unter druck|pressure|knock|einbruch|plunge|zölle|tariff|verkaufen|downgrade|zinserhöhung|rate hike|inflation)\b/i;
const day = d => new Date(d).toISOString().slice(0, 10);
const fmtDay = d => new Date(d).toLocaleDateString('de-DE', {day: '2-digit', month: '2-digit'});

// Titel aus den Schlagzeilen des Tages und den Postings von Florian Homm, mit Richtung aus dem Ton der Meldung
function ideas() {
  const q = market.get(), out = [], seen = new Set();
  const push = (sym, dir, why) => { if (!seen.has(sym) && q[sym] && q[sym].price && market.INSTRUMENTS[sym] && !market.INSTRUMENTS[sym].x) { seen.add(sym); out.push({sym, dir, why}); } };
  for (const n of news.get().items || []) {
    const dir = NEG.test(n.h) && !POS.test(n.h) ? -1 : 1;
    for (const s of homm.detectSyms([n.h])) push(s, dir, n.h);
  }
  for (const it of homm.view(null, 6).items || []) for (const s of it.syms || []) push(s, 1, it.kick);
  // Auffüllen mit den größten Tagesbewegungen (Trend folgen)
  const movers = Object.keys(market.INSTRUMENTS).filter(s => !market.INSTRUMENTS[s].x && q[s] && q[s].prev).sort((a, b) => Math.abs(q[b].price / q[b].prev - 1) - Math.abs(q[a].price / q[a].prev - 1));
  for (const s of movers) { if (out.length >= 3) break; push(s, q[s].price >= q[s].prev ? 1 : -1, 'Tagesbewegung'); }
  return out.slice(0, 3);
}

function trade(id, list) {
  const st = store.load(id); st.mode = 'pro';
  list.forEach((x, i) => {
    const lev = [2, 5, 2][i % 3], amt = [15000, 12000, 10000][i % 3];
    try { game.open(st, {sym: x.sym, dir: x.dir, kind: 'lev', lev, amt, sl: 0.1, tp: 0.2, note: `Test-Trader: ${x.why.slice(0, 120)}`}, funds.navOf); }
    catch (e) { try { game.open(st, {sym: x.sym, dir: x.dir, kind: 'stock', amt, sl: 0.1, note: `Test-Trader: ${x.why.slice(0, 120)}`}, funds.navOf); } catch (e2) {} }
  });
  store.save(id, st);
}

// Ausstieg: Gewinne ab +6 % mitnehmen, nach 20 Stunden alles schließen; Stop und Ziel prüft der Server ohnehin
function manage(id, createdAt) {
  const st = store.load(id); let changed = false;
  for (const p of [...st.pos]) {
    const v = game.value(p, 'now', funds.navOf), pl = v / p.stake - 1, old = Date.now() - createdAt > 20 * 3600e3;
    if (pl >= 0.06 || old) { try { game.close(st, p.id, old ? 'Tagesende' : 'Gewinn mitgenommen', funds.navOf); changed = true; } catch (e) {} }
  }
  if (changed) store.save(id, st);
}

function ensure() {
  qOldExamples.run();
  const today = day(Date.now()), bots = qAll.all();
  for (const b of bots) {
    if (Date.now() - b.created_at > 14 * 86400e3) qDel.run(b.id);
    else manage(b.id, b.created_at);
  }
  if (qToday.get(today)) return;
  const n = bots.length % COLORS.length;
  const id = Number(qIns.run(`Test-Trader ${fmtDay(Date.now())}`, today, 'Test-Trader · handelt aus den Tagesnachrichten', COLORS[n], Date.now()).lastInsertRowid);
  const st = game.fresh(); st.mode = 'pro'; store.save(id, st);
  trade(id, ideas());
}

module.exports = {ensure, ideas};
