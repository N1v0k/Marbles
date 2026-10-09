import './styles.css';
import { catalog, LEVEL, LANES, LIFT_TESTED, isFlatCurve, requiredFeedRim, partGrams, setEdition, isJapandi, kitOf, asmOf, branchPorts, freeLane, portRim, type Part, type Edition } from './catalog';
import { solveChain, compatible, portW, type ChainElement, type BranchRef, type Attach, type Layout, type Placed, type PlacedAdapter } from './chain';
import { GROUPS, CHIPS, resolve, variantOf, valueLabel, cmpVal, type Group, type GroupId, type Chip, type Variant, type Orientation, type Dir, type DimKey, type Selection } from './groups';
import { simulate, worstStatus, ballEnergy, MASS_RANGE, DEFAULT_SIM, type SpeedStep } from './physics';
import thumbsJson from './data/thumbs.json';
import thumbsJJson from './data/thumbs_j.json';
const THUMBS = thumbsJson as Record<string, string>, THUMBS_J = thumbsJJson as Record<string, string>;
/** Thumbnail for the active edition. */
const thumb = (p: Part): string | undefined => (isJapandi() ? THUMBS_J[p.id] : undefined) ?? THUMBS[p.id];
import { Viewer, colorFor, type Ghost, type GhostItem, type Marker } from './viewer3d';
import { t, tf, pick, num, partName, liftName, setLang, getLang, type Lang } from './i18n';
import { gridInfo, gridRef, nearRing } from './grid';
import { findConnections, findRunAdjustments, applyConnection, mainEnd, strandEnd, type ConnectTarget, type ConnectSuggestion } from './connect';
import { loadState, saveState, History, shareUrl, linkHash, decodeChain, sanitizeElements, sanitizeSim, cloneChain, toPlain, type AppState } from './state';
import { bom, bomCsv, trackJson, makerworldList, download, exportName } from './export';
import { tunnelAuto, tunnelLaneTargets, hasTunnelVariant } from './tunnel';
import demosJson from './data/demos.json';
import { planPlates, planMarkdown, type PlatePlan, type Plate } from './plates';
import { buildThreeMf } from './threemf';
import { PRINTERS, printerOf, loadPlate, savePlate, sanitizePlate, fitOnPlate, type PlateFit, type PlatePlace, type PlateSettings } from './printers';
import { assemblyItems, assemblyBounds, boxSize, isLoose } from './assembly';
import { planAssembly, buildAssemblyThreeMf, type AsmPlan } from './asm3mf';
import { MW_RULES, checkMakerWorld3mf, keyValid, loadKey, saveKey, keyMetadata, type MwKey, type KeyResult, loadTestUnlock, saveTestUnlock, tapCounter } from './mwkey';
import { registerProfile, hasProfile, getProfile, clearProfiles, type Ed } from './meshes3mf';
import { setColors, getColors, COLOR_PRESETS, COLOR_GROUPS, sanitizeColors, presetState, withFilament, withOwnColor, FILAMENTS, FIL_TYPES, FIT_TYPE,
  filamentByCode, filamentName, filamentCss, keyCss, keyLabel, untestedTypes, viewColor, decodeColors, type ColorGroup } from './colors';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const state: AppState = loadState();
setEdition(state.japandi ? 'japandi' : 'plain');
setColors(state.colors);
applyEditionLook();
const history = new History();
let layout: Layout = solveChain(state.elements);
let steps: SpeedStep[] = simulate(layout, state.sim);
let selected: number | null = null;
let insertAfter: number | null = null; // null = append
let replaceIdx: number | null = null;  // replace mode: index of the part being replaced
let showUphill = false; let compatibleOnly = true; let search = '';
/** Branch mode: the next part starts a new strand at this free exit. */
let branchFrom: BranchRef | null = null;
/** Parts list: filter chip and, per base part, the selected option values (kept while the page is open). */
let chip: Chip | 'all' = 'all';
try { const c = localStorage.getItem('kb16-chip'); if (c && (c === 'all' || (CHIPS as string[]).includes(c))) chip = c as Chip | 'all'; } catch { /* ignore */ }
const cardSel = new Map<GroupId, Selection>();
let pickG: ColorGroup | null = null;  // filament picker is open for this group
let pickType = FIT_TYPE;             // material type filter in the picker ('' = all)
/** One-piece printing: plate settings (printer, on/off) and the MakerWorld key for 3MF exports. */
let plateCfg: PlateSettings = loadPlate();
let mwKey: MwKey | null = loadKey();
/** Test mode: tapping the logo 7 times lifts the profile requirement. */
let testUnlock = loadTestUnlock();
let pendingExport: (() => void) | null = null;

const viewer = new Viewer($('#c3d'), { onSelect: (idx) => select(idx) });
viewer.onGhost = (key) => chooseKey(key);
viewer.onMarker = (key) => { const [i, port] = key.split(':').map(Number); if (Number.isInteger(i) && Number.isInteger(port)) startBranch(i, port); };
viewer.onMeshError = (msg) => { toast(t('meshError') + ': ' + msg); renderIssues(); };

// ---------------------------------------------------------------- Rendering
function applyLang() {
  document.querySelectorAll<HTMLElement>('[data-t]').forEach((el) => { el.innerHTML = t(el.dataset.t!); });
  ($('#search') as HTMLInputElement).placeholder = t('search');
  $('#btn-lang').textContent = getLang() === 'de' ? 'EN' : 'DE';
  $('#help-body').innerHTML = t('helpText') + `<p class="muted small">${t('title')} v2.5 · ${tf('helpFooter', { n: catalog.parts.filter((p) => !kitOf(p) && !p.display).length })} · ${viewer.glInfo}</p>`;
  $('#brand-sub').textContent = t(isJapandi() ? 'subtitleJ' : 'subtitle');
  fillColorUi();
  $('#sw-japandi').title = tf('japandiHint', { n: catalog.parts.filter((p) => p.jp).length }); $('#chk-japandi').setAttribute('aria-label', t('japandi'));
  document.documentElement.lang = getLang(); document.title = t('title');
  showSim();
  // issue texts (collisions, ball check) are generated while solving -> recompute
  layout = solveChain(state.elements); steps = simulate(layout, state.sim);
  renderAll();
  viewer.setLayout(layout, steps).then(() => viewer.setSelected(selected));
}

/** Toggle Japandi: set the edition, switch the look, redraw everything (meshes, colors, weights, thumbnails). */
function setJapandi(on: boolean, render = true) {
  state.japandi = on; state.editionChosen = true;
  setEdition((on ? 'japandi' : 'plain') as Edition);
  const chk = document.querySelector<HTMLInputElement>('#chk-japandi'); if (chk) chk.checked = on;
  applyEditionLook();
  saveState(state);
  if (render) applyLang();
}
/** body.japandi class plus web fonts (loaded only for the Japandi style; fallback fonts apply offline). */
function applyEditionLook() {
  const on = isJapandi();
  document.body.classList.toggle('japandi', on);
  if (on && !document.getElementById('jp-fonts')) {
    const l = document.createElement('link'); l.id = 'jp-fonts'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@500;700&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap';
    document.head.appendChild(l);
  }
}

/** Apply colors (family or filament colors): recolor the 3D view, re-render palette and plates. */
function applyColorState(cs: ReturnType<typeof getColors>, render = true) {
  state.colors = cs; setColors(cs);
  saveState(state);
  if (!render) return;
  fillColorUi();
  viewer.recolor();
  renderPalette(); renderPlates();
}
/** Sync the color preset select and swatches with the current state. */
function fillColorUi() {
  const cs = getColors();
  const sel = $('#sel-colors') as HTMLSelectElement;
  const opts: [string, string][] = [['family', t('colFamily')], ...COLOR_PRESETS.map((p) => [p.id, getLang() === 'de' ? p.de : p.en] as [string, string]), ['custom', t('colCustom')]];
  sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  sel.value = cs.mode === 'family' ? 'family' : cs.preset ?? 'custom';
  const lang = getLang();
  for (const g of COLOR_GROUPS) {
    const b = $('#sw-' + g), fil = filamentByCode(cs.f[g]);
    b.querySelector<HTMLElement>('.sw-dot')!.style.background = keyCss(cs.f[g] ?? cs.c[g]);
    b.querySelector('.sw-name')!.textContent = fil ? filamentName(fil, lang) : tf('ownColor', { c: cs.c[g].toUpperCase() });
    b.title = fil ? keyLabel(fil.code, lang) : cs.c[g].toUpperCase();
    b.setAttribute('aria-expanded', String(pickG === g));
    b.classList.toggle('open', pickG === g);
  }
  $('#swatches').hidden = cs.mode === 'family';
  if (cs.mode === 'family') pickG = null;
  const un = untestedTypes(cs);
  const fit = $('#fil-fit');
  fit.hidden = !un.length;
  fit.textContent = un.length ? tf('filFit', { types: un.map((x) => (x === '?' ? t('filOwnType') : x)).join(', ') }) : '';
  ($('#fil-search') as HTMLInputElement).placeholder = t('filSearch');
  $('#fil-close').setAttribute('aria-label', t('close')); $('#fil-close').title = t('close');
  const ts = $('#fil-type') as HTMLSelectElement;
  ts.innerHTML = `<option value="">${t('filAll')} (${FILAMENTS.length})</option>` +
    FIL_TYPES.map((x) => `<option value="${x}">${x} (${FILAMENTS.filter((f) => f.type === x).length})</option>`).join('');
  ts.value = pickType;
  renderFilPanel();
}

// Filament picker: open for one group (pickG), filtered by material type, searchable by name/type/code
function openPicker(g: ColorGroup | null) {
  pickG = g;
  if (g) {
    const cs = getColors(), fil = filamentByCode(cs.f[g]);
    pickType = fil ? fil.type : FIT_TYPE;
    ($('#fil-search') as HTMLInputElement).value = '';
  }
  fillColorUi();
  if (g) $('#fil-grid').querySelector<HTMLElement>('.fil.on, .fil')?.scrollIntoView({ block: 'nearest' });
}
function renderFilPanel() {
  const panel = $('#fil-panel');
  panel.hidden = !pickG;
  if (!pickG) return;
  const cs = getColors(), lang = getLang(), cur = cs.f[pickG];
  $('#fil-title').textContent = tf('filPick', { g: t(({ track: 'colTrack', rail: 'colRail', adapter: 'colAdapter', accent: 'colAccent' } as const)[pickG]) });
  ($('#fil-own') as HTMLInputElement).value = cs.c[pickG];
  const q = ($('#fil-search') as HTMLInputElement).value.trim().toLowerCase();
  const list = FILAMENTS.filter((f) => (!pickType || f.type === pickType) &&
    (!q || `${f.type} ${f.de} ${f.en} ${f.code}`.toLowerCase().includes(q)));
  $('#fil-grid').innerHTML = list.length ? list.map((f) => {
    const name = lang === 'de' ? f.de : f.en;
    return `<button type="button" class="fil${f.code === cur ? ' on' : ''}" role="option" aria-selected="${f.code === cur}" data-code="${f.code}" title="${f.type} ${name} · ${f.code}">` +
      `<i style="background:${filamentCss(f)}"></i><span>${name}${pickType ? '' : `<small>${f.type}</small>`}</span></button>`;
  }).join('') : `<p class="muted small">${t('filNone')}</p>`;
}

function recompute(pushHistory = true, prevElements?: ChainElement[]) {
  if (pushHistory && prevElements) history.push(prevElements);
  layout = solveChain(state.elements);
  steps = simulate(layout, state.sim);
  saveState(state);
  renderAll();
  viewer.setLayout(layout, steps).then(() => viewer.setSelected(selected));
}
/** Re-run only the ball check (sliders): no new layout or meshes, debounced save. */
let saveTimer = 0;
function resimulate() {
  steps = simulate(layout, state.sim);
  renderChain(); renderDetail(); renderIssues(); renderStats(); renderOverlay();
  viewer.setSteps(steps);
  clearTimeout(saveTimer); saveTimer = window.setTimeout(() => saveState(state), 400);
}
function renderAll() { updateCurFit(); renderPalette(); renderChain(); renderDetail(); renderIssues(); renderStats(); renderBom(); renderPlates(); renderOnePiece(); renderOverlay(); renderMarkers(); updateButtons(); }

// ---------------------------------------------------------------- Building: where does the next part attach?
/** Attach point for the next part: branch (free exit), insert (after the anchor) or append (end of the last built strand).
 *  After a part docked into the free lane of an X-crossing, this is that lane's exit. */
function attachPoint(): Attach | null {
  if (branchFrom) return branchAttach(branchFrom);
  const i = insertAfter != null && layout.placed[insertAfter] ? insertAfter : layout.placed.length - 1;
  const q = layout.placed[i];
  return q ? { exit: q.out, rimOutEff: q.outRim } : null;
}
function branchAttach(b: BranchRef): Attach | null {
  const A = layout.placed[state.elements.indexOf(b.from)];
  if (!A || !A.connected) return null;
  return { exit: portW(A.part.ports[b.port], A.R, A.t, A.S), rimOutEff: portRim(A.part, b.port) };
}
function openEndLabel(): string {
  const a = attachPoint();
  if (!a || !a.exit) return '';
  const lvl = Math.round((a.exit.p[2] - 5.7) / LEVEL * 10) / 10;
  return tf('openEnd', { rim: a.rimOutEff ?? '–', lvl: Math.max(0, lvl) });
}

