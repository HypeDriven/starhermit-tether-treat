// gfx.test.js — graphics quality model (js/gfx.js) and panel locales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// js/gpu-level.js is a classic script in the page (window.StarHermitGpu); evaluate it the same way here.
new Function('window', 'module', readFileSync(new URL('../js/gpu-level.js', import.meta.url), 'utf8'))(globalThis, undefined);
const {
  PRESETS, CATEGORIES, detectPreset, detectLevel, presetForLevel, budgetFor, resolve, presetTier, withPreset, describe, migrateQuality,
  LEVELS, BUDGETS, POOL_MAX, MOTE_MAX,
} = await import('../js/gfx.js');
const { GFX_STRINGS, pickLocale, summaryText } = await import('../js/gfx-i18n.js');

const DESK = { cores: 8, memoryGb: 8 };
const PHONE = { mobile: true, cores: 8, memoryGb: 8 };

test('hardware level picks the Auto preset (Low 0, Balanced 4, High 10, Ultra 17)', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', DESK), 'low');
  assert.equal(detectLevel('llvmpipe (LLVM 15.0.7, 256 bits)', DESK), 0);
  assert.equal(detectPreset('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', DESK), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', DESK), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', DESK), 'balanced');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0)', DESK), 'high');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  assert.equal(detectLevel('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 20);
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  for (const [p, lv] of Object.entries(LEVELS)) assert.equal(presetForLevel(lv), p);
  assert.equal(presetForLevel(3), 'low');
  assert.equal(presetForLevel(16), 'high');
});

test('phones and tablets are Balanced at most; software GPUs stay Low', () => {
  assert.equal(detectPreset('Adreno (TM) 740', PHONE), 'balanced');
  assert.ok(detectLevel('Adreno (TM) 740', PHONE) <= 9);
  assert.equal(detectPreset('Apple M1', PHONE), 'balanced');
  assert.equal(detectPreset('SwiftShader', PHONE), 'low');
});

test('per-preset budgets are explicit, grow from Low to Ultra and scale with the level', () => {
  const keys = Object.keys(BUDGETS.low);
  for (const p of PRESETS) for (const k of keys) assert.ok(BUDGETS[p][k] != null, `${p}.${k}`);
  for (let i = 1; i < PRESETS.length; i++) for (const k of keys) {
    if (typeof BUDGETS.low[k] === 'number') assert.ok(BUDGETS[PRESETS[i]][k] >= BUDGETS[PRESETS[i - 1]][k], `${PRESETS[i]}.${k}`);
    assert.ok(BUDGETS[PRESETS[i]].pool.high >= BUDGETS[PRESETS[i - 1]].pool.high);
  }
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].material), ['lambert', 'standard', 'physical', 'physical']);
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].bloomRes), [0.5, 0.5, 0.5, 1], 'half-res bloom below Ultra');
  assert.deepEqual(resolve({ preset: 'high' }, 'low', 10).budget, BUDGETS.high, 'floor level = the tuned budget');
  assert.deepEqual(resolve({ preset: 'ultra' }, 'low', 0).budget, resolve({ preset: 'ultra' }, 'ultra', 17).budget);
  assert.ok(budgetFor('balanced', 9).motes > budgetFor('balanced', 4).motes, 'counts scale up within the preset');
  assert.ok(budgetFor('balanced', 20).pool.high <= 2 * BUDGETS.balanced.pool.high, '≤ 2×');
  assert.ok(budgetFor('ultra', 20).pool.high <= POOL_MAX && budgetFor('ultra', 20).motes <= MOTE_MAX);
  assert.equal(BUDGETS.high.pool.high, 180, 'unchanged object: budgetFor copies');
  const head = resolve({}, 'low', 0);
  assert.equal(head.preset, 'low', 'headless SwiftShader: Low');
  assert.equal(head.level, 0);
});

test('every locale has the Level label', () => {
  for (const [tag, T] of Object.entries(GFX_STRINGS)) assert.match(T.level, /\{n\}/, tag);
});

