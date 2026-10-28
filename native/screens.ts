// The browser build's DOM shell (js/ui.js over css/style.css) as
// starhermit:ui, built every frame: the header (title, the player's name and
// cloud-sync state, total stars), the page around the board's box, the HUD
// over the board (objective and stats on the dark gradient), the lesson
// coach, the invalid-tap tooltip, the action bar (Undo, Hint, Restart, Skip,
// Pause) and the action mirror (a button per legal action, the keyboard's
// focused one ringed), the countdown, the toasts, and the screens (title,
// Journey map, Challenges, Practice, Score Chase, Settings, Help, Results,
// Pause). The old media queries are layouts picked by the window's logical
// size: three columns from 1024 px wide (board, actions rail), stacked below
// (the rails under the board, square in portrait, 4:3 sideways), and short
// landscape (≤ 500 px tall: the board the full height, the rails a scrolling
// column beside it). The board's box goes to render.ts as a window rectangle.
import { frame, openMenu } from "starhermit:engine";
import { bindings, primaryPointer, requestRebind } from "starhermit:input";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { Content, Levels, type Level } from "./game.ts";
import { S, T, levelName, playerName, tn } from "./i18n.ts";
import * as platform from "./platform.ts";
import * as render from "./render.ts";
import { token } from "./style.ts";
import {
  actionLabel, app, closeScreen, doAction, fresh, goTitle, hint, invite, later, legalActions, next, open, pauseToggle, resetTutorials,
  restart, resume, showScores, signIn, skip, startMode, undo, type Screen,
} from "./main.ts";

// ------------------------------------------------------------------ layout (css/style.css)
interface Layout {
  lw: number; lh: number; sc: number; ox: number; oy: number; wide: boolean; short: boolean; phone: boolean;
  header: number; board: { x: number; y: number; w: number; h: number }; rail: { x: number; y: number; w: number; h: number | null };
}
const lastSize = new Map<string, ui.Rect>();
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  const wide = lw >= 1024, short = !wide && lh <= 500 && lw > lh;
  const header = short ? 36 : 44;
  const pad = short ? 6.4 : 12, gap = short ? 8 : 12;
  const mainW = Math.min(lw, 1500), mx = (lw - mainW) / 2;
  const top = header + pad, availH = lh - header - 2 * pad;
  let board, rail;
  if (wide) {
    const rw = 280;
    // grid-template-columns: auto 1fr minmax(220px, 280px): the empty objective rail still takes its gap
    board = { x: mx + pad + gap, y: top, w: mainW - 2 * pad - 2 * gap - rw, h: Math.max(200, availH) };
    rail = { x: mx + pad + gap + board.w + gap, y: top, w: rw, h: null };
  } else if (short) {
    const rw = mainW - 2 * pad - gap - 280 >= 260 ? 280 : 200;
    board = { x: mx + pad, y: top, w: mainW - 2 * pad - gap - rw, h: Math.max(120, availH) };
    rail = { x: mx + pad + board.w + gap, y: top, w: rw, h: availH };
  } else {
    const w = mainW - 2 * pad;
    const railH = (lastSize.get("rail")?.height ?? 120 * sc) / sc;
    const want = lw <= lh ? w : (w * 3) / 4;
    const h = Math.max(160, Math.min(want, availH - gap - railH));
    const left = platform.options.leftHanded;
    board = { x: mx + pad, y: left ? top + railH + gap : top, w, h };
    rail = { x: mx + pad, y: left ? top : top + h + gap, w, h: null };
  }
  return { lw, lh, sc, ox: sa.left, oy: sa.top, wide, short, phone: lw <= 480, header, board, rail };
}
function textWidth(text: string, style: string, kind?: "button"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style: [style] }).width / ui.preferences().scale;
}
/** Text up to `width` wide: one label when it fits, else a paragraph. */
function para(text: string, width: number, cls = "text", id?: string, color?: string): void {
  if (!text) return;
  const st = color ? ui.style(cls, { text: { color } }) : ui.style(cls);
  const u = id ? st.id(id) : st;
  if (textWidth(text, cls) <= width) u.label(text);
  else u.paragraph(text, Math.max(20, width));
}
interface Btn { id: string; text: string; style?: string; act: () => void; disabled?: boolean; selected?: boolean; width?: number; name?: string }
const buttonWidth = (text: string, style: string): number => textWidth(text, style, "button") + 2;
function button(b: Btn): void {
  const style = b.style ?? "btn";
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  if (b.selected !== undefined) opts.selected = b.selected;
  const s: ui.Style = {};
  if (b.width != null) {
    s.width = b.width;
    if (buttonWidth(b.text, style) > b.width) {
      const inner = b.width - (style.startsWith("btn-sm") ? 32 : 40);
      opts.content = () => { ui.style("wrap").paragraph(b.text, Math.max(20, inner)); };
    }
  }
  if (b.name && !opts.content) opts.content = () => { ui.style(style + "-face").label(b.text); };
  if (ui.style(style, s).id(b.id).button(b.name ?? b.text, opts) && fresh()) later(b.act);
}
/** .tt-row: buttons at their own widths in rows that wrap at `width` (gap 8). */
function flow(label: string, list: Btn[], width: number, gap = 8): ui.Rect {
  const rows: Btn[][] = [[]];
  let used = 0;
  const bw = (b: Btn): number => Math.min(width, b.width ?? buttonWidth(b.text, b.style ?? "btn"));
  for (const b of list) {
    const w = bw(b);
    if (rows[rows.length - 1]!.length && used + gap + w > width) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gap : 0) + w;
    rows[rows.length - 1]!.push(b);
  }
  return ui.column(label, () => {
    rows.forEach((row, ri) => ui.row(`${label}-r${ri}`, () => { for (const b of row) button({ ...b, width: bw(b) }); }, { spacing: gap, align: "center" }));
  }, { spacing: gap, width });
}

