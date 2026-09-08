// audio.js — WebAudio sound: authored one-shot samples with procedural
// synthesis as fallback while a sample is still loading or failed to load.
//
// Three buses (music / effects / ambience) with independent volumes and a
// master mute. Music is a quiet seeded arpeggio whose base frequency comes
// from the level theme; ambience is a soft filtered-noise pad. The context
// resumes on the first user gesture; sfx/<name>.opus samples are lazily
// fetched, decoded, and cached per event after that unlock. Event-driven:
// the session passes each tick's rules events to playEvents().

// Event (playEvents case or public method) -> sfx/<name>.opus basename.
// Must cover every basename in sfx/manifest.json.
const SAMPLES = {
  'cut': 'rope-snip',
  'bubble-attach': 'bubble-attach',
  'bubble-pop': 'bubble-pop',
  'fan': 'fan-burst',
  'bumper': 'bumper-boing',
  'star': 'star-chime',
  'hazard': 'hazard-clank',
  'delivered': 'delivered-fanfare',
  'stalled': 'stalled-wind-down',
  'time-up': 'time-up-buzzer',
  'out': 'out-fall',
  'errorBuzz': 'error-buzz',
};

export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.buses = {};
    this.musicTimer = null;
    this.arpStep = 0;
    this.baseFreq = 196;
    this.started = false;
    this.sfxCache = new Map(); // name -> AudioBuffer | 'loading' | 'failed'
  }

  /** Lazily create the AudioContext (must follow a user gesture). */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return true;
    }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return false;
    try {
      this.ctx = new AC();
      const master = this.ctx.createGain();
      master.connect(this.ctx.destination);
      this.master = master;
      for (const name of ['music', 'effects', 'ambience']) {
        const g = this.ctx.createGain();
        g.connect(master);
        this.buses[name] = g;
      }
      this.applyVolumes();
      return true;
    } catch (e) {
      return false;
    }
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    const mute = s.muted ? 0 : 1;
    this.master.gain.value = mute;
    this.buses.music.gain.value = s.music * 0.35;
    this.buses.effects.gain.value = s.effects;
    this.buses.ambience.gain.value = s.ambience * 0.25;
  }

  /** Short oscillator blip with an envelope, routed to a bus. */
  blip(bus, freq, dur, type = 'sine', gain = 0.3, slide = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(this.buses[bus]);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  /** Filtered noise burst (snips, pops, whooshes). */
  noise(bus, dur, freq, q = 1, gain = 0.25) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.buses[bus]);
    src.start(t);
  }

  /** Lazily fetch/decode/cache an sfx sample; cache records outcome. */
  loadSample(name) {
    if (this.sfxCache.has(name)) return;
    this.sfxCache.set(name, 'loading');
    // Resolve against this module's URL so the game also works when the
    // platform serves it from a sub-path rather than the domain root.
    fetch(new URL('../sfx/' + name + '.opus', import.meta.url))
      .then((res) => {
        if (!res.ok) throw new Error('http ' + res.status);
        return res.arrayBuffer();
      })
      .then((data) => this.ctx.decodeAudioData(data))
      .then((buf) => this.sfxCache.set(name, buf))
      .catch(() => this.sfxCache.set(name, 'failed'));
  }

  /**
   * Play the sample mapped to an event through the effects bus.
   * Returns false while loading or after failure so the caller can
   * run its procedural synthesis instead.
   */
  sample(event) {
    if (!this.ctx || this.settings.muted) return false;
    const name = SAMPLES[event];
    if (!name) return false;
    const entry = this.sfxCache.get(name);
    if (!entry) {
      this.loadSample(name);
      return false;
    }
    if (!(entry instanceof AudioBuffer)) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = entry;
    src.connect(this.buses.effects);
    src.start();
    return true;
  }

  /** Map rules events to sound effects. */
  playEvents(events) {
    if (!this.ctx || this.settings.muted) return;
    for (const ev of events) {
      switch (ev.type) {
        case 'cut':
          if (this.sample('cut')) break;
          this.noise('effects', 0.08, 3200, 2, 0.35); this.blip('effects', 900, 0.08, 'square', 0.12, -500); break;
        case 'bubble-attach':
          if (this.sample('bubble-attach')) break;
          this.blip('effects', 420, 0.18, 'sine', 0.25, 260); break;
        case 'bubble-pop':
          if (this.sample('bubble-pop')) break;
          this.noise('effects', 0.12, 1400, 1.5, 0.4); break;
        case 'fan':
          if (this.sample('fan')) break;
          this.noise('effects', 0.3, ev.on ? 500 : 350, 0.8, 0.2); break;
        case 'bumper':
          if (this.sample('bumper')) break;
          this.blip('effects', 180, 0.22, 'triangle', 0.4, 120); break;
        case 'star':
          if (this.sample('star')) break;
          this.blip('effects', 880, 0.12, 'sine', 0.3); this.blip('effects', 1320, 0.2, 'sine', 0.25); break;
        case 'hazard':
          if (this.sample('hazard')) break;
          this.blip('effects', 220, 0.4, 'sawtooth', 0.3, -140); break;
        case 'delivered':
          if (this.sample('delivered')) break;
          [523, 659, 784, 1047].forEach((f, i) =>
            setTimeout(() => this.blip('effects', f, 0.25, 'triangle', 0.3), i * 90));
          break;
        case 'stalled':
          if (this.sample('stalled')) break;
          this.blip('effects', 160, 0.5, 'sawtooth', 0.25, -60); break;
        case 'time-up':
          if (this.sample('time-up')) break;
          this.blip('effects', 160, 0.5, 'sawtooth', 0.25, -60); break;
        case 'out':
          if (this.sample('out')) break;
          this.blip('effects', 160, 0.5, 'sawtooth', 0.25, -60); break;
        default: break;
      }
    }
  }

  errorBuzz() {
    if (this.sample('errorBuzz')) return;
    this.blip('effects', 140, 0.15, 'square', 0.2, -40);
  }

  /** Start the quiet arpeggio + noise pad for a theme. */
  startMusic(theme) {
    if (!this.ensure()) return;
    this.baseFreq = (theme && theme.ambience && theme.ambience.base) || 196;
    if (this.started) return;
    this.started = true;
    // Ambience pad: looping filtered noise.
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 320;
    src.connect(f); f.connect(this.buses.ambience);
    src.start();
    this.ambienceSrc = src;
    // Seeded-feeling arpeggio on a pentatonic ladder derived from base freq.
    const scale = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2];
    this.musicTimer = setInterval(() => {
      if (this.settings.muted || document.hidden) return;
      const step = this.arpStep++;
      if (step % 2 === 0) {
        const deg = [0, 2, 4, 3, 5, 4, 2, 1][(step / 2) % 8];
        this.blip('music', this.baseFreq * scale[deg], 0.5, 'sine', 0.16);
      }
    }, 420);
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
    // The looping ambience pad must stop too, otherwise every new round
    // layers another pad on top of the previous ones.
    if (this.ambienceSrc) {
      try { this.ambienceSrc.stop(); } catch (e) { /* already stopped */ }
      this.ambienceSrc.disconnect();
      this.ambienceSrc = null;
    }
    this.started = false;
  }
}
