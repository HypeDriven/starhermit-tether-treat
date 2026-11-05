// Localization: assets/strings.json (generated from the browser build's tables:
// flat keys plus per-id keys for levels, blurbs, coach steps, worlds, mechanics,
// achievements and cosmetics, in the nine StarHermit locales) on the engine's
// strings, which follow the interface language the runtime reports (the
// player's choice in Options › Language, else the account's preferred language
// or the device's) and own the locale fallback and the account strings
// (`starhermit.*`). Every string is drawn through T() each frame, so a change
// shows on the next frame and never restarts the round.
import { strings } from "starhermit:engine";
import * as ui from "starhermit:ui";
import type { Level } from "./game.ts";

strings.load("assets/strings.json");
strings.defaultLocale = "en-US";
ui.setLanguage(strings.locale);
strings.onChange((locale) => ui.setLanguage(locale));

export type Vars = Record<string, string | number>;
/** i18n.js t(): the key's string with {name} placeholders from vars. */
export function T(key: string, vars?: Vars | null): string { return strings.t(key, vars ?? undefined); }
/** i18n.js tn(): a content name by group and id (levels, blurbs, coach, worlds, mechanics, achievements, cosmetics). */
export function tn(group: string, id: string | number, fallback: string): string {
  const key = `${group}.${id}`;
  return strings.has(key) ? strings.t(key) : fallback;
}
/** The engine's account strings (signIn, invite, inviteCopied, inviteFailed, signedOut, leaderboard…). */
export function S(key: string, vars?: Vars): string { return strings.t(`starhermit.${key}`, vars); }
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
  return tn("coach", `${levelId}.${index}`, fallback);
}
/** i18n.js playerName: built-in fallback names ('Player <id>') localized. */
export function playerName(name: string): string {
  const m = /^Player (\S+)$/.exec(String(name || ""));
  return m ? T("playerN", { id: m[1]! }) : name;
}
