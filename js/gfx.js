// gfx.js — graphics quality model: presets, per-category overrides, StarHermit
// hardware-level detection, per-preset asset/effect budgets and a cost summary. Pure (no three.js, no DOM) so the settings
// panel, the renderer and the unit tests agree on what a setting means.

export const PRESETS = ['low', 'balanced', 'high', 'ultra'];

// Category → allowed tiers, cheapest first.
export const CATEGORIES = {
  shadows: ['off', 'low', 'medium', 'high'],
  ao: ['off', 'on', 'high'],
  bloom: ['off', 'on'],
  grade: ['off', 'on'],
  antialias: ['off', 'fxaa', 'smaa', 'msaa'],
  particles: ['low', 'high'],
  background: ['static', 'animated'],
  detail: ['plain', 'detailed'],
};

// Each preset is a row of tiers, a render scale (multiplies the capped device
// pixel ratio) and a pixel-ratio cap so Low never costs more than the
// original single-pass renderer.
const TABLE = {
  low: { scale: 1, cap: 1, shadows: 'off', ao: 'off', bloom: 'off', grade: 'off', antialias: 'msaa', particles: 'low', background: 'static', detail: 'plain' },
  balanced: { scale: 1, cap: 1.5, shadows: 'low', ao: 'off', bloom: 'on', grade: 'on', antialias: 'fxaa', particles: 'high', background: 'animated', detail: 'detailed' },
  high: { scale: 1, cap: 2, shadows: 'medium', ao: 'on', bloom: 'on', grade: 'on', antialias: 'smaa', particles: 'high', background: 'animated', detail: 'detailed' },
  ultra: { scale: 1.25, cap: 2, shadows: 'high', ao: 'high', bloom: 'on', grade: 'on', antialias: 'msaa', particles: 'high', background: 'animated', detail: 'detailed' },
};

export const SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };

export const DEFAULT_GRAPHICS = { preset: 'auto', render_scale: 1, adaptive: true, show_fps: false };

// Auto picks the preset from the StarHermit hardware level (js/gpu-level.js → window.StarHermitGpu, a
// classic script loaded before main.js; 0 = Galaxy S20 / Intel UHD or weaker, 20 = RTX 5090, each level
// ≈ 1.23× the one below): Low from 0, Balanced from 4, High from 10, Ultra from 17. Phones, tablets and
// ≤ 4 GB machines are capped at level 9 (Balanced).
export const LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };

const gpuApi = () => globalThis.StarHermitGpu;

/** Hardware level 0–20 for an unmasked renderer string plus StarHermitGpu.detectSystem() facts. */
export function detectLevel(gpu, system) {
  const G = gpuApi();
  if (!G) return LEVELS.balanced;
  return G.detectLevel({ webgl: true, webgl2: true, ...(system || {}), gpu: String(gpu || '') });
}

/** The preset Auto starts from for a hardware level. */
export function presetForLevel(level) {
  const G = gpuApi();
  return G ? G.presetForLevel(level, LEVELS) : PRESETS.filter((p) => LEVELS[p] <= level).pop() || 'low';
}

/** Best preset for this GPU (the hardware level already caps phones/tablets at Balanced). */
export function detectPreset(gpu, system) {
  return presetForLevel(detectLevel(gpu, system));
}

/*
 * Per-preset asset and effect budget. Each preset holds 60 FPS on the weakest GPU Auto gives it
 * (Low → level 0, Balanced → 4, High → 10, Ultra → 17; measured with tests/gfx-bench.mjs). Physics,
 * levels, hit proxies and rules are identical on every preset — only visuals change.
 *   material   lit-surface shader: Lambert (Low), Standard (Balanced; clearcoat/sheen dropped) or
 *              Physical (High/Ultra: clear-coated candy, sheen on Morsel)
 *   segments   tessellation of the treat, Morsel, pegs, bubbles, fans, bumpers and ropes as a share of
 *              the authored counts
 *   texture    procedural wallpaper / floor / candy-band canvas scale (×1 = 256² / 128² / 64²)
 *   pool       burst-particle pool per Particles tier (low / high), the high pool scaled with the level
 *   motes      ambient sugar motes (Particles high), scaled with the level
 *   bloomRes / aoRes  bloom and GTAO resolution as a fraction of the frame
 */
