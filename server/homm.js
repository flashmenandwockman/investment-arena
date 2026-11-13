// Florian Homm aus Free Homes: tägliche Postings und das wöchentliche Video, untergemischt ins Smart-Money-Radar.
// Quelle: die Free-Homes-App (POST /api/getRecentNews, Kategorie "florian-homm"), Zugang über ein Keycloak-Token
// (FREEHOMES_FEED_TOKEN oder FREEHOMES_FEED_USER/FREEHOMES_FEED_PASS), ersatzweise ein RSS/Atom/JSON-Feed
// (FREEHOMES_NEWS_URL) oder die Pflege über den Admin-Zugang.
// Für alle sichtbar: dass es eine Meldung gibt, das Datum und die betroffenen Titel. Überschrift, Text, Chart und Video
// sehen nur Free-Homes-Mitglieder und Admins (wie die Titel des TRCM Portfolios). Jede Meldung verweist auf den
// Homm Long Short Börsenbrief als Vertiefung.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const config = require('./config');
const market = require('./market');
const trcm = require('./trcm');

db.exec(`
CREATE TABLE IF NOT EXISTS homm_news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ext_id TEXT UNIQUE,                       -- Kennung aus Free Homes (postId) oder dem Feed, NULL bei Admin-Einträgen
  title TEXT NOT NULL,
  teaser TEXT NOT NULL DEFAULT '',          -- ein bis zwei Sätze für die Karte
  body TEXT NOT NULL DEFAULT '',            -- deutscher Text (Übersetzung aus Free Homes oder Original)
  body_en TEXT NOT NULL DEFAULT '',         -- Originaltext, falls englisch
  url TEXT NOT NULL DEFAULT '',             -- Beitrag bei Free Homes
  bb_url TEXT NOT NULL DEFAULT '',          -- Vertiefung im Börsenbrief (leer = Standardseite)
  syms TEXT NOT NULL DEFAULT '[]',          -- JSON: betroffene Titel, z. B. ["NVDA","SAP.DE"]
  kind TEXT NOT NULL DEFAULT 'post',        -- post | video
  image TEXT NOT NULL DEFAULT '',           -- Dateiname des lokal abgelegten Chart-Bilds
  video TEXT NOT NULL DEFAULT '[]',         -- JSON: Video-Links oder Cloudflare-IDs
  channel TEXT NOT NULL DEFAULT '',         -- Unterkategorie bei Free Homes, z. B. "general"
  published_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'admin',     -- freehomes | feed | admin | beispiel
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  created_by INTEGER
);
CREATE INDEX IF NOT EXISTS homm_news_pub ON homm_news(published_at DESC);
CREATE TABLE IF NOT EXISTS homm_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL, user_id INTEGER, user_name TEXT, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT ''
);
`);