function shortName(p: Part): string { return p.lift ? liftName(p) : partName(p).replace(/_16mm/, '').replace(/_gespiegelt|_mirrored/, ' ⟲').replace(/_/g, ' '); }
function famLabel(f: string) { return t('fam' + f.charAt(0).toUpperCase() + f.slice(1)); }
function sysLabel(s: string) { return t('sys' + s.charAt(0).toUpperCase() + s.slice(1)); }
function groupLabel(g: Group | GroupId): string { return t('grp_' + (typeof g === 'string' ? g : g.id)); }
function dirLabel(d: Dir | null): string { return d ? t('dir_' + d) : ''; }
/** Strand name: main strand or branch k (starting at part n). */
function strandLabel(s: number): string {
  const st = layout.strands[s]; if (!st) return '';
  if (!st.from) return t('strandMain');
  const A = layout.placed[st.from.idx];
  return tf('strandBranch', { k: s, n: st.from.idx + 1, name: A ? shortName(A.part) : '?' });
}
/** Label for the exit a branch starts at (flip-flop: second exit left/right, X-crossing: cross lane). */
function portLabel(p: Part, port: number): string {
  if (LANES[p.id]) return t('portCross');
  if (p.id.startsWith('Kippwippe')) return tf('portSecond', { side: t(p.turn > 0 ? 'right' : 'left') });
  return String(port);
}

/** Replace: does p (optionally reversed, with lane) fit at index i between predecessor and successor? (Tested on the prefix up to i+1.) */
function replaceCompatible(i: number, p: Part, reversed: boolean, lane = 0): { ok: boolean; why?: string } {
  const work = state.elements.slice(0, i + 2);
  const old = work[i];
  const el: ChainElement = reversed ? { part: p.id, reversed: true } : { part: p.id };
  if (lane) el.lane = lane;
  if (old?.branch) el.branch = old.branch;
  work[i] = el;
  // branches from the old part now hang off the new one (for the test only)
  for (let k = i + 1; k < work.length; k++) if (work[k].branch?.from === old) work[k] = { ...work[k], branch: { from: el, port: work[k].branch!.port } };
  const lay = solveChain(work, { quick: true });
  const bad = lay.issues.find((is) => is.code === 'joint' && is.idx.some((x) => x >= i));
  if (bad) return { ok: false, why: bad.text };
  return { ok: true };
}
/** Does an orientation fit at the current position? (Rim/joint; all directions of a variant share the same entry.) */
function fitOrient(o: Orientation, at = attachPoint(), plate = true): { ok: boolean; why?: string } {
  const p = catalog.byId.get(o.part)!;
  let r: { ok: boolean; why?: string };
  if (replaceIdx != null && layout.placed[replaceIdx]) r = replaceCompatible(replaceIdx, p, o.reversed, o.lane);
  else if (branchFrom && !at) r = { ok: false, why: t('branchLost') };
  else r = compatible(at, p, o.reversed, o.lane);
  if (r.ok && plate) { const why = plateBlocks(buildWork(o).work); if (why) return { ok: false, why }; }
  return r;
}
/** Plate mode: returns the reason if the track fits the plate now but would no longer fit with this part, otherwise null.
 *  If the track already overhangs, nothing is blocked (the status shows it). Lift and flip-flop don't count (printed loose). */
function plateBlocks(work: ChainElement[]): string | null {
  if (!plateCfg.on || !curFit || !curFit.fits) return null;
  const L = solveChain(work, { quick: true });
  const b = assemblyBounds(assemblyItems(L)); if (!b) return null;
  const pr = printerOf(plateCfg), fit = fitOnPlate(boxSize(b), pr);
  return fit.fits ? null : tf('plateBlock', { name: pr.name, list: overList(fit) });
}
/** Variant check for the parts list: joint check as usual; in plate mode one direction fitting the plate is enough. */
function fitVariant(v: Variant, at = attachPoint()): { ok: boolean; why?: string } {
  const f0 = fitOrient(v.opts[0], at, false);
  if (!f0.ok || !plateCfg.on || !curFit?.fits) return f0;
  let why: string | null = null;
  for (const o of v.opts) { const w = plateBlocks(buildWork(o).work); if (!w) return f0; why = why ?? w; }
  return { ok: false, why: why ?? undefined };
}

function renderModeLine() {
  const el = $('#mode-line');
  let html = '', cls = 'mode-line';
  if (choice) {
    cls += ' choose';
    html = `<span>${tf('modeChoose', { name: groupLabel(choice.group) })}</span>`;
  } else if (replaceIdx != null && layout.placed[replaceIdx]) {
    cls += ' replace';
    html = `<span>${tf('modeReplace', { n: replaceIdx + 1, name: shortName(layout.placed[replaceIdx].part) })}</span>`;
  } else if (branchFrom) {
    const a = state.elements.indexOf(branchFrom.from), A = layout.placed[a];
    cls += ' branch';
    html = `<span>${tf('modeBranch', { n: a + 1, name: A ? shortName(A.part) : '?', port: A ? portLabel(A.part, branchFrom.port) : '' })}</span>`;
  } else if (insertAfter != null && layout.placed[insertAfter]) {
    const st = layout.strands[layout.placed[insertAfter].strand];
    const atEnd = !!st && st.idxs[st.idxs.length - 1] === insertAfter;
    html = atEnd && layout.strands.length > 1 ? `<span>${tf('modeContinue', { strand: strandLabel(st.id) })}</span>`
      : `<span>${tf('modeInsert', { n: insertAfter + 1, name: shortName(layout.placed[insertAfter].part) })}</span>`;
  }
  if (html) html += `<button id="mode-cancel">${t('cancel')}</button>`;
  el.className = cls; el.innerHTML = html;
  el.querySelector('#mode-cancel')?.addEventListener('click', () => { if (choice) cancelChoice(); else { replaceIdx = null; insertAfter = null; branchFrom = null; renderAll(); } });
  const oe = $('#open-end');
  const lbl = replaceIdx == null && layout.placed.length ? openEndLabel() : '';
  oe.hidden = !lbl;
  if (!lbl) { oe.innerHTML = ''; return; }
  const g = gridLabel();
  // Connect: from the displayed open end if it is the end of a strand (main strand or branch), not in branch/insert mode
  const canConnect = connectStrand() != null && connectTargets().length > 0;
  oe.innerHTML = `<div class="oe-row"><span>${esc(lbl)}</span>${canConnect ? `<button id="btn-connect" class="small-btn">${t('btnConnect')}</button>` : ''}</div>` +
    (g ? `<div class="oe-grid" title="${esc(t('gridHelp'))}">${esc(g)}</div>` : '');
  oe.querySelector('#btn-connect')?.addEventListener('click', openConnect);
}
/** Position of the open end in the 8 mm grid of the first part (along/across the direction of travel). */
function gridLabel(): string {
  const a = attachPoint(); const ref = gridRef(layout);
  if (!a?.exit || !ref) return '';
  const g = gridInfo(ref, a.exit); if (!g) return '';
  const al = g.along.state === 'on' ? t('gridOn') : g.along.state === 'third' ? t('gridThird') : g.along.state === 'twoThirds' ? t('gridTwoThirds') : tf('gridOff', { d: num(g.along.need) });
  const ac = g.across.state === 'on' ? t('gridOn') : g.across.state === 'third' ? t('gridAcrossThird') : tf('gridOff', { d: num(g.across.need) });
  return tf('gridLine', { a: al, q: ac });
}
function renderChips() {
  const box = $('#chips');
  box.innerHTML = (['all', ...CHIPS] as (Chip | 'all')[]).map((c) => `<button type="button" class="chip${chip === c ? ' on' : ''}" data-chip="${c}" aria-pressed="${chip === c}">${t('chip_' + c)}</button>`).join('');
  box.querySelectorAll<HTMLButtonElement>('.chip').forEach((b) => b.addEventListener('click', () => {
    chip = b.dataset.chip as Chip | 'all';
    try { localStorage.setItem('kb16-chip', chip); } catch { /* ignore */ }
    renderPalette();
  }));
}

/** Parts list: one card per base part with selects for its variants (only fitting values when "compatible only" is on). */
function renderPalette() {
  renderModeLine(); renderChips();
  const list = $('#palette-list'); list.innerHTML = '';
  const at = attachPoint();
  const fitCache = new Map<Variant, { ok: boolean; why?: string }>();
  const fit = (v: Variant) => { let f = fitCache.get(v); if (!f) { f = fitVariant(v, at); fitCache.set(v, f); } return f; };
  const q = search.trim().toLowerCase();
  const lang = getLang();
  for (const g of GROUPS) {
    if (chip !== 'all' && g.chip !== chip) continue;
    const gMatch = !q || groupLabel(g).toLowerCase().includes(q) || t('grp_' + g.id).toLowerCase().includes(q);
    const matchPart = (id: string) => { const p = catalog.byId.get(id)!; return p.id.toLowerCase().includes(q) || p.nameEn.toLowerCase().includes(q) || (!!p.lift && liftName(p).toLowerCase().includes(q)); };
    const base = (v: Variant) => (state.showLegacy || v.released) && (showUphill || !v.up) && (gMatch || v.opts.some((o) => matchPart(o.part)));
    if (!g.variants.some(base)) continue;
    const allowed = (v: Variant) => base(v) && fit(v).ok;
    if (compatibleOnly && !g.variants.some(allowed)) continue;
    const r = resolve(g, cardSel.get(g.id) ?? {}, compatibleOnly ? allowed : base);
    const v = r.variant; if (!v) continue;
    const f = fit(v);
    const p0 = catalog.byId.get(v.opts[0].part)!;
    const card = document.createElement('div');
    card.className = 'pcard' + (f.ok ? '' : ' off') + (g.extra ? ' extra' : '');
    card.dataset.g = g.id;
    card.style.borderLeftColor = '#' + colorFor(p0).toString(16).padStart(6, '0');
    const th = thumb(p0);
    const dims = g.dims.map((k) => {
      const vals = r.values[k] ?? [];
      if (vals.length <= 1 && k !== 'h') return vals.length ? `<span class="pc-fixed" title="${t('dim_' + k)}">${valueLabel(k, vals[0], lang)}</span>` : '';
      return `<select data-dim="${k}" title="${t('dim_' + k)}" aria-label="${t('dim_' + k)}">${vals.map((x) => `<option value="${x}"${x === r.sel[k] ? ' selected' : ''}>${valueLabel(k, x, lang)}</option>`).join('')}</select>`;
    }).join('');
    const dirs = v.opts.length > 1 ? `<span class="pc-dirs" title="${t('dirHint')}">${v.opts.map((o) => dirArrow(o.dir)).join(' ')}</span>` : '';
    const tags = [
      !p0.released ? `<span class="tag legacy">${t('legacyTag')}</span>` : '',
      p0.lift && p0.lift.n > LIFT_TESTED ? `<span class="tag est">${t('untestedTag')}</span>` : '',
      v.up ? `<span class="tag">${t('uphillTag')}</span>` : '',
    ].join('');
    card.innerHTML = `${th ? `<img class="thumb" src="${th}" alt="" loading="lazy" />` : '<span class="thumb"></span>'}<div class="pc-body">
      <div class="pc-head"><span class="name">${groupLabel(g)}</span>${dirs}<span class="pc-g">${partGrams(p0).toFixed(0)} g</span>
        <button type="button" class="pc-add" title="${f.ok ? t('addPart') : esc(f.why ?? '')}" aria-label="${t('addPart')}: ${groupLabel(g)}"${f.ok ? '' : ' disabled'}>+</button></div>
      ${dims ? `<div class="pc-dims">${dims}</div>` : ''}${tags ? `<div class="pc-tags">${tags}</div>` : ''}</div>`;
    card.title = (f.ok ? '' : (f.why ?? '') + '\n') + shortName(p0) + (pick(p0.note, p0.noteEn) ? '\n' + pick(p0.note, p0.noteEn) : '');
    card.querySelectorAll<HTMLSelectElement>('select[data-dim]').forEach((s) => {
      s.addEventListener('click', (e) => e.stopPropagation());
      s.addEventListener('change', () => { cardSel.set(g.id, { ...r.sel, [s.dataset.dim!]: s.value }); renderPalette(); });
    });
    if (f.ok) card.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('select')) return; pickVariant(g, v); });
    list.appendChild(card);
  }
  if (!list.children.length) {
    const prev = attachPoint();
    list.innerHTML = `<p class="muted small">${prev && !prev.exit && !branchFrom ? t('paletteEnded') : t('paletteNone')}</p>`;
  }
}
/** Markers for list and detail: curves get a direction arrow, reversed (uphill) parts ⇄, lane-docked parts ✕. */
function marks(q: Placed): string {
  const turn = q.reversed ? -q.part.turn : q.part.turn;
  const curve = q.part.family === 'curve' || q.part.family === 'longCurve';
  const arrow = !curve ? '' : turn === 90 ? ' ↰' : turn === -90 ? ' ↱' : '';
  const up = q.reversed && !isFlatCurve(q.part) ? ' ⇄' : '';
  return arrow + up + (q.lane ? ' ✕' : '');
}
function dirArrow(d: Dir | null): string { return d === 'left' ? '↰' : d === 'right' ? '↱' : d === 'straight' ? '↑' : d === 'back' ? '↓' : ''; }

