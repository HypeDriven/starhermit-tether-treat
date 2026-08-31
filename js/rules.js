// rules.js — pure deterministic rules engine for Tether Treat.
//
// This module owns ALL rules state transitions. Rendering, UI, network and
// tutorial code never mutate rules state directly; they issue validated
// commands through applyCommand() and read immutable snapshots. The engine
// exposes legal-action queries, deterministic resolution, serializable state,
// a monotonically increasing tick number, and an explicit terminal reason.

import {
  TICK_RATE, SUB, VEL, TREAT_R, STAR_R, w2s, stepPhysics,
} from './physics.js';
import { hashHex, makeRng } from './rng.js';

export const RULES_VERSION = 1;
export const STATE_SCHEMA = 1;
export const MAX_SECONDS_DEFAULT = 90;

export const STATUS = { ACTIVE: 'active', WON: 'won', LOST: 'lost' };
export const REASON = {
  DELIVERED: 'delivered',
  HAZARD: 'hazard',
  OUT: 'out-of-bounds',
  STALLED: 'stalled',
  TIME_UP: 'time-up',
  MISSING_STARS: 'missing-stars',
};

const DEFAULT_BOUNDS = { minX: -14, maxX: 14, minY: -9, maxY: 26 };

/**
 * Build the initial rules state for a level record.
 * `level` is versioned content data in world units (see content.js).
 * `opts.modifiers` may add/override challenge modifiers.
 * `opts.mirrorX` mirrors the layout horizontally (challenge variant).
 */
export function createGame(level, opts = {}) {
  const modifiers = Object.assign({}, level.modifiers || {}, opts.modifiers || {});
  const mirrorX = !!(opts.mirrorX || modifiers.mirrorX);
  const mx = (v) => (mirrorX ? -v : v);
  const L = level.layout;

  const sliders = (L.sliders || []).map((s, i) => ({
    id: s.id || ('slider-' + i),
    x0: w2s(mx(s.x0)), y0: w2s(s.y0),
    x1: w2s(mx(s.x1)), y1: w2s(s.y1),
    period: Math.max(2, Math.round(s.period * TICK_RATE)),
    phase: Math.round((s.phase || 0) * TICK_RATE),
    x: 0, y: 0,
  }));

  const ropes = (L.ropes || []).map((r, i) => {
    let ax = 0; let ay = 0; let slider = -1;
    if (r.slider) {
      slider = sliders.findIndex((s) => s.id === r.slider);
      if (slider < 0) throw new Error('rope references unknown slider: ' + r.slider);
    } else {
      ax = w2s(mx(r.x)); ay = w2s(r.y);
    }
    const tx = w2s(mx(L.treat.x)); const ty = w2s(L.treat.y);
    const hx = slider >= 0 ? sliders[slider].x0 : ax;
    const hy = slider >= 0 ? sliders[slider].y0 : ay;
    const dist = Math.hypot(tx - hx, ty - hy);
    const len = r.len !== undefined
      ? w2s(r.len)
      : Math.round(dist * (1 + (r.slack || 0)));
    return {
      id: r.id || ('rope-' + i), ax, ay, slider, len, cut: false, wx: hx, wy: hy,
    };
  });

  const fans = (L.fans || []).map((f, i) => {
    const cx = mx(f.x); const dx = mirrorX ? -f.dx : f.dx;
    const n = Math.hypot(dx, f.dy) || 1;
    const strength = f.strength !== undefined ? f.strength : 70;
    return {
      id: f.id || ('fan-' + i),
      x0: w2s(cx - f.w / 2), x1: w2s(cx + f.w / 2),
      y0: w2s(f.y - f.h / 2), y1: w2s(f.y + f.h / 2),
      sx: Math.round((dx / n) * strength), sy: Math.round((f.dy / n) * strength),
      on: !!f.on, cx: w2s(cx), cy: w2s(f.y), w: w2s(f.w), h: w2s(f.h),
      ndx: Math.round((dx / n) * 1024), ndy: Math.round((f.dy / n) * 1024),
    };
  });

  const bounds = Object.assign({}, DEFAULT_BOUNDS, L.bounds || {});
  const state = {
    schema: STATE_SCHEMA,
    rulesVersion: RULES_VERSION,
    levelId: level.id,
    levelVersion: level.version,
    seed: String(level.seed),
    themeId: level.theme,
    mechanics: (level.mechanics || []).slice(),
    modifiers,
    tick: 0,
    status: STATUS.ACTIVE,
    reason: null,
    actionsUsed: 0,
    invalidActions: 0,
    treat: { x: w2s(mx(L.treat.x)), y: w2s(L.treat.y), vx: 0, vy: 0 },
    ropes, sliders, fans,
    bubbles: (L.bubbles || []).map((b, i) => ({
      id: b.id || ('bubble-' + i), x: w2s(mx(b.x)), y: w2s(b.y),
      r: w2s(b.r !== undefined ? b.r : 0.8), state: 0,
    })),
    bumpers: (L.bumpers || []).map((b, i) => ({
      id: b.id || ('bumper-' + i), x: w2s(mx(b.x)), y: w2s(b.y),
      r: w2s(b.r !== undefined ? b.r : 0.8),
    })),
    spikes: (L.spikes || []).map((s, i) => ({
      id: s.id || ('spike-' + i), x: w2s(mx(s.x)), y: w2s(s.y),
      r: w2s(s.r !== undefined ? s.r : 0.7),
    })),
    stars: (L.stars || []).map((s, i) => ({
      id: s.id || ('star-' + i), x: w2s(mx(s.x)), y: w2s(s.y), got: false,
    })),
    recipient: {
      x: w2s(mx(L.recipient.x)), y: w2s(L.recipient.y),
      r: w2s(L.recipient.r !== undefined ? L.recipient.r : 1.05),
    },
    bounds: { minX: w2s(bounds.minX), maxX: w2s(bounds.maxX), minY: w2s(bounds.minY), maxY: w2s(bounds.maxY) },
    parActions: level.par ? level.par.actions : 0,
    parTicks: level.par ? Math.round(level.par.seconds * TICK_RATE) : 0,
    timeLimitTicks: modifiers.timeLimit ? Math.round(modifiers.timeLimit * TICK_RATE) : 0,
    moveLimit: modifiers.moveLimit || 0,
    requireStars: modifiers.requireStars || 0,
    disabledActions: (modifiers.disableActions || []).slice(),
    noUndo: !!modifiers.noUndo,
    maxTicks: Math.round((level.maxSeconds || MAX_SECONDS_DEFAULT) * TICK_RATE),
    still: 0,
    outcome: null,
    events: [],
    log: [],
    commandIds: [],
    rngS: makeRng(String(level.seed) + '|rules').getState(),
  };
  // Warm the kinematic anchors so tick-0 queries see real positions.
  state.events = [];
  for (const s of state.sliders) {
    const p = { x: s.x0, y: s.y0 };
    s.x = p.x; s.y = p.y;
  }
  for (const r of state.ropes) {
    if (r.slider >= 0) { r.wx = state.sliders[r.slider].x; r.wy = state.sliders[r.slider].y; }
  }
  return state;
}