const IMG_DIR = path.join(config.dataDir, 'homm');
const q = {
  list: db.prepare('SELECT * FROM homm_news WHERE hidden = 0 ORDER BY published_at DESC, id DESC LIMIT ?'),
  all: db.prepare('SELECT * FROM homm_news ORDER BY published_at DESC, id DESC LIMIT 200'),
  one: db.prepare('SELECT * FROM homm_news WHERE id = ?'),
  byExt: db.prepare('SELECT id, image FROM homm_news WHERE ext_id = ?'),
  count: db.prepare('SELECT COUNT(*) AS n FROM homm_news'),
  ins: db.prepare('INSERT INTO homm_news (ext_id, title, teaser, body, body_en, url, bb_url, syms, kind, image, video, channel, published_at, source, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  upd: db.prepare('UPDATE homm_news SET title = ?, teaser = ?, body = ?, url = ?, bb_url = ?, syms = ?, published_at = ?, hidden = ? WHERE id = ?'),
  updExt: db.prepare('UPDATE homm_news SET title = ?, teaser = ?, body = ?, body_en = ?, url = ?, syms = ?, kind = ?, image = CASE WHEN ? = \'\' THEN image ELSE ? END, video = ?, channel = ?, published_at = ? WHERE ext_id = ?'),
  del: db.prepare('DELETE FROM homm_news WHERE id = ?'),
  log: db.prepare('INSERT INTO homm_log (ts, user_id, user_name, action, detail) VALUES (?, ?, ?, ?, ?)'),
  logs: db.prepare('SELECT * FROM homm_log ORDER BY id DESC LIMIT 40'),
};

const err = (msg, status = 400) => Object.assign(new Error(msg), {status});
const isAdmin = trcm.isAdmin, isMember = trcm.isMember;
const name = sym => (market.INSTRUMENTS[sym] || {}).n || sym;
const fh = config.freehomesFeed;
let syncState = {at: 0, ok: null, added: 0, error: '', mode: fh.token || fh.user ? 'freehomes' : config.freehomesNewsUrl ? 'feed' : 'aus'};

/* ---------- Ansicht ---------- */
function row(r, full) {
  const syms = JSON.parse(r.syms || '[]'), video = JSON.parse(r.video || '[]');
  const base = {id: r.id, date: r.published_at, syms, names: syms.map(name), kind: r.kind, source: r.source, channel: r.channel,
    bb: r.bb_url || config.boersenbriefUrl, hasImage: !!r.image,
    kick: r.kind === 'video' ? 'Video von Florian Homm' : syms.length ? `Florian Homm zu ${syms.slice(0, 2).map(name).join(' und ')}` : 'Florian Homm'};
  if (!full) return {...base, locked: true};
  return {...base, locked: false, title: r.title, teaser: r.teaser, body: r.body, bodyEn: r.body_en, url: r.url, video,
    image: r.image ? `/api/homm/${r.id}/image` : ''};
}

// Für alle: Datum, Titelbezug, Hinweis. Inhalt nur für Free-Homes-Mitglieder und Admins.
function view(user, limit = 12) {
  const full = isMember(user);
  const out = {member: full, boersenbrief: config.boersenbriefUrl, feed: syncState.mode !== 'aus', items: q.list.all(limit).map(r => row(r, full))};
  if (isAdmin(user)) { out.admin = true; out.all = q.all.all().map(r => ({...row(r, true), hidden: !!r.hidden, extId: r.ext_id})); out.log = q.logs.all(); out.sync = syncState; }
  return out;
}

function forSymbol(sym, user, limit = 3) {
  const full = isMember(user), s = String(sym).toUpperCase();
  return q.list.all(80).filter(r => JSON.parse(r.syms || '[]').includes(s)).slice(0, limit).map(r => row(r, full));
}

// Chart-Bild nur für Mitglieder, aus der lokalen Ablage
function imageFile(id, user) {
  if (!isMember(user)) throw err('Nur für Free-Homes-Mitglieder', 403);
  const r = q.one.get(id); if (!r || !r.image) throw err('Kein Bild', 404);
  const file = path.join(IMG_DIR, path.basename(r.image));
  if (!fs.existsSync(file)) throw err('Kein Bild', 404);
  return file;
}

/* ---------- Admin-Pflege ---------- */
function requireAdmin(u) { if (!isAdmin(u)) throw err('Nur für Admins', 403); }
function log(u, action, detail) { q.log.run(Date.now(), u ? u.id : null, u ? u.name : 'System', action, detail); }
function text(v, label, max, min = 0) {
  const s = String(v == null ? '' : v).trim();
  if (s.length < min) throw err(`${label} fehlt`);
  if (s.length > max) throw err(`${label}: höchstens ${max} Zeichen`);
  return s;
}
function link(v, label) {
  const s = text(v, label, 400);
  if (s && !/^https?:\/\//i.test(s)) throw err(`${label}: Link muss mit http(s):// beginnen`);
  return s;
}
function symList(v) {
  const arr = Array.isArray(v) ? v : String(v || '').split(/[,\s]+/);
  const out = [...new Set(arr.map(s => String(s).trim().toUpperCase().replace(/^\$/, '')).filter(Boolean))];
  for (const s of out) if (!/^[A-Z0-9^][A-Z0-9.\-=\/]{0,11}$/.test(s)) throw err(`Kürzel ungültig: ${s}`);
  return out.slice(0, 8);
}
function when(v) {
  if (v == null || v === '') return Date.now();
  const t = typeof v === 'number' ? v : Date.parse(v);
  if (!Number.isFinite(t)) throw err('Datum ungültig');
  return t;
}
function fields(b, old) {
  const o = old || {};
  return {
    title: text(b.title ?? o.title, 'Überschrift', 160, 3),
    teaser: text(b.teaser ?? o.teaser, 'Kurzfassung', 400),
    body: text(b.body ?? o.body, 'Text', 6000),
    url: link(b.url ?? o.url, 'Link zu Free Homes'),
    bb: link(b.bb ?? b.bb_url ?? o.bb_url, 'Link zum Börsenbrief'),
    syms: symList(b.syms ?? JSON.parse(o.syms || '[]')),
    at: when(b.date ?? b.published_at ?? o.published_at),
  };
}
function add(u, b) {
  requireAdmin(u);
  const f = fields(b);
  const r = q.ins.run(null, f.title, f.teaser, f.body, '', f.url, f.bb, JSON.stringify(f.syms), 'post', '', '[]', '', f.at, 'admin', Date.now(), u.id);
  log(u, 'add', `${f.title} (${f.syms.join(', ') || 'ohne Titel'})`);
  return Number(r.lastInsertRowid);
}
function update(u, id, b) {
  requireAdmin(u);
  const old = q.one.get(id); if (!old) throw err('Meldung nicht gefunden', 404);
  const f = fields(b, old), hidden = b.hidden == null ? old.hidden : (b.hidden ? 1 : 0);
  q.upd.run(f.title, f.teaser, f.body, f.url, f.bb, JSON.stringify(f.syms), f.at, hidden, id);
  log(u, hidden !== old.hidden ? (hidden ? 'hide' : 'show') : 'edit', f.title);
}
function remove(u, id) {
  requireAdmin(u);
  const old = q.one.get(id); if (!old) throw err('Meldung nicht gefunden', 404);
  q.del.run(id); log(u, 'delete', old.title);
  if (old.image) fs.rm(path.join(IMG_DIR, path.basename(old.image)), {force: true}, () => {});
}

/* ---------- Betroffene Titel erkennen ---------- */
const strip = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${t}>`, 'i')); return m ? m[1] : ''; };
const attr = (xml, t, a) => { const m = xml.match(new RegExp(`<${t}[^>]*\\s${a}="([^"]*)"`, 'i')); return m ? m[1] : ''; };
const ALIAS = {NVIDIA: 'NVDA', APPLE: 'AAPL', MICROSOFT: 'MSFT', AMAZON: 'AMZN', TESLA: 'TSLA', SAP: 'SAP.DE', SIEMENS: 'SIE.DE', RHEINMETALL: 'RHM.DE', ALLIANZ: 'ALV.DE',
  'DEUTSCHE BANK': 'DBK.DE', DAX: '^GDAXI', 'S&P 500': '^GSPC', 'S&P500': '^GSPC', GOLD: 'GC=F', BITCOIN: 'BTC/EUR', ETHEREUM: 'ETH/EUR', SOLANA: 'SOL/EUR', XRP: 'XRP/EUR', CARDANO: 'ADA/EUR', DOGECOIN: 'DOGE/EUR'};

