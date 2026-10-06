// render.js — Three.js presentation layer for Tether Treat.
//
// Reads rules state each frame and rebuilds/updates meshes to match; it
// never mutates rules state. One WebGL renderer, perspective camera fitted
// to the level bounds, ACES tone mapping, key + hemisphere lights, contact
// shadow blob. Interactive targets (ropes, bubbles, fans) carry hit-proxy
// meshes in an explicit interaction layer for raycasting. Graphics settings
// (gfx.js) control pixel ratio, shadows, post-processing, particles, the
// animated wallpaper and material detail — never rules or hazard
// visibility. Reduced motion disables particles and camera nudges.

import * as THREE from '../vendor/three.module.js';
import { s2w, sliderPosition } from './physics.js';
import { SUB } from './rules.js';
import { resolve, detectPreset, capForTouch, describe, SHADOW_MAP, PARTICLES } from './gfx.js';

// Colour grade + vignette, applied in display space after the OutputPass.
// Backing-store pixel budget for the large-screen (UIScale) boost: about a
// 4K frame at 1×, so Ultra's supersampling doesn't multiply on huge monitors.
const MAX_BACKING_PX = 3840 * 2160 / 2;

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 1.0 }, uVignette: { value: 0.28 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = clamp(src.rgb, 0.0, 1.0);
      // Gentle S-curve, a little extra candy saturation, warm highlights.
      vec3 s = mix(c, c * c * (3.0 - 2.0 * c), 0.22);
      float l = dot(s, vec3(0.299, 0.587, 0.114));
      s = mix(vec3(l), s, 1.12);
      s *= mix(vec3(0.97, 0.97, 1.04), vec3(1.04, 1.0, 0.97), smoothstep(0.25, 0.85, l));
      c = mix(c, s, uAmount);
      float d = length((vUv - 0.5) * vec2(1.1, 1.0));
      c *= 1.0 - uVignette * smoothstep(0.38, 0.9, d);
      gl_FragColor = vec4(c, src.a);
    }`,
};

/** Small seeded PRNG for deterministic procedural textures. */
function texRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTex(w, h, draw, { repeat = null, srgb = true } = {}) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  tex.anisotropy = 4;
  return tex;
}

function mixHex(a, b, t) {
  return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}

/** Candy wallpaper: soft vertical stripes, polka dots and fine paper grain. */
function wallpaperTexture(theme) {
  return canvasTex(256, 256, (ctx, w, h) => {
    const base = mixHex(theme.bg1, theme.wall, 0.35);
    const alt = mixHex(theme.bg1, theme.bg0, 0.35);
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = alt;
    for (let x = 0; x < w; x += 64) ctx.fillRect(x + 32, 0, 32, h);
    ctx.fillStyle = mixHex(theme.wall, theme.accent, 0.25);
    ctx.globalAlpha = 0.18;
    for (let x = 0; x < w; x += 64) { ctx.fillRect(x + 30, 0, 2, h); ctx.fillRect(x + 64 - 2, 0, 2, h); }
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = theme.accent2;
    for (let y = 16; y < h; y += 64) {
      for (let x = 16; x < w; x += 64) {
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x + 32, y + 32, 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    const rnd = texRng(7);
    ctx.globalAlpha = 0.05;
    for (let i = 0; i < 1800; i++) {
      ctx.fillStyle = rnd() < 0.5 ? '#000' : '#fff';
      ctx.fillRect(rnd() * w, rnd() * h, 1, 1);
    }
    ctx.globalAlpha = 1;
  }, { repeat: [6, 4] });
}

/** Checker tiles with a faint bevel line: the playroom floor. */
function floorTexture(color) {
  return canvasTex(128, 128, (ctx, w, h) => {
    const a = color; const b = mixHex(color, '#ffffff', 0.12);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        ctx.fillStyle = (x + y) % 2 ? a : b;
        ctx.fillRect(x * 64, y * 64, 64, 64);
      }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2;
    for (let i = 0; i <= 128; i += 64) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke();
    }
  }, { repeat: [14, 3] });
}

/** Diagonal candy-cane bands (white/grey so a material colour tints them). */
function bandTexture(bands = 6, light = '#ffffff', dark = '#c4c4c4') {
  return canvasTex(64, 64, (ctx, w, h) => {
    ctx.fillStyle = light; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = dark;
    const step = w / bands * 2;
    for (let i = -w; i < w * 2; i += step) {
      ctx.beginPath();
      ctx.moveTo(i, 0); ctx.lineTo(i + step / 2, 0);
      ctx.lineTo(i + step / 2 + h, h); ctx.lineTo(i + h, h);
      ctx.closePath(); ctx.fill();
    }
  }, { repeat: [1, 1] });
}

/** Round soft dot for particles and motes. */
function dotTexture() {
  return canvasTex(32, 32, (ctx) => {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
  });
}

function starShape(r = 0.55, points = 5) {
  const shape = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * rad; const y = Math.sin(a) * rad;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

/** Rounded candy-swirl treat: lathe body + decorative torus band + sprinkles. */
function buildTreatMesh(theme, cosmetic, detailed) {
  const group = new THREE.Group();
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push(new THREE.Vector2(Math.sin(t * Math.PI) * 0.5, (t - 0.5) * 0.9));
  }
  const bodyMat = detailed
    ? new THREE.MeshPhysicalMaterial({
      color: theme.treat, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08,
      map: bandTexture(8, '#ffffff', '#d6d6d6'),
    })
    : new THREE.MeshStandardMaterial({ color: theme.treat, roughness: 0.35, metalness: 0.05 });
  if (detailed) bodyMat.map.repeat.set(2, 1);
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, detailed ? 40 : 24), bodyMat);
  group.add(body);
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(0.42, 0.09, detailed ? 16 : 10, detailed ? 40 : 28),
    detailed
      ? new THREE.MeshPhysicalMaterial({ color: theme.accent2, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 })
      : new THREE.MeshStandardMaterial({ color: theme.accent2, roughness: 0.4 }));
  band.rotation.x = Math.PI / 2;
  group.add(band);
  if (cosmetic === 'sprinkle' || cosmetic === 'astro') {
    const sprinkleGeo = detailed ? new THREE.CapsuleGeometry(0.03, 0.12, 2, 6) : new THREE.BoxGeometry(0.06, 0.06, 0.16);
    const sprinkleMat = new THREE.MeshStandardMaterial({ color: theme.star, roughness: 0.5 });
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Mesh(sprinkleGeo, sprinkleMat);
      const a = (i / 8) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.42, Math.sin(a * 3) * 0.25, Math.sin(a) * 0.42);
      s.rotation.set(a, a * 2, a * 0.5);
      group.add(s);
    }
  }
  if (cosmetic === 'choco') {
    body.material.color.set('#7a4a2a');
  } else if (cosmetic === 'minty') {
    body.material.color.set('#a8f0d8');
  } else if (cosmetic === 'astro') {
    body.material.emissive = new THREE.Color(theme.accent2);
    body.material.emissiveIntensity = 0.25;
  }
  return group;
}

/** Morsel: cute blob creature — body, eyes, open mouth ring = capture radius. */
function buildMorsel(theme, r, detailed) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.75, detailed ? 40 : 24, detailed ? 30 : 18),
    detailed
      ? new THREE.MeshPhysicalMaterial({
        color: theme.accent, roughness: 0.55, sheen: 1, sheenRoughness: 0.4,
        sheenColor: new THREE.Color(mixHex(theme.accent, '#ffffff', 0.6)), clearcoat: 0.25,
      })
      : new THREE.MeshStandardMaterial({ color: theme.accent, roughness: 0.6 }));
  body.scale.y = 0.85;
  body.position.y = 0.55;
  g.add(body);
  const eyeGeo = new THREE.SphereGeometry(0.11, detailed ? 16 : 10, detailed ? 12 : 8);
  const eyeMat = detailed
    ? new THREE.MeshPhysicalMaterial({ color: '#1a1230', roughness: 0.15, clearcoat: 1 })
    : new THREE.MeshStandardMaterial({ color: '#1a1230' });
  const eyes = [];
  for (const dx of [-0.24, 0.24]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(dx, 0.75, 0.62);
    g.add(eye);
    eyes.push(eye);
    if (detailed) {
      // Catchlight: a tiny unlit highlight makes the eyes read as glossy.
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
      glint.position.set(0.035, 0.04, 0.09);
      eye.add(glint);
    }
  }
  g.userData.eyes = eyes;
  const mouth = new THREE.Mesh(
    new THREE.TorusGeometry(0.28, 0.09, 10, 24),
    new THREE.MeshStandardMaterial({ color: '#5e1030', roughness: 0.7 }));
  mouth.position.set(0, 0.42, 0.64);
  g.add(mouth);
  // Capture radius ring on the floor — communicates the goal zone.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(s2w(r) - 0.08, s2w(r), 40),
    new THREE.MeshBasicMaterial({ color: theme.accent2, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  g.add(ring);
  g.userData.ring = ring;
  return g;
}

export class Renderer {
  /**
   * @param canvas  target <canvas>
   * @param opts    {reducedMotion, onContextLost}
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = opts;
    this.tier = { particles: PARTICLES.low.pool, motes: 0 };
    this.time = 0;
    this.disposed = false;
    this.interactives = [];  // hit proxies: {mesh, kind:'rope'|'bubble'|'fan', id}
    this.particles = [];
    this.particlePool = [];
    this.highlighted = null;
    this.hinted = null;
    this.legal = new Set();
    this.size = [0, 0];
    this.pixelRatio = 0;
    this.adaptiveScale = 1;
    this._frames = [];
    this.fps = 0;
    this.composer = null;
    this.postKey = null;
    this.postFailed = false;
    this._ok = this.init();
    if (this._ok) this.setGraphics({});
  }

  get ok() { return this._ok; }

  init() {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      return false;
    }
    this.renderer = renderer;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gpu = Renderer.gpuName(renderer);
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.detected = capForTouch(detectPreset(this.gpu), touch);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.baseCamPos = new THREE.Vector3(0, 6, 30);
    this.camNudge = 0;

    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (this.opts.onContextLost) this.opts.onContextLost();
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.postKey = null;
      if (this.opts.onContextRestored) this.opts.onContextRestored();
    });

    this.levelGroup = null;
    return true;
  }

  static gpuName(r) {
    try {
      const gl = r.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    } catch (e) {
      return '';
    }
  }

  /** Decorative ambient motion (motes, wallpaper drift, blinks). */
  get ambientMotion() {
    if (this.opts.reducedMotion) return false;
    return !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /** Lazily load the post-processing / environment addons (never on Low). */
  _loadAddons() {
    if (!this._addons) {
      this._addons = import('./post.js').then((m) => { this.mods = m; return m; }, () => {
        this.postFailed = true;
        return null;
      });
    }
    return this._addons;
  }

  /**
   * Apply saved graphics settings (see gfx.js). Takes effect immediately:
   * shadow maps, post chain, pixel ratio, particles and material detail.
   */
  setGraphics(saved) {
    if (!this._ok) return;
    const json = JSON.stringify(saved || {});
    if (json === this._gfxJson) return;
    this._gfxJson = json;
    const prev = this.q;
    const g = resolve(saved, this.detected);
    this.q = g;
    this.tier = { particles: PARTICLES[g.particles].pool, motes: PARTICLES[g.particles].motes };
    const size = SHADOW_MAP[g.shadows];
    this.renderer.shadowMap.enabled = size > 0;
    if (this.keyLight) this._applyShadow();
    this.adaptiveScale = 1;
    this._frames = [];
    this.postKey = null; // rebuild the post chain on the next frame
    this._fpsVisible(g.showFps);
    if (typeof document !== 'undefined') {
      document.body.dataset.gfxPreset = g.preset;
      this.canvas.dataset.gfxPreset = g.preset;
    }
    if (g.post || g.detail === 'detailed') {
      this._loadAddons().then(() => {
        this.postKey = null;
        if (this.q.detail === 'detailed') this._ensureEnvironment();
      });
    }
    const rebuild = prev && this.levelGroup && this._lastState &&
      (prev.detail !== g.detail || prev.background !== g.background || prev.particles !== g.particles);
    if (rebuild) {
      this.buildLevel(this._lastState, this.theme, this.cosmetics);
      if (this._lastActions) this.setLegalTargets(this._lastActions, this._lastState);
    } else if (this.levelGroup && prev && SHADOW_MAP[prev.shadows] !== size) {
      // Materials pick up the shadow-map change on recompile.
      this.levelGroup.traverse((o) => {
        if (!o.material) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
      });
    }
  }

  _applyShadow() {
    const size = SHADOW_MAP[this.q.shadows];
    const key = this.keyLight;
    key.castShadow = size > 0;
    if (size > 0 && key.shadow.mapSize.x !== size) {
      key.shadow.mapSize.set(size, size);
      if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
    }
  }

  _ensureEnvironment() {
    if (this.envMap || !this.mods || this._envFailed) {
      if (this.envMap && this.levelGroup && this.q.detail === 'detailed') this.scene.environment = this.envMap;
      return;
    }
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const room = new this.mods.RoomEnvironment(this.renderer);
      this.envMap = pmrem.fromScene(room, 0.04).texture;
      room.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      pmrem.dispose();
      if (this.q.detail === 'detailed') this.scene.environment = this.envMap;
    } catch (e) {
      this._envFailed = true;
    }
  }

  /** What the settings panel shows: GPU, auto choice, resolved tiers, cost, fps. */
  graphicsInfo() {
    // Before the first frame (title screen) predict the buffer size from the canvas.
    const w = this.size[0] || this.canvas.clientWidth;
    const h = this.size[1] || this.canvas.clientHeight;
    const ratio = this._ratio(w, h);
    const px = [Math.round(w * ratio), Math.round(h * ratio)];
    return {
      gpu: this.gpu || 'unknown GPU',
      detected: this.detected,
      resolved: this.q,
      pixels: px[0] > 0 ? px : null,
      summary: describe(this.q, px[0] > 0 ? px : null),
      fps: Math.round(this.fps || 0),
      adaptiveScale: Math.round(this.adaptiveScale * 100) / 100,
      postFailed: !!this.postFailed,
    };
  }

  _fpsVisible(on) {
    const host = this.canvas.parentElement;
    if (!host) return;
    let el = host.querySelector('.tt-fps');
    if (on && !el) {
      el = document.createElement('div');
      el.className = 'tt-fps';
      el.id = 'tt-fps';
      el.setAttribute('aria-hidden', 'true');
      el.textContent = '… fps';
      host.appendChild(el);
    }
    if (el) el.hidden = !on;
  }

  resize() {
    // Sizing happens at the start of each rendered frame; force it.
    this.size = [0, 0];
    if (!this._ok) return;
    const w = this.canvas.clientWidth || 640;
    const h = this.canvas.clientHeight || 480;
    this.camera.aspect = w / h;
    this.fitCamera();
    this.camera.updateProjectionMatrix();
  }

  _postKey(w, h) {
    const g = this.q;
    if (!g.post || !this.mods || this.postFailed) return 'none';
    return [g.ao, g.bloom, g.grade, g.antialias, w, h, this.pixelRatio].join('|');
  }

  _buildPost(w, h) {
    const g = this.q;
    if (this.composer) {
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
    }
    this.composer = null;
    if (!g.post || !this.mods || this.postFailed) return;
    const M = this.mods;
    try {
      const pw = Math.max(1, Math.round(w * this.pixelRatio));
      const ph = Math.max(1, Math.round(h * this.pixelRatio));
      const target = new THREE.WebGLRenderTarget(pw, ph, {
        type: THREE.HalfFloatType, samples: g.antialias === 'msaa' ? 4 : 0,
      });
      const composer = new M.EffectComposer(this.renderer, target);
      composer.setPixelRatio(this.pixelRatio);
      composer.setSize(w, h);
      composer.addPass(new M.RenderPass(this.scene, this.camera));
      if (g.ao !== 'off') {
        const ao = new M.GTAOPass(this.scene, this.camera, pw, ph);
        ao.output = M.GTAOPass.OUTPUT.Default;
        ao.blendIntensity = 0.75;
        ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.2, thickness: 1.2, scale: 1.0, samples: g.ao === 'high' ? 16 : 8 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: g.ao === 'high' ? 6 : 4, rings: 2, samples: g.ao === 'high' ? 16 : 8 });
        // Sprites, particles and see-through pieces never contribute to AO.
        ao.overrideVisibility = function overrideVisibility() {
          const cache = this._visibilityCache;
          this.scene.traverse((o) => {
            cache.set(o, o.visible);
            if (o.isPoints || o.isLine || o.isSprite || (o.material && o.material.transparent)) o.visible = false;
          });
        };
        composer.addPass(ao);
      }
      if (g.bloom === 'on') {
        // High threshold: only glowing stars, the goal and hot highlights bloom.
        composer.addPass(new M.UnrealBloomPass(new THREE.Vector2(w, h), 0.45, 0.35, 0.92));
      }
      composer.addPass(new M.OutputPass());
      if (g.grade === 'on') composer.addPass(new M.ShaderPass(GradeShader));
      if (g.antialias === 'smaa') composer.addPass(new M.SMAAPass(pw, ph));
      if (g.antialias === 'fxaa') {
        const fxaa = new M.ShaderPass(M.FXAAShader);
        fxaa.material.uniforms.resolution.value.set(1 / pw, 1 / ph);
        composer.addPass(fxaa);
      }
      this.composer = composer;
    } catch (e) {
      // Post-processing is an enhancement: render directly if the chain cannot be built.
      this.postFailed = true;
      this.composer = null;
    }
  }

  /** Render pixel ratio for a w×h (layout px) canvas. × UIScale: the canvas sits
   *  inside the zoomed app root, so on large screens its layout size is magnified
   *  and the backing store must follow to stay sharp. A hard pixel budget keeps
   *  supersampled presets on huge monitors from exploding the per-frame cost. */
  _ratio(w, h) {
    const dpr = globalThis.devicePixelRatio || 1;
    const zoom = globalThis.UIScale?.value || 1;
    const base = Math.min(dpr, this.q.cap) * this.q.scale * this.adaptiveScale;
    if (zoom <= 1) return base;
    // the budget only limits the large-screen boost, never the unzoomed ratio
    const budget = globalThis.__ttPxBudget || MAX_BACKING_PX;
    return Math.max(base, Math.min(base * zoom, Math.sqrt(budget / Math.max(1, w * h))));
  }

  /** Adaptive resolution: step the render scale down when frames are slow, up when fast. */
  _adapt(ms) {
    const f = this._frames;
    f.push(ms);
    if (f.length < 90) return false;
    const avg = f.reduce((a, b) => a + b, 0) / f.length;
    f.length = 0;
    this.fps = 1000 / avg;
    const host = this.canvas.parentElement;
    const el = host && host.querySelector('.tt-fps');
    if (el && !el.hidden) el.textContent = Math.round(this.fps) + ' fps · ' + (Math.round(this.pixelRatio * 100) / 100) + '×';
    if (!this.q.adaptive) return false;
    const before = this.adaptiveScale;
    if (avg > 26) this.adaptiveScale = Math.max(0.6, this.adaptiveScale - 0.1);
    else if (avg < 14 && this.adaptiveScale < 1) this.adaptiveScale = Math.min(1, this.adaptiveScale + 0.05);
    return before !== this.adaptiveScale;
  }

  /** Size the drawing buffer, (re)build the post chain and draw one frame. */
  _draw() {
    const now = performance.now();
    const ms = this._lastDraw ? Math.min(250, now - this._lastDraw) : 16;
    this._lastDraw = now;
    const rescale = this._adapt(ms);
    const w = this.canvas.clientWidth || 640;
    const h = this.canvas.clientHeight || 480;
    const ratio = this._ratio(w, h);
    if (w !== this.size[0] || h !== this.size[1] || ratio !== this.pixelRatio || rescale) {
      this.size = [w, h];
      this.pixelRatio = ratio;
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.fitCamera();
      this.camera.updateProjectionMatrix();
    }
    const key = this._postKey(w, h);
    if (key !== this.postKey) {
      this.postKey = key;
      this._buildPost(w, h);
    }
    if (this.composer) {
      try {
        this.composer.render(ms / 1000);
        return;
      } catch (e) {
        this.postFailed = true;
        this.postKey = null;
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Fit the camera so the played area fills the view with margin. */
  fitCamera() {
    if (!this.frameW && !this.boundsW) return;
    const { cx, cy, w, h } = this.frameW || this.boundsW;
    const fovV = this.camera.fov * Math.PI / 180;
    const distH = (h / 2 + 2) / Math.tan(fovV / 2);
    const distW = (w / 2 + 2) / (Math.tan(fovV / 2) * this.camera.aspect);
    const dist = Math.max(distH, distW);
    this.baseCamPos.set(cx, cy, dist);
    this.camera.position.copy(this.baseCamPos);
    this.camera.lookAt(cx, cy, 0);
  }

  /**
   * Build the whole scene for a rules state + theme. Called on level load
   * and restart; cosmetic ids come from unlockedCosmetics selections.
   */
  buildLevel(state, theme, cosmetics = {}) {
    if (!this._ok) return;
    if (this.levelGroup) {
      this.scene.remove(this.levelGroup);
      this.levelGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            if (m.map) m.map.dispose();
            m.dispose();
          }
        }
      });
    }
    this._lastState = state;
    this.interactives = [];
    this.particles = [];
    const g = new THREE.Group();
    this.levelGroup = g;
    this.theme = theme;
    this.cosmetics = cosmetics;
    this.meshes = { ropes: new Map(), bubbles: new Map(), fans: new Map(), stars: new Map(), sliders: new Map() };
    const detailed = this.q.detail === 'detailed';
    this.detailed = detailed;
    this.wallpaper = null;
    this.motes = null;

    this.scene.background = new THREE.Color(theme.bg0);
    this.scene.fog = new THREE.Fog(theme.fog, 30, 90);
    this.scene.environment = null;
    if (detailed) this._ensureEnvironment();

    const B = state.bounds;
    const minX = s2w(B.minX), maxX = s2w(B.maxX), minY = s2w(B.minY), maxY = s2w(B.maxY);
    this.boundsW = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
    this.frameW = contentFrame(state, this.boundsW);
    const F = this.frameW;

    // Lights. Detailed: a warm key from upper-left-front whose shadows fall
    // on the wallpaper behind the pieces, a cool rim from behind, and the
    // room environment as soft fill. Plain: the original key + hemisphere.
    const hemi = new THREE.HemisphereLight(theme.key, theme.floor, detailed ? 0.4 : 0.9);
    g.add(hemi);
    const key = new THREE.DirectionalLight(theme.key, detailed ? 1.5 : 1.4);
    if (detailed) key.position.set(F.cx - 7, F.cy + 11, 16);
    else key.position.set(6, 18, 12);
    key.target.position.set(F.cx, F.cy, 0);
    g.add(key, key.target);
    this.keyLight = key;
    // Shadow frustum fitted tightly around the framed play area.
    const ext = Math.max(F.w, F.h) / 2 + 3;
    Object.assign(key.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 60 });
    key.shadow.camera.updateProjectionMatrix();
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.03;
    key.shadow.radius = 3;
    this._applyShadow();
    if (detailed) {
      const rim = new THREE.DirectionalLight(mixHex(theme.accent2, '#ffffff', 0.5), 0.7);
      rim.position.set(F.cx + 6, F.cy + 4, -10);
      rim.target.position.set(F.cx, F.cy, 0);
      g.add(rim, rim.target);
    }

    // Candy playroom: backdrop, floor, walls.
    let back;
    if (detailed) {
      // Wallpapered back wall close behind the pieces so shadows ground them.
      this.wallpaper = wallpaperTexture(theme);
      back = new THREE.Mesh(
        new THREE.PlaneGeometry(this.boundsW.w + 30, this.boundsW.h + 20),
        new THREE.MeshStandardMaterial({ map: this.wallpaper, roughness: 0.85, metalness: 0, envMapIntensity: 0.35 }));
      back.position.set(this.boundsW.cx, this.boundsW.cy, -2.2);
      back.receiveShadow = true;
      g.add(back);
      // Skirting board where the wall meets the floor.
      const skirt = new THREE.Mesh(
        new THREE.BoxGeometry(this.boundsW.w + 30, 0.7, 0.25),
        new THREE.MeshPhysicalMaterial({ color: mixHex(theme.wall, '#ffffff', 0.15), roughness: 0.4, clearcoat: 0.6 }));
      skirt.position.set(this.boundsW.cx, minY + 0.75, -2.05);
      skirt.receiveShadow = true;
      g.add(skirt);
    } else {
      const grad = this.gradientTexture(theme.bg0, theme.bg1);
      back = new THREE.Mesh(
        new THREE.PlaneGeometry(this.boundsW.w + 30, this.boundsW.h + 20),
        new THREE.MeshBasicMaterial({ map: grad }));
      back.position.set(this.boundsW.cx, this.boundsW.cy, -4);
      g.add(back);
    }
    const floorColor = cosmetics.room === 'garden' ? '#3c8a5f' : cosmetics.room === 'clocktower' ? '#5d4a8a' : theme.floor;
    const floorMat = detailed
      ? new THREE.MeshPhysicalMaterial({
        color: '#ffffff', map: floorTexture(floorColor), roughness: 0.55, clearcoat: 0.5, clearcoatRoughness: 0.25, envMapIntensity: 0.3,
      })
      : new THREE.MeshStandardMaterial({ color: floorColor, roughness: 0.9 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(this.boundsW.w + 30, 1.6, 10), floorMat);
    floor.position.set(this.boundsW.cx, minY - 0.4, 1);
    floor.receiveShadow = true;
    g.add(floor);
    const wallMat = detailed
      ? new THREE.MeshStandardMaterial({ color: theme.wall, map: bandTexture(4, '#ffffff', '#d9d9d9'), roughness: 0.6 })
      : new THREE.MeshStandardMaterial({ color: theme.wall, roughness: 0.95 });
    if (detailed) wallMat.map.repeat.set(1, 6);
    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.8, this.boundsW.h + 12, 6), wallMat);
      wall.position.set(sx > 0 ? maxX + 0.6 : minX - 0.6, this.boundsW.cy, 0);
      wall.receiveShadow = true;
      g.add(wall);
    }

    // Treat (with a soft contact-shadow blob).
    this.treatMesh = buildTreatMesh(theme, cosmetics.treat, detailed);
    this.treatMesh.traverse((o) => { o.castShadow = true; });
    g.add(this.treatMesh);
    const shadowTex = this.radialTexture('rgba(0,0,0,0.4)');
    this.contactShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.6),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    this.contactShadow.rotation.x = -Math.PI / 2;
    g.add(this.contactShadow);

    // Trail cosmetic: small fading ghosts, spawned per frame budget.
    this.trail = [];
    this.trailKind = cosmetics.trail || 'none';

    // Morsel.
    this.morsel = buildMorsel(theme, state.recipient.r, detailed);
    this.morsel.position.set(s2w(state.recipient.x), s2w(state.recipient.y) - 0.1, 0);
    this.morsel.traverse((o) => { if (o.isMesh && !o.material.transparent) o.castShadow = true; });
    g.add(this.morsel);

    // Ropes: drooping quadratic tubes + peg anchors; rebuilt on cut/move.
    const ropeMat = detailed
      ? new THREE.MeshStandardMaterial({ color: theme.rope, map: bandTexture(6, '#ffffff', '#b8b0c0'), roughness: 0.75 })
      : new THREE.MeshStandardMaterial({ color: theme.rope, roughness: 0.7 });
    if (detailed) ropeMat.map.repeat.set(14, 1);
    const pegMat = detailed
      ? new THREE.MeshPhysicalMaterial({ color: theme.metal, roughness: 0.28, metalness: 0.65, clearcoat: 0.5 })
      : new THREE.MeshStandardMaterial({ color: theme.metal, roughness: 0.4, metalness: 0.4 });
    this.ropeRadius = detailed ? 0.06 : 0.05;
    for (const r of state.ropes) {
      const rec = { rope: r, mesh: null, mat: ropeMat };
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.5, detailed ? 20 : 12), pegMat);
      peg.rotation.x = Math.PI / 2;
      peg.castShadow = true;
      rec.peg = peg;
      g.add(peg);
      const glyph = this.makeGlyph('✂', theme.accent);
      g.add(glyph);
      rec.glyph = glyph;
      this.meshes.ropes.set(r.id, rec);
      // Interaction proxy: fat invisible cylinder along the rope.
      const proxy = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 0.45, 1, 6),
        new THREE.MeshBasicMaterial({ visible: false }));
      proxy.userData = { kind: 'rope', id: r.id };
      rec.proxy = proxy;
      g.add(proxy);
      this.interactives.push(proxy);
      this.rebuildRope(rec, state);
    }

    // Sliders: rail + moving carriage peg.
    for (const s of state.sliders) {
      const rec = { slider: s };
      const a = new THREE.Vector3(s2w(s.x0), s2w(s.y0), 0);
      const b = new THREE.Vector3(s2w(s.x1), s2w(s.y1), 0);
      const len = a.distanceTo(b);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.14, 0.14), pegMat);
      rail.position.copy(a).lerp(b, 0.5);
      rail.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
      rail.castShadow = true;
      g.add(rail);
      const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), pegMat);
      carriage.castShadow = true;
      g.add(carriage);
      rec.carriage = carriage;
      this.meshes.sliders.set(s.id, rec);
    }

    // Stars: extruded (bevelled when detailed), spin + shine while uncollected.
    const starGeo = new THREE.ExtrudeGeometry(starShape(0.55), detailed
      ? { depth: 0.12, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 3 }
      : { depth: 0.15, bevelEnabled: false });
    if (detailed) starGeo.center();
    const starMat = detailed
      ? new THREE.MeshPhysicalMaterial({
        color: theme.star, emissive: theme.star, emissiveIntensity: 0.5, roughness: 0.22, metalness: 0.35, clearcoat: 1,
      })
      : new THREE.MeshStandardMaterial({ color: theme.star, emissive: theme.star, emissiveIntensity: 0.35, roughness: 0.3 });
    this.starMat = starMat;
    for (const s of state.stars) {
      const m = new THREE.Mesh(starGeo, starMat);
      m.position.set(s2w(s.x), s2w(s.y), 0);
      m.castShadow = true;
      g.add(m);
      this.meshes.stars.set(s.id, m);
    }

    // Bubbles: iridescent soap film when detailed.
    for (const b of state.bubbles) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(s2w(b.r), detailed ? 32 : 20, detailed ? 24 : 14),
        detailed
          ? new THREE.MeshPhysicalMaterial({
            color: theme.accent2, transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0,
            iridescence: 1, iridescenceIOR: 1.3, clearcoat: 1, envMapIntensity: 0.9, depthWrite: false,
          })
          : new THREE.MeshStandardMaterial({
            color: theme.accent2, transparent: true, opacity: 0.3, roughness: 0.1, metalness: 0.2,
          }));
      m.position.set(s2w(b.x), s2w(b.y), 0);
      g.add(m);
      const glyph = this.makeGlyph('◯', theme.accent2);
      glyph.position.set(s2w(b.x), s2w(b.y) + s2w(b.r) + 0.5, 0);
      g.add(glyph);
      this.meshes.bubbles.set(b.id, { mesh: m, glyph });
      m.userData = { kind: 'bubble', id: b.id };
      this.interactives.push(m);
    }

    // Fans: housing + pinwheel blades + directional glyph.
    for (const f of state.fans) {
      const rec = { fan: f, blades: null, stream: null };
      const fg = new THREE.Group();
      const housing = new THREE.Mesh(
        new THREE.CylinderGeometry(0.85, 0.95, 0.4, detailed ? 36 : 20),
        detailed
          ? new THREE.MeshPhysicalMaterial({ color: theme.metal, roughness: 0.3, metalness: 0.5, clearcoat: 0.6 })
          : new THREE.MeshStandardMaterial({ color: theme.metal, roughness: 0.5, metalness: 0.3 }));
      housing.rotation.x = Math.PI / 2;
      housing.castShadow = true;
      fg.add(housing);
      const blades = new THREE.Group();
      const bladeMat = detailed
        ? new THREE.MeshPhysicalMaterial({ color: theme.accent2, roughness: 0.3, clearcoat: 1 })
        : new THREE.MeshStandardMaterial({ color: theme.accent2, roughness: 0.4 });
      for (let i = 0; i < 4; i++) {
        const bl = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.05), bladeMat);
        bl.position.x = 0.4;
        bl.castShadow = true;
        const pivot = new THREE.Group();
        pivot.rotation.z = (i / 4) * Math.PI * 2;
        pivot.add(bl);
        blades.add(pivot);
      }
      blades.position.z = 0.25;
      fg.add(blades);
      rec.blades = blades;
      fg.position.set(s2w(f.cx), s2w(f.cy), 0);
      g.add(fg);
      const glyph = this.makeGlyph('➤', theme.accent2);
      glyph.position.set(s2w(f.cx), s2w(f.cy) + 1.3, 0);
      glyph.material.rotation = Math.atan2(f.ndy, f.ndx) - Math.PI / 2;
      g.add(glyph);
      rec.group = fg; rec.glyph = glyph;
      // Subtle particle stream along the fan direction when on.
      const streamGeo = new THREE.BufferGeometry();
      const n = this.q.particles === 'high' ? 36 : 20;
      streamGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const stream = new THREE.Points(streamGeo, new THREE.PointsMaterial({
        color: theme.accent2, size: detailed ? 0.2 : 0.12, transparent: true, opacity: 0.5,
        map: detailed ? this.dotTex() : null, depthWrite: false,
      }));
      stream.visible = false;
      g.add(stream);
      rec.stream = stream; rec.streamN = n;
      this.meshes.fans.set(f.id, rec);
      const proxy = new THREE.Mesh(
        new THREE.CylinderGeometry(1.1, 1.1, 0.6, 10),
        new THREE.MeshBasicMaterial({ visible: false }));
      proxy.rotation.x = Math.PI / 2;
      proxy.position.copy(fg.position);
      proxy.userData = { kind: 'fan', id: f.id };
      g.add(proxy);
      this.interactives.push(proxy);
    }

    // Bumpers: drum cylinders.
    const bumperMat = detailed
      ? new THREE.MeshPhysicalMaterial({ color: theme.accent, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 })
      : new THREE.MeshStandardMaterial({ color: theme.accent, roughness: 0.5 });
    for (const b of state.bumpers) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(s2w(b.r), s2w(b.r), 0.5, detailed ? 40 : 22), bumperMat);
      m.rotation.x = Math.PI / 2;
      m.position.set(s2w(b.x), s2w(b.y), 0);
      m.castShadow = true;
      g.add(m);
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(s2w(b.r), 0.07, detailed ? 12 : 8, detailed ? 48 : 24),
        detailed
          ? new THREE.MeshPhysicalMaterial({ color: theme.metal, metalness: 0.7, roughness: 0.25, clearcoat: 0.5 })
          : new THREE.MeshStandardMaterial({ color: theme.metal, metalness: 0.5, roughness: 0.4 }));
      rim.position.copy(m.position);
      rim.castShadow = true;
      g.add(rim);
    }

    // Spikes: gear with teeth — always distinct silhouette.
    const spikeMat = detailed
      ? new THREE.MeshPhysicalMaterial({
        color: theme.hazard, roughness: 0.4, metalness: 0.15, clearcoat: 0.5, emissive: theme.hazard, emissiveIntensity: 0.05,
      })
      : new THREE.MeshStandardMaterial({ color: theme.hazard, roughness: 0.5 });
    for (const s of state.spikes) {
      const gear = new THREE.Group();
      const core = new THREE.Mesh(new THREE.CylinderGeometry(s2w(s.r) * 0.7, s2w(s.r) * 0.7, 0.4, 16), spikeMat);
      core.rotation.x = Math.PI / 2;
      core.castShadow = true;
      gear.add(core);
      const teeth = 10;
      for (let i = 0; i < teeth; i++) {
        const t = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.4, 6), spikeMat);
        const a = (i / teeth) * Math.PI * 2;
        t.position.set(Math.cos(a) * s2w(s.r) * 0.85, Math.sin(a) * s2w(s.r) * 0.85, 0);
        t.rotation.z = a - Math.PI / 2;
        t.castShadow = true;
        gear.add(t);
      }
      gear.position.set(s2w(s.x), s2w(s.y), 0);
      gear.userData.spin = true;
      g.add(gear);
      this.meshes['spike-' + s.id] = gear;
    }

    // Focus/hint marker: a grounded ring placed under the active target.
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 0.75, 32),
      new THREE.MeshBasicMaterial({ color: theme.accent2, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    g.add(this.marker);

    // Legal-target soft markers.
    this.legalMarkers = new THREE.Group();
    g.add(this.legalMarkers);

    // Particle pool (points-based bursts).
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.tier.particles * 3), 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.tier.particles * 3), 3));
    this.particlePoints = new THREE.Points(pGeo, new THREE.PointsMaterial({
      size: detailed ? 0.26 : 0.18, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
      map: detailed ? this.dotTex() : null,
    }));
    this.particlePoints.frustumCulled = false;
    g.add(this.particlePoints);

    // Ambient sugar motes drifting in front of the wallpaper.
    if (this.tier.motes > 0) {
      const n = this.tier.motes;
      const mGeo = new THREE.BufferGeometry();
      const pos = new Float32Array(n * 3);
      const rnd = texRng(n * 31 + state.stars.length);
      this.moteSeeds = [];
      for (let i = 0; i < n; i++) {
        const seed = { x: F.cx + (rnd() - 0.5) * (F.w + 6), y: F.cy + (rnd() - 0.5) * (F.h + 4), z: -1.6 + rnd() * 2.6, p: rnd() * 6.28, v: 0.15 + rnd() * 0.25 };
        this.moteSeeds.push(seed);
        pos[i * 3] = seed.x; pos[i * 3 + 1] = seed.y; pos[i * 3 + 2] = seed.z;
      }
      mGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.motes = new THREE.Points(mGeo, new THREE.PointsMaterial({
        color: mixHex(theme.star, '#ffffff', 0.5), size: 0.12, transparent: true, opacity: 0.55,
        map: this.dotTex(), depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      this.motes.frustumCulled = false;
      this.moteSpan = { y0: F.cy - F.h / 2 - 2, h: F.h + 4 };
      g.add(this.motes);
    }

    // Room reflections stay a subtle fill so pastel pieces keep their colour.
    if (detailed) {
      g.traverse((o) => {
        const m = o.material;
        if (m && m.isMeshStandardMaterial && m.envMapIntensity === 1) m.envMapIntensity = 0.4;
      });
    }

    // Without this the scene renders as an empty background: every mesh built
    // above lives on `g`, which must be attached to the scene graph.
    this.scene.add(g);

    this.fitCamera();
    this.resize();
  }

  /** Shared soft round sprite for particles (cached per renderer). */
  dotTex() {
    if (!this._dotTex) this._dotTex = dotTexture();
    return this._dotTex;
  }

  gradientTexture(c0, c1) {
    const cv = document.createElement('canvas');
    cv.width = 4; cv.height = 128;
    const ctx = cv.getContext('2d');
    const gr = ctx.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, c1); gr.addColorStop(1, c0);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 4, 128);
    const tex = new THREE.CanvasTexture(cv);
    return tex;
  }

  radialTexture(color) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const ctx = cv.getContext('2d');
    const gr = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
    gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  }

  /** Small sprite label above interactive targets (shape, not color alone). */
  makeGlyph(text, color) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.font = '44px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, 32, 34);
    const tex = new THREE.CanvasTexture(cv);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(0.7, 0.7, 1);
    return sp;
  }

  /** Rebuild one rope's tube + proxy from current anchor/treat positions. */
  rebuildRope(rec, state) {
    const r = rec.rope;
    const ax = s2w(r.wx), ay = s2w(r.wy);
    rec.peg.position.set(ax, ay, 0);
    rec.glyph.position.set(ax, ay + 0.7, 0);
    if (r.cut) {
      if (rec.mesh) { rec.mesh.visible = false; rec.proxy.visible = false; rec.glyph.visible = false; }
      return;
    }
    // An undo can restore a previously cut rope: make it visible/pickable again.
    if (rec.mesh && !rec.mesh.visible) {
      rec.mesh.visible = true; rec.proxy.visible = true; rec.glyph.visible = true;
    }
    const tx = s2w(state.treat.x), ty = s2w(state.treat.y);
    const mid = new THREE.Vector3((ax + tx) / 2, (ay + ty) / 2 - 0.25, 0); // gentle droop
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(ax, ay, 0), mid, new THREE.Vector3(tx, ty, 0));
    const geo = this.detailed
      ? new THREE.TubeGeometry(curve, 24, this.ropeRadius, 8, false)
      : new THREE.TubeGeometry(curve, 16, 0.05, 6, false);
    if (rec.mesh) {
      rec.mesh.geometry.dispose();
      rec.mesh.geometry = geo;
    } else {
      rec.mesh = new THREE.Mesh(geo, rec.mat);
      rec.mesh.castShadow = true;
      this.levelGroup.add(rec.mesh);
    }
    // Proxy follows the rope midpoint.
    const len = Math.max(0.5, Math.hypot(tx - ax, ty - ay));
    rec.proxy.position.set((ax + tx) / 2, (ay + ty) / 2, 0);
    rec.proxy.scale.set(1, len, 1);
    rec.proxy.rotation.z = Math.atan2(ty - ay, tx - ax) - Math.PI / 2;
  }

  /** Highlight a target: 'rope'|'bubble'|'fan' id, plus style 'focus'|'hint'|null. */
  setHighlight(kind, id, style) {
    this.highlighted = id ? { kind, id, style: style || 'focus' } : null;
  }

  /** Mark the currently legal targets with soft ring markers. */
  setLegalTargets(actions, state) {
    this._lastActions = actions;
    this.legal = new Set(actions.map((a) => a.type + ':' + a.id));
    if (!this.levelGroup) return;
    while (this.legalMarkers.children.length) {
      const c = this.legalMarkers.children.pop();
      this.legalMarkers.remove(c);
    }
    if (this.opts.reducedMotion) return;
    for (const a of actions) {
      const pos = this.targetWorldPos(a, state);
      if (!pos) continue;
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.35, 0.45, 24),
        new THREE.MeshBasicMaterial({
          color: this.theme.accent2, transparent: true, opacity: 0.35, side: THREE.DoubleSide,
        }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(pos.x, pos.y - 0.6, 0);
      this.legalMarkers.add(m);
    }
  }

  /** World position of an actionable target (for markers/camera). */
  targetWorldPos(a, state) {
    if (a.type === 'cut') {
      const r = state.ropes.find((x) => x.id === a.id);
      return r ? { x: s2w(r.wx), y: s2w(r.wy) } : null;
    }
    if (a.type === 'pop') {
      const b = state.bubbles.find((x) => x.id === a.id);
      return b ? { x: s2w(b.x), y: s2w(b.y) } : null;
    }
    const f = state.fans.find((x) => x.id === a.id);
    return f ? { x: s2w(f.cx), y: s2w(f.cy) } : null;
  }

  /** Spawn a pooled particle burst at a world position. */
  burst(x, y, color, count = 14) {
    if (this.opts.reducedMotion || !this._ok) return;
    const cap = Math.min(count, this.tier.particles - this.particles.length);
    for (let i = 0; i < cap; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 3;
      this.particles.push({
        x, y, z: 0.3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 1.5,
        life: 0.6 + Math.random() * 0.4, t: 0, color,
      });
    }
  }

  /** Handle rules events: particles, camera nudge, mesh state changes. */
  handleEvents(events, state) {
    if (!this._ok) return;
    for (const ev of events) {
      const p = ev.x !== undefined ? { x: s2w(ev.x), y: s2w(ev.y) } : null;
      switch (ev.type) {
        case 'cut': {
          const rec = this.meshes.ropes.get(ev.id);
          if (rec) this.burst(s2w(rec.rope.wx), s2w(rec.rope.wy) - 0.5, this.theme.rope, 10);
          break;
        }
        case 'star': this.burst(p.x, p.y, this.theme.star, 18); break;
        case 'bubble-pop': this.burst(p.x, p.y, this.theme.accent2, 16); break;
        case 'bumper': this.burst(p.x, p.y, this.theme.accent, 10); break;
        case 'delivered':
          this.burst(p.x, p.y, this.theme.accent2, 30);
          this.burst(p.x, p.y + 0.5, this.theme.star, 20);
          if (!this.opts.reducedMotion) this.camNudge = 0.35;
          break;
        case 'hazard': this.burst(p.x, p.y, this.theme.hazard, 22); break;
        default: break;
      }
    }
  }

  /**
   * Per-frame update. `alpha` interpolates the treat between the previous
   * and current tick positions for smooth rendering at 120 Hz sim.
   */
  update(state, prevTreat, alpha, dt) {
    if (!this._ok || !this.levelGroup) return;
    this._lastState = state;
    this.time += dt;
    const ambient = this.ambientMotion;
    const hidden = typeof document !== 'undefined' && document.hidden;

    // Interpolated treat position.
    const cx = s2w(prevTreat.x + (state.treat.x - prevTreat.x) * alpha);
    const cy = s2w(prevTreat.y + (state.treat.y - prevTreat.y) * alpha);
    this.treatMesh.position.set(cx, cy, 0);
    if (!this.opts.reducedMotion && !hidden) {
      this.treatMesh.rotation.y += dt * 1.2;
    }
    this.contactShadow.position.set(cx, s2w(state.bounds.minY) + 0.42, 0);
    const hgt = Math.max(0, cy - s2w(state.bounds.minY));
    this.contactShadow.material.opacity = Math.max(0.08, 0.5 - hgt * 0.04);
    const sc = Math.max(0.5, 1.2 - hgt * 0.05);
    this.contactShadow.scale.set(sc, sc, 1);

    // Trail cosmetic ghosts.
    if (this.trailKind !== 'none' && !this.opts.reducedMotion && !hidden) {
      if (!this._trailClock || this.time - this._trailClock > 0.08) {
        this._trailClock = this.time;
        const colors = { sparkle: this.theme.star, bubbles: this.theme.accent2, rainbow: this.theme.accent };
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(0.16, 8, 6),
          new THREE.MeshBasicMaterial({ color: colors[this.trailKind] || this.theme.star, transparent: true, opacity: 0.5 }));
        m.position.set(cx, cy, -0.2);
        this.levelGroup.add(m);
        this.trail.push({ mesh: m, t: 0 });
      }
    }
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const tr = this.trail[i];
      tr.t += dt;
      tr.mesh.material.opacity = Math.max(0, 0.5 - tr.t);
      tr.mesh.scale.multiplyScalar(0.985);
      if (tr.t > 0.5) {
        this.levelGroup.remove(tr.mesh);
        tr.mesh.geometry.dispose(); tr.mesh.material.dispose();
        this.trail.splice(i, 1);
      }
    }

    // Ropes follow anchors/treat. Re-bind by id every frame: an undo replaces
    // the whole state object, so cached record references go stale.
    for (const [id, rec] of this.meshes.ropes) {
      const r = state.ropes.find((x) => x.id === id);
      if (r) rec.rope = r;
      this.rebuildRope(rec, state);
    }

    // Sliders move their carriages.
    for (const [id, rec] of this.meshes.sliders) {
      const s = state.sliders.find((x) => x.id === id);
      if (s) rec.slider = s;
      rec.carriage.position.set(s2w(rec.slider.x), s2w(rec.slider.y), 0);
    }

    // Stars spin/shine; hide collected.
    for (const [id, m] of this.meshes.stars) {
      const s = state.stars.find((x) => x.id === id);
      m.visible = s && !s.got;
      if (m.visible && !this.opts.reducedMotion && !hidden) {
        m.rotation.y += dt * 2;
        m.material.emissiveIntensity = this.detailed
          ? 0.55 + 0.25 * Math.sin(this.time * 4)
          : 0.3 + 0.15 * Math.sin(this.time * 4);
      }
    }

    // Bubbles follow state; pop hides.
    for (const [id, rec] of this.meshes.bubbles) {
      const b = state.bubbles.find((x) => x.id === id);
      const gone = !b || b.state === 2;
      rec.mesh.visible = !gone;
      rec.glyph.visible = !gone && b.state === 1;
      if (!gone) rec.mesh.position.set(s2w(b.x), s2w(b.y), 0);
    }

    // Fans: spin blades when on, drive the particle stream.
    for (const [id, rec] of this.meshes.fans) {
      const f = state.fans.find((x) => x.id === id);
      const on = f && f.on;
      if (on && !hidden) rec.blades.rotation.z += dt * (this.opts.reducedMotion ? 3 : 10);
      rec.stream.visible = !!on && !this.opts.reducedMotion;
      if (rec.stream.visible) {
        const posAttr = rec.stream.geometry.getAttribute('position');
        const dx = f.ndx / 1024, dy = f.ndy / 1024;
        for (let i = 0; i < rec.streamN; i++) {
          const t = ((this.time * 2 + i / rec.streamN) % 1);
          posAttr.setXYZ(i,
            s2w(f.cx) + dx * t * 4 + Math.sin(i * 7) * 0.3,
            s2w(f.cy) + dy * t * 4 + Math.cos(i * 5) * 0.3, 0.2);
        }
        posAttr.needsUpdate = true;
      }
      rec.group.children[0].material.color.set(on ? this.theme.accent2 : this.theme.metal);
    }

    // Focus/hint marker under the highlighted target.
    if (this.highlighted) {
      const pos = this.targetWorldPos(
        { type: { rope: 'cut', bubble: 'pop' }[this.highlighted.kind] || this.highlighted.kind, id: this.highlighted.id }, state);
      if (pos) {
        this.marker.visible = true;
        this.marker.position.set(pos.x, pos.y - 0.8, 0);
        const pulse = this.highlighted.style === 'hint'
          ? 1 + 0.25 * Math.sin(this.time * 8) : 1;
        this.marker.scale.set(pulse, pulse, 1);
        this.marker.material.color.set(this.highlighted.style === 'hint' ? this.theme.star : this.theme.accent2);
      } else {
        this.marker.visible = false;
      }
    } else {
      this.marker.visible = false;
    }

    // Particle bursts.
    const posAttr = this.particlePoints.geometry.getAttribute('position');
    const colAttr = this.particlePoints.geometry.getAttribute('color');
    const col = new THREE.Color();
    let pi = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.t += dt;
      if (p.t >= p.life) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 6 * dt;
      posAttr.setXYZ(pi, p.x, p.y, p.z);
      col.set(p.color);
      colAttr.setXYZ(pi, col.r, col.g, col.b);
      pi++;
    }
    for (let i = pi; i < this.tier.particles; i++) posAttr.setXYZ(i, 0, -999, 0);
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;

    // Camera: fixed framing + delivery nudge decay.
    if (this.camNudge > 0) {
      this.camNudge = Math.max(0, this.camNudge - dt);
      const k = this.camNudge * 0.4;
      this.camera.position.set(
        this.baseCamPos.x + Math.sin(this.time * 40) * k,
        this.baseCamPos.y + Math.cos(this.time * 34) * k,
        this.baseCamPos.z);
    } else {
      this.camera.position.copy(this.baseCamPos);
    }

    // Morsel idle bob.
    if (!this.opts.reducedMotion && !hidden) {
      this.morsel.position.y = s2w(state.recipient.y) - 0.1 + Math.sin(this.time * 2) * 0.06;
      this.morsel.rotation.z = Math.sin(this.time * 1.4) * 0.05;
    }

    // Blink every few seconds (decorative).
    const eyes = this.morsel.userData.eyes;
    if (eyes) {
      const ph = (this.time + 0.7) % 3.6;
      const lid = ambient && !hidden && ph < 0.14 ? 0.15 : 1;
      for (const e of eyes) e.scale.y = lid;
    }

    // Animated wallpaper drifts slowly; ambient sugar motes float upward.
    if (this.wallpaper && this.q.background === 'animated' && ambient && !hidden) {
      this.wallpaper.offset.set(this.time * 0.012, this.time * 0.02);
    }
    if (this.motes) {
      this.motes.visible = ambient;
      if (ambient && !hidden) {
        const pa = this.motes.geometry.getAttribute('position');
        const sp = this.moteSpan;
        for (let i = 0; i < this.moteSeeds.length; i++) {
          const m = this.moteSeeds[i];
          const y = sp.y0 + ((m.y - sp.y0 + this.time * m.v) % sp.h + sp.h) % sp.h;
          pa.setXYZ(i, m.x + Math.sin(this.time * 0.6 + m.p) * 0.35, y, m.z);
        }
        pa.needsUpdate = true;
      }
    }

    this._draw();
  }

  /** Raycast pointer NDC against the interaction layer only. */
  pick(ndcX, ndcY) {
    if (!this._ok || !this.levelGroup) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hits = ray.intersectObjects(this.interactives.filter((m) => m.visible !== false && m.parent));
    for (const h of hits) {
      const u = h.object.userData;
      if (u && u.kind) return { kind: u.kind, id: u.id, point: h.point };
    }
    return null;
  }

  /** True if world (x, y) falls within an uncut rope's stroke corridor. */
  swipeCutsRope(state, x0, y0, x1, y1) {
    for (const r of state.ropes) {
      if (r.cut) continue;
      const ax = s2w(r.wx), ay = s2w(r.wy);
      const tx = s2w(state.treat.x), ty = s2w(state.treat.y);
      if (segmentsIntersect(x0, y0, x1, y1, ax, ay, tx, ty)) return r.id;
    }
    return null;
  }

  dispose() {
    this.disposed = true;
    if (this._ok) this.renderer.dispose();
  }
}

/**
 * Camera framing box: the area the round is actually played in (treat,
 * recipient, anchors, stars, hazards and helpers) plus margin, clamped to the
 * level bounds. The generous default bounds exist for out-of-bounds rules;
 * framing them directly would shrink the playfield to a sliver of the view.
 */
function contentFrame(state, boundsW) {
  const pts = [
    { x: s2w(state.treat.x), y: s2w(state.treat.y) },
    { x: s2w(state.recipient.x), y: s2w(state.recipient.y) },
  ];
  for (const r of state.ropes) if (r.slider < 0) pts.push({ x: s2w(r.ax), y: s2w(r.ay) });
  for (const s of state.sliders) {
    pts.push({ x: s2w(s.x0), y: s2w(s.y0) }, { x: s2w(s.x1), y: s2w(s.y1) });
  }
  for (const coll of ['stars', 'bubbles', 'bumpers', 'spikes']) {
    for (const e of state[coll]) pts.push({ x: s2w(e.x), y: s2w(e.y) });
  }
  for (const f of state.fans) {
    pts.push({ x: s2w(f.x0), y: s2w(f.y0) }, { x: s2w(f.x1), y: s2w(f.y1) });
  }
  const MARGIN = 3;
  const MIN_W = 14;
  const MIN_H = 11;
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return boundsW;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const w = Math.min(boundsW.w, Math.max(MIN_W, maxX - minX + MARGIN * 2));
  const h = Math.min(boundsW.h, Math.max(MIN_H, maxY - minY + MARGIN * 2));
  return { cx, cy, w, h };
}

function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}
