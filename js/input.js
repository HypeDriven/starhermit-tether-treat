// input.js — pointer, keyboard and gamepad input, all routed through the
// session's command dispatch (never touching rules state directly).
//
// Pointer: taps raycast the interaction layer (ropes/bubbles/fans); swipes
// cut any rope whose segment they cross. Tap vs drag uses 12 px / 400 ms
// thresholds. Keyboard: arrows cycle legal targets (mirrored in the DOM
// action list), Enter/Space confirm, Esc pause, U undo, H hint, R restart,
// C camera reset. Gamepad: d-pad/stick navigate, A confirm, B cancel,
// Y hint, Start pause.

import { s2w } from './physics.js';

const TAP_MAX_DIST = 12;   // px
const TAP_MAX_TIME = 400;  // ms

export class Input {
  /**
   * @param canvas the WebGL canvas (pointer events + capture)
   * @param ctx    {renderer, getSession, ui, audio, isActive, onAction, onPause, onUndo, onHint, onRestart, onCameraReset}
   */
  constructor(canvas, ctx) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.focusIndex = 0;
    this.padState = {};
    this._bindPointer();
    this._bindKeyboard();
    this._padLoop = this._padLoop.bind(this);
    this._padRaf = requestAnimationFrame(this._padLoop);
  }

  get session() { return this.ctx.getSession(); }

  // -------------------------------------------------------------------------
  // Pointer
  // -------------------------------------------------------------------------
  _bindPointer() {
    const cv = this.canvas;
    let down = null; // {x, y, t, id}

    cv.addEventListener('pointerdown', (e) => {
      if (!this.ctx.isActive()) return;
      down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* not critical */ }
    });

    cv.addEventListener('pointermove', (e) => {
      if (!this.ctx.isActive()) return;
      if (down && e.pointerId === down.id) {
        const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
        if (dist > TAP_MAX_DIST) {
          // Treat as a swipe: check rope crossings continuously.
          const a = this._toWorld(down.x, down.y);
          const b = this._toWorld(e.clientX, e.clientY);
          if (a && b) this._trySwipe(a, b, e);
          down = { x: e.clientX, y: e.clientY, t: down.t, id: down.id };
        }
      } else {
        // Hover preview highlight on legal targets.
        const hit = this._pick(e);
        const legal = hit && this._isLegal(hit.kind, hit.id);
        this.ctx.renderer.setHighlight(
          legal ? hit.kind : null, legal ? hit.id : null, 'focus');
      }
    });

    cv.addEventListener('pointerup', (e) => {
      if (!this.ctx.isActive()) { down = null; return; }
      if (!down || e.pointerId !== down.id) return;
      const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const dt = performance.now() - down.t;
      if (dist <= TAP_MAX_DIST && dt <= TAP_MAX_TIME) this._tap(e);
      down = null;
    });

    cv.addEventListener('pointercancel', () => { down = null; });
  }

  _ndc(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * 2 - 1,
      y: -(((e.clientY - r.top) / r.height) * 2 - 1),
      rect: r,
    };
  }

  _toWorld(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1;
    const ny = -(((clientY - r.top) / r.height) * 2 - 1);
    // Unproject onto the z=0 play plane.
    const cam = this.ctx.renderer.camera;
    if (!cam) return null;
    const v = { x: nx, y: ny };
    // Manual unproject via camera matrices (avoid importing Vector3 here).
    const THREE_cam = cam;
    const origin = THREE_cam.position;
    const dir = ndcRay(THREE_cam, v.x, v.y);
    const t = -origin.z / dir.z;
    if (!Number.isFinite(t) || t < 0) return null;
    return { x: origin.x + dir.x * t, y: origin.y + dir.y * t };
  }

  _pick(e) {
    const n = this._ndc(e);
    return this.ctx.renderer.pick(n.x, n.y);
  }

  _isLegal(kind, id) {
    const s = this.session;
    if (!s) return false;
    const type = kind === 'rope' ? 'cut' : kind;
    return s.legalActions().some((a) => a.type === type && a.id === id);
  }

  _tap(e) {
    const s = this.session;
    if (!s) return;
    const hit = this._pick(e);
    if (!hit) return;
    const type = hit.kind === 'rope' ? 'cut' : hit.kind;
    const legal = s.legalActions().find((a) => a.type === type && a.id === hit.id);
    if (legal) {
      this.ctx.onAction(legal.type, legal.id, legal.on);
      return;
    }
    // Explain why nothing happened.
    if (s.gatedByTutorial({ type, id: hit.id })) {
      this.ctx.ui.showTooltip('Not yet — follow the lesson step.', e.clientX, e.clientY - 30);
      this.ctx.audio.errorBuzz();
      return;
    }
    const reason = this._invalidReason(type, hit.id);
    if (reason) {
      this.ctx.ui.showTooltip(reason, e.clientX, e.clientY - 30);
      this.ctx.audio.errorBuzz();
      this.shake();
    }
  }

  _invalidReason(type, id) {
    const st = this.session.state;
    if (st.disabledActions.includes(type)) return 'That action is disabled in this challenge.';
    if (type === 'cut') {
      const r = st.ropes.find((x) => x.id === id);
      if (r && r.cut) return 'Already cut.';
    }
    if (type === 'pop') {
      const b = st.bubbles.find((x) => x.id === id);
      if (b && b.state === 2) return 'Already popped.';
      if (b && b.state === 0) return 'Nothing to pop yet.';
    }
    if (st.moveLimit && st.actionsUsed >= st.moveLimit) return 'No moves left.';
    return null;
  }

  _trySwipe(a, b, e) {
    const s = this.session;
    if (!s) return;
    const id = this.ctx.renderer.swipeCutsRope(s.state, a.x, a.y, b.x, b.y);
    if (!id) return;
    const legal = s.legalActions().find((x) => x.type === 'cut' && x.id === id);
    if (legal) this.ctx.onAction('cut', id);
    else if (s.gatedByTutorial({ type: 'cut', id })) {
      this.ctx.ui.showTooltip('Not yet — follow the lesson step.', e.clientX, e.clientY - 30);
    }
  }

  /** Small canvas shake for invalid taps. */
  shake() {
    this.canvas.classList.remove('tt-shake');
    void this.canvas.offsetWidth;
    this.canvas.classList.add('tt-shake');
  }

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------
  _bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      // A focused button/link owns Enter and Space: activating the mirror
      // button the player actually chose must not be replaced by the
      // canvas focus target's action.
      const onControl = tag === 'BUTTON' || tag === 'A';
      const inRound = this.ctx.isActive();
      switch (e.key) {
        case 'ArrowLeft': case 'ArrowUp':
          if (inRound) { this.cycleFocus(-1); e.preventDefault(); }
          break;
        case 'ArrowRight': case 'ArrowDown':
          if (inRound) { this.cycleFocus(1); e.preventDefault(); }
          break;
        case 'Enter': case ' ':
          if (inRound && !onControl) { this.confirmFocus(); e.preventDefault(); }
          break;
        case 'Escape': this.ctx.onPause(); e.preventDefault(); break;
        case 'u': case 'U': if (inRound) this.ctx.onUndo(); break;
        case 'h': case 'H': if (inRound) this.ctx.onHint(); break;
        case 'r': case 'R': this.ctx.onRestart(); break;
        case 'c': case 'C': if (inRound) this.ctx.onCameraReset(); break;
        default: break;
      }
    });
  }

  cycleFocus(dir) {
    const s = this.session;
    if (!s) return;
    const actions = s.legalActions();
    if (!actions.length) return;
    this.focusIndex = ((this.focusIndex + dir) % actions.length + actions.length) % actions.length;
    this._applyFocus(actions);
  }

  _applyFocus(actions) {
    const a = actions[this.focusIndex];
    if (!a) return;
    const kind = a.type === 'cut' ? 'rope' : a.type;
    this.ctx.renderer.setHighlight(kind, a.id, 'focus');
    this.ctx.ui.updateMirror(actions, this.focusIndex);
    this.ctx.ui.announce('Focused: ' + (a.type === 'cut' ? 'rope ' + a.id : a.type + ' ' + a.id));
  }

  confirmFocus() {
    const s = this.session;
    if (!s) return;
    const actions = s.legalActions();
    const a = actions[this.focusIndex % Math.max(1, actions.length)];
    if (a) this.ctx.onAction(a.type, a.id, a.on);
  }

  /** Keep the focus index valid as legality changes. */
  refreshFocus() {
    const s = this.session;
    if (!s) return;
    const actions = s.legalActions();
    if (this.focusIndex >= actions.length) this.focusIndex = 0;
    this._applyFocus(actions);
  }

  // -------------------------------------------------------------------------
  // Gamepad
  // -------------------------------------------------------------------------
  _padLoop() {
    if (this.ctx.isActive()) {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const gp = pads && Array.from(pads).find(Boolean);
      if (gp) this._pollPad(gp);
    }
    this._padRaf = requestAnimationFrame(this._padLoop);
  }

  _pressed(gp, i) {
    const now = !!(gp.buttons[i] && gp.buttons[i].pressed);
    const was = !!this.padState[i];
    this.padState[i] = now;
    return now && !was;
  }

  _pollPad(gp) {
    // D-pad + left stick navigate targets.
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    const navL = this._pressed(gp, 14) || (ax < -0.6 && !this.padState.axL);
    const navR = this._pressed(gp, 15) || (ax > 0.6 && !this.padState.axR);
    const navU = this._pressed(gp, 12) || (ay < -0.6 && !this.padState.ayU);
    const navD = this._pressed(gp, 13) || (ay > 0.6 && !this.padState.ayD);
    this.padState.axL = ax < -0.6; this.padState.axR = ax > 0.6;
    this.padState.ayU = ay < -0.6; this.padState.ayD = ay > 0.6;
    if (navL || navU) this.cycleFocus(-1);
    if (navR || navD) this.cycleFocus(1);
    if (this._pressed(gp, 0)) this.confirmFocus();       // A
    if (this._pressed(gp, 1)) this.ctx.onPause();        // B
    if (this._pressed(gp, 3)) this.ctx.onHint();         // Y
    if (this._pressed(gp, 9)) this.ctx.onPause();        // Start
  }

  destroy() { cancelAnimationFrame(this._padRaf); }
}

/** Ray direction through NDC point (x, y) without importing three here. */
function ndcRay(camera, x, y) {
  // Invert the projection for a perspective camera looking down -z.
  const fov = camera.fov * Math.PI / 180;
  const tan = Math.tan(fov / 2);
  const dx = x * tan * camera.aspect;
  const dy = y * tan;
  const len = Math.hypot(dx, dy, 1);
  // Camera only translates (no rotation) in this game, so world dir == view dir.
  return { x: dx / len, y: dy / len, z: -1 / len };
}
