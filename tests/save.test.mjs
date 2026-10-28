// The engine save model (js/save.js): the old cloud slot migrates, two devices merge, options pick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readForeign, mergeSave, normalize, sameSave, pickOptions, emptySave } from '../js/save.js';
import { Session } from '../js/session.js';
import { levelById } from '../js/levels.js';

test('reads the browser build cloud slot ({ savedAt, progress })', () => {
  const doc = readForeign(JSON.stringify({ savedAt: 1, progress: { levels: { j01: { completed: true, stars: 3, bestScore: 800 } }, tutorialsDone: ['learn-1'], cosmetics: { treat: 'choco' } } }));
  assert.equal(doc.progress.levels.j01.stars, 3);
  assert.equal(doc.progress.totalStars, 3);
  assert.equal(doc.progress.cosmetics.treat, 'choco');
  assert.equal(doc.progress.cosmetics.trail, 'none');
  assert.equal(readForeign('nope'), null);
  assert.equal(readForeign(JSON.stringify({ v: 1 })), null);
});
test('merges two devices: best per stage, unions, preferred cosmetics', () => {
  const a = { progress: { levels: { j01: { completed: true, stars: 2, bestScore: 700 } }, achievements: ['first-delivery'], cosmetics: { treat: 'choco' }, lastLevel: 'j01' } };
  const b = { progress: { levels: { j01: { completed: false, stars: 3, bestScore: 600 }, j02: { completed: true, stars: 1, bestScore: 500 } }, dailyDays: ['2026-10-01'], cosmetics: { treat: 'minty' } } };
  const m = mergeSave(a, b, 'local').progress;
  assert.deepEqual(m.levels.j01, { completed: true, stars: 3, bestScore: 700 });
  assert.equal(m.totalStars, 4);
  assert.equal(m.cosmetics.treat, 'minty');
  assert.deepEqual(m.achievements, ['first-delivery']);
  assert.deepEqual(m.dailyDays, ['2026-10-01']);
  assert.ok(sameSave(m.levels && { progress: m }, normalize({ progress: m })));
  assert.ok(sameSave(emptySave(), normalize(null)));
});
test('options: only the left-handed layout', () => {
  assert.deepEqual(pickOptions({ leftHanded: true, music: 0.3 }), { leftHanded: true });
});
test('a lesson step met by the action itself advances at once (Learn 5: fan on, then snip)', () => {
  const s = new Session(levelById('learn-5'));
  s.dispatch('fan', 'fan-0', true);
  assert.equal(s.tutorialIndex, 1);
  assert.deepEqual(s.legalActions().map((a) => a.type), ['cut']);
});
