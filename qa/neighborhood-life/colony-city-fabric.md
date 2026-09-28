---
origin: ai
created: 2026-09-19
---

# Whole-block city fabric — composed application candidate

The normal preview at 5192 still serves the earlier regional-streaming build.
An isolated, frozen candidate at 5293 now displays the composed city and has
desktop and actual playwright-webxr 0.3.0 results below. Later collision
optimizations remain staged separately from that tested candidate. The
whole-colony goal is incomplete; passing travel checks does not establish
reference fidelity or whole-city completion.

## Reference and visible change

The civilian parts of episode 05 screenshots `0039` and `0041` are the current
comparison: varied roof outlines, tightly connected small plots, and building
fronts framing narrow streets. Smoke and combat elements are excluded. The
new dimensions and district layout are Spinward design choices, not measurements
or a recovered canonical plan of Izma.

The first candidate still put its two alley entrances on neighbouring long
edges. It increased building counts without using much of the block interior;
the market sample actually lost its central building cluster. Independent visual
review rejected this as sufficient progress toward the reference.

The second candidate chooses openings across connected buildable land, routes
around reserved buildings, and adds branches into remote parts of larger blocks.
House widths and depths are bounded separately from apartment and commercial
plots. Passage intersections are unioned before constrained triangulation, so
the new paving does not consist of overlapping ribbons. The Blender writer
splits paving at the existing terrain triangles and makes near/middle/far meshes
from the same saved building form.

Four fixed aerial samples show the difference: old town, housing, market and
campus. The comparison keeps the aerial cameras and blocks fixed between v1
and v2; ground cameras follow newly chosen entrances and therefore differ.
These are native Blender context excerpts, not screenshots of the web app.
The rendering includes saved ground/roads and nearby original building meshes;
it is not a complete assembly of all runtime layers.

## Current native candidate v3

The plan reserves the actual off-centre warehouse/civic door before allocating
neighbouring plots and assigns retirement to each disconnected site. Placement
checks saved terrain and road heights, trying shorter parcels where a deep pad
would expose an excessive retaining wall or leave insufficient stair length.
Gates more than 0.8 m above nearby ground are not used as short ground connections.

A derivative adds 1,959 walkable paving faces over the 30 cm reserved margin
between interior alleys and entrances. They overlap the alley by 2 cm with a
5 mm surface offset. Exterior street frontages still need pavement composition.

| Measure | Result |
|---|---:|
| Urban districts / complete street-enclosed sites | 13 / 110 |
| Available land after protected reservations | 2,340,403.86 m² |
| Planned/native buildings | 4,574 |
| Building footprints | 1,090,832.28 m² |
| Proposed passages | 369 / 28,854.71 m |
| Sites with a planar through-passage | 109 |
| Native near / middle / far triangles | 8,706,918 / 1,951,926 / 229,730 |
| Native passage triangles | 92,932 |
| Additional entrance connection triangles | 3,918 |
| Compressed connected candidate `.blend` | 132,446,857 bytes |

These describe offline assets, not resident GPU cost or installed city additions.
Large blocks still require bounded detail tiles rather than one file per block.

## Geometry and remaining installation gates

The full v3 audit found no reported building/building overlap, building/passage
overlap, building outside reserved land, or door approach outside its reservation.
Every native door matches the planned position within 1e-6 m. Short entrance runs
fell from 151 to zero, retaining walls over 2.4 m from 27 to zero, and duplicate
retirement assignments from 91 to zero. There are 2,419 unique source parcels to
retire. All 1,959 entrance connectors overlap pavement, stay inside allowed land
and avoid buildings.

Remaining screening flags are two upland passage grades (12.18% and 10.16%) and
one single-entrance old-town site, `a-old-town-296b1781bba9`. The audit's 10% grade
threshold is an authoring review threshold, not a measured physics limit or a
statutory accessibility claim. A connected cul-de-sac is not inherently invalid;
its usability and service access still need review. 108 sites have none of these
listed flags. This is not a physics or accessibility certificate.

Installation must retire all source parcel objects, including old paving and
entry lights, and rebuild dependent frontages/land use before composing collision,
bounded detail tiles, regional loading and the far scene. The native context
excerpts still include old fixed paving and are not complete runtime assemblies.

## Visual comparison

Independent review found improved interior density and passage paving from v1 to
v2, with repeated building motifs, weak ground-floor identity and disconnected
entry aprons remaining. The v2 wall fragments were isolated to Workbench shadows:
the same camera and geometry with shadows disabled removes them. This diagnoses
the inspection render, not a web-app defect or old-paving geometry fault.

The v3 renders disable shadows and add river, upland, port and civic samples.
Doorways are clearer and sampled slope changes are accommodated. Riverbank/highway
continuity is outside those frames. Roof equipment, window grids and canopies
still repeat. Episode 06 screenshot `0063` was reopened with 05 `0039`/`0041`:
balcony depth, pipework, wall equipment and varied occupied windows remain targets,
not claims that these offline models already reproduce the reference night scene.

