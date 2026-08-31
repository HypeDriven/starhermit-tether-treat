// validate-levels.js — content validation report (not part of the unit suite).
// Simulates every authored solution through the real rules engine and prints
// pass/fail, star counts, durations, and a trajectory dump for failures.
import { createGame, applyCommand, step, STATUS } from '../js/rules.js';
import { validateLevelData, runSolution, triggerMet, generateDailyLevel, generatePracticeLevel } from '../js/content.js';
import { TUTORIALS, LEVELS, CHALLENGES } from '../js/levels.js';
import { SUB } from '../js/physics.js';

const only = process.argv[2] || null;
const wantTrace = process.argv.includes('--trace');

function trace(level, modifiers) {
  const state = createGame(level, { modifiers, mirrorX: !!(modifiers && modifiers.mirrorX) });
  const sol = level.solution || [];
  const fired = sol.map(() => false);
  const pts = [];
  let guard = 0;
  while (state.status === STATUS.ACTIVE && state.tick <= state.maxTicks + 2 && guard++ < 12000) {
    for (let i = 0; i < sol.length; i++) {
      if (!fired[i] && triggerMet(sol[i], state)) {
        const res = applyCommand(state, { id: 'sol-' + i, type: sol[i].do.type, target: sol[i].do.id, on: sol[i].do.on });
        pts.push(`  ACTION@${state.tick} ${sol[i].do.type} ${sol[i].do.id} ok=${res.ok}${res.ok ? '' : ' reason=' + res.reason}`);
        fired[i] = true;
      }
    }
    step(state);
    if (state.tick % 30 === 0) {
      pts.push(`  t=${state.tick} (${(state.treat.x / SUB).toFixed(2)},${(state.treat.y / SUB).toFixed(2)}) v=(${(state.treat.vx / 1024).toFixed(2)},${(state.treat.vy / 1024).toFixed(2)})`);
    }
    if (state.status !== STATUS.ACTIVE) {
      pts.push(`  END t=${state.tick} ${state.status}/${state.reason} at (${(state.treat.x / SUB).toFixed(2)},${(state.treat.y / SUB).toFixed(2)}) stars=${state.stars.filter((s) => s.got).length}`);
    }
  }
  return pts.join('\n');
}

function check(level, modifiers, label) {
  const errs = validateLevelData(level);
  if (errs.length) return { ok: false, msg: 'data: ' + errs.join('; ') };
  const res = runSolution(level, { modifiers });
  const starTotal = level.layout.stars.length;
  if (!res.ok) return { ok: false, msg: res.error + ` (stars ${res.stars}/${starTotal}, t=${res.ticks})` };
  if (res.stars !== starTotal) return { ok: false, msg: `stars ${res.stars}/${starTotal}` };
  return { ok: true, msg: `t=${(res.ticks / 120).toFixed(2)}s stars=${res.stars}/${starTotal} score=${res.score.total}` };
}

let pass = 0; let fail = 0;
const failures = [];
for (const group of [['learn', TUTORIALS], ['journey', LEVELS], ['challenge', CHALLENGES]]) {
  for (const level of group[1]) {
    if (only && level.id !== only) continue;
    const mods = level.modifiers && Object.keys(level.modifiers).length ? level.modifiers : undefined;
    const r = check(level, mods, group[0]);
    if (r.ok) { pass++; console.log(`PASS ${group[0]}:${level.id}  ${r.msg}`); }
    else {
      fail++; failures.push(level.id);
      console.log(`FAIL ${group[0]}:${level.id}  ${r.msg}`);
      if (wantTrace || only) console.log(trace(level, mods));
    }
  }
}

if (!only) {
  // Generator spot-checks: today, a fixed day, and each practice difficulty.
  for (const [label, lvl] of [
    ['daily-fixed', generateDailyLevel('2026-01-15')],
    ['daily-today', generateDailyLevel(new Date().toISOString().slice(0, 10))],
    ['practice-easy', generatePracticeLevel('easy', 'smoke-1')],
    ['practice-medium', generatePracticeLevel('medium', 'smoke-2')],
    ['practice-hard', generatePracticeLevel('hard', 'smoke-3')],
  ]) {
    if (!lvl) { fail++; failures.push(label); console.log(`FAIL ${label}: generator returned null`); continue; }
    const r = check(lvl, lvl.modifiers, 'gen');
    if (r.ok) { pass++; console.log(`PASS gen:${label} (${lvl.blurb}) ${r.msg}`); }
    else { fail++; failures.push(label); console.log(`FAIL gen:${label} (${lvl.blurb}) ${r.msg}`); if (wantTrace) console.log(trace(lvl, lvl.modifiers)); }
  }
}

console.log(`\n${pass} passed, ${fail} failed${failures.length ? ': ' + failures.join(', ') : ''}`);
process.exit(fail ? 1 : 0);
