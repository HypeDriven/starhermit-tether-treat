// i18n.js — Tether Treat localization runtime.
// The language comes from sh-language.js (window.StarHermitLanguage): explicit
// game choice (ui.language) → StarHermit account preferredLanguage → device
// languages → en-US. A change notifies listeners (onLanguage) so the DOM shell
// relabels in place without restarting the round.

import { STRINGS } from './strings.js';

export const SUPPORTED = Object.keys(STRINGS);
let lang = 'en-US';
let dict = STRINGS[lang];
const listeners = new Set();

export function locale() { return lang; }

const fill = (s, vars) => (vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : s);

/** Localized string for key with {placeholders} filled from vars. */
export function t(key, vars) {
  return fill((dict && dict[key]) ?? STRINGS['en-US'][key] ?? key, vars);
}

/** Localized content name from a nested map (levels, blurbs, coach, worlds, mechanics, achievements, cosmetics). */
export function tn(group, id, fallback) {
  const own = dict && dict[group] && dict[group][id];
  if (own != null) return own;
  const en = STRINGS['en-US'][group] && STRINGS['en-US'][group][id];
  return en != null ? en : fallback;
}

/** fn(locale) runs after every language change. */
export function onLanguage(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function setLocale(next) {
  lang = STRINGS[next] ? next : 'en-US';
  dict = STRINGS[lang];
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  for (const fn of listeners) { try { fn(lang); } catch (e) { console.error(e); } }
}

const SL = typeof window !== 'undefined' ? window.StarHermitLanguage : null;
export const language = SL ? SL.create({ game: 'tether-treat', supported: SUPPORTED, apply: setLocale }) : null;

/** Display name of a level (authored, challenge, daily or practice). */
export function levelName(level) {
  if (!level) return '';
  let m;
  if ((m = /^daily-(.+)$/.exec(level.id))) return t('dailyName', { date: m[1] });
  if ((m = /^practice-(easy|medium|hard)-/.exec(level.id))) return t('practiceName', { level: t('diff' + m[1][0].toUpperCase() + m[1].slice(1)) });
  return tn('levels', level.id, level.name);
}

/** Tutorial coach text for a lesson step (falls back to the authored English). */
export function coachText(levelId, index, fallback) {
  const steps = tn('coach', levelId, null);
  return (steps && steps[index]) || fallback;
}

/** Built-in fallback names ('Player <id>') are localized at render time. */
export function playerName(name) {
  const m = /^Player (\S+)$/.exec(String(name || ''));
  return m ? t('playerN', { id: m[1] }) : name;
}