// ---------------------------------------------------------------- Direction choice (ghosts in the 3D view)
interface Cand { o: Orientation; ok: boolean; why: string; key: string; work: ChainElement[]; el: ChainElement; idx: number; lay: Layout }
let choice: { group: Group; cands: Cand[] } | null = null;
/** Chain with the new part (replace, branch, insert or append), without modifying state. */
function buildWork(o: Orientation): { work: ChainElement[]; el: ChainElement; idx: number; old: ChainElement | null } {
  const el: ChainElement = { part: o.part };
  if (o.reversed) el.reversed = true;
  if (o.lane) el.lane = o.lane;
  const work = state.elements.slice();
  if (replaceIdx != null && work[replaceIdx]) {
    const old = work[replaceIdx];
    if (old.branch) el.branch = old.branch;
    work[replaceIdx] = el;
    for (let k = replaceIdx + 1; k < work.length; k++) if (work[k].branch?.from === old) work[k] = { ...work[k], branch: { from: el, port: work[k].branch!.port } };
    return { work, el, idx: replaceIdx, old };
  }
  if (branchFrom) { el.branch = { from: branchFrom.from, port: branchFrom.port }; work.push(el); return { work, el, idx: work.length - 1, old: null }; }
  if (insertAfter != null && work[insertAfter]) { work.splice(insertAfter + 1, 0, el); return { work, el, idx: insertAfter + 1, old: null }; }
  work.push(el); return { work, el, idx: work.length - 1, old: null };
}
/** Error count, excluding hints (collisions, joints, missing adapters …). */
const errCount = (L: Layout) => L.issues.filter((i) => i.level === 'error').length;
/** Base part picked: if only one direction fits (or only one has room), place it; otherwise show ghosts in 3D. */
function pickVariant(g: Group, v: Variant) {
  cancelChoice(false);
  const at = attachPoint();
  const opts = v.opts.filter((o) => fitOrient(o, at).ok);
  if (!opts.length) { toast(fitVariant(v, at).why ?? fitOrient(v.opts[0], at).why ?? t('noFit')); return; }
  if (opts.length === 1) { commitOrientation(opts[0]); return; }
  const base = errCount(layout);
  const cands: Cand[] = opts.map((o) => {
    const b = buildWork(o);
    const lay = solveChain(b.work);
    const ok = errCount(lay) <= base;
    const why = ok ? '' : (lay.issues.find((i) => i.level === 'error' && i.idx.includes(b.idx))?.text ?? lay.issues.find((i) => i.level === 'error')?.text ?? '');
    return { o, ok, why, key: o.dir ?? o.part, work: b.work, el: b.el, idx: b.idx, lay };
  });
  const free = cands.filter((c) => c.ok);
  if (free.length === 1) {
    commitCand(free[0]);
    toast(tf('dirAuto', { dir: dirLabel(free[0].o.dir) }), 3500);
    return;
  }
  choice = { group: g, cands };
  // close the detail panel (it would cover the ghosts); the new part is selected after placing
  if (selected != null) { selected = null; viewer.setSelected(null); renderChain(); renderDetail(); }
  showChoice();
}
function ghostsOf(c: Cand, withMesh: boolean): Ghost {
  const q = c.lay.placed[c.idx];
  const items: GhostItem[] = [];
  if (withMesh && q) {
    const asm = asmOf(q.part);
    if (asm) for (const a of asm) { const m = catalog.byId.get(a.id); if (m) items.push({ mesh: m, t: q.t, z: q.S + a.z, rot: (q.rot + a.rot) % 360 }); }
    else items.push({ mesh: q.part, t: q.t, z: q.S, rot: q.rot });
  }
  const ex = q?.exit;
  return { key: c.key, ok: c.ok, items, arrow: ex ? { p: ex.p, n: [ex.n[0], ex.n[1]] } : undefined };
}
function showChoice() {
  if (!choice) return;
  // curves: ghost the parts themselves; lift and flip-flop look the same in every direction, so only show exit arrows
  const sameBody = choice.cands.every((c) => asmOf(catalog.byId.get(c.o.part)!) != null);
  const ghosts = choice.cands.map((c) => { const g = ghostsOf(c, !sameBody); if (sameBody && g.arrow) g.arrow.scale = 1.3; return g; });
  if (sameBody) ghosts.push({ ...ghostsOf(choice.cands[0], true), key: '', ok: true, arrow: undefined });
  void viewer.setGhosts(ghosts);
  const bar = $('#choice-bar');
  bar.innerHTML = `<span>${t('chooseDir')}</span>` + choice.cands.map((c) =>
    `<button type="button" data-key="${c.key}" class="${c.ok ? 'ok' : 'bad'}" title="${esc(c.ok ? dirLabel(c.o.dir) : c.why)}">${dirArrow(c.o.dir)} ${dirLabel(c.o.dir)}${c.ok ? '' : ' ✕'}</button>`).join('') +
    `<button type="button" data-key="__cancel">${t('cancel')}</button>`;
  bar.hidden = false;
  $('#empty-hint').style.display = 'none';
  bar.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => (b.dataset.key === '__cancel' ? cancelChoice() : chooseKey(b.dataset.key!))));
  renderModeLine();
  showTabOnMobile('viewport');
}
function chooseKey(key: string) {
  if (!choice || !key) return;
  const c = choice.cands.find((x) => x.key === key); if (!c) return;
  commitCand(c);
}
function cancelChoice(render = true) {
  if (!choice) return;
  choice = null;
  void viewer.setGhosts(null);
  $('#choice-bar').hidden = true;
  $('#empty-hint').style.display = layout.placed.length ? 'none' : 'block';
  if (render) renderModeLine();
}
function commitCand(c: Cand) {
  cancelChoice(false);
  commitBuilt(buildWork(c.o));
}
function commitOrientation(o: Orientation) { cancelChoice(false); commitBuilt(buildWork(o)); }
/** Commit the new part: in insert and branch mode the anchor moves to the new part (continue the strand). */
function commitBuilt(b: { work: ChainElement[]; el: ChainElement; idx: number; old: ChainElement | null }) {
  if (b.old) {
    // replace: like swapElement (branches move to the new part; they are dropped if their exit no longer exists)
    swapElement(b.idx, { part: b.el.part, reversed: !!b.el.reversed, lane: b.el.lane ?? 0, dir: null }, false, true);
    return;
  }
  const prevEl = snapshot();
  const wasBranch = !!branchFrom, anchored = anchorEl();
  branchFrom = null;
  commitElements(b.work, { select: b.el, insertAnchor: wasBranch || anchored ? b.el : null, replaceTarget: null }, prevEl);
}
/** Replace work[i] with el; branches from the old element are re-attached to the new one. */
function applyReplace(work: ChainElement[], i: number, el: ChainElement) {
  const old = work[i];
  if (old.branch && !el.branch) el.branch = old.branch;
  work[i] = el;
  for (const e of work) if (e.branch?.from === old) e.branch = { from: el, port: remapPort(old, el, e.branch.port) };
}
/** Branch port after swapping a part: for an X-crossing with a different lane, map to the exit of the new free lane. */
function remapPort(old: ChainElement, el: ChainElement, port: number): number {
  const po = catalog.byId.get(old.part), pn = catalog.byId.get(el.part);
  if (!po || !pn || !LANES[pn.id]) return port;
  const fo = freeLane(po, old.lane ?? 0), fn = freeLane(pn, el.lane ?? 0);
  return fo && fn && port === fo[1] ? fn[1] : port;
}
/** Remove strands whose anchor is missing or no longer has that branch exit (including their sub-branches). Returns the number of parts removed. */
function pruneOrphans(work: ChainElement[]): number {
  let removed = 0;
  for (;;) {
    let cut = -1;
    for (let k = 0; k < work.length && cut < 0; k++) {
      const b = work[k].branch; if (!b) continue;
      const a = work.indexOf(b.from);
      const ap = a >= 0 && a < k ? catalog.byId.get(work[a].part) : null;
      if (!ap || !branchPorts(ap, work[a].lane ?? 0).includes(b.port)) cut = k;
    }
    if (cut < 0) return removed;
    let end = cut + 1; while (end < work.length && !work[end].branch) end++;
    removed += end - cut;
    work.splice(cut, end - cut);
  }
}

// ---------------------------------------------------------------- Track list (by strand)
function renderChain() {
  const ol = $('#chain-list'); ol.innerHTML = '';
  const multi = layout.strands.length > 1;
  for (const st of layout.strands) {
    if (multi) {
      const h = document.createElement('li'); h.className = 'strand-head'; h.dataset.strand = String(st.id);
      const last = st.idxs[st.idxs.length - 1];
      const end = layout.placed[last];
      h.innerHTML = `<span class="sh-name">${strandLabel(st.id)}</span>${end && end.out ? `<button type="button" class="small-btn" data-cont="${last}">${t('continueStrand')}</button>` : ''}`;
      h.querySelector<HTMLButtonElement>('button[data-cont]')?.addEventListener('click', (e) => { e.stopPropagation(); insertAfter = last; replaceIdx = null; branchFrom = null; renderAll(); showTabOnMobile('palette'); });
      ol.appendChild(h);
    }
    for (const i of st.idxs) {
      const q = layout.placed[i];
      const li = document.createElement('li'); li.className = i === selected ? 'sel' : ''; li.dataset.idx = String(i);
      const s = steps[i];
      const dot = s ? `<span class="dot ${s.status}"></span>` : '';
      const v = s && q.part.family !== 'start' ? `${Math.round(s.vIn)}→${Math.round(s.vOut)}` : s ? `${Math.round(s.vOut)}` : '';
      const via = q.via ? ` · ${tf('viaShort', { n: q.via.idx + 1 })}` : q.dock && layout.placed[q.dock.idx]?.part.merge ? ` · ${tf('mergeShort', { n: q.dock.idx + 1 })}` : '';
      li.innerHTML = `<span class="n">${i + 1}</span><span><span class="name">${dot}${shortName(q.part)}${marks(q)}</span><br><span class="sub">${t('level')} ${q.S}${via}${insertAfter === i ? ' · ▼' : ''}</span></span><span class="v" title="${t('speedTitle')}">${v}${v ? '<small>mm/s</small>' : ''}</span>`;
      li.addEventListener('click', () => { select(i); showTabOnMobile('viewport'); });
      ol.appendChild(li);
    }
  }
  $('#empty-hint').style.display = layout.placed.length ? 'none' : 'block';
}

