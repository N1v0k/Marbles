// Render part thumbnails (palette, detail panel) from the preview meshes -> src/data/thumbs.json.
// Rendered with three.js in headless Chromium (Playwright), uniformly: isometric view, part in its print colour, light
// background, 180 px WebP. Two sets: thumbs.json (plain, family colours) and thumbs_j.json (Japandi: grooved meshes
// from src/meshes_j, Japandi colours, paper background).
// Usage: node tools/render_thumbs.mjs            (requires: npm i --no-save playwright; Chromium via CHROMIUM=/path)
//        node tools/render_thumbs.mjs --new      render only parts without a thumbnail; existing images stay byte-identical
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const parts = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'parts.json'), 'utf-8')).parts;
const SIZE = 180;

const PAGE = `<!doctype html><html><body style="margin:0;background:#f3f1ec"><canvas id="c" width="${SIZE * 2}" height="${SIZE * 2}"></canvas>
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","fflate":"/node_modules/fflate/esm/browser.js"}}</script>
<script type="module">
import * as THREE from 'three';
import { gunzipSync } from 'fflate';
const r = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true, preserveDrawingBuffer: true });
// KBM3 (src/kbm.ts)
function parse(buf) {
  const dv = new DataView(buf); const nV = dv.getUint32(4, true), nT = dv.getUint32(8, true), s = dv.getFloat32(12, true);
  const b = gunzipSync(new Uint8Array(buf, 16)); const pos = new Float32Array(nV * 3);
  for (let a = 0; a < 3; a++) { let acc = 0; const lo = a * nV, hi = 3 * nV + a * nV;
    for (let i = 0; i < nV; i++) { const d = (((b[hi + i] << 8) | b[lo + i]) << 16) >> 16; acc = ((acc + d) << 16) >> 16; pos[i * 3 + a] = acc * s; } }
  const n = 3 * nT, o = 6 * nV, idx = new Uint32Array(n); let acc = 0;
  for (let i = 0; i < n; i++) { const v = (b[o + i] | (b[o + n + i] << 8) | (b[o + 2 * n + i] << 16) | (b[o + 3 * n + i] << 24)) >>> 0; acc += (v >>> 1) ^ -(v & 1); idx[i] = acc; }
  return { pos, idx };
}
// items: [{ sub, file, z, rot }] - a single part (one entry) or an assembled part (modules stacked and rotated)
window.render = async (items, color, bg, quality) => {
  r.setClearColor(bg, 1);
  const meshes = [];
  for (const it of items) {
    const buf = await (await fetch('/src/' + it.sub + '/' + it.file + '.kbm')).arrayBuffer();
    const m = parse(buf);
    let g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3)); g.setIndex(new THREE.BufferAttribute(m.idx, 1));
    g = g.toNonIndexed(); g.computeVertexNormals(); g.computeBoundingBox();
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color }));
    mesh.position.z = it.z ?? 0; mesh.rotation.z = ((it.rot ?? 0) * Math.PI) / 180;
    meshes.push(mesh);
  }
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8070, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(0.6, 1.0, 0.75); scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.45); fill.position.set(-0.7, 0.4, -0.35); scene.add(fill);
  const root = new THREE.Group(); root.rotation.x = -Math.PI / 2; for (const m of meshes) root.add(m); scene.add(root);
  const bb = new THREE.Box3().setFromObject(root); const c = bb.getCenter(new THREE.Vector3()); const sz = bb.getSize(new THREE.Vector3());
  const rad = sz.length() / 2;
  const cam = new THREE.PerspectiveCamera(30, 1, rad / 50, rad * 50);
  const dir = new THREE.Vector3(0.9, 1.15, 1.0).normalize();
  cam.position.copy(c).addScaledVector(dir, rad / Math.sin((30 * Math.PI) / 360) * 1.02); cam.lookAt(c);
  r.render(scene, cam);
  for (const m of meshes) { m.geometry.dispose(); m.material.dispose(); }
  // downscale to SIZE (supersampling) and encode as WebP
  const out = document.createElement('canvas'); out.width = out.height = ${SIZE};
  const ctx = out.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(r.domElement, 0, 0, ${SIZE}, ${SIZE});
  return out.toDataURL('image/webp', quality ?? 0.82);
};
window.ready = true;
</script></body></html>`;

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.kbm': 'application/octet-stream', '.html': 'text/html' };
// serve on 127.0.0.1 only and only files below ROOT (decoded paths such as '/..%2F' must not escape ROOT)
const server = createServer((req, res) => {
  let p;
  try { p = decodeURIComponent((req.url ?? '/').split('?')[0]); } catch { res.writeHead(400); res.end(); return; }
  if (p === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE); return; }
  const f = resolve(ROOT, '.' + p);
  if ((f !== ROOT && !f.startsWith(ROOT + sep)) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] ?? 'application/octet-stream' }); res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('PAGEERROR', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => window.ready === true);
