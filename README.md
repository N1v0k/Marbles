# Marble Run Builder 16 mm

Browser-based builder for the modular 3D-printed marble run for 16 mm marbles (snap-pin system). It runs entirely in
the browser, with no backend. Vite, TypeScript and three.js; English by default, German via the language switch.

Live: https://n1v0k.github.io/Marbles/

## Features

- **Build a track:** pick a base part in the parts list, set the variant, tap to attach it at the open end (direction
  automatic or chosen via ghosts in the 3D view). Insert, delete, replace, reverse, undo/redo; branches at the
  flip-flop and the X crossing; the Y merge joins two strands.
- **Levels and adapters:** levels are 32 mm apart. Every part above level 0 gets its adapter tower automatically;
  towers of the same level are coupled where their end sockets face each other. Snap pins are counted per joint,
  tower step and coupling.
- **Checks:** collisions (footprint polygons per level, adapter towers) and a ball check with an energy model per part
  (push, rolling resistance and ball mass adjustable); closed loops and merges are detected automatically.
- **3D view:** simplified preview meshes, ball path coloured by speed, grid helpers and a connect assistant.
- **Editions:** Japandi (grooved parts, default) and plain. Colours: family colours or Bambu Studio filaments per
  group (track, rail, adapter, accent).
- **Output:** parts list (CSV), print plan (Markdown), plate list for the release print profile, 3MF of all levels,
  the track in one piece as 3MF, JSON save/load, share link (`#t=m1.<codes>&s=j|g&c=<colours>`).

### 3MF export

The 3MF exports need the print profile of the matching edition from MakerWorld (the all-parts 3MF). Drop it onto the
page: the builder reads the part meshes from it (`src/meshes3mf.ts`). The file stays in memory for the current tab
only; it is not uploaded or stored. Bambu Studio stores each mesh centred on its bounding box; `src/data/print_ref.json`
holds per-part reference values (triangle count, bounding box, volume) that identify the parts and the edition and move
the meshes back into part coordinates. A part that does not match falls back to its preview mesh, and the export says so.

## Project layout

```
index.html, src/            app: main.ts (UI), chain.ts (solver), catalog.ts, groups.ts (parts list), connect.ts,
                            grid.ts, tunnel.ts, footprint.ts, physics.ts, plates.ts, printers.ts, threemf.ts,
                            assembly.ts + asm3mf.ts (one piece), meshes3mf.ts, mwkey.ts, export.ts, state.ts,
                            colors.ts, i18n.ts, viewer3d.ts, kbm.ts
src/data/                   parts.json (catalog), demos.json, filaments.json, print_ref.json, thumbs*.json,
                            bambu_project_settings_release.config (project settings written into 3MF exports)
src/meshes/, src/meshes_j/  preview meshes (KBM3; Japandi: grooved parts only)
tools/                      data pipeline (Python + Node); paths in tools/config.json
test/                       unit tests (vitest), test/ui/run.mjs (Playwright), test/tools_test.py (pipeline)
```

Generated print meshes (`public/print*/*.kbm.gz`) are local only: the pipeline and the tests use them, the build does not.

## Build and test

```
npm install
npm run dev            # http://localhost:5173
npm run build          # dist/ (public build)
npm run build:dev      # dist/ with developer UI (per-level 3MF, extra parts, no MakerWorld ID check)
npm run build:single   # dist-single/index.html, one self-contained file
npm run typecheck
npm test               # unit tests
npm run test:ui        # UI scenarios (Playwright/Chromium) against dist/
npm run test:tools     # pipeline tests
```

- `npm run test:ui` works with either build in `dist/` and needs the release print profiles (`../Release`,
  `../Japandi/Release`, or `KB_3MF_PLAIN` / `KB_3MF_JAPANDI`). `KB_DIST=dist-single` tests the single-file build,
  `KB_ONLY=<regex>` runs matching scenarios only, `CHROMIUM=<path>` sets the browser.
- Unit tests that need local data run only when it is there: the comparison with the release profiles (needs
  `public/print*`) and, with `KB_E2E=1`, the end-to-end one-piece export. `KB_3MF=1` compares all parts,
  `KB_CSV=<file>` writes the comparison table.
- GitHub Actions (`.github/workflows/pages.yml`) type-checks, tests, builds and deploys `dist/` to GitHub Pages on
  every push to `main`.

## Data pipeline

The catalog and meshes are generated from the STL exports (paths in `tools/config.json`, relative to this folder;
the exports are not part of the repository).

```
python tools/build_catalog.py         # catalog: sockets, adapters, physics, filament/time -> src/data/parts.json
python tools/convert_meshes.py        # preview meshes (src/meshes, src/meshes_j); --plain / --japandi: one edition only
python tools/convert_print_meshes.py  # print meshes (public/print, public/print_j); optional: <out dir> <part ...>
python tools/print_ref.py             # reference values -> src/data/print_ref.json (after any part change)
node tools/render_thumbs.mjs          # thumbnails (needs: npm i --no-save playwright); --new: missing ones only
npm run catalog                       # all five in order
python tools/filament_colors.py       # src/data/filaments.json from tools/bambu/; --fetch downloads the list again
```

- `tools/stl16.py` measures the sockets on each STL. `build_catalog.py` also reads the release 3MF (plate, print
  orientation and per-object settings per part) and the English part names. Filament and print time come from a
  least-squares fit on the sliced plates of the release profiles (`tools/plate_stats*.json`, `tools/calib.json`).
- URL codes in `tools/codes.json` are stable: new parts get new codes, existing codes are never reassigned.
- New parts: export the STL into the export folder, then run `npm run catalog`. Special values (physics limits,
  notes) are set in `build_catalog.py`.
- `tools/bambu/filaments_color_codes.json` is a copy of the filament colour list from Bambu Studio (AGPL-3.0,
  https://github.com/bambulab/BambuStudio/blob/master/resources/profiles/BBL/filament/filaments_color_codes.json).
- Python: numpy, trimesh, pymeshlab (`convert_print_meshes.py` and `print_ref.py` need numpy only).

## Model assumptions

- Collisions are footprint × height range per level, not mesh booleans.
- Physics limits are computed guide values; only the rolling resistance was measured.
- Filament and time per part come from a linear fit (area, volume, count, setup time per plate); small parts such as
  the snap pin tend to be overestimated.
