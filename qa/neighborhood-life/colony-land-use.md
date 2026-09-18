---
origin: ai
created: 2026-09-18
---

# Planted courts, working yards and productive land

The earlier street increment left undefined grass behind its building rows.
This increment assigns 61 free-land areas across all 18 districts, totalling
1,147,409 m² after subtracting buildings, entrance walks, public spaces, rail
approaches, transport corridors, water and the original study. These are
Spinward's authored land-use choices, not a recovered map from the animation.
They cover about 1.15 km², not the colony's full 402 km² of inhabited strips.

There are 14 rear-garden areas, 27 shared-garden areas, 14 working yards, and
two each of allotments, orchard and woodland. The source contains 3,466 trees,
161 benches, 834 groups of three growing beds, 55 equipment stores and 49
pallet stacks. Rear gardens also have low hedges with openings at paths.
The productive areas deliberately retain rows; garden/woodland planting has
irregular spacing. Ground textures and these props establish an initial
visible use, not a complete agricultural or ecological system.

Of 53 unobstructed approach candidates, 41 meet their existing street with a
graded native walking surface. Twelve are explicitly rejected on junction
grade; the other eight areas have no accepted approach candidate. Rejected
areas do not acquire public visit points. Accepted gardens also have 190
interior walking mesh segments, routed through the union of free land without
cutting across reserved lots. Private/roadless planting is not presented as a
completed public square. Equipment stores remain closed exterior fixtures.
An endpoint audit found 24 coincident reverse segments among those 190;
the totals below include their cost. They need deduplication in the next
source revision; this count is not 190 distinct route connections.

## Sources and runtime

`plan_izma_land_use.ts` clips the saved street-block outlines and district
fringe parcels against the current reservations. Its output is
`izma-land-use-layout.json`; dimensions and use choices live in the authoring
script. `build_izma_land_use.py`, run through isolated Blender MCP CLI, saves
`izma-land-use.blend` and the dependency/placement contract `izma-land-use.json`.
`export_izma_land_use.py` consumes those saved native meshes. Existing terrain,
buildings, rail geometry and public facilities are preserved.

Regenerate in this order: terrain/transport → buildings → public spaces →
neighbourhoods → rail → land-use plan → land-use Blender model → land-use export.
Upstream building/public/rail exports remove the dependent land-use layer so a
moved building does not silently retain planting across its doorway. The
land-use builder and exporter check the current source hashes.

The 52 detail tiles total 16,963,287 bytes. Near/middle detail contains
345,316 / 137,356 triangles; fixed grounds and paths contain 15,251 triangles.
Trees, equipment and path surfaces supply 56,048 physical triangles, spatially
partitioned into local compounds. The coloured ground overlays are clipped
against individual existing terrain triangles and sit 2.5 cm above them;
the unchanged terrain supports walking there. Crops are soft vegetation and
do not add rigid bodies. Each tile keeps near, middle and coarse silhouette
geometry; the existing 18-tile cache and three concurrent requests remain.
No additional dynamic lights are created.

## Verification and remaining work

Evidence is under `qa/webxr/evidence/colony-land-use-20260918/` (ignored).
The first images showed garden trees without a clear internal route; later
sources add paths, garden boundaries, denser beds and supported equipment pads.
`initial/` images precede those changes and are not final verification.

The native-geometry checks cover all saved building reservations, current
dependencies, detail/proxy availability, terrain-overlay support, all accepted
approaches and interior paths. Profile heights average both crossfall edges;
actual visible/physical floors are compared separately within 2 cm. The
109,326-point collision audit includes the previous street/neighbourhood grid
and 15,849 points around these land-use outlines. Its maximum is 30 compounds
and 3,574 triangles, with collision-cache peak 1,516,680 bytes / 128 entries.
These are geometry/cache measurements, not a physical-headset frame-time bound.

Production build passed. The frozen HTML, application bundle and colony
bundle hashes are in `verified/served-hashes.json`; they stayed unchanged
through browser verification. The app still ships a 73,391,997-byte colony
bundle, so bounded detail and collision caches do not mean bounded total data.

Desktop captured 72 views across all 18 districts: ground-level and overview,
each by day and night. The first 60 are under `verified/desktop`; 12 supplementary
views of A-water, C-orchards and C-forest are under `verified-missing/desktop`.
Both reports have no page errors or failed tile requests. Those three districts
have no accepted new approach: their ground views use existing roads and are
not evidence of a usable new entrance. Static-frame p95 was 16.7–16.8 ms on an
Apple M1 Pro / ANGLE Metal renderer, not a movement or headset measurement.

Contact sheets and selected full-size images show no obvious large ground
holes, floating paths or building intrusion. An independent reviewer checked
the supplementary 12 images: orchard rows and irregular woodland read as
different land uses, while A-water still lacks a clear park layout. The
ground-level supplementary views largely face existing buildings, so they
do not establish the condition inside the planting. Rectangular material
boundaries, repeated tree crowns, abrupt path ends (especially B-housing),
dark garden interiors and bright nearby windows remain visible limitations.

playwright-webxr 0.3.0 passed four actual VR entry/continuous-stick return
walks (A-old-town, B-housing, C-production and C-fields) and the existing
cross-world stereo/wrist-travel/Playground-return regression, five tests in
2.7 minutes. The access walks are 36.4, 10.9, 6.5 and 3.9 m one-way in the
source; they test entrances, not an entire garden. Sampled visible-ground vs
body-height error was at most 7.3 mm. The C-production visit starts at night;
the simulation clock continues during walking. Emulation is not physical VR.

One additional VR test followed two connected garden branches beyond the
A-old-town entrance and returned, passing in 2.2 minutes. Its sampled travel
was 186.4 m, farthest displacement about 90.1 m, and maximum visible-ground vs
body-height difference 14.4 mm across 208 samples. It returned within 0.25 m
of its starting position. Evidence is in `verified/xr-interior`; this covers
one interior route, not all 190 emitted path segments.
Independent review of all 13 cross-world stereo captures found no black or
missing eye, major wrist-panel breakage or obvious other-world geometry
remaining in the image. Closed-menu 0/25-degree head-roll views were included;
open-menu head roll and transitions between those static frames were not.

The first full unit run had 1,151 passes and one failure: a manually assembled
cold-cache test index omitted the new 460 land-use collision compounds.
The runtime index already included them. The fixture now includes land use
and checks accepted approaches on outward and reverse traversal; its four
targeted tests pass. The subsequent clean whole-suite run passed all **1,152
tests across 199 files**, with 22,906,195 assertions in 779.12 seconds
(`unit-final.log`). TypeScript also passed after the test-fixture update;
runtime sources and the verified production build were unchanged.

Building density and repeated facades/roofs still differ substantially from
reference images 0039 and 0041. Broad grassland remains outside the assigned
areas. Enclosing a garden does not complete the street block, water cycle,
neighbourhood economy or whole-colony city. Night-light imbalance, building
form diversity, deeper inhabited blocks and continuous district land use remain
part of the active colony goal. Physical-headset performance is unmeasured.
