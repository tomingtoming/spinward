---
origin: ai
created: 2026-09-13
---

# Bulkhead structural bays and metric cladding

References `izma-0041` and `izma-0044` distinguish large wall divisions from
supported infrastructure at human scale. Only that distinction informs this
original surface treatment. Source hashes and remaining gates, conduits and
walkway work are in the reference manifest; no image, character, combat effect
or original lettering enters the asset set.

## Checklist and reproduction

- Far wall: large radial/annular bays replace oversized control-board rectangles
  and coloured emission marks. Fine cladding must not form a distant grid.
- Oblique wall: major joints remain smooth when the disk's texture is magnified.
- Near wall: staggered rectangular cladding; six-by-three metres is established
  by local metric shader coordinates, not measured from screenshot pixels.
- Structural rim/hub/window spokes: plain material, no stretched planar decal.
- Topology: Izma keeps both opaque ends; small end-lit cylinder keeps its -Y
  bulkhead and +Y daylight glazing; Elysium remains an open ring.
- Night: no new glowing surface or indicator. Existing ambient illumination
  produces a dark wall; nighttime maintenance navigation is not provided here.
- Stereo: wall remains visible in both eyes through 0/±25° roll, with no holes,
  detached surface pattern or one-eye loss. Mechanical projection must place
  the intended target inside the camera; a stable off-screen mesh is inadequate.

Build and verify preview ownership, then freeze `dist/` through these runs:

```sh
SPINWARD_URL=https://127.0.0.1:<preview-port> LABEL=reviewed TIER=desktop node qa/neighborhood-life/bulkheads.mjs
SPINWARD_URL=https://127.0.0.1:<preview-port> LABEL=reviewed TIER=quest node qa/neighborhood-life/bulkheads.mjs
SPINWARD_URL=https://127.0.0.1:<preview-port> bun run test:xr
```

Fixtures use fixed flight poses and zero rotation for repeatable material views;
these are not walking/clearance tests. Existing XR UI scenarios retain their
ordinary rotation/gravity and actual wrist/controller entry/exit/re-entry.
All browsers are fixture-owned and reject software WebGL rendering.

## Change and bounded cost

The old 512×512 map drew 96 control/hatch outlines and coloured marks across a
6.4 km disk, then wrapped the same graphic around torus and spoke geometry.
Disk and frame now have separate materials. A low-contrast map only varies the
large bays' colour; analytic, derivative-filtered joints remove enlarged raster
steps. Metric 6×3 m staggered cladding fades with pixel footprint at distance.
Both materials have zero emission and no new light or shadow pass is added.
The unused disk emission image shrinks from 512×512 to a black 1×1 texel.

Geometry and pressure-shell topology are unchanged: Izma 1,520 triangles
(1,392 frame + 128 disk); small cylinder 1,792 (1,728 + 64); open ring 1,152
(frame only). A solid-end habitat adds one material/mesh draw; the shader adds
surface calculations. These counts are not a measured frame-rate improvement.
No Blender asset, collider, wall thickness or real maintenance access is added.

## Review findings retained

Initial `after` captures passed the main scale/material checks. Independent
image review found blurred, stair-stepped joints in the oblique view, leading
to the analytic-joint correction. It also noted weak nighttime wall/frame
contrast. The wall remains non-emitting, dark under existing night light;
new supported maintenance lighting is a separate future scope. Existing low
polygon rim faceting and the old rim-edge dark strip are not changed here.
Final captures use `reviewed`, preserving the initial comparisons.

## Verified results

- Unit tests: **867 pass, 0 fail**, across 147 files; TypeScript and production
  build pass. The existing Vite large-chunk warning remains. The new test uses
  actual meshes and ray intersections to verify both opaque ends, the small
  daylight opening, open ring, triangle counts and disposal on dimension change.
- Hardware Chrome desktop and Quest budgets each completed nine material
  views with no page or console errors. Actual maps contain zero emitting
  texels; actual frame materials have no map. The first ring view was obscured
  by existing centre equipment, so its absence-of-cap check was mechanical
  only. An axial outside view was also unsuitable: the normal share-pose limits
  clamped 40,000 m to 2,000 m and left it facing the centre equipment. The
  fixture now checks its actual start position and uses an off-axis 25,000 m
  radial / 1,800 m axial view. `LABEL=ring-clear VIEW=ring` passed both budgets;
  the off-axis captures show the band rim with unobstructed stars on both
  sides, and actual position agrees with the requested fixture.
- Final independent image review confirms the oblique staircase/dotted
  artifacts are gone in both budgets, with no newly observed holes, wrapped
  frame art or extra emission. The near macro joints are broad dark bands;
  fine cladding is deliberately subtle. Night detail remains hard to inspect.
- Full **playwright-webxr 0.2.0: 17 tests / 19 sessions / 19 exits**, PASS in
  4.2 minutes, including actual wrist/controller interaction and both entry
  routes' exit/re-entry. New port and cladding scenarios keep opaque materials,
  geometry matrices and an on-screen target at 0/±25° in stereo. Both eye
  viewports are 1280×960. No page/console errors in the two new scenarios.
- Independent review of all six stereo captures found matching surfaces in
  both eyes through the three sampled rolls, no observed one-eye loss or
  detached pattern. Fine cladding needed full-resolution inspection. These
  sampled poses do not prove the absence of all continuous-motion shimmer.
- GPU: Apple M1 Pro / ANGLE Metal; Chrome 152.0.7977.83. These are emulated
  sessions; physical Quest performance, comfort and visibility are unmeasured.
- Tested fixed asset: `/assets/index-C-m4C9WJ.js`. Logs, full-suite captures,
  diagnostics and the tested bundle are preserved under
  `qa/webxr/evidence/bulkheads-20260913/` (ignored). Postcommit proof checks
  preview ownership, exact served/dist bytes and equality to the tested bundle
  apart from its embedded build ID. Local source changes are not published.
