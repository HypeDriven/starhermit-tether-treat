// physics.js — deterministic fixed-point 2D physics for Tether Treat.
//
// Every simulation quantity is an integer. Positions use SUB sub-units per
// world unit, velocities use VEL units per world-unit/second, and the fixed
// timestep is 1/TICK_RATE seconds. Because SUB = VEL * TICK_RATE, the
// position integration is exactly `pos += vel` per tick with no rounding.
// All divisions truncate toward zero via Math.trunc and all square roots use
// an exact integer Newton method, so a given (state, command) sequence always
// produces the same successor state on every engine.

export const TICK_RATE = 120;
export const VEL = 1024;               // velocity units per (world unit / second)
export const SUB = VEL * TICK_RATE;    // 122880 position sub-units per world unit

export const GRAVITY = 84;             // vy -= 84 per tick  => 9.84375 u/s^2
export const DAMP_SHIFT = 8;           // air drag: v -= v >> 8 per tick
export const FAN_DAMP_SHIFT = 5;       // stronger drag inside fan streams
export const BUBBLE_RISE = 100;        // buoyant vy += 100 per tick (net +16)
export const BUBBLE_MAX_RISE = 1536;   // 1.5 u/s upward speed cap while bubbled
export const TREAT_R = SUB >> 1;       // treat radius: 0.5 u
export const TREAT_R_HALF = TREAT_R >> 1;
export const STAR_R = Math.round(SUB * 0.55);
export const STALL_VEL = 61;           // ~0.06 u/s: below this counts as "still"
export const STALL_TICKS = 90;         // still this long (with nothing to do) => stalled
export const ROPE_PASSES = 6;          // constraint relaxation iterations per tick
export const BUMPER_NUM = 7;           // restitution 7/4 factor applied to inward velocity
export const BUMPER_DEN = 4;

export const w2s = (w) => Math.round(w * SUB); // world units   -> sub-units
export const v2s = (v) => Math.round(v * VEL); // world u/s     -> velocity units
export const s2w = (s) => s / SUB;             // sub-units     -> world units
export const s2v = (s) => s / VEL;             // velocity units-> world u/s

/** Exact integer square root: floor(sqrt(n)), deterministic, bounded. */
export function isqrt(n) {
  if (n <= 0) return 0;
  // Float sqrt is correctly rounded on all modern engines; the integer
  // correction loop below makes the result exact regardless.
  let x = Math.floor(Math.sqrt(n)) + 2;
  while (x * x > n) x = (x + Math.floor(n / x)) >> 1;
  while ((x + 1) * (x + 1) <= n) x++;
  while (x * x > n) x--;
  return x;
}

/** Kinematic slider anchor position for a tick: linear ping-pong p0 <-> p1. */
export function sliderPosition(s, tick) {
  const p = ((tick + s.phase) % s.period + s.period) % s.period;
  // triangle wave: num goes 0 -> period -> 0 over one period
  const num = p * 2 <= s.period ? p * 2 : (s.period - p) * 2;
  return {
    x: s.x0 + Math.trunc((s.x1 - s.x0) * num / s.period),
    y: s.y0 + Math.trunc((s.y1 - s.y0) * num / s.period),
  };
}

/**
 * Advance the dynamic state by exactly one tick.
 * Mutates `state`; pushes event objects into `state.events`;
 * sets `state.outcome = {status, reason}` when a terminal condition is met.
 */
