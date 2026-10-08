// MakerWorld key: the 3MF exports (track in one piece, plates of all levels) are unlocked by downloading the print
// profile from the MakerWorld model page and dropping it in. The check verifies that the file comes from MakerWorld:
// identifiers in 3D/3dmodel.model (Designer, DesignerUserId, DesignModelId, DesignProfileId), part names in
// Metadata/model_settings.config, profile version (ZIP time of 3D/3dmodel.model). Only these values are stored.
// MakerWorld serves the same file for each profile version (no download timestamp, no user ID), so a new download is
// only required when the profile is newer (minStamp).
// The identifiers are carried into the exports: Bambu Studio uses them to link prints to the profile, as with an
// opened and modified profile.
import { unzipSync, strFromU8 } from 'fflate';

export const MW_RULES = {
  /** MakerWorld user ID of the designer */
  designerUserIds: ['3696494148'],
  /** DesignModelId of the 16 mm model page, set after publishing (empty: any model by the designer with 16 mm parts). */
  modelIds: [] as string[],
  /** minimum number of known 16 mm part names the profile must contain (the all-parts profile has over 100) */
  minParts: 20,
  /** oldest valid profile version (ISO date); empty = any. Raise it after a profile update to require a new download. */
  minStamp: '',
  /** model page linked in the hint (set after publishing) */
  pageUrl: '',
};

export interface MwKey {
  designer: string; designerUserId: string; modelId: string; profileId: string; region: string;
  profileTitle: string; profileUserId: string; profileUserName: string; title: string; license: string; origin: string;
  stamp: string;       // profile version: ZIP time of 3D/3dmodel.model (assumed UTC), ISO
  parts: number;       // recognised 16 mm parts in the profile
  file: string; verified: string;
}
export type KeyResult = { ok: true; key: MwKey } | { ok: false; reason: 'notZip' | 'notThreeMf' | 'notMakerWorld' | 'otherDesigner' | 'otherModel' | 'tooFewParts' | 'outdated'; detail?: string };

/** ZIP times (DOS date) of the entries, read from the central directory. */
export function zipDates(u8: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let e = u8.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) return out;
  const n = dv.getUint16(e + 10, true); let o = dv.getUint32(e + 16, true);
  for (let i = 0; i < n && o + 46 <= u8.length; i++) {
    if (dv.getUint32(o, true) !== 0x02014b50) break;
    const nl = dv.getUint16(o + 28, true), xl = dv.getUint16(o + 30, true), cl = dv.getUint16(o + 32, true);
    const tm = dv.getUint16(o + 12, true), dt = dv.getUint16(o + 14, true);
    const name = strFromU8(u8.subarray(o + 46, o + 46 + nl));
    const p2 = (v: number) => String(v).padStart(2, '0');
    out.set(name, `${(dt >> 9) + 1980}-${p2((dt >> 5) & 15)}-${p2(dt & 31)}T${p2(tm >> 11)}:${p2((tm >> 5) & 63)}:${p2((tm & 31) * 2)}`);
    o += 46 + nl + xl + cl;
  }
  return out;
}

