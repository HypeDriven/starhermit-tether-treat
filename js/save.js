// save.js — the engine client's save model. Pure (no storage, no platform) so
// the engine client (native/platform.ts) and the node tests share it.
//
// The engine save (starhermit:storage `saves`, schema 1) is { v: 1, progress }
// — the progression document the browser build kept in localStorage
// (tether-treat:progress:v1) and mirrored to the cloud slot game:<slug>
// through the JS SDK's saveJSON as { savedAt, progress }. Two saves merge as
// the browser build merged on its saveconflict (storage.js mergeProgress: per
// stage completed if either side completed it, the most stars and the best
// score; lessons, achievements and daily days united; the local score board
// merged, top 50). readForeign() reads that old cloud slot's text.

export const DEFAULT_PROGRESS = {
  version: 1,
  levels: {},             // id -> {completed, stars, bestScore}
  tutorialsDone: [],      // tutorial level ids
  achievements: [],       // achievement keys
  dailyDays: [],          // UTC date keys played
  cosmetics: { treat: 'swirl', trail: 'none', room: 'workshop' },
  totalStars: 0,
  lastLevel: null,        // last journey level played (Continue target)
  board: [],              // local leaderboard entries
};

const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
const strList = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []);

export function emptyProgress() {
  return JSON.parse(JSON.stringify(DEFAULT_PROGRESS));
}

/** A progression from anything (missing or broken fields from the defaults). */
export function normalizeProgress(raw) {
  const p = obj(raw);
  const levels = {};
  for (const [id, r] of Object.entries(obj(p.levels))) {
    const o = obj(r);
    levels[id] = { completed: !!o.completed, stars: Math.max(0, Math.min(5, Number(o.stars) || 0)), bestScore: Math.max(0, Number(o.bestScore) || 0) };
  }
  const c = obj(p.cosmetics);
  const board = (Array.isArray(p.board) ? p.board : []).filter((e) => e && typeof e === 'object' && Number.isFinite(e.total))
    .map((e) => ({ total: e.total, delivered: !!e.delivered, levelId: String(e.levelId || ''), at: Number(e.at) || 0 }));
  const out = {
    version: 1,
    levels,
    tutorialsDone: strList(p.tutorialsDone),
    achievements: strList(p.achievements),
    dailyDays: strList(p.dailyDays),
    cosmetics: {
      treat: typeof c.treat === 'string' ? c.treat : 'swirl',
      trail: typeof c.trail === 'string' ? c.trail : 'none',
      room: typeof c.room === 'string' ? c.room : 'workshop',
    },
    totalStars: 0,
    lastLevel: typeof p.lastLevel === 'string' ? p.lastLevel : null,
    board,
  };
  out.totalStars = totalStars(out);
  return out;
}

export function totalStars(p) {
  return Object.values(p.levels || {}).reduce((n, l) => n + (l.stars || 0), 0);
}

/** Record a journey result; keeps best stars/score per level (storage.js). */
export function recordLevelResult(progress, levelId, { completed, stars, score }) {
  const prev = progress.levels[levelId] || { completed: false, stars: 0, bestScore: 0 };
  progress.levels[levelId] = {
    completed: prev.completed || completed,
    stars: Math.max(prev.stars, stars),
    bestScore: Math.max(prev.bestScore, score),
  };
  progress.totalStars = totalStars(progress);
}

/** Append an entry to the local leaderboard (kept sorted, top 50). */
export function recordLocalScore(progress, entry) {
  progress.board = (progress.board || []).concat([entry])
    .sort((a, b) => b.total - a.total).slice(0, 50);
}

/**
 * storage.js mergeProgress: progress from two devices. `prefer` ('remote' |
 * 'local') decides whose cosmetics and Continue target win.
 */
export function mergeProgress(remote, local, prefer = 'remote') {
  const a = normalizeProgress(remote);
  const b = normalizeProgress(local);
  const [win, lose] = prefer === 'local' ? [b, a] : [a, b];
  const levels = Object.assign({}, a.levels);
  for (const [id, r] of Object.entries(b.levels)) {
    const p = levels[id];
    levels[id] = !p ? r : {
      completed: !!(p.completed || r.completed),
      stars: Math.max(p.stars || 0, r.stars || 0),
      bestScore: Math.max(p.bestScore || 0, r.bestScore || 0),
    };
  }
  const union = (x, y) => Array.from(new Set([].concat(x || [], y || [])));
  const seen = new Set();
  const board = [].concat(a.board, b.board).filter((e) => {
    const k = JSON.stringify([e.total, e.levelId, e.at, e.delivered]);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((x, y) => y.total - x.total).slice(0, 50);
  const out = {
    version: 1,
    levels,
    tutorialsDone: union(a.tutorialsDone, b.tutorialsDone),
    achievements: union(a.achievements, b.achievements),
    dailyDays: union(a.dailyDays, b.dailyDays),
    cosmetics: Object.assign({}, lose.cosmetics, win.cosmetics),
    totalStars: 0,
    lastLevel: win.lastLevel || lose.lastLevel,
    board,
  };
  out.totalStars = totalStars(out);
  return out;
}

export function emptySave() { return { v: 1, progress: emptyProgress() }; }

/** A save document from anything. */
export function normalize(raw) {
  return { v: 1, progress: normalizeProgress(obj(raw).progress) };
}

/** Merge two saves (another device's / the old cloud slot's, and this device's). */
export function mergeSave(remote, local, prefer = 'remote') {
  return { v: 1, progress: mergeProgress(normalize(remote).progress, normalize(local).progress, prefer) };
}

function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
/** Same content, whatever the key order. */
export function sameSave(a, b) { return stable(normalize(a)) === stable(normalize(b)); }

/**
 * The browser build's cloud slot text ({ savedAt, progress }, net.js
 * scheduleCloudSave) as a save, or null when it is not one.
 */
export function readForeign(text) {
  if (typeof text !== 'string' || !text) return null;
  try {
    const doc = JSON.parse(text);
    if (!doc || typeof doc !== 'object' || !doc.progress || typeof doc.progress !== 'object') return null;
    return normalize({ progress: doc.progress });
  } catch { return null; }
}

/**
 * The game's own options (engine `settings`, synced with the account): the
 * left-handed layout. The browser build's other preferences (volumes, mute,
 * graphics, reduced motion, high contrast, larger text) are the runtime's
 * Options now.
 */
export const DEFAULT_OPTIONS = { leftHanded: false };
export const OPTION_KEYS = Object.keys(DEFAULT_OPTIONS);
/** net.js PREF_KEYS: the browser build's settings KV keys. */
export const BROWSER_KEYS = ['music', 'effects', 'ambience', 'muted', 'graphics', 'reducedMotion', 'highContrast', 'largeText', 'leftHanded'];

/** Valid option values from anything. */
export function pickOptions(raw) {
  const r = obj(raw), out = {};
  if (typeof r.leftHanded === 'boolean') out.leftHanded = r.leftHanded;
  return out;
}
