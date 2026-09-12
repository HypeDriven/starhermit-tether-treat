// main.js — bootstrap and top-level game state machine.
//
// boot → title → mode-select → preparing → countdown → active ↔ paused →
// resolving → results → progression. The sim runs on a fixed 120 Hz
// accumulator with render interpolation; pausing stops the sim but not
// menus. Backgrounding auto-pauses. All rules mutations go through
// session.dispatch / session.stepOnce — never direct state edits.
//
// This module is import-safe in Node: every DOM touch happens inside
// boot(), which only runs when a document exists.

import { TICK_RATE, STATUS, scoreOf } from './rules.js';
import {
  THEMES, ACHIEVEMENTS, checkAchievements, generateDailyLevel, generatePracticeLevel,
} from './content.js';
import { TUTORIALS, LEVELS, CHALLENGES, levelById } from './levels.js';
import { Session } from './session.js';
import { loadSettings, saveSettings, loadProgress, saveProgress, recordLevelResult, recordLocalScore } from './storage.js';
import { AudioEngine } from './audio.js';
import {
  serverClock, fetchLeaderboard, funnelEvent,
  initPlatform, isHosted, loadNickname, loadCloudSave, scheduleCloudSave, setSyncListener,
} from './net.js';

const DT = 1 / TICK_RATE;

class App {
  constructor(ui, renderer, audio) {
    this.ui = ui;
    this.renderer = renderer;
    this.audio = audio;
    this.settings = loadSettings();
    this.progress = loadProgress();
    this.clock = null;          // {dateKey, nextDailyMs, source}
    this.session = null;
    this.phase = 'boot';
    this.acc = 0;
    this.lastTime = 0;
    this.prevTreat = { x: 0, y: 0 };
    this.mode = null;
    this.modeArg = null;
    this.boards = { global: null, daily: null, friends: null };
    this.fpsSamples = [];
    this.qualityTier = 'high';
    this._applySettings();
  }

  // -------------------------------------------------------------------------
  // Settings / persistence
  // -------------------------------------------------------------------------
  _applySettings() {
    const s = this.settings;
    document.body.classList.toggle('tt-reduced-motion', s.reducedMotion);
    document.body.classList.toggle('tt-high-contrast', s.highContrast);
    document.body.classList.toggle('tt-large-text', s.largeText);
    document.body.classList.toggle('tt-left-handed', s.leftHanded);
    if (this.renderer && this.renderer.ok) {
      this.renderer.opts.reducedMotion = s.reducedMotion;
      this.renderer.setQuality(s.quality === 'auto' ? this.qualityTier : s.quality);
    }
    this.audio.applyVolumes();
    this.ui.setTotalStars(this.progress.totalStars);
  }

  saveSettings() {
    saveSettings(this.settings);
    this._applySettings();
    funnelEvent('settings-change', {});
  }

  saveProgress() {
    saveProgress(this.progress);
    this.ui.setTotalStars(this.progress.totalStars);
    scheduleCloudSave(this.progress); // hosted: debounced cloud mirror; no-op offline
  }

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------
  /** Cancel any pending countdown / resolve timers from a previous round. */
  _clearTimers() {
    clearTimeout(this._cdTimer);
    clearTimeout(this._resolveTimer);
    this._cdTimer = null;
    this._resolveTimer = null;
  }

  goTitle() {
    this._clearTimers();
    this.phase = 'title';
    this.session = null;
    this.audio.stopMusic();
    this.ui.showHud(false);
    this.ui.showCoach(null);
    this.ui.showTitle(this.progress, this.clock);
  }

  // -------------------------------------------------------------------------
  // Mode entry points
  // -------------------------------------------------------------------------
  startMode(mode, arg) {
    this.audio.ensure();
    let level = null;
    let ranked = false;
    switch (mode) {
      case 'journey': {
        // No arg → continue at the first uncompleted stage (≤1 action to play).
        level = arg ? levelById(arg)
          : LEVELS.find((l) => !(this.progress.levels[l.id] && this.progress.levels[l.id].completed)) || LEVELS[0];
        break;
      }
      case 'learn': {
        level = arg ? levelById(arg)
          : TUTORIALS.find((t) => !this.progress.tutorialsDone.includes(t.id)) || TUTORIALS[0];
        break;
      }
      case 'daily': {
        level = generateDailyLevel(this.clock ? this.clock.dateKey : new Date().toISOString().slice(0, 10));
        ranked = true;
        if (!level) { this.ui.toast('Today\'s Daily Drop is unavailable. Try again tomorrow!'); return; }
        break;
      }
      case 'practice': {
        if (!arg) { this.ui.showPractice(); return; }
        level = generatePracticeLevel(arg, Math.floor(Math.random() * 1e9));
        if (!level) { this.ui.toast('Could not generate a practice stage — retry.'); return; }
        break;
      }
      case 'challenge': {
        if (!arg) { this.ui.showChallenges(CHALLENGES, this.progress); return; }
        level = levelById(arg);
        ranked = true;
        break;
      }
      default: return;
    }
    if (!level) { this.ui.toast('Stage not found.'); return; }
    this.mode = mode;
    this.modeArg = arg;
    this.startRound(level, { mode, ranked });
  }