The final fixed-camera comparison covers the port and civic entry connectors.
An independent image-only reviewer inspected enlarged entrances and found the
visible paving continuous in both samples (port: medium confidence; civic: high).
Changes are confined to the entrance area; no new wall/window/canopy defect was
observed. Pillar-occluded areas, exact heights and physical passage are unverified.
This is a two-entrance visual result, not whole-city acceptance.

## Evidence and verification

Local evidence directory: `qa/webxr/evidence/colony-city-fabric-20260919/`.

- `parcel-ground-access.json`: v3 geometry plan; SHA-256
  `197b2ec92ff1fd7472655d11b73c474de17bb445041b7faf47ea0a9589ea8486`.
- `city-candidate-v3-connected.blend` / `.json`: native meshes, height audit and
  entrance connector coordinates. Original v1/v2/v3 evidence is retained.
- `v3-connected-candidate-audit.json`: all site/door/connector/grade results.
- `v3-*-{before,candidate,passage}-native.png`: four districts, twelve images.
- `v3-connected-a-{port,civic}-*-native.png`: fixed-camera connector comparisons.
- `v2-shadowless-b-campus-passage-native.png`: isolated shadow-render probe.
- `geometry-tests-connected.log`: ten tests passed for crossed/open/concave/nested
  roads, stable identity, obstacle avoidance, disconnected courts, non-overlapping
  pavement holes/junctions, branched allocation and actual off-centre rotated doors.

`parcel-ground-stable.json` is a dependency-only revision: district geometry is
exactly equal to v3. It hashes actual terrain vertices/earth triangles rather than
the mutable output manifest, avoiding circular invalidation during later export.
SHA-256: `8dbbfeb25a3e1c9f7c988030f6e903309298c746265249a4812d019d0beb06da`.
Terrain hash: `1c47324b4cac36986b9348c089c6e85d97503606ff690373178167e9de9e350e`.
Native v3 retains its original plan hash. Installation must explicitly verify the
geometry-equivalent dependency migration when composing the saved scene.

Blender 5.2.0 was inspected through its isolated MCP CLI tool. Candidate generation
and rendering used separate background Blender processes; the existing GUI scene
was not changed. The restricted direct launch crashed before the script ran;
the subsequent approved native runs completed. Both render runs exited 0 and
printed small Blender memory-release warnings on shutdown; those are retained
in the logs. Python syntax checks passed for all eight owned authoring files without writing outside the workspace.

## Composed native city and staged export

The existing 5,679-parcel neighbourhood source is now composed with the saved
candidate: 2,419 source parcels retire and 4,574 new parcels enter, yielding 7,834.
The pre-existing three complete blocks still omit their disjoint 22 source IDs,
so the exported neighbourhood layer contains 7,812 buildings. Primary architecture,
public facilities and the finished blocks are additional layers, not included in
this neighbourhood count.

All parcel-tagged objects retire together: 4,838 fixed lot/entrance meshes,
3,139 near objects, 3,139 middle objects and 720 lights. Near/middle counts include
the retired street-lamp meshes. The composed source retains 32,405 objects and
490 street/passage records. New courtyard apartment guard envelopes use the actual
front-wing dimensions, rather than the old single-slab depth assumption.

Permanent native sources are `assets/blender/izma-city-neighbourhoods-*.blend`
(18 districts), with `izma-city-neighbourhoods-native.json` as their hash index,
`izma-city-neighbourhoods.json` as the parcel contract and
`izma-city-fabric-plan.json` as the plan. The largest native district is campus,
29,388,540 bytes; total native parts are 212,020,772 bytes. Blender MCP independently
opened campus with no linked libraries and then assembled all eighteen parts,
confirming 32,405 objects and all 7,834 parcel IDs with no external source-library
dependencies. The initial verification fixture could not link its own currently
open file; using an unrelated rail file as the empty inspection context resolved
that harness constraint. The 210,213,105-byte full assembly is preserved only in
ignored evidence as `city-composed-full.blend`.

The first composition attempt spent its measured stack samples in Blender's
per-ID append/localization work. Only that owned process (PID 90595) was terminated
(exit 143), with no output file created. Linking the candidate for reading and
copying the required local meshes completed successfully; original files and the
GUI scene remained intact. Logs and the recorded stack sample preserve the attempt.

The new neighbourhoods were exported under `integration/`, not installed into the
running app: 306 detail tiles, 789,801,165 total tile bytes, largest tile 4,177,127
bytes (under the 4 MiB request bound). Near/middle totals are 14,461,292 / 3,267,276
triangles across the composed source, not resident GPU load. All 4,349 new balcony
guards were checked against saved native vertices with a 0.1 mm local tolerance.
Use `export_izma_city.py` with background Blender's factory startup and an explicit
`--output-root` to load the native district parts for subsequent exports.

