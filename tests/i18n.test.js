// i18n.test.js — every string key used in js/*.js exists in all nine locales
// with the same {placeholders} as US English, and every content name (levels,
// challenge blurbs, coach steps, worlds, achievements, cosmetics) is translated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { STRINGS } from '../js/strings.js';
import { LEVELS, TUTORIALS, CHALLENGES, WORLDS } from '../js/levels.js';
import { ACHIEVEMENTS, COSMETICS } from '../js/content.js';

const LOCALES = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
const code = readdirSync(new URL('../native/', import.meta.url)).filter((f) => f.endsWith('.ts'))
  .map((f) => readFileSync(new URL('../native/' + f, import.meta.url), 'utf8')).join('\n');
const used = new Set();
for (const m of code.matchAll(/\bT\("([A-Za-z0-9]+)"(?!\s*\+)/g)) used.add(m[1]);
for (const m of code.matchAll(/"((?:sync|scr|kind|err|reason|help|board|diff|slot|act|next|result|announce|hint)[A-Z][A-Za-z]*)"/g)) used.add(m[1]);
for (const k of ['diffEasy', 'diffMedium', 'diffHard', 'boardGlobal', 'boardDaily', 'boardFriends', 'slotTreat', 'slotTrail', 'slotRoom',
  'helpCutText', 'helpStarsText', 'helpBubbleText', 'helpFanText', 'helpBumperText', 'helpSpikesText', 'helpSliderText']) used.add(k);
const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('ships the nine locales', () => assert.deepEqual(Object.keys(STRINGS).sort(), [...LOCALES].sort()));
test('found the keys in code', () => assert.ok(used.size > 150, String(used.size)));
for (const loc of LOCALES) {
  test(`${loc}: every used key, matching placeholders`, () => {
    const L = STRINGS[loc];
    assert.deepEqual([...used].filter((k) => typeof L[k] !== 'string'), []);
    for (const k of used) assert.equal(vars(L[k]), vars(STRINGS['en-US'][k]), `${loc}.${k}`);
  });
  test(`${loc}: every content name`, () => {
    const L = STRINGS[loc];
    for (const l of [...LEVELS, ...TUTORIALS, ...CHALLENGES]) assert.ok(L.levels[l.id], `${loc} level ${l.id}`);
    for (const c of CHALLENGES) assert.ok(L.blurbs[c.id], `${loc} blurb ${c.id}`);
    for (const tu of TUTORIALS) assert.equal(L.coach[tu.id].length, tu.tutorial.length, `${loc} coach ${tu.id}`);
    for (const w of WORLDS) assert.ok(L.worlds[w.id] && L.mechanics[w.id], `${loc} world ${w.id}`);
    for (const a of ACHIEVEMENTS) assert.equal(L.achievements[a.key].length, 2, `${loc} achievement ${a.key}`);
    for (const slot of Object.keys(COSMETICS)) for (const c of COSMETICS[slot]) assert.ok(L.cosmetics[c.id], `${loc} cosmetic ${c.id}`);
  });
}
test('English content strings match the authored data', () => {
  const en = STRINGS['en-US'];
  for (const l of [...LEVELS, ...TUTORIALS, ...CHALLENGES]) assert.equal(en.levels[l.id], l.name);
  for (const tu of TUTORIALS) tu.tutorial.forEach((st, i) => assert.equal(en.coach[tu.id][i], st.text));
});
test('non-English locales are translated', () => {
  for (const loc of LOCALES.filter((l) => !l.startsWith('en'))) {
    const same = [...used].filter((k) => STRINGS[loc][k] === STRINGS['en-US'][k]);
    assert.ok(same.length < 12, `${loc}: ${same.join(', ')}`);
  }
});
