# Riverside walking directions — 2026-09-13

Reference: `izma-ep04-0024` (SHA-256 in the reference manifest), a low
waterside path below a bridge and an upper street. Existing original Spinward
geometry supplies the river, arch, promenade and end ramps. This increment
connects those places through walking directions; the reference does not show
or prescribe a navigation UI. No source art or characters enter the assets.

## Checklist fixed before visual review

- Bridge side: four promenade connections are open over supported upper land;
  the parapet remains over the channel and retaining drop.
- Upper/lower path: no floating paving or gap at the bridge exit; the river's
  lower-bank rail remains continuous. Full body clearance uses a physical
  probe, not a claim inferred from distant pixels.
- Ramp mouths: paving crosses the one-metre verge at all four end connections;
  there is no grass interruption or abrupt 14 cm lip along the guided route.
- Desktop/phone: Riverside has both Directions and Go now; the selected route
  is readable, and Places rows do not overlap or overflow the viewport.
- Night: directions remain readable; no new luminous scenery or floating sign.
- Far: arch and river silhouette remain legible with distant bridge LOD.
- VR: the complete eight-action Outing panel and its directions detail fit
  within the wrist at 0/±25° roll, in both eyes. Text uses the raw wrist texture
  for close inspection. Selection/cancellation use controller triggers.
- Ordinary walking input reaches the lower bank via an end ramp. Starting
  directions must not teleport; arriving above the destination must not count.

## Reproduction

Build and serve the production preview, verify ownership, then keep `dist/`
unchanged throughout the browser runs. Use an actual hardware GPU.

```sh
SPINWARD_URL=https://127.0.0.1:<preview-port> WALK=1 node qa/neighborhood-life/river-directions.mjs
SPINWARD_URL=https://127.0.0.1:<preview-port> bun run test:xr
```

The desktop script reads debug position/heading but moves only with W and the
arrow keys. URL poses establish initial fixtures; route selection and Go now
use the application's real buttons. No car entry, route action, heading setter
or player-coordinate write is used to simulate walking progress.

## Development failures retained

The first body-clearance probe found a real continuous parapet blocking the
upper promenade. It is now clipped only across each supported 19–23 m bank
offset. Water-side and retaining-drop guards remain.

Expanding coverage to every graph edge exposed a probe error at an approach's
change of grade: linearly interpolated waypoint height put the test sphere
inside the actual floor. The walker samples the floor continuously. The probe
now samples that same triangle surface at each half-metre step, checks the
layer hint differs by less than 0.3 m, then checks body clearance at that floor.
It still includes walls, rails and bridge structure; it does not ignore floors
or bypass collision.

The first independent image review found a visible grass interruption between
the two paved paths at the end ramp. The first keyboard walk had crossed it,
so collision tests alone did not catch the visual break. Four short bevelled
paving connections now cross this verge; their height/material is checked in
the plan test and their appearance is re-reviewed after capture.

## Scope and limits

Routes use a bounded district graph, with four actual bridge sidewalk mouths
as street connections. The existing local street search limits still apply;
long-distance journeys across the full colony are not provided. Vehicles do
not acquire pedestrian routes or a Riverside parking bay. The graph and route
tags add no rendered meshes, lights or Blender asset bytes. The four paving
connections add 16 triangles and eight surface colliders, using the existing
stone material and batching. VR emulation does
not measure a physical Quest's performance or comfort.

## Verified results

- `bun test`: 866 pass, 0 fail (146 files); TypeScript and production build
  pass. The existing Vite large-chunk warning remains.
- The three city budgets (16,000/18,000/64,000 buildings) keep all graph edges
  supported and clear at half-metre samples, with a 0.32 m body sphere. Water
  guards remain solid; water/carriageway/wrong-height starts are rejected.
- The graph has 321 nodes, 321 edges and four portals. One local measurement
  was 13.86 ms to construct and 1.79 ms to find the 52-point bridge-to-bank
  route; this is a single Bun measurement, not a frame-rate benchmark.
- Desktop Chrome on Apple M1 Pro / ANGLE Metal: 13 captures, no page errors.
  The 189.11 m planned journey completed using W and arrow keys, with 1,018
  sampled states, 186.69 m of measured movement and grounded mode throughout.
  Ground height descended from 5.34 m to 1.2 m; the final position was within
  0.8 m of the goal. Small waypoint/arrival radii explain the shorter walk.
- Real Places buttons started guidance without moving the player, cancelled
  it, and retained Go now to Riverside at the lower bank. Desktop night and
  390×844 phone captures, all four junctions and far bridge LOD 2 were recorded.
- Browser evidence uses `river-directions-desktop-final-*`; the tested asset
  was `/assets/index-QZzgIYJp.js`. Final commit/served-byte proof is stored with
  the reviewed XR evidence after the final local commit.
- After adding the ramp connections, all 866 tests and the build passed again.
  `LABEL=paving WALK=1 RAMP_ONLY=1` re-ran the changed crossing through the end
  ramp to Riverside: 428 samples, 78.08 m of movement, grounded throughout,
  5.14 → 1.2 m, arrival within 0.8 m. Its 18 captures include the four bevelled
  crossings, desktop/phone/day/night and far view; no page errors. Asset:
  `/assets/index-C2Acov8j.js`. River surface triangles are 38,518 → 38,534 and
  colliders 1,095 → 1,103; this is the layer, not a whole-scene FPS measurement.
- Independent review of the initial 13 desktop images passed bridge junctions,
  phone menus and directions, while finding the grass break described above.
  Initial wrist raw texture and both eyes at 0/±25° passed for eight complete
  actions, the directions detail, and absence of overlapping HUD.
- Re-review of the five paving images passed continuity at all four crossings,
  with no visible floating surface, double face or missing water-side guard.
  Precise support/clearance comes from the mesh and walking probes. Fine road
  edge aliasing, dark-bank visibility and slight rail-end overhang remain
  visual observations, not measured new regressions or a blanket quality claim.
- `playwright-webxr` 0.2.0: initial full suite **15 pass / 17 sessions / 17
  exits** (4.1 minutes). After the paving change, the affected river, river
  traffic and UI suites passed **7 tests / 9 sessions / 9 exits** (1.8 minutes),
  including desktop/Quest entry, return/re-entry, and the new wrist route's
  selection/cancellation. No page errors. Both runs used fixed production
  builds on Apple M1 Pro / ANGLE Metal, Chrome 152.0.7977.83. The VR river test
  checks guidance and layers; actual continuous walking was the desktop test.
  Evidence is under `qa/webxr/evidence/river-directions-20260913/`.
