// content.js — versioned content data, validators, generators, themes.
//
// Content is data: identifier, seed, initial state, goals, allowed mechanics,
// par values, tutorial flags and a presentation theme. Validators prove basic
// legality, reachable goals (by simulating the authored solution), bounded
// duration and the absence of soft locks. Daily/practice levels come from
// seeded archetype generators whose outputs are re-validated by the same
// solution runner, so generated content is provable before it is served.

import { createGame, applyCommand, step, scoreOf, listLegalActions, treatSpeedSq, STATUS } from './rules.js';
import { w2s, v2s, s2w, TICK_RATE } from './physics.js';
import { makeRng, hashHex } from './rng.js';

export const CONTENT_VERSION = 1;
export const BUILD_ID = 'tether-treat-1.0.0';

export const MECHANICS = ['cut', 'multi-rope', 'stars', 'bubble', 'fan', 'bumper', 'spikes', 'slider'];

// ---------------------------------------------------------------------------
// Themes (five visual themes; cosmetic only — never change rules or hazards)
// ---------------------------------------------------------------------------
export const THEMES = {
  gumdrop: {
    id: 'gumdrop', name: 'Gumdrop Garage',
    bg0: '#2b1a3d', bg1: '#51204a', floor: '#3d2450', wall: '#69305c',
    accent: '#ff7eb6', accent2: '#7ef0d4', rope: '#ffe3f1', treat: '#ff5d8f',
    star: '#ffd94a', metal: '#c9b8e8', hazard: '#ff4d5e', key: '#ffd9ec',
    fog: '#3a2354', ambience: { base: 196, shimmer: 0.4 },
  },
  fizz: {
    id: 'fizz', name: 'Fizzworks',
    bg0: '#0e2a4a', bg1: '#155e75', floor: '#123a5c', wall: '#1d6f8a',
    accent: '#57d8ff', accent2: '#ffe066', rope: '#d9f6ff', treat: '#ff9f5a',
    star: '#ffe45e', metal: '#a8d8e8', hazard: '#ff5a6e', key: '#c8ecff',
    fog: '#123554', ambience: { base: 174, shimmer: 0.6 },
  },
  gust: {
    id: 'gust', name: 'Gust Garden',
    bg0: '#14352a', bg1: '#2c6e49', floor: '#1d4a38', wall: '#3c8a5f',
    accent: '#b8f27c', accent2: '#7cc7ff', rope: '#eefbdf', treat: '#ffb84d',
    star: '#fff06a', metal: '#c2dcc8', hazard: '#ff6a5e', key: '#e4ffd2',
    fog: '#173f31', ambience: { base: 220, shimmer: 0.5 },
  },
  taffy: {
    id: 'taffy', name: 'Tumble Taffy',
    bg0: '#3d2412', bg1: '#7a4a1d', floor: '#4a2f18', wall: '#96622c',
    accent: '#ffb35c', accent2: '#ff8fa3', rope: '#ffe8cf', treat: '#ff6a88',
    star: '#ffd24a', metal: '#e0c39a', hazard: '#ff4444', key: '#ffe0b8',
    fog: '#452a14', ambience: { base: 147, shimmer: 0.35 },
  },
  clockwork: {
    id: 'clockwork', name: 'Clockwork Confection',
    bg0: '#241a3a', bg1: '#4a3a6e', floor: '#2f2450', wall: '#5d4a8a',
    accent: '#c9a0ff', accent2: '#ffd700', rope: '#e8dcff', treat: '#6ef2c8',
    star: '#ffe45e', metal: '#d8c8f0', hazard: '#ff4d6e', key: '#e0d0ff',
    fog: '#2b2144', ambience: { base: 165, shimmer: 0.45 },
  },
};
export const THEME_ORDER = ['gumdrop', 'fizz', 'gust', 'taffy', 'clockwork'];

// ---------------------------------------------------------------------------
// Level records
// ---------------------------------------------------------------------------