  // -------------------------------------------------------------------------
  // Round lifecycle: preparing → countdown → active
  // -------------------------------------------------------------------------
  startRound(level, { mode, ranked }) {
    // A restart mid-countdown or mid-resolve must not leave the previous
    // round's timers running against the new session.
    this._clearTimers();
    this.phase = 'preparing';
    this.session = new Session(level, { mode, ranked, roundId: mode + '-' + level.id + '-' + new Date().toISOString() });
    this.prevTreat = { x: this.session.state.treat.x, y: this.session.state.treat.y };
    this.acc = 0;
    this.level = level;
    this._coachIdx = -1;

    const theme = THEMES[level.theme] || THEMES.gumdrop;
    if (this.renderer.ok) {
      this.renderer.opts.reducedMotion = this.settings.reducedMotion;
      this.renderer.buildLevel(this.session.state, theme, this.progress.cosmetics);
    } else {
      this.ui.glMessage('WebGL is unavailable, so the 3D room can\'t be drawn. Menus and the action list below still work.');
    }
    this.audio.startMusic(theme);
    this.ui.closeScreen();
    this.ui.showHud(true);
    this.ui.updateHud(this.session, level);
    this.refreshBoard();
    funnelEvent('start', { mode, levelId: level.id });

    // Countdown (short under reduced motion).
    this.phase = 'countdown';
    const steps = this.settings.reducedMotion ? ['Go!'] : ['3', '2', '1', 'Go!'];
    let i = 0;
    const tickCd = () => {
      if (this.phase !== 'countdown') return;
      if (i < steps.length) {
        this.ui.showCountdown(steps[i]);
        this.ui.announce(steps[i] === 'Go!' ? 'Go!' : steps[i]);
        i++;
        this._cdTimer = setTimeout(tickCd, steps.length === 1 ? 400 : 650);
      } else {
        this.ui.closeScreen();
        this.phase = 'active';
        this.ui.announce('Objective: deliver the treat to Morsel.');
        const st = this.session.tutorialStep();
        if (st) this.showCoachStep();
      }
    };
    tickCd();
  }

  showCoachStep() {
    const st = this.session.tutorialStep();
    if (!st) { this.ui.showCoach(null); return; }
    const hint = st.highlight ? 'Watch the highlighted ' + st.highlight.kind + '.' : null;
    this.ui.showCoach(st.text, hint);
    if (st.highlight && this.renderer.ok) {
      this.renderer.setHighlight(st.highlight.kind, st.highlight.id, 'hint');
    }
    funnelEvent('tutorial-step', { levelId: this.level.id, step: this.session.tutorialIndex });
  }

  refreshBoard() {
    if (!this.session) return;
    const actions = this.session.legalActions();
    // Keep the keyboard focus index inside the (shrinking) action list.
    if (this.input && this.input.focusIndex >= actions.length) this.input.focusIndex = 0;
    this.ui.updateMirror(actions, this.input ? this.input.focusIndex : 0);
    if (this.renderer.ok) this.renderer.setLegalTargets(actions, this.session.state);
  }