// ------------------------------------------------------------------ the frame
export function drawScreens(): void {
  const L = layoutNow();
  const f = frame();
  const inRound = !!app.session && app.phase !== "title";
  const b = L.board;
  const px = (x: number): number => L.ox + x * L.sc, py = (y: number): number => L.oy + y * L.sc;
  // the page (.tt-main on body's --bg) around the board's box
  const bg = token("bg");
  if (inRound) {
    const x0 = px(b.x), y0 = py(b.y), x1 = px(b.x + b.w), y1 = py(b.y + b.h);
    draw.rect(0, 0, f.width, y0, bg);
    draw.rect(0, y1, f.width, f.height - y1, bg);
    draw.rect(0, y0, x0, y1 - y0, bg);
    draw.rect(x1, y0, f.width - x1, y1 - y0, bg);
    render.setField({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, f.width, f.height);
  } else {
    draw.rect(0, 0, f.width, f.height, bg);
    render.setField(null, f.width, f.height);
  }
  render.setPixelScale(L.sc);
  header(L);
  if (inRound) { hud(L); rails(L); }
  if (app.countdown !== null) countdown(L);
  overlay(L);
  if (app.tip) tooltip(L);
  toasts(L);
  if (app.focusNext && primaryPointer() !== "coarse") {
    const age = f.frame - app.openedFrame;
    if (age >= 1) ui.setFocus(app.focusNext);
    if (age >= 3) app.focusNext = null;
  } else app.focusNext = null;
}

function syncText(): { text: string; error: boolean } {
  const st = platform.syncState();
  const key = { offline: "syncOffline", loading: "syncLoading", saving: "syncSaving", synced: "syncSynced", error: "syncError" }[st];
  return { text: T(key), error: st === "error" };
}
/** .tt-header: the title at the start; the player's name, the sync state and the total stars at the end. */
function header(L: Layout): void {
  ui.place("header", { x: 0, y: 0 }, () => {
    ui.row("header-row", () => {
      ui.style("header-title").id("header-title").label("Tether Treat");
      ui.spacer();
      if (platform.signedIn()) {
        const name = platform.displayName();
        if (name) ui.style("header-name").id("header-name").label(playerName(name));
      }
      const sync = syncText();
      ui.style(sync.error ? "header-sync-error" : "header-sync").id("header-sync").label(sync.text);
      ui.style("header-stars").id("header-stars").label("★ " + platform.progress().totalStars);
    }, { style: "header", width: L.lw, height: L.header, align: "center", spacing: L.phone ? 10 : 12 });
  });
}

// ------------------------------------------------------------------ the round: HUD, coach, rails
function hud(L: Layout): void {
  const s = app.session!, b = L.board, st = s.state;
  if (app.phase !== "results" && app.phase !== "resolving") {
    const parts: string[] = [];
    const got = st.stars.filter((x) => x.got).length;
    parts.push(T("hudStars", { got, total: st.stars.length }));
    if (st.moveLimit) parts.push(T("movesLeft", { n: Math.max(0, st.moveLimit - st.actionsUsed) }));
    else parts.push(st.parActions ? T("actionsPar", { n: st.actionsUsed, par: st.parActions }) : T("actionsUsed", { n: st.actionsUsed }));
    if (st.timeLimitTicks) parts.push(T("timeLeft", { s: Math.max(0, (st.timeLimitTicks - st.tick) / 120).toFixed(1) }));
    let obj = T("objective");
    if (st.requireStars) obj += T("objectiveStars", { n: st.requireStars });
    if (s.level.mastery) obj += T("objectiveMastery");
    const iw = b.w - 24;
    ui.place("hud", { x: b.x, y: b.y }, () => {
      ui.column("hud-col", () => {
        para(obj, Math.min(iw, 600), "hud-objective", "hud-objective");
        para(parts.join(" · "), iw, "hud-stats", "hud-stats");
      }, { style: "hud", width: b.w, spacing: 2 });
    });
  }
  if (app.coach && app.phase === "active") {
    const c = app.coach;
    const w = Math.min(b.w - 24, 600);
    const h = (lastSize.get("coach")?.height ?? 80 * L.sc) / L.sc;
    ui.place("coach", { x: b.x + 12, y: b.y + b.h - 12 - h }, () => {
      lastSize.set("coach", ui.column("coach-col", () => {
        para(c.text, w - 36, "coach-text", "coach-text");
        if (c.hint) para(c.hint, w - 36, "dim", "coach-hint");
      }, { style: "coach", width: w, spacing: 6 }));
    });
  }
}
/** The right rail: the action bar (in a round) and the action mirror. */
function rails(L: Layout): void {
  const s = app.session!, r = L.rail;
  const showBar = app.phase === "countdown" || app.phase === "active" || app.phase === "paused";
  const actions = legalActions();
  const build = (w: number): void => {
    lastSize.set("rail-in", ui.column("rail-col", () => {
      if (showBar) {
        const bar: Btn[] = [];
        if (!s.state.noUndo) bar.push({ id: "btn-undo", text: T("btnUndo"), style: "btn-sm", act: undo, disabled: !s.canUndo() });
        bar.push({ id: "btn-hint", text: T("btnHint"), style: "btn-sm", act: hint });
        bar.push({ id: "btn-restart", text: T("btnRestart"), style: "btn-sm", act: restart });
        bar.push({ id: "btn-skip", text: T("btnSkip"), style: "btn-sm-primary", act: skip });
        bar.push({ id: "btn-pause", text: T("btnPause"), style: "btn-sm", act: pauseToggle });
        flow("actionbar", bar, w);
      }
      if (!actions.length) para(T("noActions"), w, "dim", "mirror-empty");
      else {
        const list: Btn[] = actions.map((a, i) => ({
          id: `act-${a.type}-${a.id}`, text: actionLabel(a), style: "btn-sm", selected: i === app.focusIndex,
          act: () => { ui.setFocus(null); doAction(a.type, a.id, a.on); },
        }));
        flow("mirror", list, w);
      }
    }, { spacing: 12, width: w }));
  };
  ui.place("rail", { x: r.x, y: r.y }, () => {
    if (r.h != null) {
      const inner = lastSize.get("rail-in");
      const tall = !!inner && inner.height / L.sc > r.h;
      const w = r.w - (tall ? 14 : 0);
      lastSize.set("rail", tall ? ui.scrollArea("rail-scroll", { width: r.w, height: r.h }, () => build(w)) : ui.column("rail-box", () => build(w), { width: r.w }));
    } else lastSize.set("rail", ui.column("rail-box", () => build(r.w), { width: r.w }));
  });
}
function countdown(L: Layout): void {
  const f = frame();
  draw.rect(0, 0, f.width, f.height, "#120c20cc");
  const n = app.countdown!;
  const size = Math.max(64, Math.min(144, 0.18 * L.lw));
  ui.place("countdown", "center", () => {
    ui.style("countdown", { text: { size } }).id("countdown").label(n > 0 ? String(n) : T("go"));
  });
}
function tooltip(L: Layout): void {
  const t = app.tip!;
  const w = Math.min(textWidth(t.text, "tip-text") + 26, L.lw - 16);
  const sz = lastSize.get("tip");
  const h = sz ? sz.height / L.sc : 36;
  const x = Math.max(8, Math.min(L.lw - w - 8, (t.x - L.ox) / L.sc - w / 2)), y = Math.max(8, (t.y - L.oy) / L.sc - h);
  ui.place("tip", { x, y }, () => {
    lastSize.set("tip", ui.column("tip-col", () => para(t.text, w - 26, "tip-text", "tip-text"), { style: "tip", width: w }));
  });
}
function toasts(L: Layout): void {
  if (!app.toasts.length) return;
  const w = Math.min(L.lw - 32, 560);
  const where = app.screen ? { anchor: "top" as const, y: 8 } : { anchor: "bottom-end" as const, x: 16, y: 16 };
  ui.place("toast-stack", where, () => {
    ui.column("toast-col", () => {
      app.toasts.forEach((t, i) => ui.column(`toast-${i}`, () => para(t.text, w - 32, "toast-text", `toast-${i}-text`), { style: "toast" }));
    }, { spacing: 8, align: "end" });
  });
}

// ------------------------------------------------------------------ screens (.tt-screens > .tt-panel)
function overlay(L: Layout): void {
  const o = app.screen;
  if (!o) return;
  const w = Math.min(L.lw - 32, 720);
  const inner = w - (L.phone ? 32 : 48);
  const maxH = L.lh - 32;
  const key = `screen-${o}`;
  const prev = lastSize.get(key);
  const scroll = !!prev && prev.height / L.sc + 40 > maxH;
  const opening = frame().frame - app.openedFrame <= 6;
  const build = (): void => {
    ui.column("screen", () => {
      const iw = inner - (scroll ? 14 : 0);
      const body = (): void => { lastSize.set(key, ui.column(`${key}-in`, () => buildScreen(o, iw, L), { spacing: 16, width: iw })); };
      if (scroll) ui.scrollArea(`${key}-scroll`, { width: inner + 6, height: maxH - 40 }, body, opening && !app.focusNext ? { scrollTo: { top: 0 } } : undefined);
      else body();
    }, { style: "panel", width: w, spacing: 0, padding: { top: 20, bottom: 20, start: L.phone ? 16 : 24, end: L.phone ? 16 : 24 } });
  };
  const isOpen = ui.dialog(screenLabel(o), "", true, build);
  if (!isOpen && fresh()) {
    // Escape / the backdrop: back to where the screen came from
    if (o === "pause") later(resume);
    else if (o === "settings" && app.settingsFromPause) later(() => { app.settingsFromPause = false; open("pause", "btn-resume"); });
    else if (o === "journey" || o === "challenges" || o === "practice" || o === "scores" || o === "settings" || o === "help") later(goTitle);
  }
}
function screenLabel(o: NonNullable<Screen>): string {
  const k: Record<string, string> = {
    title: "scrTitle", journey: "scrJourney", challenges: "scrChallenges", practice: "scrPractice", scores: "scrLeaderboard",
    settings: "scrSettings", help: "scrHelp", results: "scrResults", pause: "scrPaused",
  };
  return T(k[o]!);
}
function buildScreen(o: NonNullable<Screen>, w: number, L: Layout): void {
  switch (o) {
    case "title": titleScreen(w); break;
    case "journey": journeyScreen(w); break;
    case "challenges": challengesScreen(w); break;
    case "practice": practiceScreen(w); break;
    case "scores": scoresScreen(w); break;
    case "settings": settingsScreen(w); break;
    case "help": helpScreen(w, L); break;
    case "results": resultsScreen(w); break;
    case "pause": pauseScreen(w); break;
  }
}
function shell(title: string, sub: string | null, w: number, id: string): void {
  ui.column(`${id}-head`, () => {
    para(title, w, "h1", `${id}-h`);
    if (sub) para(sub, w, "sub", `${id}-sub`);
  }, { spacing: 4, width: w });
}
const back = (w: number, act: () => void = goTitle, id = "btn-back"): void => { flow(`${id}-row`, [{ id, text: T("back"), style: "btn-ghost", act }], w); };

/** .tt-cardgrid: auto-fit columns of at least 200 px (gap 10), each row as tall as its tallest card. */
interface Card { id: string; title: string; lines: string[]; act: () => void; play?: boolean }
function cardGrid(label: string, items: Card[], width: number, min = 200, gap = 10): void {
  const cols = Math.max(1, Math.min(items.length, Math.floor((width + gap) / (min + gap))));
  const cw = (width - (cols - 1) * gap) / cols, faceW = cw - 35.2;
  const sc = ui.preferences().scale;
  ui.column(label, () => {
    for (let r = 0; r * cols < items.length; r++) {
      const row = items.slice(r * cols, (r + 1) * cols);
      const h = Math.max(44, ...row.map((c) => (lastSize.get(`${c.id}-face`)?.height ?? 0) / sc + 32));
      ui.row(`${label}-r${r}`, () => {
        for (const c of row) {
          const pressed = ui.style(c.play ? "card-play" : "card", { width: cw, height: h }).id(c.id).button(`${c.title}. ${c.lines.join(" ")}`, {
            content: () => {
              ui.column(`${c.id}-box`, () => {
                lastSize.set(`${c.id}-face`, ui.column(`${c.id}-face`, () => {
                  para(c.title, faceW, c.play ? "card-play-title" : "card-title");
                  c.lines.forEach((l, i) => para(l, faceW, c.play ? "card-play-desc" : "card-desc", `${c.id}-l${i}`));
                }, { spacing: 4.8, width: faceW }));
              }, { width: faceW, height: h - 32, justify: "start" });
            },
          });
          if (pressed && fresh()) later(c.act);
        }
      }, { spacing: gap });
    }
  }, { spacing: gap, width });
}

function dailyCountdown(): string {
  const n = platform.now();
  const next = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1);
  const s = Math.max(0, Math.floor((next - n.getTime()) / 1000));
  const p = (v: number): string => String(v).padStart(2, "0");
  return T("nextDrop", { time: `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}` });
}
function titleScreen(w: number): void {
  const progress = platform.progress();
  shell("Tether Treat", T("tagline"), w, "title");
  const cont = progress.lastLevel && progress.levels[progress.lastLevel] ? progress.lastLevel : null;
  const dailyLines = [dailyCountdown()];
  if (!platform.serverClock()) dailyLines.push(T("localClock"));
  cardGrid("title-cards", [
    { id: "card-journey", play: true, title: cont ? T("continueJourney") : T("playJourney"), lines: [cont ? T("continueSub") : T("playSub")], act: () => startMode("journey") },
    { id: "card-daily", title: T("dailyDrop"), lines: dailyLines, act: () => startMode("daily") },
    { id: "card-learn", title: T("learn"), lines: [progress.tutorialsDone.length ? T("lessonsDone", { n: progress.tutorialsDone.length }) : T("sixLessons")], act: () => startMode("learn") },
    { id: "card-practice", title: T("practice"), lines: [T("practiceSub")], act: () => startMode("practice") },
    { id: "card-challenge", title: T("challenge"), lines: [T("challengeSub")], act: () => startMode("challenge") },
    { id: "card-scores", title: T("scoreChase"), lines: [T("scoreChaseSub")], act: () => showScores() },
  ], w);
  const row: Btn[] = [
    { id: "btn-map", text: T("journeyMap"), act: () => open("journey") },
    { id: "btn-settings", text: T("settings"), act: () => { app.settingsFromPause = false; open("settings"); } },
    { id: "btn-help", text: T("help"), act: () => open("help") },
  ];
  if (!platform.signedIn()) row.push({ id: "btn-signin", text: S("signIn"), act: signIn });
  else if (platform.inviteLink()) row.push({ id: "btn-invite", text: S("invite"), act: invite });
  flow("title-row", row, w);
  para(T("titleStats", { n: progress.achievements.length, total: Content.ACHIEVEMENTS.length, stars: progress.totalStars }), w, "dim", "title-stats");
}

