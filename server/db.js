// Datenhaltung mit dem in Node 22 eingebauten SQLite (keine Zusatzpakete nötig)
const fs = require('fs');
const path = require('path');
const {DatabaseSync} = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(config.dataDir, {recursive: true});
const db = new DatabaseSync(path.join(config.dataDir, 'arena.sqlite'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  name TEXT NOT NULL,
  pass TEXT,
  provider TEXT NOT NULL DEFAULT 'local',      -- local | demo | freehomes | bot
  provider_sub TEXT,
  bio TEXT DEFAULT '',
  color TEXT,
  is_bot INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_provider ON users(provider, provider_sub) WHERE provider_sub IS NOT NULL;
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS states (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS funds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  strategy TEXT NOT NULL DEFAULT '',
  holdings TEXT NOT NULL,                      -- JSON: [{sym, dir, w, p0}]
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oidc_states (
  state TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);

// Spätere Erweiterungen bestehender Datenbanken
const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!cols.includes('role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT ''");   // '' | admin

module.exports = db;
