// Spielstände je Nutzer laden und speichern
const db = require('./db');
const game = require('./game');

const qGet = db.prepare('SELECT json FROM states WHERE user_id = ?');
const qPut = db.prepare('INSERT INTO states (user_id, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at');
// Alle Mitglieder, auch solche ohne gespeicherten Spielstand (noch kein Trade)
const qAll = db.prepare('SELECT u.id AS user_id, s.json, u.name, u.bio, u.color, u.is_bot, u.provider FROM users u LEFT JOIN states s ON s.user_id = u.id');

function load(userId) {
  const row = qGet.get(userId);
  return row ? {...game.fresh(), ...JSON.parse(row.json)} : game.fresh();
}
function save(userId, st) {
  if (st.hist.length > 200) st.hist = st.hist.slice(-200);
  qPut.run(userId, JSON.stringify(st), Date.now());
}
function all() { return qAll.all().map(r => ({userId: r.user_id, name: r.name, bio: r.bio, color: r.color, isBot: !!r.is_bot, provider: r.provider, st: {...game.fresh(), ...(r.json ? JSON.parse(r.json) : {})}})); }

module.exports = {load, save, all};
