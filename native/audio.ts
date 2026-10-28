// Sound, as the browser build's js/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per rules event and the error buzz;
// the quiet music (a sine arpeggio on a pentatonic ladder from the theme's
// base frequency: every 840 ms a 0.5 s note, gain 0.16 falling exponentially
// to 0.001) and the ambience pad (two seconds of white noise through a
// 320 Hz low-pass, looping), both while a round runs. The notes and the pad
// are rendered once into clips (a slice a frame, from a sine table) and play
// on the music bus — the runtime has no ambience bus — at the old buses'
// default ratio (music 0.6 × 0.35, ambience 0.5 × 0.25). The synthesized
// fallbacks audio.js played while a sample decoded are not ported (a live
// synthesis graph makes clip loads fail on the web runtime): a clip still
// loading is silent. The runtime's Options own the volumes, the mute and the
// voice limit. Clips load once the mixer runs (natively at once, in a
// browser after the first press), one at a time.
import { context, createClip, loadClip, play as playClip, type AudioClip, type Sound } from "starhermit:audio";
import { makeRng } from "../js/rng.js";

/** audio.js SAMPLES: event → sfx/<name>.opus. */
const SAMPLES: Record<string, string> = {
  "cut": "rope-snip", "bubble-attach": "bubble-attach", "bubble-pop": "bubble-pop", "fan": "fan-burst",
  "bumper": "bumper-boing", "star": "star-chime", "hazard": "hazard-clank", "delivered": "delivered-fanfare",
  "stalled": "stalled-wind-down", "time-up": "time-up-buzzer", "out": "out-fall", "errorBuzz": "error-buzz",
};
const clips = new Map<string, AudioClip>();
const queue: string[] = [];
let loading = false;
let wanted = false;
let suspended = false;

/** Ask for the clips (they load once the mixer runs). */
export function start(): void { wanted = true; }

function sample(name: string): void {
  if (suspended) return;
  const clip = clips.get(name);
  if (!clip) return;
  try { playClip(clip, { bus: "effects" }); } catch { clips.delete(name); if (!queue.includes(name)) queue.push(name); }
}
/** audio.js playEvents: the tick's rules events. */
export function playEvents(events: { type: string }[]): void {
  for (const ev of events) { const n = SAMPLES[ev.type]; if (n) sample(n); }
}
export function errorBuzz(): void { sample(SAMPLES.errorBuzz!); }

// -- synthesis into clips ----------------------------------------------------------------------
const RATE = 22050;
const SINE_N = 4096;
const SINE = new Float32Array(SINE_N + 1);
for (let i = 0; i <= SINE_N; i++) SINE[i] = Math.sin((2 * Math.PI * i) / SINE_N);
function sin1(phase: number): number {
  const p = (phase - Math.floor(phase)) * SINE_N, i = p | 0, f = p - i;
  return SINE[i]! + (SINE[i + 1]! - SINE[i]!) * f;
}
const MUSIC_GAIN = 0.6 * 0.35, AMB_GAIN = 0.5 * 0.25;
/** blip('music', f, 0.5, 'sine', 0.16): gain 0.16 falling exponentially to 0.001 over 0.5 s (stopped 20 ms later). */
const NOTE_N = Math.round(RATE * 0.52);
function renderNote(f: number): Float32Array {
  const out = new Float32Array(NOTE_N);
  const k = Math.log(0.001 / 0.16) / 0.5;
  for (let i = 0; i < NOTE_N; i++) {
    const t = i / RATE;
    out[i] = sin1(f * t) * 0.16 * MUSIC_GAIN * Math.exp(k * Math.min(t, 0.5));
  }
  return out;
}
/** The pad: 2 s of noise, a 320 Hz biquad low-pass (Q 0.707), sliced across frames. */
const AMB_N = RATE * 2;
const amb = new Float32Array(AMB_N);
let ambPos = 0;
const lp = (() => {
  const w = (2 * Math.PI * 320) / RATE, q = Math.SQRT1_2, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al;
  return { b0: (1 - c) / 2 / a0, b1: (1 - c) / a0, b2: (1 - c) / 2 / a0, a1: (-2 * c) / a0, a2: (1 - al) / a0 };
})();
let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
const noise = makeRng("tether-treat|ambience");
function renderAmbience(count: number): boolean {
  const end = Math.min(AMB_N, ambPos + count);
  for (; ambPos < end; ambPos++) {
    const x = noise.float() * 2 - 1;
    const y = lp.b0 * x + lp.b1 * x1 + lp.b2 * x2 - lp.a1 * y1 - lp.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    amb[ambPos] = y * AMB_GAIN;
  }
  return ambPos >= AMB_N;
}
let ambClip: AudioClip | null = null;
let ambVoice: Sound | null = null;
const SCALE = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2];
const noteSets = new Map<number, AudioClip[]>();
let base = 196;
let music = false;
let arpStep = 0;
let arpIn = 0;

/** audio.js startMusic(theme): the pad and the arpeggio on the theme's base frequency. */
export function startMusic(baseFreq: number): void { base = baseFreq || 196; music = true; }
/** audio.js stopMusic. */
export function stopMusic(): void {
  music = false;
  try { ambVoice?.stop(); } catch { /* gone */ }
  ambVoice = null;
}
/** A hidden window silences the game (the arpeggio skipped while document.hidden). */
export function setSuspended(on: boolean): void {
  if (on === suspended) return;
  suspended = on;
  try { ambVoice?.fade(on ? 0 : 1, 0.2); } catch { /* gone */ }
}

/** Each frame: the clips once the mixer runs (one at a time), then the pad and the arpeggio. */
export function update(dt: number): void {
  if (!wanted || context.state !== "running") return;
  if (!queue.length && !clips.size && !loading) for (const n of Object.values(SAMPLES)) queue.push(n);
  if (!loading && queue.length) {
    const name = queue.shift()!;
    if (!clips.has(name)) {
      loading = true;
      loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); loading = false; }, (e: unknown) => {
        console.warn(`sfx ${name}: ${e instanceof Error ? e.message : String(e)}`);
        loading = false;
      });
    }
    return;
  }
  if (loading) return;
  if (!ambClip) {
    if (!renderAmbience(12000)) return;
    try { ambClip = createClip([amb], RATE); } catch (e) { console.warn(`audio: ${String(e)}`); ambPos = 0; }
    return;
  }
  let notes = noteSets.get(base);
  if (!notes) { notes = []; noteSets.set(base, notes); }
  if (notes.length < SCALE.length) {
    try { notes.push(createClip([renderNote(base * SCALE[notes.length]!)], RATE)); } catch (e) { console.warn(`audio: ${String(e)}`); }
    return;
  }
  if (!music) return;
  if (!ambVoice) {
    try { ambVoice = playClip(ambClip, { bus: "music", gain: suspended ? 0 : 1, loop: true }); } catch { ambVoice = null; }
    return;
  }
  // audio.js startMusic's 420 ms timer: a note on every other step
  arpIn -= dt * 1000;
  if (arpIn > 0) return;
  arpIn += 420;
  if (arpIn < 0) arpIn = 420;
  const step = arpStep++;
  if (suspended || step % 2 !== 0) return;
  const deg = [0, 2, 4, 3, 5, 4, 2, 1][(step / 2) % 8]!;
  try { playClip(notes[deg]!, { bus: "music" }); } catch { /* busy */ }
}