// ---------------------------------------------------------------- Detail panel
/** Selects for the selected part: same variants as in the parts list, limited to what fits at this position. */
function detailDims(sel: number): string {
  const q = layout.placed[sel]; const vo = variantOf(q.part.id, q.reversed, q.lane);
  if (!vo || !vo.group.dims.length) return '';
  const { group: g, variant: cur } = vo;
  const lang = getLang();
  const okCache = new Map<Variant, boolean>();
  const allowed = (v: Variant) => {
    if (v === cur) return true;
    if (!(state.showLegacy || v.released) || (!showUphill && v.up && !cur.up)) return false;
    let ok = okCache.get(v);
    if (ok == null) { ok = replaceCompatible(sel, catalog.byId.get(v.opts[0].part)!, v.opts[0].reversed, v.opts[0].lane).ok; okCache.set(v, ok); }
    return ok;
  };
  const html = g.dims.map((k) => {
    const vals = [...new Set(g.variants.filter(allowed).map((v) => v.dims[k]!).filter((x) => x != null))].sort((a, b) => cmpVal(k, a, b));
    const usable = vals.filter((x) => resolve(g, { ...cur.dims, [k]: x }, allowed).sel[k] === x);
    if (usable.length <= 1) return `<label class="dd"><span>${t('dim_' + k)}</span><b>${valueLabel(k, cur.dims[k]!, lang)}</b></label>`;
    return `<label class="dd"><span>${t('dim_' + k)}</span><select data-ddim="${k}">${usable.map((x) => `<option value="${x}"${x === cur.dims[k] ? ' selected' : ''}>${valueLabel(k, x, lang)}</option>`).join('')}</select></label>`;
  }).join('');
  return `<div class="detail-dims">${html}</div>`;
}
function onDetailDim(sel: number, k: DimKey, val: string) {
  const q = layout.placed[sel]; const vo = variantOf(q.part.id, q.reversed, q.lane); if (!vo) return;
  const allowed = (v: Variant) => (state.showLegacy || v.released) && replaceCompatible(sel, catalog.byId.get(v.opts[0].part)!, v.opts[0].reversed, v.opts[0].lane).ok;
  const r = resolve(vo.group, { ...vo.variant.dims, [k]: val }, (v) => v === vo.variant || allowed(v));
  if (!r.variant) return;
  const o = r.variant.opts.find((x) => x.dir === vo.opt.dir) ?? r.variant.opts[0];
  swapElement(sel, o);
}
function renderDetail() {
  const box = $('#detail-section');
  if (selected == null || !layout.placed[selected]) { box.innerHTML = ''; return; }
  const sel = selected;
  const q = layout.placed[sel]; const p = q.part; const st = steps[sel];
  const ad = layout.adapters.filter((a) => a.owner === sel);
  const msgs = (st?.msgs ?? []).map((m) => `<div class="msg ${st.status}">${m}</div>`).join('');
  const issues = layout.issues.filter((is) => is.idx.includes(sel) && is.code !== 'passThrough').map((is) => `<div class="msg ${is.level}">${is.text}</div>`).join('');
  const th = thumb(p);
  const vo = variantOf(p.id, q.reversed, q.lane);
  const dirOpts = vo && vo.variant.opts.length > 1 ? vo.variant.opts : null;
  const dirBtn = dirOpts ? `<button id="d-dir">${p.lift ? t('liftTurn') : p.id.startsWith('Kippwippe') ? t('flipflopSwap') : p.merge ? t('ymSwap') : t('dirSwitch')}</button>` : '';
  const flatCurve = isFlatCurve(p);
  // branches at this part: free exits (build) and existing branches (jump to)
  const branchBtns = q.connected ? [
    ...layout.strands.filter((s) => s.from && s.from.idx === sel).map((s) => `<button data-goto="${s.idxs[0]}">${tf('gotoBranch', { k: s.id, port: portLabel(p, s.from!.port) })}</button>`),
    ...layout.freePorts.filter((f) => f.idx === sel && f.kind === 'branch').map((f) => `<button data-branch="${f.port}">${tf('buildBranch', { port: portLabel(p, f.port) })}</button>`),
  ].join('') : '';
  const fl = freeLane(p, q.lane);
  const laneInfo = fl ? (() => {
    const user = layout.placed.find((x) => x.dock && x.dock.idx === sel);
    return `<div class="small" style="margin-top:4px">${user ? tf(p.merge ? 'mergeUsed' : 'laneUsed', { n: user.idx + 1, name: shortName(user.part) }) : t(p.merge ? 'mergeFree' : 'laneFree')}</div>`;
  })() : '';
  box.innerHTML = `<button class="close" id="d-close">×</button>${th ? `<img class="thumb detail-thumb" src="${th}" alt="" />` : ''}<b>${selected + 1}. ${shortName(p)}${marks(q)}</b> ${!p.released ? `<span class="tag legacy">${t('legacyTag')}</span>` : ''} ${st?.estimate ? `<span class="tag est">${t('estimateTag')}</span>` : ''} ${p.lift && p.lift.n > LIFT_TESTED ? `<span class="tag est">${t('untestedTag')}</span>` : ''}
    <div class="small muted">${layout.strands.length > 1 ? strandLabel(q.strand) + ' · ' : ''}${p.family !== 'adapter' ? famLabel(p.family) : ''} · ${sysLabel(p.system)}${p.rimIn != null ? ` · ${t('rim')} ${p.rimIn}→${p.rimOut}` : ''} · ${t('level')} ${q.S}${ad.length ? ` · ${ad.length}× ${partName(ad[0].part)}` : ''}</div>
    ${st && p.family !== 'start' ? `<div class="small">${t('speed')}: ${Math.round(st.vIn)} → ${Math.round(st.vOut)} mm/s${st.vCrest != null ? ` (${t('crest')} ${Math.round(st.vCrest)})` : ''}</div>` : ''}
    ${pick(p.note, p.noteEn) ? `<div class="small muted" style="margin-top:4px">${pick(p.note, p.noteEn)}</div>` : ''}
    ${p.lift ? `<div class="small" style="margin-top:4px">${tf('liftKit', { m: p.lift.n - 1, s: p.lift.n + 1, p: p.lift.pins })}</div>` : ''}
    ${!p.lift && p.kit ? `<div class="small" style="margin-top:4px">${tf('flipflopKit', { list: p.kit.map((k) => `${k.n}× ${shortName(catalog.byId.get(k.id) ?? p)}`).join(', ') })}</div>` : ''}
    ${laneInfo}
    ${detailDims(sel)}
    ${msgs}${issues}
    ${renderSlots(sel)}
    <div class="detail-actions">
      <button id="d-del">${t('delete')}</button>
      ${p.reversible && !flatCurve ? `<button id="d-rev">${t('reverse')}</button>` : ''}
      ${dirBtn}${branchBtns}
      <button id="d-ins">${insertAfter === selected ? t('appendMode') : t('insertAfter')}</button>
      <button id="d-rep" class="${replaceIdx === selected ? 'primary' : ''}">${t('replace')}</button>
    </div>`;
  $('#d-close').addEventListener('click', () => select(null));
  box.querySelectorAll<HTMLButtonElement>('button[data-omit]').forEach((b) => b.addEventListener('click', () => toggleOmit(sel, Number(b.dataset.omit))));
  box.querySelectorAll<HTMLButtonElement>('button[data-tunnel]').forEach((b) => b.addEventListener('click', () => doTunnel(sel, Number(b.dataset.tunnel))));
  box.querySelectorAll<HTMLSelectElement>('select[data-ddim]').forEach((s) => s.addEventListener('change', () => onDetailDim(sel, s.dataset.ddim as DimKey, s.value)));
  box.querySelectorAll<HTMLButtonElement>('button[data-branch]').forEach((b) => b.addEventListener('click', () => startBranch(sel, Number(b.dataset.branch))));
  box.querySelectorAll<HTMLButtonElement>('button[data-goto]').forEach((b) => b.addEventListener('click', () => select(Number(b.dataset.goto))));
  $('#d-del').addEventListener('click', () => removeAt(selected!));
  $('#d-rev')?.addEventListener('click', () => toggleReverse(selected!));
  if (dirOpts && vo) $('#d-dir')?.addEventListener('click', () => { const k = dirOpts.indexOf(vo.opt); swapElement(sel, dirOpts[(k + 1) % dirOpts.length]); });
  $('#d-ins').addEventListener('click', () => { insertAfter = insertAfter === selected ? null : selected; replaceIdx = null; branchFrom = null; renderAll(); if (insertAfter != null) showTabOnMobile('palette'); });
  $('#d-rep').addEventListener('click', () => { replaceIdx = replaceIdx === selected ? null : selected; insertAfter = null; branchFrom = null; renderAll(); if (replaceIdx != null) showTabOnMobile('palette'); });
}
/** Start a branch at a free exit: the parts list shows what fits there; the first part starts the new strand. */
function startBranch(idx: number, port: number) {
  const el = state.elements[idx]; if (!el) return;
  cancelChoice(false);
  branchFrom = { from: el, port }; insertAfter = null; replaceIdx = null;
  renderAll();
  showTabOnMobile('palette');
}
/** 3D view markers: free branch exits (clickable), free lanes and the open end. */
function renderMarkers() {
  const ms: Marker[] = [];
  for (const f of layout.freePorts) {
    if (f.kind === 'branch' && branchFrom && state.elements.indexOf(branchFrom.from) === f.idx && branchFrom.port === f.port) continue;
    ms.push({ key: `${f.idx}:${f.port}`, kind: f.kind, p: f.w.p, n: [f.w.n[0], f.w.n[1]] });
  }
  const a = layout.placed.length && replaceIdx == null && !choice ? attachPoint() : null;
  if (a?.exit && (branchFrom || insertAfter != null || layout.strands.length > 1 || layout.freePorts.length)) ms.push({ key: 'open', kind: 'open', p: a.exit.p, n: [a.exit.n[0], a.exit.n[1]] });
  ms.push(...laneMarkers());
  viewer.setMarkers(ms);
}

// ---------------------------------------------------------------- Connect
/** A connect goal: one or more target ports (cross tunnel: one per variant/side); tail = element appended after the
 *  approach (the cross tunnel itself). */
interface ConnectGoal { key: string; label: string; targets: { t: ConnectTarget; tail?: ChainElement }[]; tunnelOf?: { owner: number; slot: number } }
/** Strand whose end is the displayed open end (the route search starts there); null in branch/choice mode or when
 *  inserting in the middle of a strand. Append mode shows the end of the last strand. */
function connectStrand(): number | null {
  if (branchFrom || choice) return null;
  const i = insertAfter ?? state.elements.length - 1;
  const q = layout.placed[i]; if (!q) return null;
  const st = layout.strands[q.strand];
  return st && st.idxs[st.idxs.length - 1] === i ? q.strand : null;
}
/** Goals for the open end of the strand: closing the loop (main strand; a branch: into the free entry of the first part),
 *  free cross lanes of X-crossings and lanes under 120/95 adapters that are not higher than the open end (the connecting
 *  parts only go downhill). */
function connectTargets(strand = connectStrand() ?? 0): ConnectGoal[] {
  const out: ConnectGoal[] = [];
  if (!layout.placed.length) return out;
  const endI = strandEnd(state.elements, strand), end = layout.placed[endI];
  if (!end || !end.connected || !end.out) return out;
  const zEnd = end.out.p[2] + 0.5;
  const first = layout.placed[0];
  if (!layout.ring && endI > 0 && first?.connected && first.entry) {
    const name = shortName(first.part);
    out.push(strand === 0 ? { key: 'ring', label: tf('connectRing', { name }), targets: [{ t: { kind: 'ring' } }] }
      : { key: 'entry', label: tf('connectEntry', { name }), targets: [{ t: { kind: 'port', p: first.entry.p, n: first.entry.n, rimCode: requiredFeedRim(first.part, first.reversed) ?? undefined } }] });
  }
  for (const f of layout.freePorts) {
    if (f.kind !== 'lane' || f.w.p[2] > zEnd) continue;
    const q = layout.placed[f.idx];
    out.push({ key: `lane:${f.idx}`, label: tf(q.part.merge ? 'connectMerge' : 'connectLane', { n: f.idx + 1, name: shortName(q.part) }),
      targets: [{ t: { kind: 'port', p: f.w.p, n: f.w.n, rimCode: requiredFeedRim(q.part, false) ?? undefined } }] });
  }
  for (const a of layout.adapters) {
    if (!hasTunnelVariant(a.spec.type) || a.z + 5.7 > zEnd) continue;
    const ts = tunnelLaneTargets(a); if (!ts.length) continue;
    const q = layout.placed[a.owner];
    out.push({ key: `tun:${a.owner}:${a.slot}`, label: tf('connectTunnel', { n: a.owner + 1, name: q ? shortName(q.part) : '?', z: a.z }), tunnelOf: { owner: a.owner, slot: a.slot },
      targets: ts.map((x) => ({ t: { kind: 'port', p: x.p, n: x.n, rimCode: x.rim ?? undefined } as ConnectTarget, tail: x.rev ? { part: x.id, reversed: true } : { part: x.id } })) });
  }
  return out;
}
/** Insert a suggestion (plus an optional appended tunnel) into the chain. */
function connectWork(s: ConnectSuggestion, tail?: ChainElement): ChainElement[] {
  const work = applyConnection(state.elements, s);
  if (tail) work.splice(strandEnd(work, s.strand) + 1, 0, { ...tail });
  return work;
}
/** Element to select after applying: the last new part (end of the strand, or the last re-filled run). */
function connectLast(s: ConnectSuggestion, work: ChainElement[]): ChainElement | undefined {
  if (s.edits) return [...work].reverse().find((x) => !state.elements.includes(x));
  return work[strandEnd(work, s.strand)];
}
let connectRun = 0;
function tailName(e: ChainElement): string { const p = catalog.byId.get(e.part); return p ? shortName(p) : e.part; }
function openConnect() {
  const dlg = $('#dlg-connect') as HTMLDialogElement;
  const goals = connectTargets();
  const box = $('#connect-goals'), res = $('#connect-results');
  res.innerHTML = '';
  box.innerHTML = goals.length ? goals.map((g, i) => `<button type="button" class="connect-goal" data-goal="${i}">${esc(g.label)}</button>`).join('') : `<p class="small muted">${t('connectNoTargets')}</p>`;
  box.querySelectorAll<HTMLButtonElement>('button[data-goal]').forEach((b) => b.addEventListener('click', () => {
    box.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    runConnect(goals[Number(b.dataset.goal)]);
  }));
  if (!dlg.open) dlg.showModal();
  if (goals.length === 1) (box.querySelector('button[data-goal]') as HTMLButtonElement | null)?.click();
}
/** Search each target port in turn (yielding so the UI stays responsive); results are validated and sorted by part count. */
async function runConnect(g: ConnectGoal) {
  const run = ++connectRun;
  const res = $('#connect-results');
  res.innerHTML = `<p class="small muted">${t('connectSearching')}</p>`;
  const errs0 = layout.issues.filter((i) => i.level === 'error').length;
  const found: { s: ConnectSuggestion; tail?: ChainElement; key: string }[] = [];
  const maxParts = g.key === 'ring' ? 10 : 8;
  const strand = connectStrand() ?? 0;
  for (const tg of g.targets) {
    await new Promise((r) => setTimeout(r, 0));
    if (run !== connectRun) return;
    // re-fill an earlier straight run (cheap; not with a tunnel, which is appended), then routes from the end - also
    // starting one or two parts earlier
    const sug = [...(tg.tail ? [] : findRunAdjustments(state.elements, tg.t, { strand })),
                 ...findConnections(state.elements, tg.t, { maxParts, max: 4, strand, maxDrop: 2, timeMs: g.targets.length > 1 ? 1500 : 3000 })];
    for (const s of sug) {
      if (tg.tail) {
        // cross tunnel: must replace the adapter and must not add errors
        const work = connectWork(s, tg.tail), L2 = solveChain(work);
        const last = L2.placed[strandEnd(work, s.strand)];
        if (!last?.connected || L2.adapters.some((x) => x.owner === g.tunnelOf!.owner && x.slot === g.tunnelOf!.slot)) continue;
        if (L2.issues.filter((i) => i.level === 'error').length > errs0) continue;
      }
      const key = (s.edits ? 'run:' + s.edits.map((e) => e.at).join() + ':' : `d${s.drop}:`) + s.elements.map((e) => e.part + (e.reversed ? '*' : '')).join(',') + (tg.tail ? '|' + tg.tail.part + (tg.tail.reversed ? '*' : '') : '');
      if (!found.some((f) => f.key === key)) found.push({ s, tail: tg.tail, key });
    }
  }
  if (run !== connectRun) return;
  // fewest parts changed (added + removed) first; at equal cost keep the track as it is (no removal) before re-filling
  found.sort((x, y) => x.s.n + x.s.drop - (y.s.n + y.s.drop) || +!!x.s.edits - +!!y.s.edits || x.s.drop - y.s.drop || x.s.err - y.s.err);
  const top = found.slice(0, 5);
  if (!top.length) { res.innerHTML = `<p class="small">${tf('connectNone', { n: maxParts })}</p>`; return; }
  const head = (f: typeof found[number]) => f.s.edits ? t('connectRun')
    : f.s.drop ? tf('connectPartsDrop', { n: f.s.n + (f.tail ? 1 : 0), k: f.s.drop }) : tf('connectParts', { n: f.s.n + (f.tail ? 1 : 0) });
  res.innerHTML = top.map((f, i) => `<div class="connect-row"><div><b>${esc(head(f))}</b> <span class="small">${esc(f.s.text)}${f.tail ? ' + ' + esc(tailName(f.tail)) : ''}</span></div>` +
    `<button type="button" class="small-btn primary" data-apply="${i}">${t('connectApply')}</button></div>`).join('');
  res.querySelectorAll<HTMLButtonElement>('button[data-apply]').forEach((b) => b.addEventListener('click', () => {
    const f = top[Number(b.dataset.apply)];
    const prevEl = snapshot();
    const work = connectWork(f.s, f.tail);
    const last = f.tail ? work[strandEnd(work, f.s.strand)] : connectLast(f.s, work);
    ($('#dlg-connect') as HTMLDialogElement).close();
    commitElements(work, { select: last ?? null, insertAnchor: null, replaceTarget: null }, prevEl);
    const stops = steps.some((st) => st.status === 'stop');
    toast((f.tail ? tf('connectDoneTunnel', { n: f.s.n, tunnel: tailName(f.tail) }) : f.s.edits ? tf('connectDoneRun', { n: f.s.drop }) : tf('connectDone', { n: f.s.n })) + (stops ? ' ' + t('connectStops') : ''), 6000);
  }));
}