Post-export inspection found 2,741 collapsed collision triangles. The city export
now cleans fixed ground after position rounding. The staged correction removes
those faces plus 23 collapsed drawing triangles without deleting any surface
group; a second pass removes zero faces. Corrected fixed drawing count is 369,477,
with 7,724 physical surface groups. This finding was not hidden behind successful
planar tests or the earlier native threshold checks.

Land use has been replanned and rebuilt against the composed parcels: 121 zones,
zero overlap with all 7,812 building foundation envelopes, and exactly unchanged
areas for the six allotment/orchard/woodland zones. All 37 retained corner entrances
were separately checked against the new building footprints, with zero overlaps.
The rail, new land-use and pavement layers are now exported, with all 37 corner
buildings and the existing three complete blocks restored. The native pavement
covers 506 paths in 13 urban districts (179,752.98 m²). Its maximum rise over
terrain is unchanged from the previous pavement source, 12.7398 m; this is not
a certification of every raised path. An initial corner export wrote the data
but failed to create its evidence directory. The exporter now creates that
directory, and the corrected run completed with Python errors mapped to a
nonzero Blender exit status.

Derived grounds use distinct `izma-city-land-use*` and
`izma-city-street-frontages*` filenames. Original contracts remain immutable
planning inputs, avoiding circular hash dependencies. Set `SPINWARD_CITY_FABRIC=1`
and an absolute `SPINWARD_AUTHORING_ROOT` for this pipeline. The running manifest,
normal preview and production build remain unchanged. App/VR tests must run on
the completed installed assembly, not the old preview.

Evidence includes `compose-linked.log`, `export-composed.log`,
`native-parts-mcp.json`, `native-parts-assembly-mcp.json`,
`composed-land-audit.json`, `corner-entry-audit.json`,
`composed-collision-audit.json` and `composed-ground-cleanup.json`.

## First composed runtime, frozen for application verification

All nine fixed layers were audited together. This exposed another 38 collapsed
collision triangles in the retained primary architecture; those were removed,
and the ordinary architecture exporter now performs the same cleanup. No physical
surface group or drawing triangle was removed in that primary-layer correction.
The resulting authored source SHA is
`7c79c61bc5fe733b50c839f5059510238e0e6cc54ba1d0ec6dd350ae273dae40`.
It contains exactly 7,812 neighbourhood parcels, all 18 districts/stations,
37 corners, three complete blocks, and 783 valid detail requests. All fixed
collision triangles passed the nondegeneracy check. Largest detail request:
4,177,127 bytes; all detail files together: 1,143,189,774 bytes, not resident cost.

The denser source exceeded the 2 MiB region request limit in some 512 m cells.
`colony_spatial_data.py` now subdivides only oversized regions, retaining every
drawing face and complete collision compound with its identity. It still refuses
an indivisible oversized result before writing anything. Five Python tests cover
losslessness, numeric types, metadata, conservative bounds, deterministic output,
corruption refusal and subdivision. This source produces 1,923 regions,
110,702,443 regional bytes and a largest request of 2,077,449 bytes.

The independent Blender spatial export created the corresponding far scene:
1,337,369 triangles, 52 startup parts / 83,226,859 bytes, and a 35,333,015-byte
native far-ground file. The far comparison sampled 6,732,392 points with a maximum
accepted distance of 0.0998482 m. These are authoring measures, not Quest results.
The spatial exporter accepts an explicit staged source root as well as output
root, so the normal application need not be overwritten to examine a candidate.

`app-dist/` is a separate Vite build with the candidate runtime substituted.
Its immutable assets and `candidate-input/` XR catalog stay frozen while later
authoring continues. The normal source/runtime headers and `dist/` are unchanged.
`candidate-build.json` records the four HTML/JS bundle hashes, source/runtime
hashes and candidate server PID 87043 (5293). This candidate predates the collision
optimizations described below.

Verification of this fixed candidate on Chrome / Apple M1 Pro / ANGLE Metal:

- Actual playwright-webxr **0.3.0: six tests passed**, including three strips'
  delayed-ground VR entry, walking and wrist travel, missing/corrupt response
  recovery, and a cancelled Izma arrival after switching to Cooper. These are
  emulation results; physical-headset performance/comfort remain unmeasured.
- Desktop reached all 18 districts, landed from free flight, threw an actual
  object and travelled to the colony exterior; zero page exceptions.
- Sixteen daylight/night images cover new passage and overview views in old
  town, housing, market and river districts; zero page/request failures. The
  screenshot poses use rpm=0 and do not validate rotating-body traversal.
- Independent image review found no obvious large one-eye loss or large ground
  hole in the six reviewed XR frames. The housing instruction card still clips
  at its left edge, and a pre-existing street wedge/vertical face remains.
  The market walking image is darker and no longer shows the former near lamp.
