// Tether Treat on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The fixed-point physics and rules (js/physics.js,
// js/rules.js), the authored levels and generators (js/levels.js,
// js/content.js) and the round session (js/session.js) are the browser
// build's, unchanged; this module is what js/main.js and js/input.js did
// around them — the state machine (title → mode screens → preparing →
// countdown → active ⇄ paused → resolving → results → next), the 120 Hz
// simulation on the runtime's fixed steps (the countdown and the resolve
// delay counted in steps too, so a round replays exactly), every mode
// (Learn, Journey, Daily, Practice, Challenge, Score Chase), the player's
// actions (taps and swipes on the board, the action mirror, the keyboard's
// target cycling, pads), undo, hints, restart, skip, the lesson coach, the
// results with progress, achievements and the score post, and the lifecycle
// (a hidden window pauses the round, as visibilitychange did). Screens are
// drawn by screens.ts (starhermit:ui), the room by render.ts (starhermit:scene).
import { clipboard, frame, onPreferencesChange, onRender, onStart, onSuspend, onResume, onFixedUpdate, onUpdate, preferences, setFixedRate } from "starhermit:engine";
import { onAction, onPointerButton, onPointerMove, onTouch, vibrate } from "starhermit:input";
import * as ui from "starhermit:ui";
import { fonts } from "starhermit:canvas";
import { onSessionEnded, requestSignIn } from "starhermit:platform";
import { Content, Levels, Rules, SaveModel, SessionClass, type Action, type GameEvent, type Level, type Score, type Session } from "./game.ts";
import * as audio from "./audio.ts";
import { S, T, coachText } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { drawScreens } from "./screens.ts";
import { applyTokens, initStyles } from "./style.ts";

export type Screen = "title" | "journey" | "challenges" | "practice" | "scores" | "settings" | "help" | "pause" | "results" | null;
export type Phase = "title" | "countdown" | "active" | "paused" | "resolving" | "results";
export interface Results {
  score: Score & { reason: string | null }; level: Level; won: boolean; achievements: string[];
  nextLabel: string | null; savedLocal: boolean; lb: { key: string; vars?: Record<string, string | number> } | null;
}
export interface BoardData { entries?: platform.Entry[]; error?: boolean; local?: { total: number; levelId: string; delivered: boolean }[] }

const TICK_RATE = Rules.TICK_RATE;
export const app = {
  phase: "title" as Phase,
  screen: "title" as Screen,
  openedFrame: 0,
  focusNext: null as string | null,
  settingsFromPause: false,
  session: null as Session | null,
  level: null as Level | null,
  mode: "journey",
  prevTreat: { x: 0, y: 0 },
  countdown: null as number | null,
  cdIndex: 0,
  cdTicks: 0,
  resolveTicks: 0,
  focusIndex: 0,
  coachIdx: -1,
  coach: null as { text: string; hint: string | null } | null,
  results: null as Results | null,
  nextTarget: null as Level | null,
  boards: {} as Record<string, BoardData | null>,
  board: "global",
  toasts: [] as { text: string; until: number }[],
  tip: null as { text: string; x: number; y: number; until: number } | null,
};
export const fresh = (): boolean => frame().frame !== app.openedFrame;
const now = (): number => frame().time;

// ------------------------------------------------------------------ helpers
const spoken: string[] = [];
/** ui.announce: one announcement a frame, joined (the old aria-live region). */
export function announce(text: string): void { if (text) spoken.push(text); }
function flushAnnouncements(): void {
  if (!spoken.length) return;
  const text = spoken.splice(0).join(" ").slice(0, 500);
  try { ui.announce(text); } catch { /* busy */ }
}
/** ui.js toast: 4.2 s. */
export function toast(text: string): void {
  app.toasts.push({ text, until: now() + 4.2 });
  if (app.toasts.length > 3) app.toasts.shift();
  announce(text);
}
const pending: (() => void)[] = [];
/** A widget's press, run once the frame's UI is built (state changes mid-build would break later widgets). */
export function later(fn: () => void): void { pending.push(fn); }
function haptic(ms: number): void { try { vibrate(ms); } catch { /* none */ } }
const reducedMotion = (): boolean => preferences().reducedMotion;