/** Lanes under 120/95 adapters, at the bottom of their slot: for the selected part and for adapters on the level of the
 *  open end (where the track could pass through next). */
function laneMarkers(): Marker[] {
  const out: Marker[] = [];
  const a0 = layout.placed.length && replaceIdx == null && !choice ? attachPoint() : null;
  const zOpen = a0?.exit ? a0.exit.p[2] - 5.7 : null;
  for (const a of layout.adapters) {
    if (!hasTunnelVariant(a.spec.type)) continue;
    const mine = selected === a.owner;
    if (!mine && (zOpen == null || Math.abs(zOpen - a.z) > 0.5)) continue;
    const seen: number[] = [];
    for (const tg of tunnelLaneTargets(a)) {
      if (seen.some((x) => Math.abs(x - tg.pos) < 0.5)) continue;
      seen.push(tg.pos);
      out.push({ key: `lane-${a.owner}-${a.slot}-${Math.round(tg.pos)}`, kind: 'target', p: [tg.mid[0], tg.mid[1], a.z + 0.3], n: [tg.n[0], tg.n[1]], len: 32 + 2 * 24, width: 4 });   // lane centerline (16 mm wide markers would touch at 16 mm spacing)
    }
  }
  return out;
}

/** Adapter slots of the selected part: per level the adapter (or the gap) with "Tunnel" and "Omit" buttons. */
function renderSlots(sel: number): string {
  const q = layout.placed[sel];
  if (!q.part.adapter || q.S <= 0 || !q.connected) return '';
  const n = Math.round(q.S / LEVEL); if (Math.abs(n * LEVEL - q.S) > 0.01) return '';
  const rows: string[] = [];
  for (let k = n - 1; k >= 0; k--) {
    const z = k * LEVEL;
    const a = layout.adapters.find((x) => x.owner === sel && x.slot === k);
    const o = layout.omitted.find((x) => x.owner === sel && x.slot === k);
    if (a) {
      const tun = tunnelAuto(state.elements, layout, a, (els) => solveChain(els));
      rows.push(`<div class="slot"><span class="slot-z">${z}</span><span class="slot-name">${partName(a.part)}</span>` +
        `<button data-tunnel="${k}" class="small-btn" ${tun.ok ? '' : 'disabled'} title="${esc(tun.text)}">${t('btnTunnel')}</button>` +
        `<button data-omit="${k}" class="small-btn">${t('btnOmit')}</button></div>` +
        // why the tunnel does (not) work, visible without hover (mobile): preview of the swap or the reason
        `<div class="slot-why small muted">${tun.ok ? '→ ' : '✕ '}${esc(tun.text)}</div>` +
        // nothing crosses yet: show where a cross tunnel would have its lanes
        (!tun.ok && tun.code === 'nothing' ? `<div class="slot-why small muted">${esc(tf('tunnelLanesHint', { xs: laneList(a) }))}</div>` : ''));
    } else if (o) {
      rows.push(`<div class="slot omitted"><span class="slot-z">${z}</span><span class="slot-name muted">${partName(catalog.byId.get(o.type)!)} · ${t('slotOmitted')}${o.held ? '' : ' ⚠'}</span>` +
        `<button data-omit="${k}" class="small-btn">${t('btnRestore')}</button></div>`);
    } else {
      // carrier part in the chain (cross tunnel) or an adapter shared with another part
      const carrier = layout.placed.find((c) => c.idx !== sel && c.connected && Math.abs(c.S - z) < 0.01 && c.part.id.startsWith('AdapterTunnel') && c.pieces.some((pc) => q.pieces.length && piecesTouch(pc, q)));
      rows.push(`<div class="slot"><span class="slot-z">${z}</span><span class="slot-name muted">${carrier ? `${carrier.idx + 1}. ${partName(carrier.part)}` : '–'}</span></div>`);
    }
  }
  return `<div class="slots"><div class="small muted">${t('adapterSlots')}</div>${rows.join('')}</div>`;
}
function laneList(a: PlacedAdapter): string { return [...new Set(tunnelLaneTargets(a).map((x) => Math.round(x.pos * 10) / 10))].sort((x, y) => x - y).map((x) => (Number.isInteger(x) ? String(x) : num(x))).join(' / '); }
function piecesTouch(pc: { poly: [number, number][] }, q: Placed): boolean {
  // rough proximity: the piece's centroid lies within the part's footprint AABB
  const cx = pc.poly.reduce((s, v) => s + v[0], 0) / pc.poly.length, cy = pc.poly.reduce((s, v) => s + v[1], 0) / pc.poly.length;
  return cx >= q.aabb.min[0] - 1 && cx <= q.aabb.max[0] + 1 && cy >= q.aabb.min[1] - 1 && cy <= q.aabb.max[1] + 1;
}
function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function toggleOmit(i: number, slot: number) {
  const old = state.elements[i]; if (!old) return;
  const prevEl = snapshot();
  const work = state.elements.slice();
  const set = new Set(old.omit ?? []);
  if (set.has(slot)) set.delete(slot); else set.add(slot);
  const el: ChainElement = { part: old.part };
  if (old.reversed) el.reversed = true;
  if (old.lane) el.lane = old.lane;
  if (set.size) el.omit = [...set].sort((a, b) => a - b);
  applyReplace(work, i, el);
  const anchored = anchorEl(), rep = replaceEl();
  commitElements(work, { select: el, insertAnchor: anchored === old ? el : anchored, replaceTarget: rep === old ? el : rep }, prevEl);
}
function doTunnel(i: number, slot: number) {
  const a = layout.adapters.find((x) => x.owner === i && x.slot === slot); if (!a) return;
  const r = tunnelAuto(state.elements, layout, a, (els) => solveChain(els));
  if (!r.ok) { toast(r.text, 6000); return; }
  const prevEl = snapshot();
  const owner = state.elements[i];
  commitElements(r.elements, { select: owner, insertAnchor: null, replaceTarget: null }, prevEl);
  toast(r.text, 6000);
}

function renderIssues() {
  const ul = $('#issues-list'); ul.innerHTML = '';
  const all = [...layout.issues];
  for (const e of viewer.meshErrors) all.push({ level: 'error', code: 'mesh', idx: [], text: t('meshError') + ': ' + e });
  for (const s of steps) if (s.status !== 'ok' && s.msgs.length) all.push({ level: s.status === 'warn' ? 'warn' : 'error', code: 'physics', idx: [s.idx], text: `${s.idx + 1}. ${shortName(layout.placed[s.idx].part)}: ${s.msgs.join(' – ')}` });
  { const nr = nearRing(layout); if (nr) all.push({ level: 'info', code: 'nearRing', idx: [mainEnd(state.elements)], text: tf('nearRing', { dx: num(nr.dx), dy: num(nr.dy) }) }); }
  if (!all.length) { ul.innerHTML = `<li class="ok">${t('noIssues')}</li>`; return; }
  for (const is of all) {
    const li = document.createElement('li'); li.className = is.level; li.textContent = is.text;
    if (is.idx.length) li.addEventListener('click', () => { select(is.idx[0]); showTabOnMobile('viewport'); });
    ul.appendChild(li);
  }
}

function renderStats() {
  const dl = $('#stats');
  const rows = bom(layout);
  const g = rows.reduce((s, r) => s + r.grams, 0), h = rows.reduce((s, r) => s + r.hours, 0);
  const b = layout.bounds;
  const levels = [...new Set(layout.placed.filter((q) => q.connected).map((q) => q.S))].sort((a, c) => a - c);
  const last = steps.length ? steps[steps.length - 1] : null;
  const items: [string, string][] = [
    [t('trackParts'), String(layout.placed.length)], [t('adapterParts'), String(layout.adapters.length)],
    [t('famPin'), `${layout.pins.reduce((s, j) => s + j.n, 0)} <small class="muted">(${tf('pinsHint', { f: sumPins('joint'), t: sumPins('tower'), r: sumPins('row') })})</small>`],
    [t('levels'), levels.length ? levels.join(' / ') : '–'], [t('height'), `${Math.round(layout.height)} mm`],
    [t('footprint'), b ? `${Math.round(b.max[0] - b.min[0])} × ${Math.round(b.max[1] - b.min[1])} mm` : '–'],
    [t('drop'), `${Math.round(layout.drop)} mm`], [t('length'), `${(layout.length / 1000).toFixed(2)} m`],
    [t('filament'), `${(g / 1000).toFixed(2)} kg`], [t('printTime'), `${Math.round(h)} h`],
  ];
  if (last && layout.placed.length > 1) {
    items.push([t('ballEnd'), `${Math.round(last.vIn)} mm/s · ${t('status' + cap(worstStatus(steps)))}`]);
    { const e = ballEnergy(last.vIn, state.sim.mass, layout.placed[last.idx].part.phys.k); items.push([t('energyEnd'), `${e.toFixed(e < 1 ? 2 : 1)} mJ`]); }
  }
  dl.innerHTML = items.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}
function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
function sumPins(kind: 'joint' | 'tower' | 'row'): number { return layout.pins.filter((j) => j.kind === kind).reduce((s, j) => s + j.n, 0); }