// $NVDA im Text, Kategorien des Feeds, bekannte Namen der Arena (nur Titel, die die Arena kennt)
function detectSyms(parts, cats = []) {
  const out = new Set(), txt = parts.join(' ');
  for (const c of cats) { const s = String(c).trim().toUpperCase().replace(/^\$/, ''); if (market.INSTRUMENTS[s]) out.add(s); }
  for (const m of txt.matchAll(/\$([A-Z]{1,6}(?:\.[A-Z]{1,3})?)\b/g)) out.add(m[1]);
  const up = txt.toUpperCase();
  for (const [word, sym] of Object.entries(ALIAS)) if (new RegExp(`(^|[^A-Z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Z0-9]|$)`).test(up)) out.add(sym);
  for (const [sym, meta] of Object.entries(market.INSTRUMENTS)) {
    if (meta.n && meta.n.length >= 5 && !ALIAS[meta.n.toUpperCase()] && up.includes(meta.n.toUpperCase())) out.add(sym);
  }
  return [...out].slice(0, 8);
}

/* ---------- Free Homes: Postings aus der App ---------- */
const postUrl = id => `${fh.base}/module/${fh.category}/post/${id}`;
const teaserOf = t => { const s = strip(t); const cut = s.slice(0, 220); const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? ')); return s.length <= 220 ? s : (end > 80 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + ' …'); };

// Ein Posting der App (Felder wie in getRecentNews) → Eintrag der Arena
function fromPost(p) {
  const title = strip(p.title), en = strip(p.contentText), de = strip(p.contentTextGermanTranslation) || en;
  if (!title && !de) return null;
  const vids = [].concat(p.videoCloudflareIds || []).filter(Boolean).map(id => ({cf: String(id)})).concat([].concat(p.videoLinks || []).filter(Boolean).map(u => ({url: String(u)})));
  const imgs = [].concat(p.imageIdsAndSignedLinks || []).filter(i => i && i.link);
  const t = Number(p.postingTime || 0);
  return {ext: `fh-${p.postId}`, title: title || de.slice(0, 120), teaser: teaserOf(de), body: de.slice(0, 6000), bodyEn: en === de ? '' : en.slice(0, 6000),
    url: postUrl(p.postId), kind: vids.length ? 'video' : 'post', video: vids, imageLink: imgs[0] ? imgs[0].link : '', imageId: imgs[0] ? imgs[0].id : 0,
    channel: strip(p.newsSubCategoryName), at: t > 1e12 ? t : t * 1000, syms: detectSyms([title, de, en]), author: strip(p.fullName || p.username)};
}

let tokenCache = {token: '', exp: 0};
async function token() {
  if (fh.token) return fh.token;
  if (tokenCache.token && Date.now() < tokenCache.exp - 30_000) return tokenCache.token;
  if (!fh.user) throw new Error('Kein Zugang zu Free Homes konfiguriert (FREEHOMES_FEED_TOKEN oder FREEHOMES_FEED_USER/PASS)');
  const params = new URLSearchParams({grant_type: 'password', client_id: fh.clientId, username: fh.user, password: fh.pass, scope: 'openid'});
  if (fh.clientSecret) params.set('client_secret', fh.clientSecret);
  const r = await fetch(`${config.freehomes.issuer}/protocol/openid-connect/token`, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: params, signal: AbortSignal.timeout(15_000)});
  if (!r.ok) throw new Error(`Keycloak-Anmeldung für den Feed fehlgeschlagen (${r.status})`);
  const j = await r.json();
  tokenCache = {token: j.access_token, exp: Date.now() + (j.expires_in || 300) * 1000};
  return tokenCache.token;
}

