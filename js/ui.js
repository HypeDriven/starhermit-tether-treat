// ui.js — semantic DOM shell: screens, HUD, live region, board-state mirror.
//
// All UI is real HTML over the canvas: <section> screens with headings,
// real <button>s, an aria-live polite region, and a text mirror of legal
// actions so screen readers and keyboards have full parity with the canvas.
// ui.js owns no game rules; it renders what main.js tells it and reports
// user intent through the `handlers` map.

import { WORLDS } from './levels.js';
import { THEMES, ACHIEVEMENTS, COSMETICS, unlockedCosmetics } from './content.js';
import { PRESETS, CATEGORIES, presetTier, withPreset, DEFAULT_GRAPHICS } from './gfx.js';
import { gfxStrings, fmt, summaryText } from './gfx-i18n.js';
import { shText } from './sh-i18n.js';
import { t, tn, locale, levelName, playerName } from './i18n.js';

const REASON_KEY = {
  'delivered': 'resultDelivered',
  'hazard': 'reasonHazard',
  'out-of-bounds': 'reasonOut',
  'stalled': 'reasonStalled',
  'time-up': 'reasonTime',
  'missing-stars': 'reasonMissingStars',
};

const MECHANIC_HELP = ['helpCut', 'helpStars', 'helpBubble', 'helpFan', 'helpBumper', 'helpSpikes', 'helpSlider'];
const SCREEN_KEY = {
  Title: 'scrTitle', Journey: 'scrJourney', Challenges: 'scrChallenges', Practice: 'scrPractice', Leaderboard: 'scrLeaderboard',
  Settings: 'scrSettings', Help: 'scrHelp', Results: 'scrResults', Paused: 'scrPaused', Countdown: 'scrCountdown',
};
const sh = (key, vars) => shText(key, vars || {}, locale());

function el(tag, attrs = {}, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('aria')) e.setAttribute(k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), v);
    else e.setAttribute(k, v);
  }
  if (text !== undefined) e.textContent = text;
  return e;
}

export class UI {
  constructor(root, handlers) {
    this.root = root;
    this.h = handlers;
    this.screen = null;
    this.lastFocus = null;
    this.build();
  }

  build() {
    this.root.classList.add('tt-root');
    this.root.replaceChildren();

    // Skip link + live region.
    this.skipLink = el('a', { class: 'skip-link', href: '#board-mirror' }, t('skipLink'));
    this.root.appendChild(this.skipLink);
    this.live = el('div', { class: 'sr-only', role: 'status', ariaLive: 'polite' });
    this.root.appendChild(this.live);

    // Header status bar.
    this.header = el('header', { class: 'tt-header' });
    this.headerTitle = el('span', { class: 'tt-header-title' }, 'Tether Treat');
    this.headerName = el('span', { class: 'tt-header-name', hidden: '' });
    this.headerSync = el('span', { class: 'tt-header-sync', 'data-state': 'offline' }, t('syncOffline'));
    this.headerId = el('div', { class: 'tt-header-id' });
    this.headerId.append(this.headerName, this.headerSync);
    this.headerStars = el('span', { class: 'tt-header-stars', ariaLabel: t('totalStarsLabel') }, '★ 0');
    this.header.append(this.headerTitle, this.headerId, this.headerStars);
    this.root.appendChild(this.header);

    // Main layout: left rail / canvas / right rail.
    this.main = el('main', { class: 'tt-main' });
    this.railLeft = el('aside', { class: 'tt-rail tt-rail-left', ariaLabel: t('railLeft') });
    this.canvasWrap = el('div', { class: 'tt-canvas-wrap', id: 'canvas-wrap' });
    this.canvas = el('canvas', { class: 'tt-canvas', ariaHidden: 'true', tabindex: '-1' });
    this.canvasWrap.appendChild(this.canvas);
    this.railRight = el('aside', { class: 'tt-rail tt-rail-right', ariaLabel: t('railRight') });
    this.main.append(this.railLeft, this.canvasWrap, this.railRight);
    this.root.appendChild(this.main);

    // HUD (inside canvas wrap, overlays the canvas).
    this.hud = el('div', { class: 'tt-hud', hidden: '' });
    this.hudObjective = el('p', { class: 'tt-hud-objective' });
    this.hudStats = el('div', { class: 'tt-hud-stats' });
    this.hud.append(this.hudObjective, this.hudStats);
    this.canvasWrap.appendChild(this.hud);

    // Action buttons (context-relevant) live in the right rail / thumb tray.
    this.actionBar = el('div', { class: 'tt-actionbar' });
    this.btnUndo = this.actionButton(t('btnUndo'), 'undo');
    this.btnHint = this.actionButton(t('btnHint'), 'hint');
    this.btnRestart = this.actionButton(t('btnRestart'), 'restart');
    this.btnPause = this.actionButton(t('btnPause'), 'pause');
    this.btnSkip = this.actionButton(t('btnSkip'), 'skip', true);
    this.actionBar.append(this.btnUndo, this.btnHint, this.btnRestart, this.btnSkip, this.btnPause);
    this.railRight.appendChild(this.actionBar);

    // Board-state mirror: legal actions as real buttons.
    this.mirror = el('section', { class: 'tt-mirror', id: 'board-mirror', ariaLabel: t('availableActions') });
    this.mirrorHeading = el('h2', { class: 'sr-only' }, t('availableActions'));
    this.mirror.appendChild(this.mirrorHeading);
    this.mirrorList = el('ul', { class: 'tt-mirror-list' });
    this.mirror.appendChild(this.mirrorList);
    this.railRight.appendChild(this.mirror);

    // Coach panel (tutorial).
    this.coach = el('div', { class: 'tt-coach', hidden: '', role: 'note' });
    this.canvasWrap.appendChild(this.coach);

    // Tooltip for invalid taps.
    this.tooltip = el('div', { class: 'tt-tooltip', hidden: '', role: 'alert' });
    this.canvasWrap.appendChild(this.tooltip);

    // Screen container.
    this.screens = el('div', { class: 'tt-screens' });
    this.root.appendChild(this.screens);

    // Toast stack (achievements, notices).
    this.toasts = el('div', { class: 'tt-toasts', ariaLive: 'polite' });
    this.root.appendChild(this.toasts);
    // Over a screen (menu, pause, results) toasts float at the top and the
    // screen is padded by the stack's height, so no heading or button sits
    // under a toast. Layout px: toasts and screens share the root's zoom.
    if (typeof MutationObserver === 'function') {
      new MutationObserver(() => {
        const h = this.toasts.children.length ? this.toasts.offsetHeight + 8 : 0;
        this.root.style.setProperty('--toast-h', h + 'px');
      }).observe(this.toasts, { childList: true });
    }

    // WebGL notice.
    this.glNotice = el('div', { class: 'tt-glnotice', hidden: '', role: 'alert' });
    this.canvasWrap.appendChild(this.glNotice);
  }