/** Normalize a raw level definition into a full versioned level record. */
export function buildLevel(raw) {
  const level = {
    id: raw.id,
    version: raw.version || CONTENT_VERSION,
    world: raw.world || 0,
    index: raw.index || 0,
    name: raw.name || raw.id,
    seed: String(raw.seed !== undefined ? raw.seed : raw.id),
    theme: raw.theme || 'gumdrop',
    mechanics: raw.mechanics ? raw.mechanics.slice() : ['cut'],
    par: {
      actions: raw.par && raw.par.actions !== undefined ? raw.par.actions : (raw.solution || []).length,
      seconds: raw.par && raw.par.seconds !== undefined ? raw.par.seconds : 12,
    },
    maxSeconds: raw.maxSeconds || 90,
    layout: raw.layout,
    solution: (raw.solution || []).map((s) => Object.assign({}, s)),
    tutorial: raw.tutorial ? raw.tutorial.map((s) => Object.assign({}, s)) : null,
    modifiers: raw.modifiers ? Object.assign({}, raw.modifiers) : {},
    mastery: !!raw.mastery,
    ranked: !!raw.ranked,
    blurb: raw.blurb || '',
  };
  return level;
}

/** Static legality validation: shape, references, counts. Returns errors. */
export function validateLevelData(level) {
  const errors = [];
  const L = level.layout;
  if (!level.id || typeof level.id !== 'string') errors.push('missing id');
  if (!L) { errors.push('missing layout'); return errors; }
  if (!L.treat) errors.push('missing treat');
  if (!L.recipient) errors.push('missing recipient');
  if (!Array.isArray(L.ropes) || L.ropes.length === 0) errors.push('needs at least one rope');
  const sliderIds = new Set((L.sliders || []).map((s) => s.id));
  for (const r of L.ropes || []) {
    if (r.slider && !sliderIds.has(r.slider)) errors.push('rope -> unknown slider ' + r.slider);
    if (!r.slider && (typeof r.x !== 'number' || typeof r.y !== 'number')) errors.push('rope missing anchor');
  }
  for (const m of level.mechanics) if (!MECHANICS.includes(m)) errors.push('unknown mechanic ' + m);
  if ((L.stars || []).length > 5) errors.push('too many stars');
  const ids = new Set();
  for (const coll of ['ropes', 'sliders', 'bubbles', 'fans', 'bumpers', 'spikes', 'stars']) {
    (L[coll] || []).forEach((e, i) => {
      const id = e.id || coll + '-' + i;
      if (ids.has(id)) errors.push('duplicate id ' + id);
      ids.add(id);
    });
  }
  for (const s of level.solution) {
    if (!s.do || !s.do.type || !s.do.id) { errors.push('solution step missing action'); continue; }
    const coll = { cut: 'ropes', pop: 'bubbles', fan: 'fans' }[s.do.type];
    if (!coll) { errors.push('solution step bad type ' + s.do.type); continue; }
    const list = L[coll] || [];
    const found = list.some((e, i) => (e.id || coll.slice(0, -1) + '-' + i) === s.do.id);
    if (!found) errors.push('solution references missing ' + s.do.id);
  }
  if (level.par.actions < level.solution.length) errors.push('par.actions below solution length');
  return errors;
}

// ---------------------------------------------------------------------------
// Solution runner (offline validator + hint source). Trigger evaluation uses
// integer simulation quantities only, so validation is engine-deterministic.
// ---------------------------------------------------------------------------