  // -------------------------------------------------------------------------
  // Fixed-timestep loop (120 Hz sim, interpolated render)
  // -------------------------------------------------------------------------
  frame(now) {
    const dt = Math.min(0.1, (now - this.lastTime) / 1000 || DT);
    this.lastTime = now;

    // Auto quality: sample frame times, step down if consistently slow.
    if (this.settings.quality === 'auto' && this.phase === 'active') {
      this.fpsSamples.push(dt);
      if (this.fpsSamples.length > 90) {
        const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
        if (avg > 0.024 && this.qualityTier !== 'low') {
          this.qualityTier = this.qualityTier === 'high' ? 'medium' : 'low';
          this.renderer.setQuality(this.qualityTier);
        }
        this.fpsSamples.length = 0;
      }
    }

    if (this.phase === 'active' && this.session) {
      this.acc += dt;
      let events = [];
      // Cap catch-up work per frame to avoid spiral of death.
      let guard = TICK_RATE / 2;
      while (this.acc >= DT && guard-- > 0) {
        this.prevTreat = { x: this.session.state.treat.x, y: this.session.state.treat.y };
        const ev = this.session.stepOnce();
        if (ev.length) events = events.concat(ev);
        this.acc -= DT;
      }
      if (events.length) this.handleEvents(events);
      // Track tutorial progression after actions too (require steps).
      this.trackTutorial();
      this.ui.updateHud(this.session, this.level);
    }

    if (this.session && this.renderer.ok) {
      const alpha = this.phase === 'active' ? Math.min(1, this.acc / DT) : 1;
      this.renderer.update(this.session.state, this.prevTreat, alpha, dt);
    }
  }

  trackTutorial() {
    if (!this.level || !this.level.tutorial) return;
    const idx = this.session.tutorialIndex;
    if (idx !== this._coachIdx) {
      this._coachIdx = idx;
      this.showCoachStep();
      this.refreshBoard();
    }
  }

  handleEvents(events) {
    this.audio.playEvents(events);
    if (this.renderer.ok) this.renderer.handleEvents(events, this.session.state);
    for (const ev of events) {
      if (ev.type === 'star') {
        const got = this.session.state.stars.filter((s) => s.got).length;
        this.ui.announce('Star collected! ' + got + ' of ' + this.session.state.stars.length + '.');
      } else if (ev.type === 'terminal') {
        this.onTerminal(ev);
      }
    }
    this.refreshBoard();
  }

  // -------------------------------------------------------------------------
  // Player actions (called by input.js and the DOM mirror)
  // -------------------------------------------------------------------------
  doAction(type, id, on) {
    if (this.phase !== 'active' || !this.session) return;
    const before = this.session.tutorialIndex;
    const res = this.session.dispatch(type, id, on);
    if (!res.ok) {
      this.audio.errorBuzz();
      const msg = {
        'not-yet': 'Not yet — follow the lesson step.',
        'already-cut': 'Already cut.', 'already-popped': 'Already popped.',
        'move-limit': 'No moves left.', 'not-active': 'The round is over.',
        'disabled-action': 'That action is disabled in this challenge.',
      }[res.reason] || ('Can\'t do that: ' + res.reason);
      this.ui.announce(msg);
      this.input.shake();
      return;
    }
    if (res.events && res.events.length) {
      this.audio.playEvents(res.events);
      if (this.renderer.ok) this.renderer.handleEvents(res.events, this.session.state);
    }
    if (this.session.tutorialIndex !== before) this.trackTutorial();
    this.ui.updateHud(this.session, this.level);
    this.refreshBoard();
  }

  undo() {
    if (!this.session || !this.session.canUndo()) { this.ui.announce('Nothing to undo.'); return; }
    this.session.undo();
    this.prevTreat = { x: this.session.state.treat.x, y: this.session.state.treat.y };
    this.ui.announce('Undone.');
    this.ui.updateHud(this.session, this.level);
    this.refreshBoard();
  }

  hint() {
    if (!this.session || this.phase !== 'active') return;
    const h = this.session.hint();
    if (!h) { this.ui.announce('No hint available right now.'); return; }
    const kind = h.action.type === 'cut' ? 'rope' : h.action.type;
    this.renderer.setHighlight(kind, h.action.id, 'hint');
    this.ui.announce('Hint: try ' + (h.action.type === 'cut' ? 'snipping ' + h.action.id
      : h.action.type + ' on ' + h.action.id) + (h.authored ? '' : ' (no authored hint; best guess)'));
  }

  restart() {
    if (!this.session) return;
    funnelEvent('retry', { levelId: this.level.id });
    this._coachIdx = -1;
    this.startRound(this.level, { mode: this.mode, ranked: this.session.ranked });
  }

  cameraReset() {
    if (this.renderer.ok) this.renderer.fitCamera();
  }

  pauseToggle() {
    if (this.phase === 'active') {
      this.phase = 'paused';
      this.ui.showPause();
      this.ui.announce('Paused.');
    } else if (this.phase === 'paused') {
      this.resume();
    }
  }

  resume() {
    if (this.phase !== 'paused') return;
    this.phase = 'active';
    this.ui.closeScreen();
    this.ui.announce('Resumed.');
  }

