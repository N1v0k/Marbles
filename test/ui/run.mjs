// UI tests (Playwright, Chromium with software GL) against the built app in dist/.
// Usage: npm run build && node test/ui/run.mjs   (exit code 1 on failure)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { join, extname, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(ROOT, process.env.KB_DIST ?? 'dist');   // KB_DIST=dist-single tests the single-file build
const CODES = JSON.parse(readFileSync(join(ROOT, 'tools', 'codes.json'), 'utf-8'));
// share-link hash for a chain of part IDs (trailing * = reversed)
const hashOf = (...names) => '#t=m1.' + names.map((n) => { const rev = n.endsWith('*'); const id = (rev ? n.slice(0, -1) : n) + '_16mm'; return CODES[id] + (rev ? '*' : ''); }).join('.');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.kbm': 'application/octet-stream', '.json': 'application/json' };
// serve on 127.0.0.1 only, and only files below DIST (no path traversal via '/..%2F')
const server = createServer((req, res) => {
  let p;
  try { p = decodeURIComponent((req.url ?? '/').split('?')[0]); } catch { res.writeHead(400); res.end(); return; }
  if (p === '/') p = '/index.html';
  const f = resolve(DIST, '.' + p);
  if ((f !== DIST && !f.startsWith(DIST + sep)) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] ?? 'application/octet-stream' }); res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const URL = `http://127.0.0.1:${PORT}/`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];
let ctx, page, errors;
async function fresh(opts = {}) {
  if (ctx) await ctx.close();
  ctx = await browser.newContext({ viewport: opts.viewport ?? { width: 1400, height: 860 }, locale: 'de-DE' });
  page = await ctx.newPage();
  errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text() + ' @ ' + (m.location()?.url ?? '')); });
  // the builder never fetches print meshes: any request to print/ or *.kbm.gz is an error
  page.on('request', (r) => { if (/\/print(_j)?\/|\.kbm\.gz/.test(r.url())) errors.push('Request for print meshes: ' + r.url()); });
  await page.goto(URL + (opts.hash ?? ''), { waitUntil: 'networkidle' });
  // UI language is pinned to German (the assertions compare German UI text); lang: null = no stored choice
  await page.evaluate((lang) => { localStorage.clear(); if (lang) localStorage.setItem('kb16-lang', lang); }, opts.lang === undefined ? 'de' : opts.lang);
  // reload; with a hash, go through about:blank (same URL + hash would only be a fragment navigation)
  if (!opts.keep) { if (opts.hash) await page.goto('about:blank'); await page.goto(URL + (opts.hash ?? ''), { waitUntil: 'networkidle' }); }
  await page.waitForTimeout(300);
}
const kb = (expr) => page.evaluate(`(() => { const s = window.__kb; return ${expr}; })()`);
const ids = () => kb('s.elements.map(e => e.part.replace(/_16mm$/, "") + (e.reversed ? "*" : ""))');
/** Add a base part: set the selects, click "+"; if the direction choice appears, pick dir (or the first free one). */
async function add(gid, dims = {}, dir = null) {
  for (const [k, v] of Object.entries(dims)) {
    const sel = `.pcard[data-g=${gid}] select[data-dim=${k}]`;
    if (await page.$(sel)) await page.selectOption(sel, v);
  }
  await page.click(`.pcard[data-g=${gid}] .pc-add`); await page.waitForTimeout(450);
  if (await page.locator('#choice-bar').isVisible()) {
    const key = dir ?? await page.$eval('#choice-bar button.ok', (b) => b.dataset.key);
    await page.click(`#choice-bar button[data-key=${key}]`); await page.waitForTimeout(450);
  }
}
const cards = () => page.$$eval('.pcard', (c) => c.map((x) => x.dataset.g));
async function loadDemo(n) { await page.click('#btn-demo'); await page.click(`#menu-demo button:nth-child(${n})`); await page.waitForTimeout(1200); }
function eq(a, b, msg) { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function ok(c, msg) { if (!c) throw new Error(msg); }
/** Print profile as downloaded from MakerWorld: identifiers in 3D/3dmodel.model, 60 part names in model_settings.config. */
const PART_NAMES = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'parts.json'), 'utf-8')).parts.map((p) => p.nameEn).filter(Boolean).slice(0, 60);
function mwFixture(withDesigner = true) {
  const meta = { Title: '16mm Modular Marble Run', ProfileTitle: 'Japandi - all parts', DesignModelId: 'US0000000000aa', DesignProfileId: '991400001', DesignRegion: 'US', License: 'Standard Digital File License' };
  if (withDesigner) Object.assign(meta, { Designer: 'OverEngineer', DesignerUserId: '3696494148' });
  const model = '<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n' +
    Object.entries(meta).map(([k, v]) => ` <metadata name="${k}">${v}</metadata>`).join('\n') + '\n <resources/>\n <build/>\n</model>\n';
  const cfg = '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n' + PART_NAMES.map((n, i) => `  <object id="${i + 1}">\n    <metadata key="name" value="${n}"/>\n  </object>\n`).join('') + '</config>\n';
  return Buffer.from(zipSync({ '3D/3dmodel.model': strToU8(model), 'Metadata/model_settings.config': strToU8(cfg) }));
}
/** Print parts come from the print profile. Test files: the release profiles (as uploaded, without MakerWorld identifiers)
 *  and copies carrying the identifiers MakerWorld adds on download (only 3D/3dmodel.model replaced, all other entries
 *  copied raw). Paths: ../Release, ../Japandi/Release or KB_3MF_PLAIN / KB_3MF_JAPANDI. */
const REL = {
  plain: process.env.KB_3MF_PLAIN ?? join(ROOT, '..', 'Release', 'Modular_Marble_Run_16mm_Plain_Release.3mf'),
  japandi: process.env.KB_3MF_JAPANDI ?? join(ROOT, '..', 'Japandi', 'Release', 'Modular_Marble_Run_16mm_Japandi_Release.3mf'),
};
for (const f of Object.values(REL)) if (!existsSync(f)) { console.log('Release 3MF missing (needed for the print parts of the exports): ' + f); process.exit(1); }
/** Replace one entry of a ZIP file and copy all other entries byte for byte (no ZIP64). */
function replaceZipEntry(zip, name, content) {
  // read the central directory: name, record, local header offset and raw local data of each entry
  const cd = (b) => {
    const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let e = b.length - 22; while (e >= 0 && d.getUint32(e, true) !== 0x06054b50) e--;
    const n = d.getUint16(e + 10, true), start = d.getUint32(e + 16, true); let o = start; const list = [];
    for (let i = 0; i < n; i++) {
      const nl = d.getUint16(o + 28, true), xl = d.getUint16(o + 30, true), cl = d.getUint16(o + 32, true);
      list.push({ name: Buffer.from(b.subarray(o + 46, o + 46 + nl)).toString(), rec: Buffer.from(b.subarray(o, o + 46 + nl + xl + cl)), lho: d.getUint32(o + 42, true) });
      o += 46 + nl + xl + cl;
    }
    const sorted = [...list].sort((a, b2) => a.lho - b2.lho);
    sorted.forEach((x, k) => { x.data = Buffer.from(b.subarray(x.lho, k + 1 < sorted.length ? sorted[k + 1].lho : start)); });
    return list;
  };
  const orig = cd(zip), replacement = cd(Buffer.from(zipSync({ [name]: [content, { level: 6 }] })))[0];
  const parts = [], recs = []; let off = 0;
  for (const x of orig) {
    const y = x.name === name ? replacement : x;
    const rec = Buffer.from(y.rec); rec.writeUInt32LE(off, 42); recs.push(rec); parts.push(y.data); off += y.data.length;
  }
  const cdBuf = Buffer.concat(recs), eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(recs.length, 8); eocd.writeUInt16LE(recs.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}
const TMP = mkdtempSync(join(tmpdir(), 'kb16ui-'));
const MW_META = { Designer: 'OverEngineer', DesignModelId: 'US0000000000aa', DesignProfileId: '991400001', DesignRegion: 'US', License: 'Standard Digital File License' };
const MW = {};
for (const [ed, f] of Object.entries(REL)) {
  const z = readFileSync(f);
  const model = strFromU8(unzipSync(z, { filter: (e) => e.name === '3D/3dmodel.model' })['3D/3dmodel.model']);
  const meta = { ...MW_META, ProfileTitle: ed === 'japandi' ? 'Japandi - all parts' : 'Plain - all parts' };
  let patched = model;
  for (const [k, v] of Object.entries(meta)) {
    const re = new RegExp(`<metadata name="${k}">[^<]*</metadata>`);
    patched = re.test(patched) ? patched.replace(re, `<metadata name="${k}">${v}</metadata>`) : patched.replace(' <resources>', ` <metadata name="${k}">${v}</metadata>\n <resources>`);
  }
  MW[ed] = join(TMP, `Modular_Marble_Run_16mm_${ed === 'japandi' ? 'Japandi' : 'Plain'}_MakerWorld.3mf`);
  writeFileSync(MW[ed], replaceZipEntry(z, '3D/3dmodel.model', strToU8(patched)));
}
const REF = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'print_ref.json'), 'utf-8'));
const PARTS = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'parts.json'), 'utf-8')).parts;
/** Do the meshes in an exported 3MF come from the print profile? face_count per object = triangles of the print mesh. */
function printMeshesIn(z, isJapandi) {
  const cfg = strFromU8(z['Metadata/model_settings.config']); let n = 0;
  for (const m of cfg.matchAll(/<object id="\d+">\s*<metadata key="name" value="([^"]+)"\/>[\s\S]*?<metadata face_count="(\d+)"\/>/g)) {
    const p = PARTS.find((q) => q.id === m[1] || q.nameEn === m[1]); if (!p) continue;
    const ref = (isJapandi && REF.japandi[p.file]) || REF.plain[p.file];
    if (Number(m[2]) !== ref[0]) throw new Error(`${m[1]}: ${m[2]} triangles instead of ${ref[0]} (preview mesh?)`);
    n++;
  }
  return n;
}
/** Drop a print profile like a user would (file input of the dialog) and wait until it has been read. */
async function dropProfile(path) {
  const before = JSON.stringify(await kb('s.profiles'));
  await page.setInputFiles('#file-key', path);
  for (let i = 0; i < 100; i++) {
    await page.waitForTimeout(200);
    if (JSON.stringify(await kb('s.profiles')) !== before) break;
    const msg = await page.textContent('#key-msg').catch(() => '');
    if (msg && !/Prüfe/.test(msg) && (await page.locator('#dlg-key').isVisible())) break;
  }
  await page.waitForTimeout(300);
}
/** Unlock the exports like a user: drop the MakerWorld profile (with identifiers) of the chosen edition. */
async function unlock(ed = null) { await dropProfile(MW[ed ?? await kb('s.edition')]); }

