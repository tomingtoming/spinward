# Blender buildings and LOD plan

Status: staged implementation authorized by toming on 2026-09-10. Stages 1–7
have connected-Blender cafe/lobby assets, local three-level LOD switching, room
dressing, localized ambience, usable bench seats, three neighboring shops and a self-service coffee action.
Stages 1–8 are already on main as of 2026-09-11 (`ac688b1`); the old
"local only" statements below describe their validation time, not current deployment.
The next local pass is documented in [Neighbourhood life](neighborhood-life.md).
Stage-1 and stage-2 sections below are historical;
the stage-3 through stage-7 sections record the current implementation. Baseline: local frontage study `879e234`, parent production
`2266f74`. This document supersedes neither the existing interior contracts nor
all historical claims in `far-field-lod.md`.

## Decision: five representations, three authored Blender meshes

Use exterior LOD0–LOD4. Author LOD0, LOD1 and LOD2 in Blender; derive the LOD3
mass proxy from the same structural description and feed LOD4 into the existing
city shell bake. LOD4 is an aggregate city representation, not a fifth mesh per
building. Compare complete three-, four- and five-stage chains on the pilot;
keep five unless an intermediate level saves negligible work or looks identical.

Why five: a two-mesh near/far jump loses street depth, whereas keeping a facade
mesh for the 64,000-building plan wastes work on tiny distant forms. Separate
contact details, street features, architectural mass, skyline silhouette, and
the city colour/light field. Six or more stages have no demonstrated perceptual
role yet and add authoring, loading, batching and transition combinations.

| Exterior level | Visible information | Initial distance guide for a medium building | Initial triangle target per complete building |
| --- | --- | --- | --- |
| LOD0: close | Recessed doors, frame thickness, bevels, canopy underside, visible room surfaces and roof details | 0–25 m from visible building surface | 8,000–12,000 |
| LOD1: street | Entrance recess, canopy silhouette, balconies and parapet; small frames/trim baked | 25–120 m | 1,500–3,000 |
| LOD2: block | Footprint, setbacks, upper volume, major roof form; facade atlas and night windows | 120–600 m | 150–400 |
| LOD3: skyline | Low-poly structural envelope retaining tower/podium/L-shape/courtyard identity | Beyond roughly 600 m while still legible | 12–96 |
| LOD4: city field | Existing shell albedo/emissive representation, without an individual mesh | Below calibrated projected silhouette threshold | 0 individual triangles |

These are design targets, not demonstrated hardware limits. Distance ranges are
initial calibration guides, not fixed global cutoffs. A 7 m house and a 100 m
tower must not disappear at the same distance. Named landmarks and tall buildings
retain their structural proxy while their silhouettes matter.

A projection example using 1080 render pixels vertically and a 60-degree vertical
FOV gives f=935.3 pixels. A perpendicular 10 cm detail spans 0.94 px at 100 m;
a 24 m building spans 22.4 px at 1 km, 7.0 px at the 3.2 km axis and 3.5 px at
6.4 km. These are approximate projections, not measurements on Quest or a claim
that all buildings at the axis are invisible. Historical far-field documentation
contains numerical/implementation assumptions that need revision during integration.

## Selection, transition and ownership

- Use the camera's actual position in the rotating habitat frame, component
  bounds and projected simplification error. Circumferential/axial surface
  distance remains useful for spatial indexing, not sufficient for visual LOD.
- Evaluate ground-floor, upper structure and roof detail separately so a tall
  building's screen height does not force tiny street handles to render from the
  axis, and a roof flyover can promote rooftop detail without furnishing rooms.
- Start with approximately 1–2 render pixels of tolerated simplification error;
  choose the more demanding eye in XR and calibrate against actual render
  resolution/FOV. Budget arbitration must be stable when the resolution governor
  changes; do not let minor resolution or head-pose changes thrash the batches.
- Add altitude changes to selection invalidation. Current `setFocusSurface`
  only gives altitude to the interior layer, and exterior rebucketing can return
  early when only altitude changes. Existing surface-to-surface chord distance
  is not the distance from a camera at the axis or above a roof.
- Select candidates through the existing spatial organization, then reuse
  per-archetype/material/LOD instance buffers. Do not scan all 64k buildings or
  dispose/rebuild all meshes on every animation frame. Maintain valid bounds for
  instance batches; visibility across windows and through the bore must survive.
- Start with 15–20% hysteresis and narrow complementary dither transitions.
  Account for both adjacent meshes in transition budgets. Validate stereoscopic
  stability; a flat-desktop dither pass is not proof of acceptable XR appearance.
- Keep building identity, orientation, footprint, roof height, entrances and
  night-window layout aligned across all levels. Avoid a uniform box replacing
  an L-shape or setback silhouette. Avoid doubled wall surfaces and bands.
- Shell bake is the aggregate low-frequency background. Define its handoff and
  luminance ownership explicitly; do not add full-strength building light over
  an identical baked footprint. Test distant small forms for disappearing mass
  and brightening as they cross a level.

The existing interior detail levels (0: small objects, 1: furniture, 2: signs,
3: structure, 4: far) remain component visibility tiers; they do not imply five
complete room meshes or a 5x5 matrix of exterior/interior models. Within an
occupied room, keep its structural shell and reachable solid furnishings visible.
Doors and passage exits must never be replaced by opaque proxies while reachable.
Collision uses independent permanent structural proxies and does not change with
visual LOD. Courtyard light wells must remain open from overhead viewpoints.

## Pilot buildings and Blender contract

1. Select two actual certified lots from the current city plan: one existing
   enterable cafe in a mid-rise residential building, and one mid-rise office
   lobby facade. Record dimensions, front direction, access route, roof height,
   interior/solid status and lot ID before modelling. Use those exact dimensions;
   an 18x18x24 m block is a design example, not permission to resize a live lot.
2. Make complete buildings from a small kit: ground-floor uses (shop/lobby),
   upper-floor bays, corners, end walls and roof modules. Establish one coherent
   material palette. Shape comes first: recesses, mullions, canopy thickness,
   balcony/parapet silhouette and a convincing ground contact.
3. Preserve metre dimensions. Runtime asset coordinates: X across frontage,
   Y up, Z toward street, origin at footprint centre on the ground plane.
   Verify the Blender-to-glTF axis conversion and all four frontage directions.
   Keep doors fixed in metres; fit variable lots by repeated modules and blank
   infill, not arbitrary nonuniform scaling of a finished model. Align tile UVs
   and floor counts across levels. Ground finishes follow cylinder curvature.
4. Organize a source `.blend` into common structural/roof parts, detail groups,
   `LOD0`, `LOD1`, `LOD2`, mass-proxy source, collision proxies and attachment
   anchors. All LODs share origins/bounds. Bake features before removing them.
   Planar dissolve is useful on architectural planes; protect boundaries and
   UVs, and simplify by semantic part before using ratio-only decimation.
5. Export explicit named LOD nodes with a small manifest carrying identity,
   dimensions, bounds, material/texture references, counts and error estimates.
   Build LOD3 from the structural envelope and derive LOD4 colour/emissive data
   from that same building. The runtime selects named nodes; loading a GLB must
   not add every LOD to the scene simultaneously.
6. Reuse shared base-colour, normal, ORM and emissive atlases (initially 1K;
   promote selected hero texture sets only if close inspection requires it).
   Plan for roughly two opaque material batches plus a selectively used glass
   batch. Preserve glTF PBR materials in the new loader path; the legacy loader
   remaps them to SIDE/ROOF/SIGN and normalizes each axis, unsuitable for this kit.
   Bake local occlusion, not a permanent sun direction. Cycle day/night in the
   actual runtime. Glass reflection must match the colony's lighting; dynamic
   transmission or a reflection probe for every building is not an assumed cost.
7. Keep geometry reusable through instancing, and count primitives/draw calls,
   exported vertices, texture residency, overdraw and transition cost as well as
   triangles. Export can split vertices at UV seams and hard edges. Each module
   needs correct material attributes and UVs for runtime instancing and baking.

After the cafe and lobby pass visual and runtime checks, extend the shared kit
with residential entrances and workshops. Add an L-shaped or setback building
as the second-shape regression test before extending to towers and the whole city.
Do not produce four uses multiplied by all building archetypes before proving
the complete import/LOD/lighting path with the two pilots.

## Initial scene budgets and validation

The old settings permit desktop LOD0 up to 800 buildings, Quest 220 and phone
180, but their full-building GLB branch is dormant. Do not reactivate those caps
with 8–12k-triangle meshes. Begin pilot placement with a small bounded subset.

Provisional promoted-geometry caps (LOD0–LOD2 combined, including transition
overlap): desktop 0.6M triangles; Quest 0.25M; phone 0.15M. These are additional
allocation limits to calibrate, not promises of frame-rate headroom. Keep total
scene cost and the geometry replaced by these instances in the accounting.
Prioritize visible nearby components and preserve minimum required structures;
when a cap is reached, step down visual detail rather than dropping a building.
Tune instance counts only after measuring actual exported assets.

Current comparison baseline on Radeon 780M/RADV: approximately 188 draws/frame,
3.239M triangles and 60 fps for the local frontage study. A capped 60 fps is not
proof of spare GPU time. Phone/Quest quality profiles on this desktop are smoke
checks, not physical-device performance results. Record frame-time distribution,
GPU time when supported, CPU rebuild spikes, draw count, texture memory and
cold/revisit load behaviour. Use the actual device refresh budget for XR; avoid
judging sustained performance from a short FPS sample alone.

Historical local GLB measurements (2026-09-10; full audit pending):

- Existing authored residential: 1,844 triangles at LOD0, 128 at LOD1.
- Existing authored tower: 2,012 triangles at LOD0, 236 at LOD1.
- Kenney commercial building-a: 1,252 triangles; low-detail pair: 188.
- Full authored building/street pack: 740,508 bytes; 3 source materials.

These are scale references, not visual quality targets. For both reference and
new assets, the modelling audit reports total/externally visible triangles,
buried versus safely removable faces, and UV coverage. Protect surfaces exposed
from above, below balconies, through doors and from inside; exterior occlusion
alone must not delete valid interior/roof geometry.

Acceptance shots and routes:

- Same camera/light/quality: existing frontage vs new model, day and night;
  a slow walk past the entrance must reveal real parallax and grounded contact.
- LODs forced individually and in automatic mode at boundary-adjacent distances;
  compare silhouette, canopy, openings, window rhythm and emissive luminance.
- Surface, 60–200 m roof view, Axis, opposite land strip, Old Town, and a rapid
  free-fly approach. Exercise different azimuths, axial positions, preset scale
  and the cylinder seam. Test stationary camera height changes explicitly.
- Walk through the existing cafe/passage; throw a ball through the entrance;
  inspect courtyard overhead. Collision and visibility agree before and after
  streaming out and revisiting; no invisible furniture, false floors or sealed
  doors. Model loading failure must retain an honest fallback.
