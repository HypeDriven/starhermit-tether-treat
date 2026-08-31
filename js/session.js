// session.js — round lifecycle around the deterministic rules engine.
//
// DOM-free by design: the session owns the rules state, the undo stack
// (serialize() snapshots), command-id sequencing (double-fire proof via
// applyCommand idempotency), the hash trail for replay envelopes, tutorial
// step progression, and fast-forward settling. main.js drives the fixed
// 120 Hz accumulator loop and calls stepOnce() per tick.

import {
  createGame, applyCommand, step, serialize, deserialize,
  listLegalActions, scoreOf, buildEnvelope, hashState, isTerminal, STATUS,
} from './rules.js';
import { hintFor } from './content.js';
import { makeRng } from './rng.js';

const HASH_EVERY = 120; // record a state hash once per simulated second

export class Session {
  /**
   * @param level  versioned level record (from levels.js or generators)
   * @param opts   {mode, ranked, roundId}
   */
  constructor(level, opts = {}) {
    this.level = level;
    this.mode = opts.mode || 'journey';
    this.ranked = !!opts.ranked;
    this.roundId = opts.roundId || (level.id + '-' + Date.now().toString(36));
    this.startedAt = new Date().toISOString();
    this.state = createGame(level, { modifiers: level.modifiers });
    this.state.hashTrail = [];
    this.undoStack = [];
    this.commandSeq = 0;
    this.tutorialIndex = 0;      // active tutorial step, when level.tutorial
    this.waitEventSeen = false;
    // Cosmetic-only decoration stream — never touches rules.
    this.decorRng = makeRng(String(level.seed) + '|decor').fork('fx');
  }

  /** Current tutorial step record, or null outside Learn mode. */
  tutorialStep() {
    const t = this.level.tutorial;
    if (!t || this.tutorialIndex >= t.length) return null;
    return t[this.tutorialIndex];
  }

  /** Advance the tutorial when its step condition is satisfied. */
  advanceTutorial(events) {
    const st = this.tutorialStep();
    if (!st) return;
    if (st.waitEvent && events.some((e) => e.type === st.waitEvent)) {
      this.waitEventSeen = true;
    }
    if (st.until === 'terminal' && events.some((e) => e.type === 'terminal')) {
      this.tutorialIndex++;
      return;
    }
    if (st.waitEvent && !this.waitEventSeen) return;
    if (st.require) {
      // Advances only when the required action was performed.
      const done = this.state.log.some((l) => l.type === st.require.type && l.target === st.require.id);
      if (!done) return;
      this.waitEventSeen = false;
      this.tutorialIndex++;
      return;
    }
    if (!st.require && !st.waitEvent && st.until !== 'terminal') {
      this.tutorialIndex++;
    }
  }

  /**
   * Actions the player may legally take right now, narrowed by the active
   * tutorial `require` gate when in Learn mode.
   */
  legalActions() {
    const legal = listLegalActions(this.state);
    const st = this.tutorialStep();
    if (st && st.require) {
      return legal.filter((a) => a.type === st.require.type && a.id === st.require.id);
    }
    return legal;
  }

  /** True when a tutorial gate is blocking `action` ("not yet" case). */
  gatedByTutorial(action) {
    const st = this.tutorialStep();
    return !!(st && st.require &&
      !(st.require.type === action.type && st.require.id === action.id));
  }

  /**
   * Issue one gameplay command. Monotonic ids `${roundId}:${n}` make
   * double-fired gestures harmless (applyCommand acknowledges duplicates).
   * Returns the applyCommand result.
   */
  dispatch(type, target, on) {
    if (this.gatedByTutorial({ type, id: target })) {
      return { ok: false, reason: 'not-yet', events: [] };
    }
    if (!this.state.noUndo) {
      this.undoStack.push(serialize(this.state));
      if (this.undoStack.length > 64) this.undoStack.shift();
    }
    const id = this.roundId + ':' + (++this.commandSeq);
    const res = applyCommand(this.state, { id, type, target, on });
    if (!res.ok && !this.state.noUndo) this.undoStack.pop();
    return res;
  }

  canUndo() { return !this.state.noUndo && this.undoStack.length > 0 && this.state.status === STATUS.ACTIVE; }

  undo() {
    if (!this.canUndo()) return false;
    this.state = deserialize(this.undoStack.pop());
    return true;
  }

  hint() {
    if (this.state.status !== STATUS.ACTIVE) return null;
    return hintFor(this.state, this.level);
  }

  /** Advance exactly one tick; returns the tick's events. */
  stepOnce() {
    const events = step(this.state);
    if (this.state.tick % HASH_EVERY === 0) {
      this.state.hashTrail.push({ tick: this.state.tick, hash: hashState(this.state) });
    }
    if (events.length) this.advanceTutorial(events);
    return events;
  }

  /** Settle instantly to the deterministic terminal state (skip button). */
  settle() {
    const limit = this.state.maxTicks + 2;
    while (!isTerminal(this.state) && this.state.tick <= limit) this.stepOnce();
  }

  score() { return scoreOf(this.state); }

  /** Replay envelope for ranked submission (call after terminal). */
  envelope(buildId) {
    return buildEnvelope(this.state, { build: buildId, startedAt: this.startedAt });
  }
}