export function stepPhysics(state) {
  const ev = state.events;
  const T = state.treat;

  // 1. Kinematic sliders (deterministic in tick space).
  for (const s of state.sliders) {
    const p = sliderPosition(s, state.tick);
    s.x = p.x; s.y = p.y;
  }
  for (const r of state.ropes) {
    if (r.slider >= 0) {
      const s = state.sliders[r.slider];
      r.wx = s.x; r.wy = s.y;
    }
  }

  // 2. Forces -> velocity.
  T.vy -= GRAVITY;
  let bubbled = false;
  for (const b of state.bubbles) {
    if (b.state === 1) { bubbled = true; break; }
  }
  if (bubbled) {
    T.vy += BUBBLE_RISE;
    if (T.vy > BUBBLE_MAX_RISE) T.vy = BUBBLE_MAX_RISE;
  }
  let inFan = false;
  for (const f of state.fans) {
    if (!f.on) continue;
    if (T.x > f.x0 - TREAT_R && T.x < f.x1 + TREAT_R &&
        T.y > f.y0 - TREAT_R && T.y < f.y1 + TREAT_R) {
      T.vx += f.sx; T.vy += f.sy; inFan = true;
    }
  }
  const ds = inFan ? FAN_DAMP_SHIFT : DAMP_SHIFT;
  T.vx -= T.vx >> ds;
  T.vy -= T.vy >> ds;

  // 3. Integrate position (exact: pos += vel).
  T.x += T.vx;
  T.y += T.vy;

  // 4. Rope constraints (Gauss-Seidel, fixed order, max-distance only).
  for (let pass = 0; pass < ROPE_PASSES; pass++) {
    for (const r of state.ropes) {
      if (r.cut) continue;
      const dx = T.x - r.wx;
      const dy = T.y - r.wy;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r.len * r.len) continue; // slack: ropes never push
      const d = isqrt(d2) || 1;
      T.x = r.wx + Math.trunc(dx * r.len / d);
      T.y = r.wy + Math.trunc(dy * r.len / d);
      // Remove the outward radial velocity component (unit normal n*1024).
      const nx = Math.trunc((dx * 1024) / d);
      const ny = Math.trunc((dy * 1024) / d);
      const rv = Math.trunc((T.vx * nx + T.vy * ny) / 1024);
      if (rv > 0) {
        T.vx -= Math.trunc(rv * nx / 1024);
        T.vy -= Math.trunc(rv * ny / 1024);
      }
    }
  }

  // 5. Bumpers: static circles with 3/4 restitution.
  for (const b of state.bumpers) {
    const rr = b.r + TREAT_R;
    const dx = T.x - b.x;
    const dy = T.y - b.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) continue;
    let d = isqrt(d2);
    let nx, ny;
    if (d === 0) { d = 1; nx = 1024; ny = 0; }
    else { nx = Math.trunc((dx * 1024) / d); ny = Math.trunc((dy * 1024) / d); }
    T.x = b.x + Math.trunc(nx * rr / 1024);
    T.y = b.y + Math.trunc(ny * rr / 1024);
    const rv = Math.trunc((T.vx * nx + T.vy * ny) / 1024);
    if (rv < 0) {
      // v' = v - (1 + e) * (v . n) * n, with (1+e) = 7/4
      T.vx -= Math.trunc(rv * BUMPER_NUM * nx / (BUMPER_DEN * 1024));
      T.vy -= Math.trunc(rv * BUMPER_NUM * ny / (BUMPER_DEN * 1024));
      ev.push({ type: 'bumper', id: b.id, x: T.x, y: T.y });
    }
  }

  // 6. Bubbles: attach when the treat enters an idle bubble.
  for (const b of state.bubbles) {
    if (b.state === 0) {
      const dx = T.x - b.x;
      const dy = T.y - b.y;
      if (dx * dx + dy * dy < b.r * b.r) {
        b.state = 1;
        ev.push({ type: 'bubble-attach', id: b.id, x: b.x, y: b.y });
      }
    }
    if (b.state === 1) { b.x = T.x; b.y = T.y; }
  }

  // 7. Stars.
  for (const s of state.stars) {
    if (s.got) continue;
    const rr = STAR_R + TREAT_R;
    const dx = T.x - s.x;
    const dy = T.y - s.y;
    if (dx * dx + dy * dy < rr * rr) {
      s.got = true;
      ev.push({ type: 'star', id: s.id, x: s.x, y: s.y });
    }
  }

  // 8. Hazards (checked before capture: danger wins a tie).
  for (const h of state.spikes) {
    const rr = h.r + TREAT_R_HALF;
    const dx = T.x - h.x;
    const dy = T.y - h.y;
    if (dx * dx + dy * dy < rr * rr) {
      ev.push({ type: 'hazard', id: h.id, x: T.x, y: T.y });
      state.outcome = { status: 'lost', reason: 'hazard' };
      return;
    }
  }

  // 9. Recipient capture.
  {
    const R = state.recipient;
    const dx = T.x - R.x;
    const dy = T.y - R.y;
    if (dx * dx + dy * dy < R.r * R.r) {
      ev.push({ type: 'delivered', x: T.x, y: T.y });
      state.outcome = { status: 'won', reason: 'delivered' };
      return;
    }
  }

  // 10. Bounds.
  const B = state.bounds;
  if (T.x < B.minX || T.x > B.maxX || T.y < B.minY || T.y > B.maxY) {
    ev.push({ type: 'out', x: T.x, y: T.y });
    state.outcome = { status: 'lost', reason: 'out-of-bounds' };
    return;
  }

  // 11. Stall: treat motionless with no remaining agency.
  const v2 = T.vx * T.vx + T.vy * T.vy;
  if (v2 < STALL_VEL * STALL_VEL) state.still++;
  else state.still = 0;
  if (state.still > STALL_TICKS) {
    let agency = false;
    for (const r of state.ropes) if (!r.cut) { agency = true; break; }
    if (!agency) for (const b of state.bubbles) if (b.state === 1) { agency = true; break; }
    if (!agency) {
      ev.push({ type: 'stalled', x: T.x, y: T.y });
      state.outcome = { status: 'lost', reason: 'stalled' };
      return;
    }
  }
}