- Desktop and phone aspect ratios, quality tiers, then physical Quest stereo
  motion/performance before claiming Quest acceptance. Check shader errors,
  resource disposal, buffer capacities and habitat switches.

Keep five stages if each intermediate stage either preserves visible features
that its successor loses or measurably reduces rendering work. If two adjacent
stages are indistinguishable at their boundary and save little, merge that pair.
This pilot is the evidence for the final thresholds and budgets.

## Implementation sequence and outputs

A. Capture lot contracts and baseline, then make a plain-box import/axis/material
   round-trip and the altitude-aware selector tests. This proves the path before
   spending time on a polished model; it need not add an unused general framework.
B. Finish cafe master and LOD0–LOD2 in Blender, derive mass proxy/bakes, audit,
   export and place it in the live scene. Review the walking/day/night comparison.
C. Make the office lobby pilot from the shared kit; check long/narrow frontage and
   a setback/L-shape case, then calibrate all transitions and bounded instancing.
D. Add residential/workshop variants after the pilot looks right; scale the
   number of instances while measuring each target device.
E. Deliver source `.blend`, exported `.glb`/textures/manifest, reproducible export
   script, integrated runtime change, structural tests, audit and comparisons.
   Use the repository's asset/tool conventions and keep binaries outside keel.
   No public push or deployment is implied by this planning request.

User review is of concrete street comparisons and visual direction. AI handles
modelling, export, integration and measurements. Existing design documentation
must be updated during implementation to distinguish active new code from the
retired Kenney gate and the old standalone interior detail tiers.

## Primary references

- Unity LOD Group: screen-relative size and transitions:
  https://docs.unity.cn/Manual/class-LODGroup.html
- Blender 5.2 Decimate (Planar mode, boundary protection):
  https://docs.blender.org/manual/en/5.2/modeling/modifiers/generate/decimate.html
- Blender glTF exporter (material translation and exported vertex splitting):
  https://docs.blender.org/manual/en/5.1/addons/import_export/scene_gltf2.html

References describe available techniques; Spinward's stage count, thresholds,
asset allocation and acceptance criteria above are this task's design proposal.


## Stage 1 — cafe master and local integration (2026-09-10)

The connected Blender 5.2 scene `Spinward Cafe Pilot` contains the first master.
The original scene was retained. Source is `assets/blender/cafe-pilot.blend`;
`build_cafe_pilot.py` regenerates the metric model and runs `bake_cafe_pilot.py`
for its shared 2048² AO atlas. Execute the build script in Blender with `__file__`
set to its absolute path. The scripts replace only their own pilot objects.
`cafe-pilot.json` records the existing cafe, including its entrance and permanent
collision volumes. The GLB is `public/assets/buildings/cafe-pilot.glb`.

The actual master measures 23.443 × 30.694 × 46.885 m structurally, with sill
projections up to 6.5 cm beyond the wall plane. Non-solid overhead canopies
project up to 0.66 m into the existing 2 m entrance approach, above 3.1 m. It uses **22,700 triangles,
8 material primitives, one AO image, and about 3.33 MB GLB**. This is above the
proposed 8–12k LOD0 target: it is a master to simplify, not evidence that the
budget has been met. No normal/roughness texture, facade bake for distant meshes, or
buried-triangle audit has been completed yet. The atlas has summed UV triangle
area 50.8% (including overlaps), with 64.7% raster occupancy at 1024² including
edge pixels; these are diagnostic estimates, not a reference-asset comparison.

Only the exact original cafe lot at radius 3200 m is eligible. Geometry uses
native metres and the same front-local coordinates as collision, then follows
the cylinder. The existing curved floor and all collision remain authoritative.
Other lots retain their current rendering. The model loads asynchronously; the
procedural cafe stays until loading succeeds. `?cafeModel=0` selects the baseline
for comparison. Close promotion currently uses 120 m distance from the complete
building envelope, exiting at 144 m; the coarse city grid owns far visibility.
This is a temporary two-representation pilot, **not the completed five-level
LOD chain**. Near its roof it currently includes the small room furnishings;
component-level selection belongs to stage 2.

Validation: exported mesh dimensions, all four front coordinate transforms,
portal ray tests, browser day/night/front/oblique views, a roof view, distance
fallback, and keyboard walking through the existing entrance. Verification
screenshots and runtime probes are in
`/home/toming/Pictures/Spinward/2026-09-10_blender-cafe/`.
Desktop GPU runs and forced phone/Quest budgets do not substitute for those
physical devices or stereo comfort testing.

Next stage: measure which master triangles contribute visible detail, simplify
LOD0, bake its upper facade into LOD1/2 while preserving window/night patterns,
and compare silhouettes and transitions at the same recorded cameras. Add
independent roof/interior detail budgets before expanding to the second pilot
or replicating the kit across lots. The first cafe interior is still sparse;
room dressing, shop behaviour, ambience and pedestrians are subsequent work.


Final stage-1 validation: `bun test` **608 pass / 0 fail**, `bun run build` passed.
At the saved 1600×1000 street camera on AMD Radeon 780M/Vulkan, 120-frame samples
were ~60 fps: baseline 188 draws / 3,181,544 triangles; pilot 193 draws /
3,204,004 triangles. Forced phone and Quest budgets also ran at ~60 fps on this
same desktop GPU. An aborted GLB request restored the exact baseline draw and
triangle counts with no page exceptions. These short, vsync-capped samples show
no observed regression in this scene, not a scaling limit or device certification.
The final keyboard walk moved from axial -318.29 to about -306.54 m through the
portal. Independent image review confirmed the facade/entry coplanar artifacts
were removed, the canopy became readable, and warm night windows improved the
storefront. Small bright pixels remain on glass at full resolution; dynamic
aliasing, longer traversal and physical XR review are still outside stage 1.

All current comparison images use the final 8-primitive export. `gpu-smoke.json`,
`runtime-checks.json`, `uv-audit.json`, and the images are in the Pictures path
above. GLB tests verify that its embedded AO image equals the source PNG byte for
byte, guarding against Blender re-exporting an old packed image after a bake.


## Stage 2 completed locally — 2026-09-10

The original cafe now switches between three Blender exterior meshes. This is
one exact lot, not a citywide rollout or the completed five-representation chain.

| Mesh | Triangles | Material primitives | Reduction from approved master |
| --- | ---: | ---: | ---: |
| LOD0, approved master | 22,700 | 8 | — |
| LOD1, street | 2,083 | 7 | 90.8% |
| LOD2, block | 320 | 6 | 98.6% |

LOD1 and LOD2 meet their initial triangle targets. LOD0 remains above its 8–12k
target and has not been simplified in this stage. The master is the measured
reference; no unrelated low-poly reference asset was substituted.

`assets/blender/build_cafe_lods.py` runs through the connected official Blender
addon against the approved master. It preserves the original scene and creates
`cafe-pilot-lods.blend` with two separate objects. The low pack is
`public/assets/buildings/cafe-pilot-lods.glb` (2,947,356 bytes). Its new 2048×1024
facade atlases contain albedo, ORM (R=AO, G=roughness, B=metallic), and emission.
Both low meshes share them; retained master parts also use the original AO image.
Each bake creates a fresh image before packing, and tests compare the embedded
PNG bytes with the sources. Materials preserve window roughness/metallicity and
runtime daylight emission. LOD1 retains only the forward caps of the sign letters
so ORBIT CAFE remains legible without their extrusion and rear faces.

The 3.2×3.1 m entrance portal, roof/parapet and projecting canopy remain. LOD1/2
replace structural/detail-tier 2–3 parts while the existing interior layer retains
its own furniture/small-object selection. Collision and the curved floor still
come from the existing procedural contracts. This does not yet constitute a
complete independent roof/interior budget system.

Runtime thresholds use distance to the full building envelope, including altitude
and wrapped azimuth. Approach thresholds are 25 m for LOD0 and 120 m for LOD1;
exit thresholds are 30 m and 144 m. The selection latch survives coarse-grid
rebuilds and asynchronous asset arrival. Changes fade over 240 ms with
complementary opaque screen-space dither, including while the player is still.
The existing coarse city grid still owns the outer visibility boundary. LOD3 and
LOD4 have not been implemented by this pilot.

Both the 3.33 MB master and 2.95 MB low pack load once when the original lot is
present, about 6.27 MB total. Streaming/memory efficiency and batching remain
future work. A failed required asset retains available bounded high detail or
the procedural fallback. `?cafeModel=0` selects the baseline; debug-only
`?debug&cafeLod=0|1|2` fixes a level for camera-matched comparisons.

Validation: `bun test` **610 pass / 0 fail** and `bun run build` passed. Tests
cover thresholds/altitude, exported triangle budgets, bounds, clear doorway rays,
roof rays, shared ORM texture references and embedded bake freshness. Browser
checks covered day/night, entrance walking, roof proximity, stationary fading,
asset failures and forced phone/Quest budgets. An actual keyboard flight recorded
LOD1→2 outward and LOD2→1→0 inward, with 15 and 30 transition frames respectively.
Ground-level LOD0→1 also faded and settled without residual grain. Far silhouette
comparisons use identical overhead cameras with rotation stopped (`rpm=0`), since
a ground camera was occluded by another building. Normal rotating-habitat street,
roof and entrance checks were performed separately.

An independent final image review measured matched window pixels after ORM baking:
day dark glass RGB 23.4/41.6/51.8 → 23.2/41.4/51.6; night dark glass
38.14/47.06/49.76 → 38.23/47.32/50.06; lit glass
163.44/152.56/127.67 → 163.48/152.94/127.69. The earlier brightness jump was resolved,
and ORBIT CAFE remained legible day and night. Thinner frames/edges at LOD1 are
expected. These static checks do not certify temporal aliasing or stereo comfort.

The Blender audit measured each level alone. Normal-direction ray occlusion was
15,575 / 1,259 / 153 triangles for LOD0/1/2; five-ray 25° cone tests within 8 cm
flagged 4,140 / 499 / 52 candidates. These are directional occlusion measurements,
**not globally invisible faces**, and were not used for automatic deletion.
Summed UV triangle areas (overlaps included) were 0.508 for master AO; LOD1
0.204 master AO plus 0.883 facade; LOD2 0.084 master AO plus 0.968 facade.
These sums are not raster occupancy percentages.

Evidence is under `/home/toming/Pictures/Spinward/2026-09-10_cafe-lods/`:
`verification.json`, `flight-checks.json`, `fallback-checks.json`,
`geometry-audit.json`, camera-matched PNGs and `comparison-final.jpg`.
Desktop Radeon 780M/Vulkan samples stayed near the 60 fps cap. One building's
triangle reduction does not prove a citywide frame-time gain; forced phone/Quest
settings on this PC are not physical-device validation. Physical XR dither review
remains outstanding. No production deployment or public push was performed.