export function open(s: Screen, focus: string | null = null): void {
  app.screen = s;
  app.openedFrame = frame().frame;
  app.focusNext = focus;
  ui.setFocus(null);
}
export function closeScreen(): void { app.screen = null; app.openedFrame = frame().frame; ui.setFocus(null); }

// ------------------------------------------------------------------ navigation (main.js goTitle / startMode)
export function goTitle(): void {
  app.phase = "title";
  app.session = null;
  app.level = null;
  app.coach = null;
  app.countdown = null;
  app.results = null;
  app.tip = null;
  audio.stopMusic();
  render.clearLevel();
  open("title");
}
function dateKey(): string { return platform.now().toISOString().slice(0, 10); }
export function startMode(mode: string, arg?: string): void {
  audio.start();
  const progress = platform.progress();
  let level: Level | null = null;
  let ranked = false;
  switch (mode) {
    case "journey":
      level = arg ? Levels.levelById(arg) : Levels.LEVELS.find((l) => !progress.levels[l.id]?.completed) ?? Levels.LEVELS[0]!;
      break;
    case "learn":
      level = arg ? Levels.levelById(arg) : Levels.TUTORIALS.find((t) => !progress.tutorialsDone.includes(t.id)) ?? Levels.TUTORIALS[0]!;
      break;
    case "daily":
      level = Content.generateDailyLevel(dateKey());
      ranked = true;
      if (!level) { toast(T("dailyUnavailable")); return; }
      break;
    case "practice":
      if (!arg) { open("practice"); return; }
      level = Content.generatePracticeLevel(arg, Math.floor(Math.random() * 1e9));
      if (!level) { toast(T("practiceFailed")); return; }
      break;
    case "challenge":
      if (!arg) { open("challenges"); return; }
      level = Levels.levelById(arg);
      ranked = true;
      break;
    default: return;
  }
  if (!level) { toast(T("stageNotFound")); return; }
  app.mode = mode;
  startRound(level, ranked);
}
/** main.js startRound: preparing → countdown → active. */
export function startRound(level: Level, ranked: boolean): void {
  const s = new SessionClass(level, { mode: app.mode, ranked, roundId: app.mode + "-" + level.id + "-" + platform.now().toISOString() });
  app.session = s;
  app.level = level;
  app.prevTreat = { x: s.state.treat.x, y: s.state.treat.y };
  app.coachIdx = -1;
  app.coach = null;
  app.results = null;
  app.tip = null;
  app.focusIndex = 0;
  const theme = Content.THEMES[level.theme] ?? Content.THEMES.gumdrop!;
  render.clearFx();
  render.buildLevel(s.state, theme, platform.progress().cosmetics);
  audio.startMusic(theme.ambience.base);
  closeScreen();
  refreshBoard();
  app.phase = "countdown";
  app.cdIndex = 0;
  countdownStep();
}
const cdSteps = (): number[] => (reducedMotion() ? [0] : [3, 2, 1, 0]);
function countdownStep(): void {
  const steps = cdSteps();
  if (app.cdIndex < steps.length) {
    const n = steps[app.cdIndex]!;
    app.countdown = n;
    announce(n === 0 ? T("go") : String(n));
    app.cdIndex++;
    app.cdTicks = Math.round((steps.length === 1 ? 0.4 : 0.65) * TICK_RATE);
  } else {
    app.countdown = null;
    app.phase = "active";
    announce(T("announceObjective"));
    if (app.session?.tutorialStep()) showCoachStep();
  }
}

function showCoachStep(): void {
  const s = app.session, lvl = app.level;
  const st = s?.tutorialStep();
  if (!s || !lvl || !st) { app.coach = null; return; }
  const kinds: Record<string, string> = { rope: "kindRope", star: "kindStar", bubble: "kindBubble", fan: "kindFan" };
  const kind = st.highlight ? kinds[st.highlight.kind] : undefined;
  const hint = st.highlight ? T("watchHighlight", { kind: kind ? T(kind) : st.highlight.kind }) : null;
  const text = coachText(lvl.id, s.tutorialIndex, st.text);
  app.coach = { text, hint };
  announce(text);
  if (st.highlight?.id) render.setHighlight(st.highlight.kind, st.highlight.id, "hint");
}
function trackTutorial(): void {
  if (!app.level?.tutorial || !app.session) return;
  const idx = app.session.tutorialIndex;
  if (idx !== app.coachIdx) { app.coachIdx = idx; showCoachStep(); refreshBoard(); }
}
/** main.js refreshBoard: keep the keyboard focus inside the (shrinking) action list and mark the legal targets. */
export function refreshBoard(): void {
  const s = app.session;
  if (!s) return;
  const actions = s.legalActions();
  if (app.focusIndex >= actions.length) app.focusIndex = 0;
  render.setLegalTargets(actions, s.state);
}
export function legalActions(): Action[] { return app.session ? app.session.legalActions() : []; }

