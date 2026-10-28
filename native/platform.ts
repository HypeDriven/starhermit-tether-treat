// The game's data and the StarHermit platform, on the runtime's modules (what
// js/storage.js and js/net.js did over localStorage and the JS SDK):
// - the save (starhermit:storage `saves`, schema 1: on the device and in the
//   player's cloud slot) is the progression document (js/save.js); two
//   devices' saves merge on a conflict (mergeProgress, as the browser build
//   did on its saveconflict, this device's cosmetics and Continue target
//   winning); the slot the browser build wrote through the JS SDK
//   (game:<slug>: { savedAt, progress }) shows as foreign: it is merged in
//   (the cloud's cosmetics winning, as at the old start) and replaced once;
// - the game's own option (the left-handed layout) is an engine `setting`
//   (synced with the account); the browser build's value in the account's
//   settings KV (leftHanded) is adopted (unless set here since), then all its
//   KV keys go (volumes, mute, graphics, reduced motion, high contrast and
//   larger text are the runtime's Options; ui.language is its Language);
// - the player, the invite link, the platform's clock for the Daily, the
//   high-score board's pages for Score Chase, and posting a finished round's
//   total through score-script.js (a practice session whose socket carries
//   { type: 'result', scores }, as the JS SDK's submitScores did) with the rank.
import type { JsonValue } from "starhermit:engine";
import { connectGame, inviteLink as fetchInviteLink, leaderboards, onPlayerChange, player, serverNow, serverTime, sessions, type Leaderboard } from "starhermit:platform";
import { saves, settings as store } from "starhermit:storage";
import { SaveModel, type Options, type Progress, type SaveDoc } from "./game.ts";

// --- the save --------------------------------------------------------------------------------
let data: SaveDoc = SaveModel.emptySave();
let lastSavedAt = 0;
const mergedListeners = new Set<() => void>();
/** fn() after progress from the account (another device, the browser build) was merged in. */
export function onProgressMerged(fn: () => void): void { mergedListeners.add(fn); }
function merged(): void { for (const fn of mergedListeners) fn(); }

function write(opts: { replaceForeign?: boolean } = {}): void {
  try {
    saves.save(data as unknown as JsonValue, { schema: 1, ...opts });
    lastSavedAt = saves.load()?.savedAt ?? lastSavedAt;
  } catch (e) { console.warn(`save: ${String(e)}`); }
}
/** The live progression (change it, then persist()). */
export function progress(): Progress { return data.progress; }
/** Saves (the device at once, the account debounced by the runtime). */
export function persist(): void {
  data.progress.totalStars = SaveModel.totalStars(data.progress);
  write();
}
function adopt(other: unknown, prefer: "remote" | "local"): boolean {
  const next = SaveModel.mergeSave(other, data, prefer);
  if (SaveModel.sameSave(next, data)) return false;
  data = next;
  write();
  return true;
}
saves.onConflict((mine, remote) => ({ merged: SaveModel.mergeSave(remote.data, mine?.data ?? null, "local") as unknown as JsonValue }));
saves.onStatus((_status, state) => {
  if (state === "foreign") { migrateForeign(); return; }
  const cur = saves.load();
  if (cur && cur.savedAt !== lastSavedAt) {
    lastSavedAt = cur.savedAt;
    if (adopt(cur.data, "local")) merged();
  }
});
/** The browser build's cloud slot: merged with this device's save (the cloud's cosmetics winning), saved over it once. */
function migrateForeign(): void {
  const old = saves.foreign();
  if (!old) return;
  const doc = old.text != null ? SaveModel.readForeign(old.text) : null;
  let grew = false;
  if (doc) {
    const next = SaveModel.mergeSave(doc, data, "remote");
    grew = !SaveModel.sameSave(next, data);
    data = next;
  }
  write({ replaceForeign: true });
  if (grew) merged();
}

/** net.js sync state for the header: offline (a guest), loading, saving, synced or error. */
export function syncState(): "offline" | "loading" | "saving" | "synced" | "error" {
  if (!player()) return "offline";
  const st = saves.state();
  if (st === "error" || st === "read-blocked") return "error";
  if (st === "loading") return "loading";
  if (st === "foreign" || st === "uploading" || saves.status() === "pending") return "saving";
  return "synced";
}
export function flush(): void { void saves.flush().catch(() => undefined); }

