// net.js — StarHermit platform adapter with graceful offline degradation.
//
// Hosted mode activates iff a launch token was read from the URL fragment
// (`#game_token=<jwt>`, optional `&session_id=<guid>`) — never from probing.
// Query params (`?token=`, `?launch=`) are accepted only as a local-dev
// fallback. The token is sent as `Authorization: Bearer` on every REST call
// and re-minted via POST /api/v1/games/{slug}/launch-token every 45 minutes.
// The game slug comes from the token's `game_scope` claim, never hard-coded.
//
// Without a token nothing leaves the game except the unauthenticated
// /api/v1/time clock probe, and every hosted feature degrades to its local
// equivalent (localStorage progress, local score board, local achievements).
// The game's own server.js is a dev convenience that never runs on-platform,
// so its routes are not called from here.

const TIMEOUT_MS = 2000;
const SAVE_TIMEOUT_MS = 8000;
const REFRESH_MS = 45 * 60 * 1000;   // token lifetime is 60 min
const REFRESH_RETRY_MS = 60 * 1000;
const SAVE_DEBOUNCE_MS = 2000;

let token = null;        // raw JWT launch token (never persisted)
let claims = null;       // decoded payload {sub, game_scope, ...}
let nickname = null;     // cached display name
let refreshTimer = null;
let saveTimer = null;
let pendingSave = null;
let saveChain = Promise.resolve();
let flushHooks = false;

let syncCb = null;
let syncState = 'offline';

// ---------------------------------------------------------------------------
// Launch token
// ---------------------------------------------------------------------------
function b64urlJson(part) {
  const bin = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}

function decodeClaims(jwt) {
  try {
    const part = String(jwt).split('.')[1];
    if (!part) return null;
    const c = b64urlJson(part);
    return (c && typeof c === 'object') ? c : null;
  } catch (e) {
    return null;
  }
}

/** Read the launch token once: fragment first (then stripped), query fallback for local dev only. */
function readLaunchToken() {
  let raw = null;
  try {
    const hash = window.location.hash || '';
    if (hash.indexOf('game_token=') !== -1) {
      const params = new URLSearchParams(hash.slice(1));
      raw = params.get('game_token');
      params.delete('game_token');
      params.delete('session_id');
      const rest = params.toString();
      window.history.replaceState(null, '',
        window.location.pathname + window.location.search + (rest ? '#' + rest : ''));
    }
  } catch (e) { /* no fragment access */ }
  if (!raw) {
    try {
      const params = new URLSearchParams(window.location.search);
      raw = params.get('game_token') || params.get('token') || params.get('launch');
    } catch (e) { /* no query access */ }
  }
  return raw;
}

/**
 * Read + decode the launch token and start the refresh cycle when hosted.
 * Call once at boot. Returns {hosted, sub, gameScope}.
 */
export function initPlatform() {
  const raw = readLaunchToken();
  if (raw) {
    const decoded = decodeClaims(raw);
    if (decoded && decoded.sub) {
      token = raw;
      claims = decoded;
    }
  }
  setSync(token ? 'synced' : 'offline');
  if (token) scheduleRefresh(REFRESH_MS);
  return { hosted: !!token, sub: claims ? claims.sub : null, gameScope: gameSlug() };
}

export function isHosted() { return !!token; }

function gameSlug() { return claims && claims.game_scope ? claims.game_scope : null; }

function authHeaders(extra) {
  return Object.assign({ Authorization: 'Bearer ' + token }, extra || {});
}

// ---------------------------------------------------------------------------
// Token refresh (scoped launch tokens may re-mint)
// ---------------------------------------------------------------------------
function scheduleRefresh(delay) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    let ok = false;
    const slug = gameSlug();
    if (slug) {
      try {
        const res = await fetchJson('/api/v1/games/' + encodeURIComponent(slug) + '/launch-token', {
          method: 'POST', headers: authHeaders(), timeout: SAVE_TIMEOUT_MS,
        });
        if (res && res.token) {
          const decoded = decodeClaims(res.token);
          if (decoded && decoded.sub) { token = res.token; claims = decoded; ok = true; }
        }
      } catch (e) { /* retry sooner */ }
    }
    scheduleRefresh(ok ? REFRESH_MS : REFRESH_RETRY_MS);
  }, delay);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function fetchJson(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || TIMEOUT_MS);
  return fetch(url, {
    signal: ctrl.signal, method: opts.method || 'GET', body: opts.body, headers: opts.headers,
  })
    .then((r) => {
      if (!r.ok) throw new Error('http-' + r.status);
      if (r.status === 204) return null;
      return r.json().catch(() => null);
    })
    .finally(() => clearTimeout(timer));
}

