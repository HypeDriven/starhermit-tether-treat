// The candy-coloured mechanical playroom on starhermit:scene, as the browser
// build's js/render.js drew it with three.js r160: the perspective camera
// (42°) fitted to the round's content frame, the wallpapered back wall with
// its skirting board, the checker-tile floor and the side walls (Detailed),
// or the plain gradient backdrop and Lambert room (Low); the clear-coated
// candy-striped treat with its band (sprinkles, choco, minty and astro
// cosmetics) and contact-shadow blob, Morsel (eyes with catchlights that
// blink, the open mouth, the capture ring), the ropes as drooping twisted
// bands from their pegs, slider rails and carriages, bevelled glossy stars
// that spin and pulse, the soap bubbles, the fans (housing, pinwheel blades,
// direction glyph and air stream), the drum bumpers with metal rims, the
// spiky gears, the focus/hint marker and the legal-target rings, pooled
// particle bursts, sugar motes, trail ghosts and the delivery camera nudge.
//
// Engine minor 23 follows three.js r185's light units and shadows. The old
// page was r160 (physically correct lights by default since r155), so its
// light intensities are used as written (no ÷ π), with its own shadow camera
// (fitted to the framed play area), bias −0.0004, normal bias 0.03 and
// radius 3 (PCFSoftShadowMap draws as PCF). Its reflections: at Detailed the
// RoomEnvironment built with the renderer (r160's call, unchanged) through
// PMREM at sigma 0.04, and each material's own envMapIntensity (the wall
// 0.35, the floor 0.3, the bubbles 0.9, the rest lowered from 1 to 0.4).
// r160 applied a material's envMapIntensity to scene.environment; from host
// API minor 20 the scene's environment takes only environmentIntensity (as
// r163+), so each lit material carries the environment as its own envMap at
// its old intensity — r160's result. The old composer (RenderPass in half
// floats → GTAO → UnrealBloom 0.45 / 0.35 / 0.92 → OutputPass with ACES at
// 1.05 → the display-space grade + vignette → SMAA / FXAA, or the canvas's
// MSAA) is the runtime's renderer.ao / bloom / grade / antialias. Not drawn
// by the engine: MeshPhysicalMaterial's sheen (Morsel) and iridescence (the
// bubbles), which keep their clear coat.
//
// The old canvas sat in its own box between the header and the rails; the
// camera is fitted to that box's aspect and shown there with a view offset
// (screens.ts paints the page around it). Canvas textures the old page left
// in NoColorSpace stay NoColorSpace (minor 28+ reads them as stored, as three).
import {
  ACESFilmicToneMapping, AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CapsuleGeometry, Color,
  ConeGeometry, CylinderGeometry, DirectionalLight, DoubleSide, ExtrudeGeometry, Fog, Group, HemisphereLight, LatheGeometry, Mesh,
  MeshBasicMaterial, MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial, PCFSoftShadowMap, PMREMGenerator,
  PerspectiveCamera, Plane, PlaneGeometry, Points, PointsMaterial, Raycaster, RepeatWrapping, RingGeometry, RoomEnvironment,
  SRGBColorSpace, Shape, SphereGeometry, Sprite, SpriteMaterial, TorusGeometry, Vector2, Vector3, pointerToNdc, renderer, scene,
  type Material, type Object3D, type Texture,
} from "starhermit:scene";
import { OffscreenCanvas, type OffscreenCanvasRenderingContext2D } from "starhermit:canvas";
import { s2w, type Action, type GameEvent, type Rope, type State, type Theme } from "./game.ts";
import { moteCount, poolSize, type Look } from "./quality.ts";

export interface Rect { x: number; y: number; width: number; height: number }
type Lit = MeshLambertMaterial | MeshStandardMaterial | MeshPhysicalMaterial;
type Cosmetics = { treat?: string; trail?: string; room?: string };

const camera = new PerspectiveCamera(42, 1, 0.1, 200);
const baseCamPos = new Vector3(0, 6, 30);
let look: Look | null = null;
let reducedMotion = false;
let envTex: Texture | null = null;

// ---------------------------------------------------------------- materials (render.js litMaterial)
const seg = (n: number, min = 4): number => Math.max(min, Math.round(n * look!.budget.segments));
const LAMBERT = ["color", "map", "emissive", "emissiveIntensity", "transparent", "opacity", "side", "depthWrite"];
const STANDARD = [...LAMBERT, "roughness", "metalness", "envMapIntensity"];
const PHYSICAL = [...STANDARD, "clearcoat", "clearcoatRoughness"];
type P = Record<string, unknown>;
const only = (params: P, keys: string[]): P => Object.fromEntries(Object.entries(params).filter(([k]) => keys.includes(k)));
function litMaterial(kind: "lambert" | "standard" | "physical", params: P): Lit {
  if (kind === "lambert") return new MeshLambertMaterial(only(params, LAMBERT));
  if (kind === "standard") return new MeshStandardMaterial(only(params, STANDARD));
  return new MeshPhysicalMaterial(only(params, PHYSICAL));
}
/** The clear-coated look (Physical on High/Ultra, Standard on Balanced, Lambert on Low). */
const physMat = (p: P): Lit => litMaterial(look!.budget.material, p);
/** Plain PBR (Standard, Lambert on Low). */
const stdMat = (p: P): Lit => litMaterial(look!.budget.material === "lambert" ? "lambert" : "standard", p);

// ---------------------------------------------------------------- colour helpers
function hexOf(c: Color): string { return "#" + c.getHex().toString(16).padStart(6, "0"); }
/** render.js mixHex (three's lerp in linear light). */
function mixHex(a: string, b: string, t: number): string { return hexOf(new Color(a).lerp(new Color(b), t)); }

