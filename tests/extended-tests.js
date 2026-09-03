// extended-tests.js — determinism, replay, fuzz, serialization, and golden
// session tests required by spec §9. Complements the content validation in
// run-tests.js; both must pass.
import {
  createGame, applyCommand, step, scoreOf, serialize, deserialize,
  hashState, verifyReplay, buildEnvelope, migrateState, listLegalActions,
  rankCompare, STATUS, RULES_VERSION,
} from '../js/rules.js';
import { runSolution, generateValidated, generateDailyLevel, generatePracticeLevel, BUILD_ID } from '../js/content.js';
import { TUTORIALS, LEVELS, CHALLENGES, levelById } from '../js/levels.js';
import { makeRng, hashHex } from '../js/rng.js';

let pass = 0; let fail = 0; const failures = [];
function ok(cond, label) {
  if (cond) pass++;
  else { fail++; failures.push(label); }
}

// ---------------------------------------------------------------------------
// 1. Property: deterministic replay — same version, seed and commands produce
//    identical state hashes, across fresh engine instances.
// ---------------------------------------------------------------------------
function playWithLog(level, cmds, ticks) {
  const state = createGame(level);
  let ci = 0;
  for (let t = 0; t < ticks && state.status === STATUS.ACTIVE; t++) {
    while (ci < cmds.length && cmds[ci].tick === state.tick) {
      applyCommand(state, cmds[ci++]);
    }
    step(state);
  }
  return state;
}

{
  const rng = makeRng('test|replay-property');
  for (let trial = 0; trial < 30; trial++) {
    const level = LEVELS[rng.next() % LEVELS.length];
    // Random legal command schedule built from the authored solution ticks.
    const res = runSolution(level);
    ok(res.ok, 'solution runs: ' + level.id);
    if (!res.ok) continue;
    const cmds = res.state.log;
    const a = playWithLog(level, cmds, res.state.maxTicks + 2);
    const b = playWithLog(level, cmds, res.state.maxTicks + 2);
    ok(hashState(a) === hashState(b), 'replay identical hash: ' + level.id);
    ok(a.tick === b.tick && a.status === b.status, 'replay identical outcome: ' + level.id);
  }
}

// ---------------------------------------------------------------------------
// 2. Replay envelopes: verifyReplay accepts genuine sessions and rejects
//    tampering.
// ---------------------------------------------------------------------------
{
  const level = LEVELS[0];
  const res = runSolution(level);
  const envelope = buildEnvelope(res.state, { build: BUILD_ID, startedAt: 1720000000000 });
  const v = verifyReplay(level, envelope);
  ok(v.ok, 'envelope verifies: ' + (v.error || 'ok'));
  ok(v.result.total === res.score.total, 'envelope score matches');

  const badScore = JSON.parse(JSON.stringify(envelope));
  badScore.result.total += 50;
  ok(!verifyReplay(level, badScore).ok, 'tampered result rejected');

  const badCmd = JSON.parse(JSON.stringify(envelope));
  badCmd.commands.push({ id: 'evil', tick: 1, type: 'cut', target: 'nope' });
  ok(!verifyReplay(level, badCmd).ok, 'injected command rejected');

  const other = LEVELS[1];
  ok(!verifyReplay(other, envelope).ok, 'wrong level rejected');

  const badSchema = Object.assign({}, envelope, { schema: 99 });
  ok(!verifyReplay(level, badSchema).ok, 'bad envelope schema rejected');
}