function journeyScreen(w: number): void {
  const progress = platform.progress();
  shell(T("journey"), T("journeySub"), w, "journey");
  back(w);
  const done = (id: string): boolean => !!progress.levels[id]?.completed;
  for (const wd of Levels.WORLDS) {
    const theme = Content.THEMES[wd.theme]!;
    ui.column(`world-${wd.id}`, () => {
      para(T("worldHeading", { n: wd.id, name: tn("worlds", wd.id, wd.name) }), w, "world-h", `world-${wd.id}-h`, theme.accent);
      para(tn("mechanics", wd.id, wd.mechanic), w, "dim", `world-${wd.id}-m`);
      const stages = Levels.LEVELS.filter((l) => l.world === wd.id);
      const perRow = Math.max(1, Math.floor((w + 8) / 72));
      ui.column(`stages-${wd.id}`, () => {
        for (let r = 0; r * perRow < stages.length; r++) {
          ui.row(`stages-${wd.id}-r${r}`, () => {
            stages.slice(r * perRow, (r + 1) * perRow).forEach((lv, k) => stageButton(lv, r * perRow + k, stages, wd.id, done));
          }, { spacing: 8 });
        }
      }, { spacing: 8, padding: { top: 8 } });
    }, { spacing: 4, width: w, padding: { top: 8 } });
  }
}
function stageButton(lv: Level, i: number, stages: Level[], world: number, done: (id: string) => boolean): void {
  const rec = platform.progress().levels[lv.id];
  const prevDone = i === 0
    ? (world === 1 || Levels.LEVELS.filter((l) => l.world === world - 1).every((l) => done(l.id)))
    : done(stages[i - 1]!.id);
  const locked = !prevDone && !rec?.completed;
  const completed = !!rec?.completed;
  const stars = rec ? "★".repeat(rec.stars) + "☆".repeat(Math.max(0, 3 - rec.stars)) : locked ? "🔒" : "···";
  const name = levelName(lv) + (locked ? T("locked") : "") + (lv.mastery ? T("masteryTag") : "");
  const pressed = ui.style(completed ? `stage-done-${world}` : `stage-${world}`).id(`stage-${lv.id}`).button(name, {
    disabled: locked,
    content: () => {
      ui.column(`stage-${lv.id}-face`, () => {
        ui.row(`stage-${lv.id}-top`, () => {
          ui.style(completed ? "stage-num-done" : "stage-num").label(String(i + 1));
          if (lv.mastery) ui.row(`stage-${lv.id}-tag`, () => { ui.style("stage-tag-text").label("M"); }, { style: "stage-tag", width: 20, height: 20, justify: "center", align: "center" });
        }, { spacing: 2, align: "center" });
        ui.style(completed ? "stage-stars-done" : "stage-stars").label(stars);
      }, { width: 60, align: "center", spacing: 0 });
    },
  });
  if (pressed && fresh() && !locked) later(() => startMode("journey", lv.id));
}

