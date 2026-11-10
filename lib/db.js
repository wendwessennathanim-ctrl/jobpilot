'use strict';
/*
 * Database layer — SQLite via Node's built-in node:sqlite.
 * SECURITY: every query in this project is a prepared statement with bound
 * parameters. User input is NEVER concatenated into SQL, which is what makes
 * SQL injection impossible here.
 */
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.JOBPILOT_DB || path.join(DATA_DIR, 'jobpilot.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash     TEXT NOT NULL,
  salt          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash    TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf          TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL DEFAULT '',
  headline      TEXT NOT NULL DEFAULT '',
  resume_text   TEXT NOT NULL DEFAULT '',
  skills        TEXT NOT NULL DEFAULT '[]',
  prefs_json    TEXT NOT NULL DEFAULT '{}',
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,
  source        TEXT NOT NULL,
  title         TEXT NOT NULL,
  company       TEXT NOT NULL DEFAULT '',
  location      TEXT NOT NULL DEFAULT '',
  remote        INTEGER NOT NULL DEFAULT 0,
  url           TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  tags          TEXT NOT NULL DEFAULT '[]',
  posted_at     TEXT,
  fetched_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jobs_fetched ON jobs(fetched_at);

CREATE TABLE IF NOT EXISTS matches (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id        TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  score         INTEGER NOT NULL,
  reasons       TEXT NOT NULL DEFAULT '[]',
  flags         TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, job_id)
);
CREATE INDEX IF NOT EXISTS idx_matches_user_score ON matches(user_id, score DESC);

CREATE TABLE IF NOT EXISTS applications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id        TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  company       TEXT NOT NULL DEFAULT '',
  url           TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'saved'
                CHECK (status IN ('saved','applied','screening','interview','offer','rejected','closed')),
  applied_at    TEXT,
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_apps_user ON applications(user_id, status);

CREATE TABLE IF NOT EXISTS documents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id        TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('cover_letter','resume','answers')),
  content       TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_docs_user_job ON documents(user_id, job_id, kind);

CREATE TABLE IF NOT EXISTS runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at   TEXT,
  found         INTEGER NOT NULL DEFAULT 0,
  new_jobs      INTEGER NOT NULL DEFAULT 0,
  top_score     INTEGER NOT NULL DEFAULT 0,
  error         TEXT
);
`);

module.exports = { db, DB_PATH };