// --- the game's options -----------------------------------------------------------------------
export const options: Options = { ...SaveModel.DEFAULT_OPTIONS };
const KEYS = SaveModel.OPTION_KEYS;
function readOption(key: keyof Options): void {
  let v: JsonValue | undefined;
  try { v = store.get(key); } catch { return; }
  const ok = SaveModel.pickOptions({ [key]: v })[key];
  if (ok !== undefined) options[key] = ok;
}
/** A migrated value, kept unless this game set the key since. */
function adoptOption(key: keyof Options, value: unknown): void {
  const v = SaveModel.pickOptions({ [key]: value })[key];
  if (v === undefined) return;
  try {
    if (store.get(key) !== undefined) return;
    store.set(key, v);
    options[key] = v;
  } catch { /* keep the device's */ }
}
/** Changes one of the game's options (device and account). */
export function setOption<K extends keyof Options>(key: K, value: Options[K]): void {
  if (options[key] === value) return;
  options[key] = value;
  try { store.set(key, value as JsonValue); } catch (e) { console.warn(`option ${key}: ${String(e)}`); }
}
/** The browser build's settings KV: leftHanded carries over (unless set here since), then all its keys go. */
function importLegacy(): void {
  const keys = store.legacyKeys();
  if (!keys) return;
  const kv: Record<string, unknown> = {};
  for (const key of keys) kv[key] = store.legacy(key);
  for (const [k, v] of Object.entries(SaveModel.pickOptions(kv))) adoptOption(k as keyof Options, v);
  for (const key of keys) if (SaveModel.BROWSER_KEYS.includes(key) || key.startsWith("ui.")) store.removeLegacy(key);
}

/** Reads the device's save and the game's options (from onStart). */
export function initPlatform(): void {
  const cur = saves.load();
  lastSavedAt = cur?.savedAt ?? 0;
  data = SaveModel.normalize(cur?.data ?? null);
  for (const k of KEYS) readOption(k);
  store.onChange((key) => { if ((KEYS as string[]).includes(key)) readOption(key as keyof Options); });
  store.onLegacy(importLegacy);
  importLegacy();
  if (saves.state() === "foreign") migrateForeign();
  refreshPlayer();
  void serverTime().then(() => undefined, () => undefined);
}

// --- the player and the clock -----------------------------------------------------------------
export function signedIn(): boolean { return !!player(); }
export function displayName(): string { return player()?.displayName ?? ""; }
let invite: string | null = null;
/** The invite link, fetched ahead so a button press can copy it at once. */
export function inviteLink(): string | null { return player() ? invite : null; }
function refreshPlayer(): void {
  invite = null;
  board = undefined;
  if (!player()) return;
  fetchInviteLink().then((u) => { invite = u; }, () => { invite = null; });
}
const playerListeners = new Set<() => void>();
export function onPlayer(fn: () => void): void { playerListeners.add(fn); }
onPlayerChange(() => { refreshPlayer(); for (const fn of playerListeners) fn(); });

/** Now by the platform's clock when it has answered, else the device's (the Daily's UTC day). */
export function now(): Date {
  try { return new Date(serverNow() ?? Date.now()); } catch { return new Date(); }
}
/** Whether the Daily's day comes from the platform clock (else "local clock"). */
export function serverClock(): boolean { try { return serverNow() != null; } catch { return false; } }

// --- the high-score board ---------------------------------------------------------------------
let board: Leaderboard | null | undefined;
async function highScoreBoard(): Promise<Leaderboard | null> {
  if (board !== undefined) return board;
  const list = await leaderboards.list();
  board = list.find((b) => b.key === "high-score") ?? list[0] ?? null;
  return board;
}
export interface Entry { name: string; total: number }
/** net.js fetchLeaderboard: the top 20 (friends only for "friends"); null when unavailable. */
export async function fetchBoard(which: string): Promise<Entry[] | null> {
  try {
    const b = await highScoreBoard();
    if (!b) return null;
    if (which === "friends" && !player()) return null;
    const r = await leaderboards.entries(b.id, { pageSize: 20, ...(which === "friends" ? { friendsOnly: true } : {}) });
    return r.items.slice(0, 20).map((e) => ({ name: e.displayName || e.username || "", total: e.score }));
  } catch { return null; }
}
export interface Posted { posted: boolean; rank: number | null }
/** net.js submitScore: signed in only, a finished round's total through score-script.js; { posted, rank }. Never rejects. */
export async function postScore(total: number): Promise<Posted> {
  const me = player();
  if (!me) return { posted: false, rank: null };
  const score = Math.max(0, Math.round(total));
  let accepted: string[] = [];
  try {
    const sessionId = await sessions.practice();
    accepted = await new Promise<string[]>((resolve) => {
      const socket = connectGame(sessionId);
      let done = false;
      const finish = (list: string[]): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.close();
        resolve(list);
      };
      const timer = setTimeout(() => finish([]), 15000);
      socket.on("open", () => { socket.sendCommand({ type: "result", scores: { "high-score": score } }); });
      socket.on("game", (d) => {
        const m = d as { type?: string; accepted?: string[] } | null;
        if (m && m.type === "result-ack") finish(Array.isArray(m.accepted) ? m.accepted : []);
      });
      socket.on("error", () => finish([]));
      socket.on("stopped", () => finish([]));
      socket.on("abandoned", () => finish([]));
    });
  } catch { return { posted: false, rank: null }; }
  if (!accepted.includes("high-score")) return { posted: false, rank: null };
  try {
    const b = await highScoreBoard();
    if (!b) return { posted: true, rank: null };
    const r = await leaderboards.entries(b.id, { pageSize: 100 });
    const mine = r.items.find((e) => e.userId === me.userId);
    return { posted: true, rank: mine ? mine.rank : null };
  } catch { return { posted: true, rank: null }; }
}