/**
 * Get the authoritative UTC date key ('YYYY-MM-DD'). Probes /api/v1/time
 * once and applies the round-trip offset; on failure uses the local clock.
 * Returns {dateKey, nextDailyMs, source:'server'|'local', offsetMs}.
 */
export async function serverClock() {
  const local = () => {
    const now = new Date();
    return {
      dateKey: now.toISOString().slice(0, 10),
      nextDailyMs: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime(),
      source: 'local', offsetMs: 0,
    };
  };
  try {
    const t0 = Date.now();
    const res = await fetchJson('/api/v1/time', token ? { headers: authHeaders() } : {});
    const t1 = Date.now();
    const serverMs = new Date(res.time).getTime();
    if (!Number.isFinite(serverMs)) return local();
    const offset = serverMs - (t0 + t1) / 2;
    const now = Date.now() + offset;
    const d = new Date(now);
    return {
      dateKey: d.toISOString().slice(0, 10),
      nextDailyMs: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now,
      source: 'server', offsetMs: offset,
    };
  } catch (e) {
    return local();
  }
}

// ---------------------------------------------------------------------------
// Profile / nickname (NEVER /api/v1/me, never usernames)
// ---------------------------------------------------------------------------
function fallbackName(userId) { return 'Player ' + String(userId).slice(0, 8); }

const profileCache = {}; // userId -> display name

async function profileName(userId) {
  if (!userId) return 'anon';
  if (profileCache[userId]) return profileCache[userId];
  let name = fallbackName(userId);
  try {
    const p = await fetchJson('/api/v1/users/' + encodeURIComponent(userId) + '/profile', {
      headers: authHeaders(),
    });
    if (p && typeof p.nickname === 'string' && p.nickname.trim()) name = p.nickname.trim();
  } catch (e) { /* keep fallback */ }
  profileCache[userId] = name;
  return name;
}

/**
 * The signed-in player's display name: profile nickname, else
 * 'Player ' + id8. Returns null when playing offline (no token).
 */
export async function loadNickname() {
  if (!token || !claims || !claims.sub) return null;
  if (!nickname) nickname = await profileName(claims.sub);
  return nickname;
}

// ---------------------------------------------------------------------------
// Cloud save (one slot, zip+base64; localStorage stays the offline cache)
// ---------------------------------------------------------------------------
const SAVE_ENTRY = 'save.json';

function setSync(state) {
  syncState = state;
  if (syncCb) syncCb(state);
}

/** Subscribe to sync-status changes ('offline'|'loading'|'saving'|'synced'|'error'). */
export function setSyncListener(cb) { syncCb = cb; cb(syncState); }
export function syncStatus() { return syncState; }

/**
 * Load the remote save doc ({savedAt, progress}) from the cloud slot.
 * 404 / failure → null (local progress stays authoritative).
 */
export async function loadCloudSave() {
  const slug = gameSlug();
  if (!token || !slug) return null;
  setSync('loading');
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SAVE_TIMEOUT_MS);
    const r = await fetch('/api/v1/me/cloud-saves/' + encodeURIComponent(slug), {
      headers: authHeaders(), signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (r.status === 404) { setSync('synced'); return null; }
    if (!r.ok) throw new Error('http-' + r.status);
    const bytes = new Uint8Array(await r.arrayBuffer());
    const doc = JSON.parse(new TextDecoder().decode(unzipFirstEntry(bytes)));
    setSync('synced');
    return (doc && typeof doc === 'object') ? doc : null;
  } catch (e) {
    setSync('error');
    return null;
  }
}

async function putCloudSave(doc) {
  const payload = new TextEncoder().encode(JSON.stringify(doc));
  const body = JSON.stringify({ dataBase64: bytesToBase64(zipStore(SAVE_ENTRY, payload)) });
  await fetchJson('/api/v1/me/cloud-saves/' + encodeURIComponent(gameSlug()), {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body, timeout: SAVE_TIMEOUT_MS,
  });
}

function flushCloudSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!token || !pendingSave) return saveChain;
  const doc = pendingSave;
  pendingSave = null;
  setSync('saving');
  saveChain = saveChain.then(async () => {
    try {
      await putCloudSave(doc);
      setSync('synced');
    } catch (e) {
      pendingSave = pendingSave || doc; // retry on the next change or flush
      setSync('error');
    }
  });
  return saveChain;
}

/**
 * Mirror the progress doc to the cloud slot, debounced ~2 s and flushed on
 * pagehide / tab hide. No-op when offline (localStorage is the cache).
 */
export function scheduleCloudSave(progress) {
  if (!token) return;
  pendingSave = { savedAt: Date.now(), progress };
  setSync('saving');
  if (!flushHooks) {
    flushHooks = true;
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => { flushCloudSave(); });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) flushCloudSave();
      });
    }
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushCloudSave, SAVE_DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// Leaderboards — read-only. Clients can NEVER submit scores; ranked rounds
// keep their personal-best records locally (cloud-saved with progress).
// ---------------------------------------------------------------------------
export async function fetchLeaderboard(board) {
  const slug = gameSlug();
  if (!token || !slug) return null;
  try {
    const meta = await fetchJson('/api/v1/games/' + encodeURIComponent(slug), { headers: authHeaders() });
    const leaderboardId = meta && meta.leaderboardId;
    if (!leaderboardId) return null;
    const qs = '?friendsOnly=' + (board === 'friends') + '&page=1&pageSize=20';
    const data = await fetchJson('/api/v1/leaderboards/' + encodeURIComponent(leaderboardId) + '/entries' + qs, {
      headers: authHeaders(),
    });
    const raw = (data && (data.entries || data.items)) || [];
    const entries = [];
    for (const e of raw.slice(0, 20)) {
      entries.push({
        name: e.userId ? await profileName(e.userId) : 'anon',
        total: typeof e.score === 'number' ? e.score : (e.total || 0),
      });
    }
    return entries;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Funnel telemetry — the platform has no per-game events route reachable by
// launch tokens, so events are dropped locally (dev server also untouched).
// ---------------------------------------------------------------------------
export function funnelEvent(type, data) {
  void type; void data;
}

// ---------------------------------------------------------------------------
// Minimal ZIP writer/reader (stored entries only, no compression).
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStore(name, dataBytes) {
  const enc = new TextEncoder();
  const nameB = enc.encode(name);
  const crc = crc32(dataBytes);
  const out = [];
  const u16 = (v) => out.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v) => out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0);
  u32(crc); u32(dataBytes.length); u32(dataBytes.length);
  u16(nameB.length); u16(0);
  const head = new Uint8Array(out);
  const cd = [];
  const c16 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff);
  const c32 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  c32(0x02014b50); c16(20); c16(20); c16(0); c16(0); c16(0); c16(0);
  c32(crc); c32(dataBytes.length); c32(dataBytes.length);
  c16(nameB.length); c16(0); c16(0); c16(0); c16(0); c32(0); c32(0); // attrs + local-header offset
  const cdHead = new Uint8Array(cd);
  const cdOff = head.length + nameB.length + dataBytes.length;
  const parts = [head, nameB, dataBytes, cdHead, nameB];
  const eocd = [];
  const e32 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  const e16 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff);
  e32(0x06054b50); e16(0); e16(0); e16(1); e16(1);
  e32(cdHead.length + nameB.length); e32(cdOff); e16(0);
  parts.push(new Uint8Array(eocd));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf;
}

function unzipFirstEntry(zipBytes) {
  // Stored single-entry reader: scan local headers for compression 0.
  const dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let off = 0;
  while (off + 30 <= zipBytes.length && dv.getUint32(off, true) === 0x04034b50) {
    const method = dv.getUint16(off + 8, true);
    const size = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const dataOff = off + 30 + nameLen + extraLen;
    if (method !== 0) throw new Error('unsupported zip entry');
    return zipBytes.slice(dataOff, dataOff + size);
  }
  throw new Error('bad zip');
}

function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function base64ToBytes(b64) {
  const s = atob(b64);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

// Exported for the offline zip validation script (tools/validate-cloudsave.mjs).
export const __zip = { zipStore, unzipFirstEntry, bytesToBase64, base64ToBytes };
