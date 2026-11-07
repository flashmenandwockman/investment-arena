// Anmeldung: eigene Konten (E-Mail + Passwort), Demo-Zugang ohne Registrierung
// und Login über Free Homes (Keycloak, OpenID Connect mit PKCE).
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');

const COOKIE = 'ia_sid';
const COLORS = ['#8fd3ff', '#f3e2bd', '#ffb38a', '#b7a6ff', '#a6f0c6', '#ff9aa8', '#e0c28a', '#9fe3e0', '#ffd48a'];

/* ---------- Passwörter ---------- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, {N: 16384, r: 8, p: 1});
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  const [alg, salt, key] = String(stored || '').split('$');
  if (alg !== 'scrypt') return false;
  const k = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), 64, {N: 16384, r: 8, p: 1});
  const ref = Buffer.from(key, 'base64');
  return ref.length === k.length && crypto.timingSafeEqual(ref, k);
}

/* ---------- Sessions ---------- */
const qSess = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?');
const qNewSess = db.prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)');
const qDelSess = db.prepare('DELETE FROM sessions WHERE token = ?');
const hashToken = t => crypto.createHash('sha256').update(t).digest('hex');

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
function cookie(name, value, maxAgeSec) {
  const secure = config.baseUrl.startsWith('https://') ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}
function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  qNewSess.run(hashToken(token), userId, Date.now() + config.sessionDays * 864e5);
  res.setHeader('Set-Cookie', cookie(COOKIE, token, config.sessionDays * 86400));
}
function currentUser(req) {
  const t = parseCookies(req)[COOKIE];
  return t ? qSess.get(hashToken(t), Date.now()) || null : null;
}
function logout(req, res) {
  const t = parseCookies(req)[COOKIE];
  if (t) qDelSess.run(hashToken(t));
  res.setHeader('Set-Cookie', cookie(COOKIE, '', 0));
}

/* ---------- Schutz gegen Passwort-Raten ---------- */
const attempts = new Map();
function throttle(key) {
  const now = Date.now(), a = (attempts.get(key) || []).filter(t => now - t < 15 * 60_000);
  if (a.length >= 10) throw Object.assign(new Error('Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.'), {status: 429});
  a.push(now); attempts.set(key, a);
}

/* ---------- Eigene Konten ---------- */
const qByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const qInsUser = db.prepare('INSERT INTO users (email, name, pass, provider, provider_sub, bio, color, is_bot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
const color = () => COLORS[crypto.randomInt(COLORS.length)];
const cleanName = n => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 30);

function register({name, email, password}) {
  name = cleanName(name); email = String(email || '').trim().toLowerCase();
  if (name.length < 2) throw new Error('Bitte einen Namen mit mindestens 2 Zeichen angeben');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Bitte eine gültige E-Mail-Adresse angeben');
  if (String(password || '').length < 8) throw new Error('Das Passwort braucht mindestens 8 Zeichen');
  if (qByEmail.get(email)) throw new Error('Diese E-Mail-Adresse ist bereits registriert');
  const r = qInsUser.run(email, name, hashPassword(password), 'local', null, '', color(), 0, Date.now());
  return Number(r.lastInsertRowid);
}
function login({email, password}) {
  const u = qByEmail.get(String(email || '').trim().toLowerCase());
  if (!u || !u.pass || !verifyPassword(String(password || ''), u.pass)) throw new Error('E-Mail oder Passwort ist falsch');
  return u.id;
}
function demo() {
  const n = crypto.randomInt(1000, 9999);
  const r = qInsUser.run(null, `Gast ${n}`, null, 'demo', `demo-${crypto.randomUUID()}`, 'Probiert die Arena aus', color(), 0, Date.now());
  return Number(r.lastInsertRowid);
}
// Demo-Konten nach einigen Tagen aufräumen
const qOldDemo = db.prepare("DELETE FROM users WHERE provider = 'demo' AND created_at < ?");
const cleanupDemo = () => qOldDemo.run(Date.now() - config.demoUserDays * 864e5);

/* ---------- Free Homes (Keycloak / OpenID Connect) ---------- */
let discovery = null;
async function oidc() {
  if (!discovery) {
    const r = await fetch(`${config.freehomes.issuer}/.well-known/openid-configuration`, {signal: AbortSignal.timeout(10000)});
    if (!r.ok) throw new Error('Free-Homes-Login nicht erreichbar');
    discovery = await r.json();
  }
  return discovery;
}
const redirectUri = () => `${config.baseUrl}/api/auth/freehomes/callback`;
const qInsState = db.prepare('INSERT INTO oidc_states (state, verifier, created_at) VALUES (?, ?, ?)');
const qTakeState = db.prepare('DELETE FROM oidc_states WHERE state = ? RETURNING verifier, created_at');

async function freehomesStart() {
  const d = await oidc();
  const state = crypto.randomBytes(16).toString('base64url'), verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  qInsState.run(state, verifier, Date.now());
  const u = new URL(d.authorization_endpoint);
  u.search = new URLSearchParams({client_id: config.freehomes.clientId, response_type: 'code', scope: 'openid email profile',
    redirect_uri: redirectUri(), state, code_challenge: challenge, code_challenge_method: 'S256'}).toString();
  return u.toString();
}

const qBySub = db.prepare("SELECT * FROM users WHERE provider = 'freehomes' AND provider_sub = ?");
const qLink = db.prepare("UPDATE users SET provider = 'freehomes', provider_sub = ? WHERE id = ?");
async function freehomesCallback(params) {
  const st = params.get('state') && qTakeState.get(params.get('state'));
  if (!st || Date.now() - st.created_at > 10 * 60_000) throw new Error('Anmeldung abgelaufen, bitte erneut versuchen');
  const d = await oidc();
  const body = new URLSearchParams({grant_type: 'authorization_code', code: params.get('code') || '', redirect_uri: redirectUri(),
    client_id: config.freehomes.clientId, code_verifier: st.verifier});
  if (config.freehomes.clientSecret) body.set('client_secret', config.freehomes.clientSecret);
  const tr = await fetch(d.token_endpoint, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body, signal: AbortSignal.timeout(10000)});
  if (!tr.ok) throw new Error('Free-Homes-Anmeldung fehlgeschlagen');
  const tok = await tr.json();
  const ur = await fetch(d.userinfo_endpoint, {headers: {Authorization: `Bearer ${tok.access_token}`}, signal: AbortSignal.timeout(10000)});
  if (!ur.ok) throw new Error('Free-Homes-Profil nicht lesbar');
  const info = await ur.json();
  const existing = qBySub.get(info.sub);
  if (existing) return existing.id;
  const email = info.email ? String(info.email).toLowerCase() : null;
  // Bestehendes eigenes Konto nur bei bestätigter E-Mail-Adresse verknüpfen
  const local = email && info.email_verified ? qByEmail.get(email) : null;
  if (local) { qLink.run(info.sub, local.id); return local.id; }
  const name = cleanName(info.preferred_username || info.given_name || info.name || 'Free-Homes-Mitglied');
  const r = qInsUser.run(email && !qByEmail.get(email) ? email : null, name, null, 'freehomes', info.sub, 'Free-Homes-Mitglied', color(), 0, Date.now());
  return Number(r.lastInsertRowid);
}

module.exports = {register, login, demo, cleanupDemo, startSession, currentUser, logout, throttle, freehomesStart, freehomesCallback, hashPassword, COLORS};