Next: simplify the close master without sacrificing contact details, evaluate
roof/interior budgets and physical XR transitions, then test a second building
and city-scale batching/visibility before completing LOD3/4. Street activity,
room dressing and ambience remain separate stages of the lived-in-city goal.


## Stage 3 completed locally — cafe contact mesh and Meridian lobby (2026-09-10)

Two exact existing lots now use the shared Blender mesh kit and runtime LOD
controller. The cafe's approved 22,700-triangle master remains the reference;
its runtime contact mesh is now **12,695 triangles (44.1% fewer)**. An initial
11,979-triangle attempt lost the narrow mullions and introduced horizontal wall
seams. Independent image review caught both. Narrow vertical piers and per-window
spandrels now follow the cylinder curvature without the long horizontal chords;
the original 19 cm reveal geometry/AO and front mullion planes are retained.
Closed wedge-shaped sills and front-only sign caps save geometry. The resulting
695 triangles above the initial 12k guide are an explicit visual-quality tradeoff,
not a claim that the original 8–12k target was fully met.

| Building / exterior level | Triangles | Material primitives |
| --- | ---: | ---: |
| Cafe LOD0 | 12,695 | 8 |
| Cafe LOD1 | 2,083 | 7 |
| Cafe LOD2 | 320 | 6 |
| Meridian lobby LOD0 | 2,380 | 7 |
| Meridian lobby LOD1 | 1,154 | 7 |
| Meridian lobby LOD2 | 156 | 6 |

The second pilot is a 14 m building with 13.119 m frontage and 12.157 m depth,
selected from the actual existing `passage` interiors. Its tangent-facing front
(side -1), two exits, smaller scale and zero-length street approach contrast with
the cafe's axial-facing front, single exit and 2 m approach. It is a compact
public office lobby study, rather than the initially proposed long, narrow
mid-rise office. `lobby-pilot.json` preserves the original lot and collision parts.
Both 3.2×3.1 m portals remain open at every LOD. Canopies and upper window sills
stay within its existing footprint; the sign letters project 9 mm. The signs read
MERIDIAN and PUBLIC PASSAGE. All furniture keeps the existing collision contract.

`building_mesh_kit.py` supplies native-metre boxes, facade coordinates, short
spandrels/piers, recessed windows, closed sill profiles, joins and exports.
`bake_building_maps.py` provides contact AO and albedo/ORM/emission facade baking.
`build_cafe_close.py` consumes the existing cafe master and facade bakes;
`build_lobby_pilot.py` authors and bakes the lobby independently with the same
coordinate and atlas conventions. Modules are explicitly reloaded on a second
run because the connected Blender Python process persists between tool calls.
Only the named output scenes are replaced. To reproduce the cafe from a fresh
Blender, run `build_cafe_pilot.py`, `build_cafe_lods.py`, then
`build_cafe_close.py`; the lobby script needs only its JSON and shared Python files.
Source scenes are `cafe-pilot-close.blend` and `lobby-pilot.blend`.

Each building now loads one runtime GLB containing all three mesh levels and
four shared images. `cafe-pilot-runtime.glb` is 4,073,604 bytes, down from about
6.27 MB for the two previous separately embedded packs. `lobby-pilot-runtime.glb`
is 1,050,852 bytes. The old master/low packs are retained as authoring references
but are no longer requested by the runtime. Mesh/texture streaming within each
pack is not implemented. The two lots load independently when their coarse city
cells are present, and all other buildings retain their existing rendering.

`AuthoredBuildingPilot` uses an explicit descriptor per lot, validates native
dimensions, radius, interior kind and front direction, and shares the existing
25/30 m and 120/144 m thresholds plus 240 ms dither transition. Selection remains
per building, including through coarse-grid rebuilds. Interior furniture follows
its existing independent policy at LOD1/2. A failed pack returns that lot to its
procedural representation. `?visit=lobby` visits the new existing passage;
`?lobbyModel=0` and `?debug&lobbyLod=0|1|2` mirror the cafe comparison controls.

Validation: **614 tests pass / 0 fail**, and `bun run build` passes. New tests
recompute the real city plan and verify exactly one match per contract, collision
part equality, tangent-front coordinate conversion, native bounds, both lobby
portals with 18 unobstructed rays per LOD, roof hits, triangle budgets and the four
embedded source images without duplicate texture bytes. The test bounds caught
an upper sill projecting onto the zero-gap road; that geometry was corrected.
Final runtime tests cover keyboard entry-to-exit walking, day/night, roof views,
both LOD boundaries in both directions and failed pack loads. Captured dither
transitions span about 15 frames; the close return flight can cross a boundary
again while coasting, and is recorded rather than treated as a stationary test.
For both buildings, aborted asset loading produced the same triangle count as
their disabled-model baseline. Normal cafe load requested each of the two packs once (both coarse cells are
present there), about 5.12 MB total versus 6.27 MB for the previous cafe alone.

Independent cafe comparison confirmed removal of the horizontal seams and return
of the mullions. At the former night seam pixel (763,493), before and after both
read RGB 61/58/54; the restored mullion at (718,280) reads 31/39/39 in daylight and
65/57/40 at night in both images. Window reveals remain visually readable from
street and roof views. Sill edges and some frame shading still differ from the
master. Static image comparisons are not a temporal aliasing/stereo certification.
The lobby review also caught a 6 cm gap below the low-detail roof deck. The
facade now meets its underside, with ray tests at three heights to prevent
recurrence. The corrected roof image no longer shows the white/black fragments;
the previously white pixel (628,703) changed from 253/253/252 to 131/133/130.

All verification screenshots, crops and telemetry are in
`/home/toming/Pictures/Spinward/2026-09-10_building-kit/`: `cafe-before.json`,
`cafe-after.json`, `cafe-flight-checks.json`, `cafe-fallback-checks.json`,
`lobby-checks.json`, `lobby-runtime-checks.json`, `lobby-roof-final.json`, and
the labelled comparison PNGs.
Lobby street comparisons use 8 m cameras; an earlier 18 m camera was inside the
opposite building and is not valid evidence. Elevated fixed-pose comparisons use
`rpm=0`; entrance walking and street views use the rotating habitat. The desktop
GPU remains near its 60 fps cap. This proves these two integrations at the checked
poses, not city-scale throughput, mobile performance or physical XR comfort.

Remaining work: richer room dressing and local ambience/activity for the lived-in
street, then broader building variety and city-scale batching/visibility. LOD3/4,
full interior/roof budgets and physical XR dither review are still outstanding.
No public push or production deployment has been performed.


## Stage 4 completed locally — room dressing and local sound (2026-09-10)

The existing cafe counter now carries an espresso machine, grinder, cups and
stacked saucers. Tables and benches gain cups, books and small plants; a wall
menu identifies ORBIT COFFEE. Meridian gains plants, books and a wall directory.
`build_room_dressing.py` ran through the connected Blender 5.2.1 LTS process and
saved `room-dressing.blend` plus the shared `room-dressing.glb` (325,592 bytes).
The cafe adds **3,617 triangles / 7 material primitives**, and the lobby adds
**1,334 / 6**. These are additional room-detail budgets, separate from the
unchanged stage-3 exterior meshes. All details sit on existing furniture or
walls; original collision parts and portal dimensions remain unchanged.

The shared pack loads once within 32 m of either matching room and below 6.5 m.
Details remain full within 12 m of the room envelope and dither out by 22 m;
their altitude fade runs from 4.5 to 6.5 m independently of exterior LOD.
`?roomDetails=0` provides a visual comparison. Failed loading leaves existing
furniture intact. Geometry/material clones belong to each room; source textures
remain owned by the cached asset. Coarse-grid rebuilds reuse the loaded source.

Room sound follows physical room bounds and real doorways independently of
asset loading. Entering the cafe introduces boiler hum and periodic pressure
release; the lobby introduces low ventilation noise. Outdoor city sound falls
by up to 78%, and wind/rain sound by 85%. Grounded walking adds quiet footsteps,
which stop when stationary or airborne. These synthesized voices share the
existing world/master audio buses, vacuum behavior and M mute. Audio still
requires the existing first click/key/XR gesture. There are no simulated
customers, ordering interactions or seating actions in this stage. Visual rain
occlusion and true sound-source spatialization are not added here.

Validation: **620 tests pass / 0 fail**, and `bun run build` passes. Six new tests
cover room bounds, both portal orientations, wrapped azimuth, ceiling/distance
fades, sheltered ambience and vacuum, GLB dimensions/triangle/byte budgets and
unobstructed door rays. Browser checks cover entry/exit, standing/walking,
muting, roof exclusion, day/night and failed loading. The normal runs reported
no JavaScript errors; the deliberately aborted GLB produced only its expected
network failure. The cafe and lobby each transitioned from zero room weight to
one indoors and back to zero outdoors; the lobby gain then decayed through its
configured tail. Footstep count rose from 0 to 3 during walking and stayed at 3
after stopping.

Actual browser audio output was captured through the master destination. The
cafe sample measured RMS 0.00962 / peak 0.02676, and mute measured RMS 0 / peak 0.
Separate doorway checks measured cafe RMS 0.01123 and lobby RMS 0.01013 indoors.
These verify signal generation and gating, not subjective sound quality: the
agent could not listen to the audio input. A 13.5-second recording is retained
for human listening. Physical XR and city-scale performance remain unverified.

Independent image review recognized the props and readable menu/directory,
confirmed the visible central passages stay clear, and found no large placement
errors. It caught the machine's ORBIT label crossing the body edge; the label
was reduced and lowered. Saucer and book stack spacing was also tightened.
The final independent check confirmed the label sits within the body, stacks
remain supported, and the added night views retain readable menu text and
identifiable cups, books and plants. Night wood surfaces remain quite dark.
The existing plain floor/contact-shadow treatment still makes some table feet
hard to judge from images; no new floating furniture is asserted from that.
Screenshots, review crops, audio and JSON probes are under
`/home/toming/Pictures/Spinward/2026-09-10_room-experience/`.

Next: add a small meaningful action in these rooms (for example seating or a
counter interaction), then broaden building variety and measure city-scale
visibility/batching. LOD3/4 integration remains separate outstanding work.
This stage is local only; no public push or production deployment was performed.


## Stage 5 — usable benches and welcoming entrances (2026-09-10)

Both pilot rooms now provide two bench seats. Approach the clear aisle beside a
bench and press E or the contextual screen button to sit; E/the button stands
up again. Walking, jump or detach input also starts standing. The PC/touch eye
rests at 1.3 m above the room floor, and restores its normal height over 300 ms
on departure. Looking around and local room sound continue while seated;
footsteps are suppressed. The rover retains E away from a bench. Shared links
from a seat restore at its aisle position, so recipients do not spawn inside
solid furniture.

