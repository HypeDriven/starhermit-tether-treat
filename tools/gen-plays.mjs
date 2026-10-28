// Writes the native play scripts (tests/native/*.play) from the levels' own
// authored solutions (js/levels.js), simulated with the real rules so every
// press lands on the tick that delivers the treat and the expected scores
// are exact. A render check plays one 120 Hz fixed step per frame, so a
// press's tick is a frame count after the countdown's "Go!" (measured on
// engine 1.21.0 at minor 23: a `click` acts 70 frames, a `touch` 72 frames
// after the frames before it, and a `click` line takes 7 frames). Run
// `npm run plays` after content, label or timing changes.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame, applyCommand, step, scoreOf, STATUS } from '../js/rules.js';
import { triggerMet } from '../js/content.js';
import { levelById } from '../js/levels.js';
import { STRINGS } from '../js/strings.js';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'native');
const EN = STRINGS['en-US'];
const t = (k, v = {}) => EN[k].replace(/\{(\w+)\}/g, (m, x) => (v[x] != null ? String(v[x]) : m));
export const CLICK = { offset: 70, frames: 7 };
export const TOUCH = { offset: 72, frames: 3 };

/** main.js actionLabel: the action mirror's button text. */
export function actionLabel(a) {
  if (a.type === 'cut') return t('actSnip', { id: a.id });
  if (a.type === 'pop') return t('actPop', { id: a.id });
  return t(a.on ? 'actFanOn' : 'actFanOff', { id: a.id });
}

/**
 * The authored solution as presses: the first at tick `first` (the authored tick-triggered steps keep their
 * spacing from it), each later one when its trigger is met and at least `gap` ticks after the previous press.
 * Returns the presses (tick, action) and the final score.
 */
export function plan(level, { first = 50, gap = CLICK.frames } = {}) {
  const st = createGame(level, { modifiers: level.modifiers });
  const sol = level.solution;
  const fired = sol.map(() => false);
  const acts = [];
  let next = first, shift = null;
  while (st.status === STATUS.ACTIVE && st.tick < st.maxTicks + 2) {
    for (let i = 0; i < sol.length; i++) {
      if (fired[i]) continue;
      const tr = { ...sol[i] };
      if (tr.tick !== undefined) { if (shift === null) shift = first - tr.tick; tr.tick += shift; }
      if (st.tick >= next && triggerMet(tr, st)) {
        const res = applyCommand(st, { id: 'p' + i, type: sol[i].do.type, target: sol[i].do.id, on: sol[i].do.on });
        if (!res.ok) throw new Error(`${level.id}: ${res.reason}`);
        fired[i] = true;
        acts.push({ tick: st.tick, ...sol[i].do });
        next = st.tick + gap;
      }
      break;
    }
    step(st);
  }
  return { acts, score: scoreOf(st), reason: st.reason };
}

/** Lines that press each planned action on its tick (after `until =Go!`), by click or touch on the mirror. */
function presses(acts, how = 'click') {
  const m = how === 'click' ? CLICK : TOUCH;
  const lines = [];
  let c = 0;
  for (const a of acts) {
    const gapF = a.tick + m.offset - c;
    if (gapF < 0) throw new Error('presses too close');
    if (gapF > 0) lines.push(`frames ${gapF}`);
    lines.push(`${how} =${actionLabel(a)}`);
    c += gapF + m.frames;
  }
  return lines;
}
/** A round from the countdown to its results, with the exact total expected. */
function round(id, how, lines, extra = []) {
  const level = levelById(id);
  const p = plan(level, how === 'touch' ? { gap: 30 } : {});
  if (p.reason !== 'delivered') throw new Error(`${id}: ${p.reason}`);
  lines.push(`# ${id} (${EN.levels[id]}): ${p.acts.map((a) => `${a.type} ${a.id} at tick ${a.tick}`).join(', ')}`, 'until 900 =Go!');
  lines.push(...presses(p.acts, how), ...extra);
  lines.push('until 1800 =Delivered!', 'frames 10', `expect =${p.score.total}`);
  return p;
}

