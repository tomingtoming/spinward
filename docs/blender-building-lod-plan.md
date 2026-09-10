# Blender buildings and LOD plan

Status: staged implementation authorized by toming on 2026-09-10. Stage 1
has a connected-Blender cafe master and local integration; production is unchanged. Baseline: local frontage study `879e234`, parent production
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