export function triggerMet(trig, state) {
  if (trig.tick !== undefined && state.tick < trig.tick) return false;
  if (trig.belowY !== undefined && state.treat.y >= w2s(trig.belowY)) return false;
  if (trig.aboveY !== undefined && state.treat.y <= w2s(trig.aboveY)) return false;
  if (trig.leftOf !== undefined && state.treat.x >= w2s(trig.leftOf)) return false;
  if (trig.rightOf !== undefined && state.treat.x <= w2s(trig.rightOf)) return false;
  if (trig.speedBelow !== undefined) {
    const v = v2s(trig.speedBelow);
    if (treatSpeedSq(state) >= v * v) return false;
  }
  if (trig.speedAbove !== undefined) {
    const v = v2s(trig.speedAbove);
    if (treatSpeedSq(state) <= v * v) return false;
  }
  if (trig.starGot !== undefined) {
    const s = state.stars.find((st) => st.id === trig.starGot);
    if (!s || !s.got) return false;
  }
  if (trig.sliderX !== undefined) {
    const s = state.sliders.find((sl) => sl.id === trig.slider);
    if (!s) return false;
    const dir = trig.sliderDir || 1;
    if (dir >= 0 ? s.x < w2s(trig.sliderX) : s.x > w2s(trig.sliderX)) return false;
  }
  return true;
}

/** Mirror a solution trigger set across x=0 (for mirrored challenges). */
function mirrorTriggers(s) {
  const out = Object.assign({}, s);
  if (out.leftOf !== undefined) { out.rightOf = -out.leftOf; delete out.leftOf; }
  else if (out.rightOf !== undefined) { out.leftOf = -out.rightOf; delete out.rightOf; }
  if (out.sliderX !== undefined) { out.sliderX = -out.sliderX; }
  return out;
}

/**
 * Simulate the authored solution through the real command path.
 * Returns {ok, state, stars, ticks, error?}. Every solution step must fire
 * and every fired step must be legal; the treat must be delivered.
 */
export function runSolution(level, opts = {}) {
  const state = createGame(level, { modifiers: opts.modifiers, mirrorX: !!(opts.modifiers && opts.modifiers.mirrorX) });
  const mirrored = !!(opts.mirrorTriggers || (opts.modifiers && opts.modifiers.mirrorX) || (level.modifiers && level.modifiers.mirrorX));
  const sol = (level.solution || []).map((s) => (mirrored ? mirrorTriggers(s) : s));
  const fired = sol.map(() => false);
  const limit = state.maxTicks + 2;
  let guard = 0;
  while (state.status === STATUS.ACTIVE && state.tick <= limit) {
    for (let i = 0; i < sol.length; i++) {
      if (fired[i]) continue;
      if (triggerMet(sol[i], state)) {
        const res = applyCommand(state, { id: 'sol-' + i, type: sol[i].do.type, target: sol[i].do.id, on: sol[i].do.on });
        if (!res.ok) {
          return { ok: false, state, stars: 0, ticks: state.tick, error: 'step ' + i + ' (' + sol[i].do.type + ' ' + sol[i].do.id + ') illegal: ' + res.reason };
        }
        fired[i] = true;
      }
    }
    step(state);
    if (++guard > limit + 10) return { ok: false, state, stars: 0, ticks: state.tick, error: 'guard exceeded' };
  }
  const stars = state.stars.filter((s) => s.got).length;
  const unfired = fired.findIndex((f) => !f);
  if (unfired >= 0 && state.status === STATUS.WON) {
    return { ok: false, state, stars, ticks: state.tick, error: 'step ' + unfired + ' never fired' };
  }
  if (state.status !== STATUS.WON) {
    return { ok: false, state, stars, ticks: state.tick, error: 'not delivered: ' + state.reason };
  }
  return { ok: true, state, stars, ticks: state.tick, score: scoreOf(state) };
}

/**
 * Hint: the next unmatched authored-solution action that is currently legal,
 * else the first legal action. Hints call the same legal-action API as play.
 */
export function hintFor(state, level) {
  const legal = listLegalActions(state);
  if (legal.length === 0) return null;
  const sol = level.solution || [];
  let li = 0;
  for (const s of sol) {
    if (li < state.log.length && state.log[li].type === s.do.type && state.log[li].target === s.do.id) {
      li++;
      continue;
    }
    const match = legal.find((a) => a.type === s.do.type && a.id === s.do.id);
    if (match) return { action: match, authored: true };
  }
  return { action: legal[0], authored: false };
}

