// storage.js — versioned, checksummed localStorage persistence.
//
// Two documents: settings and progression. Both carry a hashHex checksum
// over their payload; corrupted or tampered documents are rejected and
// replaced with defaults. Every access is wrapped in try/catch so private
// browsing mode (where localStorage throws) degrades to in-memory state.

import { hashHex } from './rng.js';

export const SETTINGS_KEY = 'tether-treat:settings:v1';
export const PROGRESS_KEY = 'tether-treat:progress:v1';

export const DEFAULT_SETTINGS = {
  version: 1,
  music: 0.6,
  effects: 0.8,
  ambience: 0.5,
  muted: false,
  quality: 'auto',        // auto | low | medium | high
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

export function loadSettings() { return loadDoc(SETTINGS_KEY, DEFAULT_SETTINGS); }
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