const files = {};
{
  // Journey on a desktop by mouse on the action mirror: four stages in a row (Next stage), timed swings included.
  const L = ['# viewport 1280x800@1', 'until 600 =Journey map', 'frames 30', 'click Play Journey'];
  for (const [i, id] of ['j01', 'j02', 'j03', 'j04'].entries()) {
    round(id, 'click', L);
    if (i === 0) L.push('expect First Delivery', 'save journey-results');
    if (i < 3) L.push('click =Next stage');
  }
  L.push('click =Mode select', 'until 300 =Journey map', 'frames 10', 'expect ★ 12');
  files['journey-desktop'] = L;
}
{
  // Learn on a DPR-3 phone by finger: lesson 1 by a swipe across the rope on the board, lesson 2 by a timed tap on the mirror.
  const L = ['# viewport 390x844@3', 'until 600 =Journey map', 'frames 30', 'touch Learn', 'until 900 =Go!', 'frames 100',
    'expect Swipe across the rope', 'save learn-coach', 'swipe 140 162 250 162 8', 'until 900 =Delivered!', 'frames 10', 'expect =800', 'touch =Next lesson'];
  round('learn-2', 'touch', L);
  L.push('save learn-results', 'touch =Mode select', 'until 300 =Journey map');
  files['learn-phone'] = L;
}
{
  // Bubbles and fans on a desktop: Learn lessons 4 and 5 (pop above Morsel, fan on then snip) from the lesson list.
  const L = ['# viewport 1280x800@1', 'until 600 =Journey map', 'frames 30', 'click Learn'];
  // the first unfinished lesson is learn-1: snip it, then Next lesson through 2 and 3
  for (const id of ['learn-1', 'learn-2', 'learn-3', 'learn-4', 'learn-5', 'learn-6']) {
    const p = round(id, 'click', L);
    if (id === 'learn-4') L.push('save bubble-results');
    void p;
    if (id !== 'learn-6') L.push('click =Next lesson');
  }
  L.push('click =Mode select', 'until 300 6/6 lessons done');
  files['learn-desktop'] = L;
}
{
  // A Challenge lost: Sprint: Swing Low with no cut runs out its 5 seconds.
  files['challenge-timeup'] = ['# viewport 1280x800@1', 'until 600 =Journey map', 'frames 30', 'click Challenge', 'until 300 Sprint: Swing Low', 'frames 10',
    'click Sprint: Swing Low', 'until 900 =Go!', 'frames 120', 'expect ⏱', 'until 1200 =Try Again', 'frames 10', `expect ${t('reasonTime')}`,
    `expect ${t('savedLocal')}`, 'save challenge-lost', 'click =Mode select', 'until 300 =Journey map'];
}
{
  // Practice sideways on a phone: a snip, undo, a hint, pause and resume, then skip to the (lost) end; retry.
  files['practice-landscape'] = ['# viewport 844x390@3', 'until 600 =Journey map', 'frames 30', 'touch Practice', 'until 300 =Easy', 'frames 10',
    'touch =Easy', 'until 900 =Go!', 'frames 120', 'touch =Snip rope-0', 'frames 10', 'expect Actions: 1', 'touch =Undo (U)', 'frames 10', 'expect Actions: 0',
    'touch =Hint (H)', 'frames 10', 'save practice-hint', 'touch =Pause (Esc)', 'until 300 =Resume (Esc)', 'frames 10', 'save practice-pause',
    'touch =Resume (Esc)', 'frames 10', 'touch =Skip ▸▸', 'until 900 =Try Again', 'frames 10', `expect ${t('reasonTime')}`, 'touch =Retry (R)',
    'until 900 =Go!', 'frames 100', 'key Escape 1', 'until 300 =Quit to title', 'frames 10', 'touch =Quit to title', 'until 300 =Journey map'];
}
{
  // The menus: Help, Settings (left-handed on and off), Score Chase tabs, the Journey map, today's Daily left from the pause menu.
  files.menus = ['# viewport 1280x800@1', 'until 600 =Journey map', 'frames 30', 'click =Help', 'until 300 =Controls', 'frames 10', 'save help',
    'click =← Back', 'until 300 =Journey map', 'frames 10', 'click =Settings', 'until 300 Left-handed layout', 'frames 10',
    'click =Left-handed layout', 'frames 10', 'click =Left-handed layout', 'frames 10', 'save settings', 'click =← Back', 'until 300 =Journey map', 'frames 10',
    'click Score Chase', 'until 300 =Friends', 'frames 10', 'click =Friends', 'frames 20', 'expect Leaderboard unavailable', 'click =← Back',
    'until 300 =Journey map', 'frames 10', 'click =Journey map', 'until 300 Gumdrop Garage', 'frames 10', 'save map', 'key Escape 1',
    'until 300 =Journey map', 'frames 10', 'click Daily Drop', 'until 900 =Go!', 'frames 100', 'expect Deliver the treat', 'key Escape 1',
    'until 300 =Quit to title', 'frames 10', 'click =Settings', 'until 300 Left-handed layout', 'frames 10', 'click =← Back', 'until 300 =Resume (Esc)',
    'frames 10', 'click =Quit to title', 'until 300 =Journey map'];
}
for (const [name, lines] of Object.entries(files)) {
  writeFileSync(join(out, `${name}.play`), `# Generated by tools/gen-plays.mjs.\n${lines.join('\n')}\n`);
  console.log(`tests/native/${name}.play: ${lines.length} lines`);
}