// ---------------------------------------------------------------- canvas textures (render.js)
function texRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Ctx = OffscreenCanvasRenderingContext2D;
function canvasTex(w: number, h: number, paint: (ctx: Ctx, w: number, h: number) => void, o: { repeat?: [number, number]; fixed?: boolean } = {}): CanvasTexture {
  const k = o.fixed ? 1 : look!.budget.texture;
  const cv = new OffscreenCanvas(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
  const ctx = cv.getContext("2d")!;
  ctx.scale(cv.width / w, cv.height / h);
  paint(ctx, w, h);
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  if (o.repeat) { tex.wrapS = tex.wrapT = RepeatWrapping; tex.repeat.set(o.repeat[0], o.repeat[1]); }
  tex.anisotropy = 4;
  return tex;
}
/** Candy wallpaper: soft vertical stripes, polka dots and fine paper grain. */
function wallpaperTexture(theme: Theme): CanvasTexture {
  return canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = mixHex(theme.bg1, theme.wall, 0.35); ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = mixHex(theme.bg1, theme.bg0, 0.35);
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
      ctx.fillStyle = rnd() < 0.5 ? "#000" : "#fff";
      ctx.fillRect(rnd() * w, rnd() * h, 1, 1);
    }
    ctx.globalAlpha = 1;
  }, { repeat: [6, 4] });
}
/** Checker tiles with a faint bevel line: the playroom floor. */
function floorTexture(color: string): CanvasTexture {
  return canvasTex(128, 128, (ctx, w, h) => {
    const a = color, b = mixHex(color, "#ffffff", 0.12);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { ctx.fillStyle = (x + y) % 2 ? a : b; ctx.fillRect(x * 64, y * 64, 64, 64); }
    ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 2;
    for (let i = 0; i <= 128; i += 64) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke();
    }
  }, { repeat: [14, 3] });
}
/** Diagonal candy-cane bands (white/grey so a material colour tints them). */
function bandTexture(bands: number, light: string, dark: string): CanvasTexture {
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
let dotTexCache: CanvasTexture | null = null;
/** Round soft dot for particles and motes. */
function dotTex(): CanvasTexture {
  dotTexCache ??= canvasTex(32, 32, (ctx) => {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.45, "rgba(255,255,255,0.8)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
  }, { fixed: true });
  return dotTexCache;
}
/** The Low backdrop: bg1 at the top to bg0 at the bottom (NoColorSpace in the old page). */
function gradientTexture(c0: string, c1: string): CanvasTexture {
  const cv = new OffscreenCanvas(4, 128);
  const ctx = cv.getContext("2d")!;
  const gr = ctx.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, c1); gr.addColorStop(1, c0);
  ctx.fillStyle = gr; ctx.fillRect(0, 0, 4, 128);
  return new CanvasTexture(cv);
}
function radialTexture(alpha: number): CanvasTexture {
  const cv = new OffscreenCanvas(64, 64);
  const ctx = cv.getContext("2d")!;
  const gr = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  gr.addColorStop(0, `rgba(0,0,0,${alpha})`); gr.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(cv);
}
/** Small sprite label above interactive targets (shape, not colour alone). */
function makeGlyph(text: string, color: string): Sprite {
  const cv = new OffscreenCanvas(64, 64);
  const ctx = cv.getContext("2d")!;
  ctx.font = "44px sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text, 32, 34);
  const sp = new Sprite(new SpriteMaterial({ map: new CanvasTexture(cv), transparent: true, depthTest: false }));
  sp.scale.set(0.7, 0.7, 1);
  return sp;
}

function starShape(r = 0.55, points = 5): Shape {
  const shape = new Shape();
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

/** Rounded candy-swirl treat: lathe body + decorative torus band + sprinkles. */
function buildTreatMesh(theme: Theme, cosmetic: string | undefined, detailed: boolean): Group {
  const group = new Group();
  const pts: Vector2[] = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(new Vector2(Math.sin(t * Math.PI) * 0.5, (t - 0.5) * 0.9)); }
  let bodyMat: Lit;
  if (detailed) {
    const map = bandTexture(8, "#ffffff", "#d6d6d6");
    map.repeat.set(2, 1);
    bodyMat = physMat({ color: theme.treat, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, map });
  } else bodyMat = stdMat({ color: theme.treat, roughness: 0.35, metalness: 0.05 });
  const body = new Mesh(new LatheGeometry(pts, seg(detailed ? 40 : 24)), bodyMat);
  group.add(body);
  const band = new Mesh(
    new TorusGeometry(0.42, 0.09, seg(detailed ? 16 : 10), seg(detailed ? 40 : 28)),
    detailed ? physMat({ color: theme.accent2, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 }) : stdMat({ color: theme.accent2, roughness: 0.4 }));
  band.rotation.x = Math.PI / 2;
  group.add(band);
  if (cosmetic === "sprinkle" || cosmetic === "astro") {
    const geo = detailed ? new CapsuleGeometry(0.03, 0.12, 2, 6) : new BoxGeometry(0.06, 0.06, 0.16);
    const mat = stdMat({ color: theme.star, roughness: 0.5 });
    for (let i = 0; i < 8; i++) {
      const s = new Mesh(geo, mat);
      const a = (i / 8) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.42, Math.sin(a * 3) * 0.25, Math.sin(a) * 0.42);
      s.rotation.set(a, a * 2, a * 0.5);
      group.add(s);
    }
  }
  if (cosmetic === "choco") bodyMat.color.set("#7a4a2a");
  else if (cosmetic === "minty") bodyMat.color.set("#a8f0d8");
  else if (cosmetic === "astro") { bodyMat.emissive = new Color(theme.accent2); bodyMat.emissiveIntensity = 0.25; }
  return group;
}