function challengesScreen(w: number): void {
  const progress = platform.progress();
  shell(T("challenges"), T("challengesSub"), w, "challenges");
  back(w);
  const fw = w - 32;
  ui.column("challenge-list", () => {
    for (const c of Levels.CHALLENGES) {
      const rec = progress.levels[c.id];
      const best = rec?.completed ? T("bestLine", { score: rec.bestScore, stars: "★".repeat(rec.stars) }) : T("notCleared");
      const blurb = tn("blurbs", c.id, c.blurb);
      const h = Math.max(44, (lastSize.get(`ch-${c.id}-face`)?.height ?? 60) / ui.preferences().scale + 25.6);
      const pressed = ui.style("listitem", { width: w, height: h }).id(`ch-${c.id}`).button(`${levelName(c)}. ${blurb} ${best}`, {
        content: () => {
          lastSize.set(`ch-${c.id}-face`, ui.column(`ch-${c.id}-face`, () => {
            para(levelName(c), fw, "list-title");
            para(blurb, fw, "text");
            para(best, fw, "dim");
          }, { spacing: 3.2, width: fw }));
        },
      });
      if (pressed && fresh()) later(() => startMode("challenge", c.id));
    }
  }, { spacing: 8, width: w });
}

function practiceScreen(w: number): void {
  shell(T("practice"), T("practiceSubtitle"), w, "practice");
  back(w);
  flow("practice-row", ["easy", "medium", "hard"].map((d) => ({
    id: `btn-diff-${d}`, text: T("diff" + d[0]!.toUpperCase() + d.slice(1)), act: () => startMode("practice", d),
  })), w);
}