/** Restore a rules RNG stream position (reserved for rules-side randomness). */
export function rulesRng(state) {
  const r = makeRng(1);
  r.setState(state.rngS);
  return r;
}

/**
 * Every legal gameplay action in the current state. Tutorials, hints and the
 * input layer all call this — nothing duplicates rules knowledge elsewhere.
 * Returns [{type:'cut'|'pop'|'fan', id, on?}].
 */
export function listLegalActions(state) {
  if (state.status !== STATUS.ACTIVE) return [];
  if (state.moveLimit && state.actionsUsed >= state.moveLimit) return [];
  const out = [];
  const disabled = state.disabledActions;
  for (const r of state.ropes) {
    if (!r.cut) out.push({ type: 'cut', id: r.id });
  }
  if (!disabled.includes('pop')) {
    for (const b of state.bubbles) {
      if (b.state === 1) out.push({ type: 'pop', id: b.id });
    }
  }
  if (!disabled.includes('fan')) {
    for (const f of state.fans) {
      out.push({ type: 'fan', id: f.id, on: !f.on });
    }
  }
  return out;
}

function illegal(state, reason) {
  state.invalidActions++;
  return { ok: false, reason, events: [] };
}

/**
 * Validate and apply one gameplay command. Commands are idempotent by
 * command id: re-applying a logged id is acknowledged without effects.
 * Returns {ok, reason?, duplicate?, events}.
 */