- Reference comparison of five desktop images still rejects fidelity: repeated
  roofs/windows/canopies, weak shop identity and equipment, unused-looking market
  land, long green pavement seams and grass visible around river entrances.
  Their exact geometric cause and physical passability are not established by
  the image review. Missing new street lighting is also an installation concern.

Evidence: `xr-initial.log`, `xr-initial/`, `xr-initial-visual.md`,
`candidate-exercise-runtime.json`, `candidate-runtime/desktop/report.json`,
`composed-runtime-visual.md`, `integration/export.json`, and
`composed-assembly-audit-before-primary-cleanup.json`.

## Local collision cost, separate from the tested visual candidate

An audit of 13,722 new-entrance samples and 23,417 points on a 16 m grid across
the 110 planned sites found 1,190 points over the existing 32-body/4,096-triangle
local budget (maximum 37 bodies / 7,543 triangles). All visit selections fit the
regional budget; the largest needed 12 regions / 7,524,452 bytes.
The first support probe incorrectly put the query ceiling at the building floor
even on descending approaches. Using the higher end of each approach removed
those 42 false failures; the raw failure report is not an entrance-defect count.

Separating expensive ground into 32 m compounds and merging nearby cheap ones
reduced the cost failures to 252, with at most 32 bodies. Native, sampled 5 mm
collision simplification then removed 101,630 neighbourhood and 29,736 pavement
triangles while keeping drawing geometry unchanged; maximum sampled deviations
were 0.0049863 m and 0.0049997 m. Two Blender tests retain a real floor opening,
step/wall and unchanged drawing input. The sampled tolerance is not a proof of
continuous surface distance or final live-body traversal.

That second cost audit left eight river samples above budget (maximum 4,329
triangles), zero support failures and zero regional-budget failures. A further
16 m split reduced this to six (4,273 triangles). Including medium compounds
above 64 triangles in the same native simplification reduced it to **three**
(4,160 triangles). This remains a failed cost gate; the limit was not raised.
All 37,139 samples remain within 32 bodies, with zero entrance-support and
regional-budget failures. The two native floor-hole/step tests passed again.
The latest staged source SHA is
`86a0877a8431a884b5f7f3299ab6ddf59f7fc343b658b136128124bde9b99697`.
Its 1,920 region requests are each at most 2,076,756 bytes. It has not replaced
the frozen candidate's runtime or the normal preview.

## Pavement edges, entry sides and supported lights

The actual episode 05 `0041` street reference and old-town/river application
frames were reopened together. A ray probe of the exported fixed drawing
meshes finds exposed earth near the passage/frontage boundary. Radial plan
coverage at the sampled points includes the higher pavement or entrance;
image evidence alone had not distinguished a planar gap from an open riser.
The native writer skipped risers wherever a neighbouring road/entrance supplied
support, despite raising the frontage 4.5 cm above its road profile.

The writer now closes the visible pavement edge down to terrain even beside
support; existing support still suppresses a guard. The complete native rebuild,
frontage export and dependent corner/complete-block exports have finished.
Frontage collision remains at 177,735 triangles; drawing adds 228,514 curb
triangles. The immutable source snapshot
`integration/src/worlds/generated/izmaColony-street-details-v2-curbs.json`
has source SHA `0cbff3434ca24108233eadd4591f70402658d93e07d60664304bffd30ce6b6df`.

`izma_city_entry_sides.py` closes stair and ramp sides to the sampled native
terrain. Ascending, descending and ramp cases passed lateral-ray and top-bound
checks. A saved-native audit reopened all 18 derivative parts: 4,574 entrances
retain their 9,553 original faces. New side faces add collision, so the earlier
three failing cost samples cannot be reused as the current collision result.

The same native derivative adds 1,180 wall-mounted entry lights with matching
near/middle fixtures. A follow-up checks that each casing reaches its wall;
the initial 6 cm separation was corrected before the final export. The maximum
emitter-to-fixture distance is 0.019 m. These are geometry checks, not acceptance
of rendered night lighting. The runtime's six-light pool is retained.
`street-details-native-v3` is the final saved-native candidate; its export passed
layout-preservation checks. It has not replaced the normal preview.

Fixed-mesh ray samples at the saved cameras now see earth at 290 rather than
304 old-town samples, and 366 rather than 458 river samples. No newly exposed
earth samples appeared. This test omits detail buildings and samples only three
image rows: the remaining earth hits are not all defects, and these counts do
not establish that visible green seams have disappeared. Same-camera application
captures are still required.

## Current street-details application candidate