function scoresScreen(w: number): void {
  shell(T("scoreChase"), T("scoresSub"), w, "scores");
  back(w);
  flow("score-tabs", ["global", "daily", "friends"].map((b) => ({
    id: `tab-${b}`, text: T("board" + b[0]!.toUpperCase() + b.slice(1)), style: b === app.board ? "btn-sm-primary" : "btn-sm",
    selected: b === app.board, act: () => showScores(b),
  })), w);
  const data = app.boards[app.board];
  if (!data) { para(T("loading"), w, "dim", "scores-loading"); return; }
  const lines: string[] = [];
  if (data.error) {
    para(T("boardUnavailable"), w, "dim", "scores-unavailable");
    for (const e of (data.local ?? []).slice(0, 20)) lines.push(e.total + " · " + (e.levelId || "") + (e.delivered ? T("delivered") : ""));
  } else {
    for (const e of (data.entries ?? []).slice(0, 20)) lines.push((e.name ? playerName(e.name) : T("anon")) + " — " + e.total);
    if (!data.entries?.length) para(T("noScores"), w, "dim", "scores-none");
  }
  ui.column("score-list", () => { lines.forEach((l, i) => para(`${i + 1}. ${l}`, w - 22, "text", `score-${i}`)); }, { spacing: 4.8, width: w, padding: { start: 22 } });
}