// ------------------------------------------------------------------ the simulation (main.js frame: 120 Hz fixed steps)
function handleEvents(events: GameEvent[]): void {
  audio.playEvents(events);
  render.handleEvents(events);
  const s = app.session!;
  for (const ev of events) {
    if (ev.type === "star") {
      const got = s.state.stars.filter((x) => x.got).length;
      announce(T("starCollected", { n: got, total: s.state.stars.length }));
      haptic(15);
    } else if (ev.type === "terminal") onTerminal();
  }
  refreshBoard();
}
onFixedUpdate(() => {
  const s = app.session;
  if (!s) return;
  if (app.phase === "countdown") { if (--app.cdTicks <= 0) countdownStep(); return; }
  if (app.phase === "resolving") { if (--app.resolveTicks <= 0) finishRound(); return; }
  if (app.phase !== "active") return;
  app.prevTreat = { x: s.state.treat.x, y: s.state.treat.y };
  const ev = s.stepOnce();
  if (ev.length) handleEvents(ev);
  trackTutorial();
});

// ------------------------------------------------------------------ player actions (main.js doAction …)
const ERR: Record<string, string> = {
  "not-yet": "errNotYet", "already-cut": "errAlreadyCut", "already-popped": "errAlreadyPopped",
  "move-limit": "errMoveLimit", "not-active": "errNotActive", "disabled-action": "errDisabled",
};
export function doAction(type: string, id: string, on?: boolean): void {
  const s = app.session;
  if (app.phase !== "active" || !s) return;
  const before = s.tutorialIndex;
  const res = s.dispatch(type, id, on);
  if (!res.ok) {
    audio.errorBuzz();
    const key = ERR[res.reason ?? ""];
    announce(key ? T(key) : T("errOther", { reason: res.reason ?? "" }));
    render.shake();
    return;
  }
  haptic(20);
  if (res.events.length) { audio.playEvents(res.events); render.handleEvents(res.events); }
  if (s.tutorialIndex !== before) trackTutorial();
  refreshBoard();
}
export function undo(): void {
  const s = app.session;
  if (!s || !s.canUndo()) { announce(T("nothingToUndo")); return; }
  s.undo();
  app.prevTreat = { x: s.state.treat.x, y: s.state.treat.y };
  announce(T("undone"));
  refreshBoard();
}
export function hint(): void {
  const s = app.session;
  if (!s || app.phase !== "active") return;
  const h = s.hint();
  if (!h) { announce(T("noHint")); return; }
  render.setHighlight(h.action.type === "cut" ? "rope" : h.action.type, h.action.id, "hint");
  const key = h.action.type === "cut" ? "hintSnip" : h.action.type === "pop" ? "hintPop" : "hintFan";
  announce(T(key, { id: h.action.id }) + (h.authored ? "" : T("hintGuess")));
}
export function restart(): void {
  if (!app.session || !app.level) return;
  app.coachIdx = -1;
  startRound(app.level, app.session.ranked);
}
export function cameraReset(): void { render.cameraReset(); }
export function pauseToggle(): void {
  if (app.phase === "active") {
    app.phase = "paused";
    open("pause");
    announce(T("announcePaused"));
  } else if (app.phase === "paused") resume();
}
export function resume(): void {
  if (app.phase !== "paused") return;
  app.phase = "active";
  app.settingsFromPause = false;
  closeScreen();
  announce(T("announceResumed"));
}
/** Skip / fast-forward: settle instantly to the deterministic end state. */
export function skip(): void {
  const s = app.session;
  if (!s || app.phase !== "active") return;
  s.settle();
  app.prevTreat = { x: s.state.treat.x, y: s.state.treat.y };
  if (s.state.status !== Rules.STATUS.ACTIVE) onTerminal();
}
/** input.js cycleFocus. */
export function cycleFocus(dir: number): void {
  const actions = legalActions();
  if (!actions.length) return;
  app.focusIndex = ((app.focusIndex + dir) % actions.length + actions.length) % actions.length;
  const a = actions[app.focusIndex]!;
  render.setHighlight(a.type === "cut" ? "rope" : a.type, a.id, "focus");
  announce(T("focusedAction", { action: actionLabel(a) }));
}
function confirmFocus(): void {
  const actions = legalActions();
  const a = actions[app.focusIndex % Math.max(1, actions.length)];
  if (a) doAction(a.type, a.id, a.on);
}
export function actionLabel(a: Action): string {
  if (a.type === "cut") return T("actSnip", { id: a.id });
  if (a.type === "pop") return T("actPop", { id: a.id });
  return T(a.on ? "actFanOn" : "actFanOff", { id: a.id });
}