`RoomSeating` owns four stable anchors from the actual cafe/lobby contracts.
Each has a separate aisle point outside original solid furniture. Only a grounded
player within 1.25 m of that point can enter; rooftops, flying and other lots are
excluded. The player sphere remains active but uses sensor response during the
attachment. Contact response returns before standing in the aisle. The rotating
anchor is advanced at the end-of-step angle; dismounts enter normal walking at
the start angle. A 300 ms standing interval allows contact to settle before
locomotion resumes. This was added after browser traces caught floor penetration
when movement resumed immediately, although standalone physics tests passed.
Respawns and city rebuilds release the attachment rather than pulling the player
back. XR entry releases a seat; head-tracked seated interaction is not enabled in
this stage. The authored lots remain specific to the desktop city plan. Touch
UI is checked with that plan forced by `?tier=desktop`, not claimed to exist in
the default phone/Quest parcel plans.

The connected Blender scene now includes thin seat pads, entrance mats and small
OPEN / WELCOME and PUBLIC / SEATING plaques. Mats sit above the existing 25 cm
floor finish without new collision steps; plaques project 18 mm beyond the front
plane, alongside the portal. The existing 3.2 m opening remains unobstructed.
The shared detail asset is now **372,252 bytes**, with **3,955 cafe triangles** and
**1,717 lobby triangles**, seven material primitives in each. Exterior meshes
and distance/altitude policy remain unchanged. Independent visual review caught
plants filling much of the seated view; their foliage was lowered below the
seated eye. Lobby books moved toward the back of the bench to clear the seated
body volume. Thin pads remain visually simple rather than upholstered furniture.

Validation: **624 tests pass / 0 fail**, and `bun run build` passes.
The browser measured a 1.3 m seated eye in both rooms, and touch sit/stand passed
with desktop quality forced. On the 390×844 touch viewport, the action button
ends at y=671, above the mobile controls at y=683 and dock at y=737. Its position
follows their measured height. Normal final browser runs reported no JS errors.
Final independent review confirmed both lowered plants leave the entrance and
eye line clear, and PUBLIC / SEATING remains readable at night.

Four new tests cover real supporting benches, clear aisle anchors, torso/head
clearance against the exported GLB, exact-lot matching, rotating-frame tracking,
respawn/rebuild release, and repeated restoration of real floor collisions.
Browser assertions exercise all four seats with E, Space and walking departures,
button entry and respawn. Additional checks cover held walking after standing,
eye height, day/night entrances and narrow-screen touch input. Evidence, including
the failed intermediate traces, is retained under
`/home/toming/Pictures/Spinward/2026-09-10_seating-street/`. Successful desktop
seat/exit records are in `desktop-final.json`; the subsequent long-input/touch
checks are in `final-followup.json`. Visual checking covers the photographed
poses, not physical XR, city-scale performance or all lighting conditions.

Next: broaden this treatment into neighboring storefronts and a second street
segment; use material/contact-shadow improvements and one small counter action
to make the existing rooms more convincing. Full NPC schedules, economies and
citywide authored assets remain outside this bounded stage. Local work only.


## Stage 6 — three neighboring storefronts (2026-09-10)

A real closed block around the cafe corner now has FOLIO (books and maps),
SPIN CYCLE (laundry) and LEAF MARKET (greengrocer). Each 10.4 m module has a
colored pitched canopy, readable name, closed door and a shallow display.
Bookshelves, six washing machines, and produce crates give the street distinct
uses. The greengrocer's continuous shelves and uprights were added after image
review found the upper crates looked unsupported. All three doors explicitly
say CLOSED / BACK AT 08:00; this is static dressing, not an opening schedule.
They do not add enterable rooms, transactions or NPCs.

The connected Blender scene is `Spinward Neighbourhood Shops`. Regenerate with
`assets/blender/build_neighborhood_fronts.py`; the exact lot/front and module
positions live in `assets/blender/neighborhood-fronts.json`. This is one 48 m
closed block in the desktop R=3200 city plan, not a replacement for arbitrary
buildings. Original building collisions and the central 2 m access remain.
Displays project no more than 0.32 m beyond the original wall; the canopy is
above 2.9 m and projects less than 0.95 m into the existing 2 m setback. No new
ground-level props obstruct walking. Window backing is opaque; this stage uses
shallow relief to stay compatible with the original solid shell.

The single untextured GLB is **446,332 bytes**, with two mesh levels per shop:

| Shop | Detailed triangles | Simplified triangles |
| --- | ---: | ---: |
| FOLIO | 1,822 | 258 |
| SPIN CYCLE | 1,242 | 311 |
| LEAF MARKET | 1,923 | 318 |

These levels belong to the small facade overlay, separate from the complete
building LOD0–4 plan. Distance is measured from each module rather than the tall
building envelope. Complementary screen-space dithering transitions at 45–60 m;
the overlay fades out at 140–175 m and at 12–22 m altitude. First loading occurs
within 190 m and below 25 m altitude. The simplified model keeps the shop name,
window divisions, door and canopy but drops goods, subtitle and closed notice.
Original facades remain on disabled/failed loading. `?shops=0` disables this
layer; `?debug&shopsLod=0|1` isolates a mesh level for inspection.
`?visit=shops` opens the bookshop approach in the matching desktop plan.

Validation: **627 tests pass / 0 fail**, and `bun run build` passes (existing
large-chunk warning remains). Three new tests check exact real-lot binding,
non-interior status, module spacing and central access, surface coordinates and
altitude/distance exclusion, plus actual GLB bounds, triangle/byte budgets and
clear rays through the original entrance. Browser checks load the visit link,
measure detailed display at 20 m, both levels at 50 m (blend 0.263), simplified
at 70 m, then repeat 50 and 20 m. These are separate spawn poses, not a continuous
walk benchmark. The 155 m pose has 0.606 coverage; the 180 m pose has zero.
A 70 m-altitude spawn and the disabled layer make no asset request. Each nearby
page requests the GLB once. Deliberately aborted loading leaves the ordinary
facade and produces only the expected network error. Normal runs have no JS or
console errors. Day/night and forced-low views cover all three shops. Final
independent image review confirms the produce crates sit on visible shelves
and the pitched canopies leave names/subtitles clear, with no additional
obvious placement defects in these views.

Night comparison with `shops=0` confirms the strong white wash in front of the
laundry also exists without these models. It obscures the lower display in that
view and remains a lighting limitation. City-scale performance, continuous
walking transitions, default mobile parcel plans and physical XR are not claimed
as validated. Evidence and probes are under
`/home/toming/Pictures/Spinward/2026-09-10_shopfronts/`.

Next: improve street lighting/contact cues and add a small counter interaction
inside the existing cafe before spreading authored detail across more blocks.
City-wide LOD3/4 integration and scheduled inhabitants remain outstanding.
This stage is local only; no push or production deployment was performed.


## Stage 7 — a self-service coffee break (2026-09-10)

The authored cafe now has a small usable service point on its existing counter.
C or the contextual touch button starts a three-second brew. Stay at the clear
customer-side approach; walking away cancels preparation. Once ready, take the
cup, walk to a bench, sit with E, and use C to sip without standing up. Each of
three completed 1.2-second sip animations lowers the liquid. The empty cup shows
a return instruction; bringing it back to the counter completes the cycle.
Returning a partly full cup is also allowed. Repeat input during brewing/sipping
cannot duplicate service or consume another sip. Coffee does not introduce
currency, staff, needs, health effects or persistent inventory. An ordinary
walk may carry the cup outside; respawn, a city rebuild, driving or XR entry
clears the service. Flying hides the carried cup and cancels an unfinished sip
without consuming it. Seating physics and collision response are unchanged.

The service is bound to the exact cafe interior in the desktop city plan. Its
approach is 2.5 m from the back wall, safely in front of the original solid
counter; the activation range excludes its rear and inside faces. The sign and
pickup cup remain within the existing counter top. The station is rebuilt from
`coffee-service.json`, using the same front-local metres as the other models.
`?visit=coffee` opens the approach; `?visit=cafe` still opens the street entrance.
The keyboard action uses C because F already launches the player from the floor;
a first browser pass caught that conflict before it was saved as the final key.

Connected Blender scene: `Spinward Coffee Service`, generated by
`assets/blender/build_coffee_service.py`. The untextured GLB is **101,632 bytes**:
**896 mug triangles**, **64 liquid triangles** and **549 sign/tray triangles**.
The hollow ceramic mug is 11 cm tall. The handle was moved out of the interior
after image review found it intersecting the drink. The liquid radius follows
the narrowing inner wall during pouring and consumption. World and carried
instances share asset geometry; the counter follows the rotating city frame,
while the carried cup animates relative to the camera. No hands or physically
simulated pouring are added. The asset loads once on entering the cafe; if it
fails, a simple cup keeps the action visible and functional.

Portrait placement adapts to the view width and the actual action-button height.
The coffee button sits above E/Stand up, and both remain above the mobile movement
controls and dock. The tutorial card now also reserves room for these actions;
this fixes the initial explanation overlapping the coffee prompt on a phone.
The automatic controls summary waits until contextual room actions finish, so
it does not cover the drink/stand buttons immediately after the tutorial.
The carried cup rises above the portrait action area. Desktop placement remains
at the lower right. The room's existing ambience continues while seated.

Validation: **631 tests pass / 0 fail**, and `bun run build` passes, with the
existing large-chunk warning. Four new tests cover exact-lot/customer-side
eligibility and solid-clearance bounds, full service cycles and repeat input,
cancellation/reset conditions, and the actual GLB's hollow interior, liquid/handle
clearance, counter bounds and size/triangle budgets. Browser keyboard tests walk
from the counter to the bench, sit, finish three sips, stand and return the cup;
they also check cancellation on departure, a second cycle with one asset request,
and reset after respawn. A 390×844 touch viewport, with the desktop parcel plan
forced, passes brewing, pickup, walking, sitting and sipping. Its action geometry
measures coffee bottom 617 px < seat top 629 px, seat bottom 671 px < mobile
controls top 683 px < dock top 737 px. This is UI emulation, not phone hardware
performance or a claim that the authored lot exists in the default phone plan.

Final independent review confirms the revised handle/liquid stay within the
cup and the portrait actions remain legible without overlaps. With the tutorial
visible, its projected bottom is 494.2 px, above the coffee button at 577 px.
Resting and mid-sip mug bounds also remain inside the 390×844 camera frustum.
The explanation may cover part of the mug while present, but its text and the
action buttons remain readable.