function renderBom() {
  const rows = bom(layout);
  const tbl = $('#bom');
  if (!rows.length) { tbl.innerHTML = ''; return; }
  const g = rows.reduce((s, r) => s + r.grams, 0), h = rows.reduce((s, r) => s + r.hours, 0), n = rows.reduce((s, r) => s + r.count, 0);
  tbl.innerHTML = `<thead><tr><th></th><th class="r">${t('count')}</th><th class="r">${t('grams')}</th><th class="r">${t('hours')}</th></tr></thead><tbody>` +
    rows.map((r) => `<tr class="${r.kind}"><td>${partName(catalog.byId.get(r.id) ?? { id: r.id })}</td><td class="r">${r.count}</td><td class="r">${r.grams.toFixed(0)}</td><td class="r">${r.hours.toFixed(1)}</td></tr>`).join('') +
    `</tbody><tfoot><tr><td>Σ</td><td class="r">${n}</td><td class="r">${g.toFixed(0)}</td><td class="r">${h.toFixed(0)}</td></tr></tfoot>`;
}

let maxHours = 8;
try { const v = Number(localStorage.getItem('kb16-maxhours')); if (v >= 2 && v <= 16) maxHours = v; } catch { /* ignore */ }
let plan: PlatePlan | null = null;
function renderPlates() {
  plan = layout.placed.length ? planPlates(layout, maxHours) : null;
  const sum = $('#plates-summary'), list = $('#plates-list');
  if (!plan || !plan.plates.length) { sum.innerHTML = ''; list.innerHTML = ''; return; }
  const h = plan.plates.reduce((s, p) => s + p.hours, 0), g = plan.plates.reduce((s, p) => s + p.grams, 0);
  sum.innerHTML = `<div class="small"><b>${tf('platesTotal', { n: plan.plates.length, h: Math.round(h), kg: (g / 1000).toFixed(2) })}</b></div>`;
  list.innerHTML = '';
  for (const [lvl, ps] of [...plan.byLevel.entries()].sort((a, b) => a[0] - b[0])) {
    const sec = document.createElement('div'); sec.className = 'plate-level';
    const lh = ps.reduce((s, p) => s + p.hours, 0);
    sec.innerHTML = `<div class="plate-head"><b>${t('level')} ${lvl}</b> <span class="muted small">${ps.length} × · ${Math.round(lh)} h</span> ${__DEV_UI__ ? `<button class="small-btn" data-level="${lvl}">${tf('threeMfLevel', { l: lvl })}</button>` : ''}</div>`;
    for (const p of ps) {
      const row = document.createElement('div'); row.className = 'plate-row';
      const seen = new Set<string>();
      const cells = p.jobs.map((j) => {
        if (j.key.startsWith('s')) return '';   // pins are shown as one summary entry
        const idx = Number(j.key.slice(1).split('-')[0]);
        const tag = j.key.startsWith('a') ? ` <i>(${idx + 1})</i>` : ` <i>#${j.order + 1}</i>`;
        seen.add(j.key);
        return `<span class="plate-part" data-idx="${idx}">${partName(j.part)}${tag}</span>`;
      }).join('');
      const nPins = p.jobs.filter((j) => j.key.startsWith('s')).length;
      row.innerHTML = `<span class="plate-idx">${p.color ? `<i class="plate-color" style="background:${keyCss(p.color)}" title="${tf('plateColor', { c: keyLabel(p.color, getLang()) })}"></i>` : ''}${p.index}</span><span class="plate-time">${p.hours.toFixed(1)} h · ${Math.round(p.grams)} g</span><span class="plate-parts">${cells}${nPins ? `<span class="plate-part pin">${t('famPin')} ×${nPins}</span>` : ''}</span>`;
      sec.appendChild(row);
    }
    list.appendChild(sec);
  }
  if (plan.tooBig.length) { const w = document.createElement('div'); w.className = 'msg warn'; w.textContent = t('tooBig') + ': ' + plan.tooBig.map((j) => j.label).join(', '); list.appendChild(w); }
  list.querySelectorAll<HTMLButtonElement>('button[data-level]').forEach((b) => b.addEventListener('click', () => needKey(() => void exportThreeMf(Number(b.dataset.level)))));
  list.querySelectorAll<HTMLElement>('.plate-part').forEach((el) => el.addEventListener('click', () => { select(Number(el.dataset.idx)); showTabOnMobile('viewport'); }));
}
async function exportThreeMf(level: number | null) {
  const plates: Plate[] = !plan ? [] : level == null ? plan.plates : (plan.byLevel.get(level) ?? []);
  if (!plates.length) { toast(t('nothingToExport')); return; }
  toast(t('generating'), 60000);
  try {
    const ed = isJapandi() ? ' Japandi' : '';
    const title = level == null ? tf('threeMfTitleAll', { ed }) : tf('threeMfTitleLevel', { l: level, ed });
    const name = level == null ? exportName('3mfAll') : exportName('3mfLevel', level);   // before awaiting: use the edition at export start
    const res = await buildThreeMf(plates, title, (msg) => { $('#toast').textContent = t('generating') + ' ' + msg; }, keyMetadata(keyOk() ? mwKey : null));
    download(name, res.blob, 'model/3mf');
    if (res.previewQuality.length) toast(tf('previewMeshNote', { list: res.previewQuality.slice(0, 5).join(', ') + (res.previewQuality.length > 5 ? ' …' : '') }), 12000);
    else toast(`${res.plates} ${t('plates')} ✓`);
  } catch (e) { toast('3MF: ' + (e instanceof Error ? e.message : String(e))); }
}
// ---------------------------------------------------------------- One-piece printing
/** Placement of the track on the plate (fused parts, plate position including lift/flip-flop; null: no track). */
let curFit: PlatePlace | null = null;
let curPlan: AsmPlan | null = null;
function updateCurFit() {
  curPlan = layout.placed.length ? planAssembly(layout, printerOf(plateCfg)) : null;
  curFit = curPlan?.fit ?? null;
}
function overList(fit: PlateFit): string {
  const r = (v: number) => Math.ceil(v);
  return [fit.over[0] > 1e-6 ? tf('overX', { v: r(fit.over[0]) }) : '', fit.over[1] > 1e-6 ? tf('overY', { v: r(fit.over[1]) }) : '', fit.over[2] > 1e-6 ? tf('overZ', { v: r(fit.over[2]) }) : '']
    .filter(Boolean).join(', ');
}
const keyOk = () => keyValid(mwKey);
/** Exports unlocked: dev build, valid MakerWorld profile or test mode (7 logo taps). */
const unlocked = () => __DEV_UI__ || keyOk() || testUnlock;
const curEd = (): Ed => (isJapandi() ? 'japandi' : 'plain');
/** Exports work when unlocked AND the print meshes of the active edition were loaded from a profile 3MF in this session. */
const exportReady = () => unlocked() && hasProfile(curEd());
/** Run an export if ready; otherwise open the profile dialog showing what is missing (key and/or print meshes). */
function needKey(run: () => void) {
  if (exportReady()) { run(); return; }
  pendingExport = run;
  const other: Ed = curEd() === 'japandi' ? 'plain' : 'japandi';
  if (unlocked() && hasProfile(other)) openKeyDialog(t(other === 'plain' ? 'meshOtherPlain' : 'meshOtherJapandi'), 'bad');
  else if (unlocked()) openKeyDialog(t('meshAgain'));
  else openKeyDialog();
}
function openKeyDialog(msg = '', cls = '') {
  const dlg = $('#dlg-key') as HTMLDialogElement;
  const m = $('#key-msg'); m.textContent = msg; m.className = 'small ' + cls;
  $('#key-page').innerHTML = MW_RULES.pageUrl ? `<a href="${MW_RULES.pageUrl}" target="_blank" rel="noopener">${t('keyPage')}</a>` : '';
  // profile of the other edition loaded: offer "Export plain" / "Export Japandi" (switches the edition, then exports)
  const other: Ed = curEd() === 'japandi' ? 'plain' : 'japandi';
  const sw = $('#key-switch') as HTMLButtonElement;
  sw.hidden = !(pendingExport && unlocked() && hasProfile(other) && !hasProfile(curEd()));
  sw.textContent = t(other === 'plain' ? 'meshSwitchPlain' : 'meshSwitchJapandi');
  if (!dlg.open) dlg.showModal();
}
/** Check a profile file: key (MakerWorld key, persisted) and print meshes (kept in memory for this session only). */
async function handleKeyFile(file: File) {
  openKeyDialog(t('keyChecking'));
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await file.arrayBuffer()); } catch { openKeyDialog(t('key_notZip'), 'bad'); return; }
  let res: KeyResult;
  try { res = checkMakerWorld3mf(bytes, file.name, KNOWN_NAMES); }
  catch { res = { ok: false as const, reason: 'notZip' as const }; }
  if (res.ok) { mwKey = res.key; saveKey(mwKey); }
  // a file without a MakerWorld key (e.g. the profile re-saved in Bambu Studio) is accepted only if exports are already
  // unlocked (stored profile, test mode, dev build); other failures (other designer, other model, outdated) are rejected
  if (!res.ok && (res.reason !== 'notMakerWorld' || !unlocked())) { openKeyDialog(tf('key_' + res.reason, { d: res.detail ?? '' }), 'bad'); return; }
  const scan = registerProfile(bytes, file.name);
  renderOnePiece();
  if (!scan.ok) {
    const k = scan.reason === 'notZip' || scan.reason === 'notThreeMf' ? 'key_' + scan.reason : 'mesh_' + scan.reason;
    openKeyDialog(tf(k, { d: scan.detail ?? '' }), 'bad'); return;
  }
  const p = scan.profile;
  const msg = tf('meshOk', { ed: t(p.edition === 'japandi' ? 'edJapandi' : 'edPlain'), n: p.parts });
  if (p.edition !== curEd()) {
    // edition differs from the selected one: say so and offer to switch (dialog stays open)
    if (pendingExport) { openKeyDialog(msg + ' ' + t(p.edition === 'plain' ? 'meshOtherPlain' : 'meshOtherJapandi'), 'bad'); return; }
    ($('#dlg-key') as HTMLDialogElement).close();
    toast(msg + ' ' + t(p.edition === 'plain' ? 'meshOtherPlain' : 'meshOtherJapandi'), 7000);
    return;
  }
  ($('#dlg-key') as HTMLDialogElement).close();
  toast(msg, 4000);
  const run = pendingExport; pendingExport = null;
  if (run) run();
}
const KNOWN_NAMES = new Set(catalog.parts.map((p) => p.nameEn).filter(Boolean));