// ------------------------------------------------------------------ resolving → results → progression
function onTerminal(): void {
  if (app.phase === "resolving" || app.phase === "results") return;
  app.phase = "resolving";
  app.resolveTicks = Math.round((reducedMotion() ? 0.3 : 1.3) * TICK_RATE);
}
function finishRound(): void {
  const s = app.session, level = app.level;
  if (!s || !level || app.phase !== "resolving") return;
  app.phase = "results";
  const score = s.score();
  const won = score.delivered;
  const progress = platform.progress();
  const mode = app.mode;
  if (mode === "journey" || mode === "challenge") {
    SaveModel.recordLevelResult(progress, level.id, { completed: won, stars: score.stars, score: score.total });
    if (won) progress.lastLevel = level.id;
  }
  if (mode === "learn" && won && !progress.tutorialsDone.includes(level.id)) progress.tutorialsDone.push(level.id);
  if (mode === "daily") {
    const day = level.id.replace("daily-", "");
    if (!progress.dailyDays.includes(day)) progress.dailyDays.push(day);
  }
  const achievements: string[] = [];
  for (const key of Content.checkAchievements(progress, Levels.LEVELS)) { achievements.push(key); progress.achievements.push(key); }
  let savedLocal = false;
  if (s.ranked) {
    SaveModel.recordLocalScore(progress, { total: score.total, delivered: won, levelId: level.id, at: Date.now() });
    savedLocal = true;
  }
  platform.persist();
  let nextLabel: string | null = null;
  app.nextTarget = null;
  const list = mode === "learn" ? Levels.TUTORIALS : mode === "journey" ? Levels.LEVELS : null;
  const idx = list ? list.findIndex((l) => l.id === level.id) : -1;
  if (list && idx >= 0 && idx + 1 < list.length && (mode === "learn" || won)) {
    nextLabel = mode === "learn" ? "nextLesson" : "nextStage";
    app.nextTarget = list[idx + 1]!;
  }
  const r: Results = { score: { ...score, reason: s.state.reason }, level, won, achievements, nextLabel, savedLocal, lb: null };
  app.results = r;
  // Signed in: Journey, Daily and Challenge rounds post their total to the high-score board; the results show the rank.
  if (platform.signedIn() && ["journey", "daily", "challenge"].includes(mode)) {
    r.lb = { key: "lbPosting" };
    void platform.postScore(score.total).then((p) => {
      r.lb = !p.posted ? { key: "lbNotPosted" } : p.rank ? { key: "lbRank", vars: { rank: p.rank } } : { key: "lbPosted" };
      announce(S(r.lb.key, r.lb.vars));
    });
  }
  app.coach = null;
  render.setHighlight(null, null);
  announce(T(won ? "announceWon" : "announceLost", { total: score.total, stars: score.stars }));
  open("results", nextLabel ? "btn-next" : "btn-retry");
}
export function next(): void {
  if (app.nextTarget && app.session) startRound(app.nextTarget, app.session.ranked);
  else goTitle();
}

