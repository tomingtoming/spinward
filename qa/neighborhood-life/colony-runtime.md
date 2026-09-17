---
origin: ai
created: 2026-09-17
---

# Whole-Izma terrain and streamed building massing

This page records the earlier terrain integration. The following
[transport increment](colony-transport.md) replaces the preliminary road
ribbons and adds visible supports and parapet collision; its geometry counts
and verification supersede the corresponding runtime quantities below.

The full-colony goal remains active. This increment puts all three 40 km
inhabited strips in the executable app and connects the existing riverside
study to that terrain. It provides a stable runtime foundation for district
construction; the 1,715 plain building masses are not completed architecture.

## Implementation

`assets/blender/export_izma_colony.py` reads the saved unrolled scene in
`izma-colony.blend` through Blender 5.2.0 LTS's isolated MCP CLI. It exports
the actual floor triangles into `src/worlds/generated/izmaColony.json` and
244 content-hashed building files in `public/landscapes/izma/`.

- The shared terrain base has 114,292 triangles and 6,563 collision surface
  groups. It covers all three inhabited strips, including their end reserves.
  Water and rail surfaces are not walking floors. Transport reservation plates
  crossing the window strips are excluded until their structures and access
  ramps are designed.
- `AuthoredColony` keeps the terrain present. Building detail loads within
  850 m, with at most 3 concurrent requests and 18 retained tiles.
  The actual loaded units are 512 m spatial tiles, not the 18 named districts.
  Mid-distance instances use the same box placements. Beyond 2,600 m, only
  masses at least 14 m tall remain. The near tiles also contain massing boxes
  at this stage, not final building facades or three architectural LODs.
- Far and mid instances share material batches. Fetch failure leaves the
  coarse building and its collision in place, retries are bounded, and world
  changes abort pending requests and discard late responses. Disposal releases
  the geometry, instance buffers, materials and repeating textures.
- All coarse collision descriptors are indexed on load. The shared local
  Rapier streamer selects nearby bodies. Terrain and collision do not wait for
  a tile's network request. This bounds active physics, not the total resident
  manifest/index memory.
- Ground sampling now intersects the same cylinder-projected triangles used
  by rendering and Rapier. Interpolating unrolled heights on large faces had
  missed their chord height. Cache entries belong to immutable mesh arrays
  and their radius; a different radius refreshes the cached projection.
- The study's 640×800 m footprint is cut from the base without overlapping
  corner pieces. Its river end dams were removed, water extended to the two
  axial boundaries, and the surrounding 180 m collar graded into the original
  edge. Faces near the join are split to at most 24 m so their cylinder chords
  cannot raise the join above the study. Ground and water share material colour
  and metre-based UV scale with the study.
- The Blender rebuild touched only Izma. Parsed Cooper and Elysium exports
  remain exactly equal to their previous committed data.

The normal generated-city entry is unchanged. Opt in with
`?landscape=authored&preset=izma`. Add `&visit=a-civic`, `&visit=b-campus` or
`&visit=c-market` to inspect all three bands; all 18 district IDs are accepted.
These development arrivals do not substitute for the final transport network.

## Verification

The focused unit tests cover 63 actual-rendered-floor probes across the three
bands, study footprint exclusion and boundary heights, wrapped tile distance,
async concurrency and LRU eviction through 36 fixture tiles, late-world results,
failure fallback and malformed geometry. Actual curved rendering is compared
with collision/grounding, including 120 samples along the preserved bridge.
At the 63 full-terrain samples, the local collision window has fewer than 45
body descriptors. This is a sampled budget, not a global worst-case proof.

Final `bun test`: **1,112 passed, 0 failed**, 189 files, 547.07 seconds.
The initial full run had 1,111 passes and one failure in the preserved-door
test: its synthetic unsplit sidewalk fan acquired 9 cm of cylinder chord
height. The fixture now obtains the real subdivided drawing's triangles;
the strict 4 cm continuity requirement remains unchanged. Both the focused
check and the full final rerun pass. TypeScript/production build pass as well.

Browser and WebXR scripts are `qa/neighborhood-life/colony-runtime.mjs` and
`qa/webxr/colony-runtime.xr.mjs`. The latter uses actual Menu entry, stick
movement and a wrist return from C to the A-band market. Its floor checks raycast
the mesh drawn in the browser and compare it with live player support at every
sample. The existing 420 m walk, night head-roll and four-world switching suites
are also run against the same production build.

Evidence (gitignored): `qa/webxr/evidence/colony-runtime-20260917/`.

### Executed browser and XR checks

playwright-webxr **0.3.0**, Chrome hardware GPU **Apple M1 Pro / ANGLE Metal**.
XR views are 1280×960 per eye, captured as 2560×960 stereo with 0.064 m IPD.
The production build remains byte-identical throughout XR and final desktop
checks; `build.json` records SHA-256 for all 362 served files.

