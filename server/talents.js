// Scouting & Talents: Die besten Investoren jedes Quartals stellen sich dem Analystenteam von Florian Homm vor.
// Talent-Score 0–100 aus risikobereinigter Rendite, Verlustbegrenzung, Beständigkeit, Disziplin und Begründungen.
// Stufen: Beobachtet (Wertung freigeschaltet) → Shortlist (Top 50 des Quartals) → Pitch (vom Team eingeladen).
const db = require('./db');
const config = require('./config');
const game = require('./game');
const store = require('./store');
const funds = require('./funds');

db.exec(`
CREATE TABLE IF NOT EXISTS talent_apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quarter TEXT NOT NULL,
  real_name TEXT NOT NULL,
  answers TEXT NOT NULL,              -- JSON {strategy, bestTrade, goal}
  video TEXT,
  consent_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'neu', -- neu | gesichtet | gespraech | abgeschlossen | abgesagt
  notes TEXT NOT NULL DEFAULT '',
  score REAL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, quarter)
);
`);

// Entwurf, Freigabe durch Florian Homm ausstehend (Tonspur: public/audio/scouting.mp3)
const MESSAGE = {
  title: 'Ich suche keine Zocker. Ich suche Talente.',
  text: [
    'In der Arena sehe ich nicht nur, wer vorne liegt, sondern wie jemand dorthin gekommen ist. Wer sein Risiko im Griff hat, wer Verluste früh begrenzt und wer in einer schwachen Woche nicht die Nerven verliert, fällt mir auf.',
    'Die Besten jedes Quartals lade ich ein, sich meinem Analystenteam vorzustellen. Kein Lebenslauf, kein Titel, keine Bankausbildung nötig. Es zählen Ihre Zahlen und Ihre Begründung.',
    'Die größten Talente, die ich in meiner Laufbahn getroffen habe, kamen selten aus der Bankfiliale. Zeigen Sie mir, was Sie können.',
  ],
  sign: 'Florian Homm',
};
const REQ = {days: 30, trades: 20};
const SHORTLIST = 50, SHORTLIST_MIN = 55;
const STATUS = ['neu', 'gesichtet', 'gespraech', 'abgeschlossen', 'abgesagt'];
const err = (m, status = 400) => Object.assign(new Error(m), {status});