// ------------------------------------------------------------------ score chase
export function showScores(board = "global"): void {
  app.board = board;
  if (app.screen !== "scores") open("scores");
  if (app.boards[board] === undefined) {
    app.boards[board] = null;
    const local = platform.progress().board;
    if (!platform.signedIn()) { app.boards[board] = { error: true, local }; return; }
    void platform.fetchBoard(board).then((entries) => { app.boards[board] = entries === null ? { error: true, local } : { entries }; });
  }
}

// ------------------------------------------------------------------ account
export function signIn(): void { void requestSignIn().catch(() => undefined); }
export function invite(): void {
  const link = platform.inviteLink();
  if (!link) return;
  try { clipboard.writeText(link); toast(S("copied")); } catch { toast(S("copyFail", { url: link })); }
}
export function resetTutorials(): void {
  platform.progress().tutorialsDone = [];
  platform.persist();
  toast(T("tutorialsReset"));
}

// ------------------------------------------------------------------ keys and pads (input.js _bindKeyboard / _pollPad)
onAction((e) => {
  if (!e.pressed || ui.capturingKeys()) return;
  const a = e.action;
  const inRound = app.phase === "active" && app.screen === null;
  if (a === "pause") {
    if (!fresh()) return;
    if (app.phase === "active" || app.phase === "paused") later(pauseToggle);
    return;
  }
  if (a === "restart") { if (app.session && (inRound || app.screen === "results")) later(restart); return; }
  if (!inRound) return;
  switch (a) {
    case "prev": ui.setFocus(null); later(() => cycleFocus(-1)); break;
    case "next": ui.setFocus(null); later(() => cycleFocus(1)); break;
    // a focused button owns Enter and Space (the action the player chose)
    case "confirm": if (ui.focused() === null) later(confirmFocus); break;
    case "undo": later(undo); break;
    case "hint": later(hint); break;
    case "camera": later(cameraReset); break;
  }
});

// ------------------------------------------------------------------ pointer and touch on the board (input.js _bindPointer)
const TAP_MAX_DIST = 12, TAP_MAX_TIME = 0.4;
const ACTION_OF: Record<string, string> = { rope: "cut", bubble: "pop", fan: "fan" };
type PEv = { kind: "down" | "move" | "up"; x: number; y: number; ui: boolean; touch: boolean };
const queue: PEv[] = [];
let down: { x: number; y: number; t: number; sx: number; sy: number } | null = null;
let lastTouch = -1e9;
onTouch((e) => {
  lastTouch = now();
  if (e.control || !e.primary) return;
  if (e.phase === "start") { audio.start(); queue.push({ kind: "down", x: e.x, y: e.y, ui: ui.pointerCaptured(), touch: true }); }
  else if (e.phase === "move") queue.push({ kind: "move", x: e.x, y: e.y, ui: false, touch: true });
  else queue.push({ kind: "up", x: e.x, y: e.y, ui: false, touch: true });
});
onPointerButton((e) => {
  if (e.button !== 0 || now() - lastTouch < 0.6) return;
  if (e.pressed) audio.start();
  queue.push({ kind: e.pressed ? "down" : "up", x: e.x, y: e.y, ui: e.pressed && ui.pointerCaptured(), touch: false });
});
onPointerMove((x, y) => { if (now() - lastTouch >= 0.6) queue.push({ kind: "move", x, y, ui: false, touch: false }); });

