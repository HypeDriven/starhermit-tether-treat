// The look per graphics level: the engine's level settings (levelSettings():
// shadows and their map size, AO, bloom resolution, grade, anti-aliasing) plus
// the browser build's art (js/gfx.js TABLE / BUDGETS) keyed by the runtime's
// quality tier (frame().quality), with the burst pool and sugar motes scaled
// within the tier by the level's particle budget (at most 2×). The runtime owns
// the rest of what the old Graphics section did: Auto and the level choice,
// render scale and the pixel-ratio cap, adaptive resolution, the frame-rate
// limit and readout. The old section's per-effect overrides are not offered
// (the runtime's Options choose a level).
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
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
}
export interface Look {
  preset: QualityTier;
  /** Key-light shadow map: the level's size (0 = off). */
  shadows: number;
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  /** The level's bloom resolution (null = off). */
  bloom: number | null;
  grade: boolean;
  antialias: AntialiasMode;
  particles: "low" | "high";
  /** The slowly drifting wallpaper. */
  animated: boolean;
  /** Wallpapered wall, checker floor, candy bands, clear coats, the room environment, rim light, catchlights. */
  detailed: boolean;
  budget: Budget;
}

type Art = Pick<Look, "particles" | "animated" | "detailed">;
/** gfx.js TABLE: the game-only columns. */
const ART: Record<QualityTier, Art> = {
  low: { particles: "low", animated: false, detailed: false },
  balanced: { particles: "high", animated: true, detailed: true },
  high: { particles: "high", animated: true, detailed: true },
  ultra: { particles: "high", animated: true, detailed: true },
};
/** gfx.js BUDGETS. */
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", segments: 0.5, texture: 0.5, pool: { low: 32, high: 120 }, motes: 40 },
  balanced: { material: "standard", segments: 0.75, texture: 1, pool: { low: 32, high: 150 }, motes: 56 },
  high: { material: "physical", segments: 1, texture: 1, pool: { low: 32, high: 180 }, motes: 70 },
  ultra: { material: "physical", segments: 1.5, texture: 2, pool: { low: 32, high: 260 }, motes: 110 },
};
const ANCHOR: Record<QualityTier, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };
export const POOL_MAX = 520;
export const MOTE_MAX = 220;

/** The look for a graphics level's settings. */
export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const src = BUDGETS[preset];
  const b: Budget = { ...src, pool: { ...src.pool } };
  const k = Math.min(2, s.particles / levelSettings(ANCHOR[preset]).particles);
  b.pool.high = Math.min(POOL_MAX, Math.round(b.pool.high * k));
  b.motes = Math.min(MOTE_MAX, Math.round(b.motes * k));
  return {
    preset, ...ART[preset], budget: b,
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    antialias: s.antialias,
  };
}
/** The burst pool for the look's particle tier. */
export function poolSize(l: Look): number { return l.budget.pool[l.particles]; }
/** Sugar motes (Particles high only). */
export function moteCount(l: Look): number { return l.particles === "high" ? l.budget.motes : 0; }