async function test(name, fn) {
  if (process.env.KB_ONLY && !new RegExp(process.env.KB_ONLY).test(name)) return;   // KB_ONLY=<regex>: run matching tests only
  try { await fn(); if (errors.length) throw new Error('Console errors: ' + errors.join(' | ')); results.push([name, 'ok']); console.log('  ok  ', name); }
  catch (e) { results.push([name, 'FAIL', e.message]); console.log('  FAIL', name, '->', e.message); try { await page.screenshot({ path: `/tmp/ui_fail_${results.length}.png` }); } catch { /* ignore */ } }
}

// ---------------------------------------------------------------- Scenarios
await fresh();
await test('Start: empty track, 16 mm title, palette grouped by base part without adapters/pins/modules', async () => {
  eq(await ids(), [], 'empty');
  ok((await page.textContent('.brand')).includes('16 mm'), 'title');
  const gs = await cards();
  ok(gs.includes('straight') && gs.includes('curve') && gs.includes('lift') && gs.includes('flipflop'), 'base parts: ' + gs.join(','));
  ok(!gs.some((g) => /adapter|stift|liftteil|kwteil/.test(g)), 'adapters/pins/modules visible: ' + gs.join(','));
  eq(await page.$$eval('#chips .chip', (c) => c.map((x) => x.dataset.chip)), ['all', 'straight', 'curve', 'level', 'special', 'startEnd'], 'chips');
  ok((await page.locator('#empty-hint').isVisible()), 'empty-track hint missing');
});
await test('Default language is English (no stored choice, German browser)', async () => {
  await fresh({ lang: null });
  eq(await kb('s.lang'), 'en', 'language');
  ok((await page.textContent('#btn-new')).trim().length > 0 && (await page.textContent('[data-t="help"]')).includes('Help'), 'English labels');
  await fresh();
});
await test('Add parts: start + straight 60-50; selects offer only matching rims; stats and snap pins', async () => {
  await add('start'); await add('straight', { kind: 'groove', len: '120', rim: '60-50' });
  eq(await ids(), ['StartSchale_60', 'Gerade120_60-50'], 'chain');
  const rims = await page.$$eval('.pcard[data-g=straight] select[data-dim=rim] option', (o) => o.map((x) => x.value));
  ok(rims.length && rims.every((r) => r.startsWith('50-')), '"compatible only": only rim 50 at the inlet: ' + rims.join(','));
  ok((await page.textContent('#open-end')).includes('Rand 50'), 'open end');
  await page.uncheck('#chk-compatible'); await page.waitForTimeout(300);
  await page.selectOption('.pcard[data-g=straight] select[data-dim=rim]', '60-50'); await page.waitForTimeout(200);
  ok((await page.getAttribute('.pcard[data-g=straight]', 'class')).includes('off'), 'rim 60 after rim 50 should be disabled');
  await page.check('#chk-compatible'); await page.waitForTimeout(300);
  ok((await page.textContent('#stats')).includes('Raststifte'), 'stats');
  ok((await page.textContent('#bom')).includes('Raststift_16mm'), 'BOM lists the snap pin');
});
await test('Curve: direction via ghosts (left/right), Escape cancels, clicking a ghost in 3D picks, flip direction in the detail panel', async () => {
  await page.click('.pcard[data-g=curve] .pc-add'); await page.waitForTimeout(500);
  ok(await page.locator('#choice-bar').isVisible(), 'direction choice visible');
  eq(await kb('s.choice.map((c) => c.key + (c.ok ? "" : "!"))'), ['left', 'right'], 'both free');
  ok((await page.textContent('#mode-line')).includes('Richtung'), 'mode line');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  eq(await kb('s.choice'), null, 'Escape cancels');
  eq((await ids()).length, 2, 'nothing added');
  await page.click('.pcard[data-g=curve] .pc-add'); await page.waitForTimeout(900);
  // click the ghost (arrow at the exit) of the right-hand curve in 3D
  const at = await kb('s.ghostAt("right")'); ok(at, 'right ghost');
  const box = await page.locator('#c3d').boundingBox();
  await page.mouse.click(box.x + at[0], box.y + at[1]); await page.waitForTimeout(600);
  eq(await ids(), ['StartSchale_60', 'Gerade120_60-50', 'Kurve90_50*'], 'right = flat curve reversed (click in 3D)');
  eq(await kb('s.selected'), 2, 'new part selected');
  const n = await kb('s.layout.placed[2].exit.n[1]'); ok(n < -0.99, 'turns right: ' + n);
  ok(await page.locator('#choice-bar').isHidden(), 'choice closed');
  await page.click('#d-dir'); await page.waitForTimeout(400);
  eq(await ids(), ['StartSchale_60', 'Gerade120_60-50', 'Kurve90_50'], 'flip direction in the detail panel');
});
await test('Undo/redo (buttons + keyboard) restore the chain and reset modes', async () => {
  await page.click('#btn-undo'); await page.waitForTimeout(400);
  eq(await ids(), ['StartSchale_60', 'Gerade120_60-50', 'Kurve90_50*'], 'undo');
  await page.keyboard.press('Control+y'); await page.waitForTimeout(400);
  eq(await ids(), ['StartSchale_60', 'Gerade120_60-50', 'Kurve90_50'], 'redo');
  await page.keyboard.press('Control+z'); await page.waitForTimeout(400);
  eq((await ids()).length, 3, 'undo via keyboard');
  eq(await kb('[s.selected, s.insertAfter, s.replaceIdx]'), [null, null, null], 'modes after undo');
});
await test('Replace: palette offers only matching values, replacing ends the mode, selection stays', async () => {
  await fresh(); await loadDemo(1); // mini track
  eq((await ids()).length, 6, 'mini track loaded');
  await page.click('#chain-list li[data-idx="3"]'); await page.waitForTimeout(200);   // Gerade120_40-40
  await page.click('#d-rep'); await page.waitForTimeout(400);
  ok((await page.textContent('#mode-line')).includes('Ersetze 4.'), 'mode line');
  eq(await page.$$eval('.pcard[data-g=straight] select[data-dim=rim]', (o) => o.length), 0, 'only one rim possible: no select');
  ok((await page.textContent('.pcard[data-g=straight] .pc-dims')).includes('40 → 40'), 'between rim 40 and rim 40 only 40-40 fits');
  await add('straight', { kind: 'rail', len: '120' });
  eq((await ids())[3], 'SchieneGerade120_40-40', 'replaced');
  eq(await kb('s.replaceIdx'), null, 'replace mode ended');
  eq(await kb('s.selected'), 3, 'selection');
});
await test('Insert after: anchor moves to the new part; Escape ends the mode', async () => {
  await page.click('#chain-list li[data-idx="3"]'); await page.waitForTimeout(200);
  await page.click('#d-ins'); await page.waitForTimeout(300);
  eq(await kb('s.insertAfter'), 3, 'anchor');
  await add('spacer', { kind: 'groove', len: '65' });
  eq((await ids())[4], 'Distanz65-0_40-40', 'at position 5');
  eq(await kb('s.insertAfter'), 4, 'anchor on the new part');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  eq(await kb('s.insertAfter'), null, 'Escape');
});
await test('Delete key: removes the selected part, but not while typing in the search field', async () => {
  const n = (await ids()).length;
  await page.click('#chain-list li[data-idx="4"]'); await page.waitForTimeout(200);
  await page.focus('#search'); await page.keyboard.type('x'); await page.keyboard.press('Backspace'); await page.keyboard.press('Delete'); await page.waitForTimeout(300);
  eq((await ids()).length, n, 'nothing deleted from the search field');
  await page.fill('#search', '');
  await page.click('#chain-list li[data-idx="4"]'); await page.keyboard.press('Delete'); await page.waitForTimeout(500);
  eq((await ids()).length, n - 1, 'Delete removes the selected part');
});
await test('Language: messages follow the switch; English part names', async () => {
  await fresh(); await add('start');
  await page.$eval('#rng-v0', (e) => { e.value = '0'; e.dispatchEvent(new Event('input')); });
  await add('straight', { kind: 'groove', len: '120', rim: '60-60' });
  ok((await page.textContent('#issues-list')).includes('bleibt liegen'), 'German message');
  await page.click('#btn-lang'); await page.waitForTimeout(600);
  ok((await page.textContent('#issues-list')).includes('stops'), 'English message');
  ok((await page.textContent('#chain-list')).includes('Straight120 60-60'), 'English part name');
  ok((await page.textContent('#help-body')).includes('snap pin'), 'help in English');
  eq(await page.evaluate(() => localStorage.getItem('kb16-lang')), 'en', 'language remembered');
  await page.click('#btn-lang'); await page.waitForTimeout(300);
});
await test('Push slider only recomputes the ball check; own storage key (kugelbahn16-builder-v1)', async () => {
  await page.$eval('#rng-v0', (e) => { e.value = '400'; e.dispatchEvent(new Event('input')); }); await page.waitForTimeout(300);
  ok(!(await page.textContent('#issues-list')).includes('bleibt liegen'), 'with a push the ball keeps rolling');
  await page.waitForTimeout(600);
  eq(JSON.parse(await page.evaluate(() => localStorage.getItem('kugelbahn16-builder-v1'))).sim.v0, 400, 'saved (debounced)');
  eq(await page.evaluate(() => localStorage.getItem('kugelbahn-builder-v1')), null, 'foreign storage key (kugelbahn-builder-v1) untouched');
});
await test('Print plates: slider changes the plate count, plan Markdown, profile plate list, 3MF only in the developer build', async () => {
  await fresh(); await loadDemo(5);
  await page.$eval('#rng-hours', (e) => { e.value = '2'; e.dispatchEvent(new Event('input')); }); await page.waitForTimeout(300);
  const n2 = (await page.textContent('#plates-summary')).match(/(\d+) Platten/)[1];
  await page.$eval('#rng-hours', (e) => { e.value = '12'; e.dispatchEvent(new Event('input')); }); await page.waitForTimeout(300);
  const n12 = (await page.textContent('#plates-summary')).match(/(\d+) Platten/)[1];
  ok(Number(n2) > Number(n12), `2h: ${n2} plates, 12h: ${n12}`);
  eq(await page.evaluate(() => localStorage.getItem('kb16-maxhours')), '12', 'remembered');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#btn-plan-md')]);
  eq(dl.suggestedFilename(), 'Marble_Run16_Japandi_print_plan.md', 'Markdown download (Japandi is the default)');
  const devUi = await page.$('#plates-list button[data-level="0"]');
  if (devUi) {
    await page.click('#plates-list button[data-level="0"]'); await page.waitForTimeout(300);
    ok(await page.locator('#dlg-key').isVisible(), 'without a print profile: dialog instead of export');
    const [dl3] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), dropProfile(REL.japandi)]);
    eq(dl3.suggestedFilename(), 'Marble_Run16_Japandi_level000.3mf', '3MF download');
    ok(printMeshesIn(unzipSync(readFileSync(await dl3.path())), true) > 0, 'print meshes from the profile');
    const path = await dl3.path(); ok(statSync(path).size > 10000, '3MF too small');
  } else {
    ok(await page.locator('#btn-3mf-all').isVisible(), '3MF button missing in the public build (should be visible but locked)');
    ok((await page.textContent('#btn-3mf-all')).includes('🔒'), '3MF button without lock');
    ok(await page.locator('#chk-legacy').isHidden(), 'extras switch visible in the public build');
  }
  const [dl4] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#btn-mwlist2')]);
  eq(dl4.suggestedFilename(), 'Modular_Marble_Run_16mm_Japandi_plate_list.md', 'plate list download');
  ok(readFileSync(await dl4.path(), 'utf-8').includes('Modular_Marble_Run_16mm_Japandi_Release.3mf'), 'plate list names the Japandi release profile');
  ok(!errors.length, 'no errors during export');
});
await test('MakerWorld profile unlocks the 3MF exports (dialog, foreign file rejected, identifiers in the export, remembered); logo does nothing', async () => {
  await fresh(); await loadDemo(2);
  let got = null; page.once('download', (d) => { got = d; });
  for (let i = 0; i < 5; i++) { await page.click('#topbar .logo'); await page.waitForTimeout(80); }
  await page.waitForTimeout(1500);
  eq(got, null, '5 logo clicks download nothing');
  if (!(await kb('s.unlocked'))) {
    await page.click('#btn-3mf-all'); await page.waitForTimeout(300);
    ok(await page.locator('#dlg-key').isVisible(), 'dialog missing');
    await page.setInputFiles('#file-key', { name: 'local.3mf', mimeType: 'model/3mf', buffer: mwFixture(false) }); await page.waitForTimeout(600);
    ok((await page.textContent('#key-msg')).includes('nicht von MakerWorld'), 'file without designer identifier rejected: ' + await page.textContent('#key-msg'));
    eq(await kb('s.unlocked'), false, 'still locked');
    // the release file as uploaded (without MakerWorld identifiers) does not unlock
    await dropProfile(REL.japandi);
    ok((await page.textContent('#key-msg')).includes('nicht von MakerWorld'), 'release file without identifiers rejected');
    eq(await kb('s.profiles'), [], 'no print parts without unlocking');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), unlock()]);
    eq(dl.suggestedFilename(), 'Marble_Run16_Japandi_all_levels.3mf', 'export runs after unlocking');
    const z = unzipSync(readFileSync(await dl.path()));
    ok(strFromU8(z['3D/3dmodel.model']).includes('<metadata name="DesignProfileId">991400001</metadata>'), 'MakerWorld identifier in the export');
    ok(!!z['Metadata/project_settings.config'], 'project settings in the export');
    ok(printMeshesIn(z, true) >= 3, 'export uses the print meshes (Japandi) from the profile');
    ok(await page.locator('#dlg-key').isHidden(), 'dialog closed');
    ok((await page.textContent('#mw-status')).includes('Japandi - all parts'), 'status names the profile');
    ok((await page.textContent('#mw-status')).includes('nur diese Sitzung'), 'status: print parts for this session only');
    ok(!(await page.textContent('#btn-3mf-all')).includes('🔒'), 'lock gone');
    // after a reload the identifiers are remembered but the file is not: hint and dialog
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(800);
    eq(await kb('s.unlocked'), true, 'identifiers still remembered after reload');
    eq(await kb('s.exportReady'), false, 'print parts not stored');
    ok((await page.textContent('#btn-3mf-all')).includes('🔒'), 'lock back (file missing)');
    await page.click('#btn-3mf-all'); await page.waitForTimeout(300);
    ok((await page.textContent('#key-msg')).includes('Neuladen'), 'hint: drop the file again after a reload');
    // plain profile in the Japandi edition: say so clearly and offer "export plain"
    await dropProfile(MW.plain);
    ok((await page.textContent('#key-msg')).includes('glatte Edition'), 'edition hint: ' + await page.textContent('#key-msg'));
    ok(await page.locator('#key-switch').isVisible(), '"export plain" button');
    const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.click('#key-switch')]);
    eq(dl2.suggestedFilename(), 'Marble_Run16_all_levels.3mf', 'exported plain');
    eq(await kb('s.edition'), 'plain', 'edition switched');
    ok(printMeshesIn(unzipSync(readFileSync(await dl2.path())), false) >= 3, 'print meshes (plain) from the profile');
    await page.click('#mw-remove'); await page.waitForTimeout(200);
    eq(await kb('s.unlocked'), false, 'remove locks again');
    eq(await kb('s.profiles'), [], 'remove forgets the print parts');
  } else {
    // developer build: no identifiers needed, but the print parts are - drop both profiles in turn
    await page.click('#btn-3mf-all'); await page.waitForTimeout(300);
    ok(await page.locator('#dlg-key').isVisible(), 'dialog without a print profile');
    await dropProfile(REL.plain);
    ok((await page.textContent('#key-msg')).includes('glatte Edition'), 'plain profile in Japandi: hint');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), dropProfile(REL.japandi)]);
    eq(dl.suggestedFilename(), 'Marble_Run16_Japandi_all_levels.3mf', 'developer build: export with profile');
    const z = unzipSync(readFileSync(await dl.path()));
    ok(printMeshesIn(z, true) >= 3, 'print meshes from the profile');
    eq((await kb('s.profiles')).map((p) => p.edition), ['plain', 'japandi'], 'both profiles loaded');
  }
  ok(!errors.length, 'no errors');
});
await test('Test mode: 7 logo clicks lift the profile requirement (export without identifiers, remembered), 7 more lock again', async () => {
  await fresh(); await loadDemo(2);
  const taps = async (n) => { for (let i = 0; i < n; i++) { await page.click('#topbar .logo'); await page.waitForTimeout(60); } await page.waitForTimeout(150); };
  const pub = !(await kb('s.unlocked'));
  await taps(6);
  eq(await kb('s.testUnlock'), false, '6 clicks are not enough');
  await page.waitForTimeout(1700);
  await taps(1);
  eq(await kb('s.testUnlock'), false, 'a pause resets the count');
  await page.waitForTimeout(1700);
  await taps(7);
  eq(await kb('s.testUnlock'), true, '7 clicks: test mode on');
  eq(await kb('s.unlocked'), true, 'exports unlocked');
  ok((await page.textContent('#toast')).includes('Testmodus an'), 'toast: test mode on');
  if (pub) {
    ok((await page.textContent('#mw-status')).includes('Testmodus'), 'status names test mode');
    // print parts still come from a profile 3MF - in test mode also without MakerWorld identifiers (release file)
    await page.click('#btn-3mf-all'); await page.waitForTimeout(300);
    ok(await page.locator('#dlg-key').isVisible(), 'dialog: print parts missing');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), dropProfile(REL.japandi)]);
    ok(await page.locator('#dlg-key').isHidden(), 'dialog closed');
    ok(!(await page.textContent('#btn-3mf-all')).includes('🔒'), 'lock gone');
    const z = unzipSync(readFileSync(await dl.path()));
    ok(!strFromU8(z['3D/3dmodel.model']).includes('DesignProfileId'), 'no MakerWorld identifiers');
    ok(printMeshesIn(z, true) >= 3, 'print meshes from the profile');
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(800);
    eq(await kb('s.unlocked'), true, 'still unlocked after reload');
    eq(await kb('s.exportReady'), false, 'print parts gone after reload');
  }
  await taps(7);
  eq(await kb('s.testUnlock'), false, '7 more clicks: test mode off');
  ok((await page.textContent('#toast')).includes('Testmodus aus'), 'toast: test mode off');
  if (pub) {
    eq(await kb('s.unlocked'), false, 'locked again');
    ok((await page.textContent('#btn-3mf-all')).includes('🔒'), 'lock back');
    await page.click('#btn-3mf-all'); await page.waitForTimeout(300);
    ok(await page.locator('#dlg-key').isVisible(), 'dialog back');
  }
  ok(!errors.length, 'no errors');
});
await test('One piece: plate mode (A1 mini) greys out parts that are too long, plate in 3D, export as a single object', async () => {
  await fresh({ hash: hashOf('StartSchale_60', 'Gerade120_60-60') });
  const lensOff = await page.$$eval('.pcard[data-g=straight] select[data-dim=len] option', (o) => o.map((x) => x.value));
  ok(lensOff.includes('120'), 'without plate mode: straight 120 selectable');
  await page.check('#chk-plate'); await page.selectOption('#sel-printer', 'a1mini'); await page.waitForTimeout(600);
  const op = await kb('s.onePiece');
  ok(op && op.fits && op.parts === 2, 'fits: ' + JSON.stringify(op));
  ok((await page.textContent('#op-status')).includes('Passt auf Bambu Lab A1 mini'), 'status');
  const lensOn = await page.$$eval('.pcard[data-g=straight] select[data-dim=len] option', (o) => o.map((x) => x.value));
  ok(!lensOn.includes('120') && lensOn.includes('100'), 'A1 mini: 120 blocked, 100 allowed: ' + lensOn.join(','));
  eq(await kb('s.plateCfg'), { on: true, printer: 'a1mini', custom: [256, 256, 256] }, 'setting');
  eq(JSON.parse(await page.evaluate(() => localStorage.getItem('kb16-plate'))).printer, 'a1mini', 'remembered');
  // custom size 100 x 100: the track (108 x 32 mm) does not fit even rotated (5 mm margin all round)
  await page.selectOption('#sel-printer', 'custom'); await page.waitForTimeout(200);
  await page.fill('#inp-px', '100'); await page.dispatchEvent('#inp-px', 'change'); await page.waitForTimeout(300);
  await page.fill('#inp-py', '100'); await page.dispatchEvent('#inp-py', 'change'); await page.waitForTimeout(400);
  ok((await page.textContent('#op-status')).includes('Zu groß'), 'too large for 100 mm');
  await page.selectOption('#sel-printer', 'a1'); await page.waitForTimeout(300);
  if (!(await kb('s.exportReady'))) await unlock();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.click('#btn-3mf-one')]);
  eq(dl.suggestedFilename(), 'Marble_Run16_Japandi_one_piece.3mf', 'file name');
  const z = unzipSync(readFileSync(await dl.path()));
  const model = strFromU8(z['3D/3dmodel.model']), cfg = strFromU8(z['Metadata/model_settings.config']);
  eq((model.match(/<components>/g) ?? []).length, 1, 'one object with components');
  eq((model.match(/<component /g) ?? []).length, 2, 'two parts');
  const want = ['StartSchale_60_16mm', 'Gerade120_60-60_16mm'].reduce((a, f) => a + (REF.japandi[f] ?? REF.plain[f])[0], 0);
  eq((model.match(/<triangle /g) ?? []).length, want, 'print meshes (Japandi) from the profile');
  eq((cfg.match(/<plate>/g) ?? []).length, 1, 'one plate');
  ok(cfg.includes('Kugelbahn 16 mm Japandi in einem Stück'), 'object name');
  ok(!!z['Metadata/project_settings.config'], 'project settings');
  await page.uncheck('#chk-plate'); await page.waitForTimeout(300);
  eq((await kb('s.plateCfg')).on, false, 'plate mode off');
  ok(!errors.length, 'no errors');
});
await test('Plate placement: plate shifts towards the lift tower (Endlos-Acht), overhang hint; Lift-Rundkurs fits entirely', async () => {
  await fresh();
  const pick = async (key) => { const names = await page.$$eval('#menu-demo button', (l) => l.map((x) => x.textContent)); const i = names.findIndex((n) => n.includes(key)); ok(i >= 0, 'demo ' + key); await loadDemo(i + 1); };
  await page.check('#chk-plate'); await page.selectOption('#sel-printer', 'a1'); await page.waitForTimeout(300);
  await pick('Endlos-Acht');
  const op = await kb('s.onePiece'), count = await kb('s.layout.placed.length');
  ok(op && op.fits && count > 5, 'fits: ' + JSON.stringify(op));
  ok(!op.whole, 'tower overhangs by ~2 mm (5 mm margin for one-piece prints)');
  const plate = await page.evaluate(() => { const p = window.__kb.onePiece.plate; return p; });
  ok(plate[2] === 256 && plate[3] === 256, 'A1 plate');
  ok((await page.textContent('#op-status')).includes('über den Plattenrand'), 'overhang hint: ' + await page.textContent('#op-status'));
  await pick('Lift-Rundkurs');
  const op2 = await kb('s.onePiece');
  ok(op2.fits && op2.whole, 'Lift-Rundkurs entirely on the plate: ' + JSON.stringify(op2));
  ok(!(await page.textContent('#op-status')).includes('über den Plattenrand'), 'no hint');
  ok(!errors.length, 'no errors');
});
await test('Japandi style is the default; the switch changes to plain (look, previews, print time, link, 3MF) and persists after reload', async () => {
  await fresh(); await loadDemo(2);
  eq(await kb('s.edition'), 'japandi', 'Japandi by default');
  ok(await page.evaluate(() => document.body.classList.contains('japandi')), 'body.japandi');
  ok(await page.evaluate(() => document.getElementById('chk-japandi').checked), 'switch on');
  ok((await page.textContent('#brand-sub')).includes('Japandi'), 'subtitle');
  ok((await page.evaluate(() => location.hash)).includes('&s=j'), 'link carries s=j');
  const hoursJ = await kb('s.plan.plates.reduce((a, p) => a + p.hours, 0)');
  const imgJ = await page.$eval('#palette-list .pcard img', (i) => i.src).catch(() => null);
  const bgJ = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  if (!(await kb('s.exportReady'))) await unlock();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.click('#btn-3mf-all')]);
  eq(dl.suggestedFilename(), 'Marble_Run16_Japandi_all_levels.3mf', 'Japandi 3MF');
  await page.waitForTimeout(400);
  await page.click('#sw-japandi'); await page.waitForTimeout(1500);
  eq(await kb('s.edition'), 'plain', 'plain');
  ok(!(await page.evaluate(() => document.body.classList.contains('japandi'))), 'no body.japandi');
  ok(await page.evaluate(() => getComputedStyle(document.body).backgroundColor) !== bgJ, 'background changed');
  ok(!(await page.textContent('#brand-sub')).includes('Japandi'), 'plain subtitle');
  const imgP = await page.$eval('#palette-list .pcard img', (i) => i.src).catch(() => null);
  if (imgJ) ok(imgP && imgP !== imgJ, 'preview image changed');
  ok((await kb('s.plan.plates.reduce((a, p) => a + p.hours, 0)')) < hoursJ, 'plain prints faster (grooves cost time)');
  ok((await page.evaluate(() => location.hash)).includes('&s=g'), 'link carries s=g');
  const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('kugelbahn16-builder-v1')));
  eq([saved.japandi, saved.editionChosen], [false, true], 'choice saved');
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#btn-mwlist2')]);
  eq(dl2.suggestedFilename(), 'Modular_Marble_Run_16mm_plate_list.md', 'plain plate list');
  ok(readFileSync(await dl2.path(), 'utf-8').includes('Modular_Marble_Run_16mm_Plain_Release.3mf'), 'plate list names the plain release profile');
  await page.evaluate(() => { history.replaceState(null, '', location.pathname); });
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  eq(await kb('s.edition'), 'plain', 'still plain after reload (explicit choice)');
  ok(!(await page.evaluate(() => document.getElementById('chk-japandi').checked)), 'switch off');
  await page.click('#sw-japandi'); await page.waitForTimeout(800);
  eq(await kb('s.edition'), 'japandi', 'Japandi again');
  ok((await page.evaluate(() => location.hash)).includes('&s=j'), 'link back to s=j');
  ok(!errors.length, 'no errors');
});
await test('Colors: Bambu filament preset colors the 3D view, splits plates by filament, goes into the link; color picker with type, search, custom color; back to family colors', async () => {
  await fresh(); await loadDemo(5); await page.waitForTimeout(800);
  const c0 = await kb('s.meshColor(1)');
  ok(await page.locator('#swatches').isHidden(), 'groups hidden in family mode');
  ok(await page.locator('#fil-panel').isHidden(), 'color picker closed');
  const n0 = await kb('s.plan.plates.length');
  await page.selectOption('#sel-colors', 'bone-brown'); await page.waitForTimeout(600);
  eq(await kb('s.colors.mode'), 'filament', 'filament colors');
  const bone = await kb("s.viewHex('#cbc6b8')");
  eq(await kb('s.meshColor(1)'), bone, 'track in PLA Matte Bone White');
  ok(c0 !== bone, 'different color before');
  ok(await page.locator('#swatches').isVisible(), 'groups visible');
  ok((await page.textContent('#sw-track .sw-name')).includes('PLA Matte Knochenweiß'), 'filament name on the group');
  ok(await page.locator('#fil-fit').isVisible(), 'fit hint (matte PLA)');
  ok((await page.textContent('#fil-fit')).includes('PLA Matte'), 'hint names the type');
  ok((await kb('s.plan.plates.length')) > n0, 'more plates (split by filament)');
  ok((await kb('s.plan.plates.every(p => new Set(p.jobs.map(j => j.color)).size === 1)')), 'each plate single-color');
  const marks = await page.$$eval('#plates-list .plate-color', (els) => els.map((e) => e.title));
  ok(marks.length > 0 && marks.some((x) => x.includes('PLA Matte')), 'color marks with filament names');
  ok((await page.evaluate(() => location.hash)).includes('&c=11103.11103.11802.13800'), 'link carries the filament codes');
  // color picker: tapping a group opens the type of the current filament with the current color marked
  await page.click('#sw-track'); await page.waitForTimeout(200);
  ok(await page.locator('#fil-panel').isVisible(), 'color picker open');
  eq(await page.getAttribute('#sw-track', 'aria-expanded'), 'true', 'aria-expanded');
  eq(await page.$eval('#fil-type', (e) => e.value), 'PLA Matte', 'type of the chosen filament');
  eq(await page.locator('#fil-grid .fil.on').count(), 1, 'one color marked');
  eq(await page.getAttribute('#fil-grid .fil.on', 'data-code'), '11103', 'the current one');
  await page.selectOption('#fil-type', 'PLA Basic'); await page.fill('#fil-search', 'jade'); await page.waitForTimeout(150);
  ok((await page.locator('#fil-grid .fil').count()) >= 1, 'search finds Jade White');
  await page.click('#fil-grid .fil[data-code="10100"]'); await page.waitForTimeout(500);
  eq(await kb('s.colors.f.track'), '10100', 'PLA Basic Jade White chosen');
  eq(await kb('s.colors.preset'), null, 'no preset any more');
  eq(await page.$eval('#sel-colors', (e) => e.value), 'custom', 'select shows custom');
  eq(await kb('s.meshColor(1)'), await kb("s.viewHex('#ffffff')"), 'track white');
  ok(await page.locator('#fil-panel').isVisible(), 'color picker stays open');
  await page.selectOption('#fil-type', ''); await page.fill('#fil-search', 'copper'); await page.waitForTimeout(150);
  const found = await page.$$eval('#fil-grid .fil', (els) => els.map((e) => e.dataset.code));
  ok(found.includes('13800') && found.includes('13300'), 'search across all types (Metal + Silk)');
  await page.fill('#fil-search', 'nosuchcolorxyz'); await page.waitForTimeout(100);
  ok((await page.textContent('#fil-grid')).includes('Keine Farbe'), 'no results -> hint');
  await page.$eval('#fil-own', (e) => { e.value = '#112233'; e.dispatchEvent(new Event('input')); }); await page.waitForTimeout(500);
  eq(await kb('s.colors.c.track'), '#112233', 'custom color');
  eq(await kb('s.colors.f.track'), null, 'no filament');
  ok((await page.textContent('#sw-track .sw-name')).includes('#112233'), 'group shows the custom color');
  ok((await page.evaluate(() => location.hash)).includes('&c=112233.11103.11802.13800'), 'link with hex color + codes');
  await page.press('#fil-search', 'Escape'); await page.waitForTimeout(150);
  ok(await page.locator('#fil-panel').isHidden(), 'Escape closes');
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  eq(await kb('s.colors.c.track'), '#112233', 'after reload: custom color');
  eq(await kb('s.colors.f.adapter'), '11802', 'after reload: filament');
  await page.selectOption('#sel-colors', 'family'); await page.waitForTimeout(600);
  eq(await kb('s.colors.mode'), 'family', 'back');
  eq(await kb('s.meshColor(1)'), c0, 'family color again');
  ok(!(await page.evaluate(() => location.hash)).includes('&c='), 'link without colors');
  ok(await page.locator('#fil-fit').isHidden(), 'no fit hint with family colors');
  ok(!errors.length, 'no errors');
});
await test('New: confirmation dialog, cancel keeps the track', async () => {
  const n = (await ids()).length;
  await page.click('#btn-new'); await page.waitForTimeout(300);
  ok(await page.locator('#dlg-confirm').isVisible(), 'dialog open');
  await page.click('#dlg-confirm button[value=cancel]'); await page.waitForTimeout(300);
  eq((await ids()).length, n, 'after cancel');
  await page.click('#btn-new'); await page.locator('#dlg-confirm').waitFor({ state: 'visible' });
  await page.click('#dlg-confirm button[value=ok]');
  await page.waitForFunction(() => window.__kb.elements.length === 0, null, { timeout: 5000 }).catch(() => {});
  eq(await ids(), [], 'cleared');
});
await test('Share link / URL hash: load an m1 chain, skip unknown codes, ignore links with another prefix (v2)', async () => {
  await fresh({ hash: hashOf('StartSchale_60', 'Kurve90_60*') + '.zzzz9' });
  eq(await ids(), ['StartSchale_60', 'Kurve90_60*'], 'loaded, unknown token skipped');
  await fresh({ hash: '#t=v2.0.1.2' });
  eq(await ids(), [], 'link with another prefix ignored');
  await add('start');
  ok((await page.evaluate(() => location.hash)).startsWith('#t=m1.'), 'hash updated');
});
await test('Load JSON: broken file -> error toast; valid file -> chain with skipped parts', async () => {
  await fresh();
  await page.setInputFiles('#file-load', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{nope') });
  await page.waitForTimeout(400);
  ok((await page.textContent('#toast')).includes('nicht gelesen'), 'error toast');
  await page.setInputFiles('#file-load', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ chain: [{ part: 'StartSchale_60_16mm' }, { part: 'StartSchale_60' }, { part: 'Gerade120_60-50_16mm' }] })) });
  await page.waitForTimeout(600);
  eq(await ids(), ['StartSchale_60', 'Gerade120_60-50'], 'loaded (ID without _16mm skipped)');
  ok((await page.textContent('#toast')).includes('1 unbekannte'), 'hint about skipped parts');
});
await test('3D: click selects a part; hidden adapters are not hit; right-click does not select', async () => {
  await fresh(); await loadDemo(5); await page.waitForTimeout(1500);
  await page.click('#btn-top'); await page.waitForTimeout(800);
  const box = await page.locator('#c3d').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(400);
  const sel1 = await kb('s.selected');
  await page.uncheck('#chk-adapters'); await page.waitForTimeout(300);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(400);
  const sel2 = await kb('s.selected');
  ok(sel1 === null || typeof sel1 === 'number', 'selection 1'); ok(sel2 === null || typeof sel2 === 'number', 'selection 2');
  await page.click('#d-close').catch(() => {});
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' }); await page.waitForTimeout(300);
  eq(await kb('s.selected'), null, 'right-click does not select');
});
await test('Mobile: selecting in the track list switches to the 3D view with the detail card', async () => {
  await fresh({ viewport: { width: 420, height: 800 } }); await loadDemo(3);
  await page.click('#tabs button[data-tab=side]'); await page.waitForTimeout(300);
  await page.click('#chain-list li[data-idx="2"]'); await page.waitForTimeout(400);
  ok((await page.getAttribute('#tabs button[data-tab=viewport]', 'class')).includes('active'), '3D tab active');
  ok(await page.locator('#detail-section').isVisible(), 'detail card visible');
  await page.click('#d-rep'); await page.waitForTimeout(300);
  ok((await page.getAttribute('#tabs button[data-tab=palette]', 'class')).includes('active'), 'replace switches to the palette');
});
await test('Help and export menu', async () => {
  await fresh();
  const menu = await page.$$eval('#menu-export button', (b) => b.map((x) => x.id));
  eq(menu, ['btn-share', 'btn-save', 'btn-load', 'btn-bomcsv', 'btn-mwlist'], 'export menu');
  await page.click('#btn-help'); await page.waitForTimeout(200);
  ok(await page.locator('#dlg-help').isVisible(), 'help open');
  ok((await page.textContent('#help-body')).includes('Raststift'), 'help explains the snap pin');
});
await test('Adapter slots: tunnel swap splits the lower straight (cross tunnel 32), omit drops the adapter (URL ~)', async () => {
  // the crossing is in the middle (cross tunnel 32)
  const CROSS = ['StartSchale_60', 'Gerade120_60-50', 'Kurve90_50-40', 'Kurve90_40', 'SchieneRutsche120_100-60', 'SchieneBremse120_60-60_K607',
    'SchieneLangeKurveBank90_R90_60_v2', 'SchieneGerade120_60-50', 'SchieneGerade120_50-40', 'Kurve90_40', 'Gerade120_40-40',
    'Gerade60_40-40', 'Kurve90_40', 'Gerade120_40-40', 'Gerade120_40-40', 'Gerade120_40-40', 'Gerade120_40-40', 'EndSchale_40'];
  await fresh({ hash: hashOf(...CROSS) });
  eq((await ids()).length, 18, 'chain loaded');
  const collisions = async () => (await page.$$eval('#issues-list li', (l) => l.map((x) => x.textContent))).filter((t) => /AdapterGerade120_16mm/.test(t) && /kollidiert/.test(t));
  ok((await collisions()).length > 0, 'adapter collision reported');
  await page.click('#chain-list li[data-idx="1"]'); await page.waitForTimeout(300);
  ok(await page.locator('#detail-section .slot button[data-tunnel]').isEnabled(), 'tunnel button enabled');
  await page.click('#detail-section .slot button[data-tunnel]'); await page.waitForTimeout(1200);
  const after = await ids();
  ok(after.includes('AdapterTunnelQuer120_40-40_Q32'), 'cross tunnel in the chain: ' + after.join(','));
  eq((await collisions()).length, 0, 'adapter collision gone');
  await page.click('#btn-undo'); await page.waitForTimeout(600);
  eq((await ids()).length, 18, 'undo');
  await page.click('#chain-list li[data-idx="1"]'); await page.waitForTimeout(300);
  await page.click('#detail-section .slot button[data-omit]'); await page.waitForTimeout(800);
  eq(await kb('s.elements[1].omit'), [0], 'slot 0 omitted');
  ok((await page.evaluate(() => location.hash)).includes('~0'), 'omit in the URL');
  eq((await collisions()).length, 0, 'no adapter collision any more');
  await page.click('#detail-section .slot button[data-omit]'); await page.waitForTimeout(800);
  eq(await kb('s.elements[1].omit ?? null'), null, 'adapter restored');
});
await test('Palette = release: without the extras switch no hills/zigzags/loops/offset parts; tunnels as a variant, X crossing included', async () => {
  await fresh(); await page.uncheck('#chk-compatible'); await page.waitForTimeout(400);
  const gs = await cards();
  ok(!gs.some((g) => /huegel|zickzack|looping|versatz/.test(g)), 'extras visible: ' + gs.join(','));
  const kinds = await page.$$eval('.pcard[data-g=straight] select[data-dim=kind] option', (o) => o.map((x) => x.value));
  eq(kinds, ['groove', 'rail', 'tunnel-hex', 'tunnel-slot', 'tunnel-closed'], 'variants of the straight');
  ok(gs.includes('crossing'), 'X crossing missing');
  await page.selectOption('.pcard[data-g=straight] select[data-dim=kind]', 'tunnel-hex'); await page.waitForTimeout(200);
  eq(await page.$$eval('.pcard[data-g=straight] select[data-dim=len], .pcard[data-g=straight] .pc-fixed', (o) => o.map((x) => x.value ?? x.textContent)), ['120 · 64 mm', '60 → 50'], 'tunnel: fixed length and rim');
  await page.click('.chip[data-chip=curve]'); await page.waitForTimeout(300);
  eq(await cards(), ['curve', 'longCurve'], 'curves chip');
  eq(await page.evaluate(() => localStorage.getItem('kb16-chip')), 'curve', 'chip remembered');
  await page.fill('#search', 'bank'); await page.waitForTimeout(300);
  eq(await cards(), ['longCurve'], 'search finds the banked curve');
  ok((await page.textContent('.pcard[data-g=longCurve] .pc-dims')).includes('Schiene geneigt'), 'only the matching variant');
  await page.fill('#search', ''); await page.click('.chip[data-chip=all]'); await page.waitForTimeout(200);
});
await test('Lift: one card with height 1..10, direction via ghost, height and exit in the detail panel; BOM lists the modules; Lift-Rundkurs demo', async () => {
  await fresh();
  eq(await page.$$eval('.pcard[data-g=lift] select[data-dim=h] option', (o) => o.map((x) => x.value)), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], 'heights');
  ok((await page.$$eval('.pcard[data-g=lift] select[data-dim=h] option', (o) => o.map((x) => x.textContent)))[6].includes('ungeprüft'), '+7 untested');
  await page.selectOption('.pcard[data-g=lift] select[data-dim=h]', '1');
  await page.click('.pcard[data-g=lift] .pc-add'); await page.waitForTimeout(600);
  eq(await kb('s.choice.map((c) => c.key)'), ['straight', 'left', 'back', 'right'], 'four directions');
  await page.click('#choice-bar button[data-key=straight]'); await page.waitForTimeout(500);
  eq(await ids(), ['Lift1_Gerade'], 'lift added');
  ok(await page.locator('#d-dir').isVisible(), 'rotate-exit button');
  await page.click('#d-dir'); await page.waitForTimeout(500);
  eq(await ids(), ['Lift1_Links'], 'head rotated');
  await page.selectOption('#detail-section select[data-ddim=h]', '2'); await page.waitForTimeout(500);
  eq(await ids(), ['Lift2_Links'], 'height in the detail panel');
  eq(await kb('s.selected'), 0, 'selection stays on the lift');
  const bomText = await page.textContent('#bom');
  ok(bomText.includes('LiftMitte_16mm') && bomText.includes('LiftKurbel_16mm') && !bomText.includes('Lift2_Links'), 'BOM: ' + bomText.slice(0, 200));
  await add('straight', { kind: 'groove', len: '120', rim: '60-50' });
  eq(await kb('s.layout.placed[1].S'), 64, 'straight at level 64');
  await page.click('#chain-list li[data-idx="0"]'); await page.waitForTimeout(200);
  await page.selectOption('#detail-section select[data-ddim=h]', '10'); await page.waitForTimeout(600);
  eq(await ids(), ['Lift10_Links', 'Gerade120_60-50'], 'lift +10');
  eq(await kb('s.layout.placed[1].S'), 320, 'straight at level 320');
  ok((await page.textContent('#detail-section')).includes('ungeprüft'), 'untested hint');
  await loadDemo(6);
  eq((await ids())[0], 'Lift1_Gerade', 'demo starts with the lift');
  eq(await kb('s.layout.ring'), true, 'loop');
  ok((await page.textContent('#issues-list')).includes('Rundkurs'), 'loop hint');
  eq(await kb('s.layout.issues.filter(i => i.level === "error").length'), 0, 'no errors');
});
await test('Flip-flop: direction via ghost, switch exit; BOM lists body, rocker and axle pin', async () => {
  await fresh();
  await add('start');
  await page.click('.pcard[data-g=flipflop] .pc-add'); await page.waitForTimeout(600);
  eq(await kb('s.choice.map((c) => c.key)'), ['left', 'right'], 'two exits');
  await page.click('#choice-bar button[data-key=left]'); await page.waitForTimeout(600);
  eq(await ids(), ['StartSchale_60', 'Kippwippe_120-60_Links'], 'flip-flop added');
  eq(await kb('s.layout.placed.map(q => q.S)'), [32, 0], 'flip-flop on the floor');
  await page.click('#d-dir'); await page.waitForTimeout(600);
  eq(await ids(), ['StartSchale_60', 'Kippwippe_120-60_Rechts'], 'exit switched');
  eq(await kb('s.selected'), 1, 'selection stays on the flip-flop');
  const bomText = await page.textContent('#bom');
  ok(bomText.includes('Kippwippe_Wippe_16mm') && bomText.includes('Kippwippe_Achsstift_16mm') && !bomText.includes('Kippwippe_120-60_Rechts') && !bomText.includes('Ansicht'), 'BOM: ' + bomText.slice(0, 300));
  eq(await kb('s.layout.issues.filter(i => i.level === "error").length'), 0, 'no errors');
});
await test('Branch: build a strand from the second flip-flop exit; list by strand, link, storage; deleting removes it, undo restores it', async () => {
  eq(await kb('s.layout.freePorts.map(f => [f.idx, f.port, f.kind])'), [[1, 3, 'branch']], 'free exit');
  // click the arrow at the free exit in 3D (instead of the button in the detail panel)
  await page.click('#d-close'); await page.waitForTimeout(200);
  const mk = await kb('s.markerAt(1, 3)'); ok(mk, 'marker');
  const box = await page.locator('#c3d').boundingBox();
  await page.mouse.click(box.x + mk[0], box.y + mk[1]); await page.waitForTimeout(500);
  eq(await kb('s.branchFrom'), { idx: 1, port: 3 }, 'branch mode');
  ok((await page.textContent('#mode-line')).includes('Abzweig'), 'mode line');
  await add('straight', { kind: 'groove', len: '120', rim: '60-50' });
  eq(await kb('s.branchFrom'), null, 'mode off');
  eq(await kb('s.insertAfter'), 2, 'continues on the branch');
  await add('curve', { kind: 'groove', rim: '50-40' }, 'left');
  await add('end');
  eq(await ids(), ['StartSchale_60', 'Kippwippe_120-60_Rechts', 'Gerade120_60-50', 'Kurve90_50-40', 'EndSchale_40'], 'chain');
  eq(await kb('s.plain[2].branch'), { from: 1, port: 3 }, 'anchor');
  eq(await kb('s.layout.strands.map(s => s.idxs)'), [[0, 1], [2, 3, 4]], 'two strands');
  eq(await page.locator('#chain-list li.strand-head').count(), 2, 'two strand headers');
  ok((await page.textContent('#chain-list')).includes('Abzweig 1'), 'branch 1 in the list');
  ok((await page.evaluate(() => location.hash)).includes('@1:3'), 'link carries the anchor');
  eq(await kb('s.steps[2].vIn'), 180, 'branch starts at the flip-flop speed');
  eq(await kb('s.layout.issues.filter(i => i.level === "error").length'), 0, 'no errors');
  // continue the main strand via its strand header
  await page.click('#chain-list li.strand-head[data-strand="0"] button[data-cont]'); await page.waitForTimeout(300);
  eq(await kb('s.insertAfter'), 1, 'continue main strand');
  ok((await page.textContent('#mode-line')).includes('Hauptstrang'), 'mode line: continue');
  await page.keyboard.press('Escape');
  // reload: restored from storage
  await page.evaluate(() => { history.replaceState(null, '', location.pathname); });
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  eq(await kb('s.layout.strands.length'), 2, 'two strands after reload');
  // deleting the flip-flop removes the branch too; undo
  await page.click('#chain-list li[data-idx="1"]'); await page.waitForTimeout(200);
  await page.keyboard.press('Delete'); await page.waitForTimeout(500);
  eq(await ids(), ['StartSchale_60'], 'branch removed too');
  ok((await page.textContent('#toast')).includes('Abzweig'), 'hint');
  await page.keyboard.press('Control+z'); await page.waitForTimeout(500);
  eq((await ids()).length, 5, 'undo');
  eq(await kb('s.layout.strands.length'), 2, 'undo: two strands');
});
await test('Flip-flop with crossing demo: branch passes through the free lane; cross lane in the detail panel; curve picks the free direction itself', async () => {
  await fresh(); await loadDemo(7);
  eq(await kb('s.layout.issues.filter(i => i.level === "error").length'), 0, 'no errors');
  eq(await kb('s.layout.placed.filter(q => q.via).map(q => q.via.idx)'), [3], 'passes through part 4');
  ok((await page.textContent('#chain-list')).includes('durch 4.'), 'list shows the pass-through');
  await page.click('#chain-list li[data-idx="3"]'); await page.waitForTimeout(300);
  ok((await page.textContent('#detail-section')).includes('befahren von'), 'cross lane in use');
  await page.selectOption('#detail-section select[data-ddim=cross]', 'right'); await page.waitForTimeout(600);
  ok((await kb('s.layout.issues.filter(i => i.level === "error").length')) > 0, 'the other cross lane does not fit here');
  await page.keyboard.press('Control+z'); await page.waitForTimeout(500);
  eq(await kb('s.layout.issues.filter(i => i.level === "error").length'), 0, 'undo');
  // automatic direction: after two left curves the long curve only fits to the right
  await fresh({ hash: hashOf('StartSchale_60', 'Kurve90_60', 'Kurve90_60') });
  await page.selectOption('.pcard[data-g=longCurve] select[data-dim=rim]', '60-60');
  await page.click('.pcard[data-g=longCurve] .pc-add'); await page.waitForTimeout(600);
  ok(await page.locator('#choice-bar').isHidden(), 'no choice needed');
  eq((await ids())[3], 'LangeKurve90_R90_60*', 'added to the right');
  ok((await page.textContent('#toast')).includes('Platz'), 'hint: only room there');
});
await test('Detail panel: switching the variant (groove -> rail) replaces the part in place', async () => {
  await fresh(); await loadDemo(1);
  await page.click('#chain-list li[data-idx="3"]'); await page.waitForTimeout(200);
  await page.selectOption('#detail-section select[data-ddim=kind]', 'rail'); await page.waitForTimeout(500);
  eq((await ids())[3], 'SchieneGerade120_40-40', 'rail');
  eq(await kb('s.selected'), 3, 'selection stays');
  const lens = await page.$$eval('#detail-section select[data-ddim=len] option', (o) => o.map((x) => x.value));
  eq(lens, ['60', '80', '100', '120'], 'lengths of the rail straight');
});