/** Morsel: body, eyes (catchlights when detailed), open mouth, the capture ring on the floor. */
function buildMorsel(theme: Theme, r: number, detailed: boolean): { group: Group; eyes: Mesh[] } {
  const g = new Group();
  const body = new Mesh(new SphereGeometry(0.75, seg(detailed ? 40 : 24), seg(detailed ? 30 : 18)),
    detailed ? physMat({ color: theme.accent, roughness: 0.55, clearcoat: 0.25 }) : stdMat({ color: theme.accent, roughness: 0.6 }));
  body.scale.y = 0.85;
  body.position.y = 0.55;
  g.add(body);
  const eyeGeo = new SphereGeometry(0.11, seg(detailed ? 16 : 10), seg(detailed ? 12 : 8));
  const eyeMat = detailed ? physMat({ color: "#1a1230", roughness: 0.15, clearcoat: 1 }) : stdMat({ color: "#1a1230" });
  const eyes: Mesh[] = [];
  for (const dx of [-0.24, 0.24]) {
    const eye = new Mesh(eyeGeo, eyeMat);
    eye.position.set(dx, 0.75, 0.62);
    g.add(eye);
    eyes.push(eye);
    if (detailed) {
      const glint = new Mesh(new SphereGeometry(0.03, 8, 6), new MeshBasicMaterial({ color: "#ffffff" }));
      glint.position.set(0.035, 0.04, 0.09);
      eye.add(glint);
    }
  }
  const mouth = new Mesh(new TorusGeometry(0.28, 0.09, 10, 24), stdMat({ color: "#5e1030", roughness: 0.7 }));
  mouth.position.set(0, 0.42, 0.64);
  g.add(mouth);
  const ring = new Mesh(new RingGeometry(s2w(r) - 0.08, s2w(r), 40),
    new MeshBasicMaterial({ color: theme.accent2, transparent: true, opacity: 0.5, side: DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  g.add(ring);
  return { group: g, eyes };
}

// ---------------------------------------------------------------- the rope band (render.js TubeGeometry along a quadratic Bézier)
interface RopeRec {
  rope: Rope; peg: Mesh; glyph: Sprite; mesh: Mesh; tubular: number; radial: number; radius: number;
}
function ropeGeometry(tubular: number, radial: number): BufferGeometry {
  const n = (tubular + 1) * (radial + 1);
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute("normal", new BufferAttribute(new Float32Array(n * 3), 3));
  const uv = new Float32Array(n * 2);
  const idx: number[] = [];
  for (let i = 0; i <= tubular; i++) {
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      uv[k * 2] = i / tubular; uv[k * 2 + 1] = j / radial;
      if (i < tubular && j < radial) {
        const a = k, b = k + radial + 1, c = b + 1, d = a + 1;
        idx.push(a, b, d, b, c, d);
      }
    }
  }
  geo.setAttribute("uv", new BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}
/** The tube's rings from the peg (ax, ay) through the drooping midpoint to the treat (tx, ty), in the z = 0 plane. */
function shapeRope(rec: RopeRec, ax: number, ay: number, tx: number, ty: number): void {
  const geo = rec.mesh.geometry;
  const pos = geo.getAttribute("position") as BufferAttribute, nor = geo.getAttribute("normal") as BufferAttribute;
  const P = pos.array as Float32Array, N = nor.array as Float32Array;
  const mx = (ax + tx) / 2, my = (ay + ty) / 2 - 0.25;
  const { tubular, radial, radius } = rec;
  let k = 0;
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular, u = 1 - t;
    const px = u * u * ax + 2 * u * t * mx + t * t * tx, py = u * u * ay + 2 * u * t * my + t * t * ty;
    let dx = 2 * u * (mx - ax) + 2 * t * (tx - mx), dy = 2 * u * (my - ay) + 2 * t * (ty - my);
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const nx = -dy, ny = dx;
    for (let j = 0; j <= radial; j++) {
      const v = (j / radial) * Math.PI * 2, c = -Math.cos(v), s = Math.sin(v);
      const ox = c * nx, oy = c * ny, oz = s;
      P[k * 3] = px + ox * radius; P[k * 3 + 1] = py + oy * radius; P[k * 3 + 2] = oz * radius;
      N[k * 3] = ox; N[k * 3 + 1] = oy; N[k * 3 + 2] = oz;
      k++;
    }
  }
  pos.needsUpdate = true;
  nor.needsUpdate = true;
}

// ---------------------------------------------------------------- the level
let levelGroup: Group | null = null;
let theme: Theme | null = null;
let cosmetics: Cosmetics = {};
let lastState: State | null = null;
let detailed = false;
let ropes = new Map<string, RopeRec>();
let sliders = new Map<string, Mesh>();
let starMeshes = new Map<string, Mesh>();
let bubbles = new Map<string, { mesh: Mesh; glyph: Sprite }>();
let fans = new Map<string, { group: Group; housing: Mesh; blades: Group; stream: Points; n: number }>();
let treatMesh: Group | null = null;
let contactShadow: Mesh | null = null;
let morsel: Group | null = null;
let eyes: Mesh[] = [];
let marker: Mesh | null = null;
let legalMarkers: Group | null = null;
let particlePoints: Points | null = null;
let particles: { x: number; y: number; z: number; vx: number; vy: number; life: number; t: number; color: Color }[] = [];
let poolN = 32;
let motes: Points | null = null;
let moteSeeds: { x: number; y: number; z: number; p: number; v: number }[] = [];
let moteSpan = { y0: 0, h: 1 };
let wallpaper: Texture | null = null;
let starMat: Lit | null = null;
let trail: { mesh: Mesh; t: number }[] = [];
let trailClock = -1;
let time = 0;
let camNudge = 0;
let shakeT = 0;
let highlighted: { kind: string; id: string; style: string } | null = null;
let lastActions: Action[] = [];
let keyLight: DirectionalLight | null = null;
interface Frame { cx: number; cy: number; w: number; h: number }
let boundsW: Frame | null = null;
let frameW: Frame | null = null;
const pointScale = { field: 1, window: 1 };

const trailGeo = new SphereGeometry(0.16, 8, 6);
const ringGeo = new RingGeometry(0.35, 0.45, 24);

function disposeLevel(): void {
  if (!levelGroup) return;
  levelGroup.traverse((o: Object3D) => {
    const m = o as Mesh;
    if (m.geometry && m.geometry !== trailGeo && m.geometry !== ringGeo) m.geometry.dispose();
    const mat = m.material as Material | Material[] | undefined;
    if (mat) for (const x of Array.isArray(mat) ? mat : [mat]) {
      const map = (x as MeshBasicMaterial).map;
      if (map && map !== dotTexCache) map.dispose();
      x.dispose();
    }
  });
  scene.remove(levelGroup);
  levelGroup = null;
}

function ensureEnvironment(): Texture | null {
  if (envTex) return envTex;
  try {
    const pmrem = new PMREMGenerator(renderer);
    const room = new RoomEnvironment(renderer);
    envTex = pmrem.fromScene(room, 0.04).texture;
    pmrem.dispose();
  } catch (e) { console.warn(`environment: ${String(e)}`); }
  return envTex;
}

/** render.js buildLevel: the whole scene for a rules state + theme. */
export function buildLevel(state: State, th: Theme, cos: Cosmetics = {}): void {
  lastState = state;
  theme = th;
  cosmetics = cos;
  if (!look) return;
  disposeLevel();
  ropes = new Map(); sliders = new Map(); starMeshes = new Map(); bubbles = new Map(); fans = new Map();
  particles = []; trail = []; trailClock = -1; motes = null; wallpaper = null;
  const g = new Group();
  levelGroup = g;
  detailed = look.detailed;
  scene.background = new Color(th.bg0);
  scene.fog = new Fog(th.fog, 30, 90);
  scene.environment = null;

  const B = state.bounds;
  const minX = s2w(B.minX), maxX = s2w(B.maxX), minY = s2w(B.minY), maxY = s2w(B.maxY);
  boundsW = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
  frameW = contentFrame(state, boundsW);
  const F = frameW;

  const hemi = new HemisphereLight(th.key, th.floor, detailed ? 0.4 : 0.9);
  g.add(hemi);
  const key = new DirectionalLight(th.key, detailed ? 1.5 : 1.4);
  if (detailed) key.position.set(F.cx - 7, F.cy + 11, 16);
  else key.position.set(6, 18, 12);
  key.target.position.set(F.cx, F.cy, 0);
  g.add(key, key.target);
  keyLight = key;
  const ext = Math.max(F.w, F.h) / 2 + 3;
  const sc = key.shadow.camera as unknown as { left: number; right: number; top: number; bottom: number; near: number; far: number; updateProjectionMatrix(): void };
  sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 60;
  sc.updateProjectionMatrix();
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  key.shadow.radius = 3;
  applyShadow();
  if (detailed) {
    const rim = new DirectionalLight(mixHex(th.accent2, "#ffffff", 0.5), 0.7);
    rim.position.set(F.cx + 6, F.cy + 4, -10);
    rim.target.position.set(F.cx, F.cy, 0);
    g.add(rim, rim.target);
  }

  // Candy playroom: backdrop, floor, walls.
  if (detailed) {
    wallpaper = wallpaperTexture(th);
    const back = new Mesh(new PlaneGeometry(boundsW.w + 30, boundsW.h + 20), stdMat({ map: wallpaper, roughness: 0.85, metalness: 0, envMapIntensity: 0.35 }));
    back.position.set(boundsW.cx, boundsW.cy, -2.2);
    back.receiveShadow = true;
    g.add(back);
    const skirt = new Mesh(new BoxGeometry(boundsW.w + 30, 0.7, 0.25), physMat({ color: mixHex(th.wall, "#ffffff", 0.15), roughness: 0.4, clearcoat: 0.6 }));
    skirt.position.set(boundsW.cx, minY + 0.75, -2.05);
    skirt.receiveShadow = true;
    g.add(skirt);
  } else {
    const back = new Mesh(new PlaneGeometry(boundsW.w + 30, boundsW.h + 20), new MeshBasicMaterial({ map: gradientTexture(th.bg0, th.bg1) }));
    back.position.set(boundsW.cx, boundsW.cy, -4);
    g.add(back);
  }
  const floorColor = cos.room === "garden" ? "#3c8a5f" : cos.room === "clocktower" ? "#5d4a8a" : th.floor;
  const floorMat = detailed
    ? physMat({ color: "#ffffff", map: floorTexture(floorColor), roughness: 0.55, clearcoat: 0.5, clearcoatRoughness: 0.25, envMapIntensity: 0.3 })
    : stdMat({ color: floorColor, roughness: 0.9 });
  const floor = new Mesh(new BoxGeometry(boundsW.w + 30, 1.6, 10), floorMat);
  floor.position.set(boundsW.cx, minY - 0.4, 1);
  floor.receiveShadow = true;
  g.add(floor);
  let wallMat: Lit;
  if (detailed) { const m = bandTexture(4, "#ffffff", "#d9d9d9"); m.repeat.set(1, 6); wallMat = stdMat({ color: th.wall, map: m, roughness: 0.6 }); }
  else wallMat = stdMat({ color: th.wall, roughness: 0.95 });
  for (const sx of [-1, 1]) {
    const wall = new Mesh(new BoxGeometry(0.8, boundsW.h + 12, 6), wallMat);
    wall.position.set(sx > 0 ? maxX + 0.6 : minX - 0.6, boundsW.cy, 0);
    wall.receiveShadow = true;
    g.add(wall);
  }

  // Treat with its contact-shadow blob.
  treatMesh = buildTreatMesh(th, cos.treat, detailed);
  treatMesh.traverse((o: Object3D) => { o.castShadow = true; });
  g.add(treatMesh);
  contactShadow = new Mesh(new PlaneGeometry(1.6, 1.6), new MeshBasicMaterial({ map: radialTexture(0.4), transparent: true, depthWrite: false }));
  contactShadow.rotation.x = -Math.PI / 2;
  g.add(contactShadow);

  const m = buildMorsel(th, state.recipient.r, detailed);
  morsel = m.group; eyes = m.eyes;
  morsel.position.set(s2w(state.recipient.x), s2w(state.recipient.y) - 0.1, 0);
  morsel.traverse((o: Object3D) => { const me = o as Mesh; if (me.material && !(me.material as Material).transparent) o.castShadow = true; });
  g.add(morsel);

  // Ropes and pegs.
  let ropeMat: Lit;
  if (detailed) { const map = bandTexture(6, "#ffffff", "#b8b0c0"); map.repeat.set(14, 1); ropeMat = stdMat({ color: th.rope, map, roughness: 0.75 }); }
  else ropeMat = stdMat({ color: th.rope, roughness: 0.7 });
  const pegMat = detailed
    ? physMat({ color: th.metal, roughness: 0.28, metalness: 0.65, clearcoat: 0.5 })
    : stdMat({ color: th.metal, roughness: 0.4, metalness: 0.4 });
  for (const r of state.ropes) {
    const peg = new Mesh(new CylinderGeometry(0.16, 0.16, 0.5, seg(detailed ? 20 : 12)), pegMat);
    peg.rotation.x = Math.PI / 2;
    peg.castShadow = true;
    g.add(peg);
    const glyph = makeGlyph("✂", th.accent);
    g.add(glyph);
    const tubular = detailed ? seg(24, 8) : 16, radial = detailed ? seg(8) : 6;
    const mesh = new Mesh(ropeGeometry(tubular, radial), ropeMat);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    g.add(mesh);
    const rec: RopeRec = { rope: r, peg, glyph, mesh, tubular, radial, radius: detailed ? 0.06 : 0.05 };
    ropes.set(r.id, rec);
    syncRope(rec, state, s2w(state.treat.x), s2w(state.treat.y));
  }

  for (const s of state.sliders) {
    const a = new Vector3(s2w(s.x0), s2w(s.y0), 0), b = new Vector3(s2w(s.x1), s2w(s.y1), 0);
    const rail = new Mesh(new BoxGeometry(a.distanceTo(b), 0.14, 0.14), pegMat);
    rail.position.copy(a).lerp(b, 0.5);
    rail.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
    rail.castShadow = true;
    g.add(rail);
    const carriage = new Mesh(new BoxGeometry(0.5, 0.5, 0.5), pegMat);
    carriage.castShadow = true;
    g.add(carriage);
    sliders.set(s.id, carriage);
  }

  const starGeo = new ExtrudeGeometry(starShape(0.55), detailed
    ? { depth: 0.12, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 3 }
    : { depth: 0.15, bevelEnabled: false });
  if (detailed) starGeo.center();
  starMat = detailed
    ? physMat({ color: th.star, emissive: th.star, emissiveIntensity: 0.5, roughness: 0.22, metalness: 0.35, clearcoat: 1 })
    : stdMat({ color: th.star, emissive: th.star, emissiveIntensity: 0.35, roughness: 0.3 });
  for (const s of state.stars) {
    const sm = new Mesh(starGeo, starMat);
    sm.position.set(s2w(s.x), s2w(s.y), 0);
    sm.castShadow = true;
    g.add(sm);
    starMeshes.set(s.id, sm);
  }

  for (const b of state.bubbles) {
    const bm = new Mesh(new SphereGeometry(s2w(b.r), seg(detailed ? 32 : 20), seg(detailed ? 24 : 14)), detailed
      ? physMat({ color: th.accent2, transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0, clearcoat: 1, envMapIntensity: 0.9, depthWrite: false })
      : stdMat({ color: th.accent2, transparent: true, opacity: 0.3, roughness: 0.1, metalness: 0.2 }));
    bm.position.set(s2w(b.x), s2w(b.y), 0);
    g.add(bm);
    const glyph = makeGlyph("◯", th.accent2);
    glyph.position.set(s2w(b.x), s2w(b.y) + s2w(b.r) + 0.5, 0);
    g.add(glyph);
    bubbles.set(b.id, { mesh: bm, glyph });
  }

  for (const f of state.fans) {
    const fg = new Group();
    const housing = new Mesh(new CylinderGeometry(0.85, 0.95, 0.4, seg(detailed ? 36 : 20)), detailed
      ? physMat({ color: th.metal, roughness: 0.3, metalness: 0.5, clearcoat: 0.6 })
      : stdMat({ color: th.metal, roughness: 0.5, metalness: 0.3 }));
    housing.rotation.x = Math.PI / 2;
    housing.castShadow = true;
    fg.add(housing);
    const blades = new Group();
    const bladeMat = detailed ? physMat({ color: th.accent2, roughness: 0.3, clearcoat: 1 }) : stdMat({ color: th.accent2, roughness: 0.4 });
    for (let i = 0; i < 4; i++) {
      const bl = new Mesh(new BoxGeometry(0.7, 0.18, 0.05), bladeMat);
      bl.position.x = 0.4;
      bl.castShadow = true;
      const pivot = new Group();
      pivot.rotation.z = (i / 4) * Math.PI * 2;
      pivot.add(bl);
      blades.add(pivot);
    }
    blades.position.z = 0.25;
    fg.add(blades);
    fg.position.set(s2w(f.cx), s2w(f.cy), 0);
    g.add(fg);
    const glyph = makeGlyph("➤", th.accent2);
    glyph.position.set(s2w(f.cx), s2w(f.cy) + 1.3, 0);
    (glyph.material as SpriteMaterial).rotation = Math.atan2(f.ndy, f.ndx) - Math.PI / 2;
    g.add(glyph);
    const n = look.particles === "high" ? 36 : 20;
    const sg = new BufferGeometry();
    sg.setAttribute("position", new BufferAttribute(new Float32Array(n * 3), 3));
    const stream = new Points(sg, new PointsMaterial({
      color: th.accent2, size: detailed ? 0.2 : 0.12, transparent: true, opacity: 0.5, ...(detailed ? { map: dotTex() } : {}), depthWrite: false,
    }));
    stream.userData.size = detailed ? 0.2 : 0.12;
    stream.visible = false;
    stream.frustumCulled = false;
    g.add(stream);
    fans.set(f.id, { group: fg, housing, blades, stream, n });
  }

  const bumperMat = detailed ? physMat({ color: th.accent, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 }) : stdMat({ color: th.accent, roughness: 0.5 });
  for (const b of state.bumpers) {
    const bm = new Mesh(new CylinderGeometry(s2w(b.r), s2w(b.r), 0.5, seg(detailed ? 40 : 22)), bumperMat);
    bm.rotation.x = Math.PI / 2;
    bm.position.set(s2w(b.x), s2w(b.y), 0);
    bm.castShadow = true;
    g.add(bm);
    const rim = new Mesh(new TorusGeometry(s2w(b.r), 0.07, seg(detailed ? 12 : 8), seg(detailed ? 48 : 24)), detailed
      ? physMat({ color: th.metal, metalness: 0.7, roughness: 0.25, clearcoat: 0.5 })
      : stdMat({ color: th.metal, metalness: 0.5, roughness: 0.4 }));
    rim.position.copy(bm.position);
    rim.castShadow = true;
    g.add(rim);
  }

  const spikeMat = detailed
    ? physMat({ color: th.hazard, roughness: 0.4, metalness: 0.15, clearcoat: 0.5, emissive: th.hazard, emissiveIntensity: 0.05 })
    : stdMat({ color: th.hazard, roughness: 0.5 });
  for (const s of state.spikes) {
    const gear = new Group();
    const core = new Mesh(new CylinderGeometry(s2w(s.r) * 0.7, s2w(s.r) * 0.7, 0.4, 16), spikeMat);
    core.rotation.x = Math.PI / 2;
    core.castShadow = true;
    gear.add(core);
    for (let i = 0; i < 10; i++) {
      const t = new Mesh(new ConeGeometry(0.14, 0.4, 6), spikeMat);
      const a = (i / 10) * Math.PI * 2;
      t.position.set(Math.cos(a) * s2w(s.r) * 0.85, Math.sin(a) * s2w(s.r) * 0.85, 0);
      t.rotation.z = a - Math.PI / 2;
      t.castShadow = true;
      gear.add(t);
    }
    gear.position.set(s2w(s.x), s2w(s.y), 0);
    g.add(gear);
  }

  marker = new Mesh(new RingGeometry(0.6, 0.75, 32), new MeshBasicMaterial({ color: th.accent2, transparent: true, opacity: 0.9, side: DoubleSide }));
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  g.add(marker);
  legalMarkers = new Group();
  g.add(legalMarkers);

  poolN = poolSize(look);
  const pg = new BufferGeometry();
  pg.setAttribute("position", new BufferAttribute(new Float32Array(poolN * 3), 3));
  pg.setAttribute("color", new BufferAttribute(new Float32Array(poolN * 3), 3));
  particlePoints = new Points(pg, new PointsMaterial({
    size: detailed ? 0.26 : 0.18, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, ...(detailed ? { map: dotTex() } : {}),
  }));
  particlePoints.userData.size = detailed ? 0.26 : 0.18;
  particlePoints.frustumCulled = false;
  g.add(particlePoints);

  const nm = moteCount(look);
  if (nm > 0) {
    const pos = new Float32Array(nm * 3);
    const rnd = texRng(nm * 31 + state.stars.length);
    moteSeeds = [];
    for (let i = 0; i < nm; i++) {
      const sd = { x: F.cx + (rnd() - 0.5) * (F.w + 6), y: F.cy + (rnd() - 0.5) * (F.h + 4), z: -1.6 + rnd() * 2.6, p: rnd() * 6.28, v: 0.15 + rnd() * 0.25 };
      moteSeeds.push(sd);
      pos[i * 3] = sd.x; pos[i * 3 + 1] = sd.y; pos[i * 3 + 2] = sd.z;
    }
    const mg = new BufferGeometry();
    mg.setAttribute("position", new BufferAttribute(pos, 3));
    motes = new Points(mg, new PointsMaterial({
      color: mixHex(th.star, "#ffffff", 0.5), size: 0.12, transparent: true, opacity: 0.55, map: dotTex(), depthWrite: false, blending: AdditiveBlending,
    }));
    motes.userData.size = 0.12;
    motes.frustumCulled = false;
    moteSpan = { y0: F.cy - F.h / 2 - 2, h: F.h + 4 };
    g.add(motes);
  }

  // Reflections (Detailed): the room environment at each material's own intensity (r160's envMapIntensity; 1 → 0.4).
  if (detailed) {
    const env = ensureEnvironment();
    if (env) g.traverse((o: Object3D) => {
      const mat = (o as Mesh).material as MeshStandardMaterial | undefined;
      if (!mat || !(mat instanceof MeshStandardMaterial)) return;
      if (mat.envMapIntensity === 1) mat.envMapIntensity = 0.4;
      mat.envMap = env;
    });
  }
  scene.add(g);
  setLegalTargets(lastActions, state);
}

function applyShadow(): void {
  if (!keyLight || !look) return;
  const size = look.shadows;
  keyLight.castShadow = size > 0;
  if (size > 0) keyLight.shadow.mapSize = size;
}

/**
 * render.js contentFrame: the area the round is played in (treat, recipient, anchors, stars, hazards and helpers)
 * plus margin, clamped to the level bounds.
 */
function contentFrame(state: State, bw: Frame): Frame {
  const pts: { x: number; y: number }[] = [
    { x: s2w(state.treat.x), y: s2w(state.treat.y) },
    { x: s2w(state.recipient.x), y: s2w(state.recipient.y) },
  ];
  for (const r of state.ropes) if (r.slider < 0) pts.push({ x: s2w(r.ax), y: s2w(r.ay) });
  for (const s of state.sliders) pts.push({ x: s2w(s.x0), y: s2w(s.y0) }, { x: s2w(s.x1), y: s2w(s.y1) });
  for (const e of [...state.stars, ...state.bubbles, ...state.bumpers, ...state.spikes]) pts.push({ x: s2w(e.x), y: s2w(e.y) });
  for (const f of state.fans) pts.push({ x: s2w(f.x0), y: s2w(f.y0) }, { x: s2w(f.x1), y: s2w(f.y1) });
  const MARGIN = 3, MIN_W = 14, MIN_H = 11;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  if (!Number.isFinite(minX)) return bw;
  return {
    cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
    w: Math.min(bw.w, Math.max(MIN_W, maxX - minX + MARGIN * 2)),
    h: Math.min(bw.h, Math.max(MIN_H, maxY - minY + MARGIN * 2)),
  };
}

function syncRope(rec: RopeRec, state: State, tx: number, ty: number): void {
  const r = rec.rope;
  const ax = s2w(r.wx), ay = s2w(r.wy);
  rec.peg.position.set(ax, ay, 0);
  rec.glyph.position.set(ax, ay + 0.7, 0);
  rec.mesh.visible = rec.glyph.visible = !r.cut;
  if (!r.cut) shapeRope(rec, ax, ay, tx, ty);
  void state;
}

// ---------------------------------------------------------------- the look
export function applyLook(next: Look): void {
  if (look && JSON.stringify(look) === JSON.stringify(next)) return;
  const prev = look;
  look = next;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.shadowMap.enabled = next.shadows > 0;
  applyShadow();
  // High threshold: only glowing stars, the goal and hot highlights bloom.
  // r160 page: UnrealBloomPass 0.45 as bloom.model "r160".
  renderer.bloom = next.bloom ? { model: "r160", strength: 0.45, radius: 0.35, threshold: 0.92, resolution: next.budget.bloomRes } : null;
  renderer.ao = next.ao === "off" ? null : {
    blendIntensity: 0.75, radius: 0.9, distanceExponent: 1.2, thickness: 1.2, scale: 1.0,
    samples: next.ao === "high" ? 16 : 8, resolution: next.budget.aoRes,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: next.ao === "high" ? 6 : 4, rings: 2, samples: next.ao === "high" ? 16 : 8, radiusExponent: 2 },
  };
  // GradeShader after OutputPass (display space): a 0.22 smoothstep S-curve (contrastCurve "s"), saturation 1.12, cool shadows / warm
  // highlights by a smoothstep of luma from 0.25 to 0.85, a 0.28 vignette from 0.38 to 0.9 (x × 1.1).
  renderer.grade = next.grade ? {
    space: "display", contrastCurve: "s", contrast: 0.22, saturation: 1.12, split: [0.25, 0.85], shadows: [0.97, 0.97, 1.04], highlights: [1.04, 1.0, 0.97],
    vignette: { amount: 0.28, inner: 0.38, outer: 0.9, scale: [1.1, 1] },
  } : null;
  renderer.antialias = next.antialias;
  const changed = !prev || prev.detailed !== next.detailed || prev.particles !== next.particles || prev.budget.material !== next.budget.material ||
    prev.budget.segments !== next.budget.segments || prev.budget.texture !== next.budget.texture || prev.budget.pool.high !== next.budget.pool.high ||
    prev.budget.motes !== next.budget.motes;
  if (changed && lastState && theme) {
    if (prev && prev.budget.texture !== next.budget.texture) { dotTexCache?.dispose(); dotTexCache = null; }
    buildLevel(lastState, theme, cosmetics);
  }
}
export function setReducedMotion(v: boolean): void {
  if (reducedMotion === v) return;
  reducedMotion = v;
  if (lastState) setLegalTargets(lastActions, lastState);
}
/** Decorative ambient motion (motes, wallpaper drift, blinks). */
const ambient = (): boolean => !reducedMotion;

// ---------------------------------------------------------------- targets and effects
/** A target: 'rope' | 'bubble' | 'fan' id, style 'focus' | 'hint'. */
export function setHighlight(kind: string | null, id: string | null, style = "focus"): void {
  highlighted = kind && id ? { kind, id, style } : null;
}
export function highlight(): { kind: string; id: string; style: string } | null { return highlighted; }
function targetWorldPos(a: { type: string; id: string }, state: State): { x: number; y: number } | null {
  if (a.type === "cut") { const r = state.ropes.find((x) => x.id === a.id); return r ? { x: s2w(r.wx), y: s2w(r.wy) } : null; }
  if (a.type === "pop") { const b = state.bubbles.find((x) => x.id === a.id); return b ? { x: s2w(b.x), y: s2w(b.y) } : null; }
  const f = state.fans.find((x) => x.id === a.id);
  return f ? { x: s2w(f.cx), y: s2w(f.cy) } : null;
}
/** Soft ring markers under the legal targets (none under reduced motion, as before). */
export function setLegalTargets(actions: Action[], state: State): void {
  lastActions = actions;
  if (!legalMarkers || !theme) return;
  while (legalMarkers.children.length) {
    const c = legalMarkers.children[legalMarkers.children.length - 1]! as Mesh;
    legalMarkers.remove(c);
    (c.material as Material).dispose();
  }
  if (reducedMotion) return;
  for (const a of actions) {
    const p = targetWorldPos(a, state);
    if (!p) continue;
    const mm = new Mesh(ringGeo, new MeshBasicMaterial({ color: theme.accent2, transparent: true, opacity: 0.35, side: DoubleSide }));
    mm.rotation.x = -Math.PI / 2;
    mm.position.set(p.x, p.y - 0.6, 0);
    legalMarkers.add(mm);
  }
}
let fxRand = texRng(4242);
function burst(x: number, y: number, color: string, count = 14): void {
  if (reducedMotion || !look) return;
  const cap = Math.min(count, poolN - particles.length);
  const c = new Color(color);
  for (let i = 0; i < cap; i++) {
    const a = fxRand() * Math.PI * 2, sp = 1.5 + fxRand() * 3;
    particles.push({ x, y, z: 0.3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 1.5, life: 0.6 + fxRand() * 0.4, t: 0, color: c });
  }
}
/** render.js handleEvents: bursts and the delivery nudge. */
export function handleEvents(events: GameEvent[]): void {
  if (!theme) return;
  for (const ev of events) {
    const p = ev.x !== undefined ? { x: s2w(ev.x), y: s2w(ev.y!) } : null;
    switch (ev.type) {
      case "cut": { const rec = ropes.get(ev.id!); if (rec) burst(s2w(rec.rope.wx), s2w(rec.rope.wy) - 0.5, theme.rope, 10); break; }
      case "star": burst(p!.x, p!.y, theme.star, 18); break;
      case "bubble-pop": burst(p!.x, p!.y, theme.accent2, 16); break;
      case "bumper": burst(p!.x, p!.y, theme.accent, 10); break;
      case "delivered":
        burst(p!.x, p!.y, theme.accent2, 30);
        burst(p!.x, p!.y + 0.5, theme.star, 20);
        if (!reducedMotion) camNudge = 0.35;
        break;
      case "hazard": burst(p!.x, p!.y, theme.hazard, 22); break;
    }
  }
}
/** input.js shake: the canvas's 0.3 s ±5 px wobble on an invalid tap. */
export function shake(): void { shakeT = 0.3; }
export function clearFx(): void { particles = []; fxRand = texRng(4242); camNudge = 0; shakeT = 0; highlighted = null; }

// ---------------------------------------------------------------- framing: the old canvas box inside the window
let field: Rect | null = null;
let win = { w: 1, h: 1 };
/** The playfield's window rectangle (physical px), or null to hide the scene. */
export function setField(r: Rect | null, w: number, h: number): void {
  field = r && r.width >= 2 && r.height >= 2 ? r : null;
  win = { w, h };
  renderer.camera = field && levelGroup ? camera : null;
}
/** render.js fitCamera: the content frame fills the view with margin. */
function fitCamera(): void {
  if (!frameW || !field) return;
  const { cx, cy, w, h } = frameW;
  camera.aspect = field.width / field.height;
  const fovV = camera.fov * Math.PI / 180;
  const distH = (h / 2 + 2) / Math.tan(fovV / 2);
  const distW = (w / 2 + 2) / (Math.tan(fovV / 2) * camera.aspect);
  baseCamPos.set(cx, cy, Math.max(distH, distW));
}
export function cameraReset(): void { fitCamera(); }
function placeView(dx: number): void {
  if (!field) return;
  camera.setViewOffset(field.width, field.height, -(field.x + dx), -field.y, win.w, win.h);
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- picking (input.js over render.js's proxies)
const raycaster = new Raycaster();
const ndc = new Vector2();
const plane = new Plane(new Vector3(0, 0, 1), 0);
const hitPoint = new Vector3();
function aim(x: number, y: number): Vector3 | null {
  if (!field) return null;
  camera.position.copy(baseCamPos);
  camera.lookAt(baseCamPos.x, baseCamPos.y, 0);
  camera.updateMatrixWorld();
  placeView(0);
  pointerToNdc(x, y, ndc);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.intersectPlane(plane, hitPoint) ? hitPoint.clone() : null;
}
/** A window point (physical px) on the z = 0 play plane, in world units. */
export function toWorld(x: number, y: number): { x: number; y: number } | null {
  const p = aim(x, y);
  return p ? { x: p.x, y: p.y } : null;
}
/** render.js pick: the nearest interaction proxy under a window point (rope 0.45 corridor, bubble sphere, fan 1.1 disc). */
export function pick(x: number, y: number): { kind: "rope" | "bubble" | "fan"; id: string } | null {
  const st = lastState;
  const p = aim(x, y);
  if (!st || !p) return null;
  let best: { kind: "rope" | "bubble" | "fan"; id: string } | null = null, bestZ = -Infinity;
  const take = (kind: "rope" | "bubble" | "fan", id: string, R: number, d: number, front = R): void => {
    if (d > R) return;
    const z = front === R ? Math.sqrt(R * R - d * d) : front;
    if (z > bestZ) { bestZ = z; best = { kind, id }; }
  };
  const tx = s2w(st.treat.x), ty = s2w(st.treat.y);
  for (const r of st.ropes) {
    if (r.cut) continue;
    const ax = s2w(r.wx), ay = s2w(r.wy);
    const vx = tx - ax, vy = ty - ay, l2 = vx * vx + vy * vy;
    const half = Math.max(0.5, Math.sqrt(l2)) / 2, mx = (ax + tx) / 2, my = (ay + ty) / 2;
    const ux = l2 > 0 ? vx / Math.sqrt(l2) : 0, uy = l2 > 0 ? vy / Math.sqrt(l2) : 1;
    const along = (p.x - mx) * ux + (p.y - my) * uy;
    if (Math.abs(along) > half) continue;
    take("rope", r.id, 0.45, Math.abs((p.x - mx) * -uy + (p.y - my) * ux));
  }
  for (const b of st.bubbles) if (b.state !== 2) take("bubble", b.id, s2w(b.r), Math.hypot(p.x - s2w(b.x), p.y - s2w(b.y)));
  for (const f of st.fans) take("fan", f.id, 1.1, Math.hypot(p.x - s2w(f.cx), p.y - s2w(f.cy)), 0.3);
  return best;
}
function segmentsIntersect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}
/** render.js swipeCutsRope: the first uncut rope a swipe segment (world units) crosses. */
export function swipeCutsRope(state: State, x0: number, y0: number, x1: number, y1: number): string | null {
  for (const r of state.ropes) {
    if (r.cut) continue;
    if (segmentsIntersect(x0, y0, x1, y1, s2w(r.wx), s2w(r.wy), s2w(state.treat.x), s2w(state.treat.y))) return r.id;
  }
  return null;
}
/** A world point's window position (physical px), for the tooltip and the tests. */
export function toScreen(x: number, y: number): { x: number; y: number } | null {
  if (!field) return null;
  const c = new PerspectiveCamera(camera.fov, field.width / field.height, 0.1, 200);
  c.position.copy(baseCamPos);
  c.lookAt(baseCamPos.x, baseCamPos.y, 0);
  c.updateMatrixWorld();
  c.updateProjectionMatrix();
  const v = new Vector3(x, y, 0).project(c);
  return { x: field.x + ((v.x + 1) / 2) * field.width, y: field.y + ((1 - v.y) / 2) * field.height };
}
/** The target an action names, on screen (physical px). */
export function actionScreen(a: { type: string; id: string }): { x: number; y: number } | null {
  if (!lastState) return null;
  if (a.type === "cut") {
    const r = lastState.ropes.find((x) => x.id === a.id);
    if (!r) return null;
    return toScreen((s2w(r.wx) + s2w(lastState.treat.x)) / 2, (s2w(r.wy) + s2w(lastState.treat.y)) / 2);
  }
  const p = targetWorldPos(a, lastState);
  return p ? toScreen(p.x, p.y) : null;
}

// ---------------------------------------------------------------- each frame (render.js update)
/** `alpha` interpolates the treat between the previous and current tick positions. */
export function update(state: State, prev: { x: number; y: number }, alpha: number, dt: number): void {
  if (!levelGroup || !look || !theme) return;
  lastState = state;
  dt = Math.min(0.1, dt);
  time += dt;
  const amb = ambient();
  const th = theme;
  const cx = s2w(prev.x + (state.treat.x - prev.x) * alpha);
  const cy = s2w(prev.y + (state.treat.y - prev.y) * alpha);
  treatMesh!.position.set(cx, cy, 0);
  if (!reducedMotion) treatMesh!.rotation.y += dt * 1.2;
  contactShadow!.position.set(cx, s2w(state.bounds.minY) + 0.42, 0);
  const hgt = Math.max(0, cy - s2w(state.bounds.minY));
  (contactShadow!.material as MeshBasicMaterial).opacity = Math.max(0.08, 0.5 - hgt * 0.04);
  const sc = Math.max(0.5, 1.2 - hgt * 0.05);
  contactShadow!.scale.set(sc, sc, 1);

  // Trail cosmetic ghosts (every 0.08 s, fading over 0.5 s).
  const kind = cosmetics.trail || "none";
  if (kind !== "none" && !reducedMotion && (trailClock < 0 || time - trailClock > 0.08)) {
    trailClock = time;
    const colors: Record<string, string> = { sparkle: th.star, bubbles: th.accent2, rainbow: th.accent };
    const m = trail.length >= 8 ? trail.shift()!.mesh : new Mesh(trailGeo, new MeshBasicMaterial({ color: colors[kind] ?? th.star, transparent: true, opacity: 0.5 }));
    if (!m.parent) levelGroup.add(m);
    m.scale.setScalar(1);
    m.position.set(cx, cy, -0.2);
    trail.push({ mesh: m, t: 0 });
  }
  for (const tr of trail) {
    tr.t += dt;
    (tr.mesh.material as MeshBasicMaterial).opacity = Math.max(0, 0.5 - tr.t);
    tr.mesh.scale.multiplyScalar(0.985);
    tr.mesh.visible = tr.t <= 0.5;
  }

  for (const [id, rec] of ropes) {
    const r = state.ropes.find((x) => x.id === id);
    if (r) rec.rope = r;
    syncRope(rec, state, cx, cy);
  }
  for (const [id, carriage] of sliders) {
    const s = state.sliders.find((x) => x.id === id);
    if (s) carriage.position.set(s2w(s.x), s2w(s.y), 0);
  }
  for (const [id, m] of starMeshes) {
    const s = state.stars.find((x) => x.id === id);
    m.visible = !!s && !s.got;
    if (m.visible && !reducedMotion) m.rotation.y += dt * 2;
  }
  if (starMat && !reducedMotion) starMat.emissiveIntensity = detailed ? 0.55 + 0.25 * Math.sin(time * 4) : 0.3 + 0.15 * Math.sin(time * 4);
  for (const [id, rec] of bubbles) {
    const b = state.bubbles.find((x) => x.id === id);
    const gone = !b || b.state === 2;
    rec.mesh.visible = !gone;
    rec.glyph.visible = !gone && b!.state === 1;
    if (!gone) rec.mesh.position.set(s2w(b!.x), s2w(b!.y), 0);
  }
  for (const [id, rec] of fans) {
    const f = state.fans.find((x) => x.id === id);
    const on = !!f && f.on;
    if (on) rec.blades.rotation.z += dt * (reducedMotion ? 3 : 10);
    rec.stream.visible = on && !reducedMotion;
    if (rec.stream.visible && f) {
      const pa = rec.stream.geometry.getAttribute("position") as BufferAttribute;
      const dx = f.ndx / 1024, dy = f.ndy / 1024;
      for (let i = 0; i < rec.n; i++) {
        const t = ((time * 2 + i / rec.n) % 1);
        pa.setXYZ(i, s2w(f.cx) + dx * t * 4 + Math.sin(i * 7) * 0.3, s2w(f.cy) + dy * t * 4 + Math.cos(i * 5) * 0.3, 0.2);
      }
      pa.needsUpdate = true;
    }
    (rec.housing.material as Lit).color.set(on ? th.accent2 : th.metal);
  }

  if (highlighted && marker) {
    const pos = targetWorldPos({ type: ({ rope: "cut", bubble: "pop" } as Record<string, string>)[highlighted.kind] ?? highlighted.kind, id: highlighted.id }, state);
    marker.visible = !!pos;
    if (pos) {
      marker.position.set(pos.x, pos.y - 0.8, 0);
      const pulse = highlighted.style === "hint" ? 1 + 0.25 * Math.sin(time * 8) : 1;
      marker.scale.set(pulse, pulse, 1);
      (marker.material as MeshBasicMaterial).color.set(highlighted.style === "hint" ? th.star : th.accent2);
    }
  } else if (marker) marker.visible = false;

  if (particlePoints) {
    const pa = particlePoints.geometry.getAttribute("position") as BufferAttribute;
    const ca = particlePoints.geometry.getAttribute("color") as BufferAttribute;
    let pi = 0;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]!;
      p.t += dt;
      if (p.t >= p.life) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 6 * dt;
      pa.setXYZ(pi, p.x, p.y, p.z);
      ca.setXYZ(pi, p.color.r, p.color.g, p.color.b);
      pi++;
    }
    for (let i = pi; i < poolN; i++) pa.setXYZ(i, 0, -999, 0);
    pa.needsUpdate = true;
    ca.needsUpdate = true;
  }

  // Camera: fixed framing + delivery nudge decay; the invalid-tap wobble shifts the view.
  fitCamera();
  camera.position.copy(baseCamPos);
  if (camNudge > 0) {
    camNudge = Math.max(0, camNudge - dt);
    const k = camNudge * 0.4;
    camera.position.set(baseCamPos.x + Math.sin(time * 40) * k, baseCamPos.y + Math.cos(time * 34) * k, baseCamPos.z);
  }
  camera.lookAt(camera.position.x, camera.position.y, 0);
  let dx = 0;
  if (shakeT > 0) {
    // @keyframes tt-shake: 0 → −5 px at 25 % → +5 px at 75 % → 0
    shakeT = Math.max(0, shakeT - dt);
    const ph = 1 - shakeT / 0.3;
    const w = ph < 0.25 ? -ph / 0.25 : ph < 0.75 ? -1 + (ph - 0.25) * 4 : 1 - (ph - 0.75) * 4;
    dx = w * 5 * pxScale;
  }
  placeView(dx);

  if (!reducedMotion && morsel) {
    morsel.position.y = s2w(state.recipient.y) - 0.1 + Math.sin(time * 2) * 0.06;
    morsel.rotation.z = Math.sin(time * 1.4) * 0.05;
  }
  const ph = (time + 0.7) % 3.6;
  const lid = amb && ph < 0.14 ? 0.15 : 1;
  for (const e of eyes) e.scale.y = lid;
  if (wallpaper && look.animated && amb) wallpaper.offset.set(time * 0.012, time * 0.02);
  if (motes) {
    motes.visible = amb;
    if (amb) {
      const pa = motes.geometry.getAttribute("position") as BufferAttribute;
      for (let i = 0; i < moteSeeds.length; i++) {
        const m = moteSeeds[i]!;
        const y = moteSpan.y0 + ((m.y - moteSpan.y0 + time * m.v) % moteSpan.h + moteSpan.h) % moteSpan.h;
        pa.setXYZ(i, m.x + Math.sin(time * 0.6 + m.p) * 0.35, y, m.z);
      }
      pa.needsUpdate = true;
    }
  }
  // Attenuated points: three sized them by the old canvas's height; the engine by the window's.
  const k = field ? field.height / Math.max(1, win.h) : 1;
  pointScale.field = k;
  for (const p of [particlePoints, motes, ...[...fans.values()].map((f) => f.stream)]) {
    if (p) (p.material as PointsMaterial).size = (p.userData.size as number) * k;
  }
}
let pxScale = 1;
/** The UI scale (logical → physical px) for the 5 px wobble. */
export function setPixelScale(s: number): void { pxScale = s; }
export function hasLevel(): boolean { return !!levelGroup; }
export function clearLevel(): void { disposeLevel(); lastState = null; renderer.camera = null; }