const quarterOf = (t = Date.now()) => { const d = new Date(t); return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`; };
const quarterStart = (t = Date.now()) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1); };
const quarterEnd = (t = Date.now()) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3 + 3, 1) - 1; };

const qHist = db.prepare('SELECT day, eq FROM equity_hist WHERE user_id = ? AND day >= ? ORDER BY day');
const qFirst = db.prepare('SELECT MIN(day) AS d FROM equity_hist WHERE user_id = ?');
const qUser = db.prepare('SELECT * FROM users WHERE id = ?');
const qApp = db.prepare('SELECT * FROM talent_apps WHERE user_id = ? AND quarter = ?');
const qInsApp = db.prepare('INSERT INTO talent_apps (user_id, quarter, real_name, answers, video, consent_at, score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
const qApps = db.prepare('SELECT a.*, u.name, u.email, u.provider, u.color FROM talent_apps a JOIN users u ON u.id = a.user_id WHERE a.quarter = ? ORDER BY a.score DESC');
const qAppOne = db.prepare('SELECT * FROM talent_apps WHERE id = ?');
const qUpdApp = db.prepare('UPDATE talent_apps SET status = ?, notes = ?, updated_at = ? WHERE id = ?');

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

// Talent-Score aus dem Hauptdepot (90 Tage Depotwert-Verlauf und Handelsverhalten)
function score(userId, st) {
  const from = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const h = qHist.all(userId, from).map(x => x.eq);
  const eq = game.equity(st, 'now', funds.navOf); h.push(eq);
  const r = []; for (let i = 1; i < h.length; i++) r.push(h[i] / h[i - 1] - 1);
  const mean = r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0;
  const sd = r.length > 1 ? Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1)) : 0;
  const sharpe = sd > 0 ? mean / sd * Math.sqrt(252) : 0;
  let peak = h[0] || eq, dd = 0; for (const v of h) { peak = Math.max(peak, v); dd = Math.min(dd, v / peak - 1); }
  const weeks = []; for (let i = 5; i < h.length; i += 5) weeks.push(h[i] / h[i - 5] - 1);
  const t = st.ts || {n: 0, sl: 0, big: 0, notes: 0};
  const parts = {
    risk: clamp((sharpe + .5) / 3) * 100,                                   // Rendite im Verhältnis zur Schwankung
    drawdown: (1 - clamp(-dd / .3)) * 100,                                   // größter Rückgang (30 % = 0 Punkte)
    consistency: weeks.length ? weeks.filter(w => w > 0).length / weeks.length * 100 : 50,
    discipline: t.n ? (.6 * t.sl / t.n + .4 * (1 - t.big / t.n)) * 100 : 0,  // Stop-Loss und vernünftige Positionsgrößen
    reasoning: t.n ? clamp(t.notes / t.n) * 100 : 0,                         // Begründungen zu den Trades
  };
  const total = .35 * parts.risk + .2 * parts.drawdown + .2 * parts.consistency + .15 * parts.discipline + .1 * parts.reasoning;
  return {total: Math.round(total), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v)])), sharpe, dd, ret: eq / config.startCash - 1};
}

function checklist(u, st) {
  const first = qFirst.get(u.id).d, days = first ? Math.floor((Date.now() - Date.parse(first)) / 864e5) : 0;
  const trades = (st.ts && st.ts.n) || 0, fh = u.provider === 'freehomes' || u.role === 'admin';
  const resetOk = !st.resetAt || st.resetAt < quarterStart();
  return {items: [
    {key: 'days', label: `${REQ.days} Tage in der Arena`, done: days >= REQ.days, progress: `${Math.min(days, REQ.days)} von ${REQ.days}`},
    {key: 'trades', label: `${REQ.trades} eigene Trades`, done: trades >= REQ.trades, progress: `${Math.min(trades, REQ.trades)} von ${REQ.trades}`},
    {key: 'fh', label: 'Mit Free-Homes-Konto angemeldet', done: fh, progress: fh ? 'erledigt' : 'offen'},
    {key: 'reset', label: 'Depot in diesem Quartal nicht zurückgesetzt', done: resetOk, progress: resetOk ? 'erledigt' : 'nächstes Quartal wieder'},
  ], eligible: days >= REQ.days && trades >= REQ.trades && fh && resetOk};
}

// Rangliste der Talente: alle mit freigeschalteter Wertung
let cache = {t: 0, rows: []};
function ranking() {
  if (Date.now() - cache.t < 5 * 60_000) return cache.rows;
  const rows = [];
  for (const x of store.all()) {
    if (x.isBot) continue;
    const u = qUser.get(x.userId); if (!u) continue;
    if (!checklist(u, x.st).eligible) continue;
    const s = score(u.id, x.st);
    rows.push({id: u.id, name: u.name, color: u.color, sub: u.bio || 'Mitglied', score: s.total, parts: s.parts, ret: s.ret});
  }
  rows.sort((a, b) => b.score - a.score).forEach((r, i) => { r.rank = i + 1; r.shortlist = i < SHORTLIST && r.score >= SHORTLIST_MIN; });
  cache = {t: Date.now(), rows};
  return rows;
}

function stage(u, rank, app) {
  if (app && ['gespraech', 'abgeschlossen'].includes(app.status)) return 'pitch';
  if (rank && rank.shortlist) return 'shortlist';
  if (rank) return 'watch';
  return 'locked';
}

function view(u) {
  const qs = quarterOf(), pitchDay = quarterEnd() + 14 * 864e5;
  const out = {message: MESSAGE, quarter: qs, quarterEnd: quarterEnd(), pitchDay, req: REQ, shortlistSize: SHORTLIST,
    top: ranking().slice(0, 10).map(r => ({id: r.id, name: r.name, color: r.color, sub: r.sub, score: r.score, ret: r.ret, shortlist: r.shortlist}))};
  if (u) {
    const st = store.load(u.id), r = ranking().find(x => x.id === u.id), app = qApp.get(u.id, qs);
    out.me = {checklist: checklist(u, st), score: score(u.id, st), rank: r ? r.rank : null, of: ranking().length, stage: stage(u, r, app),
      application: app ? {status: app.status, createdAt: app.created_at} : null};
  }
  return out;
}

function apply(u, b) {
  const qs = quarterOf(), r = ranking().find(x => x.id === u.id);
  if (!r || !r.shortlist) throw err('Bewerben können sich Mitglieder auf der Shortlist des Quartals', 403);
  if (qApp.get(u.id, qs)) throw err('Sie haben sich in diesem Quartal bereits vorgestellt');
  const txt = (v, min, max, label) => { const s = String(v || '').trim(); if (s.length < min) throw err(`${label}: bitte mindestens ${min} Zeichen`); return s.slice(0, max); };
  const answers = {strategy: txt(b.strategy, 40, 1200, 'Strategie'), bestTrade: txt(b.bestTrade, 40, 1200, 'Bester Trade'), goal: txt(b.goal, 20, 800, 'Ziel')};
  const realName = txt(b.realName, 3, 80, 'Name');
  const video = b.video ? String(b.video).trim().slice(0, 300) : null;
  if (video && !/^https:\/\/\S+$/.test(video)) throw err('Bitte einen vollständigen Link mit https:// angeben');
  if (b.consent !== true) throw err('Bitte der Weitergabe an das Analystenteam zustimmen');
  const now = Date.now();
  qInsApp.run(u.id, qs, realName, JSON.stringify(answers), video, now, r.score, now, now);
}

/* ---------- Scouting-Board (Admins) ---------- */
function board(u, quarter) {
  if (!u || u.role !== 'admin') throw err('Nur für Admins', 403);
  const qs = quarter || quarterOf();
  return {quarter: qs, status: STATUS, apps: qApps.all(qs).map(a => {
    const st = store.load(a.user_id), s = score(a.user_id, st);
    return {id: a.id, userId: a.user_id, name: a.name, realName: a.real_name, email: a.email, color: a.color, status: a.status, notes: a.notes,
      answers: JSON.parse(a.answers), video: a.video, createdAt: a.created_at, score: s.total, parts: s.parts, ret: s.ret, dd: s.dd,
      trades: (st.ts && st.ts.n) || 0, positions: st.pos.length};
  }), shortlist: ranking().filter(r => r.shortlist).length};
}
function updateApp(u, id, b) {
  if (!u || u.role !== 'admin') throw err('Nur für Admins', 403);
  const a = qAppOne.get(id); if (!a) throw err('Bewerbung nicht gefunden', 404);
  qUpdApp.run(STATUS.includes(b.status) ? b.status : a.status, b.notes == null ? a.notes : String(b.notes).slice(0, 4000), Date.now(), id);
}

module.exports = {view, apply, board, updateApp, score, quarterOf, MESSAGE, invalidate: () => { cache.t = 0; }};