// ---------------------------------------------------------------------------
// Seeded generators (Daily / Practice). Every candidate is validated by
// runSolution; deterministic retry makes publication reproducible.
// ---------------------------------------------------------------------------

function round2(v) { return Math.round(v * 100) / 100; }

/**
 * Sample the deterministic treat trajectory of a level's authored solution.
 * Generators use this to place stars exactly on the flown path, so generated
 * stages are all-star collectable by construction (then re-proven by
 * runSolution in generateValidated).
 */
function trajectorySamples(level, every = 6) {
  const state = createGame(level);
  const sol = level.solution || [];
  const fired = sol.map(() => false);
  const pts = [];
  const limit = state.maxTicks + 2;
  while (state.status === STATUS.ACTIVE && state.tick <= limit) {
    for (let i = 0; i < sol.length; i++) {
      if (!fired[i] && triggerMet(sol[i], state)) {
        applyCommand(state, { id: 'traj-' + i, type: sol[i].do.type, target: sol[i].do.id, on: sol[i].do.on });
        fired[i] = true;
      }
    }
    if (state.tick % every === 0) pts.push({ x: s2w(state.treat.x), y: s2w(state.treat.y) });
    step(state);
  }
  return pts;
}

/** Place `count` stars at evenly spaced samples of the solution trajectory. */
function starsOnTrajectory(level, count = 3) {
  const pts = trajectorySamples(level);
  if (pts.length < 8) return [];
  const R = level.layout.recipient;
  const stars = [];
  for (let k = 1; k <= count; k++) {
    const p = pts[Math.floor((pts.length - 1) * k / (count + 1))];
    const star = { x: round2(p.x), y: round2(p.y) };
    // Keep stars clear of the recipient's capture circle.
    if (Math.hypot(star.x - R.x, star.y - R.y) < (R.r !== undefined ? R.r : 1.05) + 0.6) continue;
    if (stars.some((s) => Math.hypot(s.x - star.x, s.y - star.y) < 0.8)) continue;
    stars.push(star);
  }
  return stars;
}

/** Pendulum-then-drop: cut the side rope, swing, cut the top rope, free fall. */
function genPendulum(rng, o = {}) {
  const ax = round2(rng.range(-1.5, 1.5));
  const ay = round2(rng.range(5.5, 6.5));
  const dx = round2(rng.range(2.6, 3.6));
  const drop = round2(rng.range(1.3, 1.8));
  const tx = round2(ax - dx);
  const ty = round2(ay - drop);
  // measured: v_bottom ~ 0.76 * sqrt(2 g drop); falling from (ax, ay-L)
  const L = Math.hypot(dx, drop);
  const yBottom = ay - L;
  const v = 0.76 * Math.sqrt(2 * 9.84375 * drop);
  const ry = -5;
  const tFall = Math.sqrt((2 * (yBottom - ry)) / 9.84375);
  const landX = ax + v * tFall * 0.94;
  const rx = round2(Math.max(-9, Math.min(9, landX + rng.range(-0.3, 0.3))));
  const cutX = round2(ax + rng.range(-0.15, 0.1));
  const raw = {
    id: o.id || 'gen-pendulum', world: o.world || 0, name: o.name || 'Swing By',
    theme: o.theme || 'gumdrop', mechanics: ['cut', 'multi-rope', 'stars'],
    seed: o.seed || 'gen',
    layout: {
      treat: { x: tx, y: ty },
      ropes: [{ id: 'rope-0', x: ax, y: ay }],
      stars: [],
      recipient: { x: rx, y: ry },
    },
    solution: [{ rightOf: cutX, speedAbove: 2, do: { type: 'cut', id: 'rope-0' } }],
  };
  raw.layout.stars = starsOnTrajectory(buildLevel(raw), 3);
  return raw;
}