Full source SHA:
`9a893ea194cf2d9e9b400ad6a99bae22d63f3ad93c46d11797e52578fb863f0f`.
All nine fixed layers pass finite/index/degenerate-collision checks. The 783
detail tiles are at most 4,192,581 bytes, and the 1,926 regional requests are
at most 2,087,949 bytes. Matching regional/far output is complete; its runtime
document SHA is `503da49ef1d0d869ad689d532a0c071108c0d16e2858ec0dc55daf7fc8fba3de`.
The frozen candidate is served separately on `https://127.0.0.1:5294/`; authored
Izma requires `landscape=authored&preset=izma` in the URL. The 5293 baseline and
normal 5192 preview remain unchanged.

The current collision audit still **fails**: 19 of 37,139 sampled positions
exceed 4,096 triangles, with a maximum of 4,613 in the river district. All fit
32 bodies; entrance-support and visit-region failures remain zero. The 19
failures supersede the three-failure pre-stair result. No limit was raised.

Sixteen actual application captures completed on Apple M1 Pro / ANGLE Metal,
with zero page/request failures and six pooled local lights in every view.
The initial capture attempt failed because the sandbox denied the preview
server's listen operation; it is retained separately. The successful run used
the owned preview PID 44630 and evidence `candidate-street-details-verified/`.
Sampled desktop frame medians range from 16.7 to 33.3 ms while a separate unit
suite was running; these are not isolated performance or physical-headset results.
TypeScript and the isolated Vite build pass. Six actual playwright-webxr 0.3.0
cases pass in 1.8 minutes against this unchanged build: delayed arrival, walking
and wrist travel in all three bands; missing/corrupt regional data recovery; and
late-response cancellation after travelling to Cooper. These are Chrome
emulation results. They do not establish physical-headset performance or pass
the separate whole-city collision-cost gate. The full unit run subsequently
completed: 1,196 pass, zero fail, 208 files, 1,303.41 seconds. Those tests use
the canonical, older application data; they do not validate the new city assets.

An independent image-only review compared both daytime passage cameras with
their previous application frames and the actual 05 `0041` source. The principal
green seams become closed grey sides, and the river entrance keeps visible
treads with a stepped side face. Buildings and street positions remain aligned.
Small green fragments remain at the river wall base and between walls; their
intent cannot be established from the image. Some interrupted dark edges still
read as grooves rather than continuous kerbs. This is acceptance of the principal
side closures in two views, not removal of every visible gap or a physics result.

## Reference fidelity remains a failed visual gate

On 2026-09-19 the actual episode 05 `0041`, episode 06 `0063`, and candidate
daytime old-town application frame were reopened together. Viewing sources is
distinct from incorporating them. The current application frame still repeats
large window pairs, roof forms and narrow entrance canopies along the passage.
Its ground floors provide little visual evidence of different uses.

| Source observation | Application acceptance question | Current evidence |
|---|---|---|
| 05 `0041`: close walls enclose a narrow street; shop widths and setbacks vary | Do the buildings form a street with a deliberate width and varied plot rhythm? | Enclosure exists; repeated facades and entrance setbacks remain conspicuous. |
| 05 `0041`: signs, shopfronts and attached services distinguish premises | Can residential entrances, shops and service fronts be distinguished from walking height? | Insufficient in the new old-town passage. |
| 06 `0063`: balconies, pipework and wall equipment vary across the facade | Do residential models have plausible access and services without duplicating one detail pattern? | Not established by the new street-details geometry checks. |
| 06 `0063`: most windows are dark; occupied rooms differ in brightness and hue | Does a night application capture show selective occupancy and room-level variation? | Old-town night capture has dark, warm and cool windows, but flat luminous panes and repeated openings remain unlike the reference. |

The reference does not establish real dimensions or a complete street map.
Military signage, combat effects and damage of uncertain origin are excluded
from civilian authoring. Additional props alone cannot pass these criteria while
the same facade composition repeats across whole streets.

Next: resolve the collision-cost gate,
and address street form and building-use distinctions against these reference
criteria. Whole-colony
connections, land use, interiors and district distinctions remain required;
this street-details increment does not complete those tasks.
The complete `bun test` and `bun run build` gates must run after coherent local
installation; the isolated Vite candidate build is not a substitute. No new
commit, push, deployment or automation was made in this increment.

## Civilian premises revision — 2026-09-20, application candidate

`izma_building_identity.py` gives residential rooms and small service bays,
shop displays and signage, and office glazing different elevation plans.
Residential occupied rooms retain three light-temperature families; occupied
office panes share a cool temperature and occupancy by floor. Upper dwelling
windows have waist walls except at balconies. Shared lintels and vertically
aligned bays limit unnecessary subdivision of the cylindrical facade mesh.
The initial city authoring path now opts into these identities as well.

