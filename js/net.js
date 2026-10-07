// net.js — StarHermit platform adapter over window.StarHermit
// (starhermit-sdk.js) with graceful offline degradation.
//
// Hosted mode = the SDK holds a launch token (#game_token=… from the library,
// #access_token=… from the direct sign-in return), read once by
// StarHermit.init() and stripped from the URL. The SDK renews it, sends the
// Bearer header and derives the slug from the token's game_scope claim.
//
// Without a token nothing leaves the game and every hosted feature degrades
// to its local equivalent (localStorage progress, local score board, local
// achievements). The client never calls the game's own server.js routes,
// on any host (loopback included); the daily key uses the local clock.

const SAVE_DEBOUNCE_MS = 2000;
const SETTINGS_PUSH_MS = 800;

/** Preferences mirrored to the platform settings KV. */
export const PREF_KEYS = ['music', 'effects', 'ambience', 'muted', 'graphics', 'reducedMotion',
  'highContrast', 'largeText', 'leftHanded'];
/** Keyboard actions (KeyboardEvent.code) — mirrors control.* in starhermit.txt. */
export const DEFAULT_BINDINGS = {
  prev: ['ArrowLeft', 'ArrowUp'], next: ['ArrowRight', 'ArrowDown'], confirm: ['Enter', 'Space'],
  pause: ['Escape'], undo: ['KeyU'], hint: ['KeyH'], restart: ['KeyR'], camera: ['KeyC'],
};

const SH = () => (typeof globalThis !== 'undefined' && globalThis.StarHermit) || null;

let nickname = null;     // cached display name
let syncCb = null;
let syncState = 'offline';
let authCb = null;
let flushHooks = false;
let pushedPrefs = {};
let prefTimer = null;

/**
 * Read the launch token (StarHermit.init) and start renewal. Call once at
 * boot. Returns {hosted, sub, gameScope}.
 */
export function initPlatform() {
  const sh = SH();
  if (sh) {
    sh.init();
    sh.on('saved', (ok) => setSync(ok ? 'synced' : 'error'));
    sh.on('auth', (a) => {
      if (!a.signedIn) { nickname = null; setSync('offline'); }
      if (authCb) authCb(a);
    });
  }
  setSync(isHosted() ? 'synced' : 'offline');
  if (isHosted()) installFlushHooks();
  return { hosted: isHosted(), sub: isHosted() ? sh.userId : null, gameScope: sh ? sh.slug : null };
}

export function isHosted() { const sh = SH(); return !!(sh && sh.signedIn); }
export function canSignIn() { const sh = SH(); return !!(sh && sh.canSignIn()); }
export function signIn() { const sh = SH(); return !!(sh && sh.signIn()); }
/** Share link that friends the recipient and invites them back; null offline. */
export function inviteLink() { return isHosted() ? SH().inviteLink() : null; }
/** cb({signedIn}) on SDK sign-out (renewal refused). */
export function onAuthChange(cb) { authCb = cb; }

/**
 * UTC date key ('YYYY-MM-DD') for the daily level, from the local clock.
 * Returns {dateKey, nextDailyMs, source:'local'}.
 */
export function serverClock() {
  const now = new Date();
  return {
    dateKey: now.toISOString().slice(0, 10),
    nextDailyMs: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime(),
    source: 'local',
  };
}

// ---------------------------------------------------------------------------
// Profile / nickname (NEVER /api/v1/me, never usernames)
// ---------------------------------------------------------------------------
async function profileName(userId) {
  if (!userId) return 'anon';
  const p = await SH().profile(userId);
  return p ? p.displayName : 'Player ' + String(userId).slice(0, 6);
}

/**
 * The signed-in player's display name: profile nickname, else
 * 'Player ' + id prefix. Returns null when playing offline (no token).
 */
export async function loadNickname() {
  if (!isHosted()) return null;
  if (!nickname) nickname = await profileName(SH().userId);
  return nickname;
}

// ---------------------------------------------------------------------------
// Cloud save (game:<slug> slot; localStorage stays the offline cache)
// ---------------------------------------------------------------------------
function setSync(state) {
  syncState = state;
  if (syncCb) syncCb(state);
}

/** Subscribe to sync-status changes ('offline'|'loading'|'saving'|'synced'|'error'). */
export function setSyncListener(cb) { syncCb = cb; cb(syncState); }
export function syncStatus() { return syncState; }

