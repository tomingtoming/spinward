---
origin: ai
created: 2026-09-18
---

# Recessed civilian facades

The original references were reopened on September 18: episode 5 images
`0039` (occupied block interiors) and `0041` (enclosed street), and episode 6
`0063` (dark residential walls, balconies and separate lit rooms). The retained
Spinward images show flat window rectangles, repeated entrance canopies and
locally overbright night walls. This increment addresses openings and local
lighting; the references' block density and architectural variety remain unmet.

## Native design and physical boundaries

Near facades have actual wall apertures, 12–24 cm recesses, a frame and a divider.
Residential upper openings have 1.0–1.2 m sills and 1.05–1.4 m glazing heights;
balcony doors keep low sills. Office glazing retains its own larger proportions.
Room colour and occupancy are stable between LODs: residential rooms use warm,
neutral or cool light, while lit office panes use the cool material. Street-facing
commercial glazing is distinguished from side/rear residential openings.

Middle facades retain opening locations, dimensions and room identities, with
flat frames replacing recess geometry. The far roof/body proxies stay identical.
Near balcony floor geometry and guard envelopes are retained; a metal cap makes
their existing edges more legible. This does not yet reproduce the reference's
open metal balustrades, individual service pipes or varied entrance canopies.

The shared native mesh writer and building recipe can revise saved parcels
without rerunning land allocation. `refit_izma_facades.py` replaces only the
named building LOD objects in an isolated Blender CLI. For every parcel and
both LODs, it compares the complete multiset of native physical-support triangles
before saving. Parcel contracts and existing fixed access/street objects stay
unchanged. Closed rooms retain their wall collision envelope; window recesses
do not make the rooms enterable.

`export_izma_facades.py` selects only the requested building layer. Its guarded
appearance export compares every fixed drawing triangle, every collision
compound and every far proxy before retaining dependent stations, public spaces
and land use. The first export attempts caught a baseline-variable collision and
overbroad selection of tiles sharing the `architecture` flag. They stopped before
publishing the manifest; both checks were corrected.

Infill street lamps retain their saved positions and supports. Their native
intensity changes from 500 to 140 and range from 32 to 28 metres, within the same
six-light runtime pool. These are rendering parameters, not measured illumination
or a physical lighting specification.

## Geometry and visual verification

Five Python aperture/use tests pass, including rays that reach glazing behind
the outer wall, matching near/middle room identity, residential sills, office
colour, matching wall/reveal edge vertices, and balcony support with no back
face coincident with the opaque exterior wall. Four native manifest persistence
tests also pass. Native support checks pass for all 7,394 parcels and both LODs.

The initial facade model passed 1,160 unit tests, the complete geometry-preservation
audit, production build and twelve matched desktop captures. An independent
image-only review found deeper openings and less nighttime wall overexposure,
but also new thin lines extending from window tops. Mapping native T-junctions
onto the cylinder separated edges with different subdivisions. The correction
shares every horizontal cut between wall bands, piers and reveals. That change
exposed a second defect: balcony slab backs coincident with the exterior wall
became dark trapezoids after curved mapping. The native recipe now omits those
backs. A guarded migration removed 10,528 primary and 13,530 infill faces,
comparing every physical triangle before and after each changed object.

Twelve final matched day/night views have no page errors or failed requests.
An independent image-only review of housing day/night, river housing by day and
old town at night found that the new window seams and balcony trapezoids are
gone, and that window depth and the reduced wall lighting remain. The narrow
balcony wedge visible in the original baseline also disappears. Housing's night
door remains low contrast. Static images do not establish flicker-free motion.
The source comparison still fails on dense overlapping blocks, enclosed streets,
individual service details and repeated canopies; those are outstanding design
work, not covered by the facade pass.

Native mesh writing now reuses existing scene objects and welds only exactly
equal vertex positions. The unchanged-support check still compares the full
triangles, including winding. The final complete manifest audit preserves parcel
sites, ground, collisions, far proxies and all 221 public/rail/land tiles. The
236 primary tiles contain 5,898,866 near and 1,205,680 middle triangles; the 234
infill tiles contain 10,394,904 near and 2,360,928 middle triangles. These totals
are across the colony, not simultaneously submitted rendering triangles.