Twelve saved native examples, three styles from each of four building families,
were compared with identical Blender cameras. These are isolated lineups, not
application or nighttime evidence. Independent image review found the new
balcony openings conflicted with the old partition positions. A geometry
regression failed before correction; partitions now follow the window gaps,
and end openings stop inside the existing guards. Nine Python geometry tests
pass. All 1,434 added apartment plans, with 19,637 balcony openings, pass the
partition/end-guard overlap check. The v3 image comparison independently
confirms that the visible window-cutting defect is gone. A narrow end opening
on one apartment remains conspicuous; its width is 0.85 m, not a cut-off pane.

`building-identity-native-v2` contains all 18 self-contained district files,
with 4,574 near/middle buildings revised across 13 urban districts. During
generation, both LODs' physical triangle multisets were checked against the
actual saved source meshes. They are unchanged. Near drawing triangles for
these buildings increase from 8,706,918 to 10,038,374; this count alone is not
a runtime-performance result. The rejected v1 output is retained as evidence.
Sign lettering is native mesh geometry made from Blender's built-in font.

The export passed `--appearance-only`: physical compounds, fixed drawing,
parcel/access data and distant proxies are unchanged. The composed header
changes only tiles and neighbourhood metadata. The full source SHA is
`ae095af5617ea1de8e6d1ab313e64d2f7b7b5e8989823813a6990c1805cc3b81`;
the matching runtime document SHA is
`90a2d274728e520da257a490011d3e73a1033dcd84caa861af4f382b89056fa9`.
All 812 detail tiles pass byte/hash checks, with a maximum of 4,167,997 bytes.
The 1,926 regional files and 1,524,123 far-ground triangles retain their previous
size/count. Existing 19 collision-cost failures still apply because the physical
data is unchanged; appearance-only equality does not turn them into passes.

TypeScript and the fresh Vite candidate build pass. The frozen preview is
`https://127.0.0.1:5295/?landscape=authored&preset=izma`, owned PID 37939.
Eight same-camera entrance frames and sixteen street/overview frames complete
in day/night conditions with no page/request failures on Apple M1 Pro / ANGLE
Metal. Each retains the six-light pool and bounded tile loading. Sampled frame
medians are 16.7–33.3 ms for entrance views and 16.7 ms for street/overview views;
these short desktop samples do not establish headset performance.

Independent review of six entrance application images confirms residential
door/storefront distinction and identifies a new wall-coloured triangular
patch at the residential canopy's rear underside (approximately x550–713,
y268–292 in `identity-fronts-after/desktop/day-identity-house.png`). Its cause
is unconfirmed and it remains open. Night lamp glare is also conspicuous, but
was present before this revision. Main-agent day/night old-town review sees
smaller service openings, room-colour variation and dark rooms; flat glowing
panes and repeated building/road forms remain unlike the source references.

Six actual playwright-webxr 0.3.0 cases pass in 1.4 minutes against this unchanged
build: delayed arrival, walking and wrist travel in all three bands, missing
and corrupt data recovery, and late-response cancellation after travelling to
Cooper. Main-agent inspection of a walking stereo frame and a public-place wrist
frame shows both eye views populated; it is not acceptance of every UI detail.
Physical-headset performance remains unmeasured.

This revision does not redesign roof forms, street topology, district connections
or interiors; the whole-colony goal remains open. The normal 5192 and earlier
frozen 5293/5294 previews remain unchanged. No commit, publication or automation
was made.


## Final physical compounds and live traversal (2026-09-20)

The frozen candidate at port 5296 uses full source
`927d6b68bbb8afd558aa13e01d49885f85145d320b28e0efd68c72b71164e36b`
and runtime document
`b7ee4e31ef732d008d88ef39f5c2fdf8a65d738fb4ed302998687f25d0833236`.
Its native building input remains `building-identity-native-v2`. Canonical native
installation and the ordinary 5192 preview remain unchanged.

The collider lead is now 28 m. Three maximum car steps plus its actual body radius
need 3 × 178 m/s × 0.05 s + 0.5 m = 27.2 m. The range regression uses the real
frame cap and exported car radius. Thirteen targeted tests passed; the five drive
tests also pass with real building contact at both 1/60 s and the 0.05 s cap.

A final native simplification pass after compound merging removed 106,348 physical
triangles across nine layers. Drawing indices, original drawing vertices and
physical compound counts remain unchanged. Each accepted reduction stays within
a sampled 5 mm error relative to its compiled input; this is not a continuous
error bound against the original native drawing. A geometry signature makes
repeated finalization reuse the result and rejects changed finalized geometry.
Three Blender geometry tests passed, including preservation of holes and steps.
A real second finalization reused all nine layers without further reduction.

The dense 4 m grid plus entrance samples passed at 371,345 locations: at most
3,988 triangles and 30 bodies, with zero cost, support or regional failures.
An additional 186,205 samples cover all 7,812 active entrances, 18 district bounds,
90 transport profiles and 121 land-use zones; that audit also passed. These are
sampled spatial budgets, not continuous proofs or headset frame-time measurements.
The regional package contains 1,926 regions, 114,728,280 bytes total and a maximum
2,046,839-byte request. Detail geometry is unchanged: 812 tiles, largest 4,167,997
bytes. Type checking and the isolated Vite build passed. No full canonical test or
production build has run against these new assets yet.