function installFlushHooks() {
  if (flushHooks || typeof window === 'undefined' || !window.addEventListener) return;
  flushHooks = true;
  const flush = () => { if (isHosted()) SH().flushSave(true); };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
}

/**
 * Load the remote save doc ({savedAt, progress}) from the cloud slot.
 * Empty / failure → null (local progress stays authoritative).
 */
export async function loadCloudSave() {
  if (!isHosted()) return null;
  setSync('loading');
  const doc = await SH().loadJSON();
  setSync('synced');
  return (doc && typeof doc === 'object') ? doc : null;
}

/** Flush a pending cloud save now (pagehide uses keepalive). */
export function flushCloudSave(keepalive) {
  return isHosted() ? SH().flushSave(!!keepalive) : Promise.resolve(false);
}

/**
 * Mirror the progress doc to the cloud slot, debounced ~2 s and flushed on
 * pagehide / tab hide. No-op when offline (localStorage is the cache).
 */
export function scheduleCloudSave(progress) {
  if (!isHosted()) return;
  installFlushHooks();
  setSync('saving');
  SH().saveJSON({ savedAt: Date.now(), progress }, SAVE_DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// Settings KV + controls
// ---------------------------------------------------------------------------
function pickPrefs(s) {
  const out = {};
  for (const k of PREF_KEYS) if (s && s[k] !== undefined) out[k] = s[k];
  return out;
}

/** Platform-stored preferences (signed in): {key: value} that win over local. */
export async function loadPlatformSettings(local) {
  if (!isHosted()) return null;
  const remote = await SH().getSettings();
  const patch = {};
  for (const k of PREF_KEYS) if (remote && remote[k] != null) patch[k] = remote[k];
  pushedPrefs = Object.assign(pickPrefs(local), patch);
  return patch;
}

/** Debounced PATCH of changed preference keys (no-op offline). */
export function pushSettings(s) {
  if (!isHosted()) return;
  clearTimeout(prefTimer);
  prefTimer = setTimeout(() => {
    const prefs = pickPrefs(s), diff = {};
    for (const k of PREF_KEYS) {
      if (JSON.stringify(prefs[k]) !== JSON.stringify(pushedPrefs[k])) diff[k] = prefs[k] === undefined ? null : prefs[k];
    }
    if (!Object.keys(diff).length) return;
    Object.assign(pushedPrefs, diff);
    SH().patchSettings(diff);
  }, SETTINGS_PUSH_MS);
}

/** Effective keyboard bindings; platform overrides win when signed in. */
export async function loadBindings() {
  if (!isHosted()) {
    const out = {};
    for (const k of Object.keys(DEFAULT_BINDINGS)) out[k] = DEFAULT_BINDINGS[k].slice();
    return out;
  }
  return SH().loadBindings(DEFAULT_BINDINGS);
}

// ---------------------------------------------------------------------------
// Leaderboards — finished rounds post through submitScore (score-script.js);
// personal-best records also stay local (cloud-saved with progress).
// ---------------------------------------------------------------------------
/** Post a round total to the high-score board → { posted, rank }. Standalone: no request. */
export async function submitScore(total) {
  if (!isHosted()) return { posted: false, rank: null };
  const sh = SH();
  const keys = await sh.submitScores({ 'high-score': total }).catch(() => []);
  if (keys.indexOf('high-score') < 0) return { posted: false, rank: null };
  try {
    const r = await sh.leaderboard('high-score', { pageSize: 100 });
    const me = (r.items || []).find((i) => i.userId === sh.userId);
    return { posted: true, rank: me ? me.rank : null };
  } catch (e) { return { posted: true, rank: null }; }
}

export async function fetchLeaderboard(board) {
  if (!isHosted()) return null;
  const r = await SH().leaderboard(null, { pageSize: 20, scope: board === 'friends' ? 'friends' : undefined });
  if (!r || !r.board) return null;
  const entries = [];
  for (const e of (r.items || []).slice(0, 20)) {
    entries.push({
      name: e.userId ? await profileName(e.userId) : 'anon',
      total: typeof e.score === 'number' ? e.score : (e.total || 0),
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Funnel telemetry — the platform has no per-game events route reachable by
// launch tokens, so events are dropped locally (dev server also untouched).
// ---------------------------------------------------------------------------
export function funnelEvent(type, data) {
  void type; void data;
}