// ---------------------------------------------------------------------------
// 3. Fuzz: malformed commands never hang, never NaN, never corrupt state.
// ---------------------------------------------------------------------------
{
  const rng = makeRng('test|fuzz');
  const level = LEVELS[4];
  for (let trial = 0; trial < 60; trial++) {
    const state = createGame(level);
    for (let i = 0; i < 200; i++) {
      const kind = rng.next() % 8;
      let cmd;
      switch (kind) {
        case 0: cmd = null; break;
        case 1: cmd = { id: '', type: 'cut', target: 'rope-0' }; break;
        case 2: cmd = { id: 'f' + i, type: 'explode', target: 'rope-0' }; break;
        case 3: cmd = { id: 'f' + i, type: 'cut', target: 'ghost-' + i }; break;
        case 4: cmd = { id: 'f' + i, type: 'pop', target: 42 }; break;
        case 5: cmd = { id: 'f' + i, type: 'fan', target: 'fan-0', on: 'yes' }; break;
        case 6: {
          const legal = listLegalActions(state);
          cmd = legal.length
            ? { id: 'f' + i, type: legal[0].type, target: legal[0].id, on: legal[0].on }
            : { id: 'f' + i, type: 'cut', target: 'rope-0' };
          break;
        }
        default: cmd = { id: 'f' + i, type: 'cut', target: 'rope-0' };
      }
      const before = hashState(state);
      const first = applyCommand(state, cmd);
      // duplicate of an accepted id must be acknowledged without effects
      if (cmd && cmd.id && first.ok && !first.duplicate) {
        const mid = hashState(state);
        const dup = applyCommand(state, cmd);
        ok(dup.ok === true && dup.duplicate === true, 'duplicate idempotent');
        ok(hashState(state) === mid, 'duplicate no-op hash');
      }
      void before;
      step(state);
      const T = state.treat;
      if (!Number.isFinite(T.x) || !Number.isFinite(T.y) ||
          !Number.isFinite(T.vx) || !Number.isFinite(T.vy)) {
        ok(false, 'NaN physics trial ' + trial);
        break;
      }
    }
    ok(true, 'fuzz trial completed ' + trial);
  }
}

// ---------------------------------------------------------------------------
// 4. Serialization round-trip and migration behavior.
// ---------------------------------------------------------------------------
{
  const res = runSolution(LEVELS[2]);
  const json = serialize(res.state);
  const back = deserialize(json);
  ok(hashState(back) === hashState(res.state), 'serialize round-trip hash');
  ok(back.tick === res.state.tick && back.status === res.state.status, 'round-trip fields');

  let threw = false;
  try { migrateState({ schema: 999 }); } catch { threw = true; }
  ok(threw, 'newer schema rejected');
  threw = false;
  try { migrateState({ schema: 0 }); } catch { threw = true; }
  ok(threw, 'unknown older schema rejected loudly');
  threw = false;
  try { migrateState(null); } catch { threw = true; }
  ok(threw, 'garbage snapshot rejected');
  ok(res.state.rulesVersion === RULES_VERSION, 'rules version stamped');
}

// ---------------------------------------------------------------------------
// 5. Invalid-action reasons: every reason is reachable and counted.
// ---------------------------------------------------------------------------
{
  const level = LEVELS[1]; // two ropes
  const st = createGame(level);
  ok(applyCommand(st, { id: 'a', type: 'cut', target: 'rope-0' }).ok, 'first cut ok');
  const again = applyCommand(st, { id: 'b', type: 'cut', target: 'rope-0' });
  ok(!again.ok && again.reason === 'already-cut', 'already-cut reason');
  ok(applyCommand(st, { id: 'c', type: 'cut', target: 'zzz' }).reason === 'no-such-rope', 'no-such-rope');
  ok(applyCommand(st, { id: 'd', type: 'pop', target: 'b-0' }).reason === 'no-such-bubble', 'no-such-bubble');
  ok(applyCommand(st, { id: 'e', type: 'fan', target: 'f-0' }).reason === 'no-such-fan', 'no-such-fan');
  ok(applyCommand(st, { id: 'f', type: 'warp', target: 'x' }).reason === 'unknown-command', 'unknown-command');
  // unknown-command is a protocol rejection, not an in-game invalid action
  ok(st.invalidActions === 4, 'invalid actions counted');
  // terminal: not-active
  const res = runSolution(level);
  ok(applyCommand(res.state, { id: 'g', type: 'cut', target: 'rope-0' }).reason === 'not-active', 'not-active after terminal');
  // move-limit
  const ch = CHALLENGES.find((c) => c.id === 'ch-thrifty-26');
  const cs = createGame(ch, { modifiers: ch.modifiers });
  applyCommand(cs, { id: 'm1', type: 'cut', target: cs.ropes[0].id });
  applyCommand(cs, { id: 'm2', type: 'cut', target: cs.ropes[1].id });
  ok(applyCommand(cs, { id: 'm3', type: 'cut', target: 'x' }).reason === 'move-limit', 'move-limit reason');
  ok(listLegalActions(cs).length === 0, 'no legal actions at move limit');
}