/** Bubble rise: cut, drop into bubble, float up, pop beside the recipient. */
function genBubbleRise(rng, o = {}) {
  const bx = round2(rng.range(-3, 3));
  // Recipient sits slightly off the rise line: close enough that the short
  // post-pop coast enters the capture circle, far enough that the bubble
  // itself is not captured before the pop can fire.
  const dir = rng.int(0, 1) === 0 ? 1 : -1;
  const rx = round2(bx + dir * rng.range(0.25, 0.45));
  const ry = round2(rng.range(4.2, 5.2));
  const raw = {
    id: o.id || 'gen-bubble', world: o.world || 0, name: o.name || 'Up We Go',
    theme: o.theme || 'fizz', mechanics: ['cut', 'bubble', 'stars'],
    seed: o.seed || 'gen',
    layout: {
      treat: { x: bx, y: round2(rng.range(1.8, 2.6)) },
      ropes: [{ id: 'rope-0', x: bx, y: 6.5 }],
      bubbles: [{ id: 'bubble-0', x: bx, y: -2 }],
      stars: [],
      recipient: { x: rx, y: ry },
    },
    solution: [
      { tick: 2, do: { type: 'cut', id: 'rope-0' } },
      // Pop just below the capture circle; leftover buoyant velocity carries
      // the treat the last fraction of a unit into the recipient.
      { aboveY: round2(ry - 1.05), do: { type: 'pop', id: 'bubble-0' } },
    ],
  };
  raw.layout.stars = starsOnTrajectory(buildLevel(raw), 3);
  return raw;
}

/** Fan push: a crosswind carries the falling treat to an offset recipient. */
function genFanPush(rng, o = {}) {
  const dir = rng.int(0, 1) === 0 ? 1 : -1;
  const tx = round2(rng.range(-2, 2) - dir * 2.5);
  const rx = round2(tx + dir * rng.range(3.5, 5));
  return {
    id: o.id || 'gen-fan', world: o.world || 0, name: o.name || 'Crosswind',
    theme: o.theme || 'gust', mechanics: ['cut', 'fan', 'stars'],
    seed: o.seed || 'gen',
    layout: {
      treat: { x: tx, y: 4.5 },
      ropes: [{ id: 'rope-0', x: tx, y: 6.8 }],
      fans: [{ id: 'fan-0', x: round2(tx + dir * 2.2), y: 1.2, w: 5.5, h: 4.5, dx: dir, dy: 0, strength: 62, on: false }],
      stars: [
        { x: tx, y: 2.2 },
        { x: round2(tx + dir * 2.4), y: 0.6 },
        { x: round2(rx - dir * 1.2), y: -2.4 },
      ],
      recipient: { x: rx, y: -5 },
    },
    solution: [
      { tick: 2, do: { type: 'fan', id: 'fan-0', on: true } },
      { tick: 6, do: { type: 'cut', id: 'rope-0' } },
      { belowY: -3.4, do: { type: 'fan', id: 'fan-0', on: false } },
    ],
  };
}

/** Bumper drop: free fall onto a bumper that deflects into the recipient. */
function genBumperDrop(rng, o = {}) {
  const dir = rng.int(0, 1) === 0 ? 1 : -1;
  const bx = round2(rng.range(-1.5, 1.5));
  const rx = round2(bx + dir * rng.range(3.2, 4.2));
  return {
    id: o.id || 'gen-bumper', world: o.world || 0, name: o.name || 'Boing Over',
    theme: o.theme || 'taffy', mechanics: ['cut', 'bumper', 'stars'],
    seed: o.seed || 'gen',
    layout: {
      treat: { x: bx, y: 5 },
      ropes: [{ id: 'rope-0', x: bx, y: 7 }],
      bumpers: [{ id: 'bumper-0', x: round2(bx - dir * 0.9), y: -0.5, r: 0.9 }],
      stars: [
        { x: bx, y: 2.6 },
        { x: round2(bx - dir * 0.4), y: 0.9 },
        { x: round2((bx + rx) / 2), y: -1.6 },
      ],
      recipient: { x: rx, y: -5 },
    },
    solution: [{ tick: 2, do: { type: 'cut', id: 'rope-0' } }],
  };
}

