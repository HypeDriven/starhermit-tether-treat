// The browser build's pure game modules (shared with the node tests), typed
// for this client: the fixed-point physics and rules (js/physics.js,
// js/rules.js: ropes, bubbles, fans, bumpers, spikes, sliders, stars, scoring,
// replay), the content (js/content.js: themes, generators, validators,
// hints, achievements, cosmetics), the authored levels (js/levels.js), the
// round session (js/session.js: validated commands, undo, tutorial steps,
// fast-forward) and the save model (js/save.js).
import * as rulesMod from "../js/rules.js";
import * as physicsMod from "../js/physics.js";
import * as contentMod from "../js/content.js";
import * as levelsMod from "../js/levels.js";
import * as sessionMod from "../js/session.js";
import * as saveMod from "../js/save.js";

export interface Rope { id: string; ax: number; ay: number; slider: number; len: number; cut: boolean; wx: number; wy: number }
export interface Slider { id: string; x0: number; y0: number; x1: number; y1: number; period: number; phase: number; x: number; y: number }
export interface Fan { id: string; x0: number; x1: number; y0: number; y1: number; on: boolean; cx: number; cy: number; w: number; h: number; ndx: number; ndy: number }
export interface Bubble { id: string; x: number; y: number; r: number; state: number }
export interface Circle { id: string; x: number; y: number; r: number }
export interface Star { id: string; x: number; y: number; got: boolean }
export interface State {
  tick: number; status: string; reason: string | null; actionsUsed: number; invalidActions: number;
  treat: { x: number; y: number; vx: number; vy: number };
  ropes: Rope[]; sliders: Slider[]; fans: Fan[]; bubbles: Bubble[]; bumpers: Circle[]; spikes: Circle[]; stars: Star[];
  recipient: { x: number; y: number; r: number };
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  parActions: number; timeLimitTicks: number; moveLimit: number; requireStars: number; disabledActions: string[]; noUndo: boolean;
  maxTicks: number; log: { id: string; tick: number; type: string; target: string; on?: boolean }[];
}
export interface GameEvent { type: string; id?: string; x?: number; y?: number; on?: boolean; status?: string; reason?: string }
export interface Action { type: "cut" | "pop" | "fan"; id: string; on?: boolean }
export interface TutorialStep { text: string; highlight?: { kind: string; id?: string }; require?: { type: string; id: string }; until?: string; waitEvent?: string }
export interface Level {
  id: string; version: number; world: number; index: number; name: string; seed: string; theme: string; mechanics: string[];
  par: { actions: number; seconds: number }; maxSeconds: number;
  layout: { stars?: unknown[]; [k: string]: unknown };
  solution: { do: Action; tick?: number; [k: string]: unknown }[]; tutorial: TutorialStep[] | null;
  modifiers: Record<string, unknown>; mastery: boolean; ranked: boolean; blurb: string;
}
export interface ScoreComponent { key: string; count?: number; amount: number }
export interface Score { total: number; components: ScoreComponent[]; stars: number; delivered: boolean; ticks: number; actionsUsed: number; invalidActions: number }
export interface Session {
  level: Level; mode: string; ranked: boolean; state: State; tutorialIndex: number;
  tutorialStep(): TutorialStep | null;
  legalActions(): Action[];
  gatedByTutorial(a: { type: string; id: string }): boolean;
  dispatch(type: string, target: string, on?: boolean): { ok: boolean; reason?: string; events: GameEvent[] };
  canUndo(): boolean; undo(): boolean;
  hint(): { action: Action; authored: boolean } | null;
  stepOnce(): GameEvent[];
  settle(): void;
  score(): Score;
}
export interface Theme {
  id: string; name: string; bg0: string; bg1: string; floor: string; wall: string; accent: string; accent2: string; rope: string;
  treat: string; star: string; metal: string; hazard: string; key: string; fog: string; ambience: { base: number; shimmer: number };
}
export interface Cosmetic { id: string; name: string; stars: number }
export interface LevelRecord { completed: boolean; stars: number; bestScore: number }
export interface Progress {
  version: number; levels: Record<string, LevelRecord>; tutorialsDone: string[]; achievements: string[]; dailyDays: string[];
  cosmetics: { treat: string; trail: string; room: string }; totalStars: number; lastLevel: string | null;
  board: { total: number; delivered: boolean; levelId: string; at: number }[];
}
export interface SaveDoc { v: 1; progress: Progress }
export interface Options { leftHanded: boolean }

interface RulesApi { TICK_RATE: number; SUB: number; STATUS: { ACTIVE: string; WON: string; LOST: string } }
interface PhysicsApi { sliderPosition(s: Slider, tick: number): { x: number; y: number } }
interface ContentApi {
  THEMES: Record<string, Theme>; ACHIEVEMENTS: { key: string; name: string; desc: string }[];
  COSMETICS: Record<"treat" | "trail" | "room", Cosmetic[]>;
  checkAchievements(p: Progress, levels: Level[]): string[];
  generateDailyLevel(dateKey: string): Level | null;
  generatePracticeLevel(difficulty: string, seed: number): Level | null;
  unlockedCosmetics(total: number): Record<string, string[]>;
  runSolution(level: Level, opts?: unknown): { ok: boolean; ticks: number };
}
interface LevelsApi {
  TUTORIALS: Level[]; LEVELS: Level[]; CHALLENGES: Level[];
  WORLDS: { id: number; name: string; theme: string; mechanic: string }[];
  levelById(id: string): Level | null;
}
interface SaveApi {
  emptySave(): SaveDoc; normalize(raw: unknown): SaveDoc; mergeSave(remote: unknown, local: unknown, prefer?: string): SaveDoc;
  sameSave(a: unknown, b: unknown): boolean; readForeign(text: string): SaveDoc | null;
  recordLevelResult(p: Progress, id: string, r: { completed: boolean; stars: number; score: number }): void;
  recordLocalScore(p: Progress, e: { total: number; delivered: boolean; levelId: string; at: number }): void;
  totalStars(p: Progress): number;
  DEFAULT_OPTIONS: Options; OPTION_KEYS: (keyof Options)[]; BROWSER_KEYS: string[]; pickOptions(raw: unknown): Partial<Options>;
}
interface SessionCtor { new (level: Level, opts?: { mode?: string; ranked?: boolean; roundId?: string }): Session }

export const Rules = rulesMod as unknown as RulesApi;
export const Physics = physicsMod as unknown as PhysicsApi;
export const Content = contentMod as unknown as ContentApi;
export const Levels = levelsMod as unknown as LevelsApi;
export const SaveModel = saveMod as unknown as SaveApi;
export const SessionClass = (sessionMod as unknown as { Session: SessionCtor }).Session;
export const SUB = Rules.SUB;
export const s2w = (s: number): number => s / SUB;