  /** Skip/fast-forward: settle instantly to the deterministic end state. */
  skip() {
    if (!this.session || this.phase !== 'active') return;
    this.session.settle();
    this.ui.updateHud(this.session, this.level);
    if (this.session.state.status !== STATUS.ACTIVE) {
      this.onTerminal({ type: 'terminal', status: this.session.state.status, reason: this.session.state.reason });
    }
  }

  // -------------------------------------------------------------------------
  // resolving → results → progression
  // -------------------------------------------------------------------------
  onTerminal(ev) {
    if (this.phase === 'resolving' || this.phase === 'results') return;
    this.phase = 'resolving';
    this.ui.showHud(false);
    const delay = this.settings.reducedMotion ? 300 : 1300;
    this._resolveTimer = setTimeout(() => this.finishRound(), delay);
  }

  async finishRound() {
    if (!this.session || this.phase !== 'resolving') return;
    this.phase = 'results';
    const completedSession = this.session;
    const score = this.session.score();
    const state = this.session.state;
    const won = score.delivered;

    // Progression.
    const achievements = [];
    if (this.mode === 'journey' || this.mode === 'challenge') {
      recordLevelResult(this.progress, this.level.id, {
        completed: won, stars: score.stars, score: score.total,
      });
      if (won) this.progress.lastLevel = this.level.id;
    }
    if (this.mode === 'learn' && state.status === STATUS.WON) {
      if (!this.progress.tutorialsDone.includes(this.level.id)) {
        this.progress.tutorialsDone.push(this.level.id);
      }
    }
    if (this.mode === 'daily') {
      const day = this.level.id.replace('daily-', '');
      if (!this.progress.dailyDays.includes(day)) this.progress.dailyDays.push(day);
    }
    for (const key of checkAchievements(this.progress, LEVELS)) {
      achievements.push(key);
      this.progress.achievements.push(key);
    }
    this.saveProgress();
    for (const key of achievements) {
      const a = ACHIEVEMENTS.find((x) => x.key === key);
      this.ui.toast('Achievement unlocked — ' + (a ? a.name : key) + '!');
    }

    // Ranked rounds keep a verified local record (clients can never submit
    // to platform leaderboards); it is cloud-saved with progress.
    let submitted = null;
    if (this.session.ranked) {
      recordLocalScore(this.progress, {
        total: score.total, delivered: won, levelId: this.level.id, at: Date.now(),
      });
      this.saveProgress();
      submitted = false;
      if (this.session !== completedSession || this.phase !== 'results') return;
      this.ui.toast('Score saved to your local board.');
    }

    funnelEvent('round-end', {
      mode: this.mode, levelId: this.level.id, won, total: score.total, stars: score.stars,
    });

    // Next button: journey → next stage; learn → next lesson.
    let nextLabel = null;
    if (won && this.mode === 'journey') {
      const idx = LEVELS.findIndex((l) => l.id === this.level.id);
      if (idx >= 0 && idx + 1 < LEVELS.length) nextLabel = 'Next stage';
    } else if (this.mode === 'learn') {
      const idx = TUTORIALS.findIndex((t) => t.id === this.level.id);
      if (idx >= 0 && idx + 1 < TUTORIALS.length) nextLabel = 'Next lesson';
    }
    this._nextTarget = null;
    if (nextLabel) {
      const list = this.mode === 'learn' ? TUTORIALS : LEVELS;
      const idx = list.findIndex((l) => l.id === this.level.id);
      this._nextTarget = list[idx + 1];
    }

    this.ui.showResults({
      score: Object.assign({ reason: state.reason }, score),
      level: this.level,
      par: this.level.par,
      won,
      achievements,
      nextLabel,
      submitted,
    });
  }

  next() {
    if (this._nextTarget) {
      const mode = this.mode;
      this.startRound(this._nextTarget, { mode, ranked: this.session.ranked });
    } else {
      this.goTitle();
    }
  }

  // -------------------------------------------------------------------------
  // Score chase
  // -------------------------------------------------------------------------
  async showScores(board = 'global') {
    this.ui.showScores(this.boards, board);
    const entries = await fetchLeaderboard(board);
    this.boards[board] = entries === null
      ? { error: true, local: this.progress.board || [] }
      : { entries };
    if (this.ui.screen === 'Leaderboard') this.ui.showScores(this.boards, board);
  }
}