The first seven-case XR run produced **6 passed, 1 failed in 3.3 minutes**.
The boundary fixture specified `gh=.03` inside the study's sloping collar,
placing the starting body about 2 m below the visible ground. It now resolves
that initial URL height from the actual rendered mesh, then enters VR and
walks through controller input. The corrected case passed in **23.7 seconds**
on the same build. These successful results for all seven cases combine the
initial run and focused correction; this was not a second seven-case run.
Automatic retries were disabled.

| Location | Axial progress | Live support samples | Largest ground/drawing discrepancy |
| --- | ---: | ---: | ---: |
| A civic centre | 29.366 m | 28 | 0.00052 m |
| B campus | 29.276 m | 28 | 0.00043 m |
| C market, then wrist return to the old market | 29.448 m | 31 | 0.00043 m |
| Old study → whole terrain across axial +400 m | 64.297 m | 64 | 0.01639 m |

Every sampled body reference stayed at least 0.310 m above the rendered floor;
that is the physics body's reference point, not a hovering shoe measurement.
Tile retention stayed within 18 and requests within 3. The preserved route
walked **420.028 m** and bakery entry **27.473 m**. Four-world wrist switching,
stereo head-roll, session-scoped exit and disposal passed. No page or request
errors appeared in those successful runs.

The final desktop run captured **18 views**: day/night of the old street,
market, terrain join, three district centres, whole cylinder and B/C aerial
views. No page/request errors. Sampled rAF medians were 16.7 ms and p95 no more
than 16.8 ms at 1440×900 / DPR 1 / Quest quality. Those 1.5-second windows on a
desktop GPU are refresh-limited observations, not a headset or worst-case
performance guarantee. Cold-load peak memory is not measured.

### Independent visual review

A fresh reviewer inspected stereo frames, night roll frames, the whole view,
B/C aerial views and the join, with original-size crops for UI and seams.
No large one-eye terrain loss, giant chord plane, hole or floating building
was found in those views. The box massing and bare streets visibly lack the
architecture, vegetation and facilities required by the full goal.

The original night-roll images cut off a world-space SPINWARD wrist panel at
the lower-left edge while the head faced a shop. A follow-up fixture explicitly
lowered the hands for scenery views, then brought the wrist in front of the
head and used the real controller to open Places. That expanded night case
passed in **6.9 seconds**, unchanged app build. The reviewer could read the
complete night Places frame, Back/Directions and all four enabled destinations
in both eyes. The lowered wrist can still leave the field of view; the earlier
clipping observation is retained and is not treated as a failure of the panel
when held for use. Headset readability remains unmeasured.

The river is continuous across the study boundary, but its banks have a visible
angular width/direction transition. A nearby road end has a thin projecting
edge. They remain specific geometry work for the transport/landform pass; this
increment does not claim a finished natural-looking connection.

### Transport diagnosis for the next increment

`bun qa/neighborhood-life/colony-transport-audit.ts` samples the actual exported
terrain and route surfaces, retaining route IDs in `transport-audit.json`.
It uses nominal intervals of at most 100 m, skips the separate study footprint,
and diagnoses the blockout rather than certifying finished infrastructure.

- 108 planned routes: **90 intra-strip routes sampled**, **18 inter-strip
  connections not yet represented by runtime structures**.
- **4,135 route-centre samples** find a route surface. This does not establish
  continuous coverage between samples, corner geometry or vehicle clearance.
- Away from river banks, 308/311 local-road, 1,042/1,042 arterial, 1,163/1,163
  rail and 1,147/1,147 expressway samples are more than 0.5 m above the terrain.
  These are support/grade requirements, not completed viaducts.
- Two local-road samples are buried by more than 0.1 m near the study join:
  `a-river-neighbourhood-road` at (190.714, 421.429), **0.139 m**;
  `a-river-garden-lane` at (−350, −404), **0.542 m**. Correct them with road/terrain
  surface alignment. Successful walking samples do not certify these different
  locations.

The next implementation should put ordinary street surfaces onto shared
finished terrain, provide supported bridges/viaducts where required, then form
junctions, rail stations and access ramps. Correcting the local joins belongs
to that same all-colony surface method.

## Remaining goal work

The colony is not yet a finished city. Its sparse box massing needs real
parcels, architectural kits and district-specific placement, greenery and
water facilities. General roads and expressways retain preliminary ribbon
geometry; grade transitions, supports, bridge clearances, drivable IC/JCTs,
rail services and inter-strip connections remain unfinished. Grounded walking
at sample locations does not prove every transport route is usable.

Night lighting outside the old study is still the habitat's global lighting.
Representative housing interiors and usable public facilities are unfinished.
The original four shops remain the available interiors. Physical-headset
performance and comfort are unmeasured; desktop hardware-GPU emulation does
not establish a Quest frame-rate budget. No push, deployment or scheduled job
was added.