Actual playwright-webxr **0.3.0** entry passes all **10 cases in 2.8 minutes**:
stairs, relocated entry, balcony barriers, primary and compact infill door
approaches in A/B/C, and stereo walking/wrist travel through all four worlds.
The final **1,161 unit tests pass (0 failed; 938.96 seconds)**, as does the
production TypeScript/Vite build. The final served HTML and three JS bundle
hashes match those fixed before browser verification. The district
sweep captured 81 of 82 views before two tile fetches failed in its last workshop
view. Both files were present and byte-identical in source/public and served
dist. A fresh targeted day/night run of that workshop passed with no page or
request errors, giving all 82 planned images across the two runs. The first
run is still recorded as failed; its transient request failure has not been
explained or counted as a successful uninterrupted sweep. The capture utility
now saves completed cases and failure diagnostics even when a late case throws.

The independent daytime district review used all 36 street/overview images,
19 original-size inspections and four crops. It found remaining jagged contacts
under some shop awnings in B-workshop, B-station, C-production and C-cargo.
These are distinct from the corrected window/balcony joins; whether they are
new regressions is unproven. B-north has a paving path ending in grass before
the shop frontage, and A-river has grass strips interrupting frontage paving.
These defects remain open. In A-old-town, B-campus/north and C-market, buildings
and continuous paving should reach the street corners before adding further
facade detail. Fields and orchards already communicate a different open use
and should not receive the same urban density.

## Runtime cost and limits

Building recesses now use near detail within **180 m**, with a 27 m hysteresis
band. Station, public-space and land layers retain their 850 m near range and
60 m hysteresis. Middle detail, the 18-tile cache, three concurrent loads and
collision rules retain their previous limits. The distance is measured to tile
bounds; a large tile can keep its distant buildings in near detail.

An isolated comparison on Chrome/Apple M1 Pro/ANGLE Metal used four public
centres, two page loads each and four-second frame samples. At the same facade
geometry, changing the building threshold from 850 to 180 m reduced the station
view's median from approximately 33.3 to 16.7 ms; p95 remained 33.4 ms. The final
candidate has 16.7 ms medians at all four centres, p95 33.4 ms in old town and
at the station, and 16.7 ms in housing and market. Separate close office views
remain around 33.3 ms. These short desktop observations are not headset results
or a guaranteed frame rate.

| Final centre | Selected tile triangles before frustum culling | Resident detail buffers | Last sampled renderer triangles |
| --- | ---: | ---: | ---: |
| Old town | 688,776 | 70.67 MiB | 2,154,694 |
| Housing | 673,522 | 89.73 MiB | 2,106,834 |
| Station | 627,560 | 86.84 MiB | 2,176,580 |
| Market | 488,340 | 70.23 MiB | 1,906,626 |

The original pre-facade old-town/housing/market buffers were 31.10/37.59/31.92
MiB. Lowering the near distance does not reduce residency because loaded tiles
retain both LODs. Finer spatial ownership and bounded terrain/data loading remain
necessary before substantial additional density. Renderer counters and tile
triangle totals answer different questions and must not be interchanged.

Large native snapshots can be losslessly recompressed with
`python3 assets/blender/compact_blend.py source.blend separate-output.blend`.
The utility requires the `zstd` CLI, retains the source and compares the entire
decompressed SHA-256. Open the result in Blender before adopting it. This reduces
native authoring storage; it does not reduce rendered triangles or web transfer.
Both final compressed sources were reopened in isolated Blender after complete
decompressed-byte equality checks (primary 51,597,004 B; infill 72,727,329 B).

Evidence is under `qa/webxr/evidence/colony-facades-20260918/`. It retains the
previous two native sources, complete pre-export manifest and twelve matched
before images. Physical-headset appearance, comfort and performance are unmeasured.
The whole-colony goal remains active, including spatial terrain loading, denser
block layouts, broader transport/interior development and colony infrastructure.