function unesc(s: string): string { return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
/** <metadata name="k">v</metadata> from the head of 3dmodel.model. */
export function modelMetadata(xml: string): Record<string, string> {
  const m: Record<string, string> = {};
  for (const x of xml.slice(0, 200000).matchAll(/<metadata\s+name="([^"]+)"\s*>([^<]*)<\/metadata>/g)) m[x[1]] = unesc(x[2]).trim();
  return m;
}
/** Object and part names from model_settings.config. */
export function settingsNames(xml: string): string[] {
  return [...xml.matchAll(/<metadata\s+key="name"\s+value="([^"]*)"\s*\/>/g)].map((x) => unesc(x[1]).trim());
}

/** Checks a downloaded file. knownNames: English part names of the 16 mm run (without .stl). */
export function checkMakerWorld3mf(data: ArrayBuffer | Uint8Array, fileName: string, knownNames: Set<string>, rules = MW_RULES, now = new Date()): KeyResult {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (u8.length < 30 || u8[0] !== 0x50 || u8[1] !== 0x4b) return { ok: false, reason: 'notZip' };
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(u8, { filter: (f) => f.name === '3D/3dmodel.model' || f.name === 'Metadata/model_settings.config' });
  } catch { return { ok: false, reason: 'notZip' }; }
  if (!files['3D/3dmodel.model']) return { ok: false, reason: 'notThreeMf' };
  const meta = modelMetadata(strFromU8(files['3D/3dmodel.model']));
  const uid = meta.DesignerUserId ?? '';
  if (!uid || !meta.Designer) return { ok: false, reason: 'notMakerWorld' };
  if (!rules.designerUserIds.includes(uid)) return { ok: false, reason: 'otherDesigner', detail: meta.Designer };
  const modelId = meta.DesignModelId ?? '', profileId = meta.DesignProfileId ?? '';
  if (!modelId || !profileId || (rules.modelIds.length && !rules.modelIds.includes(modelId))) return { ok: false, reason: 'otherModel', detail: meta.Title ?? '' };
  const names = files['Metadata/model_settings.config'] ? settingsNames(strFromU8(files['Metadata/model_settings.config'])) : [];
  const found = new Set(names.map((n) => n.replace(/\.stl$/i, '')).filter((n) => knownNames.has(n)));
  if (found.size < rules.minParts) return { ok: false, reason: 'tooFewParts', detail: String(found.size) };
  const stamp = zipDates(u8).get('3D/3dmodel.model') ?? '';
  if (rules.minStamp && (!stamp || stamp < rules.minStamp)) return { ok: false, reason: 'outdated', detail: stamp.slice(0, 10) };
  return {
    ok: true,
    key: {
      designer: meta.Designer, designerUserId: uid, modelId, profileId, region: meta.DesignRegion ?? '',
      profileTitle: meta.ProfileTitle ?? '', profileUserId: meta.ProfileUserId ?? '', profileUserName: meta.ProfileUserName ?? '',
      title: meta.Title ?? '', license: meta.License ?? '', origin: meta.Origin ?? '', stamp, parts: found.size,
      file: fileName, verified: now.toISOString(),
    },
  };
}

/** Is a stored key (still) valid? (After an update the profile version may be too old.) */
export function keyValid(k: MwKey | null, rules = MW_RULES): boolean {
  if (!k || !rules.designerUserIds.includes(k.designerUserId)) return false;
  if (rules.modelIds.length && !rules.modelIds.includes(k.modelId)) return false;
  if (rules.minStamp && (!k.stamp || k.stamp < rules.minStamp)) return false;
  return true;
}

const STORE = 'kb16-mwkey';
export function loadKey(): MwKey | null {
  try { const k = JSON.parse(localStorage.getItem(STORE) ?? 'null') as MwKey | null; return k && typeof k.profileId === 'string' ? k : null; } catch { return null; }
}
export function saveKey(k: MwKey | null) { try { if (k) localStorage.setItem(STORE, JSON.stringify(k)); else localStorage.removeItem(STORE); } catch { /* ignore */ } }

/** Identifiers for the 3MF exports (3dmodel.model metadata as in the MakerWorld file). */
export function keyMetadata(k: MwKey | null): Record<string, string> {
  if (!k) return {};
  const m: Record<string, string> = {
    Designer: k.designer, DesignerUserId: k.designerUserId, DesignModelId: k.modelId, DesignProfileId: k.profileId,
    DesignRegion: k.region, ProfileTitle: k.profileTitle, ProfileUserId: k.profileUserId, ProfileUserName: k.profileUserName,
    License: k.license, Origin: k.origin,
  };
  for (const key of Object.keys(m)) if (!m[key]) delete m[key];
  return m;
}

/** Test mode: tapping the logo 7 times lifts the MakerWorld profile requirement, another 7 taps restore it.
 *  For testing only, remembered in this browser; the exports then carry no MakerWorld identifiers. */
export const TEST_TAPS = 7;
export const TEST_GAP_MS = 1500;
const TEST_STORE = 'kb16-testunlock';
export function loadTestUnlock(): boolean { try { return localStorage.getItem(TEST_STORE) === '1'; } catch { return false; } }
export function saveTestUnlock(on: boolean) { try { if (on) localStorage.setItem(TEST_STORE, '1'); else localStorage.removeItem(TEST_STORE); } catch { /* ignore */ } }
/** Counts quick taps: true on the n-th consecutive tap (each at most gapMs apart), then counting starts over. */
export function tapCounter(n = TEST_TAPS, gapMs = TEST_GAP_MS): (now: number) => boolean {
  let count = 0, last = -Infinity;
  return (now: number) => {
    count = now - last <= gapMs ? count + 1 : 1;
    last = now;
    if (count >= n) { count = 0; last = -Infinity; return true; }
    return false;
  };
}