await test('Grid helpers: grid line at the open end, connect closes the lift loop, lanes + tunnel approach, demos with cross tunnel 32', async () => {
  await fresh({ hash: hashOf('Lift1_Gerade', 'Gerade120_60-60') });
  ok((await page.textContent('#open-end')).includes('Raster: längs'), 'grid line');
  eq(await kb('s.connectGoals'), ['ring', 'tun:1:0'], 'goals: loop and cross tunnel under the straight');
  await page.click('#btn-connect'); await page.waitForTimeout(200);
  await page.click('#connect-goals button[data-goal="0"]');
  await page.waitForSelector('#connect-results button[data-apply]', { timeout: 20000 });
  const n0 = (await ids()).length;
  await page.click('#connect-results button[data-apply="0"]'); await page.waitForTimeout(800);
  eq(await kb('s.layout.ring'), true, 'loop closed');
  ok((await ids()).length > n0, 'parts added');
  ok(await page.locator('#dlg-connect').isHidden(), 'dialog closed');
  await page.keyboard.press('Control+z'); await page.waitForTimeout(500);
  eq((await ids()).length, n0, 'undo reverts the connection');
  // straight with a 120 adapter on top, open below: lanes marked, goal cross tunnel, approach + tunnel replace the adapter
  await fresh({ hash: hashOf('StartSchale_60', 'Gerade120_60-50', 'LangeKurve90_R90_50-40', 'Rutsche120_100-60') });
  eq((await kb('s.laneMarkers')).length, 3, 'three lanes (16 / 32 / 48)');
  eq(await kb('s.connectGoals'), ['tun:1:0'], 'goal: cross tunnel under part 2');
  await page.click('#btn-connect');
  await page.waitForSelector('#connect-results button[data-apply]', { timeout: 30000 });
  await page.click('#connect-results button[data-apply="0"]'); await page.waitForTimeout(800);
  ok((await ids()).some((x) => x.startsWith('AdapterTunnelQuer120_40-40_Q32')), 'cross tunnel added');
  eq(await kb('s.layout.adapters.filter(a => a.owner === 1).length'), 0, 'adapter replaced');
  eq(await kb('s.layout.issues.filter(i => i.level === "error").length'), 0, 'no errors');
  // detail panel of the straight: lane hint while nothing crosses
  await fresh({ hash: hashOf('StartSchale_60', 'Gerade120_60-50', 'LangeKurve90_R90_50-40', 'Rutsche120_100-60') });
  await page.click('#chain-list li[data-idx="1"]'); await page.waitForTimeout(300);
  ok((await page.textContent('#detail-section')).includes('Fahrspuren bei 16 / 32 / 48 mm'), 'slot hint');
  // demos
  const names = await page.$$eval('#menu-demo button', (b) => b.map((x) => x.textContent));
  const iB = names.findIndex((x) => x.startsWith('Tunnel-Brezel')), iA = names.findIndex((x) => x.startsWith('Endlos-Acht'));
  ok(iB >= 0 && iA >= 0, 'demos in the menu');
  await loadDemo(iA + 1);
  eq(await kb('s.layout.ring'), true, 'Endlos-Acht is a loop');
  eq(await kb('s.layout.issues.filter(i => i.level === "error").length'), 0, 'Endlos-Acht without errors');
});