Actual desktop verification on 5296 passed all 18 district arrivals, free-flight
landing, throwing and exterior travel with no page/request errors. The existing
six regional playwright-webxr 0.3.0 cases passed. A new staircase round-trip suite
passed band C but exposed two failures in bands A/B. Repeating the same A/B tests
on pre-optimization 5295 reproduced both failures, so they are not regressions
from this reduction. They remain required work before traversal acceptance:

- `a-upland-22a94b2ba249-01-032`: descending works; intermittent VR input stalls
  near the top on return. An offline physical simulation with 200 ms movement
  and 50 ms pauses passes at both 60 Hz and capped variable frames, before and
  after optimization. The longer-pause input case needs separate diagnosis.
- `b-campus-dfcd71e6b1f9-01-012`: return movement puts the body about 0.34 m below
  the selected drawn floor. The base `walk` mesh crosses the staircase: near
  (5807.47, -10029.98) it is at about 14.959 m, while the stair tread is at
  14.249 m. The exact centreline also overlaps. Earth is only about 12.598 m
  there. Fix the native road/entrance connection and screen comparable accesses
  for clearance; increasing the support tolerance would hide the problem.

Evidence under `colony-city-fabric-20260919/`: `collision-finalization-first.json`,
`integration/collision-finalization.json`, `runtime-geometry-audit-lead-dense.json`,
`runtime-geometry-audit-final-colony.json`, `collision-exercise-runtime.json`,
`xr-final-collision/`, `xr-stairs-before-collision/`, `stair-physics-probe.json`,
and `stair-surface-diagnosis.json`. The QA support check is now
`qa/webxr/colony-city-access.xr.mjs`; use an explicit native city root for a staged
candidate. Physical-headset performance is still unmeasured. No commit, push,
merge, deployment or automation was performed in this increment.

The follow-up physical probe reproduces the A failure without a browser:
200 ms movement / 800 ms pauses stalls roughly 1.1 m from the top at 60 Hz
(and about 1.7 m with capped variable frames), whereas 200 ms / 50 ms completes
the same route. `stair-physics-slow-input.json` preserves the samples. This
isolates intermittent walking/rest behavior as a separate issue from B's
confirmed overlapping road mesh; no movement-physics fix has yet been applied.

## Entrance clearance and intermittent walking (2026-09-20, in progress)

The A staircase failure was reproduced with 200 ms movement followed by 800 ms
pauses. A real-contact step assist now supplies a bounded upward velocity toward
nearby normal treads when a grounded walker is blocked. It preserves the physical
body and ceilings; the ground sampler uses zero additional step tolerance during
walking/contact detection to avoid selecting a floor above the body's feet.
Thirty targeted traversal tests pass (63 expectations); type checking passes.
The actual saved A staircase also passes offline at fixed 60 Hz and capped uneven
frames. These are physical simulations, not yet results from the updated browser.

An independent curved-surface clearance audit sampled 212,352 positions on 4,574
new entrances. It found 2,428 overhead-footway conflicts in 123 entrances across
11 districts. Native models now retain a flat landing across the public footway,
then begin the flight beyond it. A minimum floor raise was necessary in 103 lots
(maximum 1.05554 m), with original foundation bottoms and horizontal allocation
preserved. Native output `access-clearance-native-v2` has all 18 parts and an
indexed contract. The first incomplete v1 attempted to add absent far objects
and is rejected; v2 preserves the native object count and updates exported far
proxy contracts. The post-repair contract/surface audit reports zero conflicts
at the same 212,352 positions. Saved native before/after images are in
`access-native-comparison/`; live curved geometry and VR still require testing.

The dependent assembly is running through `assemble-city-access.py`: native city,
rail, regenerated land reservations/grounds, regenerated pavement, corner blocks,
complete blocks, ground cleanup, collision finalization, and regional/far export.
The author's original base was restored for that export phase only after proving
identical drawing indices and original vertex prefix against the final compiled
base. Its terrain and rail hashes match their native contracts; final collision
compilation follows the complete assembly. This avoids treating appended
collision-only vertices as a change to the author's terrain. The previous full
and runtime headers remain saved as `*-before-city-access.json`, and the 5296
preview remains frozen. The city exporter now reads the explicit indexed native
candidate contract; its dependency, plan and native-part hash checks remain.

No updated application preview or canonical installation is claimed here. Exact
step exits, hashes and pending checks are in `access-assembly-progress.json` and
`continuation.json` within the evidence directory. The whole-colony goal remains
open; passing entrance checks does not complete transport, interiors or water
infrastructure.

