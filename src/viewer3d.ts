// three.js 3D preview: parts as real meshes (KBM, generated from the CAD exports), adapter towers, ball path.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Layout } from './chain';
import { ballZ, isJapandi, grooved, catalog, asmOf, type Part } from './catalog';
import { parseKbm, type RawMesh } from './kbm';
import { filamentColor } from './colors';
import type { SpeedStep } from './physics';

const meshUrls = import.meta.glob('./meshes/*.kbm', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const meshUrlsJ = import.meta.glob('./meshes_j/*.kbm', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** Decodes a data: URL (single-file build) manually - fetch(data:) is blocked under strict CSPs. */
export function decodeDataUrl(url: string): ArrayBuffer {
  const b64 = url.slice(url.indexOf(',') + 1); const bin = atob(b64);
  const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
}
/** Preview meshes: KBM3 or KBM1 - see kbm.ts. */
export const parseKbm1 = parseKbm;

const rawCache = new Map<string, Promise<RawMesh>>();
/** Raw preview mesh data (quantized, indexed); also the fallback for 3MF export.
 *  jp: grooved Japandi version (meshes_j/), falls back to the plain mesh. */
export function loadWebGeometry(file: string, jp = false): Promise<RawMesh> {
  const key = (jp ? 'j:' : '') + file;
  let g = rawCache.get(key);
  if (!g) {
    g = (async () => {
      const url = (jp ? meshUrlsJ['./meshes_j/' + file + '.kbm'] : undefined) ?? meshUrls['./meshes/' + file + '.kbm'];
      if (!url) throw new Error('Mesh missing: ' + file);
      const buf = url.startsWith('data:') ? decodeDataUrl(url) : await (await fetch(url)).arrayBuffer();
      return parseKbm(buf);
    })();
    rawCache.set(key, g);
    g.catch(() => rawCache.delete(key)); // don't cache failures (a later attempt may succeed)
  }
  return g;
}

const geomCache = new Map<string, Promise<THREE.BufferGeometry>>();
async function loadGeometry(file: string, jp = false): Promise<THREE.BufferGeometry> {
  const key = (jp ? 'j:' : '') + file;
  let g = geomCache.get(key);
  if (!g) {
    g = (async () => {
      const raw = await loadWebGeometry(file, jp);
      let geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(raw.pos, 3));
      geo.setIndex(new THREE.BufferAttribute(raw.idx, 1));
      // face normals via non-indexed geometry (avoids flatShading, which needs shader derivatives
      // that some embedded WebGL contexts lack)
      geo = geo.toNonIndexed();
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      return geo;
    })();
    geomCache.set(key, g);
    g.catch(() => geomCache.delete(key));
  }
  return g;
}

export const FAMILY_COLORS: Record<string, number> = {
  start: 0x4caf50, end: 0xe53935, straight: 0xe8e2d4, curve: 0xdcd3bf, longCurve: 0xd2c8b0, spacer: 0xc9c2b2,
  levelChanger: 0xff9f43, attraction: 0x64b5f6, brake: 0xba68c8, adapter: 0xb9b4aa, lift: 0x6f7c96, liftPart: 0x6f7c96, flipflopPart: 0x64b5f6,
};
const SYSTEM_TINT: Record<string, number> = { rail: 0x9fb4c7, tunnel: 0xb8d8c8 };
export const STATUS_COLORS: Record<string, number> = { ok: 0x43a047, warn: 0xffb300, error: 0xe53935, stop: 0x6d4c41 };

/** Japandi: sand, oak, charcoal, copper, indigo - the filament colors of the Japandi edition. */
export const JP_FAMILY_COLORS: Record<string, number> = {
  start: 0xb0703f, end: 0xb0703f, straight: 0xdccfb4, curve: 0xd5c6a8, longCurve: 0xcfbf9f, spacer: 0xc8b999,
  levelChanger: 0x9a7650, attraction: 0x3d4b63, brake: 0x8c5a36, adapter: 0x56524d, lift: 0x7b8596, liftPart: 0x7b8596, flipflopPart: 0x3d4b63,
};
const JP_SYSTEM_TINT: Record<string, number> = { rail: 0x8a8279, tunnel: 0xb49c7b };
export const JP_STATUS_COLORS: Record<string, number> = { ok: 0x6f7d57, warn: 0xb8893a, error: 0x9e3b2e, stop: 0x6b5646 };

const THEME = {
  plain: { bg: 0xf3f1ec, grid1: 0xb0aaa0, grid2: 0xd8d3ca, sel: 0x1e88e5, selAd: 0x90caf9, emis: 0x0d47a1, path: 0x333333,
           ghost: 0x26a69a, ghostBad: 0xe53935, marker: 0xff9f43, markerLane: 0x8d8a80 },
  japandi: { bg: 0xeeeae2, grid1: 0xc9bfad, grid2: 0xe0d9cc, sel: 0x34415a, selAd: 0x7d8aa3, emis: 0x1c2436, path: 0x2a2826,
             ghost: 0x5f8a5a, ghostBad: 0x9e3b2e, marker: 0xb0703f, markerLane: 0x8a8279 },
};
function theme() { return isJapandi() ? THEME.japandi : THEME.plain; }
export function statusColor(st: string): number { return (isJapandi() ? JP_STATUS_COLORS : STATUS_COLORS)[st] ?? 0x888888; }

export function colorFor(p: Part): number {
  const fil = filamentColor(p); if (fil != null) return fil;
  const jp = isJapandi();
  const tint = jp ? JP_SYSTEM_TINT : SYSTEM_TINT, fam = jp ? JP_FAMILY_COLORS : FAMILY_COLORS;
  if (p.system === 'rail' && p.family !== 'levelChanger' && p.family !== 'brake') return tint.rail;
  if (p.system === 'tunnel') return tint.tunnel;
  return fam[p.family] ?? 0xcccccc;
}

export interface ViewerOptions { onSelect?: (idx: number | null) => void }
/** Ghost preview for choosing a direction (curve left/right, lift head, flip-flop exit): translucent part meshes
 *  and/or an arrow at the exit. ok = this direction has room (otherwise red). */
export interface GhostItem { mesh: Part; t: [number, number]; z: number; rot: number }
export interface Ghost { key: string; ok: boolean; items: GhostItem[]; arrow?: { p: [number, number, number]; n: [number, number]; scale?: number } }
/** Marker at a free socket: 'branch' = a branch can start here (clickable), 'lane' = entry of a free lane,
 *  'target' = lane of a possible cross tunnel, drawn as a flat strip on the floor (len along n, width across). */
export interface Marker { key: string; kind: 'branch' | 'lane' | 'open' | 'target'; p: [number, number, number]; n: [number, number]; len?: number; width?: number }

export class Viewer {
  renderer: THREE.WebGLRenderer; scene = new THREE.Scene(); camera: THREE.PerspectiveCamera; controls: OrbitControls;
  root = new THREE.Group(); partsGroup = new THREE.Group(); adaptersGroup = new THREE.Group(); pathGroup = new THREE.Group();
  ghostGroup = new THREE.Group(); markerGroup = new THREE.Group(); plateGroup = new THREE.Group();
  onGhost?: (key: string) => void; onMarker?: (key: string) => void;
  private ghostGen = 0; private hoverKey: string | null = null;
  meshes: THREE.Mesh[] = []; selected: number | null = null; showAdapters = true; showPath = true; colorMode: 'family' | 'speed' = 'family';
  private raycaster = new THREE.Raycaster(); private pointer = new THREE.Vector2(); private downPos: [number, number] | null = null;
  private layout: Layout | null = null; private steps: SpeedStep[] = []; private gen = 0;
  private grid: THREE.GridHelper;
  private styleKey = '';

  constructor(public canvas: HTMLCanvasElement, private opts: ViewerOptions = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    let software = false;
    try {
      const gl = this.renderer.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      software = /swiftshader|llvmpipe|software/i.test(name);
      this.glInfo = `${this.renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1'} · ${name}`;
    } catch { this.glInfo = 'WebGL?'; }
    // software rendering (e.g. embedded viewers without a GPU): low resolution keeps the page responsive
    this.renderer.setPixelRatio(software ? 0.75 : Math.min(window.devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0xf3f1ec);
    this.camera = new THREE.PerspectiveCamera(40, 1, 2, 10000);
    this.camera.position.set(380, 320, 480);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.12; this.controls.maxPolarAngle = Math.PI * 0.49;
    this.root.rotation.x = -Math.PI / 2; // z up
    this.root.add(this.partsGroup, this.adaptersGroup, this.pathGroup, this.ghostGroup, this.markerGroup, this.plateGroup);
    this.scene.add(this.root);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8070, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(270, 480, 370); this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-320, 210, -160); this.scene.add(fill);
    // grid cell 64 mm = one straight
    this.grid = new THREE.GridHelper(1280, 20, 0xb0aaa0, 0xd8d3ca); this.grid.position.y = -0.3; this.scene.add(this.grid);
    this.applyTheme();
    canvas.addEventListener('pointerdown', (e) => { this.downPos = e.button === 0 ? [e.clientX, e.clientY] : null; });
    canvas.addEventListener('pointerup', (e) => {
      // left button / touch only, and only if not dragged (orbit)
      if (e.button !== 0 || !this.downPos || Math.hypot(e.clientX - this.downPos[0], e.clientY - this.downPos[1]) > 6) return;
      this.pick(e.clientX, e.clientY);
    });
    // highlight the ghost under the pointer (only while ghosts are shown)
    canvas.addEventListener('pointermove', (e) => {
      if (!this.ghostGroup.children.length || e.buttons) return;
      const hit = this.rayHit(e.clientX, e.clientY, this.ghostGroup.children);
      const k = hit ? (hit.object.userData.ghost as string) : null;
      if (k !== this.hoverKey) { this.hoverKey = k; this.styleGhosts(); canvas.style.cursor = k ? 'pointer' : ''; }
    });
    const ro = new ResizeObserver(() => this.resize()); ro.observe(canvas.parentElement ?? canvas);
    this.resize();
    // render on demand only (camera or scene changes) - saves battery and helps slow environments
    this.controls.addEventListener('change', () => this.invalidate());
    this.controls.addEventListener('start', () => this.invalidate(60));
    this.controls.addEventListener('end', () => this.invalidate(45));
    this.invalidate();
  }

  /** Background and grid for the current edition (plain / Japandi); meshes switch on the next setLayout. */
  applyTheme() {
    const th = theme(); const key = isJapandi() ? 'j' : 'g';
    if (key === this.styleKey) return;
    this.styleKey = key;
    this.scene.background = new THREE.Color(th.bg);
    const mats = (Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material]) as THREE.LineBasicMaterial[];
    this.scene.remove(this.grid); this.grid.geometry.dispose(); mats.forEach((m) => m.dispose());
    this.grid = new THREE.GridHelper(1280, 20, th.grid1, th.grid2); this.grid.position.y = -0.3; this.scene.add(this.grid);
    this.invalidate();
  }

  private pendingFrames = 0; private rafId = 0;
  /** Requests n more frames (damping keeps moving for a few frames). */
  invalidate(frames = 2) {
    this.pendingFrames = Math.max(this.pendingFrames, frames);
    if (!this.rafId) this.rafId = requestAnimationFrame(() => this.frame());
  }
  private frame() {
    this.rafId = 0;
    this.controls.update();   // fires 'change' while damping -> invalidate() already schedules the next frame
    this.renderer.render(this.scene, this.camera);
    // schedule at most one follow-up frame (otherwise callbacks multiply while damping)
    if (--this.pendingFrames > 0 && !this.rafId) this.rafId = requestAnimationFrame(() => this.frame());
  }

  resize() {
    const el = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(50, el.clientWidth), h = Math.max(50, el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  private rayHit(cx: number, cy: number, objs: THREE.Object3D[]): THREE.Intersection | null {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(objs, true).find((h) => h.object.visible) ?? null;
  }
  private pick(cx: number, cy: number) {
    // ghosts (direction choice) and markers (free exits) take precedence
    if (this.ghostGroup.children.length) {
      const g = this.rayHit(cx, cy, this.ghostGroup.children);
      if (g) { this.onGhost?.(g.object.userData.ghost as string); return; }
    }
    if (this.markerGroup.children.length) {
      const m = this.rayHit(cx, cy, this.markerGroup.children);
      if (m && m.object.userData.marker) { this.onMarker?.(m.object.userData.marker as string); return; }
    }
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    // hidden adapters (group invisible) must not be hit
    const targets = [...this.partsGroup.children, ...(this.adaptersGroup.visible ? this.adaptersGroup.children : [])];
    const hits = this.raycaster.intersectObjects(targets, false);
    const hit = hits.find((h) => h.object.visible);
    const idx = hit ? (hit.object.userData.idx as number) : null;
    this.opts.onSelect?.(idx);
  }

  /** Only the speed values changed (slider): recolor the ball path and speed colors, keep the meshes. */
  setSteps(steps: SpeedStep[]) {
    this.steps = steps;
    this.buildPath();
    this.applyColors();
  }

  setSelected(idx: number | null) {
    this.selected = idx;
    this.applyColors();
  }

  async setLayout(layout: Layout, steps: SpeedStep[]) {
    this.layout = layout; this.steps = steps;
    const gen = ++this.gen;
    // mesh: part whose mesh is loaded (lift: one per module); part: chain part (color, selection)
    const items: { part: Part; mesh: Part; R: number[]; t: [number, number]; z: number; idx: number; isAdapter: boolean; rot: number }[] = [];
    for (const q of layout.placed) {
      const asm = asmOf(q.part);
      if (asm) {
        // lift: modules stacked and rotated about the lift axis (part origin); flip-flop: body + built-in rocker
        for (const a of asm) {
          const m = catalog.byId.get(a.id); if (!m) continue;
          items.push({ part: q.part, mesh: m, R: q.R, t: q.t, z: q.S + a.z, idx: q.idx, isAdapter: false, rot: (q.rot + a.rot) % 360 });
        }
        continue;
      }
      items.push({ part: q.part, mesh: q.part, R: q.R, t: q.t, z: q.S, idx: q.idx, isAdapter: false, rot: q.rot });
    }
    for (const a of layout.adapters) items.push({ part: a.part, mesh: a.part, R: a.R, t: a.t, z: a.z, idx: a.owner, isAdapter: true, rot: a.rot });
    const jp = isJapandi();
    const geos = await Promise.all(items.map((it) => loadGeometry(it.mesh.file, jp && grooved(it.mesh)).catch((err) => { this.reportMeshError(it.mesh.file, err); return null; })));
    if (gen !== this.gen) return;
    this.applyTheme();
    for (const g of [this.partsGroup, this.adaptersGroup]) { for (const m of g.children as THREE.Mesh[]) (m.material as THREE.Material).dispose(); g.clear(); }
    this.meshes = [];
    items.forEach((it, i) => {
      const geo = geos[i]; if (!geo) return;
      const mat = new THREE.MeshLambertMaterial({ color: colorFor(it.part) });
      if (it.part.system === 'tunnel') { mat.transparent = true; mat.opacity = 0.75; }
      const m = new THREE.Mesh(geo, mat);
      m.position.set(it.t[0], it.t[1], it.z); m.rotation.z = (it.rot * Math.PI) / 180;
      m.userData = { idx: it.idx, isAdapter: it.isAdapter, part: it.part.id, partObj: it.part, base: colorFor(it.part) };
      (it.isAdapter ? this.adaptersGroup : this.partsGroup).add(m);
      this.meshes.push(m);
    });
    this.adaptersGroup.visible = this.showAdapters;
    this.buildPath();
    this.applyColors();
    this.invalidate();
  }

  private buildPath() {
    // dispose old lines (geometry and material are not shared here)
    for (const l of this.pathGroup.children as THREE.Line[]) { l.geometry.dispose(); (l.material as THREE.Material).dispose(); }
    this.pathGroup.clear();
    if (!this.layout) return;
    for (const q of this.layout.placed) {
      if (!q.connected || !q.entry || !q.exit) continue;
      const p = q.part; const rimIn = p.rimIn ?? p.rimOut ?? 0, rimOut = p.rimOut ?? rimIn;
      // ball centre: rim - groove depth 8.75 + ball radius 8 (rim code x 8/15 = rim height in mm)
      const z0 = q.S + ballZ(q.reversed ? rimOut : rimIn), z1 = q.S + ballZ(q.reversed ? rimIn : rimOut);
      const pts: THREE.Vector3[] = [];
      if ((p.turn === 90 || p.turn === -90) && p.center && p.radius) {
        const c = [q.R[0] * p.center[0] + q.R[1] * p.center[1] + q.t[0], q.R[2] * p.center[0] + q.R[3] * p.center[1] + q.t[1]];
        const a0 = Math.atan2(q.entry.p[1] - c[1], q.entry.p[0] - c[0]);
        let a1 = Math.atan2(q.exit.p[1] - c[1], q.exit.p[0] - c[0]);
        while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI; while (a1 - a0 < -Math.PI) a1 += 2 * Math.PI;
        const n = 12;
        for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push(new THREE.Vector3(c[0] + p.radius * Math.cos(a), c[1] + p.radius * Math.sin(a), z0 + ((z1 - z0) * i) / n)); }
      } else {
        pts.push(new THREE.Vector3(q.entry.p[0], q.entry.p[1], z0), new THREE.Vector3(q.exit.p[0], q.exit.p[1], z1));
      }
      const st = this.steps[q.idx];
      const color = st ? statusColor(st.status) : theme().path;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color }));
      line.userData = { idx: q.idx };
      this.pathGroup.add(line);
    }
    this.pathGroup.visible = this.showPath;
  }

  /** Re-applies colors (family/filament colors changed) without reloading meshes. */
  recolor() {
    for (const m of this.meshes) m.userData.base = colorFor(m.userData.partObj as Part);
    this.applyColors();
  }

  applyColors() {
    for (const m of this.meshes) {
      const mat = m.material as THREE.MeshLambertMaterial;
      const part = (this.layout?.placed[m.userData.idx]?.part) as Part | undefined;
      const isAd = m.userData.isAdapter as boolean;
      let base = m.userData.base as number;
      if (!isAd && this.colorMode === 'speed') {
        const st = this.steps[m.userData.idx];
        if (st && part && part.family !== 'start' && part.family !== 'adapter') base = statusColor(st.status);
      }
      const sel = this.selected != null && m.userData.idx === this.selected;
      const th = theme();
      mat.color.setHex(sel ? (isAd ? th.selAd : th.sel) : base);
      mat.emissive.setHex(sel ? th.emis : 0x000000);
      mat.emissiveIntensity = sel ? 0.35 : 0;
    }
    this.invalidate();
  }

  meshErrors: string[] = []; onMeshError?: (msg: string) => void; glInfo = '';
  private reportMeshError(file: string, err: unknown) {
    const msg = `${file}: ${err instanceof Error ? err.message : String(err)}`;
    console.error('Failed to load mesh', msg);
    if (this.meshErrors.length < 5) { this.meshErrors.push(msg); this.onMeshError?.(msg); }
  }

  setShowAdapters(v: boolean) { this.showAdapters = v; this.adaptersGroup.visible = v; this.invalidate(); }
  setShowPath(v: boolean) { this.showPath = v; this.pathGroup.visible = v; this.invalidate(); }
  setColorMode(m: 'family' | 'speed') { this.colorMode = m; this.applyColors(); }

  fit(view: 'iso' | 'top' | 'front' = 'iso') {
    const b = this.layout?.bounds;
    const min = b ? b.min : [-110, -110, 0], max = b ? b.max : [110, 110, 55];
    const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = (min[2] + max[2]) / 2;
    const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 110);
    const dist = size / (2 * Math.tan((this.camera.fov * Math.PI) / 360)) * 1.25;
    // world coordinates (x, y, z) -> three.js (x, z, -y)
    const target = new THREE.Vector3(cx, cz, -cy);
    this.controls.target.copy(target);
    if (view === 'top') this.camera.position.set(cx, cz + dist, -cy + 0.001);
    else if (view === 'front') this.camera.position.set(cx, cz + dist * 0.25, -cy + dist);
    else this.camera.position.set(cx + dist * 0.7, cz + dist * 0.6, -cy + dist * 0.7);
    this.controls.update();
    this.invalidate(30);
  }

  // ---------------------------------------------------------------- Print plate (print in one piece)
  /** Shows the print plate footprint (centre cx/cy, size w x d, build height h); ok: the track fits (otherwise red). null: hide. */
  setPlate(p: { cx: number; cy: number; w: number; d: number; h: number; ok: boolean } | null) {
    for (const o of this.plateGroup.children as (THREE.Mesh | THREE.LineSegments)[]) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    this.plateGroup.clear();
    if (p) {
      const th = theme(); const col = p.ok ? th.ghost : th.ghostBad;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.d), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide }));
      plane.position.set(p.cx, p.cy, -0.15);
      const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(p.w, p.d, p.h)), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: p.ok ? 0.35 : 0.7 }));
      box.position.set(p.cx, p.cy, p.h / 2);
      const rim = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(p.w, p.d)), new THREE.LineBasicMaterial({ color: col }));
      rim.position.set(p.cx, p.cy, 0.05);
      plane.raycast = () => {}; box.raycast = () => {}; rim.raycast = () => {};
      this.plateGroup.add(plane, box, rim);
    }
    this.invalidate();
  }

  // ---------------------------------------------------------------- Ghosts and markers
  /** Shows ghosts (null: remove). Meshes load asynchronously; the latest call wins. */
  async setGhosts(ghosts: Ghost[] | null) {
    const gen = ++this.ghostGen;
    this.hoverKey = null; this.canvas.style.cursor = '';
    const list = ghosts ?? [];
    const jp = isJapandi();
    const geos = await Promise.all(list.map((g) => Promise.all(g.items.map((it) => loadGeometry(it.mesh.file, jp && grooved(it.mesh)).catch(() => null)))));
    if (gen !== this.ghostGen) return;
    this.clearGroup(this.ghostGroup);
    list.forEach((g, gi) => {
      g.items.forEach((it, k) => {
        const geo = geos[gi][k]; if (!geo) return;
        const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ transparent: true, depthWrite: false }));
        m.position.set(it.t[0], it.t[1], it.z); m.rotation.z = (it.rot * Math.PI) / 180;
        m.userData = { ghost: g.key, ok: g.ok, own: false };
        this.ghostGroup.add(m);
      });
      if (g.arrow) {
        const a = this.arrowMesh(g.arrow.p, g.arrow.n, g.arrow.scale ?? 0.8);
        a.traverse((o) => { o.userData = { ghost: g.key, ok: g.ok, own: true }; });
        this.ghostGroup.add(a);
      }
    });
    this.styleGhosts();
    if (list.length) this.ensureVisible(this.ghostGroup);
  }
  /** If obj is (partly) off screen, moves the camera so the track and obj fit (view direction is kept). */
  private ensureVisible(obj: THREE.Object3D) {
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;
    const corners: THREE.Vector3[] = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    this.camera.updateMatrixWorld(); this.camera.updateProjectionMatrix();
    const inside = corners.every((c) => { const v = c.clone().project(this.camera); return Math.abs(v.x) <= 0.92 && Math.abs(v.y) <= 0.88 && v.z < 1; });
    if (inside) return;
    for (const g of [this.partsGroup, this.adaptersGroup]) if (g.children.length) box.union(new THREE.Box3().setFromObject(g));
    const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const dist = Math.max(size.x, size.y, size.z, 110) / (2 * Math.tan((this.camera.fov * Math.PI) / 360)) * 1.35;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.controls.update();
    this.invalidate(30);
  }
  private styleGhosts() {
    const th = theme();
    this.ghostGroup.traverse((o) => {
      const m = o as THREE.Mesh; if (!m.isMesh) return;
      const mat = m.material as THREE.MeshLambertMaterial;
      const hot = m.userData.ghost === this.hoverKey;
      mat.color.setHex(m.userData.ok ? th.ghost : th.ghostBad);
      mat.emissive.setHex(m.userData.ok ? th.ghost : th.ghostBad);
      mat.emissiveIntensity = hot ? 0.55 : 0.25;
      mat.opacity = m.userData.own ? (hot ? 1 : 0.85) : (hot ? 0.72 : 0.42);
    });
    this.invalidate();
  }
  /** Arrow: shaft + tip pointing along n (world xy), base at p. */
  private arrowMesh(p: [number, number, number], n: [number, number], scale: number): THREE.Group {
    const g = new THREE.Group();
    const mat = () => new THREE.MeshLambertMaterial({ transparent: true, depthWrite: false });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.6 * scale, 2.6 * scale, 14 * scale, 12), mat()); shaft.position.y = 7 * scale;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(6.5 * scale, 13 * scale, 16), mat()); tip.position.y = 20 * scale;
    g.add(shaft, tip);
    g.position.set(p[0] + n[0] * 3, p[1] + n[1] * 3, p[2] + 4);
    g.rotation.z = Math.atan2(n[1], n[0]) - Math.PI / 2;
    return g;
  }
  /** Markers at free sockets (branch possible / free lane). */
  setMarkers(markers: Marker[]) {
    this.clearGroup(this.markerGroup);
    const th = theme();
    for (const mk of markers) {
      if (mk.kind === 'target') {
        // flat strip on the floor along n; not clickable
        const len = mk.len ?? 80, wid = mk.width ?? 16;
        const strip = new THREE.Mesh(new THREE.BoxGeometry(len, wid, 0.6), new THREE.MeshLambertMaterial({ transparent: true, depthWrite: false, opacity: 0.6 }));
        const mat = strip.material as THREE.MeshLambertMaterial; mat.color.setHex(th.marker); mat.emissive.setHex(th.marker); mat.emissiveIntensity = 0.25;
        strip.position.set(mk.p[0], mk.p[1], mk.p[2]);
        strip.rotation.z = Math.atan2(mk.n[1], mk.n[0]);
        strip.userData = { marker: null };
        this.markerGroup.add(strip);
        continue;
      }
      const a = this.arrowMesh(mk.p, mk.n, mk.kind === 'lane' ? 0.7 : 0.85);
      a.traverse((o) => {
        const m = o as THREE.Mesh; if (!m.isMesh) return;
        const mat = m.material as THREE.MeshLambertMaterial;
        const c = mk.kind === 'branch' ? th.marker : mk.kind === 'open' ? th.sel : th.markerLane;
        mat.color.setHex(c); mat.emissive.setHex(c); mat.emissiveIntensity = 0.3; mat.opacity = mk.kind === 'lane' ? 0.55 : 0.9;
        m.userData = { marker: mk.kind === 'lane' ? null : mk.key };
      });
      if (mk.kind === 'lane') a.rotation.z += Math.PI;   // free lane: arrow points inwards
      this.markerGroup.add(a);
    }
    this.invalidate();
  }
  /** Clears a group: disposes materials and own arrow/strip geometries (part geometries stay cached). */
  private clearGroup(g: THREE.Group) {
    g.traverse((o) => {
      const m = o as THREE.Mesh; if (!m.isMesh) return;
      (m.material as THREE.Material).dispose();
      if (m.geometry.type === 'CylinderGeometry' || m.geometry.type === 'ConeGeometry' || m.geometry.type === 'BoxGeometry') m.geometry.dispose();
    });
    g.clear();
    this.invalidate();
  }

  /** Screen position (px) of a world point (for overlays). */
  project(x: number, y: number, z: number): [number, number] {
    const v = new THREE.Vector3(x, z, -y).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return [((v.x + 1) / 2) * r.width, ((1 - v.y) / 2) * r.height];
  }
}