export const BUDGETS = {
  low: { material: 'lambert', segments: 0.5, texture: 0.5, pool: { low: 32, high: 120 }, motes: 40, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: 'standard', segments: 0.75, texture: 1, pool: { low: 32, high: 150 }, motes: 56, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: 'physical', segments: 1, texture: 1, pool: { low: 32, high: 180 }, motes: 70, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: 'physical', segments: 1.5, texture: 2, pool: { low: 32, high: 260 }, motes: 110, bloomRes: 1, aoRes: 1 },
};
export const POOL_MAX = 520;
export const MOTE_MAX = 220;

/** A preset's concrete budget for a hardware level (counts scale ≤ 2× within the preset). */
export function budgetFor(preset, level) {
  const src = BUDGETS[preset] || BUDGETS.balanced;
  const b = { ...src, pool: { ...src.pool } };
  const G = gpuApi(), floor = LEVELS[preset] || 0;
  const lv = Math.max(Number.isFinite(level) ? level : floor, floor);
  const k = G ? Math.min(2, G.scaleBudget(1, lv, floor)) : 1;
  b.pool.high = Math.min(POOL_MAX, Math.round(b.pool.high * k));
  b.motes = Math.min(MOTE_MAX, Math.round(b.motes * k));
  return b;
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: tier }.
 * A category missing or set to anything but a valid tier follows the preset.
 */
export function resolve(saved, detected, level) {
  const s = saved || {};
  const auto = !PRESETS.includes(s.preset);
  const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
  const row = TABLE[preset];
  const out = {
    preset,
    auto,
    cap: row.cap,
    scale: row.scale * clamp(Number(s.render_scale) || 1, 0.5, 2),
  };
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
  out.level = Number.isFinite(level) ? level : LEVELS[preset];
  out.budget = budgetFor(preset, out.level);
  out.adaptive = s.adaptive !== false;
  out.showFps = !!s.show_fps;
  // The composer runs only when something needs it; otherwise the canvas's
  // own MSAA is used and the frame is a single direct render (Low).
  out.post = out.ao !== 'off' || out.bloom === 'on' || out.grade === 'on' || out.antialias !== 'msaa';
  return out;
}

/** The preset's own tier for a category (for "From preset (…)" labels). */
export function presetTier(preset, cat) {
  return TABLE[preset] ? TABLE[preset][cat] : undefined;
}

/** Choosing a preset clears every per-category override. */
export function withPreset(saved, preset) {
  const out = {
    preset: preset === 'auto' || PRESETS.includes(preset) ? preset : 'auto',
    render_scale: saved && saved.render_scale !== undefined ? saved.render_scale : 1,
    adaptive: !saved || saved.adaptive !== false,
    show_fps: !!(saved && saved.show_fps),
  };
  return out;
}

/** Map the pre-graphics-panel `quality` setting onto a preset. */
export function migrateQuality(q) {
  return { low: 'low', medium: 'balanced', high: 'high' }[q] || 'auto';
}

/** One-line cost summary: shadows · post effects · AA · pixels. */
export function describe(r, pixels) {
  const parts = [
    r.shadows === 'off' ? 'no shadows' : `${SHADOW_MAP[r.shadows]}² shadows`,
    r.ao === 'off' ? null : r.ao === 'high' ? 'full ambient occlusion' : 'ambient occlusion',
    r.bloom === 'on' ? 'bloom' : null,
    r.grade === 'on' ? 'grade' : null,
    r.antialias === 'off' ? 'no anti-aliasing' : r.antialias.toUpperCase(),
    r.detail === 'detailed' ? 'detailed materials' : 'plain materials',
    pixels ? `${pixels[0]}×${pixels[1]} px` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