/** A check box row (a role "checkbox" widget: built-in check box labels don't wrap). */
function toggleRow(id: string, label: string, on: boolean, w: number, set: (v: boolean) => void): void {
  ui.row(`${id}-row`, () => {
    const res = ui.id(id).widget(label, {
      role: "checkbox", checked: on, size: { width: 44, height: 44 },
      draw: (r, st) => {
        const s = st.scale, box = 22 * s, bx = r.x + (r.width - box) / 2, by = r.y + (r.height - box) / 2;
        draw.roundRect(bx, by, box, box, 4, on ? token("accent") : token("panel2"));
        draw.strokeRoundRect(bx, by, box, box, 4, token("dim"), 1);
        if (on) draw.text("✓", bx + box / 2, by + 1 * s, { size: 18 * s, color: "#2b1a3d", align: "center", weight: "bold" });
        if (st.focused) draw.strokeRoundRect(bx - 4 * s, by - 4 * s, box + 8 * s, box + 8 * s, 6, token("focus-ring"), 3);
      },
    });
    para(label, w - 56, "text", `${id}-label`);
    if (res.activated && fresh()) later(() => set(!on));
  }, { width: w, align: "center", spacing: 9.6 });
}
function settingsScreen(w: number): void {
  const progress = platform.progress();
  para(T("settings"), w, "h1", "settings-h");
  para(T("settingsSub"), w, "sub", "settings-sub");
  back(w, app.settingsFromPause ? () => { app.settingsFromPause = false; open("pause", "btn-resume"); } : goTitle, "btn-settings-back");
  ui.column("settings-form", () => {
    toggleRow("chk-left", T("leftHanded"), platform.options.leftHanded, w, (v) => platform.setOption("leftHanded", v));
    const unlocked = Content.unlockedCosmetics(progress.totalStars);
    for (const slot of ["treat", "trail", "room"] as const) {
      const list = Content.COSMETICS[slot];
      const opts = list.map((c) => {
        const has = unlocked[slot]!.includes(c.id);
        return { text: tn("cosmetics", c.id, c.name) + (has ? "" : T("needsStars", { n: c.stars })), disabled: !has };
      });
      const cur = Math.max(0, list.findIndex((c) => c.id === progress.cosmetics[slot]));
      ui.column(`cos-${slot}`, () => {
        const label = T("cosmetic", { slot: T("slot" + slot[0]!.toUpperCase() + slot.slice(1)) });
        para(label, w, "text", `cos-${slot}-label`);
        const pick = ui.style("select", { width: Math.min(w, 420) }).id(`sel-${slot}`).select(label, cur, opts);
        if (pick !== cur && list[pick] && unlocked[slot]!.includes(list[pick]!.id)) {
          const id = list[pick]!.id;
          later(() => { progress.cosmetics[slot] = id; platform.persist(); });
        }
      }, { spacing: 5.6, width: w });
    }
    flow("reset-row", [{ id: "btn-reset-tut", text: T("resetTutorials"), style: "btn-ghost", act: resetTutorials }], w);
    ui.column("runtime-opts", () => {
      para(T("optRuntime"), w, "dim", "opt-runtime");
      flow("runtime-row", [
        { id: "btn-options", text: T("openOptions"), style: "btn-ghost", act: () => openMenu() },
        { id: "btn-rebind", text: T("keyBindings"), style: "btn-ghost", act: () => requestRebind() },
      ], w);
    }, { spacing: 8, width: w, padding: { top: 8 } });
  }, { spacing: 14.4, width: w, padding: { top: 8 } });
}