// colours as in the 3D view (viewer3d.ts: FAMILY_COLORS / JP_FAMILY_COLORS)
const FAM = { start: 0x4caf50, end: 0xe53935, straight: 0xe8e2d4, curve: 0xdcd3bf, longCurve: 0xd2c8b0, spacer: 0xc9c2b2, levelChanger: 0xff9f43, attraction: 0x64b5f6, brake: 0xba68c8, adapter: 0xb9b4aa, pin: 0x7b5ea7, lift: 0x6f7c96, liftPart: 0x6f7c96, flipflopPart: 0x64b5f6 };
const JP = { start: 0xb0703f, end: 0xb0703f, straight: 0xdccfb4, curve: 0xd5c6a8, longCurve: 0xcfbf9f, spacer: 0xc8b999, levelChanger: 0x9a7650, attraction: 0x3d4b63, brake: 0x8c5a36, adapter: 0x56524d, pin: 0xb0703f, lift: 0x7b8596, liftPart: 0x7b8596, flipflopPart: 0x3d4b63 };
const byId = new Map(parts.map((p) => [p.id, p]));
const SETS = [
  { out: 'thumbs.json', bg: 0xf3f1ec, rail: 0x9fb4c7, tunnel: 0xb8d8c8, fam: FAM, jp: false },
  { out: 'thumbs_j.json', bg: 0xeeeae2, rail: 0x8a8279, tunnel: 0xb49c7b, fam: JP, jp: true },
];
// WebP quality per image (default 0.82). Exceptions: images whose base64 happens to contain an unwanted character
// sequence are re-encoded at a different quality. Key: '<output file>:<part id>'.
const QUALITY = { 'thumbs.json:TunnelKurve90_50_Schlitz_16mm': 0.80, 'thumbs.json:AdapterGerade95_16mm': 0.80 };
const ONLY_NEW = process.argv.includes('--new');
for (const set of SETS) {
  const out = {};
  const prev = ONLY_NEW && existsSync(join(ROOT, 'src', 'data', set.out)) ? JSON.parse(readFileSync(join(ROOT, 'src', 'data', set.out), 'utf-8')) : {};
  let fresh = 0;
  let bytes = 0;
  for (const p of parts) {
    if (p.display) continue;   // flip-flop display mesh (mounted rocker): only part of an assembly, no thumbnail of its own
    if (prev[p.id]) { out[p.id] = prev[p.id]; bytes += out[p.id].length; continue; }
    fresh++;
    const color = p.system === 'rail' && p.family !== 'levelChanger' && p.family !== 'brake' ? set.rail : p.system === 'tunnel' ? set.tunnel : set.fam[p.family] ?? 0xcccccc;
    const sub = (q) => (set.jp && q.jp ? 'meshes_j' : 'meshes');
    // lift, flip-flop: assembled from the modules (as in the 3D view)
    const asm = p.lift?.asm ?? p.asm;
    const items = asm ? asm.map((a) => { const m = byId.get(a.id); return { sub: sub(m), file: m.file, z: a.z, rot: a.rot }; })
                         : [{ sub: sub(p), file: p.file, z: 0, rot: 0 }];
    out[p.id] = await page.evaluate(([it, c, bg, q]) => window.render(it, c, bg, q), [items, color, set.bg, QUALITY[set.out + ':' + p.id] ?? null]);
    bytes += out[p.id].length;
  }
  writeFileSync(join(ROOT, 'src', 'data', set.out), JSON.stringify(out));
  console.log(set.out, Object.keys(out).length, 'thumbnails,', Math.round(bytes / 1024), 'KB' + (ONLY_NEW ? `, newly rendered: ${fresh}` : ''));
}
await browser.close(); server.close();