export function applyCommand(state, cmd) {
  if (!cmd || typeof cmd !== 'object' || typeof cmd.id !== 'string' || !cmd.id ||
      typeof cmd.type !== 'string') {
    return { ok: false, reason: 'malformed', events: [] };
  }
  if (state.commandIds.includes(cmd.id)) {
    return { ok: true, duplicate: true, events: [] };
  }
  if (state.status !== STATUS.ACTIVE) return illegal(state, 'not-active');
  if (state.moveLimit && state.actionsUsed >= state.moveLimit) {
    return illegal(state, 'move-limit');
  }

  const target = cmd.target;
  switch (cmd.type) {
    case 'cut': {
      if (state.disabledActions.includes('cut')) return illegal(state, 'disabled-action');
      const rope = state.ropes.find((r) => r.id === target);
      if (!rope) return illegal(state, 'no-such-rope');
      if (rope.cut) return illegal(state, 'already-cut');
      rope.cut = true;
      state.events.push({ type: 'cut', id: rope.id });
      break;
    }
    case 'pop': {
      if (state.disabledActions.includes('pop')) return illegal(state, 'disabled-action');
      const bubble = state.bubbles.find((b) => b.id === target);
      if (!bubble) return illegal(state, 'no-such-bubble');
      if (bubble.state === 2) return illegal(state, 'already-popped');
      if (bubble.state !== 1) return illegal(state, 'not-attached');
      bubble.state = 2;
      state.events.push({ type: 'bubble-pop', id: bubble.id, x: bubble.x, y: bubble.y });
      break;
    }
    case 'fan': {
      if (state.disabledActions.includes('fan')) return illegal(state, 'disabled-action');
      const fan = state.fans.find((f) => f.id === target);
      if (!fan) return illegal(state, 'no-such-fan');
      const on = cmd.on === undefined ? !fan.on : !!cmd.on;
      if (fan.on === on) return illegal(state, on ? 'already-on' : 'already-off');
      fan.on = on;
      state.events.push({ type: 'fan', id: fan.id, on });
      break;
    }
    default:
      return { ok: false, reason: 'unknown-command', events: [] };
  }

  state.actionsUsed++;
  state.commandIds.push(cmd.id);
  state.log.push({ id: cmd.id, tick: state.tick, type: cmd.type, target, on: cmd.on });
  return { ok: true, events: state.events.slice() };
}

/** Advance one fixed tick. Returns the events produced this tick. */
export function step(state) {
  state.events.length = 0;
  if (state.status !== STATUS.ACTIVE) return state.events;
  stepPhysics(state);
  if (!state.outcome && state.timeLimitTicks && state.tick + 1 >= state.timeLimitTicks) {
    state.outcome = { status: STATUS.LOST, reason: REASON.TIME_UP };
    state.events.push({ type: 'time-up' });
  }
  if (!state.outcome && state.tick + 1 >= state.maxTicks) {
    state.outcome = { status: STATUS.LOST, reason: REASON.TIME_UP };
    state.events.push({ type: 'time-up' });
  }
  state.tick++;
  if (state.outcome) {
    let { status, reason } = state.outcome;
    if (status === STATUS.WON && state.requireStars > 0) {
      const got = state.stars.filter((s) => s.got).length;
      if (got < state.requireStars) {
        status = STATUS.LOST; reason = REASON.MISSING_STARS;
      }
    }
    state.status = status;
    state.reason = reason;
    state.events.push({ type: 'terminal', status, reason });
  }
  return state.events;
}

export const isTerminal = (state) => state.status !== STATUS.ACTIVE;

export function starsCollected(state) {
  return state.stars.reduce((n, s) => n + (s.got ? 1 : 0), 0);
}

/**
 * Score with a full component breakdown. Integers only; formatting is a
 * presentation concern.
 */
export function scoreOf(state) {
  const got = starsCollected(state);
  const components = [{ key: 'stars', count: got, amount: got * 100 }];
  if (state.status === STATUS.WON) {
    components.push({ key: 'delivery', amount: 500 });
    if (state.parActions > 0 && state.actionsUsed < state.parActions) {
      components.push({ key: 'actions', count: state.parActions - state.actionsUsed, amount: (state.parActions - state.actionsUsed) * 50 });
    }
    if (state.timeLimitTicks > 0) {
      const spare = Math.max(0, Math.floor((state.timeLimitTicks - state.tick) / TICK_RATE));
      if (spare > 0) components.push({ key: 'time', count: spare, amount: spare * 10 });
    }
  }
  const total = components.reduce((n, c) => n + c.amount, 0);
  return {
    total,
    components,
    stars: got,
    delivered: state.status === STATUS.WON,
    ticks: state.tick,
    actionsUsed: state.actionsUsed,
    invalidActions: state.invalidActions,
  };
}

/**
 * Authoritative ranking order. Ties break by: primary objective completion,
 * fewer invalid actions, lower elapsed ticks, then stable session id.
 * Returns negative when `a` ranks above `b`.
 */
export function rankCompare(a, b) {
  if (a.total !== b.total) return b.total - a.total;
  if (!!a.delivered !== !!b.delivered) return a.delivered ? -1 : 1;
  if (a.invalidActions !== b.invalidActions) return a.invalidActions - b.invalidActions;
  if (a.ticks !== b.ticks) return a.ticks - b.ticks;
  return String(a.sessionId).localeCompare(String(b.sessionId));
}