function invalidReason(type: string, id: string): string | null {
  const st = app.session!.state;
  if (st.disabledActions.includes(type)) return T("errDisabled");
  if (type === "cut") { const r = st.ropes.find((x) => x.id === id); if (r && r.cut) return T("errAlreadyCut"); }
  if (type === "pop") {
    const b = st.bubbles.find((x) => x.id === id);
    if (b && b.state === 2) return T("errAlreadyPopped");
    if (b && b.state === 0) return T("errNothingToPop");
  }
  if (st.moveLimit && st.actionsUsed >= st.moveLimit) return T("errMoveLimit");
  return null;
}
function showTip(text: string, x: number, y: number): void {
  app.tip = { text, x, y: y - 30 * frame().scale, until: now() + 2.2 };
  announce(text);
}
function tap(x: number, y: number): void {
  const s = app.session!;
  const hit = render.pick(x, y);
  if (!hit) return;
  const type = ACTION_OF[hit.kind]!;
  const legal = s.legalActions().find((a) => a.type === type && a.id === hit.id);
  if (legal) { doAction(legal.type, legal.id, legal.on); return; }
  if (s.gatedByTutorial({ type, id: hit.id })) { showTip(T("errNotYet"), x, y); audio.errorBuzz(); return; }
  const reason = invalidReason(type, hit.id);
  if (reason) { showTip(reason, x, y); audio.errorBuzz(); render.shake(); }
}
function trySwipe(a: { x: number; y: number }, b: { x: number; y: number }, x: number, y: number): void {
  const s = app.session!;
  const id = render.swipeCutsRope(s.state, a.x, a.y, b.x, b.y);
  if (!id) return;
  const legal = s.legalActions().find((l) => l.type === "cut" && l.id === id);
  if (legal) doAction("cut", id);
  else if (s.gatedByTutorial({ type: "cut", id })) showTip(T("errNotYet"), x, y);
}
function pointerInput(wasActive: boolean): void {
  const list = queue.splice(0);
  for (const p of list) {
    const active = wasActive && app.phase === "active" && app.screen === null && !!app.session;
    if (!active) { down = null; continue; }
    const sc = frame().scale;
    if (p.kind === "down") {
      down = null;
      if (p.ui) continue;
      down = { x: p.x, y: p.y, t: now(), sx: p.x, sy: p.y };
      ui.setFocus(null);
    } else if (p.kind === "move") {
      if (down) {
        if (Math.hypot(p.x - down.x, p.y - down.y) / sc > TAP_MAX_DIST) {
          // a swipe: check rope crossings continuously
          const a = render.toWorld(down.x, down.y), b = render.toWorld(p.x, p.y);
          if (a && b) trySwipe(a, b, p.x, p.y);
          down = { ...down, x: p.x, y: p.y };
        }
      } else if (!p.touch) {
        // hover preview on legal targets
        const hit = render.pick(p.x, p.y);
        const legal = hit && legalActions().some((a) => a.type === ACTION_OF[hit.kind] && a.id === hit.id);
        const h = render.highlight();
        if (legal) render.setHighlight(hit!.kind, hit!.id, "focus");
        else if (h && h.style === "focus") render.setHighlight(null, null);
      }
    } else {
      if (down && Math.hypot(p.x - down.sx, p.y - down.sy) / sc <= TAP_MAX_DIST && now() - down.t <= TAP_MAX_TIME) tap(p.x, p.y);
      down = null;
    }
  }
}

// ------------------------------------------------------------------ boot and lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const k = `${f.quality}:${f.levelIndex}`;
  if (k === lookKey) return;
  lookKey = k;
  render.applyLook(lookFor(f.quality, f.levelIndex));
}
onStart(async () => {
  setFixedRate(TICK_RATE);
  initStyles();
  platform.initPlatform();
  render.setReducedMotion(preferences().reducedMotion);
  applyLook();
  // the target glyphs (✂ ◯ ➤) are baked into canvas textures: wait for their font
  try { await fonts.load("44px sans-serif", "✂◯➤"); } catch { /* drawn with what there is */ }
  goTitle();
});
onPreferencesChange((p) => render.setReducedMotion(p.reducedMotion));
platform.onProgressMerged(() => toast(T("progressMerged")));
onSessionEnded(() => toast(S("signedOut")));
onSuspend(() => {
  // backgrounding auto-pauses solo play
  if (app.phase === "active") pauseToggle();
  audio.setSuspended(true);
  platform.flush();
});
onResume(() => audio.setSuspended(false));

let frameDt = 0;
onUpdate((dt) => {
  frameDt = dt;
  applyLook();
  applyTokens(ui.preferences().highContrast);
  audio.update(dt);
  const t = now();
  app.toasts = app.toasts.filter((x) => x.until >= t);
  if (app.tip && app.tip.until < t) app.tip = null;
});
onRender((alpha) => {
  const wasActive = app.phase === "active" && app.screen === null;
  drawScreens();
  for (const fn of pending.splice(0)) fn();
  pointerInput(wasActive);
  const s = app.session;
  if (s) render.update(s.state, app.prevTreat, app.phase === "active" ? alpha : 1, frameDt);
  flushAnnouncements();
});