async function fetchPosts(maxPages = 3, knownExt = new Set()) {
  const tk = await token(), out = [];
  let lowest = null;
  for (let i = 0; i < maxPages; i++) {
    const body = {category: fh.category}; if (lowest != null) body.lowestNewsId = lowest;
    const r = await fetch(`${fh.base}/api/getRecentNews`, {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${tk}`}, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000)});
    if (!r.ok) throw new Error(`Free Homes antwortet mit ${r.status}`);
    const j = await r.json(), posts = Array.isArray(j.posts) ? j.posts : [];
    out.push(...posts);
    if (j.lowestNewsId == null || !posts.length || posts.some(p => knownExt.has(`fh-${p.postId}`))) break;
    lowest = j.lowestNewsId;
  }
  return out;
}

// Chart-Bild einmal herunterladen und lokal ablegen (signierte Links laufen ab, Nicht-Mitglieder sehen keinen Link)
async function saveImage(it) {
  if (!it.imageLink) return '';
  fs.mkdirSync(IMG_DIR, {recursive: true});
  const file = `${it.ext}-${it.imageId || 'img'}.jpg`, full = path.join(IMG_DIR, file);
  if (fs.existsSync(full)) return file;
  try {
    const r = await fetch(it.imageLink, {signal: AbortSignal.timeout(20_000)});
    if (!r.ok) return '';
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 4e6) return '';
    fs.writeFileSync(full, buf);
    return file;
  } catch (e) { return ''; }
}

async function store(items, source) {
  let added = 0;
  for (const it of items) {
    const ex = q.byExt.get(it.ext);
    const image = ex && ex.image ? '' : await saveImage(it);
    if (ex) q.updExt.run(it.title, it.teaser, it.body, it.bodyEn || '', it.url, JSON.stringify(it.syms), it.kind || 'post', image, image, JSON.stringify(it.video || []), it.channel || '', it.at, it.ext);
    else { q.ins.run(it.ext, it.title, it.teaser, it.body, it.bodyEn || '', it.url, '', JSON.stringify(it.syms), it.kind || 'post', image, JSON.stringify(it.video || []), it.channel || '', it.at, source, Date.now(), null); added++; }
  }
  return added;
}

/* ---------- Ersatzweise: RSS 2.0, Atom oder JSON-Feed ---------- */
function parseFeed(raw) {
  const s = String(raw || '').trim(), items = [];
  if (s.startsWith('{') || s.startsWith('[')) {
    const j = JSON.parse(s);
    if (j && Array.isArray(j.posts)) return j.posts.map(fromPost).filter(Boolean);   // Antwort der Free-Homes-App als Datei
    const arr = Array.isArray(j) ? j : j.items || j.data || [];
    for (const it of arr) {
      const title = strip(it.title), url = String(it.url || it.link || '').trim();
      if (!title) continue;
      const summary = strip(it.summary || it.teaser || it.description || it.excerpt || ''), body = strip(it.content || it.body || it.content_text || it.content_html || summary);
      const cats = [].concat(it.tags || it.categories || it.symbols || []);
      items.push({ext: String(it.id || it.guid || url || title), title, url, teaser: (summary || teaserOf(body)).slice(0, 400), body: body.slice(0, 6000), kind: it.video ? 'video' : 'post',
        video: it.video ? [{url: String(it.video)}] : [], imageLink: String(it.image || ''), at: Date.parse(it.date || it.published || it.date_published || it.pubDate || '') || Date.now(), syms: detectSyms([title, summary, body], cats)});
    }
    return items;
  }
  const isAtom = /<feed[\s>]/i.test(s) && !/<rss[\s>]/i.test(s);
  const blocks = s.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const b of blocks) {
    const title = strip(tag(b, 'title')); if (!title) continue;
    const url = isAtom ? (attr(b, 'link', 'href') || strip(tag(b, 'id'))) : strip(tag(b, 'link'));
    const summary = strip(tag(b, 'description') || tag(b, 'summary')), body = strip(tag(b, 'content:encoded') || tag(b, 'content') || summary);
    const cats = [...b.matchAll(/<category[^>]*>([\s\S]*?)<\/category>|<category[^>]*term="([^"]*)"/gi)].map(m => strip(m[1] || m[2]));
    items.push({ext: strip(tag(b, 'guid') || tag(b, 'id')) || url || title, title, url, teaser: (summary || teaserOf(body)).slice(0, 400), body: body.slice(0, 6000), kind: 'post', video: [],
      imageLink: attr(b, 'enclosure', 'url') || attr(b, 'media:content', 'url'), at: Date.parse(strip(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'))) || Date.now(), syms: detectSyms([title, summary, body], cats)});
  }
  return items;
}

/* ---------- Abgleich ---------- */
async function sync(u) {
  try {
    let items, source;
    if (fh.token || fh.user) {
      const known = new Set(q.all.all().map(r => r.ext_id).filter(Boolean));
      const posts = await fetchPosts(known.size ? 2 : 6, known);
      items = posts.filter(p => !fh.author || String(p.fullName || p.username || '').toLowerCase().includes(fh.author)).map(fromPost).filter(Boolean);
      source = 'freehomes';
    } else if (config.freehomesNewsUrl) {
      const r = await fetch(config.freehomesNewsUrl, {headers: {'User-Agent': config.secUserAgent, Accept: 'application/rss+xml, application/atom+xml, application/json, text/xml;q=0.9, */*;q=0.5'}, signal: AbortSignal.timeout(20_000)});
      if (!r.ok) throw new Error(`Feed antwortet mit ${r.status}`);
      items = parseFeed(await r.text()); source = 'feed';
    } else { syncState = {...syncState, at: Date.now(), ok: false, added: 0, error: 'Kein Zugang konfiguriert'}; return syncState; }
    const added = await store(items, source);
    syncState = {...syncState, at: Date.now(), ok: true, added, total: items.length, error: ''};
    if (added) log(u, 'import', `${added} neue Postings von Florian Homm aus Free Homes`);
  } catch (e) { syncState = {...syncState, at: Date.now(), ok: false, added: 0, error: e.message}; }
  return syncState;
}

// Offline-Demo: zwei klar gekennzeichnete Beispielmeldungen, damit die Karten sichtbar sind
function seed() {
  if (!config.offline || q.count.get().n > 0) return;
  const now = Date.now();
  const ex = [
    ['Beispiel: Einordnung von Florian Homm zu NVIDIA', 'Platzhalter, bis die Postings aus Free Homes angebunden sind. So sieht eine Meldung für Mitglieder aus.',
      'Dies ist eine Beispielmeldung. Hier erscheint das tägliche Posting von Florian Homm aus Free Homes mit Überschrift, Chart und deutschem Text: was die Lage für Long- und Short-Positionen bedeutet und wo die Vertiefung im Börsenbrief steht.', ['NVDA'], 'post', now - 6 * 3600e3],
    ['Beispiel: Wochenvideo von Florian Homm', 'Platzhalter für das wöchentliche Video aus Free Homes.',
      'Dies ist eine Beispielmeldung. Sobald der Zugang zu Free Homes konfiguriert ist, werden Postings und das Wochenvideo alle 30 Minuten übernommen und hier für Mitglieder angezeigt.', ['^GDAXI', 'SAP.DE'], 'video', now - 30 * 3600e3],
  ];
  for (const [t, te, b, syms, kind, at] of ex) q.ins.run(null, t, te, b, '', '', '', JSON.stringify(syms), kind, '', '[]', 'general', at, 'beispiel', now, null);
}

module.exports = {view, forSymbol, imageFile, add, update, remove, sync, seed, parseFeed, fromPost, detectSyms, status: () => syncState};