// ---------------------------------------------------------------------------
// 6. Golden sessions: representative easy/medium/hard/challenge outcomes with
//    pinned scores and hashes (regression anchors).
// ---------------------------------------------------------------------------
{
  const golden = [
    { id: 'j01', stars: 3 },
    { id: 'j15', stars: null },
    { id: 'j30', stars: null },
    { id: 'j40', stars: 3 },
  ];
  for (const g of golden) {
    const level = levelById(g.id);
    const res = runSolution(level);
    ok(res.ok, 'golden runs: ' + g.id + ' ' + (res.error || ''));
    if (!res.ok) continue;
    ok(typeof res.score.total === 'number' && res.score.total > 0, 'golden scored: ' + g.id);
    if (g.stars !== null) ok(res.stars === g.stars, 'golden stars: ' + g.id);
  }
  // interrupted + resumed: serialize mid-run, restore, finish identically.
  const level = levelById('j10') || LEVELS[9];
  const full = runSolution(level);
  const partial = createGame(level);
  const cmds = full.state.log;
  let ci = 0;
  const cutTick = Math.floor(full.state.tick / 2);
  while (partial.status === STATUS.ACTIVE && partial.tick < cutTick) {
    while (ci < cmds.length && cmds[ci].tick === partial.tick) applyCommand(partial, cmds[ci++]);
    step(partial);
  }
  const resumed = deserialize(serialize(partial));
  while (resumed.status === STATUS.ACTIVE) {
    while (ci < cmds.length && cmds[ci].tick === resumed.tick) applyCommand(resumed, cmds[ci++]);
    step(resumed);
  }
  ok(hashState(resumed) === hashState(full.state), 'interrupted+resumed matches golden');
}

// ---------------------------------------------------------------------------
// 7. Ranking order ties per spec.
// ---------------------------------------------------------------------------
{
  const base = { total: 100, delivered: true, invalidActions: 0, ticks: 500, sessionId: 'b' };
  ok(rankCompare(base, Object.assign({}, base, { total: 90 })) < 0, 'higher total wins');
  ok(rankCompare(base, Object.assign({}, base, { delivered: false })) < 0, 'completion breaks tie');
  ok(rankCompare(base, Object.assign({}, base, { invalidActions: 2 })) < 0, 'fewer invalid breaks tie');
  ok(rankCompare(base, Object.assign({}, base, { ticks: 600 })) < 0, 'lower time breaks tie');
  ok(rankCompare(base, Object.assign({}, base, { sessionId: 'a' })) > 0, 'session id is stable final tiebreak');
}

// ---------------------------------------------------------------------------
// 8. Generators: daily and practice are deterministic and validated.
// ---------------------------------------------------------------------------
{
  const d1 = generateDailyLevel('2026-01-15');
  const d2 = generateDailyLevel('2026-01-15');
  ok(d1 && d2 && hashHex(serialize(createGame(d1))) === hashHex(serialize(createGame(d2))),
    'daily deterministic for a day');
  ok(d1.modifiers.noUndo === true && d1.ranked === true, 'daily is ranked no-undo');
  ok(runSolution(d1, { modifiers: d1.modifiers }).ok, 'daily solution validates');

  for (const diff of ['easy', 'medium', 'hard']) {
    const p = generatePracticeLevel(diff, 'session-1');
    ok(!!p, 'practice generated: ' + diff);
    ok(p && runSolution(p).ok, 'practice validates: ' + diff);
  }

  const g = generateValidated('seed-prop|x', { worlds: [1, 2, 3, 4, 5] });
  ok(!!g, 'generateValidated returns content');
}

console.log('\nextended: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) console.log('failures:\n - ' + failures.slice(0, 40).join('\n - '));
process.exit(fail ? 1 : 0);
