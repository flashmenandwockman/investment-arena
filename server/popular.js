// Beliebteste Titel des Tages in der Arena: wer hält was, wer beobachtet was, was wird aufgerufen.
// Grundlage für die Kursübersicht (3 Aktien, 2 Rohstoffe, 2 ETFs, 2 Kryptowerte). Alle 10 Minuten neu berechnet.
const store = require('./store');
const market = require('./market');

let cache = {t: 0, scores: {}};
const DAY = 86400e3;

function compute() {
  const now = Date.now(), scores = {};
  const add = (sym, w) => { if (!sym || !market.INSTRUMENTS[sym]) return; scores[sym] = (scores[sym] || 0) + w; };
  for (const u of store.all()) {
    const w = u.isBot ? 0.3 : 1;   // Beispiel-Community zählt schwächer als echte Mitglieder
    const held = new Set();
    for (const p of u.st.pos || []) if (p.sym && !p.copyId) { held.add(p.sym); if (p.openedTs && now - p.openedTs < DAY) add(p.sym, 2 * w); }
    for (const s of held) add(s, 3 * w);
    for (const o of u.st.orders || []) add(o.sym, 2 * w);
    for (const s of u.st.watch || []) add(s, 1 * w);
  }
  for (const [s, t] of market.viewed) if (now - t < DAY) add(s, 1);
  return scores;
}

function get() {
  if (Date.now() - cache.t > 10 * 60_000) cache = {t: Date.now(), scores: compute()};
  return cache.scores;
}

module.exports = {get, invalidate: () => { cache.t = 0; }};
