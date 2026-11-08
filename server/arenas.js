// Private Arenen: eigene Gruppen mit Freunden, Kollegen und Bekannten (ähnlich wie Tipprunden).
// Zwei Formate:
//   main – alle treten mit ihrem Hauptdepot an, gewertet wird die Rendite ab dem Beitritt
//   own  – jedes Mitglied hat für diese Arena ein eigenes Depot (neu mit 100.000 € oder als Kopie des Hauptdepots)
// Dazu: Einladungslink, Rangliste mit Auf- und Abstiegen, Aktivitäts-Feed mit Reaktionen, Gruppen-Liga.
const db = require('./db');
const config = require('./config');
const game = require('./game');
const store = require('./store');
const funds = require('./funds');

db.exec(`
CREATE TABLE IF NOT EXISTS arenas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'main',            -- main | own
  period TEXT NOT NULL DEFAULT '1m',            -- 1m | 3m | open | until
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  visibility TEXT NOT NULL DEFAULT 'private',   -- private | public
  show_trades INTEGER NOT NULL DEFAULT 1,
  round INTEGER NOT NULL DEFAULT 1,
  final TEXT,                                   -- Endstand der Runde (JSON)
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS arena_members (
  arena_id INTEGER NOT NULL REFERENCES arenas(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  base_eq REAL NOT NULL,                        -- Depotwert zu Rundenbeginn bzw. beim Beitritt
  carry REAL NOT NULL DEFAULT 1,                -- Ergebnis vor einem Zurücksetzen des Hauptdepots (Verluste bleiben stehen)
  book TEXT,                                    -- eigenes Arena-Depot (Format own), JSON
  PRIMARY KEY (arena_id, user_id)
);
CREATE TABLE IF NOT EXISTS arena_feed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arena_id INTEGER NOT NULL REFERENCES arenas(id) ON DELETE CASCADE,
  user_id INTEGER,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,                           -- join | open | close | auto | round
  text TEXT NOT NULL,
  pl REAL
);
CREATE INDEX IF NOT EXISTS arena_feed_arena ON arena_feed(arena_id, id);
CREATE TABLE IF NOT EXISTS arena_reactions (
  feed_id INTEGER NOT NULL REFERENCES arena_feed(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  emoji TEXT NOT NULL,
  PRIMARY KEY (feed_id, user_id)
);
CREATE TABLE IF NOT EXISTS arena_ranks (
  arena_id INTEGER NOT NULL, user_id INTEGER NOT NULL, day TEXT NOT NULL, rank INTEGER NOT NULL, ret REAL NOT NULL,
  PRIMARY KEY (arena_id, user_id, day)
);
`);

const EMOJIS = ['🔥', '🚀', '😂', '🐻'];
const PERIODS = {'1m': 30, '3m': 91};
const MAX_OWNED = 10, MAX_MEMBERS = 200;
const err = (m, status = 400) => Object.assign(new Error(m), {status});
const dayStr = (ago = 0) => new Date(Date.now() - ago * 864e5).toISOString().slice(0, 10);