/** Serializable snapshot: the state is already plain JSON-safe data. */
export function serialize(state) {
  return JSON.stringify(state);
}

export function deserialize(json) {
  const state = typeof json === 'string' ? JSON.parse(json) : json;
  return migrateState(state);
}

/** Schema migrations. v1 is current; future migrations chain from here. */
export function migrateState(state) {
  if (!state || typeof state !== 'object') throw new Error('bad snapshot');
  if (state.schema === STATE_SCHEMA) return state;
  if (state.schema > STATE_SCHEMA) throw new Error('snapshot from a newer build');
  // No older schemas exist yet; fail loudly rather than guessing.
  throw new Error('unsupported snapshot schema: ' + state.schema);
}

/** Stable hash of everything that can influence future simulation. */
export function hashState(state) {
  const parts = [
    state.tick, state.status, state.reason || '-',
    state.treat.x, state.treat.y, state.treat.vx, state.treat.vy,
    state.actionsUsed, state.invalidActions, state.still,
    state.ropes.map((r) => (r.cut ? 1 : 0)).join(''),
    state.sliders.map((s) => s.x + ',' + s.y).join(';'),
    state.bubbles.map((b) => b.state + ':' + b.x + ',' + b.y).join(';'),
    state.fans.map((f) => (f.on ? 1 : 0)).join(''),
    state.stars.map((s) => (s.got ? 1 : 0)).join(''),
  ];
  return hashHex(parts.join('|'));
}

/**
 * Deterministic replay. Feed a level and an ordered command log; verifies
 * that periodic hashes and the terminal result match the envelope.
 * Returns {ok, error?, finalHash, result}.
 */
export function verifyReplay(level, envelope) {
  if (!envelope || envelope.schema !== 1) return { ok: false, error: 'bad-envelope' };
  if (envelope.levelId !== level.id || envelope.levelVersion !== level.version) {
    return { ok: false, error: 'version-mismatch' };
  }
  const state = createGame(level, { modifiers: envelope.modifiers, mirrorX: !!(envelope.modifiers && envelope.modifiers.mirrorX) });
  const commands = (envelope.commands || []).slice().sort((a, b) => a.tick - b.tick);
  const hashes = envelope.hashes || [];
  let ci = 0;
  let hi = 0;
  const tickLimit = state.maxTicks + 2;
  while (state.status === STATUS.ACTIVE && state.tick <= tickLimit) {
    while (ci < commands.length && commands[ci].tick === state.tick) {
      const c = commands[ci++];
      const res = applyCommand(state, c);
      if (!res.ok) return { ok: false, error: 'illegal-command:' + res.reason };
    }
    step(state);
    if (hi < hashes.length && state.tick === hashes[hi].tick) {
      if (hashState(state) !== hashes[hi].hash) {
        return { ok: false, error: 'hash-mismatch@' + state.tick };
      }
      hi++;
    }
    if (ci < commands.length && commands[ci].tick < state.tick) {
      return { ok: false, error: 'stale-command' };
    }
  }
  if (ci !== commands.length) return { ok: false, error: 'unplayed-commands' };
  const result = scoreOf(state);
  const expected = envelope.result;
  if (expected && (expected.total !== result.total || expected.reason !== state.reason)) {
    return { ok: false, error: 'result-mismatch' };
  }
  return { ok: true, finalHash: hashState(state), result, reason: state.reason };
}

/** Build the replay envelope recorded for a finished session. */
export function buildEnvelope(state, meta) {
  const hashes = [];
  for (const h of state.hashTrail || []) hashes.push(h);
  return {
    schema: 1,
    build: meta.build,
    rulesVersion: RULES_VERSION,
    levelId: state.levelId,
    levelVersion: state.levelVersion,
    seed: state.seed,
    modifiers: state.modifiers,
    startedAt: meta.startedAt,
    commands: state.log.map((e) => ({ id: e.id, tick: e.tick, type: e.type, target: e.target, on: e.on })),
    hashes,
    result: Object.assign({ reason: state.reason }, scoreOf(state)),
  };
}

/** Convenience: world-space treat position (presentation only). */
export function treatWorld(state) {
  return { x: state.treat.x / SUB, y: state.treat.y / SUB };
}

/** Treat speed in world units/second (presentation / solution triggers). */
export function treatSpeedSq(state) {
  return state.treat.vx * state.treat.vx + state.treat.vy * state.treat.vy;
}

export { TICK_RATE, SUB, VEL, TREAT_R, STAR_R };