function renderOnePiece() {
  const pr = printerOf(plateCfg);
  const sel = $('#sel-printer') as HTMLSelectElement;
  const opts = [...PRINTERS.map((p) => [p.id, `${p.name} · ${p.x} × ${p.y} × ${p.z}`]), ['custom', t('printerCustom')]];
  if (sel.options.length !== opts.length || sel.options[sel.options.length - 1].text !== t('printerCustom')) sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  sel.value = plateCfg.printer;
  ($('#chk-plate') as HTMLInputElement).checked = plateCfg.on;
  const cust = $('#plate-custom'); cust.hidden = plateCfg.printer !== 'custom';
  (['px', 'py', 'pz'] as const).forEach((k, i) => { const el = $('#inp-' + k) as HTMLInputElement; if (document.activeElement !== el) el.value = String(plateCfg.custom[i]); });
  const st = $('#op-status');
  const plan = curPlan;
  if (!plan || !curFit) {
    st.innerHTML = `<div class="muted">${t('onePieceEmpty')}</div>`;
    viewer.setPlate(null);
  } else {
    const r = (v: number) => Math.round(v);
    const lines: string[] = [];
    lines.push(curFit.fits
      ? `<div class="ok">${tf('plateFits', { name: pr.name, x: r(curFit.size[0]), y: r(curFit.size[1]), z: r(curFit.size[2]), rot: curFit.rot90 ? t('plateRot') : '' })}</div>`
      : `<div class="bad">${tf('plateOver', { name: pr.name, x: pr.x, y: pr.y, z: pr.z, list: overList(curFit) })}</div><div class="muted">${t('plateFix')}</div>`);
    const loose = layout.placed.filter((q) => q.connected && isLoose(q.part));
    if (loose.length) {
      const list = loose.map((q) => `${q.idx + 1}. ${shortName(q.part)}`).join(', ');
      lines.push(`<div>${tf('looseInfo', { list, p: plan.pins })}</div>`);
      // do the loose lift/flip-flop parts fit on the plate too, or do they stick out?
      if (plateCfg.on && curFit.fits && !curFit.whole) lines.push(`<div class="muted">${tf('plateLooseOut', { list })}</div>`);
    }
    if (plan.raised) lines.push(`<div>${t('supportsInfo')}</div>`);
    lines.push(`<div class="muted">${tf('onePieceEst', { g: Math.round(plan.grams), h: plan.hours.toFixed(1) })}</div>`);
    st.innerHTML = lines.join('');
    // plate in the 3D view: under the fused piece, shifted so lift/flip-flop parts fit on it too when there is room, and
    // rotated like the piece. The 3MF places the piece on the plate the same way.
    if (plateCfg.on) viewer.setPlate({ cx: curFit.cx, cy: curFit.cy, w: curFit.w, d: curFit.d, h: pr.z, ok: curFit.fits });
    else viewer.setPlate(null);
  }
  ($('#btn-3mf-one') as HTMLButtonElement).disabled = !plan;
  const lockTag = exportReady() ? '' : ' 🔒';
  $('#btn-3mf-one').textContent = t('threeMfOne') + lockTag;
  $('#btn-3mf-all').textContent = t('threeMfAll') + lockTag;
  const ms = $('#mw-status');
  if (keyOk() && mwKey) ms.innerHTML = `<span>${tf('keyState', { t: esc(mwKey.profileTitle || mwKey.title), d: (mwKey.stamp || mwKey.verified).slice(0, 10) })}</span><button type="button" class="small-btn" id="mw-remove">${t('keyRemove')}</button>`;
  else if (testUnlock && !__DEV_UI__) ms.innerHTML = `<span class="test">${t('keyTest')}</span><button type="button" class="small-btn" id="mw-add">${t('keyAdd')}</button>`;
  else if (__DEV_UI__) ms.innerHTML = `<span class="lock">${t('keyDev')}</span><button type="button" class="small-btn" id="mw-add">${t('keyAdd')}</button>`;
  else ms.innerHTML = `<span class="lock">${t('keyNone')}</span><button type="button" class="small-btn" id="mw-add">${t('keyAdd')}</button>`;
  // print meshes loaded from a profile 3MF in this session (per edition)
  const eds = (['japandi', 'plain'] as Ed[]).filter((e) => hasProfile(e));
  const meshLine = document.createElement('div'); meshLine.className = 'mesh-state';
  if (eds.length) meshLine.textContent = tf('meshState', { list: eds.map((e) => `${t(e === 'japandi' ? 'edJapandi' : 'edPlain')} (${getProfile(e)!.parts}) ✓`).join(' · ') });
  else { meshLine.textContent = t('meshNone'); meshLine.classList.add('lock'); }
  if (unlocked() || eds.length) ms.appendChild(meshLine);
  if (eds.length && !ms.querySelector('#mw-remove')) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'small-btn'; b.id = 'mw-remove'; b.textContent = t('keyRemove'); meshLine.appendChild(b);
  }
  ms.querySelector('#mw-remove')?.addEventListener('click', () => { mwKey = null; saveKey(null); clearProfiles(); renderOnePiece(); });
  ms.querySelector('#mw-add')?.addEventListener('click', () => openKeyDialog());
}
function setPlateCfg(next: PlateSettings) {
  plateCfg = sanitizePlate(next); savePlate(plateCfg);
  renderAll();
  if (plateCfg.on) showTabOnMobile('viewport');
}
async function exportOnePiece() {
  const plan = curPlan;
  if (!plan) { toast(t('nothingToExport')); return; }
  toast(t('generating'), 60000);
  try {
    const ed = isJapandi() ? ' Japandi' : '';
    const title = tf('threeMfTitleOne', { ed });
    const name = exportName('3mfOne');   // before awaiting: use the edition at export start
    const res = await buildAssemblyThreeMf(plan, { title, objectName: title, meta: keyMetadata(keyOk() ? mwKey : null) }, (msg) => { $('#toast').textContent = t('generating') + ' ' + msg; });
    download(name, res.blob, 'model/3mf');
    if (res.previewQuality.length) toast(tf('previewMeshNote', { list: res.previewQuality.slice(0, 5).join(', ') + (res.previewQuality.length > 5 ? ' …' : '') }), 12000);
    else toast(tf('threeMfOneDone', { n: res.parts }));
  } catch (e) { toast('3MF: ' + (e instanceof Error ? e.message : String(e))); }
}

function renderOverlay() {
  const el = $('#overlay-stats');
  if (!layout.placed.length) { el.innerHTML = ''; return; }
  const w = worstStatus(steps);
  el.innerHTML = `${layout.placed.length} + ${layout.adapters.length} · ${Math.round(layout.height)} mm · ${Math.round(layout.drop)} mm ↓<br><span class="dot ${w}"></span>${t('status' + cap(w))}`;
}

function updateButtons() {
  ($('#btn-undo') as HTMLButtonElement).disabled = !history.canUndo;
  ($('#btn-redo') as HTMLButtonElement).disabled = !history.canRedo;
}

// ---------------------------------------------------------------- Actions
function select(idx: number | null) {
  selected = idx != null && layout.placed[idx] ? idx : null;
  viewer.setSelected(selected);
  renderChain(); renderDetail();
  if (selected != null) document.querySelector('#chain-list li.sel')?.scrollIntoView({ block: 'nearest' });
}
/** Commit a new chain, then restore selection and modes from the element objects. */
function commitElements(work: ChainElement[], opts: { select: ChainElement | null; insertAnchor: ChainElement | null; replaceTarget: ChainElement | null }, prevEl: ChainElement[]) {
  state.elements = work;
  const at = (el: ChainElement | null) => { if (!el) return null; const i = work.indexOf(el); return i >= 0 ? i : null; };
  selected = at(opts.select);
  replaceIdx = at(opts.replaceTarget);
  insertAfter = at(opts.insertAnchor);
  recompute(true, prevEl);
}
function snapshot(): ChainElement[] { return cloneChain(state.elements); }
const anchorEl = () => (insertAfter != null ? state.elements[insertAfter] ?? null : null);
const replaceEl = () => (replaceIdx != null ? state.elements[replaceIdx] ?? null : null);

/** Replace element i with another orientation/variant (direction, height, lane, reverse, selects); branches move along,
 *  selection and modes are kept. keepOmit: keep omitted adapter slots (same adapter). endReplace: leave replace mode. */
function swapElement(i: number, o: Orientation, keepOmit = true, endReplace = false) {
  const old = state.elements[i]; if (!old) return;
  const prevEl = snapshot();
  const el: ChainElement = { part: o.part };
  if (o.reversed) el.reversed = true;
  if (o.lane) el.lane = o.lane;
  const po = catalog.byId.get(old.part), pn = catalog.byId.get(o.part);
  if (keepOmit && old.omit && po?.adapter?.type === pn?.adapter?.type) el.omit = old.omit.slice();
  const work = state.elements.slice();
  applyReplace(work, i, el);
  const removed = pruneOrphans(work);
  const anchored = anchorEl(), rep = replaceEl();
  commitElements(work, { select: el, insertAnchor: anchored === old ? el : (anchored && work.includes(anchored) ? anchored : null),
                         replaceTarget: endReplace ? null : rep === old ? el : rep }, prevEl);
  if (removed) toast(tf('branchRemoved', { n: removed }), 5000);
}
function removeAt(i: number) {
  if (!state.elements[i]) return;
  const prevEl = snapshot();
  const work = state.elements.slice();
  const old = work[i];
  work.splice(i, 1);
  // if a branch started here, it now starts at the next part of the same strand
  if (old.branch && work[i] && !work[i].branch) work[i].branch = old.branch;
  const removed = pruneOrphans(work);   // branches from the deleted part are removed too
  // select the successor, otherwise the predecessor
  const mark = work[i] ?? work[i - 1] ?? null;
  const anchored = anchorEl(), rep = replaceEl();
  if (branchFrom && !work.includes(branchFrom.from)) branchFrom = null;
  // anchor on the deleted part -> predecessor (or none); replacing the deleted part -> off
  const anc = anchored === old ? (work[i - 1] ?? null) : anchored;
  commitElements(work, { select: mark && work.includes(mark) ? mark : null, insertAnchor: anc && work.includes(anc) ? anc : null, replaceTarget: rep === old || (rep && !work.includes(rep)) ? null : rep }, prevEl);
  if (removed) toast(tf('branchRemoved', { n: removed }), 5000);
}
function toggleReverse(i: number) {
  const old = state.elements[i]; if (!old) return;
  swapElement(i, { part: old.part, reversed: !old.reversed, lane: old.lane ?? 0, dir: null });
}
function setElements(els: ChainElement[], push = true) {
  const prevEl = snapshot();
  cancelChoice(false);
  state.elements = sanitizeElements(els);
  selected = null; insertAfter = null; replaceIdx = null; branchFrom = null;
  recompute(push, prevEl);
  setTimeout(() => viewer.fit('iso'), 400);
}
let toastTimer = 0;
function toast(msg: string, ms = 2200) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = window.setTimeout(() => el.classList.remove('show'), ms); }
/** Confirmation via a <dialog> (window.confirm is blocked in sandboxed embeds). */
function ask(msg: string): Promise<boolean> {
  return new Promise((resolve) => {
    const dlg = $('#dlg-confirm') as HTMLDialogElement;
    $('#confirm-text').textContent = msg; $('#confirm-input').hidden = true;
    // reset returnValue: Escape closes without setting one, which would otherwise keep the 'ok' of the previous prompt
    dlg.returnValue = '';
    dlg.onclose = () => resolve(dlg.returnValue === 'ok');
    dlg.showModal();
  });
}
/** Show text for manual copying (fallback when the clipboard is unavailable). */
function showCopy(msg: string, text: string) {
  const dlg = $('#dlg-confirm') as HTMLDialogElement;
  $('#confirm-text').textContent = msg;
  const inp = $('#confirm-input') as HTMLInputElement; inp.hidden = false; inp.value = text;
  dlg.onclose = null; dlg.showModal(); inp.select();
}
/** On mobile (tab layout), switch to the given pane. */
function showTabOnMobile(tab: 'palette' | 'viewport' | 'side') {
  if (window.innerWidth > 900) return;
  (document.querySelector(`#tabs button[data-tab=${tab}]`) as HTMLButtonElement | null)?.click();
}

