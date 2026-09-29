// gfx.test.js — graphics quality model (js/gfx.js) and panel locales.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESETS, CATEGORIES, detectPreset, capForTouch, resolve, presetTier, withPreset, describe, migrateQuality,
} from '../js/gfx.js';
import { GFX_STRINGS, pickLocale, summaryText } from '../js/gfx-i18n.js';

test('detectPreset maps GPU strings to presets', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low');
  assert.equal(detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)'), 'high');
  assert.equal(detectPreset('Apple M2 Pro'), 'high');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)'), 'balanced');
  assert.equal(detectPreset('Adreno (TM) 650'), 'balanced');
  assert.equal(detectPreset(''), 'balanced');
});

test('touch devices cap Auto at balanced', () => {
  assert.equal(capForTouch('high', true), 'balanced');
  assert.equal(capForTouch('low', true), 'low');
  assert.equal(capForTouch('high', false), 'high');
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
