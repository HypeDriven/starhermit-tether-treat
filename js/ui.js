// ui.js — semantic DOM shell: screens, HUD, live region, board-state mirror.
//
// All UI is real HTML over the canvas: <section> screens with headings,
// real <button>s, an aria-live polite region, and a text mirror of legal
// actions so screen readers and keyboards have full parity with the canvas.
// ui.js owns no game rules; it renders what main.js tells it and reports
// user intent through the `handlers` map.

import { WORLDS } from './levels.js';
import { THEMES, ACHIEVEMENTS, COSMETICS, unlockedCosmetics } from './content.js';

const REASON_TEXT = {
  'delivered': 'Delivered!',
  'hazard': 'The treat cracked on a spiky gear.',
  'out-of-bounds': 'The treat drifted out of the room.',
  'stalled': 'The treat stalled with nothing left to do.',
  'time-up': 'Time ran out.',
  'missing-stars': 'Delivered, but not every required star was collected.',
};

const MECHANIC_HELP = [
  { id: 'cut', title: 'Ropes', body: 'Swipe across a rope — or focus it and press {confirm} — to snip it. Gravity and swing do the rest.' },
  { id: 'stars', title: 'Stars', body: 'The treat collects any star it touches. Stars sweeten your score; some challenges require them all.' },
  { id: 'bubble', title: 'Bubbles', body: 'A treat that falls into a bubble floats upward. Tap the bubble to pop it at the right moment.' },
  { id: 'fan', title: 'Fans', body: 'Pinwheel fans blow the treat along their stream. Tap a fan to switch it on or off.' },
  { id: 'bumper', title: 'Bumpers', body: 'Drum bumpers bounce the treat away. Use them to change direction.' },
  { id: 'spikes', title: 'Spikes', body: 'Spiky gears crack the treat on contact. Keep clear — danger always wins.' },
  { id: 'slider', title: 'Sliders', body: 'Some ropes hang from carriages that ride rails back and forth. Time your cut with the carriage.' },
];

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
    this.root.appendChild(el('a', { class: 'skip-link', href: '#board-mirror' }, 'Skip to action list'));
    this.live = el('div', { class: 'sr-only', role: 'status', ariaLive: 'polite' });
    this.root.appendChild(this.live);

    // Header status bar.
    this.header = el('header', { class: 'tt-header' });
    this.headerTitle = el('span', { class: 'tt-header-title' }, 'Tether Treat');
    this.headerName = el('span', { class: 'tt-header-name', hidden: '' });
    this.headerSync = el('span', { class: 'tt-header-sync', 'data-state': 'offline' }, 'offline');
    this.headerId = el('div', { class: 'tt-header-id' });
    this.headerId.append(this.headerName, this.headerSync);
    this.headerStars = el('span', { class: 'tt-header-stars', ariaLabel: 'Total stars' }, '★ 0');
    this.header.append(this.headerTitle, this.headerId, this.headerStars);
    this.root.appendChild(this.header);

    // Main layout: left rail / canvas / right rail.
    this.main = el('main', { class: 'tt-main' });
    this.railLeft = el('aside', { class: 'tt-rail tt-rail-left', ariaLabel: 'Objective and progress' });
    this.canvasWrap = el('div', { class: 'tt-canvas-wrap', id: 'canvas-wrap' });
    this.canvas = el('canvas', { class: 'tt-canvas', ariaHidden: 'true', tabindex: '-1' });
    this.canvasWrap.appendChild(this.canvas);
    this.railRight = el('aside', { class: 'tt-rail tt-rail-right', ariaLabel: 'Actions' });
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
    this.btnUndo = this.actionButton('Undo (U)', 'undo');
    this.btnHint = this.actionButton('Hint (H)', 'hint');
    this.btnRestart = this.actionButton('Restart (R)', 'restart');
    this.btnPause = this.actionButton('Pause (Esc)', 'pause');
    this.btnSkip = this.actionButton('Skip ▸▸', 'skip', true);
    this.actionBar.append(this.btnUndo, this.btnHint, this.btnRestart, this.btnSkip, this.btnPause);
    this.railRight.appendChild(this.actionBar);

    // Board-state mirror: legal actions as real buttons.
    this.mirror = el('section', { class: 'tt-mirror', id: 'board-mirror', ariaLabel: 'Available actions' });
    this.mirror.appendChild(el('h2', { class: 'sr-only' }, 'Available actions'));
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
    this.tooltip.style.left = x + 'px';
    this.tooltip.style.top = y + 'px';
    clearTimeout(this._tipTimer);
    this._tipTimer = setTimeout(() => { this.tooltip.hidden = true; }, 2200);
    this.announce(msg);
  }

  setTotalStars(n) { this.headerStars.textContent = '★ ' + n; }

  /** Platform display name in the header identity slot (hidden offline). */
  setPlayerName(name) {
    this.headerName.textContent = name || '';
    this.headerName.hidden = !name;
  }

  /** Cloud-save sync status: offline | loading | saving | synced | error. */
  setSyncStatus(state) {
    const text = { offline: 'offline', loading: 'syncing…', saving: 'saving…', synced: 'synced', error: 'sync error' }[state] || '';
    this.headerSync.textContent = text;
    this.headerSync.setAttribute('data-state', state);
  }

  // -------------------------------------------------------------------------
  // Screen machinery
  // -------------------------------------------------------------------------
  showScreen(name, node) {
    this.lastFocus = document.activeElement;
    this.screens.replaceChildren();
    if (node) {
      const sec = el('section', { class: 'tt-screen', ariaLabel: name });
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

  backButton(label = '← Back') {
    const b = el('button', { class: 'tt-btn tt-btn-ghost', type: 'button' }, label);
    b.addEventListener('click', () => this.h.goTitle());
    return b;
  }

  // -------------------------------------------------------------------------
  // Title / mode select
  // -------------------------------------------------------------------------
  showTitle(progress, daily) {
    const wrap = this.screenShell('Tether Treat', 'Cut ropes. Swing treats. Feed Morsel.');
    const grid = el('div', { class: 'tt-cardgrid' });

    const cont = progress.lastLevel && progress.levels[progress.lastLevel]
      ? progress.lastLevel : null;
    const play = el('button', { class: 'tt-card tt-card-play', type: 'button' });
    play.append(
      el('strong', {}, cont ? 'Continue Journey' : 'Play Journey'),
      el('span', {}, cont ? 'Pick up where you left off' : 'Five candy worlds, 40 stages'));
    play.addEventListener('click', () => this.h.startMode('journey'));
    grid.appendChild(play);

    const dailyCard = el('button', { class: 'tt-card', type: 'button' });
    dailyCard.append(el('strong', {}, 'Daily Drop'));
    const cd = el('span', { class: 'tt-daily-countdown' }, '…');
    dailyCard.appendChild(cd);
    if (daily && daily.source === 'local') {
      dailyCard.appendChild(el('span', { class: 'tt-dim' }, 'local clock'));
    }
    dailyCard.addEventListener('click', () => this.h.startMode('daily'));
    grid.appendChild(dailyCard);
    this.dailyCountdownEl = cd;

    for (const [mode, title, sub] of [
      ['learn', 'Learn', progress.tutorialsDone.length ? progress.tutorialsDone.length + '/6 lessons done' : 'Six quick lessons'],
      ['practice', 'Practice', 'Unranked, undo allowed'],
      ['challenge', 'Challenge', 'Twelve constraint runs'],
      ['scores', 'Score Chase', 'Leaderboards'],
    ]) {
      const c = el('button', { class: 'tt-card', type: 'button' });
      c.append(el('strong', {}, title), el('span', {}, sub));
      c.addEventListener('click', () => mode === 'scores' ? this.h.showScores() : this.h.startMode(mode));
      grid.appendChild(c);
    }
    wrap.appendChild(grid);

    const row = el('div', { class: 'tt-row' });
    const map = el('button', { class: 'tt-btn', type: 'button' }, 'Journey map');
    map.addEventListener('click', () => this.h.showMap());
    row.appendChild(map);
    const settings = el('button', { class: 'tt-btn', type: 'button' }, 'Settings');
    settings.addEventListener('click', () => this.h.showSettings());
    const help = el('button', { class: 'tt-btn', type: 'button' }, 'Help');
    help.addEventListener('click', () => this.h.showHelp());
    row.append(settings, help);
    wrap.appendChild(row);

    const ach = el('p', { class: 'tt-dim' },
      'Achievements: ' + (progress.achievements.length) + '/' + ACHIEVEMENTS.length +
      ' · Total stars: ' + progress.totalStars);
    wrap.appendChild(ach);
    this.showScreen('Title', wrap);
  }

  updateDailyCountdown(ms) {
    if (!this.dailyCountdownEl) return;
    const s = Math.max(0, Math.floor(ms / 1000));
    const hh = String(Math.floor(s / 3600)).padStart(2, '0');
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    this.dailyCountdownEl.textContent = 'Next drop in ' + hh + ':' + mm + ':' + ss;
  }

  // -------------------------------------------------------------------------
  // Journey world map
  // -------------------------------------------------------------------------
  showWorldMap(progress, levels) {
    const wrap = this.screenShell('Journey', 'Complete a stage to unlock the next.');
    wrap.appendChild(this.backButton());
    for (const w of WORLDS) {
      const theme = THEMES[w.theme];
      const wsec = el('div', { class: 'tt-world' });
      const head = el('h2', {}, 'World ' + w.id + ' · ' + w.name);
      head.style.color = theme.accent;
      wsec.appendChild(head);
      wsec.appendChild(el('p', { class: 'tt-dim' }, w.mechanic));
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
          ariaLabel: lv.name + (locked ? ' (locked)' : ''),
        });
        b.style.setProperty('--stage-accent', theme.accent);
        b.append(el('span', { class: 'tt-stage-num' }, String(i + 1)));
        b.append(el('span', { class: 'tt-stage-stars' }, rec ? '★'.repeat(rec.stars) + '☆'.repeat(3 - rec.stars) : (locked ? '🔒' : '···')));
        if (lv.mastery) b.append(el('span', { class: 'tt-stage-tag' }, 'M'));
        b.title = lv.name + (lv.mastery ? ' (mastery)' : '');
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
    const wrap = this.screenShell('Challenges', 'Ranked runs with hard constraints. No undo.');
    wrap.appendChild(this.backButton());
    const list = el('div', { class: 'tt-list' });
    for (const c of challenges) {
      const rec = progress.levels[c.id];
      const b = el('button', { class: 'tt-listitem', type: 'button' });
      b.append(
        el('strong', {}, c.name),
        el('span', {}, c.blurb),
        el('span', { class: 'tt-dim' }, rec && rec.completed ? 'Best: ' + rec.bestScore + ' · ' + '★'.repeat(rec.stars) : 'not cleared yet'));
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
    const wrap = this.screenShell('Practice', 'A fresh generated stage. Undo and restart allowed; unranked.');
    wrap.appendChild(this.backButton());
    const row = el('div', { class: 'tt-row' });
    for (const d of ['easy', 'medium', 'hard']) {
      const b = el('button', { class: 'tt-btn', type: 'button' }, d[0].toUpperCase() + d.slice(1));
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
    const wrap = this.screenShell('Score Chase', 'Global, daily and friends boards.');
    wrap.appendChild(this.backButton());
    const tabs = el('div', { class: 'tt-row', role: 'tablist' });
    for (const b of ['global', 'daily', 'friends']) {
      const t = el('button', {
        class: 'tt-btn tt-btn-sm' + (b === active ? ' tt-btn-primary' : ''), type: 'button', role: 'tab',
        ariaSelected: String(b === active),
      }, b[0].toUpperCase() + b.slice(1));
      t.addEventListener('click', () => this.h.showScores(b));
      tabs.appendChild(t);
    }
    wrap.appendChild(tabs);
    const data = boards[active];
    const list = el('ol', { class: 'tt-scores' });
    if (!data) {
      wrap.appendChild(el('p', { class: 'tt-dim' }, 'Loading…'));
    } else if (data.error) {
      wrap.appendChild(el('p', { class: 'tt-dim' }, 'Leaderboard unavailable — showing your local board (casual/local).'));
      for (const e of data.local.slice(0, 20)) {
        list.appendChild(el('li', {}, e.total + ' · ' + (e.levelId || '') + (e.delivered ? ' · delivered' : '')));
      }
    } else {
      for (const e of data.entries.slice(0, 20)) {
        list.appendChild(el('li', {}, (e.name || 'anon') + ' — ' + e.total));
      }
      if (!data.entries.length) wrap.appendChild(el('p', { class: 'tt-dim' }, 'No scores yet. Be the first.'));
    }
    wrap.appendChild(list);
    this.showScreen('Leaderboard', wrap);
  }

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------
  showSettings(settings, progress, totalStars) {
    const wrap = this.screenShell('Settings', 'Sound, display and access.');
    wrap.appendChild(this.backButton());
    const form = el('div', { class: 'tt-form' });
    const save = () => this.h.saveSettings(settings);

    const slider = (label, key) => {
      const lab = el('label', { class: 'tt-field' });
      lab.append(el('span', {}, label));
      const inp = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(settings[key]) });
      inp.addEventListener('input', () => { settings[key] = parseFloat(inp.value); save(); });
      lab.appendChild(inp);
      form.appendChild(lab);
    };
    slider('Music volume', 'music');
    slider('Effects volume', 'effects');
    slider('Ambience volume', 'ambience');

    const toggle = (label, key) => {
      const lab = el('label', { class: 'tt-field tt-field-check' });
      const inp = el('input', { type: 'checkbox' });
      inp.checked = !!settings[key];
      inp.addEventListener('change', () => { settings[key] = inp.checked; save(); });
      lab.append(inp, el('span', {}, label));
      form.appendChild(lab);
    };
    toggle('Mute all', 'muted');
    toggle('Reduced motion', 'reducedMotion');
    toggle('High contrast palette', 'highContrast');
    toggle('Larger text', 'largeText');
    toggle('Left-handed layout', 'leftHanded');

    const qlab = el('label', { class: 'tt-field' });
    qlab.append(el('span', {}, 'Quality tier'));
    const sel = el('select', {});
    for (const q of ['auto', 'low', 'medium', 'high']) {
      const o = el('option', { value: q }, q);
      if (settings.quality === q) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => { settings.quality = sel.value; save(); });
    qlab.appendChild(sel);
    form.appendChild(qlab);

    // Cosmetics picker (unlocked by total stars; cosmetic only).
    const unlocked = unlockedCosmetics(totalStars);
    for (const slot of Object.keys(COSMETICS)) {
      const lab = el('label', { class: 'tt-field' });
      lab.append(el('span', {}, 'Cosmetic · ' + slot));
      const cs = el('select', {});
      for (const c of COSMETICS[slot]) {
        const has = unlocked[slot].includes(c.id);
        const o = el('option', { value: c.id }, c.name + (has ? '' : ' (needs ' + c.stars + '★)'));
        if (!has) o.disabled = true;
        if (progress.cosmetics[slot] === c.id) o.selected = true;
        cs.appendChild(o);
      }
      cs.addEventListener('change', () => { progress.cosmetics[slot] = cs.value; this.h.saveProgress(); });
      lab.appendChild(cs);
      form.appendChild(lab);
    }

    const reset = el('button', { class: 'tt-btn tt-btn-ghost', type: 'button' }, 'Reset tutorial progress');
    reset.addEventListener('click', () => {
      progress.tutorialsDone = [];
      this.h.saveProgress();
      this.toast('Tutorials reset — Learn mode starts fresh.');
    });
    form.appendChild(reset);

    wrap.appendChild(form);
    this.showScreen('Settings', wrap);
  }

  // -------------------------------------------------------------------------
  // Help
  // -------------------------------------------------------------------------
  showHelp(bindings) {
    const wrap = this.screenShell('How to Play', 'Deliver the treat to Morsel. Collect stars on the way.');
    wrap.appendChild(this.backButton());
    const grid = el('div', { class: 'tt-helpgrid' });
    for (const m of MECHANIC_HELP) {
      const card = el('div', { class: 'tt-helpcard' });
      card.append(el('h3', {}, m.title), el('p', {}, m.body.replace('{confirm}', bindings.confirm)));
      grid.appendChild(card);
    }
    wrap.appendChild(grid);
    const keys = el('div', { class: 'tt-panel-inner' });
    keys.appendChild(el('h3', {}, 'Controls'));
    const ul = el('ul', {});
    for (const line of [
      bindings.confirm + ' — confirm focused action',
      'Arrow keys / D-pad — cycle targets',
      'Esc / Start — pause',
      'U — undo · H — hint · R — restart · C — camera reset',
      'Swipe across a rope, tap bubbles and fans',
    ]) ul.appendChild(el('li', {}, line));
    keys.appendChild(ul);
    wrap.appendChild(keys);
    this.showScreen('Help', wrap);
  }

  // -------------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------------
  showResults({ score, level, par, won, achievements, nextLabel, submitted }) {
    const wrap = this.screenShell(won ? 'Delivered!' : 'Try Again', level.name);
    if (!won) wrap.appendChild(el('p', { class: 'tt-sub' }, REASON_TEXT[score.reason] || 'The treat got away.'));

    const starsRow = el('p', { class: 'tt-stars-big', ariaLabel: score.stars + ' of ' + level.layout.stars.length + ' stars' },
      '★'.repeat(score.stars) + '☆'.repeat(Math.max(0, level.layout.stars.length - score.stars)));
    wrap.appendChild(starsRow);

    const table = el('dl', { class: 'tt-score-table' });
    for (const c of score.components) {
      table.append(el('dt', {}, scoreLabel(c)), el('dd', {}, '+' + c.amount));
    }
    table.append(el('dt', { class: 'tt-total' }, 'Total'), el('dd', { class: 'tt-total' }, String(score.total)));
    wrap.appendChild(table);

    const facts = [];
    if (par && par.actions) facts.push('Par ' + par.actions + ' actions — you used ' + score.actionsUsed + '.');
    if (par && par.seconds) facts.push('Par ' + par.seconds + 's — you took ' + (score.ticks / 120).toFixed(1) + 's.');
    if (submitted === false) facts.push('Score saved to your local board.');
    if (facts.length) wrap.appendChild(el('p', { class: 'tt-dim' }, facts.join(' ')));

    for (const key of achievements || []) {
      const a = ACHIEVEMENTS.find((x) => x.key === key);
      if (a) wrap.appendChild(el('p', { class: 'tt-ach' }, '🏅 ' + a.name + ' — ' + a.desc));
    }

    const row = el('div', { class: 'tt-row' });
    const retry = el('button', { class: 'tt-btn', type: 'button' }, 'Retry (R)');
    retry.addEventListener('click', () => this.h.action('retry'));
    row.appendChild(retry);
    if (nextLabel) {
      const next = el('button', { class: 'tt-btn tt-btn-primary', type: 'button' }, nextLabel);
      next.addEventListener('click', () => this.h.action('next'));
      row.appendChild(next);
    }
    const modes = el('button', { class: 'tt-btn tt-btn-ghost', type: 'button' }, 'Mode select');
    modes.addEventListener('click', () => this.h.goTitle());
    row.appendChild(modes);
    wrap.appendChild(row);
    this.announce((won ? 'Delivered! ' : 'Round over. ') + 'Score ' + score.total + ', ' + score.stars + ' stars.');
    this.showScreen('Results', wrap);
  }

  // -------------------------------------------------------------------------
  // Pause
  // -------------------------------------------------------------------------
  showPause() {
    const wrap = this.screenShell('Paused', 'The treat waits for you.');
    const row = el('div', { class: 'tt-row tt-col' });
    const resume = el('button', { class: 'tt-btn tt-btn-primary', type: 'button' }, 'Resume (Esc)');
    resume.addEventListener('click', () => this.h.action('resume'));
    const restart = el('button', { class: 'tt-btn', type: 'button' }, 'Restart (R)');
    restart.addEventListener('click', () => this.h.action('restart'));
    const quit = el('button', { class: 'tt-btn tt-btn-ghost', type: 'button' }, 'Quit to title');
    quit.addEventListener('click', () => this.h.goTitle());
    row.append(resume, restart, quit);
    wrap.appendChild(row);
    this.showScreen('Paused', wrap);
  }

  // -------------------------------------------------------------------------
  // Countdown overlay
  // -------------------------------------------------------------------------
  showCountdown(n) {
    this.showScreen('Countdown', el('div', { class: 'tt-countdown', role: 'status' }, n > 0 ? String(n) : 'Go!'));
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
    parts.push('★ ' + got + '/' + s.stars.length);
    if (s.moveLimit) parts.push('Moves left: ' + Math.max(0, s.moveLimit - s.actionsUsed));
    else parts.push('Actions: ' + s.actionsUsed + (s.parActions ? ' / par ' + s.parActions : ''));
    if (s.timeLimitTicks) {
      const left = Math.max(0, (s.timeLimitTicks - s.tick) / 120);
      parts.push('⏱ ' + left.toFixed(1) + 's');
    }
    this.hudStats.textContent = parts.join(' · ');
    let obj = 'Deliver the treat to Morsel';
    if (s.requireStars) obj += ' — collect all ' + s.requireStars + ' stars';
    if (level.mastery) obj += ' (mastery stage)';
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
      this.mirrorList.appendChild(el('li', { class: 'tt-dim' }, 'No actions available right now.'));
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
  if (a.type === 'cut') return 'Snip ' + a.id;
  if (a.type === 'pop') return 'Pop ' + a.id;
  return 'Fan ' + a.id + ' ' + (a.on ? 'on' : 'off');
}

function scoreLabel(c) {
  switch (c.key) {
    case 'stars': return 'Stars ×' + c.count;
    case 'delivery': return 'Delivery bonus';
    case 'actions': return 'Under par ×' + c.count;
    case 'time': return 'Time to spare ' + c.count + 's';
    default: return c.key;
  }
}