await test('Y merge: direction = inlet via ghost, switch inlet, free inlet as a connect goal', async () => {
  await fresh();
  await add('start'); await add('straight', { kind: 'groove', len: '120', rim: '60-60' });
  await page.click('.pcard[data-g=ymerge] .pc-add'); await page.waitForTimeout(600);
  eq(await kb('s.choice.map((c) => c.key)'), ['left', 'right'], 'two inlets');
  await page.click('#choice-bar button[data-key=right]'); await page.waitForTimeout(600);
  eq(await ids(), ['StartSchale_60', 'Gerade120_60-60', 'YMerge120_60-60'], 'Y added');
  eq(await kb('s.elements[2].lane ?? 0'), 0, 'lane 0 = inlet +y');
  ok((await page.textContent('#detail-section')).includes('Zweiter Eingang frei'), 'free inlet hint');
  await page.click('#d-dir'); await page.waitForTimeout(600);
  eq(await kb('s.elements[2].lane ?? 0'), 1, 'inlet switched');
  eq(await kb('s.layout.freePorts.filter(f => f.kind === "lane").map(f => f.idx)'), [2], 'free inlet');
  eq(await kb('s.connectGoals'), ['lane:2'], 'goal: free inlet');
  eq(await kb('s.layout.issues.filter(i => i.level === "error").length'), 0, 'no errors');
  // demo: the flip-flop splits, the branch merges into the free inlet of the Y
  const names = await page.$$eval('#menu-demo button', (b) => b.map((x) => x.textContent));
  const iY = names.findIndex((x) => x.startsWith('Kippwippe und Y-Merge'));
  ok(iY >= 0, 'demo in the menu');
  await loadDemo(iY + 1);
  eq(await kb('s.layout.strands.length'), 2, 'two strands');
  eq(await kb('s.layout.issues.filter(i => i.level === "error").length'), 0, 'demo without errors');
  ok((await page.textContent('#issues-list')).includes('Mündet in den freien Eingang'), 'merge hint');
  ok((await page.textContent('#chain-list')).includes('mündet in 6.'), 'track list: merges into 6.');
  if (process.env.KB_SHOT) await page.screenshot({ path: process.env.KB_SHOT });
});