Day/night captures and the aborted-GLB fallback are checked separately. Normal
browser runs have no JS/console errors; the deliberate failed request reports
only the expected network failure. Physical XR, hardware performance, arbitrary
camera poses and natural-looking hand animation remain outside this stage.
Evidence, including failed intermediate checks, is under
`/home/toming/Pictures/Spinward/2026-09-10_coffee-service/`. The successful interaction
record is `runtime-final.json`; additional night, portrait/tutorial and fallback
checks are in `followup-final.json`.

Next: improve the street's night lighting and add more visible everyday activity
around this small cafe district. City-wide LOD3/4 and scheduled inhabitants remain
outstanding. This stage is local only; no push or deployment was performed.

## Stage 8 — Nyaan's apartment and room (2026-09-10)

Added a four-storey apartment building, a shared ground-floor hallway and an
open, walkable room 101. `?visit=nyaan` arrives at its street entrance, roughly
146 m from the cafe. The compact room contains a bed with rounded mattress and
pillow, a window desk and chair, a low table with a cup/notebook, a bookshelf,
calendar, sale notices, a bag, a kitchenette and a bathroom. The window is
transparent and has a solid collider. Other apartments and upper floors remain
closed; stairs, a resident character, door operation and bed/chair interactions
are not part of this stage.