const q = {
  bySlug: db.prepare('SELECT * FROM arenas WHERE slug = ?'),
  byId: db.prepare('SELECT * FROM arenas WHERE id = ?'),
  owned: db.prepare('SELECT COUNT(*) AS n FROM arenas WHERE owner_id = ?'),
  ins: db.prepare('INSERT INTO arenas (slug, name, owner_id, mode, period, starts_at, ends_at, visibility, show_trades, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  members: db.prepare('SELECT m.*, u.name, u.color, u.bio, u.is_bot, u.provider FROM arena_members m JOIN users u ON u.id = m.user_id WHERE m.arena_id = ?'),
  member: db.prepare('SELECT * FROM arena_members WHERE arena_id = ? AND user_id = ?'),
  count: db.prepare('SELECT COUNT(*) AS n FROM arena_members WHERE arena_id = ?'),
  join: db.prepare('INSERT INTO arena_members (arena_id, user_id, joined_at, base_eq, carry, book) VALUES (?, ?, ?, ?, 1, ?)'),
  leave: db.prepare('DELETE FROM arena_members WHERE arena_id = ? AND user_id = ?'),
  mine: db.prepare('SELECT a.* FROM arenas a JOIN arena_members m ON m.arena_id = a.id WHERE m.user_id = ? ORDER BY a.created_at DESC'),
  all: db.prepare('SELECT * FROM arenas'),
  myMain: db.prepare("SELECT m.* FROM arena_members m JOIN arenas a ON a.id = m.arena_id WHERE m.user_id = ? AND a.mode = 'main'"),
  setBase: db.prepare('UPDATE arena_members SET base_eq = ?, carry = ? WHERE arena_id = ? AND user_id = ?'),
  setBook: db.prepare('UPDATE arena_members SET book = ? WHERE arena_id = ? AND user_id = ?'),
  books: db.prepare('SELECT arena_id, user_id, book FROM arena_members WHERE book IS NOT NULL'),
  feed: db.prepare('SELECT f.*, u.name, u.color FROM arena_feed f LEFT JOIN users u ON u.id = f.user_id WHERE f.arena_id = ? ORDER BY f.id DESC LIMIT 60'),
  post: db.prepare('INSERT INTO arena_feed (arena_id, user_id, ts, kind, text, pl) VALUES (?, ?, ?, ?, ?, ?)'),
  feedOne: db.prepare('SELECT * FROM arena_feed WHERE id = ?'),
  reacts: db.prepare('SELECT emoji, user_id FROM arena_reactions WHERE feed_id = ?'),
  react: db.prepare('INSERT INTO arena_reactions (feed_id, user_id, emoji) VALUES (?, ?, ?) ON CONFLICT(feed_id, user_id) DO UPDATE SET emoji = excluded.emoji'),
  unreact: db.prepare('DELETE FROM arena_reactions WHERE feed_id = ? AND user_id = ?'),
  putRank: db.prepare('INSERT INTO arena_ranks (arena_id, user_id, day, rank, ret) VALUES (?, ?, ?, ?, ?) ON CONFLICT(arena_id, user_id, day) DO UPDATE SET rank = excluded.rank, ret = excluded.ret'),
  rankAt: db.prepare('SELECT rank, ret FROM arena_ranks WHERE arena_id = ? AND user_id = ? AND day <= ? ORDER BY day DESC LIMIT 1'),
  update: db.prepare('UPDATE arenas SET name = ?, visibility = ?, show_trades = ? WHERE id = ?'),
  newRound: db.prepare('UPDATE arenas SET starts_at = ?, ends_at = ?, round = round + 1, final = NULL WHERE id = ?'),
  setFinal: db.prepare('UPDATE arenas SET final = ? WHERE id = ?'),
  del: db.prepare('DELETE FROM arenas WHERE id = ?'),
};

/* ---------- Depots ---------- */
const eqOf = st => game.equity(st, 'now', funds.navOf);
// Eigenes Arena-Depot laden; save() schreibt es zurück
function loadBook(userId, arenaId) {
  const m = q.member.get(arenaId, userId);
  if (!m || !m.book) throw err('Kein Arena-Depot für diese Arena', 404);
  const st = {...game.fresh(), ...JSON.parse(m.book)};
  return {st, save: () => { if (st.hist.length > 200) st.hist = st.hist.slice(-200); q.setBook.run(JSON.stringify(st), arenaId, userId); }, arena: q.byId.get(arenaId)};
}
function allBooks() { return q.books.all().map(r => ({arenaId: r.arena_id, userId: r.user_id, st: {...game.fresh(), ...JSON.parse(r.book)}})); }

/* ---------- Anlegen, Beitreten, Verwalten ---------- */
function slugify(name) {
  const base = name.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'arena';
  let s = base, i = 2;
  while (q.bySlug.get(s)) s = `${base}-${i++}`;
  return s;
}
function endsAt(period, until, from = Date.now()) {
  if (PERIODS[period]) return from + PERIODS[period] * 864e5;
  if (period === 'until') {
    const t = Date.parse(until);
    if (!Number.isFinite(t) || t < from + 864e5) throw err('Bitte ein Enddatum in der Zukunft wählen');
    if (t > from + 400 * 864e5) throw err('Höchstens ein gutes Jahr Laufzeit');
    return t + 864e5 - 1;   // bis Ende des gewählten Tages
  }
  return null;
}

function create(u, b) {
  const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (name.length < 3) throw err('Bitte einen Namen mit mindestens 3 Zeichen angeben');
  if (q.owned.get(u.id).n >= MAX_OWNED) throw err(`Höchstens ${MAX_OWNED} eigene Arenen`);
  const mode = b.mode === 'own' ? 'own' : 'main';
  const period = ['1m', '3m', 'open', 'until'].includes(b.period) ? b.period : '1m';
  const now = Date.now(), slug = slugify(name);
  const id = Number(q.ins.run(slug, name, u.id, mode, period, now, endsAt(period, b.until, now), b.visibility === 'public' ? 'public' : 'private', b.showTrades === false ? 0 : 1, now).lastInsertRowid);
  join(u, slug, {start: b.start});
  return q.byId.get(id);
}

function join(u, slug, b = {}) {
  const a = q.bySlug.get(String(slug || '')); if (!a) throw err('Arena nicht gefunden', 404);
  if (q.member.get(a.id, u.id)) return a;
  if (q.count.get(a.id).n >= MAX_MEMBERS) throw err('Diese Arena ist voll');
  const main = store.load(u.id);
  let book = null, base = eqOf(main);
  if (a.mode === 'own') {
    let st;
    if (b.start === 'copy') {
      // Kopie des Hauptdepots: eigene Positionen und Bargeld; kopierte Anleger fließen als Bargeld ein
      st = game.fresh();
      st.cash = main.cash + (main.copies || []).reduce((s, c) => s + c.cash, 0) + main.pos.filter(p => p.copyId).reduce((s, p) => s + game.value(p, 'now', funds.navOf), 0);
      st.pos = main.pos.filter(p => !p.copyId).map(p => ({...p}));
      st.mode = main.mode;
    } else { st = game.fresh(); st.mode = main.mode; }
    st.badges = main.badges; st.xp = 0;
    book = JSON.stringify(st); base = eqOf(st);
  }
  q.join.run(a.id, u.id, Date.now(), base, book);
  q.post.run(a.id, u.id, Date.now(), 'join', a.owner_id === u.id ? 'hat die Arena eröffnet' : 'ist beigetreten', null);
  return a;
}

function leave(u, id) {
  const a = q.byId.get(id); if (!a) throw err('Arena nicht gefunden', 404);
  if (a.owner_id === u.id) throw err('Als Gründer können Sie die Arena nur löschen, nicht verlassen');
  q.leave.run(id, u.id);
}
function requireOwner(u, id) {
  const a = q.byId.get(id); if (!a) throw err('Arena nicht gefunden', 404);
  if (a.owner_id !== u.id && u.role !== 'admin') throw err('Nur der Gründer kann das ändern', 403);
  return a;
}
function update(u, id, b) {
  const a = requireOwner(u, id);
  const name = b.name != null ? String(b.name).replace(/\s+/g, ' ').trim().slice(0, 40) : a.name;
  if (name.length < 3) throw err('Bitte einen Namen mit mindestens 3 Zeichen angeben');
  q.update.run(name, b.visibility ? (b.visibility === 'public' ? 'public' : 'private') : a.visibility, b.showTrades == null ? a.show_trades : (b.showTrades ? 1 : 0), id);
}
function kick(u, id, userId) {
  const a = requireOwner(u, id);
  if (Number(userId) === a.owner_id) throw err('Der Gründer kann nicht entfernt werden');
  q.leave.run(id, Number(userId));
}
function remove(u, id) { requireOwner(u, id); q.del.run(id); }

// Neue Runde: alle starten wieder bei 0 %; eigene Arena-Depots beginnen neu mit 100.000 €
function newRound(u, id) {
  const a = requireOwner(u, id), now = Date.now();
  q.newRound.run(now, endsAt(a.period === 'until' ? '1m' : a.period, null, now), id);
  for (const m of q.members.all(id)) {
    if (a.mode === 'own') { const st = game.fresh(); const old = m.book ? JSON.parse(m.book) : {}; st.mode = old.mode || null; st.badges = old.badges || {}; q.setBook.run(JSON.stringify(st), id, m.user_id); q.setBase.run(config.startCash, 1, id, m.user_id); }
    else q.setBase.run(eqOf(store.load(m.user_id)), 1, id, m.user_id);
  }
  q.post.run(id, u.id, now, 'round', `hat Runde ${a.round + 1} gestartet. Alle starten wieder bei 0 %.`, null);
}

// Hauptdepot wird zurückgesetzt: bisheriges Ergebnis bleibt in der Wertung stehen
function onReset(userId, eqBefore) {
  for (const m of q.myMain.all(userId)) q.setBase.run(config.startCash, m.carry * eqBefore / m.base_eq, m.arena_id, userId);
}

/* ---------- Rangliste ---------- */
function standings(a) {
  const rows = q.members.all(a.id).map(m => {
    const st = a.mode === 'own' ? {...game.fresh(), ...JSON.parse(m.book || '{}')} : store.load(m.user_id);
    const eq = eqOf(st), ret = (a.mode === 'own' ? 1 : m.carry) * eq / m.base_eq - 1;
    return {id: m.user_id, name: m.name, color: m.color, sub: m.bio || (m.provider === 'freehomes' ? 'Free-Homes-Mitglied' : 'Mitglied'), bot: !!m.is_bot,
      eq, ret, joinedAt: m.joined_at, owner: m.user_id === a.owner_id, positions: st.pos.length};
  }).sort((x, y) => y.ret - x.ret);
  const y = dayStr(1), w = dayStr(7);
  rows.forEach((r, i) => {
    r.rank = i + 1;
    const ry = q.rankAt.get(a.id, r.id, y), rw = q.rankAt.get(a.id, r.id, w);
    r.move = ry ? ry.rank - r.rank : 0;            // positiv = aufgestiegen seit gestern
    r.weekMove = rw ? rw.rank - r.rank : null;
    r.weekRet = rw ? (1 + r.ret) / (1 + rw.ret) - 1 : null;
  });
  return rows;
}
const ended = a => a.ends_at && Date.now() > a.ends_at;

function summary(a, meId) {
  const rows = a.final && ended(a) ? JSON.parse(a.final) : standings(a);
  const me = rows.find(r => r.id === meId);
  return {id: a.id, slug: a.slug, name: a.name, mode: a.mode, period: a.period, startsAt: a.starts_at, endsAt: a.ends_at, ended: !!ended(a), round: a.round,
    visibility: a.visibility, showTrades: !!a.show_trades, ownerId: a.owner_id, members: rows.length,
    top: rows.slice(0, 3).map(r => ({name: r.name, ret: r.ret, color: r.color})), me: me ? {rank: me.rank, ret: me.ret, move: me.move} : null, member: !!me};
}
function detail(slug, u) {
  const a = q.bySlug.get(String(slug || '')); if (!a) throw err('Arena nicht gefunden', 404);
  const s = summary(a, u && u.id);
  const isMember = u && q.member.get(a.id, u.id);
  if (!isMember) return {...s, preview: true};
  const rows = a.final && ended(a) ? JSON.parse(a.final) : standings(a);
  return {...s, rows, owner: a.owner_id === u.id || u.role === 'admin', feed: feed(a, u.id), league: leagueRank(a.id)};
}

/* ---------- Aktivität ---------- */
function feed(a, meId) {
  return q.feed.all(a.id).map(f => {
    const rs = q.reacts.all(f.id), counts = {};
    for (const r of rs) counts[r.emoji] = (counts[r.emoji] || 0) + 1;
    return {id: f.id, ts: f.ts, kind: f.kind, name: f.name, color: f.color, userId: f.user_id, text: f.text, pl: f.pl, reactions: counts, mine: (rs.find(r => r.user_id === meId) || {}).emoji || null};
  });
}
function react(u, feedId, emoji) {
  const f = q.feedOne.get(feedId); if (!f) throw err('Eintrag nicht gefunden', 404);
  if (!q.member.get(f.arena_id, u.id)) throw err('Nur für Mitglieder', 403);
  const cur = q.reacts.all(feedId).find(r => r.user_id === u.id);
  if (!EMOJIS.includes(emoji) || (cur && cur.emoji === emoji)) q.unreact.run(feedId, u.id);
  else q.react.run(feedId, u.id, emoji);
  return feed(q.byId.get(f.arena_id), u.id);
}
// Trades in die passenden Arenen melden: Hauptdepot → alle Arenen im Format main, Arena-Depot → nur diese Arena
function onTrade(userId, bookArenaId, ev) {
  const targets = bookArenaId ? [q.byId.get(bookArenaId)] : q.myMain.all(userId).map(m => q.byId.get(m.arena_id));
  for (const a of targets) {
    if (!a || ended(a)) continue;
    const text = a.show_trades ? ev.text : ev.kind === 'open' ? 'hat eine Position eröffnet' : 'hat eine Position geschlossen';
    q.post.run(a.id, userId, Date.now(), ev.kind, text, ev.pl == null ? null : ev.pl);
  }
}

/* ---------- Gruppen-Liga ---------- */
// Punktzahl einer Arena: Durchschnitt der Rendite der besten 5 Mitglieder (ab 3 Mitgliedern)
let leagueCache = {t: 0, rows: []};
function league() {
  if (Date.now() - leagueCache.t < 60_000) return leagueCache.rows;
  const rows = [];
  for (const a of q.all.all()) {
    if (ended(a)) continue;
    const st = standings(a); if (st.length < 3) continue;
    const top = st.slice(0, 5);
    rows.push({id: a.id, slug: a.slug, name: a.name, public: a.visibility === 'public', members: st.length, score: top.reduce((s, r) => s + r.ret, 0) / top.length});
  }
  rows.sort((x, y) => y.score - x.score).forEach((r, i) => { r.rank = i + 1; });
  leagueCache = {t: Date.now(), rows};
  return rows;
}
function leagueRank(id) { const l = league(), r = l.find(x => x.id === id); return r ? {rank: r.rank, of: l.length, score: r.score} : {rank: null, of: l.length}; }
// Öffentliche Arenen mit Namen, private nur anonym (Platzhalter)
function leagueView(meId) {
  const mine = new Set(q.mine.all(meId || 0).map(a => a.id));
  return league().slice(0, 20).map(r => ({...r, name: r.public || mine.has(r.id) ? r.name : 'Private Arena', slug: r.public || mine.has(r.id) ? r.slug : null, mine: mine.has(r.id)}));
}

function mine(u) { return q.mine.all(u.id).map(a => summary(a, u.id)); }

/* ---------- Hintergrund: Tagesplätze speichern, beendete Runden festschreiben ---------- */
function snapshot() {
  const d = dayStr();
  for (const a of q.all.all()) {
    if (ended(a)) {
      if (!a.final) { q.setFinal.run(JSON.stringify(standings(a)), a.id); const w = standings(a)[0]; if (w) q.post.run(a.id, w.id, Date.now(), 'round', `gewinnt Runde ${a.round} mit ${(w.ret * 100).toFixed(1).replace('.', ',')} %`, w.ret); }
      continue;
    }
    for (const r of standings(a)) q.putRank.run(a.id, r.id, d, r.rank, r.ret);
  }
  leagueCache.t = 0;
}

/* ---------- Vorschau für geteilte Links (Titel und Beschreibung) ---------- */
function preview(slug) {
  const a = q.bySlug.get(String(slug || '')); if (!a) return null;
  const s = summary(a, null), lead = s.top[0];
  return {title: `${a.name} · Investment Arena`,
    description: `${s.members} ${s.members === 1 ? 'Mitglied' : 'Mitglieder'}${lead ? ` · Platz 1: ${lead.name} ${lead.ret >= 0 ? '+' : '−'}${Math.abs(lead.ret * 100).toFixed(1).replace('.', ',')} %` : ''}. Treten Sie mit 100.000 € Spielgeld gegen Freunde und Kollegen an.`};
}

module.exports = {create, join, leave, update, kick, remove, newRound, onReset, onTrade, detail, mine, react, leagueView, snapshot, preview, loadBook, allBooks, EMOJIS};