const GLYPH: Record<string, string> = { "Arrow Up": "↑", "Arrow Down": "↓", "Arrow Left": "←", "Arrow Right": "→", Escape: "Esc" };
function keysFor(action: string): string {
  let list: string[] = [];
  try { list = bindings(action).filter((b) => b.device === "keyboard").map((b) => GLYPH[b.label] ?? b.label); } catch { /* not yet */ }
  return [...new Set(list)].join(" / ") || "—";
}
const MECHANIC_HELP = ["helpCut", "helpStars", "helpBubble", "helpFan", "helpBumper", "helpSpikes", "helpSlider"];
function helpScreen(w: number, L: Layout): void {
  shell(T("howToPlay"), T("howToPlaySub"), w, "help");
  back(w);
  const confirm = T("gamepadA", { key: keysFor("confirm") });
  const cols = Math.max(1, Math.floor((w + 10) / 230)), cw = (w - (cols - 1) * 10) / cols;
  ui.column("help-cards", () => {
    for (let r = 0; r * cols < MECHANIC_HELP.length; r++) {
      const row = MECHANIC_HELP.slice(r * cols, (r + 1) * cols);
      const h = Math.max(...row.map((m) => (lastSize.get(`help-${m}`)?.height ?? 0) / L.sc));
      ui.row(`help-r${r}`, () => {
        for (const m of row) {
          ui.column(`help-${m}-card`, () => {
            lastSize.set(`help-${m}`, ui.column(`help-${m}`, () => {
              para(T(m), cw - 32, "h3", `help-${m}-h`);
              para(T(m + "Text", { confirm }), cw - 32, "text", `help-${m}-p`);
            }, { spacing: 4.8, width: cw - 32 }));
          }, { style: "helpcard", width: cw, ...(h > 0 ? { height: h + 25.6 } : {}) });
        }
      }, { spacing: 10 });
    }
  }, { spacing: 10, width: w });
  ui.column("controls", () => {
    para(T("controls"), w, "h3", "controls-h");
    for (const [i, line] of [
      T("ctlConfirm", { key: confirm }),
      T("ctlCycle", { prev: keysFor("prev"), next: keysFor("next") }),
      T("ctlPause", { key: keysFor("pause") }),
      T("ctlKeys", { undo: keysFor("undo"), hint: keysFor("hint"), restart: keysFor("restart"), camera: keysFor("camera") }),
      T("ctlTouch"),
    ].entries()) para("• " + line, w, "text", `ctl-${i}`);
  }, { spacing: 4.8, width: w, padding: { top: 8 } });
}