/** Slider serve: a moving anchor carries the treat; cut above the recipient. */
function genSliderServe(rng, o = {}) {
  const y = round2(rng.range(5.5, 6.5));
  const span = round2(rng.range(4, 5.5));
  const rx = round2(rng.range(-2, 2));
  const period = round2(rng.range(4, 5.5));
  return {
    id: o.id || 'gen-slider', world: o.world || 0, name: o.name || 'Conveyor',
    theme: o.theme || 'clockwork', mechanics: ['cut', 'slider', 'stars'],
    seed: o.seed || 'gen',
    layout: {
      treat: { x: round2(rx - span), y: round2(y - 2.4) },
      ropes: [{ id: 'rope-0', slider: 'slider-0' }],
      sliders: [{ id: 'slider-0', x0: round2(rx - span), y0: y, x1: round2(rx + span), y1: y, period, phase: 0 }],
      stars: [
        { x: round2(rx - span / 2), y: round2(y - 3.2) },
        { x: rx, y: round2(y - 3.2) },
        { x: rx, y: round2(y - 6) },
      ],
      recipient: { x: rx, y: -5 },
    },
    solution: [{ rightOf: round2(rx - 0.35), leftOf: round2(rx + 0.6), do: { type: 'cut', id: 'rope-0' } }],
  };
}

const ARCHETYPES = [
  { id: 'pendulum', gen: genPendulum, worlds: [1, 2, 3, 4, 5] },
  { id: 'bubble-rise', gen: genBubbleRise, worlds: [2, 3, 4, 5] },
  { id: 'fan-push', gen: genFanPush, worlds: [3, 4, 5] },
  { id: 'bumper-drop', gen: genBumperDrop, worlds: [4, 5] },
  { id: 'slider-serve', gen: genSliderServe, worlds: [5] },
];

const DIFFICULTY_WORLDS = { easy: [1, 2], medium: [3, 4], hard: [5] };

/**
 * Deterministic validated generation. Tries seeded candidates until one
 * passes runSolution with all stars; the attempt loop is bounded, so the
 * selected (seed, attempt) pair reproduces identically everywhere.
 */
export function generateValidated(seedBase, pick) {
  for (let attempt = 0; attempt < 32; attempt++) {
    const rng = makeRng(seedBase + '|try-' + attempt);
    const pool = ARCHETYPES.filter((a) => a.worlds.some((w) => pick.worlds.includes(w)));
    const arch = pool[rng.next() % pool.length];
    const level = buildLevel(arch.gen(rng, { seed: seedBase + '-' + attempt }));
    level.blurb = 'Generated stage · ' + arch.id;
    const res = runSolution(level);
    if (res.ok && res.stars === level.layout.stars.length) {
      level.validated = { attempt, ticks: res.ticks, hash: hashHex(level.id + seedBase) };
      level.par = { actions: level.solution.length, seconds: Math.ceil(res.ticks / TICK_RATE) + 3 };
      return level;
    }
  }
  return null;
}

/** One shared seed and ruleset per UTC day. Immutable once published. */
export function dailySeedFor(dateKey) {
  return 'daily|' + dateKey;
}

export function generateDailyLevel(dateKey) {
  const level = generateValidated(dailySeedFor(dateKey), { worlds: [1, 2, 3, 4, 5] });
  if (!level) return null; // caller marks the day excluded from ranking
  level.id = 'daily-' + dateKey;
  level.name = 'Daily Drop · ' + dateKey;
  level.theme = THEME_ORDER[hashHex(dateKey).charCodeAt(0) % THEME_ORDER.length];
  level.ranked = true;
  level.modifiers = { noUndo: true };
  return level;
}

export function generatePracticeLevel(difficulty, sessionSeed) {
  const worlds = DIFFICULTY_WORLDS[difficulty] || DIFFICULTY_WORLDS.easy;
  const level = generateValidated('practice|' + difficulty + '|' + sessionSeed, { worlds });
  if (!level) return null;
  level.id = 'practice-' + difficulty + '-' + hashHex(String(sessionSeed)).slice(0, 6);
  level.name = 'Practice · ' + difficulty[0].toUpperCase() + difficulty.slice(1);
  level.theme = THEME_ORDER[worlds[0] - 1];
  return level;
}