await test('Escape after an earlier OK does not clear, Delete behind a dialog does not delete, printer size fields only for a custom size', async () => {
  await fresh(); await loadDemo(1);
  const n0 = (await ids()).length;
  // confirm "New" once, rebuild, then "New" + Escape: the earlier "ok" must not count again and clear the track
  await page.click('#btn-new'); await page.locator('#dlg-confirm').waitFor({ state: 'visible' });
  await page.click('#dlg-confirm button[value=ok]'); await page.waitForTimeout(400);
  eq((await ids()).length, 0, 'cleared with OK');
  await loadDemo(1);
  await page.click('#btn-new'); await page.locator('#dlg-confirm').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  eq((await ids()).length, n0, 'Escape cancels');
  // part selected, help open: Delete/Backspace and Ctrl+Z do not affect the track behind the dialog
  await page.click('#chain-list li[data-idx="2"]'); await page.waitForTimeout(200);
  await page.click('#btn-help'); await page.locator('#dlg-help').waitFor({ state: 'visible' });
  await page.keyboard.press('Delete'); await page.keyboard.press('Backspace'); await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
  eq((await ids()).length, n0, 'nothing deleted');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  // printer size: fields visible only for a custom size (a display rule must not override [hidden])
  await page.selectOption('#sel-printer', 'a1'); await page.waitForTimeout(200);
  ok(await page.locator('#plate-custom').isHidden(), 'fields hidden for A1');
  await page.selectOption('#sel-printer', 'custom'); await page.waitForTimeout(200);
  ok(await page.locator('#plate-custom').isVisible(), 'fields visible for a custom size');
  await page.selectOption('#sel-printer', 'a1'); await page.waitForTimeout(200);
});
await test('A new share link in an open tab is loaded; loading JSON restores the ball-check settings', async () => {
  await fresh({ hash: hashOf('StartSchale_60', 'Gerade120_60-50') });
  eq(await ids(), ['StartSchale_60', 'Gerade120_60-50'], 'first link');
  await page.evaluate((h) => { location.hash = h; }, hashOf('StartSchale_60', 'Gerade120_60-60', 'Rutsche_120-60').slice(1) + '&s=g');
  await page.waitForTimeout(800);
  eq(await ids(), ['StartSchale_60', 'Gerade120_60-60', 'Rutsche_120-60'], 'second link loaded');
  eq(await kb('s.edition'), 'plain', 'edition from the link');
  await page.click('#btn-undo'); await page.waitForTimeout(400);
  eq(await ids(), ['StartSchale_60', 'Gerade120_60-50'], 'undo back to the first');
  // JSON with push 300 / rolling resistance 0.005 / 16.8 g: the values are restored
  const json = { format: 'kugelbahn16-builder/1', edition: 'japandi', sim: { v0: 300, crr: 0.005, mass: 16.8 }, chain: [{ part: 'StartSchale_60_16mm' }, { part: 'Gerade120_60-50_16mm' }] };
  await page.setInputFiles('#file-load', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });
  await page.waitForTimeout(800);
  eq(await page.textContent('#out-v0'), '300 mm/s', 'push');
  eq(await page.textContent('#out-crr'), '0.005', 'rolling resistance');
  eq(await page.inputValue('#inp-mass'), '16.8', 'ball mass');
  eq(await kb('Math.round(s.steps[0].vOut)'), 300, 'ball check uses the loaded push');
});
await test('"Connect" at the end of any strand: a branch leads into the entrance of part 1, the main strand closes the loop', async () => {
  // lift -> flip-flop -> straight (main strand, loop possible); branch at the flip-flop -> straight (last list entry)
  const c = (n) => CODES[n + '_16mm'];
  await fresh({ hash: '#t=m1.' + [c('Lift1_Gerade'), c('Kippwippe_120-60_Links'), c('Gerade120_60-60'), c('Gerade120_60-60') + '@1:3'].join('.') + '&s=j' });
  eq(await kb('s.layout.strands.length'), 2, 'two strands');
  // open end = end of the branch: Connect starts there; its goal is the entrance of part 1 (the loop is the main strand's)
  eq(await page.locator('#btn-connect').count(), 1, 'connect at the end of the branch');
  const goals = await kb('s.connectGoals');
  eq(goals, ['entry'], 'branch goal: entrance of part 1, not the loop');
  // the flip-flop outlet is off the grid: no route, the dialog names the part that causes it
  await page.click('#btn-connect'); await page.waitForTimeout(200);
  await page.waitForFunction(() => /2\. (FlipFlop|Kippwippe)/.test(document.querySelector('#connect-results')?.textContent ?? ''), null, { timeout: 20000 });
  eq(await page.locator('#connect-results button[data-apply]').count(), 0, 'no suggestion');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  // "continue strand" on the main strand: Connect closes the loop from there
  await page.click('#chain-list li.strand-head[data-strand="0"] button[data-cont]'); await page.waitForTimeout(400);
  eq(await page.locator('#btn-connect').count(), 1, 'connect at the end of the main strand');
  ok((await kb('s.connectGoals')).includes('ring'), 'main strand goal: the loop');
});

