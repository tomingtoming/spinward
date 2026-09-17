---
origin: ai
created: 2026-09-18
---

# Eighteen public-place neighbourhoods

The 18 squares previously stood among sparse roadside buildings. This increment
adds **545 authored frontage parcels** around them: shops with housing above,
houses, apartments, offices, civic buildings, workshops, warehouses, farmhouses
and small park buildings. Existing terrain, 1,715 buildings, public places and
their entrance paths remain in place.

The new lots occupy **335,062 m²** in total. Their allocated rectangular building
envelopes total **147,055 m²**; this second number includes recesses within an
envelope and is not the actual wall footprint, usable floor area or population.
The lots are small catchments within the much larger 402 km² colony. They do not
complete its urban density, circulation or land use.

## Design and source

`assets/blender/izma-neighbourhood-plan.json` specifies each district's family
sequence, parcel dimensions, setbacks, side gaps, rear gardens and catchment.
The public-place road entrance anchors each catchment. Existing street branches
and loops supply frontage; no rectangular street lattice is introduced.
Urban districts receive 24–48 buildings each. Parks and agricultural settlements
receive 10–14. A-river retains 24 of an initial 44-site target because of the
protected study and feasible ground access; A-upland retains 39 of 44 because of
terrain and water reservations. Those missing sites are not silently relocated
to an unrelated part of the district.

The nine added families are 153 shop-houses, 122 apartments, 99 houses, 58
workshops, 42 offices, 31 warehouses, 23 civic buildings, nine pavilions and eight
farmhouses. These are closed exterior models. Public-space interaction and new
interiors have not been added by this increment.

Each lot reserves its actual rectangle, entrance corridor, rear garden and
street edge. Overlap tests retain the existing buildings, square, square access,
water buffer, other roads and protected study. Continuous approaches or stairs
meet the existing pavement; all 545 approaches have drawn and physical support.
There are 26 stair approaches. Shop/work yards have paved forecourts; residential
lots retain front/rear green space. Narrow local roads remain shared streets;
this increment does not claim a separate footway on every road.

`izma-neighbourhoods.blend` is the editable source (scene
`SW_izma_neighbourhoods`, owner `spinward-izma-neighbourhoods-v1`, native metres).
`izma-neighbourhood-parcels.json` records the fixed lots and dependency hashes.
The building builder/exporter are reusable functions; recreating the original
1,715-parcel contract into `/tmp` produced identical parsed data. That check did
not overwrite the original scene or parcel file.

Regenerate in isolated Blender MCP CLI:

1. Finish/export terrain and transport.
2. Build/export the original district architecture.
3. Build/export public spaces.
4. Run `build_izma_neighbourhoods.py` against `izma-colony.blend`.
5. Run `export_izma_neighbourhoods.py` against the saved neighbourhood blend.

Re-exporting primary architecture invalidates public spaces and neighbourhoods.
Re-exporting public spaces invalidates neighbourhoods. The additive exporter
checks all reservation hashes, exports actual saved meshes/lights, and replaces
only its own detail tiles and layer. The runtime data remains deterministic.

## Night, detail and collision

The night review found insufficient entrance/road illumination. **303 supported
street lamps** now sit near lot frontages, at least 30 m apart. Their 303 source
definitions join the existing public/study sources in the **same six PointLight
pool**. Only nearby sources illuminate the scene; far proxies have opaque lamp
heads. Street sources use intensity 500 and a 32 m range; the 85 / 300 / 500
comparison kept dark sky/background while making nearby doors and paving legible.
Source checks match every emitted light to a visible pole and test the
pool across all strips and azimuth wrapping.

The additional layer has 50 detail tiles, **20,478,446 bytes** in total and a
largest request of **1,868,170 bytes**. Near/middle drawing uses 229,384 / 152,002
triangles; fixed approaches/lot grounds use 39,320. Total active tile catalogue:
290 (222 original architecture, 18 public, 50 neighbourhood). The existing
18-tile resident cap and three concurrent requests are retained. Full terrain
drawing and compact collision source data are still resident; this is not
terrain network streaming.

Dense streets exposed unnecessary physics work in the cell-window corners.
Rapier now refines the existing grid broad phase by distance to expanded,
rotated bounds. The full-cell travel buffer (about 64 m here), eight-metre
insertion margin and seam wrapping remain. Height queries still have their
global index. A regression checks grid edges, rotated buildings and a small
cylinder without expanding mesh getters.

