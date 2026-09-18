---
origin: ai
created: 2026-09-18
---

# Station streets and compact blocks

The earlier 545 frontage parcels are replotted around the station-to-centre
streets and 30 new back streets. The new infill has 2,298 buildings across all
18 districts; the original 1,715 buildings, public spaces and terrain remain.
This is 4,013 buildings plus the original study, **not a completed city**.

## Reference comparison

The originals `izma-ep05-0039` and `izma-ep05-0041` were opened at full resolution
and their manifest hashes checked on 2026-09-18. The former shows closely packed
roofs of different sizes; the latter shows narrow frontage, close walls and a
street continuing into depth. Mobile Suit, combat and related shop imagery is
excluded. Street alignments, scale and exact building forms are Spinward design
choices; these images do not provide a recoverable whole-colony cadastral map.

The first desktop comparison and independent image review found partial enclosure
at street level, but the overhead views still show ribbon settlements in broad
grassland. Regular window/porch repetition and indistinct grass between lots
remain. Tight old-town/market residential fronts now use paving; rear gardens
and the greener districts retain green space. That material change alone does
not complete continuous urban blocks. The next structural work is block depth,
clear courtyard/service-lane boundaries and connections between local streets.

## Authored source and reservations

`izma-urban-plan.json` records district character, block lengths, depths, setbacks,
family sequences and limited farming/park settlement reaches.
`plan_izma_urban.py` saves the editable alignments in `izma-urban-streets.json`.
`izma_urban_fabric.py` creates native road meshes, grades and compact frontage lots
in the saved `izma-neighbourhoods.blend`. These are offline authoring operations.

The 30 streets serve 16 districts. Three of the 33 sketches were rejected by
the Blender grade check: two A-river loops and the A-upland loop require terrain
cuts or a different alignment to meet the existing street. Their IDs, measured
slopes and reason remain in `rejectedStreets`; no parcels front those sketches.
A-port and A-upland retain existing road frontage;
the reserved primary warehouses leave no accepted extra street there. Lot
coverage varies by district; old town and market have close frontage while farm
and park stations retain small settlements. Larger open areas have not yet all
been given a convincing visible use or boundary.

Polygon reservations protect primary buildings and approaches, public places,
rail approaches, rivers and the old study. A curved street initially allowed a
lot over another segment with the same route ID; the revised planner checks
the full carriageway even for the parcel's own street. Junction lips up to
about 17 cm were replaced by three-metre aprons inheriting the existing road
crossfall. Two-metre rows and support sampling inside each strip keep terrain
ridges and existing curbs from protruding through a vertex-only road surface.
Native drawing and walking surfaces share those meshes.

Regeneration order:

1. Keep upstream terrain, transport, primary architecture and public spaces current.
2. With rail station reservations available, run `python3 assets/blender/plan_izma_urban.py`.
3. In isolated Blender MCP CLI, build and export the neighbourhoods.
4. Rebuild/export rail to refresh its infill dependency.

The street plan hashes only the station reservation geometry, rather than the
full rail contract that depends on the resulting infill. This avoids a circular
dependency while still invalidating the plan when station positions change.
The runtime retains native mesh LOD and bounded detail streaming. The new local
streets are walkable meshes; vehicle routing and pedestrian directions do not
yet consume their graph.

## Runtime scope

The new layer has 97 detail tiles / 84,048,257 bytes, largest 3,652,692 bytes;
923,596 near triangles, 606,612 middle triangles, 128,786 fixed triangles and
2,487 physical surface groups. The existing 18-tile cache and three-request
concurrency limit remain. The 992 supported lamps share the existing six-light
pool; they are not 998 live PointLights. Interior access is unchanged.

Collider streaming now keeps a 32 m travel buffer beyond the expanded bounds.
It is refreshed before each physics step. The actual GameLoop cap is 50 ms;
at the experiment car's 178 m/s limit this covers more than three steps of
travel. Grid-edge/seam tests and the real Rapier driving/contact regression
remain. No collision triangles are removed, and global height queries keep
their full index. This does not establish a physical-headset frame-time bound.

## Validation

Current increment evidence: `qa/webxr/evidence/colony-urban-20260918/` (ignored).
`initial/` preserves the 2,293-building image comparison. Initial full-unit and
XR runs were deliberately interrupted when the curved-road overlap was found;
they are not passing evidence. The final build and evidence are under `verified/`.

The final targeted gate passed **25 tests across six files** (neighbourhood
geometry/reservations, collider travel buffer, Rapier contact, transport and rail).
TypeScript and production build passed. The 93,477-point cost audit found a
maximum 26 descriptors / 2,546 triangles, with collision-cache peak 1,425,456
bytes and the same 128-entry limit. These are geometry measurements, not an FPS
claim. The full unit suite passed **1,149 tests across 198 files**, with no
failures, in 981.25 seconds. The served HTML, main bundle and colony bundle
matched the frozen production files by SHA-256.

The six new/updated WebXR checks passed on **playwright-webxr 0.3.0**:
street-to-door-and-back in A-river, B-housing and C-market, and full back-street
walks in A-old-town, B-housing and C-market. The measured paths were 209.07 m,
320.78 m and 224.60 m. Drawn-floor/ground-height differences stayed below
1.81 cm in those walks. They used actual VR entry and controller movement,
with no page errors, failed tiles or cache-limit violations. C-market starts
at night, but the simulation clock continues into daylight during the walk;
this is not a constant-night traversal. Separate fixed-view night captures
are included below. Physical-headset performance remains unmeasured.

Two final regression checks also passed on the same frozen build: Quest-style
VR entry, both Places pages, head roll, input ownership and session return;
and Izma → Cooper → Elysium → Playground → Izma switching, with actual stereo
walking, drawn-floor support and wrist travel. These checks add no physical
headset or sustained frame-time claim.

The frozen production build produced 48 desktop frames: all 18 district
frontages, three back streets and three overviews, each by day and night.
All frames reported the current 2,298 infill buildings, at most 18 loaded
tiles, and no page errors or failed requests. Apple M1 Pro / ANGLE Metal
was verified. The sampled static-frame p95 was 16.7–16.8 ms; this is not a
moving-VR or physical-headset performance measurement.

Independent review of all 48 desktop frames and the first 12 XR frames found no
obvious road blockage, floating buildings, major drawing holes or steps
across the visible route. It confirmed closer frontage and more front paving,
but also thin grass seams, gaps between paved lots, repetitive building forms
and broad undefined grassland. The fields, orchards and forest are not yet
visually legible land uses in those views. Night road/grass boundaries become
hard to read away from lamps; walls close to lamps lose material contrast in
old-town, housing and market lanes. This lighting imbalance needs a separate
correction; no obvious floating lamps were observed. These are observed limits,
not a completed reference match; still
images do not establish collision or route continuity.
