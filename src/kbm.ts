// Mesh formats (written by tools/convert_meshes.py, tools/convert_print_meshes.py):
//   KBM1  int16-quantised positions, indices uint16/uint32
//   KBM2  float32 positions (full resolution, gzip file .kbm.gz)
//   KBM3  like KBM1, but vertices in order of first use, delta-coded, split into byte planes, gzip (preview meshes)
import { gunzipSync } from 'fflate';

export interface RawMesh { pos: Float32Array; idx: Uint32Array }

function magicOf(buf: ArrayBuffer): string {
  if (buf.byteLength < 16) throw new Error('Unknown mesh format');
  const u8 = new Uint8Array(buf, 0, 4);
  return String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
}

export function parseKbm(buf: ArrayBuffer): RawMesh {
  const magic = magicOf(buf);
  if (magic === 'KBM3') return parseKbm3(buf);
  if (magic !== 'KBM1' && magic !== 'KBM2') throw new Error('Unknown mesh format ' + magic);
  const dv = new DataView(buf);
  const nV = dv.getUint32(4, true), nT = dv.getUint32(8, true), scale = dv.getFloat32(12, true), use16 = dv.getUint8(16) === 1;
  let off = 17;
  if (buf.byteLength < off + nV * (magic === 'KBM2' ? 12 : 6) + nT * (use16 ? 6 : 12)) throw new Error('Mesh truncated');
  let pos: Float32Array;
  if (magic === 'KBM2') { pos = new Float32Array(buf.slice(off, off + nV * 12)); off += nV * 12; }
  else { const q = new Int16Array(buf.slice(off, off + nV * 6)); off += nV * 6; pos = new Float32Array(nV * 3); for (let i = 0; i < nV * 3; i++) pos[i] = q[i] * scale; }
  const idx = use16 ? Uint32Array.from(new Uint16Array(buf.slice(off, off + nT * 6))) : new Uint32Array(buf.slice(off, off + nT * 12));
  return { pos, idx };
}

/** KBM3: 'KBM3' | nV | nT | scale | gzip( x/y/z deltas: low bytes, then high bytes | index deltas zigzag-encoded,
 *  uint32 in 4 byte planes ). */
export function parseKbm3(buf: ArrayBuffer): RawMesh {
  const dv = new DataView(buf);
  const nV = dv.getUint32(4, true), nT = dv.getUint32(8, true), scale = dv.getFloat32(12, true);
  const b = gunzipSync(new Uint8Array(buf, 16));
  if (b.length !== 6 * nV + 12 * nT) throw new Error('Mesh truncated');
  const pos = new Float32Array(nV * 3);
  for (let a = 0; a < 3; a++) {
    let acc = 0; const lo = a * nV, hi = 3 * nV + a * nV;
    for (let i = 0; i < nV; i++) {
      const d = (((b[hi + i] << 8) | b[lo + i]) << 16) >> 16;
      acc = ((acc + d) << 16) >> 16;
      pos[i * 3 + a] = acc * scale;
    }
  }
  const n = 3 * nT, o = 6 * nV; const idx = new Uint32Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const v = (b[o + i] | (b[o + n + i] << 8) | (b[o + 2 * n + i] << 16) | (b[o + 3 * n + i] << 24)) >>> 0;
    acc += (v >>> 1) ^ -(v & 1);
    idx[i] = acc;
  }
  for (let i = 0; i < n; i++) if (idx[i] >= nV) throw new Error('Mesh index out of range');
  return { pos, idx };
}
