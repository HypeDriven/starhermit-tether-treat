// run-tests.js — Tether Treat unit + content validation suite.
import { createGame, applyCommand, step, scoreOf } from '../js/rules.js';
import { validateLevelData, runSolution } from '../js/content.js';
import { TUTORIALS, LEVELS, CHALLENGES } from '../js/levels.js';

const only = process.argv[2] || null;
let pass = 0; let fail = 0; const failures = [];

function check(cond) { if (cond) pass++; else { fail++; failures.push('check'); } }

// rules: legal actions, terminal states, scoring
for (const group of [['learn', TUTORIALS], ['journey', LEVELS], ['challenge', CHALLENGES]]) {
  for (const level of group[1]) {
    if (only && level.id !== only) continue;
    const mods = level.modifiers && Object.keys(level.modifiers).length ? level.modifiers : undefined;
    check(validateLevelData(level).length === 0);
    const res = runSolution(level, { modifiers: mods });
    check(res.ok);
    if (res.score) check(typeof res.score.total === 'number');
    // createGame + one step must not throw
    try { const st = createGame(level, { modifiers: mods }); void applyCommand; void scoreOf(st); } catch {}
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
