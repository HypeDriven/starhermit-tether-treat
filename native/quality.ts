// The look per graphics level: the browser build's four presets and budgets
// (js/gfx.js TABLE / BUDGETS, each tuned to hold 60 FPS on the weakest GPU
// its Auto gave it) keyed by the runtime's quality tier (frame().quality),
// with the burst pool and sugar motes scaled within the tier by the level
// (frame().levelIndex, at most 2×), as the browser build scaled them by its
// hardware level. The runtime owns the rest of what the old Graphics section
// did: Auto and the level choice, render scale and the pixel-ratio cap,
// adaptive resolution, the frame-rate limit and readout. The old section's
// per-effect overrides are not offered (the runtime's Options choose a level).
import type { QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export interface Budget {
  /** Lit-surface shader: Lambert (Low), Standard (Balanced; clear coat dropped), Physical (High, Ultra). */
  material: "lambert" | "standard" | "physical";
  /** Tessellation as a share of the authored segment counts. */
  segments: number;
  /** Procedural wallpaper / floor / candy-band canvas scale (×1 = 256² / 128² / 64²). */
  texture: number;
  pool: { low: number; high: number };
  motes: number;
  bloomRes: number;
  aoRes: number;
}
export interface Look {
  preset: QualityTier;
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
  grade: boolean;
  antialias: AntialiasMode;
  particles: "low" | "high";
  /** The slowly drifting wallpaper. */
  animated: boolean;
  /** Wallpapered wall, checker floor, candy bands, clear coats, the room environment, rim light, catchlights. */
  detailed: boolean;
  budget: Budget;
}

/** gfx.js TABLE (scale and cap are the runtime's render scale now). */
const TABLE: Record<QualityTier, Omit<Look, "preset" | "budget">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "msaa", particles: "low", animated: false, detailed: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", particles: "high", animated: true, detailed: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", particles: "high", animated: true, detailed: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", particles: "high", animated: true, detailed: true },
};
/** gfx.js BUDGETS. */
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", segments: 0.5, texture: 0.5, pool: { low: 32, high: 120 }, motes: 40, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: "standard", segments: 0.75, texture: 1, pool: { low: 32, high: 150 }, motes: 56, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: "physical", segments: 1, texture: 1, pool: { low: 32, high: 180 }, motes: 70, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: "physical", segments: 1.5, texture: 2, pool: { low: 32, high: 260 }, motes: 110, bloomRes: 1, aoRes: 1 },
};
/** The first level index of each tier (the runtime's ten levels). */
const TIER_FLOOR: Record<QualityTier, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };
export const POOL_MAX = 520;
export const MOTE_MAX = 220;

/** The look for a quality tier at a level index (0 … 9). */
export function lookFor(preset: QualityTier, levelIndex: number): Look {
  const src = BUDGETS[preset];
  const b: Budget = { ...src, pool: { ...src.pool } };
  const k = Math.min(2, Math.pow(1.64, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  b.pool.high = Math.min(POOL_MAX, Math.round(b.pool.high * k));
  b.motes = Math.min(MOTE_MAX, Math.round(b.motes * k));
  return { preset, ...TABLE[preset], budget: b };
}
/** The burst pool for the look's particle tier. */
export function poolSize(l: Look): number { return l.budget.pool[l.particles]; }
/** Sugar motes (Particles high only). */
export function moteCount(l: Look): number { return l.particles === "high" ? l.budget.motes : 0; }