// ---------------------------------------------------------------------------
// Achievements (static set; stable lowercase keys; idempotent unlocks)
// ---------------------------------------------------------------------------
export const ACHIEVEMENTS = [
  { key: 'first-delivery', name: 'First Delivery', desc: 'Deliver your very first treat.' },
  { key: 'sweet-swing', name: 'Sweet Swing', desc: 'Complete every Gumdrop Garage stage.' },
  { key: 'mechanic-mastery', name: 'Mechanic Mastery', desc: 'Complete all five world mastery stages.' },
  { key: 'daily-regular', name: 'Daily Regular', desc: 'Play the Daily Drop on 7 different days.' },
  { key: 'master-confectioner', name: 'Master Confectioner', desc: 'Complete the Clockwork Confection world.' },
  { key: 'star-collector', name: 'Star Collector', desc: 'Bank 150 stars across your Journey.' },
];

/**
 * Evaluate progress -> newly unlocked achievement keys.
 * `progress` is the persisted progression document; pure function.
 */
export function checkAchievements(progress, journeyLevels) {
  const owned = new Set(progress.achievements || []);
  const fresh = [];
  const grant = (key) => { if (!owned.has(key)) { owned.add(key); fresh.push(key); } };
  const done = (id) => !!(progress.levels && progress.levels[id] && progress.levels[id].completed);
  const worldDone = (w) => journeyLevels.filter((l) => l.world === w).every((l) => done(l.id));
  if (journeyLevels.some((l) => done(l.id))) grant('first-delivery');
  if (worldDone(1)) grant('sweet-swing');
  if (journeyLevels.filter((l) => l.mastery).length > 0 &&
      journeyLevels.filter((l) => l.mastery).every((l) => done(l.id))) grant('mechanic-mastery');
  if ((progress.dailyDays || []).length >= 7) grant('daily-regular');
  if (worldDone(5)) grant('master-confectioner');
  const totalStars = Object.values(progress.levels || {}).reduce((n, l) => n + (l.stars || 0), 0);
  if (totalStars >= 150) grant('star-collector');
  return fresh;
}

// ---------------------------------------------------------------------------
// Cosmetics (never affect hitboxes, timing, information or power)
// ---------------------------------------------------------------------------
export const COSMETICS = {
  treat: [
    { id: 'swirl', name: 'Berry Swirl', stars: 0 },
    { id: 'sprinkle', name: 'Sprinkle Pop', stars: 20 },
    { id: 'choco', name: 'Choco Comet', stars: 45 },
    { id: 'minty', name: 'Minty Moon', stars: 75 },
    { id: 'astro', name: 'Astro Glaze', stars: 110 },
  ],
  trail: [
    { id: 'none', name: 'No Trail', stars: 0 },
    { id: 'sparkle', name: 'Sparkle Trail', stars: 30 },
    { id: 'bubbles', name: 'Bubble Trail', stars: 60 },
    { id: 'rainbow', name: 'Ribbon Trail', stars: 100 },
  ],
  room: [
    { id: 'workshop', name: 'Workshop Trim', stars: 0 },
    { id: 'garden', name: 'Garden Trim', stars: 50 },
    { id: 'clocktower', name: 'Clocktower Trim', stars: 90 },
  ],
};

export function unlockedCosmetics(totalStars) {
  const out = {};
  for (const slot of Object.keys(COSMETICS)) {
    out[slot] = COSMETICS[slot].filter((c) => totalStars >= c.stars).map((c) => c.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Anonymous funnel event vocabulary (nothing else may be emitted)
// ---------------------------------------------------------------------------
export const FUNNEL_EVENTS = ['start', 'tutorial-step', 'round-end', 'retry', 'settings-change', 'error'];
