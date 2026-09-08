// render.js — Three.js presentation layer for Tether Treat.
//
// Reads rules state each frame and rebuilds/updates meshes to match; it
// never mutates rules state. One WebGL renderer, perspective camera fitted
// to the level bounds, ACES tone mapping, key + hemisphere lights, contact
// shadow blob. Interactive targets (ropes, bubbles, fans) carry hit-proxy
// meshes in an explicit interaction layer for raycasting. Quality tiers cap
// pixel ratio, particle counts and shadows — never rules or hazard
// visibility. Reduced motion disables particles and camera nudges.

import * as THREE from '../vendor/three.module.js';
import { s2w, sliderPosition } from './physics.js';
import { SUB } from './rules.js';

const TIER = {
  low: { pixelRatio: 1, particles: 24, shadows: false },
  medium: { pixelRatio: 1.5, particles: 64, shadows: false },
  high: { pixelRatio: 2, particles: 160, shadows: true },
};

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
function buildTreatMesh(theme, cosmetic) {
  const group = new THREE.Group();
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push(new THREE.Vector2(Math.sin(t * Math.PI) * 0.5, (t - 0.5) * 0.9));
  }
  const body = new THREE.Mesh(
    new THREE.LatheGeometry(pts, 24),
    new THREE.MeshStandardMaterial({ color: theme.treat, roughness: 0.35, metalness: 0.05 }));
  group.add(body);
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(0.42, 0.09, 10, 28),
    new THREE.MeshStandardMaterial({ color: theme.accent2, roughness: 0.4 }));
  band.rotation.x = Math.PI / 2;
  group.add(band);
  if (cosmetic === 'sprinkle' || cosmetic === 'astro') {
    const sprinkleGeo = new THREE.BoxGeometry(0.06, 0.06, 0.16);
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
function buildMorsel(theme, r) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.75, 24, 18),
    new THREE.MeshStandardMaterial({ color: theme.accent, roughness: 0.6 }));
  body.scale.y = 0.85;
  body.position.y = 0.55;
  g.add(body);
  const eyeGeo = new THREE.SphereGeometry(0.11, 10, 8);
  const eyeMat = new THREE.MeshStandardMaterial({ color: '#1a1230' });
  for (const dx of [-0.24, 0.24]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(dx, 0.75, 0.62);
    g.add(eye);
  }
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
    this.tier = TIER.medium;
    this.time = 0;
    this.disposed = false;
    this.interactives = [];  // hit proxies: {mesh, kind:'rope'|'bubble'|'fan', id}
    this.particles = [];
    this.particlePool = [];
    this.highlighted = null;
    this.hinted = null;
    this.legal = new Set();
    this.quality = 'medium';
    this._ok = this.init();
  }

  get ok() { return this._ok; }

  init() {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    } catch (e) {
      return false;
    }
    this.renderer = renderer;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.baseCamPos = new THREE.Vector3(0, 6, 30);
    this.camNudge = 0;

    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (this.opts.onContextLost) this.opts.onContextLost();
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      if (this.opts.onContextRestored) this.opts.onContextRestored();
    });

    this.levelGroup = null;
    return true;
  }

  setQuality(q) {
    this.quality = q;
    this.tier = TIER[q] || TIER.medium;
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, this.tier.pixelRatio));
    this.renderer.shadowMap.enabled = this.tier.shadows;
    if (this.keyLight) this.keyLight.castShadow = this.tier.shadows;
    this.resize();
  }

  resize() {
    if (!this._ok) return;
    const w = this.canvas.clientWidth || 640;
    const h = this.canvas.clientHeight || 480;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.fitCamera();
    this.camera.updateProjectionMatrix();
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
      this.levelGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    this.interactives = [];
    this.particles = [];
    const g = new THREE.Group();
    this.levelGroup = g;
    this.theme = theme;
    this.cosmetics = cosmetics;
    this.meshes = { ropes: new Map(), bubbles: new Map(), fans: new Map(), stars: new Map(), sliders: new Map() };

    this.scene.background = new THREE.Color(theme.bg0);
    this.scene.fog = new THREE.Fog(theme.fog, 30, 90);

    // Lights.
    const hemi = new THREE.HemisphereLight(theme.key, theme.floor, 0.9);
    g.add(hemi);
    const key = new THREE.DirectionalLight(theme.key, 1.4);
    key.position.set(6, 18, 12);
    key.castShadow = this.tier.shadows;
    g.add(key);
    this.keyLight = key;

    const B = state.bounds;
    const minX = s2w(B.minX), maxX = s2w(B.maxX), minY = s2w(B.minY), maxY = s2w(B.maxY);
    this.boundsW = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
    this.frameW = contentFrame(state, this.boundsW);

    // Candy playroom: gradient backdrop, floor, walls.
    const grad = this.gradientTexture(theme.bg0, theme.bg1);
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(this.boundsW.w + 30, this.boundsW.h + 20),
      new THREE.MeshBasicMaterial({ map: grad }));
    back.position.set(this.boundsW.cx, this.boundsW.cy, -4);
    g.add(back);
    const floorMat = new THREE.MeshStandardMaterial({
      color: cosmetics.room === 'garden' ? '#3c8a5f' : cosmetics.room === 'clocktower' ? '#5d4a8a' : theme.floor,
      roughness: 0.9,
    });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(this.boundsW.w + 30, 1.6, 10), floorMat);
    floor.position.set(this.boundsW.cx, minY - 0.4, 1);
    floor.receiveShadow = true;
    g.add(floor);
    const wallMat = new THREE.MeshStandardMaterial({ color: theme.wall, roughness: 0.95 });
    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.8, this.boundsW.h + 12, 6), wallMat);
      wall.position.set(sx > 0 ? maxX + 0.6 : minX - 0.6, this.boundsW.cy, 0);
      g.add(wall);
    }

    // Treat (with a soft contact-shadow blob).
    this.treatMesh = buildTreatMesh(theme, cosmetics.treat);
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
    this.morsel = buildMorsel(theme, state.recipient.r);
    this.morsel.position.set(s2w(state.recipient.x), s2w(state.recipient.y) - 0.1, 0);
    g.add(this.morsel);

    // Ropes: drooping quadratic tubes + peg anchors; rebuilt on cut/move.
    const ropeMat = new THREE.MeshStandardMaterial({ color: theme.rope, roughness: 0.7 });
    const pegMat = new THREE.MeshStandardMaterial({ color: theme.metal, roughness: 0.4, metalness: 0.4 });
    for (const r of state.ropes) {
      const rec = { rope: r, mesh: null, mat: ropeMat };
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 12), pegMat);
      peg.rotation.x = Math.PI / 2;
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
      g.add(rail);
      const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), pegMat);
      g.add(carriage);
      rec.carriage = carriage;
      this.meshes.sliders.set(s.id, rec);
    }

    // Stars: extruded, spin + shine while uncollected.
    const starGeo = new THREE.ExtrudeGeometry(starShape(0.55), { depth: 0.15, bevelEnabled: false });
    const starMat = new THREE.MeshStandardMaterial({
      color: theme.star, emissive: theme.star, emissiveIntensity: 0.35, roughness: 0.3,
    });
    for (const s of state.stars) {
      const m = new THREE.Mesh(starGeo, starMat);
      m.position.set(s2w(s.x), s2w(s.y), 0);
      g.add(m);
      this.meshes.stars.set(s.id, m);
    }

    // Bubbles.
    for (const b of state.bubbles) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(s2w(b.r), 20, 14),
        new THREE.MeshStandardMaterial({
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
        new THREE.CylinderGeometry(0.85, 0.95, 0.4, 20),
        new THREE.MeshStandardMaterial({ color: theme.metal, roughness: 0.5, metalness: 0.3 }));
      housing.rotation.x = Math.PI / 2;
      fg.add(housing);
      const blades = new THREE.Group();
      const bladeMat = new THREE.MeshStandardMaterial({ color: theme.accent2, roughness: 0.4 });
      for (let i = 0; i < 4; i++) {
        const bl = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.05), bladeMat);
        bl.position.x = 0.4;
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
      const n = 20;
      streamGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const stream = new THREE.Points(streamGeo, new THREE.PointsMaterial({
        color: theme.accent2, size: 0.12, transparent: true, opacity: 0.5,
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
    const bumperMat = new THREE.MeshStandardMaterial({ color: theme.accent, roughness: 0.5 });
    for (const b of state.bumpers) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(s2w(b.r), s2w(b.r), 0.5, 22), bumperMat);
      m.rotation.x = Math.PI / 2;
      m.position.set(s2w(b.x), s2w(b.y), 0);
      g.add(m);
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(s2w(b.r), 0.07, 8, 24),
        new THREE.MeshStandardMaterial({ color: theme.metal, metalness: 0.5, roughness: 0.4 }));
      rim.position.copy(m.position);
      g.add(rim);
    }

    // Spikes: gear with teeth — always distinct silhouette.
    const spikeMat = new THREE.MeshStandardMaterial({ color: theme.hazard, roughness: 0.5 });
    for (const s of state.spikes) {
      const gear = new THREE.Group();
      const core = new THREE.Mesh(new THREE.CylinderGeometry(s2w(s.r) * 0.7, s2w(s.r) * 0.7, 0.4, 16), spikeMat);
      core.rotation.x = Math.PI / 2;
      gear.add(core);
      const teeth = 10;
      for (let i = 0; i < teeth; i++) {
        const t = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.4, 6), spikeMat);
        const a = (i / teeth) * Math.PI * 2;
        t.position.set(Math.cos(a) * s2w(s.r) * 0.85, Math.sin(a) * s2w(s.r) * 0.85, 0);
        t.rotation.z = a - Math.PI / 2;
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
      size: 0.18, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
    }));
    this.particlePoints.frustumCulled = false;
    g.add(this.particlePoints);

    // Without this the scene renders as an empty background: every mesh built
    // above lives on `g`, which must be attached to the scene graph.
    this.scene.add(g);

    this.fitCamera();
    this.resize();
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
    const geo = new THREE.TubeGeometry(curve, 16, 0.05, 6, false);
    if (rec.mesh) {
      rec.mesh.geometry.dispose();
      rec.mesh.geometry = geo;
    } else {
      rec.mesh = new THREE.Mesh(geo, rec.mat);
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
    this.time += dt;
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
        m.material.emissiveIntensity = 0.3 + 0.15 * Math.sin(this.time * 4);
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
        { type: this.highlighted.kind === 'rope' ? 'cut' : this.highlighted.kind, id: this.highlighted.id }, state);
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

    this.renderer.render(this.scene, this.camera);
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