Costly 256 m base collision compounds are partitioned into 128 m groups and,
where still costly, 64 m groups. The source triangle multiset, floor flags,
vertices and all drawing meshes are identical. Base descriptors increase from
8,227 to 8,721. The partition is idempotent and a clean export matches incremental
application. More precise local bounds remove distant triangles without
discarding physical surfaces or reducing the number of buildings.

The 6,716 transport samples plus 20,623 points on a 16 m neighbourhood grid give
**27,339 samples**, maximum **32 descriptors / 4,016 triangles**. The expanded
coordinate cache remains bounded to 128 entries / 4 MiB; this audit peaked at
1,372,752 bytes. These are sampled geometry costs, not a universal frame-time or
physical-headset guarantee. The grid regression includes yards and outer edges,
because checking only roads missed the former dense-housing peak.

The final Chrome / Apple M1 Pro / ANGLE Metal memory probe verified the served
main, colony and other-world bundle hashes. Five stable page snapshots after
forced V8 GC used **151.77–152.80 MiB** of JS heap (the previous public-space
increment measured 141.87–143.17 MiB). Three full collision-cache sweeps stayed
at 128 entries, with a 1,554,336-byte observed peak and 152.55–152.64 MiB heap.
These are steady JS snapshots and cache-pressure tests, not cold-load peak,
process/GPU memory, continuous travel or physical Quest measurements. Full base
terrain and source collision data remain resident. Resource/page errors were
empty in this probe.

After the unit/XR/capture jobs ended, six isolated desktop samples repeated the
B-station frontage, B-housing overview and C-cargo frontage by day/night. Frame
interval medians were 16.7 ms and p95 was 16.7–16.8 ms, versus 33.4 ms p95 at
those viewpoints during concurrent QA. Each sample is only 1.5 s at a static
1440×900 view; this does not establish sustained walking or VR performance.

## Validation and remaining work

Evidence is under `qa/webxr/evidence/colony-neighbourhoods-20260918/` (gitignored).
`before-lighting/` retains the first 1,137-unit / 19-XR run and its images. That
run predates the final lights and finer physics partition. `lamp-85/` preserves
the subsequent 1,139-unit / 19-XR run, all 82 desktop views and the three-strength
lighting comparison. Final 500-strength results belong in `verified/`; all detail
tile bytes are identical to `lamp-85/`, as checked by the source audit.

The final build passed TypeScript/Vite and **1,139 unit tests across 195 files**
in 750.28 s. All **82 day/night desktop views** completed with empty page/resource
error lists. The source audit confirms preserved base drawing/collision triangles,
original architecture, public spaces, structures and all 240 prior tiles.

The WebXR 0.3.0 full run passed **18 of 19** cases in 9.0 minutes. B-housing reached
the door but failed the return-floor assertion: the body went about 8 cm beyond
the new approach onto the existing road, which the fixture had not raycast.
An independent query at the failed live position finds the drawn road only
0.66 mm below the recorded body ground height (`return-road-probe.json`). The
fixture now checks both actual drawn approaches and their connected streets;
height tolerances and movement assertions are unchanged. All **3 new cases then
passed in 36.7 s** in `xr-followup/`, on the same unchanged application build.
The 19 unique cases cover all three strips, original study/420 m shop route,
public-square wrist travel, motorway barriers, night roll and four-world switching.
These are emulated sessions on Apple M1 Pro / ANGLE Metal, not a physical Quest.

Independent final review covered **18 night frontages and six stereo images**.
Observations and their exact sampled scope are in `verified/visual-review.md`;
earlier day/layout comparisons are separated in
`visual-review-history.md`. The new houses and shops reduce the former sparse
frontage, while the public squares still lack strong enclosure. Static image
review does not prove continuous travel or physical-headset comfort.

The `visit=neighbourhood-b-housing` arrival link was also checked by day/night
(`arrival/desktop/`), with grounded state and no page/resource errors. The fixed
652-file build inventory and its three served entry bundles match after tests
(`served-after-tests.json`).

These are still frontage neighbourhoods. Secondary streets, continuous block
interiors, stronger square enclosure, accessible new rooms, rail stations,
IC/JCT lanes, inter-strip travel, water-cycle facilities and terrain LOD remain
part of the whole-colony goal. Window/roof variation alone cannot finish those.
A fine dotted edge remains beneath the long shop awnings in A-river VR and
C-production night images. Lowering the awning did not remove it; the cause is
unconfirmed and it is not reported as fixed.
Physical-headset comfort/performance remains unmeasured. No push/deploy or
scheduled task is authorized by this increment.
