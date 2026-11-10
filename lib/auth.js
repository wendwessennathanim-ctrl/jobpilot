'use strict';
/*
 * Authentication & session security.
 * - Passwords: scrypt (memory-hard KDF built into Node) with a per-user random
 *   salt. Plaintext passwords are never stored or logged.
 * - Sessions: 256-bit random tokens. Only the SHA-256 hash of the token is
 *   stored in the DB, so a database leak does not leak usable sessions.
 * - Cookies: HttpOnly (JS can't read them -> blunts XSS token theft),
 *   SameSite=Lax (blunts CSRF), Secure when served over HTTPS.
 * - CSRF: every session also has a random CSRF token that state-changing
 *   requests must present in a header.
 * - Login: generic error messages (no "user exists" oracle), constant-time
 *   hash comparison, per-account lockout after repeated failures.
 */
const crypto = require('node:crypto');
const { db } = require('./db');

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;
const failedLogins = new Map(); // email -> { count, lockedUntil }

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHashHex) {
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHashHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function isLocked(email) {
  const rec = failedLogins.get(email.toLowerCase());
  return !!(rec && rec.lockedUntil && rec.lockedUntil > Date.now());
}

function noteFailedLogin(email) {
  const key = email.toLowerCase();
  const rec = failedLogins.get(key) || { count: 0, lockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= MAX_FAILED) {
    rec.lockedUntil = Date.now() + LOCK_MS;
    rec.count = 0;
  }
  failedLogins.set(key, rec);
}

function clearFailedLogins(email) {
  failedLogins.delete(email.toLowerCase());
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(24).toString('hex');
  const expires = Date.now() + SESSION_TTL_MS;
  db.prepare('INSERT INTO sessions (token_hash, user_id, csrf, expires_at) VALUES (?, ?, ?, ?)')
    .run(sha256(token), userId, csrf, expires);
  return { token, csrf, expires };
}

function getSession(token) {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  const row = db.prepare(
    'SELECT s.user_id AS userId, s.csrf AS csrf, s.expires_at AS expiresAt, u.email AS email ' +
    'FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?'
  ).get(sha256(token));
  if (!row) return null;
  if (row.expiresAt < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    return null;
  }
  return row;
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(req, token, expires) {
  const secure = process.env.COOKIE_SECURE === '1' || req.headers['x-forwarded-proto'] === 'https';
  const parts = [
    `sid=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor((expires - Date.now()) / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearCookie() {
  return 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

function csrfValid(session, headerValue) {
  if (!session || !headerValue || typeof headerValue !== 'string') return false;
  const a = Buffer.from(session.csrf);
  const b = Buffer.from(headerValue);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  hashPassword, verifyPassword, createSession, getSession, destroySession,
  parseCookies, sessionCookie, clearCookie, csrfValid,
  isLocked, noteFailedLogin, clearFailedLogins,
};