const REASON_KEY: Record<string, string> = {
  "delivered": "resultDelivered", "hazard": "reasonHazard", "out-of-bounds": "reasonOut",
  "stalled": "reasonStalled", "time-up": "reasonTime", "missing-stars": "reasonMissingStars",
};
function scoreLabel(c: { key: string; count?: number }): string {
  switch (c.key) {
    case "stars": return T("scStars", { n: c.count ?? 0 });
    case "delivery": return T("scDelivery");
    case "actions": return T("scActions", { n: c.count ?? 0 });
    case "time": return T("scTime", { n: c.count ?? 0 });
    default: return c.key;
  }
}
function resultsScreen(w: number): void {
  const r = app.results;
  if (!r) return;
  const { score, level, won } = r;
  shell(won ? T("resultDelivered") : T("tryAgain"), levelName(level), w, "results");
  if (!won) para(T(REASON_KEY[score.reason ?? ""] ?? "reasonOther"), w, "sub", "results-reason");
  const total = (level.layout.stars as unknown[] | undefined)?.length ?? 0;
  ui.style("stars-big").id("results-stars").label("★".repeat(score.stars) + "☆".repeat(Math.max(0, total - score.stars)));
  const tw = Math.min(w, 360);
  ui.column("score-table", () => {
    score.components.forEach((c, i) => ui.row(`sc-${i}`, () => {
      ui.style("score-k").label(scoreLabel(c)); ui.spacer(); ui.style("score-v").id(`sc-${i}-v`).label("+" + c.amount);
    }, { width: tw }));
    ui.row("sc-total", () => {
      ui.style("total-k").label(T("total")); ui.spacer(); ui.style("total-v").id("sc-total-v").label(String(score.total));
    }, { width: tw, style: "score-total" });
  }, { spacing: 3.2, width: tw });
  const facts: string[] = [];
  if (level.par?.actions) facts.push(T("parActions", { par: level.par.actions, used: score.actionsUsed }));
  if (level.par?.seconds) facts.push(T("parSeconds", { par: level.par.seconds, secs: (score.ticks / 120).toFixed(1) }));
  if (r.savedLocal) facts.push(T("savedLocal"));
  if (facts.length) para(facts.join(" "), w, "dim", "results-facts");
  for (const key of r.achievements) {
    const a = Content.ACHIEVEMENTS.find((x) => x.key === key);
    const text = tn<[string, string] | null>("achievements", key, a ? [a.name, a.desc] : null);
    if (text) para("🏅 " + text[0] + " — " + text[1], w, "ach", `ach-${key}`);
  }
  if (r.lb) para(S(r.lb.key, r.lb.vars), w, "dim", "results-lb");
  const row: Btn[] = [{ id: "btn-retry", text: T("retry"), act: restart }];
  if (r.nextLabel) row.push({ id: "btn-next", text: T(r.nextLabel), style: "btn-primary", act: next });
  row.push({ id: "btn-modes", text: T("modeSelect"), style: "btn-ghost", act: goTitle });
  flow("results-row", row, w);
}

function pauseScreen(w: number): void {
  shell(T("paused"), T("pausedSub"), w, "pause");
  const bw = Math.min(w, Math.max(...[T("resume"), T("restart"), T("settings"), T("quitToTitle")].map((t) => buttonWidth(t, "btn"))));
  ui.column("pause-col", () => {
    button({ id: "btn-resume", text: T("resume"), style: "btn-primary", act: resume, width: w });
    button({ id: "btn-pause-restart", text: T("restart"), act: restart, width: w });
    button({ id: "btn-pause-settings", text: T("settings"), act: () => { app.settingsFromPause = true; open("settings", "btn-settings-back"); }, width: w });
    button({ id: "btn-quit", text: T("quitToTitle"), style: "btn-ghost", act: goTitle, width: w });
  }, { spacing: 8, width: w });
  void bw;
}
export { closeScreen };