// ---------------------------------------------------------------- UI wiring
$('#btn-new').addEventListener('click', async () => { if (!state.elements.length || await ask(t('confirmNew'))) setElements([]); });
$('#btn-undo').addEventListener('click', () => { const e = history.undo(state.elements); if (e) { cancelChoice(false); state.elements = e; selected = null; insertAfter = null; replaceIdx = null; branchFrom = null; recompute(false); } });
$('#btn-redo').addEventListener('click', () => { const e = history.redo(state.elements); if (e) { cancelChoice(false); state.elements = e; selected = null; insertAfter = null; replaceIdx = null; branchFrom = null; recompute(false); } });
document.addEventListener('keydown', (ev) => {
  const inField = ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement || ev.target instanceof HTMLSelectElement
    || (ev.target instanceof HTMLElement && ev.target.isContentEditable);
  if (inField) return; // text fields and selects keep their own keys
  // no track shortcuts while a dialog is open (Delete would remove the selected part behind it, Ctrl+Z would undo invisibly)
  if (document.querySelector('dialog[open]')) return;
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && !ev.shiftKey) { ev.preventDefault(); $('#btn-undo').click(); }
  else if ((ev.ctrlKey || ev.metaKey) && (ev.key.toLowerCase() === 'y' || (ev.key.toLowerCase() === 'z' && ev.shiftKey))) { ev.preventDefault(); $('#btn-redo').click(); }
  else if ((ev.key === 'Delete' || ev.key === 'Backspace') && selected != null) { ev.preventDefault(); removeAt(selected); }
  else if (ev.key === 'Escape' && choice) cancelChoice();
  else if (choice && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) {
    ev.preventDefault();
    const d = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'straight', ArrowDown: 'back' } as Record<string, Dir>)[ev.key];
    const c = choice.cands.find((x) => x.o.dir === d); if (c) chooseKey(c.key);
  }
  else if (ev.key === 'Escape' && (replaceIdx != null || insertAfter != null || branchFrom)) { replaceIdx = null; insertAfter = null; branchFrom = null; renderAll(); }
});
for (const dd of document.querySelectorAll<HTMLElement>('.dropdown')) {
  dd.querySelector(':scope > button')!.addEventListener('click', (e) => { e.stopPropagation(); document.querySelectorAll('.dropdown.open').forEach((o) => o !== dd && o.classList.remove('open')); dd.classList.toggle('open'); });
}
document.addEventListener('click', () => document.querySelectorAll('.dropdown.open').forEach((o) => o.classList.remove('open')));
const demos = (demosJson as { demos: { id: string; name: Record<Lang, string>; chain: ChainElement[] }[] }).demos;
function fillDemoMenu() {
  const m = $('#menu-demo'); m.innerHTML = '';
  for (const d of demos) { const b = document.createElement('button'); b.textContent = d.name[getLang()]; b.addEventListener('click', () => setElements(JSON.parse(JSON.stringify(d.chain)))); m.appendChild(b); }
}
$('#btn-share').addEventListener('click', async () => {
  const url = shareUrl(state.elements, state.japandi, state.colors);
  try { await navigator.clipboard.writeText(url); toast(t('linkCopied')); } catch { showCopy(t('shareFallback'), url); }
});
$('#btn-save').addEventListener('click', () => { download(exportName('json'), trackJson(state.elements, layout, state.sim), 'application/json'); });
$('#btn-load').addEventListener('click', () => ($('#file-load') as HTMLInputElement).click());
$('#file-load').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (!Array.isArray(j.chain)) throw new Error('chain');
    const els = sanitizeElements(j.chain);
    const skipped = j.chain.length - els.length;
    if (j.colors) applyColorState(sanitizeColors(j.colors), false);
    // ball check settings (initial push, rolling resistance, ball mass)
    if (j.sim && typeof j.sim === 'object') { state.sim = sanitizeSim(j.sim); rngV0.value = String(state.sim.v0); rngCrr.value = String(state.sim.crr); showSim(); }
    if (j.edition === 'japandi' || j.edition === 'plain') setJapandi(j.edition === 'japandi');
    setElements(els);
    if (skipped) toast(tf('loadSkipped', { n: skipped }));
  } catch { toast(t('loadFailed')); }
  (e.target as HTMLInputElement).value = '';
});
$('#btn-bomcsv').addEventListener('click', () => { download(exportName('csv'), bomCsv(bom(layout)), 'text/csv'); });
for (const id of ['#btn-mwlist', '#btn-mwlist2']) $(id).addEventListener('click', () => { download(exportName('mw'), makerworldList(bom(layout)), 'text/markdown'); });
$('#btn-help').addEventListener('click', () => ($('#dlg-help') as HTMLDialogElement).showModal());
$('#btn-lang').addEventListener('click', () => { setLang(getLang() === 'de' ? 'en' : 'de'); fillDemoMenu(); applyLang(); });
($('#search') as HTMLInputElement).addEventListener('input', (e) => { search = (e.target as HTMLInputElement).value; renderPalette(); });
$('#chk-compatible').addEventListener('change', (e) => { compatibleOnly = (e.target as HTMLInputElement).checked; renderPalette(); });
$('#chk-reverse').addEventListener('change', (e) => { showUphill = (e.target as HTMLInputElement).checked; renderPalette(); renderDetail(); });
($('#chk-legacy') as HTMLInputElement).checked = state.showLegacy;
$('#chk-legacy').addEventListener('change', (e) => { state.showLegacy = (e.target as HTMLInputElement).checked; saveState(state); renderPalette(); });
$('#btn-fit').addEventListener('click', () => viewer.fit('iso'));
$('#btn-top').addEventListener('click', () => viewer.fit('top'));
$('#btn-iso').addEventListener('click', () => viewer.fit('iso'));
$('#chk-adapters').addEventListener('change', (e) => viewer.setShowAdapters((e.target as HTMLInputElement).checked));
$('#chk-path').addEventListener('change', (e) => viewer.setShowPath((e.target as HTMLInputElement).checked));
$('#chk-speed').addEventListener('change', (e) => viewer.setColorMode((e.target as HTMLInputElement).checked ? 'speed' : 'family'));
const rngV0 = $('#rng-v0') as HTMLInputElement, rngCrr = $('#rng-crr') as HTMLInputElement;
rngV0.value = String(state.sim.v0); rngCrr.value = String(state.sim.crr);
const inpMass = $('#inp-mass') as HTMLInputElement;
const showSim = () => {
  $('#out-v0').textContent = `${state.sim.v0} mm/s`; $('#out-crr').textContent = state.sim.crr.toFixed(3);
  inpMass.value = String(state.sim.mass ?? DEFAULT_SIM.mass); $('#out-mass').textContent = `${state.sim.mass ?? DEFAULT_SIM.mass} g`; inpMass.title = t('ballNote');
};
inpMass.addEventListener('input', () => {
  const v = Math.round(Number(inpMass.value) * 10) / 10;
  if (Number.isFinite(v) && v >= MASS_RANGE[0] && v <= MASS_RANGE[1]) { state.sim.mass = v; $('#out-mass').textContent = `${v} g`; resimulate(); }
});
rngV0.addEventListener('input', () => { state.sim.v0 = Number(rngV0.value); showSim(); resimulate(); });
rngCrr.addEventListener('input', () => { state.sim.crr = Number(rngCrr.value); showSim(); resimulate(); });
showSim();
const rngHours = $('#rng-hours') as HTMLInputElement;
rngHours.value = String(maxHours);
const showHours = () => { $('#out-hours').textContent = `${maxHours} h`; };
rngHours.addEventListener('input', () => { maxHours = Number(rngHours.value); showHours(); try { localStorage.setItem('kb16-maxhours', String(maxHours)); } catch { /* ignore */ } renderPlates(); });
showHours();
$('#btn-plan-md').addEventListener('click', () => { if (plan) download(exportName('plan'), planMarkdown(plan, tf('planTitle', { ed: isJapandi() ? ' Japandi' : '' })), 'text/markdown'); });
// Colors: pick a preset or a custom color per group
$('#sel-colors').addEventListener('change', (e) => {
  const v = (e.target as HTMLSelectElement).value, cur = getColors();
  if (v === 'family') applyColorState({ ...cur, mode: 'family' });
  else if (v === 'custom') applyColorState({ ...cur, mode: 'filament', preset: null });
  else { const p = COLOR_PRESETS.find((x) => x.id === v); if (p) applyColorState(presetState(p)); }
});
for (const g of COLOR_GROUPS) $('#sw-' + g).addEventListener('click', () => openPicker(pickG === g ? null : g));
$('#fil-close').addEventListener('click', () => { const g = pickG; openPicker(null); if (g) $('#sw-' + g).focus(); });
$('#fil-panel').addEventListener('keydown', (e) => { if (e.key === 'Escape') { const g = pickG; openPicker(null); if (g) $('#sw-' + g).focus(); } });
$('#fil-type').addEventListener('change', (e) => { pickType = (e.target as HTMLSelectElement).value; renderFilPanel(); });
$('#fil-search').addEventListener('input', () => renderFilPanel());
$('#fil-grid').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.fil'); if (!b || !pickG) return;
  applyColorState(withFilament(getColors(), pickG, b.dataset.code!));
  $('#fil-grid').querySelector<HTMLElement>(`.fil[data-code="${b.dataset.code}"]`)?.focus();
});
$('#fil-own').addEventListener('input', (e) => { if (pickG) applyColorState(withOwnColor(getColors(), pickG, (e.target as HTMLInputElement).value)); });
// Japandi style: edition (meshes, weight, print profile) and look of the whole app
const chkJ = $('#chk-japandi') as HTMLInputElement;
chkJ.checked = state.japandi;
chkJ.addEventListener('change', () => setJapandi(chkJ.checked));
$('#btn-3mf-all').addEventListener('click', () => needKey(() => void exportThreeMf(null)));
$('#btn-3mf-one').addEventListener('click', () => needKey(() => void exportOnePiece()));
// Test mode: 7 quick taps on the logo lift the profile requirement; another 7 restore it.
const logoTap = tapCounter();
$('.brand').addEventListener('click', () => {
  if (!logoTap(performance.now())) return;
  testUnlock = !testUnlock; saveTestUnlock(testUnlock);
  toast(t(testUnlock ? 'testOn' : 'testOff'), 4000);
  renderOnePiece();
});
// One-piece printing: plate mode, printer, custom size; MakerWorld profile via dialog, file picker or drag and drop
$('#chk-plate').addEventListener('change', (e) => setPlateCfg({ ...plateCfg, on: (e.target as HTMLInputElement).checked }));
$('#sel-printer').addEventListener('change', (e) => setPlateCfg({ ...plateCfg, printer: (e.target as HTMLSelectElement).value }));
(['px', 'py', 'pz'] as const).forEach((k, i) => $('#inp-' + k).addEventListener('change', (e) => {
  const c = [...plateCfg.custom] as [number, number, number]; c[i] = Number((e.target as HTMLInputElement).value); setPlateCfg({ ...plateCfg, custom: c });
}));
const fileKey = $('#file-key') as HTMLInputElement;
$('#key-drop').addEventListener('click', () => fileKey.click());
$('#key-drop').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileKey.click(); } });
fileKey.addEventListener('change', () => { const f = fileKey.files?.[0]; if (f) void handleKeyFile(f); fileKey.value = ''; });
($('#dlg-key') as HTMLDialogElement).addEventListener('close', () => { pendingExport = null; });
$('#key-switch').addEventListener('click', () => {
  const run = pendingExport; const toJ = !isJapandi();
  pendingExport = null; ($('#dlg-key') as HTMLDialogElement).close();
  setJapandi(toJ);
  toast(t(toJ ? 'meshSwitchedJ' : 'meshSwitched'), 3000);
  if (run && exportReady()) run();
});
const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
document.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); $('#key-drop').classList.add('over'); } });
document.addEventListener('dragleave', () => $('#key-drop').classList.remove('over'));
document.addEventListener('drop', (e) => {
  $('#key-drop').classList.remove('over');
  const f = e.dataTransfer?.files?.[0];
  if (!f || !/\.3mf$/i.test(f.name)) return;
  e.preventDefault(); void handleKeyFile(f);
});
for (const b of document.querySelectorAll<HTMLButtonElement>('#tabs button')) b.addEventListener('click', () => {
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.remove('active')); b.classList.add('active');
  document.querySelectorAll('.pane').forEach((p) => p.classList.remove('active')); $('#' + b.dataset.tab!).classList.add('active');
  viewer.resize();
});
$('#palette').classList.add('active');
// Public build: no toggle for unreleased parts
if (!__DEV_UI__) {
  for (const id of ['#chk-legacy']) { const el = document.querySelector(id); const wrap = el?.closest('label') ?? el; if (wrap) (wrap as HTMLElement).style.display = 'none'; }
  state.showLegacy = false;
}

// Share link opened in an already open tab: only the hash changes and the page does not reload, so load the track here.
// saveState writes our own changes via history.replaceState, which does not fire hashchange.
window.addEventListener('hashchange', () => {
  let h: URLSearchParams;
  try { h = new URLSearchParams(location.hash.replace(/^#/, '')); } catch { return; }
  const tr = h.get('t'); if (!tr) return;
  if (location.hash.replace(/^#/, '') === linkHash(state.elements, state.japandi, state.colors)) return;   // already this state
  const dec = decodeChain(tr);
  if (!dec || (!dec.elements.length && dec.unknown)) { toast(t('loadFailed')); return; }
  const ed0 = state.japandi;
  const sty = h.get('s'); if (sty === 'j' || sty === 'g') setJapandi(sty === 'j', false);
  const col = h.get('c'); const dc = col ? decodeColors(col) : null; if (dc) applyColorState(dc, false);
  setElements(dec.elements);
  if (state.japandi !== ed0 || dc) applyLang();
  if (dec.unknown) toast(tf('loadSkipped', { n: dec.unknown }));
});

fillDemoMenu();
applyLang();
viewer.setLayout(layout, steps).then(() => { viewer.fit('iso'); });

// test hook for UI tests (Playwright): expose state
(window as unknown as { __kb: unknown }).__kb = {
  get elements() { return state.elements; }, get layout() { return layout; }, get steps() { return steps; },
  get selected() { return selected; }, get insertAfter() { return insertAfter; }, get replaceIdx() { return replaceIdx; },
  get branchFrom() { return branchFrom ? { idx: state.elements.indexOf(branchFrom.from), port: branchFrom.port } : null; },
  get choice() { return choice ? choice.cands.map((c) => ({ key: c.key, ok: c.ok, part: c.o.part, reversed: c.o.reversed })) : null; },
  get plain() { return toPlain(state.elements); }, get chip() { return chip; },
  /** Screen position (canvas px) of a direction's arrow or a part's exit, for clicks in UI tests. */
  ghostAt(key: string) { const c = choice?.cands.find((x) => x.key === key); const q = c?.lay.placed[c.idx]; return q?.exit ? viewer.project(q.exit.p[0] + q.exit.n[0] * 14, q.exit.p[1] + q.exit.n[1] * 14, q.exit.p[2] + 4) : null; },
  markerAt(idx: number, port: number) { const f = layout.freePorts.find((x) => x.idx === idx && x.port === port); return f ? viewer.project(f.w.p[0] + f.w.n[0] * 12, f.w.p[1] + f.w.n[1] * 12, f.w.p[2] + 4) : null; },
  get plan() { return plan; }, get lang() { return getLang(); }, get edition() { return isJapandi() ? 'japandi' : 'plain'; },
  get colors() { return getColors(); }, viewHex(h: string) { return '#' + viewColor(h).toString(16).padStart(6, '0'); },
  get plateCfg() { return plateCfg; }, get onePiece() { return curPlan ? { fits: curPlan.fit.fits, rot90: curPlan.fit.rot90, whole: curPlan.fit.whole, plate: [curPlan.fit.cx, curPlan.fit.cy, curPlan.fit.w, curPlan.fit.d], size: curPlan.size, parts: curPlan.fused.length, loose: curPlan.loose.reduce((n, p) => n + p.jobs.length, 0), pins: curPlan.pins, raised: curPlan.raised } : null; },
  get mwKey() { return mwKey; }, get unlocked() { return unlocked(); }, get testUnlock() { return testUnlock; },
  get exportReady() { return exportReady(); }, get profiles() { return (['plain', 'japandi'] as Ed[]).filter((e) => hasProfile(e)).map((e) => ({ edition: e, parts: getProfile(e)!.parts, missing: getProfile(e)!.missing.length })); },
  get laneMarkers() { return laneMarkers().map((m) => m.key); }, get connectGoals() { return connectTargets().map((g) => g.key); },
  meshColor(i: number) { const m = viewer.meshes.find((x) => x.userData.idx === i && !x.userData.isAdapter); return m ? '#' + (m.userData.base as number).toString(16).padStart(6, '0') : null; },
};