await test('"Connect" re-fills a straight run: the branch ends 7.5 mm short behind a Y merge, Distanz46 becomes a Gerade60; undo', async () => {
  await fresh({ hash: '#t=m1.9.23.x.u.c.2w.g.2h.12@7:2.y*.g.d.s*.9.52&s=j' });
  const ids0 = await ids();
  await page.click('#btn-connect'); await page.waitForTimeout(200);
  const goals = await kb('s.connectGoals');
  await page.click(`#connect-goals button[data-goal="${goals.indexOf('entry')}"]`);
  await page.waitForSelector('#connect-results button[data-apply]', { timeout: 20000 });
  eq(await page.locator('#connect-results .connect-row svg.cp').count(), await page.locator('#connect-results button[data-apply]').count(), 'a top-view preview per suggestion');
  eq(await page.locator('#connect-results .connect-row').first().locator('svg.cp .cp-new').count(), 1, 'preview: one new part');
  await page.click('#connect-results button[data-apply="0"]'); await page.waitForTimeout(800);
  const after = await ids();
  eq(after.length, ids0.length, 'one part replaced, none added');
  eq([after[13], after[14]], ['Gerade60_40-40', 'YMerge120_40-40'], 'Distanz46 -> Gerade60, the Y merge stays');
  eq(await kb("s.layout.issues.filter((i) => i.level === 'error').length"), 0, 'no errors');
  await page.click('#btn-undo'); await page.waitForTimeout(400);
  eq(await ids(), ids0, 'undo reverts the change');
});

await browser.close(); server.close();
const fails = results.filter((r) => r[1] !== 'ok');
console.log(`\n${results.length - fails.length}/${results.length} UI tests ok`);
if (fails.length) { for (const f of fails) console.log('FAIL', f[0], f[2]); process.exit(1); }