// ---------------------------------------------------------------------------
// Boot (browser only)
// ---------------------------------------------------------------------------
async function boot() {
  const { UI } = await import('./ui.js');
  const { Renderer } = await import('./render.js');
  const { Input } = await import('./input.js');

  const root = document.getElementById('app');
  let app; // forward reference for handlers

  const ui = new UI(root, {
    startMode: (m, arg) => app.startMode(m, arg),
    showMap: () => ui.showWorldMap(app.progress, LEVELS),
    goTitle: () => app.goTitle(),
    showSettings: () => ui.showSettings(app.settings, app.progress, app.progress.totalStars),
    showHelp: () => ui.showHelp({ confirm: 'Enter / Space / gamepad A' }),
    showScores: (b) => app.showScores(b),
    saveSettings: () => app.saveSettings(),
    saveProgress: () => app.saveProgress(),
    confirmAction: (a) => app.doAction(a.type, a.id, a.on),
    action: (name) => {
      switch (name) {
        case 'undo': app.undo(); break;
        case 'hint': app.hint(); break;
        case 'restart': app.restart(); break;
        case 'pause': app.pauseToggle(); break;
        case 'resume': app.resume(); break;
        case 'skip': app.skip(); break;
        case 'retry': app.restart(); break;
        case 'next': app.next(); break;
        default: break;
      }
    },
  });

  const renderer = new Renderer(ui.canvas, {
    onContextLost: () => ui.glMessage('Graphics context lost — rebuilding…'),
    onContextRestored: () => {
      ui.glMessage(null);
      // Three re-uploads GPU resources automatically; rebuild scene content.
      if (app && app.session) {
        renderer.buildLevel(app.session.state, THEMES[app.level.theme] || THEMES.gumdrop, app.progress.cosmetics);
      }
    },
  });
  if (!renderer.ok) {
    ui.glMessage('WebGL is unavailable in this browser. Menus still work; the action list below can play each round.');
  }

  const audio = new AudioEngine(loadSettings());
  app = new App(ui, renderer, audio);
  app.audio = audio;
  audio.settings = app.settings;

  // Audio contexts must resume on a user gesture.
  const gesture = () => { audio.ensure(); audio.applyVolumes(); };
  document.addEventListener('pointerdown', gesture, { once: true });
  document.addEventListener('keydown', gesture, { once: true });

  app.input = new Input(ui.canvas, {
    renderer,
    ui,
    audio,
    getSession: () => app.session,
    isActive: () => app.phase === 'active',
    onAction: (t, id, on) => app.doAction(t, id, on),
    onPause: () => app.pauseToggle(),
    onUndo: () => app.undo(),
    onHint: () => app.hint(),
    onRestart: () => { if (app.session) app.restart(); },
    onCameraReset: () => app.cameraReset(),
  });

  // Launch context: read the launch token once (fragment first, stripped;
  // query params are a local-dev fallback) and start the refresh cycle.
  initPlatform();
  setSyncListener((s) => ui.setSyncStatus(s));

  // Server clock for the daily key (falls back to local UTC).
  app.clock = await serverClock();

  // Hosted: show the player's platform nickname and prefer the remote save.
  if (isHosted()) {
    ui.setPlayerName(await loadNickname());
    const remote = await loadCloudSave();
    if (remote && remote.progress && typeof remote.progress === 'object') {
      // Remote wins conflicts; localStorage stays a cache of the adopted doc.
      app.progress = Object.assign({}, app.progress, remote.progress);
      saveProgress(app.progress);
      ui.setTotalStars(app.progress.totalStars);
      ui.toast('Progress synced from your StarHermit account.');
    }
  }

  // Backgrounding auto-pauses solo play; decorative animation pauses too.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && app.phase === 'active') app.pauseToggle();
  });

  // Escape closes overlays back to the round when paused.
  window.addEventListener('resize', () => { if (renderer.ok) renderer.resize(); });

  // Daily countdown ticker on the title screen.
  setInterval(() => {
    if (app.phase === 'title' && app.clock) {
      app.clock.nextDailyMs -= 1000;
      ui.updateDailyCountdown(app.clock.nextDailyMs);
    }
  }, 1000);

  // Main loop.
  const loop = (now) => {
    try { app.frame(now); } catch (e) {
      funnelEvent('error', { message: String(e && e.message || e).slice(0, 120) });
      throw e;
    }
    requestAnimationFrame(loop);
  };
  app.lastTime = performance.now();
  requestAnimationFrame(loop);

  app.goTitle();
  ui.updateDailyCountdown(app.clock.nextDailyMs);
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  boot().catch((e) => {
    const root = document.getElementById('app');
    if (root) root.textContent = 'Tether Treat failed to start: ' + (e && e.message ? e.message : e);
    console.error(e);
  });
}
