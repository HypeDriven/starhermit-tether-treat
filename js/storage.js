// storage.js — versioned, checksummed localStorage persistence.
//
// Two documents: settings and progression. Both carry a hashHex checksum
// over their payload; corrupted or tampered documents are rejected and
// replaced with defaults. Every access is wrapped in try/catch so private
// browsing mode (where localStorage throws) degrades to in-memory state.

import { hashHex } from './rng.js';
import { DEFAULT_GRAPHICS, migrateQuality } from './gfx.js';

export const SETTINGS_KEY = 'tether-treat:settings:v1';
export const PROGRESS_KEY = 'tether-treat:progress:v1';

export const DEFAULT_SETTINGS = {
  version: 1,
  music: 0.6,
  effects: 0.8,
  ambience: 0.5,
  muted: false,
  graphics: DEFAULT_GRAPHICS, // see gfx.js: preset, render_scale, adaptive, show_fps, per-category overrides
  reducedMotion: false,
  highContrast: false,
  largeText: false,
  leftHanded: false,
};

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

function checksumOf(doc) {
  const copy = Object.assign({}, doc);
  delete copy.checksum;
  return hashHex(JSON.stringify(copy));
}

function storageAvailable() {
  try {
    const k = '__tt_probe__';
    globalThis.localStorage.setItem(k, '1');
    globalThis.localStorage.removeItem(k);
    return true;
  } catch (e) {
    return false;
  }
}

const available = typeof globalThis !== 'undefined' &&
  !!globalThis.localStorage && storageAvailable();

// In-memory fallback mirrors the localStorage API surface we use.
const memory = {};
function rawGet(key) {
  if (!available) return memory[key] || null;
  try { return globalThis.localStorage.getItem(key); } catch (e) { return null; }
}
function rawSet(key, value) {
  if (!available) { memory[key] = value; return; }
  try { globalThis.localStorage.setItem(key, value); } catch (e) { /* full/blocked */ }
}

function loadDoc(key, defaults) {
  const raw = rawGet(key);
  if (!raw) return Object.assign({}, defaults);
  try {
    const doc = JSON.parse(raw);
    if (!doc || doc.version !== defaults.version) return Object.assign({}, defaults);
    if (doc.checksum !== checksumOf(doc)) return Object.assign({}, defaults);
    delete doc.checksum;
    // Merge over defaults so new fields appear on old documents.
    return Object.assign({}, defaults, doc);
  } catch (e) {
    return Object.assign({}, defaults);
  }
}

function saveDoc(key, doc) {
  const out = Object.assign({}, doc);
  out.checksum = checksumOf(out);
  rawSet(key, JSON.stringify(out));
}

export function loadSettings() {
  const s = loadDoc(SETTINGS_KEY, DEFAULT_SETTINGS);
  // Older documents carried a single `quality` tier; map it onto a preset.
  if (s.quality !== undefined && (!s.graphics || s.graphics === DEFAULT_SETTINGS.graphics)) {
    s.graphics = Object.assign({}, DEFAULT_GRAPHICS, { preset: migrateQuality(s.quality) });
  }
  delete s.quality;
  s.graphics = Object.assign({}, DEFAULT_GRAPHICS, s.graphics || {});
  return s;
}
export function saveSettings(s) { saveDoc(SETTINGS_KEY, s); }

export function loadProgress() {
  const p = loadDoc(PROGRESS_KEY, DEFAULT_PROGRESS);
  p.cosmetics = Object.assign({}, DEFAULT_PROGRESS.cosmetics, p.cosmetics || {});
  return p;
}
export function saveProgress(p) {
  p.totalStars = Object.values(p.levels || {}).reduce((n, l) => n + (l.stars || 0), 0);
  saveDoc(PROGRESS_KEY, p);
}

/** Record a journey result; keeps best stars/score per level. */
export function recordLevelResult(progress, levelId, { completed, stars, score }) {
  const prev = progress.levels[levelId] || { completed: false, stars: 0, bestScore: 0 };
  progress.levels[levelId] = {
    completed: prev.completed || completed,
    stars: Math.max(prev.stars, stars),
    bestScore: Math.max(prev.bestScore, score),
  };
}

/** Append an entry to the local leaderboard (kept sorted, top 50). */
export function recordLocalScore(progress, entry) {
  progress.board = (progress.board || []).concat([entry])
    .sort((a, b) => b.total - a.total).slice(0, 50);
}

/**
 * Progress from two devices: per stage completed if either side completed it,
 * the most stars and the best score; lessons, achievements and daily days
 * united; the local score board merged (top 50). `prefer` ('remote' | 'local')
 * decides whose cosmetics and Continue target win. Either side may be null.
 */
export function mergeProgress(remote, local, prefer = 'remote') {
  const a = Object.assign({}, DEFAULT_PROGRESS, remote || {});
  const b = Object.assign({}, DEFAULT_PROGRESS, local || {});
  const [win, lose] = prefer === 'local' ? [b, a] : [a, b];
  const levels = Object.assign({}, a.levels);
  for (const [id, r] of Object.entries(b.levels || {})) {
    const p = levels[id];
    levels[id] = !p ? r : {
      completed: !!(p.completed || r.completed),
      stars: Math.max(p.stars || 0, r.stars || 0),
      bestScore: Math.max(p.bestScore || 0, r.bestScore || 0),
    };
  }
  const union = (x, y) => Array.from(new Set([].concat(x || [], y || [])));
  const seen = new Set();
  const board = [].concat(a.board || [], b.board || []).filter((e) => {
    const k = JSON.stringify([e.total, e.levelId, e.at, e.delivered]);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((x, y) => y.total - x.total).slice(0, 50);
  return Object.assign({}, lose, win, {
    levels,
    tutorialsDone: union(a.tutorialsDone, b.tutorialsDone),
    achievements: union(a.achievements, b.achievements),
    dailyDays: union(a.dailyDays, b.dailyDays),
    cosmetics: Object.assign({}, lose.cosmetics, win.cosmetics),
    lastLevel: win.lastLevel || lose.lastLevel,
    board,
    totalStars: Object.values(levels).reduce((n, l) => n + (l.stars || 0), 0),
  });
}