This is a Spinward reconstruction inspired by Nyaan from GQuuuuuuX, not a
measured recreation of the production set. The four floors, room number 101,
exterior and all dimensions/layout are original staging. Reference: the
[official character page](https://gundam-official.com/gquuuuuux/character/2/)
and the [episode 6 discussion in Dengeki Online, 2025-05-15](https://dengekionline.com/article/202505/42032)
(the red Zeon technical-university reference books). The additional permit-book
label and wall notices are authored dressing, not verified quotations from the
room. No production images or external textures are embedded in the asset.

`assets/blender/nyaan-apartment.json` is the metre-based layout/collision contract.
`assets/blender/build_nyaan_apartment.py` builds the connected Blender scene
`Spinward Nyaan Apartment`, saves `nyaan-apartment.blend`, and exports
`public/assets/buildings/nyaan-apartment.glb`. The script uses the existing
`building_mesh_kit.py` and the system Noto Sans CJK font, converted into mesh
letters. The final GLB is **865,372 bytes**, with **10,568 / 977 / 756 triangles**
for LOD0 / LOD1 / LOD2. These share the established pilot thresholds: enter at
25 / 120 m from the full building envelope, exit at 30 / 144 m, with the existing
240 ms dither transition. Low LODs retain architectural openings; nearby
procedural furniture supplies the reduced model where appropriate. Nighttime
material emission supplies inexpensive indoor bounce; no new realtime lights
or shadow maps are introduced.

The exact desktop lot is matched by orientation and all envelope dimensions.
Its former closed collision volume is replaced by the authored solid parts.
The room has a 1.15 m entrance and a 0.90 m bathroom doorway. A browser walk
caught the city's additional 0.25 m vehicle collision margin closing this
bathroom opening: apartment parts now explicitly set `collisionMargin: 0`,
while other buildings keep the existing margin. A real Rapier regression test
runs with the application margin, verifies passage with the override, and
confirms the former inflated geometry blocks it. Shelter sampling is independent
of whether the GLB loaded, and does not trigger cafe/lobby ambience.

Validation: **636 tests pass / 0 fail**, `bun run build` passes (existing large
chunk warning). Five new tests cover exact-lot binding, continuous player-width
clearance, room/entrance/roof shelter, exported model portals/glass/budgets, and
the real Rapier margin regression. Browser keyboard traversal passes street →
hall → room → window approach → bathroom → street with the body enabled and
non-sensor throughout. LOD0/1/2 forcing, natural 60/160 m envelope distances,
disabled-model entry, aborted-asset shelter/fallback, day/night and a 390×844
portrait view are checked. The portrait check forces the desktop parcel plan;
it is not phone hardware or physical XR validation. Normal checks report no
JS/console errors; the intentional failed request reports only its expected
network error.

Independent image review confirmed the entrance, 101/Nyaan plaque, readable
vertical book titles, furnishings, kitchenette and bathroom. It caught a towel
face coincident with a wall, which was separated, and a plain washstand that
needed a basin/tap. The overlapping bathroom-wall corner was also trimmed. A fine dotted join
remains visible in the close bathroom crop; further seam/lighting cleanup is
outstanding, distinct from the resolved broad towel Z-fighting. Original screenshots, detail crops and probe
records are under `/home/toming/Pictures/Spinward/2026-09-10_nyaan-apartment/`:
`runtime-final.json`, `followup-final.json`, exterior/room day/night and detail
captures. Failed intermediate checks remain there as evidence.

This stage is local only. Next candidates: connect this home to an everyday
walking route through the cafe district, add apartment-specific room ambience,
and improve surface wear/lighting. A closer canonical reconstruction would
need direct visual references for the actual room layout.


## Exterior city-block pilot — three complete buildings (2026-09-11)

The first bounded block now replaces three existing R=3200 lots along road 77:
a U-courtyard residential building, an office tower with a recessed podium,
and a stepped commercial building. They match both 64,000- and 16,000-building
plans. `?visit=city-block` opens the office approach. Existing cafe, apartment,
roads and neighboring lots are retained; this is not a citywide replacement.
The new doors are closed exterior dressing, with no new enterable interiors.

`assets/blender/city-block.json` holds the exact lots and structural volumes.
`build_city_block.py` generates three tagged Blender scenes, source `.blend`
files, four named glTF LOD nodes per building, packed 256px day/emission atlases,
and `city-block-audit.json`. It exports only its active scene and restores the
previous scene. All levels preserve the courtyard, podium and setbacks.

| Building | LOD0 triangles | LOD1 | LOD2 | LOD3 |
| --- | ---: | ---: | ---: | ---: |
| Residential | 8,564 | 1,362 | 240 | 48 |
| Office | 5,476 | 810 | 240 | 48 |
| Commercial | 5,426 | 832 | 180 | 36 |

The three GLBs total 1,661,564 bytes. LOD0/1 use five material primitives per
building; LOD2/3 use three. This small pilot has unique meshes, not city-scale
instance batching. Assets are cached after the first geometrically visible
level; a failed request retains the same structural volumes as plain proxies.

Selection measures distance to the structural volumes including altitude:
25/30 m, 120/144 m and 600/690 m entry/exit thresholds. LOD3 persists until its
maximum dimension falls below 1.7 render pixels, returning above 2 pixels.
Projection uses the actual drawing-buffer height/FOV and the more demanding XR
eye. The 240ms complementary dither applies between mesh levels. LOD4 has no
individual mesh; the existing shell receives the volumes' roof/light footprint,
including the courtyard void. It remains a coarse aggregate, not a facade bake.
There is no mesh-to-shell dither at the sub-two-pixel handoff.

The permanent collision volumes follow the same mass contract, independent of
LOD and successful loading. Render geometry uses a rigid tangent frame: bending
large wall quads and small window quads separately caused unequal chords and
fine depth artifacts. At these widths, ground corners bury by at most 2.3cm.
This bounded approximation should be revisited for substantially wider lots.
Roof surfaces are inset beneath parapets; entrance bays exclude overlapping
windows. Atlas RGB is stored as sRGB so reduced levels retain the wall palette.

Validation evidence: `qa/neighborhood-life/city-block.mjs` captures original,
forced LOD0–3, close entrances, night, natural near/street/block/axis/field
positions and deliberate asset failure. PNG/JSON evidence stays ignored under
that directory. Seven regression tests cover real lot binding, exact GLB node
sets, decreasing geometry budgets, bounds, courtyard/recess clearance, altitude
and LOD hysteresis. Full suite: 663 passed, zero failed; production build passes
with the existing chunk-size warning. Browser checks use a stationary colony
for repeatable comparison, not a physical-XR performance test. The visit link
also passes with normal rotation in desktop and 390×844 phone profiles, with
all three assets loaded and no JavaScript errors. Independent image review
found no major holes, entrance/window overlaps or floating buildings; fine
dashed edges remain on oblique inner walls, with temporal flicker unverified.

Remaining scope: citywide instancing, richer glass/storefront treatment, wider
roof/oblique sampling, sustained phone/Quest measurements and stereo dither
review. The three pilots are a functioning five-representation path; the full
city and all design goals above are not yet implemented. Local work only.

## Exterior expansion and shared rendering (2026-09-11)

The three families now occupy 11 exact desktop lots across neighboring blocks;
the phone plan contains eight of those lots. `city-block-expansion.json` records
the eight added placements. Only lots large enough for the original metre-scale
model are selected; existing enterable interiors are excluded. No model is
stretched. A local front offset preserves the original entrance alignment and
is applied equally to render geometry, structural collision and shell baking.
`?visit=city-block` continues to open the original office approach.

All placements now share the original 48 glTF primitive geometries instead of
cloning and transforming every vertex per building. Placement uses the tangent
frame on the object transform. Stable LOD2/3 meshes are instanced by family,
level and primitive; transitioning buildings temporarily use their individual
dithered meshes. Batches change only when membership changes. Their bounds are
recomputed, and instance buffers/materials are disposed independently of shared
geometry. LOD0/1 keep individual material state for the short transitions.

The three asset requests are serialized, starting with the nearest family and
leaving 180ms between completions and the next request. This distributes loading
work and eliminates the former per-placement geometry conversion; it is not a
claim that first-use shader compilation is eliminated. Unchanged lighting skips
redundant traversal. The far-city exact-lot lookup rejects positions outside
the pilot area before creating string keys.

`qa/neighborhood-life/city-block-expansion.mjs` compares `cityBlock=pilot` and
the expanded default at the same overhead view, resolution and lighting. It
checks exactly three requests, at most one active request, 48 unique geometries
in both scenes, and nine instanced primitive draws containing 33 instances for
the expanded LOD2 view. Before batching, that view grew from 202 to 223 total
draws; batching brings the expanded view back to 202. This is a bounded desktop
view, not a citywide or physical-device performance claim. Initial load timing
is reported but not treated as a cold-cache improvement measurement.

Full tests: 664 pass, zero fail; build passes with the existing chunk warning.
The current expansion is deliberately bounded. Whole-city placement, spatially
partitioned instance batches and physical Quest/phone frame-time measurements
remain future work.

## 58-building district (2026-09-11)

Expanded from 11 to 58 exact desktop lots within an approximately 3.6km square
search area; 40 exist in the phone plan. All previous placements and model
choices remain unchanged. `bun assets/blender/expand_city_block.ts` regenerates
the manifest, preserving existing family choices and excluding planned
enterable interiors. Every new model fits without scaling, and the tests check
bounds and front alignment. Lookup rejection bounds now derive from the
manifest. The visit link remains pinned to the original office.

The same 48 geometries and three serialized asset requests serve the district.
At the existing 400m-high comparison view, 3 versus 58 buildings measured
202 versus 208 total draws; at 2200m, both measured 227. Each six-second sample
held approximately 60fps with p95 frame time 16.7–16.8ms on this desktop browser.
The expanded scene uses 18 primitive batches across LOD2/3 at 400m and nine
LOD3 batches at 2200m, containing 174 primitive instances. These capped desktop
samples do not establish hardware headroom or physical mobile/XR performance.
The desktop and phone-profile visit checks pass with no JavaScript errors.
Full suite remains 664 passed / zero failed; build passes with the existing
chunk-size warning. Local changes only; no publishing.

## Both street sides: 112 buildings (2026-09-11)

Added 54 opposite-facing lots, for 112 buildings in the desktop plan and 68
in the phone plan. The previous 58 placements and family choices remain intact.
The search region and original metre-scale models are unchanged. The expansion
script now accepts both sides of axial roads; circumferential-facing streets
remain outside this pass.

Render placement rotates the local across/front axes together by 180 degrees.
Structural collision, courtyard clearance, camera-distance coordinates and
shell footprints follow the same frontage side. Exact-lot lookup also checks
frontage direction, preventing a different-facing lot from reusing the contract.
The new regression exercises open approaches on both street sides and rejects
an orientation mismatch. All 665 tests pass; build passes with the existing
chunk warning. `city-block-facing.mjs` captures the nearest opposite-facing
residential, office and commercial entrances in automatic LOD mode.

The 400m comparison view reports 211 total draws for 112 buildings, with the
same 48 geometries and three serialized requests. The six-second expanded
sample measured median 16.7ms, p95 16.8ms and maximum 16.8ms (approximately
60fps). The three-building baseline had a single 50ms interval; this comparison
is not evidence that expansion improves frame time. Desktop and phone-profile
visits complete without JavaScript errors. Physical-device performance and
continuous walking over the full district remain unmeasured. Local only.

## Four frontage directions: 304 buildings (2026-09-11)

Added 192 lots facing circumferential streets, for 304 desktop buildings and
190 in the phone plan. All previous placements remain unchanged. Tangent-facing
lots swap the model's across/front envelope against the lot's axial/tangential
widths; source models remain unscaled. Both signs of each road axis are now
supported. Render basis, structural centers/extents, distance coordinates and
shell footprints use the same orientation. Regression checks include the city's
actual road-edge-to-entrance access path, rather than only local model coordinates.

Far placements now instantiate only LOD2/3 objects. LOD0/1 objects are prepared
within 180m at loading, or on first promotion into those levels. Shared source
GLBs still contain all four levels; geometry is neither duplicated per lot nor
regenerated. At the 400m overview the render graph contains 18 unique geometries
instead of 48, with 18 instance batches representing 912 primitive instances.
The cold-low-to-near probe verifies creation of LOD0; it is not a continuous
walking or first-use shader compilation benchmark.

The six-second overview sample measured approximately 60fps, median/p95 16.7ms
and maximum 16.8ms, at 211 total draws (the same count as the 112-building view).
Three serialized requests serve all placements. These capped desktop results
do not establish physical-device headroom. `city-block-facing.mjs` now captures
all three model families on both signs of tangent-facing streets. The prior
axial-direction captures remain as evidence. Tests: 666 passed; production build
passes with the existing chunk warning. Local only; not published.


## Entrance paving and canopies (2026-09-11)

The existing 304 placements now share updated Blender models with a 2.4m-wide
paved approach and 3.8m entrance landing, plus a solid cantilever canopy at
LOD0/1. Paving remains at LOD2 using the blank, non-emissive atlas region; LOD3
omits it. No materials or draw primitives were added. Source GLBs total
1,673,788 bytes (+12,224 bytes). LOD0/1/2/3 triangle counts are residential
8600/1398/246/48, office 5496/830/246/48, commercial 5444/850/186/36.

A visual review caught the initial 8cm paving plane disappearing beneath raised
meadow patches on a tangent-facing residential lot. It now sits at local 20cm,
clearing the 10cm patches and less than 6cm tangent sag across these placements.
The asset regression samples actual exported triangles along each approach at
LOD0–2. The paving stays inside the original lot envelope; the narrow grass
setback between some lots and the public sidewalk remains. Doors remain closed,
and this decorative surface does not introduce a new collision step.

The six-second overview sample measured 60fps, median 16.7ms, p95/max 16.8ms,
211 total draws, 18 unique render-graph geometries and three serialized asset
requests. This is a capped desktop browser sample, not physical mobile/XR
headroom. Tests: 667 passed; build passed with the existing chunk-size warning.
`city-block-approaches.mjs` captures six tangent-facing entrances and accepts
`BLOCK_LOD=0|1|2` for fixed-level comparisons. Local only; not published.

After the height correction, independent image review found continuous paving
to the entrance in all six near views. Six forced-LOD2 captures also completed
without JavaScript errors; the inspected office view retains plain paving.
Static captures do not verify temporal flicker or continuous walking.

## Complete city building replacement (2026-09-11)

All planned city lots now use the new architecture. The desktop plan comprises
304 existing authored block placements and 63,696 modular replacements; phone
comprises 190 and 15,810 respectively. The old near/far building batches receive
zero instances, the old facade overlays are retired, and the old
`spinward-buildings.glb` pack is no longer requested. Historical source assets
and dormant legacy helpers remain in the repository; they are not a rendering
fallback. Vehicles, civic furniture and the separate observation/port structures
are outside this city-lot replacement.

`build_colony_modules.py`, executed through Blender MCP, authors the shared
structure, window frame, canopy and door in `colony-modules.blend`, exported as
a 9,572-byte GLB. Runtime recipes assemble these components at metric dimensions
instead of stretching finished buildings. Industrial, stepped/tower, L-shaped,
courtyard/slab and compact residential recipes retain their massing in the
skyline. District palettes distinguish warm old-town walls, cool business
facades and muted industrial surfaces. This is a reusable architectural system,
not 64,000 individually authored meshes.

Window grids divide wall width and height into approximately 2.8m bays and
3.2m storeys. At close range the six nearest eligible buildings receive actual
Blender frames, capped at 8,192 instances. Entrances, handles, canopies and roof
edges remain in the street range; beyond it, shared structural geometry carries
the same massing with a filtered procedural facade. Normal buildings hand off
to the shell at roughly 3–4 pixels and towers at roughly 2 pixels, with hysteresis.
The shell's daytime footprints and night lights use the same structural recipe,
including public-room courtyards. LOD2 and LOD3 intentionally share these small
structural modules; they do not load separate full-building GLBs.

Public rooms retain their existing openings, furniture, collision and recent
Blender cafe/lobby/apartment assets. Their generic structural parts and upper
facades use the new module kit too. Garden houses retain the certified setback
inside their parcel; undersized parcels use a bounded building envelope. The
new regression checks every desktop street approach, as well as structural
bounds at three habitat radii and both quality budgets. If the module request
fails, the same new structural recipe remains visible with simple primitives;
no old building pack is requested.

Validation: 671 tests pass and the production build passes with the existing
chunk-size warning. `colony-replacement.mjs` checks replacement coverage, actual
legacy batch counts, retired network requests, JavaScript and shader errors,
eight browser views (overview, street, old town, industrial, house, phone-profile,
night and aborted-module fallback), and a short structural-update CPU probe.
These browser samples do not establish physical phone/XR performance or full
continuous traversal of the colony. Local changes only; not published.

The final eight-view run reports zero old near/far instances and no shader or
JavaScript errors. Overview, old-town, industrial, garden-house, phone-profile
and night views report 60fps; overview uses 144 draws. All normal views have
p95 frame intervals of about 16.8ms. The desktop street sample nevertheless
contains an 83.3ms outlier; a follow-up waiting for all pilot models to finish
still contains a 66.8ms interval (rolling overlay 56fps). These spikes remain
unresolved, so this change is not a claim of hitch-free traversal. Eight direct
16m focus updates measured 5.2–32.1ms in that follow-up; this is a CPU probe,
not an end-to-end walking benchmark.

Independent image review caught entrance/window overlap and a partially masked
upper window; both were corrected with whole-window exclusion and aligned
geometry frames. A later access regression caught the garden-house setback
contract. Final house imagery shows the retained garden path meeting the new
door; structural/collision tests pass for the corrected placement.


## Facade variety and roof-mounted beacons (2026-09-11)

The requested variety is paint and window rhythm. Each generic colony building
now has a stable, seeded wall/trim palette and a coherent window profile:
bay spacing, storey height, pane width/height and sill position. Residential,
office, industrial and old-town profiles retain their own character. Geometry
frames and facade glass use the same profile, including whole-window exclusion
at entrances. Public-room upper floors use the same design as their exterior.
The shared Blender kit and existing massing remain in use; no extra full-building
assets are downloaded. Facade grids are computed per vertex rather than per
fragment, with compact varyings to limit the cost of the added variation.

Beacons now use the highest actual replacement roof volume and its tangent
transform, instead of the old parcel height/centre. A 35cm support reaches the
roof, the light body is 24cm in diameter, and both disappear with their building
LOD. The authored recessed roof receives its matching 32cm inset. All 700
runtime support positions match the roof anchors in the browser probe.

Validation: 673 tests pass and the production build passes (existing chunk-size
warning). Tests cover roof attachment across four frontage directions and stable
neighbourhood paint/window variation. Independent review of residential,
old-town and industrial images confirms readable differences in wall colour
and window dimensions/spacing, with no observed frame/glass gaps in those views.
The nearby trim-colour differences are less legible at the captured distance.
These are sampled views, not an exhaustive city traversal or physical XR test.

Final browser samples: overview/night 60fps (145 draws), phone profile 60fps
(117 draws), desktop street 54fps (137 draws). Overview/night/phone p95 frame
intervals are 16.7–16.8ms; street p95 is 33.3ms, worse than the previous 16.8ms
sample despite similar rolling fps. Ground-level frame consistency remains an
open performance issue. Eight direct structural updates measured 6.6–31.6ms.
No retired building pack, legacy near/far instances or shader/JavaScript errors
were observed. Roof image review confirms a continuous light/support and a
reasonable nearby light size; exact roof contact is supported by the coordinate
checks, since the untextured roof makes image-only contact judgement uncertain.
Local changes only; not published.

## Street-aware land use and mixed-use lower floors (2026-09-11)

Buildings now have deterministic residential, office, commercial or industrial
uses, with a separate ground-floor use. The certified road kind is attached to
the lot after access certification; this consumes no plan RNG and does not move
roads or lots. Main streets and dense districts favour offices, commercial
buildings and retail below housing/offices. Pure residential and lobby-only
buildings remain, including on main streets. Houses and low apartments do not
acquire retail by height alone. These probabilities are art-direction choices,
not an empirical model of a particular real city. Existing authored city-block
models keep their explicit uses; enterable cafes, passages and apartments remain
authoritative about their ground floors.

Upper windows now follow use rather than deriving office/residential character
from the shape alone. Apartments have low-sill dwelling openings and nearby
Blender balcony decks/parapets with close-range dwelling dividers. Offices keep
continuous fine bays, while commercial buildings use broader, taller openings.
Retail lower floors have large glazing, individual tenant signs, canopies and
separate doors; the certified central approach remains the upper-floor entrance.
Some tall central buildings have two retail floors. Tower podiums reserve enough
height for these floors without changing the parcel envelope or total height.
A lobby gets glazing and an entrance, without shop signs. New tenant fronts are
exterior detail; this increment does not make every shop or balcony enterable.

The shared Blender module pack adds a 48-triangle balcony component and remains
under 14KB. Balcony geometry is bounded to eight nearby apartment buildings
(within 65m); window frames retain their existing close-range cap. Signs use one
atlas and one instanced draw. Lower-floor shading has its own batch so ordinary
buildings keep their previous shader. Structural buffer capacity is allocated
from the actual use counts, not three whole-city reservations. Ground-floor
colour/glazing and upper window profiles persist after near details disappear.

Regression coverage includes street-kind provenance, a mixture of uses on each
street class, main-street/back-lane contrast, house/industrial exclusions, stable
identity, all retail-bearing masses having room for the frontage, unobstructed
central approaches, and the Blender module dimensions/budget. The previous
layout hash is retained after excluding the new derived road metadata: lot,
road and park positions remain unchanged. Existing interior/collision checks
continue to cover their original openings.

Validation: 676 tests and the production build pass (existing chunk-size warning).
The six use views show apartments, mixed-use housing, offices and commercial
fronts; final street close-ups confirm tenant doors and a separate central
entrance. Independent review caught inverted sign text and high apartment
window sills; both were corrected. The final reviewer found no major visible
floating pieces or penetrations, but balcony floor contact remains obscured by
the parapet in these images. The profile/geometry checks cover the low-sill
placement; no balcony traversal is claimed.

The final overview, original street, phone-profile and night samples each report
30fps on ANGLE/Metal Apple M1 Pro, with p95 about 33.4ms. Original street uses
140 draws versus 137 before; overview 146 versus 145; phone profile 120 versus
117. Structural triangles remain at the same rounded 3.7M/2.4M totals. An isolated
build of the previous commit 8375b0b, run on port 5193 during the same session,
also reports 30fps for street/phone and 34fps overview. Earlier samples in this
session varied from 22 to 54fps; disabling the new ground shader/details in one
page made little difference. Consequently these runs do not establish a clean
performance delta or reproduce the earlier 60fps baseline. The GPU renderer is
now recorded in the QA report to guard against silent software rendering.
Eight direct final structural updates measured 9.2–57.1ms; the first-update spike
and end-to-end traversal smoothness remain unresolved. This is browser sampling,
not physical phone/Quest validation. Local changes only; not published.

## Tenant fronts, arrival details and stable structural buffers (2026-09-11)

Tenant fronts now vary beyond sign text: sloping fabric awnings or flat canopies,
left/right doors, timber lower panels, and small book/pharmacy display silhouettes.
The Blender module pack adds a 24-triangle sloping awning and is 16,104 bytes.
Its separate instanced batch adds one draw where these details are visible.
Residential entrances receive a residence label, mailboxes and intercom; offices
receive a wider portal/canopy and glass sidelights. Small buildings omit these
larger portals. The certified central approach is retained. This is still exterior
representation, without newly enterable interiors or interactive fixtures.

Structural rendering now keeps dense instance slots between focus updates.
A building entering/leaving the visible set inserts/removes its own parts; a
removed slot is filled by the last live part, copying its matrix, colour and all
facade attributes together. Unchanged membership leaves structural buffers alone.
Near decoration still refreshes within its existing bounded radius. GPU update
ranges persist until Three uploads them, including multiple updates before one
render. A scene/asset rebuild resets every slot before repopulating the batches.

Tests exercise repeated visibility churn, surviving transforms/colours/profiles,
no duplicated slots, stationary membership doing no upload, and pending ranges
surviving multiple updates. Browser churn additionally compares each live slot
against its building's expected transform, colour and facade after eight moves.
Independent visual review confirms tenant variation, distinct residential/office
arrival cues and upright text, with no major visible floating canopies or blocked
doors. Cars obscure parts of the entrance feet, and small intercom details are
below the captured image's reliable resolution.

An initial browser check caught an asset-swap regression: resetting slot storage
also reset visibility hysteresis and removed distant buildings. Slot resets now
retain each building's prior visibility, and the browser probe explicitly rebuilds
all batches at the same focus and asserts that membership is unchanged.

Final validation: 678 tests and the production build pass. At the original
street focus, 67,766 structural instances remain visible. Eight subsequent focus
updates write only 182, 24, 49, 27, 23, 33, 36 and 21 slots (including swap copies),
instead of rewriting every visible part. Their CPU times are 33.0, 29.3, 6.8, 6.3,
5.0, 4.6, 6.1 and 5.0ms. The post-movement buffer checks pass for all live parts,
and a full batch rebuild preserves the same visibility membership. These slot
write counts are CPU mutations, not the number of vertices drawn or exact GPU
upload bytes; the upload ranges can span unchanged slots between edits.

The final overview/street/phone-profile counts match the preceding increment
(28,406 / 27,927 / 8,506 visible buildings). On Metal/M1 Pro, sampled overlay fps
is 20 / 20 / 27, with p95 intervals of 83.3 / 150 / 50ms. These results remain
poor and variable; the reduction in structural work is not a claim that total
frame rate or traversal hitches have been solved. Street draws rise by one
(140 to 141) for awnings; overview stays at 146. This session did not obtain a
controlled new before/after frame-rate baseline. Local changes only; not published.

Night rendering and the aborted-module fallback also pass without JavaScript or
shader errors. The first fallback navigation exceeded the browser's 30-second
load timeout; a separate retry using DOM readiness and explicit scene/asset
readiness passed. The harness now checkpoints each completed view so a later
navigation timeout does not discard earlier results. Night and fallback still
show frame-interval spikes; these checks establish rendering correctness, not
hitch-free performance.

## Glazing, curtains and night occupancy (2026-09-11)

Non-pilot colony buildings now distinguish residential curtains from commercial
and office blinds. Glass tint varies by building; curtain openings and blind
heights vary by window. A resident's warm window light is selected per dwelling,
while offices/commercial premises light groups of windows on the same floor in
a cooler white. Ground-level shop glazing remains separate. These are fixed
exterior appearance cues, not simulated resident schedules or new interiors.

Window identity is seeded from the building and facade side, with a floor phase
for upper masses. Camera movement, instance-slot compaction and detail promotion
do not reroll it. The shared interior-layer upper facade uses the same attributes;
the authored cafe/lobby/residential pilot materials remain authored assets.

The change adds one vec4 instance attribute and no meshes, textures, draw calls,
dynamic lights or GLB changes. Curtain edges use the pixel footprint; fine blind
slats fade before becoming subpixel. Distant windows collapse to a use-dependent
average light contribution and skip the detailed surface function. Derivatives
are evaluated before divergent window branches. Glass and fabric also have
different roughness.

Same-position before/after captures use `windows-{before,after}-{day,night}-{mixed,office}.png`
in `qa/neighborhood-life/` (local ignored evidence). Both daytime views keep
the same visible buildings, instance counts and draws: mixed 27,935 / 67,776 / 170;
office 27,943 / 67,799 / 160. All four before/after pairs use Metal on M1 Pro.
Frame intervals remain variable: daytime medians mixed 33.4→49.9ms and office
33.4→33.4ms; night mixed 49.9→49.9ms and office 33.4→50.0ms. These sequential
captures do not establish a frame-rate improvement or isolate a regression.

The same-page `colony-window-cost.mjs` probe alternates the new window-surface
function on/off twice, retaining the rest of the scene. All four samples report
50ms median / 66.7ms p95, so no additional cost is resolved at this frame-time
granularity. This bypass is a QA-only material patch, not a runtime quality flag,
and is not an old-build comparison. Overall frame rate remains an open issue.

Validation: 680 tests and the production build pass. Browser checks pass for the
street, phone quality profile, night overview and aborted-module fallback, with
no JavaScript/shader errors or retired building batches. Live-slot validation
now checks glazing kind, tint, occupancy and floor phase after eight focus moves
and a full batch rebuild. Visible membership remains unchanged by that rebuild.
The phone profile was checked on desktop Metal, not physical phone/XR hardware.

Independent review of all eight before/after images confirms the intended use
distinctions, window-bound shading, preserved window-frame alignment and separate
ground-floor glazing. No mandatory visual correction was identified in those
views. Flat curtain shading can still read as panels close up; cloth folds are a
future refinement. Static captures do not establish temporal shimmer behavior,
back-facade quality or XR comfort. Local implementation only; not published.

## Planted entrance edges with shared collision (2026-09-11)

Residential entrances, office lobbies and selected grocery/bakery/coffee/market
frontages now receive small planted containers where the existing pavement has
room. Residential pots are narrower and clay/stone coloured; office containers
are wider and darker. Shop containers stand beside display glazing, away from
the alternating shop door. At most two are selected per building, preferring
the candidates nearest the central entrance on long commercial facades.

The planner works from actual carriageways and certified entrance corridors.
It requires the entire footprint to lie on the existing paved band, keeps at
least 2m between the pot and kerb, excludes road ends/intersections and rejects
overlap with other lots, any certified approach or another new container.
Narrow streets, houses, industrial buildings and enterable/authored pilots are
excluded. Pavement is not expanded to accommodate decoration. In the 250m-radius
generated test layout no candidate has spare space, so none is placed; the
four-direction synthetic fixtures separately exercise valid small-radius cases.

The connected Blender generator adds a hollow tapered `planter` (28 triangles)
and a three-crown `planting` module (240 triangles). Smooth shrub normals and no
unused shrub UVs keep the complete eight-node pack at 23,040 bytes, up from
16,104. Only the owned SWCM scene is rebuilt; the active Scene is restored.
The runtime uses two shared instanced batches, capped at 320 pairs within the
existing 160-building near-detail selection. No per-pot lights or textures are
added. The geometry-only maximum is 85,760 additional triangles, including both
parts; normal street views contain far fewer pots. Distant views omit them.

Render placement uses the local surface normal at each pot, with the same
0.32/0.33m lift as its sidewalk orientation. Permanent collision is generated
from the same layout and blocks the solid pot while leaving foliage soft.
Loading failure uses visible box proxies at those same positions. Collision
does not disappear with rendering LOD. Existing building masses, entrances,
shop signs and window grammar are preserved.

Unit checks cover all four frontage orientations, the cylinder seam, 250m and
3200m radii, centre-door and kerb-side walking, crossing roads, neighbour lots,
other buildings' approach paths, the actual 64k layout and GLB bounds/budgets.
The reusable browser `forecourt-probe.mjs` compares rendered matrices to the
permanent collision list and local gravity and verifies the instance cap.

Independent visual review flagged the office pot's proximity to the intercom.
A walking-collision probe reproduced the problem at a standing position 0.8m
in front of that panel with 0.45m body clearance. Moving each office pot another
0.2m outwards clears that position; the regression now runs in all four frontage
orientations at both radii. This clearance is a scene design check, not a claim
of accessibility-standard compliance. The residential mailbox and shop doors
retain their existing separate clear space.

Validation: all 683 tests and the production build pass. The final default
layout contains 4,522 planned containers. Close daytime views of residential,
office and shop frontages checked 11, 3 and 4 rendered pots respectively against
their permanent colliders. The final office placement also passes the same
matrix/collision checks by night, with no JavaScript or shader errors.
Independent review confirms that the visible left pot leaves more room beside
the intercom in both light conditions and introduces no visible grounding or
entrance obstruction. The right pot is outside these final close views; its
clearance is covered by the symmetric layout and collision regression tests.

Broader street, phone-profile, night-overview and aborted-module fallback checks
passed before the final 0.2m office adjustment. The ordinary street view adds
two draws for the two shared batches; frame intervals remain variable and these
checks do not demonstrate an overall frame-rate improvement. Browser captures
use Metal on an M1 Pro; the phone tier is a desktop profile check, not physical
phone or Quest performance validation. Local implementation only; not published.

## Residential balcony grammar (2026-09-11)

Upper residential facades now use two stable balcony treatments: continuous
solid parapets for broad/tall slabs, or separate open metal guards at individual
window bays. Solid parapets take their colour mostly from the wall, reducing
the previous dark bands. The metal version retains the building's trim colour.
Projection varies by building from 0.95 to 1.15m. Nearby continuous balconies
have 1.3m privacy dividers at every second window-bay boundary.

The pure layout uses the same upper-window grid as the facade shader, after
subtracting any retail/lobby floors. Decks remain at those floor levels and
attach 4cm into the facade. A whole-section overlap test removes balconies
embedded in a podium roof or hidden by a projecting wing, while preserving
exposed bays beside it. The first deck is above the 3.4m entrance clearance.
Office/commercial/industrial buildings, houses and authored/public interiors
are excluded. These are facade details; usable balcony rooms and new balcony
collision surfaces are not introduced.

Blender adds one `balcony_rail` module: slab, open pickets, rails and solid side
returns, 144 triangles. Its height stays metric (deck bottom -0.12m, guard top
1.07m); only the bay width and shallow projection adapt to the building.
The nine-node module pack is 31,444 bytes, within the existing 32,000-byte cap.
Only the owned SWCM scene was regenerated and the previous active Scene restored.

The existing 65m/eight-building detail selection remains in place. There are at
most 144 sections per building and 1,152 across both balcony batches. A building
whose individual bays exceed that cap receives continuous parapets instead;
rows are admitted whole, without truncating a railing halfway along a floor.
The module-geometry ceiling is 165,888 triangles, with bounded privacy dividers
reusing the existing trim batch. Planning and colour mixing happen only for
selected near buildings, without storing a balcony layout/colour on every lot.
Far geometry, structural membership, shop fronts and the planted pots are intact.

Validation: 685 tests and the production TypeScript/Vite build pass. Generated
16k layouts at 250m and 3200m radii check window/floor alignment, clear masses,
both treatments and budgets. Synthetic wing and podium fixtures verify that
exposed bays survive while roof-embedded decks disappear. Export tests verify
metric bounds and the 144-triangle ceiling. The browser's independent
`balcony-probe.mjs` infers attachment, scale and window-grid alignment from live
instance matrices rather than calling the placement helper.

Same-position before/after captures are `balcony-{before,after}-{apartments,mixed}.png`
in the ignored local QA directory. Visible membership and structural counts
are identical in each pair; draw totals remain 165 and 172 respectively.
Both before and after record 50ms median / 66.7ms p95 frame intervals on M1 Pro
Metal. These measurements do not demonstrate a frame-rate improvement.
Broader street, phone-profile, night overview and failed-module fallback checks
pass, including existing planter-collision and structural-buffer churn checks.
The ordinary street view stays at 143 draws; the far overview contains zero
balconies. Phone-profile checks run on desktop, not physical phone/Quest hardware.

The final close metal-balcony views check 177 rendered sections across six
buildings (54 metal, 123 solid) against their facade frames in both daylight
and night. They report no JavaScript/shader errors. Independent visual review
of the two before/after pairs and the close day/night views found no mandatory
correction: open guards attach visibly to their decks, boundaries follow window
bays, the mixed-use podium is clear and guards do not glow at night. Wall-like
parapet colour reduces depth contrast, and adjacent metal-bay side returns read
as paired fins; these remain aesthetic refinement points. Hidden backs and
motion shimmer are outside this static review. Local implementation only;
not published.

## Rear stairwells and exterior stairs (2026-09-11)

Selected multi-storey buildings now show rear stairwells. A narrow opaque strip
replaces the ordinary window bay, with a ground door and small windows at the
intermediate landings. Low/mid-rise residential and commercial candidates can
instead receive an open switchback stair. The default 64k plan selects 4,665
stairwells, of which 175 have enough space for the exterior version. Towers
without a continuous rear wall are left to their internal circulation rather
than receiving a disconnected shaft across setbacks.

Exterior eligibility uses the actual parcel, all roads, neighbouring footprints,
certified entrance approaches and previously reserved stairs/routes. The whole
6.4m × 2.8m assembly and a 1.2m ground route along the building side must fit in
the parcel, joining the existing street frontage. Dense lots therefore tend to
retain enclosed stairs. Small habitats below 800m radius use the enclosed
representation. The exterior variant is capped at 34m building height and uses
the floor grid of its continuous main wall, including 4.2m retail levels.

The connected Blender generator adds a twelve-tread `stair_flight` module with
144 triangles. Flights scale in rise while separate stringers, landing rails
and posts retain metric dimensions; sloping handrails stay 1.05m above a flight.
Two opposing flights meet an intermediate landing and each upper floor landing
meets its rear door. The plinth covers the local ground curvature. The top of
each support column terminates at its own landing rail; independent image
review caught intermediate-landing columns initially extending too far up, and
this has a regression test.

This is exterior architecture for currently non-enterable buildings. The ground
gate is closed, and a permanent conservative collision envelope reserves each
exterior stair assembly. It is not a playable route into upper-floor rooms or
an evacuation simulation. The optional-asset failure path draws an opaque proxy
at that same envelope, so an invisible collision volume is not left behind.

Rendering stays within the existing 144m near-detail selection: at most four
exterior stairs and six enclosed stairwells, with 96 flight instances and 4,096
simple parts across two shared batches. Stair doors/windows share the stair-parts
batch rather than consuming the storefront-door buffer. The complete ten-node
GLB is 38,808 bytes (previously 31,444); its explicit asset budget is now 48,000
bytes. No new textures or lights are added, and far geometry is unchanged.

Validation: all 688 tests pass (114 files), and the production build passes.
Stair tests cover both frontage axes and signs, the cylindrical seam, 800m/3,200m
fixtures, and generated 64k plans at 250m/3,200m radius. They check parcel/road
clearance, flight-to-landing transforms, tread rise, permanent collision envelopes,
support heights and complete instance budgets. Live renderer probes found two
exterior stairs and one enclosed stairwell at the exterior viewpoint, with all
16 flights and 16 landings present. The reverse view exposes the ground gate;
independent image review confirmed the corrected column ends and found no clear
defect in the visible plinth, enclosure or gate. The asset-failure view has no
flights and retains two visible opaque proxies and their collision envelopes.

Desktop, phone-profile, night and asset-failure street checks also pass, including
the existing balcony, forecourt and structural-visibility probes, with no reported
JavaScript/shader errors. The standard street view adds one draw (143 to 144);
the distant night overview draws no stairs. Settled exterior captures report
60fps and 16.7–16.8ms p95 frame intervals on desktop Chrome/Metal (Apple M1 Pro).
An earlier transient slow capture prevents treating these as a speedup claim.
The phone check is an emulated profile, not a physical phone or Quest result.
Local implementation only; not published.

## Roof services and surface finishes (2026-09-11)

The replacement roofs now carry physical-size service equipment: apartments
receive one or two compact HVAC units; offices and commercial roofs receive
three to five; industrial roofs mix exhaust hoods and HVAC in four to six
positions. Placement uses the highest/largest actual roof, the same selection
as the beacon anchor. It keeps at least 1m inside the roof edge, 0.8m between
units and a clear central beacon/maintenance area. Narrow roofs may fit fewer
units or none. Courtyards, pitched-house lots, public rooms and authored pilot
buildings retain their existing treatment. These are visual services, without
new interactions or physical equipment colliders.

Blender supplies a louvred two-fan HVAC mesh (348 triangles) and a capped
exhaust hood (48 triangles), each a single primitive with vertex colours.
The cabinet/grille contrast needs no textures. Exported local bounds are
x/z ±0.5 and y 0–1; runtime supplies the equipment's metric dimensions, with
uniform size variants and quarter-turn orientation. The full twelve-node GLB
is 66,028 bytes, against an 80,000-byte budget.

The roof surface has subdued colour variation and filtered metric seams.
These use the existing facade shader and add no geometry or texture fetches.
Equipment has independent distance tiers measured from the roof: detailed
below 70m (retained to 84m), box silhouettes through 240m (retained to 260m),
then no individual equipment. At most 24 roofs/144 units are selected, with
detail capped at eight roofs/48 units across two detailed batches and one
simple batch. The simple material approximates the detailed cabinet colour;
failed module loading uses the same bounded boxes.

All 691 tests and the production build pass. Geometry tests cover actual
16k plans at 250m and 3,200m habitat radii, all four frontage orientations,
roof/beacon contact, spacing, exclusions, stable variation, export budgets and
LOD hysteresis. Browser probes inspect the actual instance matrices and vertex
colours. The same office roof is detailed at 35m, simplified at 110m and absent
at 300m; failed loading retains only simple units. Apartment, office and
industrial daytime images and industrial night imagery show no clear equipment
floating, overhang or intersection in independent review. A faint dotted seam
at the office's L-shaped roof joint remains a low-confidence static-image
observation, not a confirmed geometry defect; motion/XR inspection is still
outside this review. Local implementation only; not published.

Broad street/phone-profile/night/fallback probes also pass, including balcony,
stair, forecourt and structural churn checks. The standard street view is
145 draws (previously 144), the phone profile 123 (previously 122), and the far
night view still 146 with zero roof units. Desktop Chrome/Metal captures report
60fps and 16.7–16.8ms p95; these are not physical phone/Quest measurements.