  actionButton(label, action, primary = false) {
    const b = el('button', { class: 'tt-btn tt-btn-sm' + (primary ? ' tt-btn-primary' : ''), type: 'button' }, label);
    b.addEventListener('click', () => this.h.action && this.h.action(action));
    return b;
  }

  announce(msg) { this.live.textContent = ''; this.live.textContent = msg; }

  toast(msg) {
    const t = el('div', { class: 'tt-toast' }, msg);
    this.toasts.appendChild(t);
    setTimeout(() => t.classList.add('show'), 20);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 4200);
  }

  showTooltip(msg, x, y) {
    this.tooltip.textContent = msg;
    this.tooltip.hidden = false;
    // x/y are viewport (visual) px; the tooltip is positioned inside the
    // (possibly zoomed) canvas wrap, so convert to its local layout px.
    const r = this.canvasWrap.getBoundingClientRect();
    const z = (globalThis.UIScale && globalThis.UIScale.value) || 1;
    this.tooltip.style.left = (x - r.left) / z + 'px';
    this.tooltip.style.top = (y - r.top) / z + 'px';
    clearTimeout(this._tipTimer);
    this._tipTimer = setTimeout(() => { this.tooltip.hidden = true; }, 2200);
    this.announce(msg);
  }

  setTotalStars(n) { this.headerStars.textContent = '★ ' + n; }

  /** Platform display name in the header identity slot (hidden offline). */
  setPlayerName(name) {
    this._playerName = name;
    this.headerName.textContent = name ? playerName(name) : '';
    this.headerName.hidden = !name;
  }

  /** Cloud-save sync status: offline | loading | saving | synced | error. */
  setSyncStatus(state) {
    this._sync = state;
    const key = { offline: 'syncOffline', loading: 'syncLoading', saving: 'syncSaving', synced: 'syncSynced', error: 'syncError' }[state];
    this.headerSync.textContent = key ? t(key) : '';
    this.headerSync.setAttribute('data-state', state);
  }

  /**
   * Language changed: relabel the shell, the HUD, the coach and the current
   * screen in place. Settings relabels without a rebuild so the shared
   * Language / Sound / Report sections (game-options.js) stay put.
   */
  relabel() {
    this.skipLink.textContent = t('skipLink');
    this.headerStars.setAttribute('aria-label', t('totalStarsLabel'));
    this.railLeft.setAttribute('aria-label', t('railLeft'));
    this.railRight.setAttribute('aria-label', t('railRight'));
    this.btnUndo.textContent = t('btnUndo'); this.btnHint.textContent = t('btnHint');
    this.btnRestart.textContent = t('btnRestart'); this.btnPause.textContent = t('btnPause'); this.btnSkip.textContent = t('btnSkip');
    this.mirror.setAttribute('aria-label', t('availableActions'));
    this.mirrorHeading.textContent = t('availableActions');
    this.setSyncStatus(this._sync || 'offline');
    this.setPlayerName(this._playerName);
    const sec = this.screens.querySelector('.tt-screen');
    if (sec && SCREEN_KEY[this.screen]) sec.setAttribute('aria-label', t(SCREEN_KEY[this.screen]));
    if (this.screen === 'Settings' && this._settingsLabels) {
      for (const [node, text] of this._settingsLabels) node.textContent = text();
      if (this._rebuildGraphics) this._rebuildGraphics();
    } else if (this.screen && this.screen !== 'Countdown' && this._rerender) {
      this._rerender();
    }
  }

  // -------------------------------------------------------------------------
  // Screen machinery
  // -------------------------------------------------------------------------
  showScreen(name, node) {
    this.lastFocus = document.activeElement;
    this.screens.replaceChildren();
    if (node) {
      const sec = el('section', { class: 'tt-screen', ariaLabel: SCREEN_KEY[name] ? t(SCREEN_KEY[name]) : name });
      sec.appendChild(node);
      this.screens.appendChild(sec);
      this.screens.hidden = false;
      const first = sec.querySelector('button, [href], input, select');
      if (first) first.focus();
    } else {
      this.screens.hidden = true;
    }
    this.screen = name;
  }

  closeScreen() {
    this.screens.replaceChildren();
    this.screens.hidden = true;
    this.screen = null;
    if (this.lastFocus && this.lastFocus.focus) this.lastFocus.focus();
  }

  screenShell(title, subtitle) {
    const wrap = el('div', { class: 'tt-panel' });
    wrap.appendChild(el('h1', {}, title));
    if (subtitle) wrap.appendChild(el('p', { class: 'tt-sub' }, subtitle));
    return wrap;
  }

  backButton(label = t('back')) {
    const b = el('button', { class: 'tt-btn tt-btn-ghost', type: 'button' }, label);
    b.addEventListener('click', () => this.h.goTitle());
    return b;
  }

  // -------------------------------------------------------------------------
  // Title / mode select
  // -------------------------------------------------------------------------
  showTitle(progress, daily) {
    this._rerender = () => this.showTitle(progress, daily);
    const wrap = this.screenShell('Tether Treat', t('tagline'));
    const grid = el('div', { class: 'tt-cardgrid' });

    const cont = progress.lastLevel && progress.levels[progress.lastLevel]
      ? progress.lastLevel : null;
    const play = el('button', { class: 'tt-card tt-card-play', type: 'button' });
    play.append(
      el('strong', {}, cont ? t('continueJourney') : t('playJourney')),
      el('span', {}, cont ? t('continueSub') : t('playSub')));
    play.addEventListener('click', () => this.h.startMode('journey'));
    grid.appendChild(play);

    const dailyCard = el('button', { class: 'tt-card', type: 'button' });
    dailyCard.append(el('strong', {}, t('dailyDrop')));
    const cd = el('span', { class: 'tt-daily-countdown' }, '…');
    dailyCard.appendChild(cd);
    if (daily && daily.source === 'local') {
      dailyCard.appendChild(el('span', { class: 'tt-dim' }, t('localClock')));
    }
    dailyCard.addEventListener('click', () => this.h.startMode('daily'));
    grid.appendChild(dailyCard);
    this.dailyCountdownEl = cd;

    for (const [mode, title, sub] of [
      ['learn', t('learn'), progress.tutorialsDone.length ? t('lessonsDone', { n: progress.tutorialsDone.length }) : t('sixLessons')],
      ['practice', t('practice'), t('practiceSub')],
      ['challenge', t('challenge'), t('challengeSub')],
      ['scores', t('scoreChase'), t('scoreChaseSub')],
    ]) {
      const c = el('button', { class: 'tt-card', type: 'button', 'data-mode': mode });
      c.append(el('strong', {}, title), el('span', {}, sub));
      c.addEventListener('click', () => mode === 'scores' ? this.h.showScores() : this.h.startMode(mode));
      grid.appendChild(c);
    }
    wrap.appendChild(grid);

    const row = el('div', { class: 'tt-row' });
    const map = el('button', { class: 'tt-btn', type: 'button', id: 'btn-map' }, t('journeyMap'));
    map.addEventListener('click', () => this.h.showMap());
    row.appendChild(map);
    const settings = el('button', { class: 'tt-btn', type: 'button', id: 'btn-settings' }, t('settings'));
    settings.addEventListener('click', () => this.h.showSettings());
    const help = el('button', { class: 'tt-btn', type: 'button', id: 'btn-help' }, t('help'));
    help.addEventListener('click', () => this.h.showHelp());
    row.append(settings, help);
    if (this.h.canSignIn && this.h.canSignIn()) {
      const signin = el('button', { class: 'tt-btn', type: 'button', id: 'btn-signin' }, sh('signIn'));
      signin.addEventListener('click', () => this.h.signIn());
      row.appendChild(signin);
    }
    if (this.h.canInvite && this.h.canInvite()) {
      const invite = el('button', { class: 'tt-btn', type: 'button', id: 'btn-invite' }, sh('invite'));
      invite.addEventListener('click', () => this.h.invite());
      row.appendChild(invite);
    }
    wrap.appendChild(row);

    const ach = el('p', { class: 'tt-dim' },
      t('titleStats', { n: progress.achievements.length, total: ACHIEVEMENTS.length, stars: progress.totalStars }));
    wrap.appendChild(ach);
    this.showScreen('Title', wrap);
    if (this._dailyMs != null) this.updateDailyCountdown(this._dailyMs);
  }

  updateDailyCountdown(ms) {
    this._dailyMs = ms;
    if (!this.dailyCountdownEl) return;
    const s = Math.max(0, Math.floor(ms / 1000));
    const hh = String(Math.floor(s / 3600)).padStart(2, '0');
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    this.dailyCountdownEl.textContent = t('nextDrop', { time: hh + ':' + mm + ':' + ss });
  }

  // -------------------------------------------------------------------------
  // Journey world map
  // -------------------------------------------------------------------------
  showWorldMap(progress, levels) {
    this._rerender = () => this.showWorldMap(progress, levels);
    const wrap = this.screenShell(t('journey'), t('journeySub'));
    wrap.appendChild(this.backButton());
    for (const w of WORLDS) {
      const theme = THEMES[w.theme];
      const wsec = el('div', { class: 'tt-world' });
      const head = el('h2', {}, t('worldHeading', { n: w.id, name: tn('worlds', w.id, w.name) }));
      head.style.color = theme.accent;
      wsec.appendChild(head);
      wsec.appendChild(el('p', { class: 'tt-dim' }, tn('mechanics', w.id, w.mechanic)));
      const row = el('div', { class: 'tt-stagerow' });
      const stages = levels.filter((l) => l.world === w.id);
      stages.forEach((lv, i) => {
        const rec = progress.levels[lv.id];
        const prevDone = i === 0
          ? (w.id === 1 || levels.filter((l) => l.world === w.id - 1).every((l) => progress.levels[l.id] && progress.levels[l.id].completed))
          : !!(progress.levels[stages[i - 1].id] && progress.levels[stages[i - 1].id].completed);
        const locked = !prevDone && !(rec && rec.completed);
        const b = el('button', {
          class: 'tt-stage' + (rec && rec.completed ? ' done' : '') + (locked ? ' locked' : ''),
          type: 'button',
          ariaLabel: levelName(lv) + (locked ? t('locked') : ''),
          'data-level': lv.id,
        });
        b.style.setProperty('--stage-accent', theme.accent);
        b.append(el('span', { class: 'tt-stage-num' }, String(i + 1)));
        b.append(el('span', { class: 'tt-stage-stars' }, rec ? '★'.repeat(rec.stars) + '☆'.repeat(3 - rec.stars) : (locked ? '🔒' : '···')));
        if (lv.mastery) b.append(el('span', { class: 'tt-stage-tag' }, 'M'));
        b.title = levelName(lv) + (lv.mastery ? t('masteryTag') : '');
        if (locked) b.disabled = true;
        else b.addEventListener('click', () => this.h.startMode('journey', lv.id));
        row.appendChild(b);
      });
      wsec.appendChild(row);
      wrap.appendChild(wsec);
    }
    this.showScreen('Journey', wrap);
  }

  // -------------------------------------------------------------------------
  // Challenge list
  // -------------------------------------------------------------------------
  showChallenges(challenges, progress) {
    this._rerender = () => this.showChallenges(challenges, progress);
    const wrap = this.screenShell(t('challenges'), t('challengesSub'));
    wrap.appendChild(this.backButton());
    const list = el('div', { class: 'tt-list' });
    for (const c of challenges) {
      const rec = progress.levels[c.id];
      const b = el('button', { class: 'tt-listitem', type: 'button' });
      b.append(
        el('strong', {}, levelName(c)),
        el('span', {}, tn('blurbs', c.id, c.blurb)),
        el('span', { class: 'tt-dim' }, rec && rec.completed ? t('bestLine', { score: rec.bestScore, stars: '★'.repeat(rec.stars) }) : t('notCleared')));
      b.addEventListener('click', () => this.h.startMode('challenge', c.id));
      list.appendChild(b);
    }
    wrap.appendChild(list);
    this.showScreen('Challenges', wrap);
  }

  // -------------------------------------------------------------------------
  // Practice difficulty select
  // -------------------------------------------------------------------------
  showPractice() {
    this._rerender = () => this.showPractice();
    const wrap = this.screenShell(t('practice'), t('practiceSubtitle'));
    wrap.appendChild(this.backButton());
    const row = el('div', { class: 'tt-row' });
    for (const d of ['easy', 'medium', 'hard']) {
      const b = el('button', { class: 'tt-btn', type: 'button', 'data-difficulty': d }, t('diff' + d[0].toUpperCase() + d.slice(1)));
      b.addEventListener('click', () => this.h.startMode('practice', d));
      row.appendChild(b);
    }
    wrap.appendChild(row);
    this.showScreen('Practice', wrap);
  }

  // -------------------------------------------------------------------------
  // Leaderboard
  // -------------------------------------------------------------------------
  showScores(boards, active) {
    this._rerender = () => this.showScores(boards, active);
    const wrap = this.screenShell(t('scoreChase'), t('scoresSub'));
    wrap.appendChild(this.backButton());
    const tabs = el('div', { class: 'tt-row', role: 'tablist' });
    for (const b of ['global', 'daily', 'friends']) {
      const t = el('button', {
        class: 'tt-btn tt-btn-sm' + (b === active ? ' tt-btn-primary' : ''), type: 'button', role: 'tab',
        ariaSelected: String(b === active),
      }, t('board' + b[0].toUpperCase() + b.slice(1)));
      t.addEventListener('click', () => this.h.showScores(b));
      tabs.appendChild(t);
    }
    wrap.appendChild(tabs);
    const data = boards[active];
    const list = el('ol', { class: 'tt-scores' });
    if (!data) {
      wrap.appendChild(el('p', { class: 'tt-dim' }, t('loading')));
    } else if (data.error) {
      wrap.appendChild(el('p', { class: 'tt-dim' }, t('boardUnavailable')));
      for (const e of data.local.slice(0, 20)) {
        list.appendChild(el('li', {}, e.total + ' · ' + (e.levelId || '') + (e.delivered ? t('delivered') : '')));
      }
    } else {
      for (const e of data.entries.slice(0, 20)) {
        list.appendChild(el('li', {}, (e.name ? playerName(e.name) : t('anon')) + ' — ' + e.total));
      }
      if (!data.entries.length) wrap.appendChild(el('p', { class: 'tt-dim' }, t('noScores')));
    }
    wrap.appendChild(list);
    this.showScreen('Leaderboard', wrap);
  }

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------
  showSettings(settings, progress, totalStars, opts = {}) {
    this._rerender = null;
    // [node, () => text] pairs relabelled in place on a language change.
    const labels = this._settingsLabels = [];
    const L = (node, text) => { labels.push([node, text]); node.textContent = text(); return node; };
    const wrap = el('div', { class: 'tt-panel' });
    wrap.appendChild(L(el('h1', {}), () => t('settings')));
    wrap.appendChild(L(el('p', { class: 'tt-sub' }), () => t('settingsSub')));
    if (opts.fromPause) {
      // Opened from the pause menu: Back returns there without ending the round.
      const back = L(el('button', { class: 'tt-btn tt-btn-ghost', type: 'button', id: 'btn-settings-back' }), () => t('back'));
      back.addEventListener('click', () => this.showPause());
      wrap.appendChild(back);
    } else {
      const back = L(this.backButton(), () => t('back'));
      back.id = 'btn-settings-back';
      wrap.appendChild(back);
    }
    const form = el('div', { class: 'tt-form' });
    const save = () => this.h.saveSettings(settings);

    const slider = (label, key) => {
      const lab = el('label', { class: 'tt-field' });
      lab.append(L(el('span', { 'data-label': label }), () => t(label)));
      const inp = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(settings[key]) });
      inp.addEventListener('input', () => { settings[key] = parseFloat(inp.value); save(); });
      lab.appendChild(inp);
      form.appendChild(lab);
    };
    slider('volMusic', 'music');
    slider('volEffects', 'effects');
    slider('volAmbience', 'ambience');

    const toggle = (label, key) => {
      const lab = el('label', { class: 'tt-field tt-field-check' });
      const inp = el('input', { type: 'checkbox' });
      inp.checked = !!settings[key];
      inp.addEventListener('change', () => { settings[key] = inp.checked; save(); });
      lab.append(inp, L(el('span', { 'data-label': label }), () => t(label)));
      form.appendChild(lab);
    };
    toggle('muteAll', 'muted');
    toggle('reducedMotion', 'reducedMotion');
    toggle('highContrast', 'highContrast');
    toggle('largerText', 'largeText');
    toggle('leftHanded', 'leftHanded');

    form.appendChild(this.graphicsSection(settings, save, opts.graphicsInfo));

    // Cosmetics picker (unlocked by total stars; cosmetic only).
    const unlocked = unlockedCosmetics(totalStars);
    for (const slot of Object.keys(COSMETICS)) {
      const lab = el('label', { class: 'tt-field' });
      lab.append(L(el('span', {}), () => t('cosmetic', { slot: t('slot' + slot[0].toUpperCase() + slot.slice(1)) })));
      const cs = el('select', {});
      for (const c of COSMETICS[slot]) {
        const has = unlocked[slot].includes(c.id);
        const o = L(el('option', { value: c.id }), () => tn('cosmetics', c.id, c.name) + (has ? '' : t('needsStars', { n: c.stars })));
        if (!has) o.disabled = true;
        if (progress.cosmetics[slot] === c.id) o.selected = true;
        cs.appendChild(o);
      }
      cs.addEventListener('change', () => { progress.cosmetics[slot] = cs.value; this.h.saveProgress(); });
      lab.appendChild(cs);
      form.appendChild(lab);
    }

    const reset = L(el('button', { class: 'tt-btn tt-btn-ghost', type: 'button' }), () => t('resetTutorials'));
    reset.addEventListener('click', () => {
      progress.tutorialsDone = [];
      this.h.saveProgress();
      this.toast(t('tutorialsReset'));
    });
    form.appendChild(reset);

    wrap.appendChild(form);
    this.showScreen('Settings', wrap);
  }

  /**
   * Graphics section: quality preset, render scale, per-effect overrides,
   * adaptive resolution, frame-rate readout and a live cost summary.
   * Changes apply immediately through saveSettings() and persist with the
   * other settings.
   */
  graphicsSection(settings, save, info) {
    // The shared Sound / Language / Report sections (game-options.js) mount
    // into this <section>; the game's own controls live in an inner box that
    // is redrawn on a language change without touching them.
    const sec = el('section', { class: 'tt-gfx', id: 'gfx-section' });
    let own = null;
    const build = () => {
      const next = this.graphicsControls(settings, save, info, sec);
      if (own) own.replaceWith(next); else sec.prepend(next);
      own = next;
    };
    build();
    this._rebuildGraphics = build;
    return sec;
  }

  graphicsControls(settings, save, info, outer) {
    const S = gfxStrings(locale());
    if (!settings.graphics) settings.graphics = Object.assign({}, DEFAULT_GRAPHICS);
    outer.setAttribute('aria-label', S.graphics);
    const sec = el('div', { class: 'tt-gfx-own' });
    sec.appendChild(el('h2', {}, S.graphics));
    const tierName = (t) => S.tier[t] || t;
    const current = () => (info && info()) || null;

    const field = (label, control, id) => {
      const lab = el('label', { class: 'tt-field', for: id });
      lab.append(el('span', {}, label), control);
      return lab;
    };

    // Quality preset.
    const detected = (current() && current().detected) || 'balanced';
    const preset = el('select', { id: 'gfx-preset', 'data-gfx': 'preset' });
    preset.appendChild(el('option', { value: 'auto' }, fmt(S.auto, { tier: tierName(detected) })));
    for (const p of PRESETS) preset.appendChild(el('option', { value: p }, tierName(p)));
    preset.value = PRESETS.includes(settings.graphics.preset) ? settings.graphics.preset : 'auto';
    sec.appendChild(field(S.quality, preset, 'gfx-preset'));

    // Render scale 50–200 %.
    const scaleWrap = el('div', { class: 'tt-gfx-range' });
    const scale = el('input', {
      type: 'range', id: 'gfx-scale', 'data-gfx': 'render_scale', min: '50', max: '200', step: '10',
      value: String(Math.round((settings.graphics.render_scale || 1) * 100)),
    });
    const scaleVal = el('output', { class: 'tt-gfx-value', id: 'gfx-scale-value', for: 'gfx-scale' }, scale.value + '%');
    scaleWrap.append(scale, scaleVal);
    sec.appendChild(field(S.renderScale, scaleWrap, 'gfx-scale'));

    // One select per category, defaulting to "From preset (<tier>)".
    const catSelects = {};
    const grid = el('div', { class: 'tt-gfx-grid' });
    for (const [cat, tiers] of Object.entries(CATEGORIES)) {
      const sel = el('select', { id: 'gfx-' + cat, 'data-gfx': cat });
      sel.appendChild(el('option', { value: 'preset' }, ''));
      for (const t of tiers) sel.appendChild(el('option', { value: t }, tierName(t)));
      sel.value = tiers.includes(settings.graphics[cat]) ? settings.graphics[cat] : 'preset';
      sel.addEventListener('change', () => {
        if (sel.value === 'preset') delete settings.graphics[cat];
        else settings.graphics[cat] = sel.value;
        commit();
      });
      catSelects[cat] = sel;
      grid.appendChild(field(S.cat[cat], sel, 'gfx-' + cat));
    }
    sec.appendChild(grid);

    const check = (label, key, id) => {
      const lab = el('label', { class: 'tt-field tt-field-check', for: id });
      const inp = el('input', { type: 'checkbox', id, 'data-gfx': key });
      inp.checked = key === 'adaptive' ? settings.graphics.adaptive !== false : !!settings.graphics[key];
      inp.addEventListener('change', () => { settings.graphics[key] = inp.checked; commit(); });
      lab.append(inp, el('span', {}, label));
      sec.appendChild(lab);
    };
    check(S.adaptive, 'adaptive', 'gfx-adaptive');
    check(S.showFps, 'show_fps', 'gfx-fps');

    const summary = el('p', { class: 'tt-dim tt-gfx-summary', id: 'gfx-summary', ariaLive: 'polite' });
    const note = el('p', { class: 'tt-gfx-note', id: 'gfx-note', hidden: '' });
    sec.append(summary, note);

    const refresh = () => {
      const g = current();
      if (!g) {
        summary.textContent = '';
        note.textContent = S.noWebgl;
        note.hidden = false;
        return;
      }
      const presetNow = g.resolved.preset;
      for (const [cat, sel] of Object.entries(catSelects)) {
        sel.options[0].textContent = fmt(S.fromPreset, { tier: tierName(presetTier(presetNow, cat)) });
      }
      summary.textContent = [g.gpu, Number.isFinite(g.level) ? fmt(S.level, { n: g.level }) : null, summaryText(g.resolved, g.pixels, S)].filter(Boolean).join(' · ');
      summary.setAttribute('data-preset', presetNow);
      note.textContent = S.postFailed;
      note.hidden = !g.postFailed;
    };
    const commit = () => {
      save();
      refresh();
      // Pixel size settles on the next rendered frame.
      setTimeout(refresh, 120);
    };

    preset.addEventListener('change', () => {
      // Choosing a preset clears every per-category override.
      settings.graphics = withPreset(settings.graphics, preset.value);
      for (const sel of Object.values(catSelects)) sel.value = 'preset';
      commit();
    });
    scale.addEventListener('input', () => {
      scaleVal.textContent = scale.value + '%';
      settings.graphics.render_scale = Number(scale.value) / 100;
      commit();
    });

    refresh();
    const timer = setInterval(() => {
      if (!sec.isConnected) { clearInterval(timer); return; }
      refresh();
    }, 1000);
    return sec;
  }

  // -------------------------------------------------------------------------
  // Help
  // -------------------------------------------------------------------------
  showHelp(bindings) {
    this._rerender = () => this.showHelp(bindings);
    const wrap = this.screenShell(t('howToPlay'), t('howToPlaySub'));
    wrap.appendChild(this.backButton());
    const grid = el('div', { class: 'tt-helpgrid' });
    for (const m of MECHANIC_HELP) {
      const card = el('div', { class: 'tt-helpcard' });
      card.append(el('h3', {}, t(m)), el('p', {}, t(m + 'Text', { confirm: bindings.confirm })));
      grid.appendChild(card);
    }
    wrap.appendChild(grid);
    const keys = el('div', { class: 'tt-panel-inner' });
    keys.appendChild(el('h3', {}, t('controls')));
    const ul = el('ul', {});
    for (const line of [
      t('ctlConfirm', { key: bindings.confirm }),
      t('ctlCycle', { prev: bindings.prev || '← / ↑', next: bindings.next || '→ / ↓' }),
      t('ctlPause', { key: bindings.pause || 'Esc' }),
      t('ctlKeys', { undo: bindings.undo || 'U', hint: bindings.hint || 'H', restart: bindings.restart || 'R', camera: bindings.camera || 'C' }),
      t('ctlTouch'),
    ]) ul.appendChild(el('li', {}, line));
    keys.appendChild(ul);
    wrap.appendChild(keys);
    this.showScreen('Help', wrap);
  }

  // -------------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------------
  showResults(args) {
    // The leaderboard promise resolves once; its line re-renders in any language.
    if (args.leaderboard && !args.lbState) {
      args.lbState = { key: 'lbPosting' };
      args.leaderboard.then((r) => {
        args.lbState = !r.posted ? { key: 'lbNotPosted' } : r.rank ? { key: 'lbRank', vars: { rank: r.rank } } : { key: 'lbPosted' };
        const lb = document.getElementById('results-lb');
        if (lb && this.screen === 'Results') lb.textContent = sh(args.lbState.key, args.lbState.vars);
      });
    }
    this._rerender = () => this.showResults(args);
    const { score, level, par, won, achievements, nextLabel, submitted } = args;
    const wrap = this.screenShell(won ? t('resultDelivered') : t('tryAgain'), levelName(level));
    if (!won) wrap.appendChild(el('p', { class: 'tt-sub' }, t(REASON_KEY[score.reason] || 'reasonOther')));

    const starsRow = el('p', { class: 'tt-stars-big', ariaLabel: t('starsOf', { n: score.stars, total: level.layout.stars.length }) },
      '★'.repeat(score.stars) + '☆'.repeat(Math.max(0, level.layout.stars.length - score.stars)));
    wrap.appendChild(starsRow);

    const table = el('dl', { class: 'tt-score-table' });
    for (const c of score.components) {
      table.append(el('dt', {}, scoreLabel(c)), el('dd', {}, '+' + c.amount));
    }
    table.append(el('dt', { class: 'tt-total' }, t('total')), el('dd', { class: 'tt-total' }, String(score.total)));
    wrap.appendChild(table);

    const facts = [];
    if (par && par.actions) facts.push(t('parActions', { par: par.actions, used: score.actionsUsed }));
    if (par && par.seconds) facts.push(t('parSeconds', { par: par.seconds, secs: (score.ticks / 120).toFixed(1) }));
    if (submitted === false) facts.push(t('savedLocal'));
    if (facts.length) wrap.appendChild(el('p', { class: 'tt-dim' }, facts.join(' ')));

    for (const key of achievements || []) {
      const a = ACHIEVEMENTS.find((x) => x.key === key);
      const text = tn('achievements', key, a ? [a.name, a.desc] : null);
      if (text) wrap.appendChild(el('p', { class: 'tt-ach' }, '🏅 ' + text[0] + ' — ' + text[1]));
    }
    if (args.lbState) {
      wrap.appendChild(el('p', { class: 'tt-dim', id: 'results-lb', ariaLive: 'polite' }, sh(args.lbState.key, args.lbState.vars)));
    }

    const row = el('div', { class: 'tt-row' });
    const retry = el('button', { class: 'tt-btn', type: 'button' }, t('retry'));
    retry.addEventListener('click', () => this.h.action('retry'));
    row.appendChild(retry);
    if (nextLabel) {
      const next = el('button', { class: 'tt-btn tt-btn-primary', type: 'button' }, t(nextLabel));
      next.addEventListener('click', () => this.h.action('next'));
      row.appendChild(next);
    }
    const modes = el('button', { class: 'tt-btn tt-btn-ghost', type: 'button' }, t('modeSelect'));
    modes.addEventListener('click', () => this.h.goTitle());
    row.appendChild(modes);
    wrap.appendChild(row);
    this.announce(t(won ? 'announceWon' : 'announceLost', { total: score.total, stars: score.stars }));
    this.showScreen('Results', wrap);
  }

  // -------------------------------------------------------------------------
  // Pause
  // -------------------------------------------------------------------------
  showPause() {
    this._rerender = () => this.showPause();
    const wrap = this.screenShell(t('paused'), t('pausedSub'));
    const row = el('div', { class: 'tt-row tt-col' });
    const resume = el('button', { class: 'tt-btn tt-btn-primary', type: 'button', id: 'btn-resume' }, t('resume'));
    resume.addEventListener('click', () => this.h.action('resume'));
    const restart = el('button', { class: 'tt-btn', type: 'button' }, t('restart'));
    restart.addEventListener('click', () => this.h.action('restart'));
    const settings = el('button', { class: 'tt-btn', type: 'button', id: 'btn-pause-settings' }, t('settings'));
    settings.addEventListener('click', () => this.h.showSettings(true));
    const quit = el('button', { class: 'tt-btn tt-btn-ghost', type: 'button' }, t('quitToTitle'));
    quit.addEventListener('click', () => this.h.goTitle());
    row.append(resume, restart, settings, quit);
    wrap.appendChild(row);
    this.showScreen('Paused', wrap);
  }

  // -------------------------------------------------------------------------
  // Countdown overlay
  // -------------------------------------------------------------------------
  showCountdown(n) {
    this.showScreen('Countdown', el('div', { class: 'tt-countdown', role: 'status' }, n > 0 ? String(n) : t('go')));
  }

  // -------------------------------------------------------------------------
  // In-round HUD
  // -------------------------------------------------------------------------
  showHud(visible) {
    this.hud.hidden = !visible;
    this.actionBar.hidden = !visible;
  }

  updateHud(session, level) {
    const s = session.state;
    const parts = [];
    const got = s.stars.filter((x) => x.got).length;
    parts.push(t('hudStars', { got, total: s.stars.length }));
    if (s.moveLimit) parts.push(t('movesLeft', { n: Math.max(0, s.moveLimit - s.actionsUsed) }));
    else parts.push(s.parActions ? t('actionsPar', { n: s.actionsUsed, par: s.parActions }) : t('actionsUsed', { n: s.actionsUsed }));
    if (s.timeLimitTicks) {
      const left = Math.max(0, (s.timeLimitTicks - s.tick) / 120);
      parts.push(t('timeLeft', { s: left.toFixed(1) }));
    }
    this.hudStats.textContent = parts.join(' · ');
    let obj = t('objective');
    if (s.requireStars) obj += t('objectiveStars', { n: s.requireStars });
    if (level.mastery) obj += t('objectiveMastery');
    this.hudObjective.textContent = obj;
    // Context-relevant buttons.
    this.btnUndo.disabled = !session.canUndo();
    this.btnUndo.hidden = s.noUndo;
    this.btnSkip.hidden = false; // fast-forward settles the sim instantly
  }

  /** Coach panel for the active tutorial step. */
  showCoach(text, highlightDesc) {
    if (!text) { this.coach.hidden = true; return; }
    this.coach.hidden = false;
    this.coach.replaceChildren(
      el('p', {}, text),
      highlightDesc ? el('p', { class: 'tt-dim' }, highlightDesc) : '');
    this.announce(text);
  }

  /** Rebuild the board-state mirror list from legal actions. */
  updateMirror(actions, focusIndex) {
    // The list is rebuilt after every action; keyboard users must not be
    // dumped back to <body>, so remember where the focus was.
    const active = document.activeElement;
    const focusedRow = this.mirrorList.contains(active)
      ? Array.prototype.indexOf.call(this.mirrorList.children, active.closest('li'))
      : -1;
    this.mirrorList.replaceChildren();
    if (!actions.length) {
      this.mirrorList.appendChild(el('li', { class: 'tt-dim' }, t('noActions')));
      return;
    }
    actions.forEach((a, i) => {
      const li = el('li', {});
      const b = el('button', {
        class: 'tt-btn tt-btn-sm' + (i === focusIndex ? ' tt-btn-focus' : ''),
        type: 'button',
      }, actionLabel(a));
      b.addEventListener('click', () => this.h.confirmAction(a));
      li.appendChild(b);
      this.mirrorList.appendChild(li);
    });
    if (focusedRow >= 0) {
      const row = this.mirrorList.children[Math.min(focusedRow, actions.length - 1)];
      const b = row && row.querySelector('button');
      if (b) b.focus();
    }
  }

  glMessage(msg) {
    if (!msg) { this.glNotice.hidden = true; return; }
    this.glNotice.textContent = msg;
    this.glNotice.hidden = false;
  }
}

function actionLabel(a) {
  if (a.type === 'cut') return t('actSnip', { id: a.id });
  if (a.type === 'pop') return t('actPop', { id: a.id });
  return t(a.on ? 'actFanOn' : 'actFanOff', { id: a.id });
}

function scoreLabel(c) {
  switch (c.key) {
    case 'stars': return t('scStars', { n: c.count });
    case 'delivery': return t('scDelivery');
    case 'actions': return t('scActions', { n: c.count });
    case 'time': return t('scTime', { n: c.count });
    default: return c.key;
  }
}
