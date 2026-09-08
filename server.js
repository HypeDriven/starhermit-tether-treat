// Tether Treat — authoritative game server + static file server.
//
// One file, zero npm dependencies. Serves the client from the project root
// and exposes the authoritative API under /api/v1:
//
//   GET  /api/v1/time                       server clock for daily sync
//   GET  /api/v1/daily?day=YYYY-MM-DD       deterministic daily level record
//   GET  /api/v1/leaderboard?board=&limit=  ranked entries for a board
//   POST /api/v1/scores                     replay-verified score submission
//   GET  /api/v1/achievements               static achievement declarations
//   POST /api/v1/events                     anonymous funnel telemetry (204)
//
// Leaderboards persist to data/leaderboards.json; funnel events append to
// data/events.log. All persistence is best-effort: write failures are logged
// but never fail a request. The client degrades gracefully without this API,
// so route paths and JSON shapes are the contract — keep them stable.
//
// CLI: `node server.js` or `node server.js --standalone`; port via env PORT
// (default 8080).

import { createServer } from 'node:http';
import { readFile, stat, mkdir, appendFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateDailyLevel, ACHIEVEMENTS, FUNNEL_EVENTS } from './js/content.js';
import { levelById } from './js/levels.js';
import { verifyReplay, TICK_RATE } from './js/rules.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(ROOT, 'data');
const BOARDS_FILE = join(DATA_DIR, 'leaderboards.json');
const EVENTS_LOG = join(DATA_DIR, 'events.log');
const PORT = Number(process.env.PORT) || 8080;

const MAX_BODY = 64 * 1024;      // score submissions
const MAX_EVENT_BODY = 2 * 1024; // telemetry beacons
const RATE_LIMIT = 20;           // score submissions per IP …
const RATE_WINDOW_MS = 60_000;   // … per minute

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.opus': 'audio/ogg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

// ---------------------------------------------------------------------------
// Response helpers. Every API error is {"error":"kebab-case-code"}; stack
// traces are logged server-side only, never sent to clients.
// ---------------------------------------------------------------------------

function sendJson(res, code, obj, extraHeaders = {}) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', ...extraHeaders });
  res.end(JSON.stringify(obj));
}

function apiError(res, code, error) {
  sendJson(res, code, { error });
}

function send(res, code, body, type) {
  res.writeHead(code, { 'content-type': type });
  res.end(body);
}

/** Read a JSON request body with a hard size cap. Throws on violation. */
function readBody(req, limit) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too-large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Leaderboards. Boards: 'global' plus 'daily:<dayKey>'. In-memory map backed
// by a JSON file; loads once at startup, saves after each accepted score.
// ---------------------------------------------------------------------------

let boards = { global: [] };
if (existsSync(BOARDS_FILE)) {
  try {
    const parsed = JSON.parse(readFileSync(BOARDS_FILE, 'utf8'));
    if (parsed && typeof parsed === 'object') boards = parsed;
  } catch (e) {
    console.error('leaderboards: failed to load', BOARDS_FILE, e.message);
  }
}

function saveBoards() {
  mkdir(DATA_DIR, { recursive: true })
    .then(() => writeFile(BOARDS_FILE, JSON.stringify(boards)))
    .catch((e) => console.error('leaderboards: save failed:', e.message));
}

/** Authoritative order: total desc, fewer invalidActions, lower ticks, sessionId. */
function entryCompare(a, b) {
  if (a.total !== b.total) return b.total - a.total;
  if ((a.invalidActions || 0) !== (b.invalidActions || 0)) {
    return (a.invalidActions || 0) - (b.invalidActions || 0);
  }
  if ((a.ticks || 0) !== (b.ticks || 0)) return (a.ticks || 0) - (b.ticks || 0);
  return String(a.sessionId || '').localeCompare(String(b.sessionId || ''));
}

function sortedBoard(name) {
  return (boards[name] || []).slice().sort(entryCompare);
}