The expanded targeted run passes 37 tests across four files (20,576 expectations),
including physical walking, driving and the collider travel buffer. Independent
review of the four native before/after frames confirms improved stair/door
visibility and closed visible foundations. The landing edge remains a small
step: the separate curved-plane probe measures at most 0.112662 m across the
123 revised accesses. This is not a claim of a step-free accessible route.

Assembly checkpoint: city export completed in 546.73 s and rail export in
42.65 s. Land planning and native authoring completed; its first export failed
only when writing evidence because the recorded source filename omitted the
city prefix. The exporter now uses `city_asset_name` for that filename; the
resumed land export passed in 44.78 s. Native street-frontage regeneration is
running under execution handle 78205. The manifest is an intermediate authoring
assembly until dependent exports, final collision and regional generation finish;
its currently retained runtime header is stale and must not be served.

### Completed assembly and canonical integration (2026-09-20)

The preceding running checkpoint is superseded. The complete assembly, collision
finalization and regional export finished successfully. The full source is
`7b4ff737554c5c6fd9017b3c1aa89910b3091e4d7a16184ed89989311756c222`;
the runtime document is
`1215d1bd7881ec146b92ab62934684aecddb16693b8c33fa0cc2a123b61cbc26`.
All 18 native parts, their contract/index, dependent native grounds/frontages,
and both runtime documents were installed together with immutable public parts.
The guarded installer checked every dependency and destination baseline; its
backup and report are `canonical-before-access/` and
`canonical-access-installed.json`. No published deployment was changed.

- Composed entry clearance: 212,352 positions, zero overhead-footway conflicts.
- Dense geometry: 371,345 samples; whole-colony geometry: 186,205 samples.
  Both report zero support, regional-selection or cost failures; maximum local
  collision cost is 3,988 triangles (the existing ceiling remains 4,096).
- Frozen port 5297: all 18 desktop arrivals, free-flight landing, throwing and
  queued exterior travel passed, with no recorded page errors or failures.
- Actual playwright-webxr 0.3.0: all ten cases passed on Apple M1 Pro / ANGLE
  Metal. This includes the A/B/C stair round trips, wrist menu, missing/corrupt
  region recovery, cancellation during world changes, and all four worlds.
  Evidence: `access-exercise-runtime.json`, `access-xr.log`, `xr-city-access/`.
- Independent visual inspection covered nine stereo stair captures (18 eyes)
  and six old-version comparisons. A/B visible stairs remain continuous and B's
  former footway occlusion is gone. No new large hole or one-eye-only missing
  surface was found in those frames. Returned views often exclude the stairs;
  C's complete flight is not visible, and a small preexisting C door-edge seam
  remains uncertain. Physical-headset performance remains unmeasured.

Canonical tests now distinguish retained legacy lots from the new polygonal
city parcels, validate exact replacement IDs and all native-part hashes, use
the current land-use contract, and check all 7,812 active entrances. Wall lamps
are checked against actual building volumes rather than requiring lamp poles.
Broad-phase cell descriptors are no longer mistaken for active physics bodies;
the actual 32-body / 4,096-triangle and cache-memory gates remain unchanged.

These expanded checks exposed a real ground-query defect: a curved vertical
foundation face at `b-campus-dfcd71e6b1f9-05-000` was reported as floor about
29 mm above its visible apron. A direct Three.js ray confirmed the intersection
was a nearly vertical wall. The projected floor sampler now rejects radial
normal alignment below 0.01, retaining steep terrain; a 0.6 trial was rejected
because it also excluded existing sloped frontage surfaces. Physical standing
contact keeps its separate 0.6 threshold. A regression fixture preserves the
actual wall triangle. Exact floor comparisons use zero step tolerance, matching
the production walking query, and include the public footway over an approach.
The complete 7,812-entrance scan then had zero height mismatches above 20 mm.

The canonical production build passed (`bun run build`, isolated output), and
frozen port 5298 includes the floor-query fix. A fresh actual WebXR run passed
all ten cases in 3.4 minutes. The nine final stereo captures were independently
compared with port 5297: no new large hole, viewpoint embedded in a wall/floor,
or one-eye terrain loss was found in the visible regions. The same offscreen
limitations remain. All served JavaScript hashes were unchanged after testing.
Evidence: `canonical-build-city-access.json`, `access-canonical-xr.log`,
`xr-canonical-access/`. Full canonical unit tests finished: 1,201 passed,
zero failed (210 files, 1,126.92 seconds). The final 18-district desktop pass
and three additional travel/physics exercises also passed with no page errors
or failures. Normal port 5192 now serves this same immutable verified build
(PID 10992, execution handle 98998); its index was checked byte-for-byte.
Use `?landscape=authored&preset=izma&visit=a-old-town&t=.42` to enter it.
Whole-colony transport, water infrastructure, interiors and remaining reference
fidelity gaps are still open; this integration is not whole-goal completion.
