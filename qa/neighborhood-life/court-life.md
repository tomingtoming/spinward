---
origin: ai
created: 2026-09-13
---
# Old Town courtyard life

Reuses the existing Blender balcony chair/table and colony planter/foliage
sources in native metres. One already certified Old Town court receives two
chairs, one small side table and three pots. No new asset, light, texture,
building, road or paving is added. The original source images remain external.

The placement is conditional on the existing clear court plus its street
connection. The current desktop city has one fitting site; the 16000/18000
building budgets have none. Those budgets receive no furniture, colliders or
seat prompts. Do not force furniture onto an unpaved or blocked substitute.

The 1.4m central corridor keeps another 0.5m lateral clearance from props.
Standing areas and their lateral connections to the corridor are checked with
the .32m player sphere. Chairs use the actual .44m Blender seat, .18m body-rig
offset and a 1.23m clear exit in front. The .12m paving stays authoritative.
Permanent simplified solids survive LOD and asset failure; fallback chairs
retain seats, backs and legs. Shared cached source geometries are not disposed
by this layer. Seated interaction follows the existing flat-mode E-key behavior;
it does not introduce VR seating or a route to occupied rooftop terraces.

```sh
SPINWARD_URL=https://127.0.0.1:5192 LABEL=reviewed node qa/neighborhood-life/court-life.mjs
SPINWARD_URL=https://127.0.0.1:5192 LABEL=reviewed TIER=quest node qa/neighborhood-life/court-life.mjs
SPINWARD_URL=https://127.0.0.1:5192 LABEL=fallback VIEWS=near ASSET_FAILURE=1 node qa/neighborhood-life/court-life.mjs
SPINWARD_URL=https://127.0.0.1:5192 bun run test:xr
```

Use an owned production preview; keep its build frozen during testing. The
hardware GPU preflight rejects software rendering. The desktop fixture reads
live matrices and compares them with the plan, verifies pot bottoms and permanent
collider installation, uses real E/W input and records scene errors. Quest checks
the deliberate absence of an uncertified court. The XR fixture uses desktop city
geometry to inspect this court; the suite's separate Quest UI route remains.

For matched baseline captures, a Vite pre-load reads only cityscape.ts and
oldTownBlock.ts from 3169f8b into an isolated output directory. BASELINE_DIR routes
that app bundle through the same preview URL without replacing served files.
The resulting baseline is the exact prior JS index-DepBC5pl.js, SHA-256
9cfb7196bdef2c134e20c369a952af9a18827a18fb99c23d1adaff909cbdaa36.
The current city plan and paving hashes match it in all five views.

Initial far captures were occluded by a foreground building. Independent review
caught this; the reviewed view looks down from 100m and explicitly checks target
projection. Initial after evidence also records a fixed 1.1s walking-duration
failure. The revised fixture waits for actual displacement with a bounded timeout
and preserves state on failure; elapsed wall time is not a frame-rate assertion.

Near detail: 1104 triangles / four instanced batches. Medium: 1032 / four. Beyond
110m (95m re-entry) the court contributes no drawing; its eight simplified solids
and two seats remain registered. These counts describe this layer only and do
not establish FPS, native Quest performance or comfort.

## Verification result

- 861 unit tests passed, zero failures; TypeScript and production build passed
  (existing chunk-size warning). Four new tests cover real site constraints,
  empty/light-budget plans, reused mesh seat support and LOD hysteresis.
- Five matched desktop before/reviewed views, five Quest views and one fallback
  view recorded no page errors. The reviewed far view and its matched baseline
  expose the court. City plan and paving remain identical to the baseline.
- Both chairs passed real E-key sitting/standing, sensor restoration and ordinary
  W walking. Each departure advanced 2.429m; the central passage advanced 14.026m.
  The same interactions and through-walk passed with the furniture asset absent.
  These displacement checks do not measure movement latency or frame rate.
- Independent image-only review found no clear visible intersections or one-eye
  failures. The revised far image shows the empty court; the old far image stays
  marked unsuitable. Night furniture is dark, medium-distance outlines overlap,
  and weak contact shading limits visual foot-contact certainty. Native mesh
  support tests and live pot/mount probes complement those observations.
- playwright-webxr 0.2.0: all 14 tests passed, including 16 immersive sessions and
  exits. The court's stereo 0/±25° captures passed independent image review.
  The two distant pots are outside that XR view. Physical Quest remains untested.

Evidence prefixes: `court-life-desktop-before-*`, `court-life-desktop-reviewed-*`,
`court-life-desktop-before-reviewed-far`, `court-life-quest-reviewed-*`, and
`court-life-desktop-fallback-*`. XR logs/captures are copied to
`qa/webxr/evidence/court-life-20260913/`. The earlier `after` run preserves the
fixed-duration test failure and occluded far view rather than overwriting them.