const BOARD_LABELS = { global: 'Global' };
function boardLabel(name) {
  if (BOARD_LABELS[name]) return BOARD_LABELS[name];
  if (name.startsWith('daily:')) return 'Daily · ' + name.slice(6);
  return name;
}

/** Public entry shape: {name,total,stars,levelId,dayKey?,duration,rankedAt}. */
function publicEntry(e) {
  const out = {
    name: e.name,
    total: e.total,
    stars: e.stars,
    levelId: e.levelId,
    duration: Math.round(((e.ticks || 0) / TICK_RATE) * 100) / 100,
    rankedAt: e.rankedAt,
  };
  if (e.dayKey) out.dayKey = e.dayKey;
  return out;
}

// ---------------------------------------------------------------------------
// Daily level cache — deterministic per day, generated once per process.
// ---------------------------------------------------------------------------

const dailyCache = new Map();
function dailyLevelFor(dayKey) {
  if (!dailyCache.has(dayKey)) dailyCache.set(dayKey, generateDailyLevel(dayKey));
  return dailyCache.get(dayKey);
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Per-IP sliding-window rate limiter for score submissions.
// ---------------------------------------------------------------------------

const rateBuckets = new Map(); // ip -> number[] of timestamps
function rateLimited(ip) {
  const now = Date.now();
  const hits = (rateBuckets.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_LIMIT) {
    rateBuckets.set(ip, hits);
    return true;
  }
  hits.push(now);
  rateBuckets.set(ip, hits);
  return false;
}

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------

function handleTime(req, res) {
  const now = new Date();
  sendJson(res, 200, {
    time: now.toISOString(),
    dayKey: now.toISOString().slice(0, 10),
  }, { 'cache-control': 'no-store' });
}

function handleDaily(req, res, url) {
  const day = url.searchParams.get('day');
  if (!day || !DAY_RE.test(day)) return apiError(res, 400, 'bad-day');
  const level = dailyLevelFor(day);
  if (!level) {
    // Defective day: generation found no valid candidate; ranking excluded.
    return sendJson(res, 200, { error: 'day-excluded' });
  }
  sendJson(res, 200, level);
}

function handleLeaderboard(req, res, url) {
  const board = url.searchParams.get('board') || 'global';
  let limit = parseInt(url.searchParams.get('limit') || '50', 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 50;
  limit = Math.min(limit, 200);
  const entries = sortedBoard(board).slice(0, limit).map(publicEntry);
  sendJson(res, 200, { entries, board, label: boardLabel(board) });
}

function handleAchievements(req, res) {
  sendJson(res, 200, ACHIEVEMENTS);
}

async function handleEvents(req, res) {
  try {
    const raw = await readBody(req, MAX_EVENT_BODY);
    const body = JSON.parse(raw);
    if (!body || typeof body.event !== 'string' || !FUNNEL_EVENTS.includes(body.event)) {
      res.writeHead(204);
      res.end();
      return; // unknown events are dropped silently; beacons never fail
    }
    // Store only the event name and a coarse (minute-resolution) timestamp.
    const line = JSON.stringify({ t: new Date().toISOString().slice(0, 16), event: body.event }) + '\n';
    mkdir(DATA_DIR, { recursive: true })
      .then(() => appendFile(EVENTS_LOG, line))
      .catch((e) => console.error('events: append failed:', e.message));
    res.writeHead(204);
    res.end();
  } catch (e) {
    res.writeHead(204);
    res.end();
  }
}

async function handleScores(req, res) {
  const ip = req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip)) return apiError(res, 429, 'rate-limited');

  let body;
  try {
    const raw = await readBody(req, MAX_BODY);
    body = JSON.parse(raw);
  } catch (e) {
    return apiError(res, e.message === 'too-large' ? 413 : 400, e.message === 'too-large' ? 'too-large' : 'bad-json');
  }
  if (!body || typeof body !== 'object') return apiError(res, 400, 'bad-json');

  const name = (typeof body.name === 'string' && body.name.trim())
    ? body.name.trim().slice(0, 24)
    : 'Guest';
  const levelId = body.levelId;
  const dayKey = typeof body.dayKey === 'string' && DAY_RE.test(body.dayKey) ? body.dayKey : null;
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.slice(0, 64) : '';
  const envelope = body.envelope;
  const clientScore = body.clientScore;

  // Resolve the level: authored content by id, or regenerate the daily level.
  let level = null;
  if (typeof levelId === 'string') level = levelById(levelId) || null;
  if (!level && dayKey) level = dailyLevelFor(dayKey);
  if (!level) return apiError(res, 422, 'unknown-level');

  // Authoritative replay verification.
  let verdict;
  try {
    verdict = verifyReplay(level, envelope);
  } catch (e) {
    console.error('scores: replay error:', e.message);
    return apiError(res, 422, 'replay-error');
  }
  if (!verdict.ok) return apiError(res, 422, String(verdict.error || 'replay-failed').replace(/^illegal-command:/, 'illegal-command-'));
  if (!clientScore || typeof clientScore !== 'object' || clientScore.total !== verdict.result.total) {
    return apiError(res, 422, 'score-mismatch');
  }

  const entry = {
    name,
    total: verdict.result.total,
    stars: verdict.result.stars,
    invalidActions: verdict.result.invalidActions,
    ticks: verdict.result.ticks,
    levelId: level.id,
    sessionId,
    rankedAt: new Date().toISOString(),
  };
  let board = 'global';
  if (dayKey) {
    entry.dayKey = dayKey;
    board = 'daily:' + dayKey;
  }
  if (!boards[board]) boards[board] = [];
  boards[board].push(entry);
  saveBoards();

  const rank = sortedBoard(board).indexOf(entry) + 1; // entry is object-identical
  sendJson(res, 200, { ok: true, rank });
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

async function handleApi(req, res, url) {
  const { pathname } = url;
  if (pathname === '/api/v1/time' && req.method === 'GET') return handleTime(req, res);
  if (pathname === '/api/v1/daily' && req.method === 'GET') return handleDaily(req, res, url);
  if (pathname === '/api/v1/leaderboard' && req.method === 'GET') return handleLeaderboard(req, res, url);
  if (pathname === '/api/v1/achievements' && req.method === 'GET') return handleAchievements(req, res);
  if (pathname === '/api/v1/scores' && req.method === 'POST') return handleScores(req, res);
  if (pathname === '/api/v1/events' && req.method === 'POST') return handleEvents(req, res);
  return apiError(res, 404, 'not-found');
}

/** Static files: resolve within ROOT, reject traversal and dotfiles. */
async function handleStatic(req, res, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (e) {
    return send(res, 400, 'bad request', 'text/plain');
  }
  if (pathname === '/') pathname = '/index.html';
  // Never serve dotfiles (.git, .env, …) at any depth.
  if (pathname.split('/').some((seg) => seg.startsWith('.') || ['data', 'node_modules', 'tests'].includes(seg))) {
    return send(res, 404, 'not found', 'text/plain');
  }
  const filePath = resolve(ROOT, '.' + pathname);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
    return send(res, 404, 'not found', 'text/plain');
  }
  try {
    const st = await stat(filePath);
    if (!st.isFile()) return send(res, 404, 'not found', 'text/plain');
    const buf = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  } catch (e) {
    send(res, 404, 'not found', 'text/plain');
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'method not allowed', 'text/plain');
    }
    return await handleStatic(req, res, url);
  } catch (e) {
    // Last-resort guard: structured error, no stack traces to clients.
    console.error('request error:', e);
    if (!res.headersSent) apiError(res, 500, 'internal-error');
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log('Tether Treat server listening on http://localhost:' + PORT);
});
