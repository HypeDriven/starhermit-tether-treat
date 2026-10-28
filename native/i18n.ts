// Localization: the browser build's tables (js/strings.js: flat keys plus
// per-id maps for levels, blurbs, coach steps, worlds, mechanics,
// achievements and cosmetics, in the nine StarHermit locales; the account
// strings in js/sh-i18n.js) in the interface language the runtime reports
// (preferences().language: the player's choice in Options › Language, else
// the account's preferred language or the device's). The runtime's Options
// replace the game's own Language setting (sh-language.js) and the DOM
// relabelling: every string is drawn through T() each frame, so a change
// shows on the next frame and never restarts the round.
import { onPreferencesChange, preferences } from "starhermit:engine";
import * as ui from "starhermit:ui";
import { STRINGS } from "../js/strings.js";
import { shLocale, shText } from "../js/sh-i18n.js";
import type { Level } from "./game.ts";

type Table = Record<string, unknown>;
const TABLES = STRINGS as unknown as Record<string, Table>;
const EN = TABLES["en-US"]!;
let locale = "";
let dict: Table = EN;

function apply(tag: string): void {
  const next = shLocale(String(tag || "en-US")) as string;
  const loc = TABLES[next] ? next : "en-US";
  if (loc === locale) return;
  locale = loc;
  dict = TABLES[loc]!;
  ui.setLanguage(locale);
}
apply(preferences().language);
onPreferencesChange((p) => apply(p.language));

export function currentLocale(): string { return locale; }
export type Vars = Record<string, string | number>;
const fill = (s: string, vars?: Vars | null): string =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] != null ? String(vars[k]) : m)) : s;
/** i18n.js t(): the key's string with {name} placeholders from vars. */
export function T(key: string, vars?: Vars | null): string {
  const s = dict[key] ?? EN[key] ?? key;
  return fill(String(s), vars);
}
/** i18n.js tn(): a content name from a nested map (levels, blurbs, coach, worlds, mechanics, achievements, cosmetics). */
export function tn<V>(group: string, id: string | number, fallback: V): V {
  const own = (dict[group] as Record<string, unknown> | undefined)?.[id];
  if (own != null) return own as V;
  const en = (EN[group] as Record<string, unknown> | undefined)?.[id];
  return (en != null ? en : fallback) as V;
}
/** The account strings (signIn, invite, copied, copyFail, signedOut, lbPosting, lbRank, lbPosted, lbNotPosted). */
export function S(key: string, vars?: Vars): string { return shText(key, vars ?? {}, locale) as string; }
/** i18n.js levelName: authored, challenge, daily or practice. */
export function levelName(level: Level | null): string {
  if (!level) return "";
  let m: RegExpExecArray | null;
  if ((m = /^daily-(.+)$/.exec(level.id))) return T("dailyName", { date: m[1]! });
  if ((m = /^practice-(easy|medium|hard)-/.exec(level.id))) return T("practiceName", { level: T("diff" + m[1]![0]!.toUpperCase() + m[1]!.slice(1)) });
  return tn("levels", level.id, level.name);
}
/** i18n.js coachText. */
export function coachText(levelId: string, index: number, fallback: string): string {
  const steps = tn<string[] | null>("coach", levelId, null);
  return (steps && steps[index]) || fallback;
}
/** i18n.js playerName: built-in fallback names ('Player <id>') localized. */
export function playerName(name: string): string {
  const m = /^Player (\S+)$/.exec(String(name || ""));
  return m ? T("playerN", { id: m[1]! }) : name;
}
