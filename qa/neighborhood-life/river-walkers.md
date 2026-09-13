---
origin: ai
created: 2026-09-13
---

# Residents on riverside paths

Reference `izma-ep04-0024`, SHA-256
`74330871397a3b589db285d9d85f3c3e8323ff19547b5929454a827d67df056c`,
shows people above a bridge and a separate low waterside path. This increment
uses those already implemented spaces for original Spinward residents; it does
not reproduce the depicted characters or prescribe their activity from a still.
`izma-0003` and `izma-0025` were also re-inspected; their outstanding public
structure and rooftop-access work is not marked implemented by this change.

## Checklist

- Two original residents walk inside the actual river paths, never water,
  retaining wall, guardrail, traffic lane or bridge structure.
- The route includes the upper promenade, existing end connection and sloped
  lower bank; the root height follows the actual sampled terrain.
- Ordinary walking animation continues on the ramp; the resident pauses in
  front of the player and resumes after ordinary player movement clears space.
- At least one shoe stays near the support throughout the gait and stopping;
  the contact shadow must not jump to seated height as the pelvis lowers.
- A player or vehicle above on the bridge must not stop a resident below.
- Desktop eight / Quest and phone four street-resident slots remain the shared
  ceiling. No new actor pool, material batch, light, collider or asset is added.
- Night clothing and contact remain inspectable only where existing lights
  permit; people must not acquire new self-emission to make them conspicuous.
- Above the existing altitude threshold and with `people=0`, the layer stays
  hidden. No river yields no added routes.
- Stereo: actor remains visible in both eyes at 0/±25° head roll and its root
  stays in the colony's radial frame. Movement is measured independently of
  camera movement; screenshot pixels do not certify collision or frame rate.

## Reproduction

Build, verify the preview owner and freeze `dist/` while running:

```sh
SPINWARD_URL=https://127.0.0.1:<preview-port> TIER=desktop node qa/neighborhood-life/river-walkers.mjs
SPINWARD_URL=https://127.0.0.1:<preview-port> TIER=quest node qa/neighborhood-life/river-walkers.mjs
SPINWARD_URL=https://127.0.0.1:<preview-port> PEOPLE=0 VIEW=bank LABEL=disabled node qa/neighborhood-life/river-walkers.mjs
SPINWARD_URL=https://127.0.0.1:<preview-port> bun run test:xr
```

The browser script observes normal elapsed time and uses actual S input to
leave the resident's path; it does not move actors or write their clocks. URL
poses establish the player fixtures with normal colony rotation and gravity.
The XR test uses real entry and controller runtime, stereo 64 mm IPD, matching
1280×960 eye viewports, target projection, actual actor movement and scoped exit.
The existing UI scenarios cover wrist interaction and exit/re-entry.

## Route and cost

Each bank has a 178.567 m out-and-back route, with endpoint pauses, at 0.95 or
1.08 m/s. Existing `riverLocalRoute` supplies the safe route. Quarter-metre
samples are resolved against the actual terrain once, including the short
bevels across the verge: 752 points per route / 1,504 total. Runtime samples the
cumulative-distance array with binary search. No whole-city path graph is added.
Both river actors use the same nearby population, appearance palette and
Blender resident GLB as street walkers; existing slots decide which are present.

The initial route setup scanned unrelated surface triangles and measured
158.7–185.7 ms across one run of the three budgets. Surface bounding boxes cut
that scan to 18.2–33.2 ms in a separate local Bun run. All 4,512 generated points
across the three budgets remained byte-identical. These are setup samples,
not frame-rate measurements or physical Quest performance claims.

The old flat-pavement route retains its positions and timings. Height is now
also included in the yield check, excluding obstacles more than 1.1 m above or
below. Resident root placement keeps a 2 cm contact offset on the new paths;
this does not add foot IK or rigid pedestrian collision. No commuting or crowd
simulation is implied.

## Foot contact correction

The independent image review flagged floating-looking feet on resume. Actual
shoe-vertex measurements over 72 gait phases at six positions on each bank
found 3.8–10.3 cm clearance. The flat-ground counterfactual retained the gap,
identifying the reused gait rather than the river terrain as the main cause.

`fitResidentFeet` lowers the pelvis so the lowest actual shoe vertex meets the
local support plane. Cached leg chains avoid another whole-body transform
traversal; the helper does not query city triangles each frame. River samples
provide the walking slope and reverse it on return. Street walkers also use
the correction on flat pavement. Their shadow uses explicit standing posture,
so a lowered pelvis cannot trigger the old seated-shadow height heuristic.
The first-person body and seated residents do not call this correction.

The actual GLB is tested over 72 phases, stopping, different scales and three
cylinder orientations. A second terrain test checks 2,688 poses along both
river routes, including ascent, descent and endpoint turns: lowest-shoe
clearance was 1.90–2.10 cm, preserving the intentional 2 cm root offset. This
is a pelvis/support correction; stance feet can still slide, ankles do not
conform independently, and the flat contact-shadow plane approximates slopes.
The reused simplified resident silhouette is unchanged.

## Verified results — 2026-09-13

- `bun test`: 873 passed, zero failed (149 files, 54.14 s). TypeScript and
  production build passed. The existing large-bundle warning remains.
- Frozen final browser bundle: `/assets/index-Bhv0GB5q.js`. Desktop and Quest
  budgets each passed bank, ramp, night and altitude-hide views (nine captures
  each), plus a separate disabled-layer check. No page or console errors.
- Ordinary elapsed motion on the ramp covered 7.80 / 7.75 m and descended
  0.583 / 0.578 m (desktop / Quest). The bank resident yielded, held its local
  clock for 600 ms and resumed after actual S movement. Nearby counts stayed
  within the shared eight/four ceiling. An existing flat-street fixture also
  passed approach, yield and resume with eight residents.
- Independent image review found no new body clipping, pelvis deformation,
  rail/wall penetration or NPC emission in the supplied desktop views. It
  could not certify centimetre-scale shoe support from pixels; the faint
  contact shadow still makes contact harder to read. Mechanical shoe tests
  establish the correction. Images at unmatched gait phases do not establish
  a precise before/after displacement.
- Final playwright-webxr **0.2.0**: all **18 tests, 20 immersive sessions and
  20 exits passed** in 4.5 minutes. Actual entry, wrist/controller interaction
  and both exit/re-entry paths remain covered. The new resident moved 0.763 m
  during the independent motion probe; both 1280×960 eyes retained the actor
  at 0/±25° roll. GPU preflight reported Apple M1 Pro / ANGLE Metal, Chrome
  152.0.7977.83. No resident-scenario page or console errors.
- Final independent Quest and stereo review found no new body clipping,
  pelvis deformation, single-eye disappearance or displacement relative to
  the path. The actor was too small in XR and too dark at night to judge
  centimetre-scale support; those checks remain mechanical.
- A final ramp run (`LABEL=shadow VIEW=ramp`) also inspected actual shadow
  instance heights alongside shoes. Both captures retained ground-level
  shadows for all eight visible actors, without switching to seated height.

Initial evidence, before route-setup optimization and foot correction, is
retained separately under `qa/webxr/evidence/river-walkers-20260913/initial/`.
That build passed all 18 XR tests / 20 sessions / 20 exits in 4.3 minutes.
Final browser captures use the `river-walkers-*-grounded-*` prefix; the previous
`*-final-*` prefix belongs to the initial build. Local JSON and PNG files are
ignored by git. No physical Quest or phone performance result is implied.
Final XR evidence is under `qa/webxr/evidence/river-walkers-20260913/final/`.
