import { readFileSync as readReviewedIdentityData } from 'node:fs';
const REVIEWED_IDENTITIES = JSON.parse(readReviewedIdentityData(new URL('./reviewed-identities.json', import.meta.url), 'utf8'));
// Only exact reviewed key/source pairs are exempt; all other English copies count.
function isReviewedIdentity(locale, key, source) {
  const row = REVIEWED_IDENTITIES.locales[locale]?.[key];
  return row?.source === source && typeof row.reason === 'string' && row.reason.length > 0;
}
// i18n.test.js — every string key used in js/*.js exists in all nine locales
// with the same {placeholders} as US English, and every content name (levels,
// challenge blurbs, coach steps, worlds, achievements, cosmetics) is translated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { LEVELS, TUTORIALS, CHALLENGES, WORLDS } from '../js/levels.js';
import { ACHIEVEMENTS, COSMETICS } from '../js/content.js';

const STRINGS = JSON.parse(readFileSync(new URL('../assets/strings.json', import.meta.url), 'utf8'));
const LOCALES = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT', 'fr-BE', 'de-BE', 'en-SG', 'en-HK', 'en-BQ', 'es-CO', 'de-IT', 'fr-IT', 'es-CL', 'es-AR', 'es-EC', 'ja-JP', 'nl-BE', 'zh-SG', 'ms-SG', 'zh-HK', 'yue-HK', 'nl-NL', 'fi-FI', 'sv-FI', 'et-EE', 'id-ID', 'vi-VN', 'de-BR', 'ta-SG', 'da-DE', 'lb-BE', 'eu-FR', 'ca-FR', 'oc-FR', 'sl-IT', 'ca-IT', 'oc-IT', 'ru-FI', 'ca-ES', 'eu-ES', 'gl-ES', 'ru-EE', 'su-ID', 'co-FR', 'fur-IT', 'bew-ID', 'km-VN'];
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
    for (const l of [...LEVELS, ...TUTORIALS, ...CHALLENGES]) assert.ok(L[`levels.${l.id}`], `${loc} level ${l.id}`);
    for (const c of CHALLENGES) assert.ok(L[`blurbs.${c.id}`], `${loc} blurb ${c.id}`);
    for (const tu of TUTORIALS) tu.tutorial.forEach((_, i) => assert.ok(L[`coach.${tu.id}.${i}`], `${loc} coach ${tu.id} ${i}`));
    for (const w of WORLDS) assert.ok(L[`worlds.${w.id}`] && L[`mechanics.${w.id}`], `${loc} world ${w.id}`);
    for (const a of ACHIEVEMENTS) assert.ok(L[`achievements.${a.key}.0`] && L[`achievements.${a.key}.1`], `${loc} achievement ${a.key}`);
    for (const slot of Object.keys(COSMETICS)) for (const c of COSMETICS[slot]) assert.ok(L[`cosmetics.${c.id}`], `${loc} cosmetic ${c.id}`);
  });
}
test('English content strings match the authored data', () => {
  const en = STRINGS['en-US'];
  for (const l of [...LEVELS, ...TUTORIALS, ...CHALLENGES]) assert.equal(en[`levels.${l.id}`], l.name);
  for (const tu of TUTORIALS) tu.tutorial.forEach((st, i) => assert.equal(en[`coach.${tu.id}.${i}`], st.text));
});
test('non-English locales are translated', () => {
  for (const loc of LOCALES.filter((l) => !l.startsWith('en'))) {
    const same = ([...used].filter((k) => STRINGS[loc][k] === STRINGS['en-US'][k])).filter((key) => !isReviewedIdentity(loc, key, STRINGS['en-US'][key]));
    assert.ok(same.length < 12, `${loc}: ${same.join(', ')}`);
  }
});
