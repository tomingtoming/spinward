---
origin: ai
created: 2026-09-13
---

# Usable observation deck

The existing 58.5 m landmark now has a walkable floor, a solid guard and a
usable bench. Places → Observation deck and `?visit=deck` arrive on its floor.
Explore → Overlook remains the separate free-fall starting point. Habitats
below 800 m retain their previous small tower and have no deck destination.

## Reference and scope

The screenshot scan found 150 files / 147 unique contents, no new, absent or
unstable reviewed files, and three known duplicate pairs. The unchanged
original episode 1 image 0003 was viewed at full resolution again:
SHA-256 `b39c23e8b13328980cc279018f15dd1e2d6f83545508722731b07ca1fb5bb305`.
Its outdoor stairs, platforms, rails and supported public structure suggest
human-sized usable facilities. The depicted function and dimensions remain
uncertain. This increment adopts that principle in an original round landmark,
without copying the platform shape, characters or source imagery. Ground-level
stairs/elevator access remains a separate task.

Episode 1 image 0044 was also viewed again, SHA-256
`9f5d6ed0f35cf10f285c996cce00e00ddd7e05681b389844df2404e268963ce4`.
Its supported pipes and upper walkways remain candidates. No new implementation
is attributed to that image in this increment.

## Model, physical support and budget

- Blender MCP generated only the owned `SWOD_observation_deck` scene and
  restored the previously active scene. The `.blend`, generator and exported
  GLB are saved together. Other open scenes were not edited.
- LOD0 / 1 / 2: **4,864 / 1,120 / 160 triangles**; GLB **490,508 bytes**.
  One mesh and vertex-color material per visible LOD; no textures or lights.
  The near guard has infill, middle guard keeps posts/rails, and the distant
  silhouette keeps the deck and tapered support. Thresholds are 95 / 350 m
  from the tower base, with 15% hysteresis.
- A common 24 m wide, 32-sided floor remains at height 58.5 m. The 1.22 m
  guard collision envelope sits inside its edge. The column, deck underside
  and 48 guard segments form 52 collision parts, independent of visual LOD.
  Only the deck's top supplies walkable ground. A missing GLB keeps a solid
  procedural floor, column and opaque parapet.
- Long floor triangles are subdivided only for the cylinder-space ground
  sampler. Initial tests found roughly 3 mm interpolation troughs under the
  bench; the subdivision removes them without adding render triangles.
  The ground top has 960 triangles; all collision parts total 1,664 triangles.
  Ray tests compare the actual GLB with ground sampling at three colony
  radii. Separate collision tests exercise 96 guard positions, an unobstructed
  interior, the underside and the open air below.
- The existing bench now has solid collision, a seat at floor +0.53 m and a
  supported exit. Actual player body tests include this elevated seat. Image
  review also found the old telescope's two skids disconnected from its
  pedestal; a small cross-member now joins them in the existing civic batch.
- Places retains 290×80 wrist targets in a fifth row. The disabled-place
  explanation moves into the subtitle instead of clipping below the panel.

## Reproduction and evidence

Build the production preview first and hold it unchanged during each run:

```sh
bun test
bun run build
SPINWARD_URL=https://127.0.0.1:<owned-preview-port> node qa/neighborhood-life/observation-deck.mjs
SPINWARD_URL=https://127.0.0.1:<owned-preview-port> bun run test:xr
```

The browser script supports `TIER=quest`, `TIER=phone`, `PRESET=cooper`,
`PRESET=elysium`, `NIGHT=1`, `FALLBACK=1`, and an evidence `LABEL`.
It uses real Places, W, E or touch Sit/Stand up, plus supported URL fixtures.
It checks a ballistic arrival from above the floor, near/middle/far LODs,
the underside and a downward view at the guard. Gameplay state is never
written by the script. Each owned Chrome instance closes in `finally`.

The first near-view fixture landed inside the return hysteresis band and
incorrectly expected LOD0. Its failed result is retained; the viewpoint moved
closer instead of changing the runtime threshold. An independent image review
then found that buildings obscured the middle/far tower, and the normal eye
view at the guard did not show the contact. The later views rise above the
obstructions and look down at the actual stopped position. Read-only camera
probes confirmed the original shared orientations were correctly restored.

The supplemented guard view exposed a small wedge at each square-cut rail
joint. Radial end cuts now share the same corner vertices without adding
triangles or overlapping top faces. A ray regression checks the inner, centre
and outer rail at all 48 near / 24 middle joints. It failed on the old model
(the ray reached the post 15 mm below the rail) and passes on the joined model.

Local browser evidence is under `qa/neighborhood-life/observation-*`. XR and
build snapshots are under ignored
`qa/webxr/evidence/observation-deck-20260913/`. The initial XR run passed all
19 tests, including 21 session entries and exits. The deck check uses the real
wrist trigger and verifies stereo 1280×960 per eye, 64 mm IPD and head roll
0/±25°. All browser runs require a hardware GPU. These are Chrome/IWER
emulation checks, not physical Quest or phone measurements.

Final verification on 2026-09-13:

- **879 unit tests / 150 files passed**, 55.03 seconds. TypeScript and
  production build passed; the existing large-chunk warning remains.
- Seven browser configurations passed with 11 observed states and 12 PNGs
  each: Izma desktop / Quest budget / phone / night / missing-asset fallback,
  Cooper and Elysium. Each covered ordinary entry, walking into the guard,
  sitting/standing, real free-fall landing and all LODs. Page/console errors
  were empty, using Apple M1 Pro / ANGLE Metal. This is not an FPS benchmark.
- After the rail-only geometry correction, desktop and fallback repeated
  all 11 states successfully, including landing near 58.49997 m. Independent
  crop comparison confirmed the green wedge disappeared without a new hole.
- The full XR suite passed **19 tests / 21 entries / 21 exits in 4.4 minutes**
  before that final rail-only correction. The deck XR test then passed again
  on the final joined model, with a real wrist selection and matching exit.
  The UI and other scenery were unchanged between these runs.
- `full-suite/` retains the broad XR result and `final-deck-xr/` the final
  focused result. `tested-build.json`, `tested-bundle.js` and `tested-model.glb`
  identify the final candidate. The post-commit proof checks served HTML/JS
  against dist, the embedded commit, JS equality except for that commit ID,
  and GLB equality with both the tested model and source. This is local preview
  verification, not deployment.

## Visual limitations and next scope

Independent image review passed the visible near column/deck joins, bench
support, phone target separation, complete wrist panel and stereo guard/floor
attachment at all three head rolls. It could not establish exact physics or
shoe contact from the screenshots; those are separate mechanical checks.
At night the guard remains a dark outline against the city, with some vertical
bars merging into unlit buildings. Ground-level glare also limits inspection
of the column foot in that night view. No emission was added to disguise this.
Seated screenshots show knees/hands but do not show the full shoes.

The deck has no ground stairs, elevator, accessible walking directions or new
resident activity yet. It is reachable by Go now or aerial landing. Public
access and supported maintenance paths are candidates for later balanced work;
do not keep adding decoration to this one landmark. No publication or push.
