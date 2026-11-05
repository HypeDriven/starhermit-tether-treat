// Sound, as the browser build's js/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per rules event and the error buzz;
// the quiet music (a sine arpeggio on a pentatonic ladder from the theme's
// base frequency: every 840 ms a 0.5 s note, gain 0.16 falling exponentially
// to 0.001) and the ambience pad (two seconds of white noise through a
// 320 Hz low-pass, looping), both while a round runs. The notes and the pad
// are rendered once into clips (OfflineAudioContext) and play
// on the music bus — the runtime has no ambience bus — at the old buses'
// default ratio (music 0.6 × 0.35, ambience 0.5 × 0.25). The synthesized
// fallbacks audio.js played while a sample decoded are not ported: a clip still
// loading is silent. The runtime's Options own the volumes, the mute and the
// voice limit. Clips load and the pad renders in onStart; only starting the
// loops waits for the mixer (in a browser, the first press).
import { context, createClip, loadClip, OfflineAudioContext, play as playClip, type AudioClip, type Sound } from "starhermit:audio";

/** audio.js SAMPLES: event → sfx/<name>.opus. */
const SAMPLES: Record<string, string> = {
  "cut": "rope-snip", "bubble-attach": "bubble-attach", "bubble-pop": "bubble-pop", "fan": "fan-burst",
  "bumper": "bumper-boing", "star": "star-chime", "hazard": "hazard-clank", "delivered": "delivered-fanfare",
  "stalled": "stalled-wind-down", "time-up": "time-up-buzzer", "out": "out-fall", "errorBuzz": "error-buzz",
};
const clips = new Map<string, AudioClip>();
let suspended = false;

/** Loads every clip at once and renders the pad (onStart). */
export function start(): void {
  for (const name of Object.values(SAMPLES)) {
    loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); }, (e: unknown) => { console.warn(`sfx ${name}: ${e instanceof Error ? e.message : String(e)}`); });
  }
  renderAmbience().then((c) => { ambClip = c; }, warn);
}

function sample(name: string): void {
  if (suspended) return;
  const clip = clips.get(name);
  if (!clip) return;
  try { playClip(clip, { bus: "effects" }); } catch { /* the mixer is full this frame: skip it */ }
}
/** audio.js playEvents: the tick's rules events. */
export function playEvents(events: { type: string }[]): void {
  for (const ev of events) { const n = SAMPLES[ev.type]; if (n) sample(n); }
}
export function errorBuzz(): void { sample(SAMPLES.errorBuzz!); }

// -- synthesis into clips ----------------------------------------------------------------------
const RATE = 22050;
const warn = (e: unknown): void => { console.warn(`audio: ${String(e)}`); };
const MUSIC_GAIN = 0.6 * 0.35, AMB_GAIN = 0.5 * 0.25;
/** blip('music', f, 0.5, 'sine', 0.16): gain 0.16 falling exponentially to 0.001 over 0.5 s (stopped 20 ms later). */
async function renderNote(f: number): Promise<AudioClip> {
  const off = new OfflineAudioContext(1, Math.round(RATE * 0.52), RATE);
  const osc = off.createOscillator(); osc.frequency.value = f;
  const g = off.createGain();
  g.gain.setValueAtTime(0.16 * MUSIC_GAIN, 0);
  g.gain.exponentialRampToValueAtTime(0.001 * MUSIC_GAIN, 0.5);
  osc.connect(g).connect(off.destination); osc.start();
  const r = await off.startRendering();
  return createClip(r);
}
const AMB_MAKEUP = 1.018; // make-up to the old pad's rms (.0129)
/** The pad: 2 s of noise through a 320 Hz low-pass (Q 0.707, -3 dB). Filtered periodic noise is periodic once settled: no crossfade. */
async function renderAmbience(): Promise<AudioClip> {
  const settle = Math.round(0.25 * RATE);
  const off = new OfflineAudioContext(1, settle + RATE * 2, RATE);
  const noise = off.createNoise({ seed: 0x7e77, seconds: 2 });
  const lp = off.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 320; lp.Q.value = -3.01;
  const g = off.createGain(); g.gain.value = AMB_GAIN * AMB_MAKEUP;
  noise.connect(lp).connect(g).connect(off.destination); noise.start();
  const r = await off.startRendering();
  return createClip([r.getChannelData(0).slice(settle)], RATE);
}
let ambClip: AudioClip | null = null;
let ambVoice: Sound | null = null;
const SCALE = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2];
const noteSets = new Map<number, AudioClip[]>();
/** The theme's six notes, rendered once. */
function renderNotes(f: number): void {
  if (noteSets.has(f)) return;
  noteSets.set(f, []);
  Promise.all(SCALE.map((k) => renderNote(f * k))).then((list) => { noteSets.set(f, list); }, warn);
}
let base = 196;
let music = false;
let arpStep = 0;
let arpIn = 0;

/** audio.js startMusic(theme): the pad and the arpeggio on the theme's base frequency. */
export function startMusic(baseFreq: number): void { base = baseFreq || 196; music = true; renderNotes(base); }
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

/** Each frame, once the mixer runs and a round is on: the pad and the arpeggio. */
export function update(dt: number): void {
  if (!music || context.state !== "running" || !ambClip) return;
  const notes = noteSets.get(base);
  if (!notes?.length) return;
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