test('resolve: auto follows detection, explicit preset wins', () => {
  const a = resolve({ preset: 'auto' }, 'low');
  assert.equal(a.preset, 'low');
  assert.equal(a.auto, true);
  assert.equal(a.post, false, 'Low renders in a single direct pass');
  assert.equal(a.shadows, 'off');
  const h = resolve({ preset: 'high' }, 'low');
  assert.equal(h.preset, 'high');
  assert.equal(h.auto, false);
  assert.equal(h.shadows, 'medium');
  assert.equal(h.post, true);
  for (const p of PRESETS) {
    const r = resolve({ preset: p }, 'low');
    for (const [cat, tiers] of Object.entries(CATEGORIES)) {
      assert.ok(tiers.includes(r[cat]), `${p}.${cat}`);
      assert.equal(r[cat], presetTier(p, cat));
    }
  }
});

test('resolve: overrides, invalid values and scale clamp', () => {
  const r = resolve({ preset: 'low', bloom: 'on', shadows: 'bogus', render_scale: 5 }, 'high');
  assert.equal(r.bloom, 'on');
  assert.equal(r.shadows, 'off');
  assert.equal(r.post, true, 'an override that needs post enables the chain');
  assert.equal(r.scale, 2);
  assert.equal(resolve({ preset: 'high', render_scale: 0.1 }).scale, 0.5);
  assert.equal(resolve({ preset: 'ultra', render_scale: 1 }).scale, 1.25);
  assert.equal(resolve({}).adaptive, true);
  assert.equal(resolve({ adaptive: false }).adaptive, false);
  assert.equal(resolve({}).showFps, false);
  assert.equal(resolve({ preset: 'low', antialias: 'off' }).post, true);
});

test('choosing a preset clears overrides but keeps scale/toggles', () => {
  const saved = { preset: 'low', bloom: 'on', detail: 'detailed', render_scale: 1.5, adaptive: false, show_fps: true };
  const next = withPreset(saved, 'high');
  assert.deepEqual(next, { preset: 'high', render_scale: 1.5, adaptive: false, show_fps: true });
  assert.equal(resolve(next).bloom, 'on');
  assert.equal(resolve(withPreset(saved, 'low')).bloom, 'off');
  assert.equal(withPreset(saved, 'nonsense').preset, 'auto');
});

test('legacy quality migrates to presets', () => {
  assert.equal(migrateQuality('medium'), 'balanced');
  assert.equal(migrateQuality('high'), 'high');
  assert.equal(migrateQuality('auto'), 'auto');
});

test('describe summarises cost', () => {
  const s = describe(resolve({ preset: 'high' }), [1280, 720]);
  assert.match(s, /2048² shadows/);
  assert.match(s, /SMAA/);
  assert.match(s, /1280×720 px/);
  assert.match(describe(resolve({ preset: 'low' })), /no shadows/);
});

test('every locale has every Graphics string', () => {
  const need = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
  const en = GFX_STRINGS['en-GB'];
  for (const loc of need) {
    const S = GFX_STRINGS[loc];
    assert.ok(S, loc);
    for (const k of Object.keys(en)) {
      if (typeof en[k] === 'string') assert.equal(typeof S[k], 'string', `${loc}.${k}`);
      else for (const kk of Object.keys(en[k])) assert.equal(typeof S[k][kk], 'string', `${loc}.${k}.${kk}`);
    }
    for (const cat of Object.keys(CATEGORIES)) assert.ok(S.cat[cat], `${loc} cat ${cat}`);
    for (const tiers of Object.values(CATEGORIES)) for (const t of tiers) assert.ok(S.tier[t], `${loc} tier ${t}`);
    assert.ok(summaryText(resolve({ preset: 'ultra' }), [10, 10], S).length > 0);
  }
  assert.equal(pickLocale('de'), 'de-DE');
  assert.equal(pickLocale('es-MX'), 'es-419');
  assert.equal(pickLocale('en-AU'), 'en-GB');
  assert.equal(pickLocale('fr-CA'), 'fr-CA');
  assert.equal(pickLocale('ja-JP'), 'en-US');
});
