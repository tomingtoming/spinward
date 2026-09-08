# Street access contract

Generated `CityPlan.buildings` carry `front` and `access`. Synthetic collision
footprints may omit them. Access records reference a road index and plan-local
ID, the fitted facade centre, the road edge, and a straight corridor width/length.
IDs are not persistent between regenerated plans.

Certification requires a road on the declared front side, enough road frontage
for the entire corridor, connection to an arterial through usable road junctions,
no footprint/road overlap, and no other building footprint crossing the corridor.
Detached houses use their actual fitted offsets and extents, also used by their
gate layout and collision geometry. The original larger envelopes conservatively
reserve space for unloaded/fallback geometry and neighbouring buildings.

Street-first subdivision replaces nested building/road rings. Through streets
divide each unbuilt block into smaller cells before any frontage parcel is
allocated. Each cell has non-overlapping perimeter rows and a courtyard. Urban
and industrial cells use local streets; residential cells use shared lanes.
Every internal street reaches the perimeter network at both ends. Certification
remains a safety check, not a mechanism for cutting roads through buildings.
Three scales with two seeds currently require zero access-related removals.
Rejected candidates and reasons remain in `accessRejected` for diagnostics.

## Absolute street dimensions

These are Spinward design values, not national regulatory compliance claims.

| Class | Carriageway/shared surface | Sidewalk, each side | Total |
| --- | ---: | ---: | ---: |
| Arterial (three lanes per direction) | 19.5 m | 3 m | 25.5 m |
| Collector (two lanes per direction) | 12 m | 2.5 m | 17 m |
| Local (one lane per direction) | 6 m | 2 m | 10 m |
| Residential shared lane | 4 m | none | 4 m |

Entrance paths target 2 m, narrowed to half the facade width on tiny footprints.
The base city cell is capped at 80 m: larger habitats add blocks, not wider
roads. The subdivision targets 130 m urban cells and 85 m residential cells.
All profiles are shared constants in `streetProfile.ts`.
Lane counts and lane widths derive the carriageway width, lane dividers and
traffic centres. Arterials use six 3.25 m lanes; collectors use four 3 m lanes;
locals use two 3 m lanes. Centre avenues and widely spaced cross streets are
arterials, intermediate grid streets are collectors, and remaining streets are
local. Internal residential shared lanes remain unmarked 4 m routes.
Small playground drums (radius below 300 m) instead use two 3 m arterial/collector lanes
with matching two-lane paint, so roads do not consume their entire land strips.
Bridge carriageways retain the connected arterial width with separate sidewalk
bands; the elevated expressway also uses the arterial carriageway width.

## Junction ownership and vehicle scale

`compileRoadNetwork` records which source road indices meet in each shared
junction area. Junctions own that area; incoming road rectangles are cut against
it and against earlier surfaces. The output is disjoint and conserves the road
union, including parallel duplicates and T junctions. Global road rendering uses
one surface elevation, not raised crossing roads. Surface UVs retain the source
road coordinates so cutting an arm does not squeeze or restart its lane pattern.
The cylindrical geometry is written directly into typed buffers, avoiding one
temporary mesh per road fragment.

Near rendering merges duplicate collinear road runs before planning junctions.
Each junction footprint is partitioned into non-overlapping asphalt/sidewalk
cells. Shared lanes participate in junctions too, without acquiring lane paint
or sidewalk bands. This is junction surface/topology generation, not a traffic
signal, turning-lane, or vehicle right-of-way simulation.

Ambient vehicles use explicit width/height/length envelopes instead of scaling
only by length: sedan 1.8/1.5/4.4 m, SUV 1.9/1.75/4.6 m, hatchback
1.75/1.45/4 m, delivery 2/2.35/5.2 m, taxi 1.8/1.55/4.4 m, truck
2.2/2.5/5.4 m. Per-instance variation is limited to 0.97–1.03. Even the largest
vehicle stays below 2.3 m wide. These are design envelopes, not identified real
vehicle specifications. The player rover is unchanged.

## Building massing and frontage coverage

Frontage rows as short as 4 m can host a fitted parcel instead of disappearing
below the nominal lot pitch. Single buildings use the actual allocated pitch,
not the smaller nominal pitch. Budget estimation uses the same minimum-one-slot
rule. Urban rows extend up to 40% of the smaller cell dimension (48 m maximum),
while residential gardens retain the shallower 30% / 24 m rule.

Generated city lots no longer produce needle-tower archetypes. Everyday blocks
are capped at 48 m and twice their footprint's shorter side; setbacks at 60 m
and twice the shorter side. Podium buildings require a minimum 28 m short side
and 1,400 square metres of footprint, and remain below three times the shorter
side and the district height cap. The separate civic observation tower remains.
Detailed LODs retain the procedural podium/setback form instead of substituting
a generic skyscraper asset. These are visual massing rules, not structural
engineering validation. Regression tests now cover short-frontage occupancy and
core footprint area in addition to access and building count.

Loaded rectangular kit facades, frontage props, and civic entrances use the
recorded front direction. House kits keep their existing fitted facade/gate
orientation. Frontage props sit beside the entrance, or are hidden if they do
not fit; extra civic portals are not applied to detached-house kits.

Near-view pavement uses the certified corridor, follows cylinder curvature, and
replaces the older garden-only path. Near sidewalks use the reserved profile
widths. Near road tiles are generated geometry rather than GLBs with baked-in
lane counts. Their paint, sidewalk envelope, crossings and junction sockets
are derived from the same road data; geometry merges into one material batch.
Sidewalk strips are clipped against every carriageway, including shared lanes.
Junction tiles own zebra crossings in the continuation of their sidewalk bands:
four open arms at crossroads, three at T junctions, and two at bends (where a
sidewalk band exists). Approach tiles do not add duplicate zebra crossings.
Shared lanes use plain, unmarked tiles and the curved road renderer.
They are also included in the daytime far bake, but do not gain night glow.
Pavement is a visual surface over the walkable cylinder, not a new collider.

## Inspection

Open the local app with `?access&metrics=off`. Within 180 surface metres of the
detail focus, green segments show entrance-to-road connections; red crosses show
omitted building candidates. Remove `access` to disable the overlay.

Tests cover street-first subdivision and every generated building in three habitat scales with two seeds,
including fitted entrance positions, full-width road contact, and unobstructed
house gates. Focused cases cover isolated alleys, corner-only junctions,
wrong-side roads, blocked paths, footprint overlaps, and the cylinder seam.

This contract covers generated city buildings, not separately authored tower,
spaceport circulation. Decorative furniture and vegetation are not
a pedestrian-navigation graph, and loaded asset door artwork still needs visual
review. Browser control was unavailable during implementation; desktop/mobile
appearance and performance remain unverified. No production deployment is made.
