---
origin: ai
created: 2026-09-18
---

# Deeper blocks and building forms

The latest frontage-partition update is recorded at the end of this document.
The earlier 5,080-building model and its completed verification below remain a
baseline; their results do not verify the newer model.

This increment adds streets inside and behind existing blocks, and changes
building volumes to reflect different uses. It is a step toward deeper inhabited
blocks, not a completed reference-like city. The reference images remain visibly
denser: episode 05 images `0039` and `0041` show closely spaced roofs filling
block interiors and continuous walls along a narrow street. The current views
still show broad grassland and repeated facades.

## Model and extent

The source sketches 43 child streets in addition to the previous 33. Thirty
new streets pass native-ground junction checks, giving 60 accepted streets.
Eleven sketches fail the existing grade limit and five depend on a rejected
parent. Rejected sketches do not receive buildings or physical road surfaces.
Cross lanes connect the existing main street to a back street; outer back lanes
join the existing back street at both ends. These local connections do not
establish a colony-wide grid or complete the vehicle/navigation graph.

There are 3,365 infill buildings, of which 308 front the new child streets in
ten districts. With the retained 1,715 primary buildings, the whole-colony
model contains 5,080 buildings, excluding the original 420 m study. Woodland,
orchard and park districts retain their lower density. The first placement pass uses the larger principal buildings; a second urban
pass fits 977 small houses and shops on remaining frontages. These later plots
have shallower yards and smaller setbacks, while the principal buildings keep
their positions, forms and doors. Park and farming settlements do not receive
this infill pass. Count alone does not measure urban quality.

The existing nine building families now use 17 form labels. Houses can have
lower rear extensions; shops can have a smaller upper home; apartments include
U-shaped courts and slabs up to 46 m wide; offices include straight and stepped
forms. Some workshops have repeated pitched-roof bays. Their internal
`sawtooth-workshop` label does not mean an asymmetric north-light roof has been
modelled. Upper floors of setback shops use residential windows. Apartment
balconies remain on the principal frontage, with smaller windows on the wings.
New buildings remain exterior models; a visible courtyard is not a completed
interior or resident simulation.

`izma_building_forms.py` supplies volumes and roofs to the saved Blender
meshes, physical solids and coarse silhouettes. The neighbourhood builder opts
into these variants; the original primary-building model is retained. The
door position on the principal frontage is preserved. Exported street floors
share 64 m spatial collision compounds while retaining every native triangle.
This keeps additional junctions within the existing local body budget.

The revised land layout avoids the new lots and streets: 79 areas covering
1,123,496 m², with 4,433 fixtures. It contains 19 rear gardens, 35 shared
gardens, 19 working yards and two each of allotments, orchard and woodland.
Forty-six approaches meet the existing grade limit; 23 are grade-rejected and
ten have no accepted candidate. Interior walking meshes contain 102 segments;
deduplicating their centres removes the previous coincident reverse segments.
Trees and equipment now assign all their faces to the tile owning their centre,
matching the proxy, so a tile boundary cannot leave a detail-only fragment.

The manifest has 534 detail tiles: 222 primary-building, 18 public-space,
104 neighbourhood, 138 rail and 52 land-use tiles. Neighbourhood detail totals
119,189,070 bytes, with 1,292,998 near / 861,170 middle triangles and 181,146 fixed
ground triangles. Existing request, detail-cache and six-light limits remain.
The colony bundle itself is still large; local caches do not bound total data.

## Verification

Evidence is under `qa/webxr/evidence/colony-block-depth-20260918/` (ignored).
`source-audit.json` separates actual ground-volume area from the rectangular
building envelope; neither is a population estimate. The 112,432-point local
cost audit finds at most 31 compounds and 3,574 triangles, with collision-cache
peak 1,523,448 bytes / 128 entries. These are geometry/cache measurements,
not physical-headset performance.

Sixteen targeted tests pass, covering native street joins, child-parent
dependencies, courtyard support, land-use reservations/LODs, collision caching
and rail dependencies. The first checks found an empty-proxy tile fragment and
a 35-compound junction. Whole-fixture tile ownership and spatial road compounds
fix those defects without increasing budgets. The floor comparison still uses
the actual rendered and physical surfaces within 2 cm; junction crossfall
sampling now recognises child streets meeting the middle of a parent road.

The corrected production build passed. `filled/served-hashes.json` records
matching disk and HTTP HTML/application/colony/other-world assets before browser
verification. The colony bundle is 81,729,543 bytes (18.73 MB gzip reported by
Vite); the build's large-chunk warning remains. The served build is held fixed
through browser verification.

The first block-depth model passed 1,153 unit tests and twelve WebXR cases,
including three full new-lane returns of 412.6 / 408.7 / 420.8 m. Its 82 desktop
images and memory probe are in `initial/`, `verified/` and the evidence root.
Those results precede the compact-frontage correction and are not final-model
verification. The corrected model passes all 1,153 unit tests across 199 files
(22,962,491 assertions, 1,144.25 s), in addition to the sixteen targeted tests
and cost audit above. Fifteen WebXR 0.3.0 cases pass in 20.9 minutes on the
unchanged corrected build: five land/garden routes, three principal entrances,
three compact entrances, three new back-lane returns and the four-world/wrist
regression. The new lane walks cover 412.7 / 408.9 / 422.1 m, with their 1,312
recorded samples grounded and return errors below 0.24 m. The checks use actual
VR entry and controller input on Apple M1 Pro / ANGLE Metal; they are emulation,
not physical-headset results.

The corrected model's 82 desktop captures cover all 18 districts from ground
and overview positions in daylight and at night, plus five building forms in
both periods. No page errors or failed requests were recorded; at most 18 detail
tiles were resident. At 1440 × 900 / DPR 1 / Quest quality, the 1.5-second rAF
samples have median and p95 intervals of 16.7–16.8 ms. These short stationary
samples do not establish moving-frame peaks or headset performance.

Five page visits followed by forced V8 GC measure 209.63–211.02 MiB of JS heap
and a separate 208.69–219.40 MiB of backing storage. Three full collider-cache
pressure sweeps remain at 128 entries, peak 1,659,240 bytes, and 210.47–210.57
MiB JS heap. This is not total process/GPU memory, cold-load peak or continuous
player travel. The HTML and all three main JS bundle hashes still match disk,
HTTP and the saved build after verification (`filled/served-hashes-after.json`).

## Visual review and unfinished work

For the corrected compact-frontage model, an independent reviewer inspected
nine stereo entrance captures across A-river, B-housing and C-market alongside
the two source images. A-river still has broad grass between its entrance and
the opposite row. B-housing has the strongest visible enclosure of the three,
but repeats windows, balconies and entrances. C-market's night road is nearly
black and pale walls wash out near lamps. No obvious large hole, floating
building or blocked doorway was identified in the visible areas. Narrow grass
strips, exposed paving sides and angular road edges still interrupt some joins.
These close entrance views do not establish whole-street or block density;
their static appearance is separate from the controller-walk results.

The current desktop set was also reviewed as eight labelled contact sheets,
with the A-old-town and B-housing overviews opened at full size. The independent
reviewer additionally inspected six current desktop views and 22 current XR
loop/world/wrist images, including five enlarged wrist panels. A-river and
B-workshop ground views show buildings enclosing both sides of a street;
the three urban overviews still show green gaps between buildings and large
vacant surroundings. C-fields is legible as agriculture, where low density is
intentional. Thin join lines/side faces remain in B/C lane captures, without an
obvious large hole. The reviewed worlds retain distinct scenery and both eyes;
small and disabled wrist text remains low contrast. Night views preserve roof
silhouettes and separate window lights, but lamps wash out nearby pale walls
and unlit ground is hard to read. Static sampling cannot clear hidden joins,
transient switching defects or continuous-motion comfort.

For the first model, an independent reviewer inspected all 11 focused daytime views: three ground
views, three overviews and five building-form views. Upper setbacks, rear wings,
U-shaped courts, long slabs and repeated workshop roofs are distinguishable.
No obvious major floating building, ground hole or missing roof was identified
in that sample. Static images do not establish access or all hidden joins.

The same review found broad grass on one side of each sampled street and
strongly repeated windows, awnings and wall finishes. Roofs overlap more deeply
than before, but images `0039` and `0041` remain the unmet comparison: tightly
occupied block interiors and continuous buildings on both sides of the street.
The next density work must change the spaces between buildings and the block
layout, not rely on increasing a building counter or adding decorative props.
Agriculture and forest should retain their distinct open land uses.

`audit-block-frontages.py` makes the remaining gap measurable on saved local
streets. At each native segment midpoint it casts horizontal rays normal to the
road against ground-level building volumes, weighting samples by segment length.
Junction openings are included; the 15 m threshold starts at each road edge.
It is a design diagnostic, not a distance recovered from the reference, and does
not measure visual occlusion, facade quality or the entire arterial network.

| District | Previous model, same retained roads | Corrected model, same retained roads | Corrected model, all local roads |
| --- | ---: | ---: | ---: |
| A-old-town | 33.9% | 38.6% | 38.3% |
| B-housing | 32.1% | 24.7% | 31.2% |
| C-market | 25.9% | 30.3% | 33.3% |

The first massing revision reduced retained-road coverage, particularly in
B-housing (32.1% to 14.8%). The compact-frontage pass recovers part of that loss
and raises coverage in the other two centres. B-housing's retained-road result
remains below the previous model; more buildings and larger blocks do not by
themselves fix its layout. The next density work must address those remaining
openings and block interiors while preserving distinct agricultural/open land.

The reviewer also inspected the corresponding 11 nighttime views. The same
building forms remain identifiable, and no major floating lamp or missing roof
was identified in visible areas. Nearby lamps locally wash out pale shop and
workshop walls; the courtyard floor and gaps between lamps are dark. Distant
windows remain separated points, with no major broad glow, but night overviews
give weak cues to the road/land layout. Dark hidden joins remain uncertain.

The whole-colony goal remains active. Water facilities, inter-strip transport,
IC/JCT driving geometry, broader land-use continuity, new interiors, facade
variety, night-light balance and terrain streaming remain incomplete. Physical
headset comfort and performance are unmeasured.

## Rejected interior-lane experiment

A subsequent offline experiment sketched 17 passages from the cross lanes into
existing blocks. Ten passed the native street checks. The first version produced
3,350 infill buildings; using shallower 8.4 m houses/shops and small yards on the
new passages produced 3,405, compared with the committed 3,365. Neither version
improved the intended block density. The new
`audit-block-interiors.ts` clips actual ground-level body volumes to the same 25
retained street-centreline loops, including streets/gardens in the denominator.
It excludes upper storeys and courtyard voids; this is not roof coverage or a
dimension measured from the animation. Its self-comparison returns zero change.

| District | Committed model | Extra lanes | Extra lanes with small plots |
| --- | ---: | ---: | ---: |
| A-old-town | 14.17% | 13.41% | 13.41% |
| B-housing | 17.58% | 17.40% | 16.62% |
| C-market | 21.56% | 16.9% | 15.40% |

The added roads consume occupied space and trigger replotting; extra small
addresses do not compensate for lost building area. More passages/addresses
would therefore be a misleading success criterion. Both candidates were
rejected before export, browser verification or a production rebuild. All six
changed model/source paths were archived with hashes and restored exactly to
`c129151`; the verified preview is unchanged. Evidence is in
`qa/webxr/evidence/colony-block-interiors-20260918/` (ignored).

The next layout work must coordinate whole street blocks, lot boundaries and
building depth, with current structures treated as revisable design rather than
forcing every change into their remaining gaps. Preserve the original study,
public entrances, terrain support, transport and distinct open land uses. Assess
both occupied area and ground/overview images before accepting the layout.

## Contiguous frontage parcels

The next model changes parcel allocation on the thirteen urban districts. It
partitions complete street-edge intervals, advances by each accepted lot's
actual frontage, and shares depth with the facing road. Deep narrow shops,
larger apartment courts and work premises can therefore occupy the block's
interior. Fixed-size lots retain their authored dimensions in the native mesh.
The five garden/farming settlements keep their previous placement policy.

This is a parcel-layout change on the retained 60 local streets. It does not
replace the larger road topology: the small repeated loops and large empty
surroundings remain unfinished. These dimensions are Spinward design choices,
not recovered dimensions or a canonical map of Izma.

There are 3,885 additional parcels: 3,600 allocated frontage lots, 109 compact
gap plots and 176 rural/park plots. With the 1,715 primary buildings, the model
contains 5,600 buildings, excluding the original study. It retains nine
architecture families and 1,199 supported street lights sharing six active
lights. New building interiors remain closed.

On the same retained street-centreline loops, actual ground-level building
coverage changes as follows. The denominator includes roads and gardens; the
measurement excludes upper storeys and courtyard voids. All eleven districts
with comparable closed loops increase their occupied area.

| District | c129151 | Frontage partition |
| --- | ---: | ---: |
| A-old-town | 14.17% | 22.72% |
| B-housing | 17.58% | 29.43% |
| C-market | 21.56% | 28.68% |

The existing two-sided frontage diagnostic on all retained local streets rises
from 38.3% to 51.7%, 31.2% to 47.6%, and 33.3% to 52.2% respectively. These
numbers establish geometric change, not visual equivalence to the reference.
The ground-footprint plan comparison shows deeper occupied rows and reduced
slivers, but also the unchanged limited extent of the developed street network.

The first export exceeded the local body budget (maximum 36). Pairing adjacent
small buildings on the same straight street edge reduces the measured maximum
to 30, retaining the 32-body limit. Each pair is capped at 256 triangles and a
48 m bounding extent. The sorted SHA-256 digest of all 337,054 native physical
triangles is identical before and after pairing; no wall, roof, stair or ground
triangle was discarded. Surface groups fall from 4,115 to 2,858. The 112,399-point
cost audit retains a maximum of 3,574 triangles and a collision-cache peak of
1,526,040 bytes / 128 entries. This is a geometry audit, not a frame-time result.

The revised land layer retains 79 zones and has 4,343 fixtures. Its current
41 accepted approaches are fewer than the baseline's 46; 27 are grade-rejected
and eleven have no candidate. Wider buildings require further land-access
planning. This loss of connected garden approaches is recorded as unfinished
work, not hidden by tests of the remaining accepted routes.

Six analytical checks cover frontage catchments and depth sharing, and the
sixteen native surface/access/collision/rail tests pass with 400,738 assertions.
All 1,153 unit tests pass across 199 files (22,974,733 assertions, 1,009.14 s).
The production build passes; its colony JS bundle is 85,494,793 bytes, and the
large-chunk warning remains. Evidence is in
`qa/webxr/evidence/colony-parcel-blocks-20260918/` (ignored).

All 82 desktop captures completed with no page errors or failed requests and
at most 18 resident detail tiles. The 18 districts have ground and overview
views in daylight and at night; five building-form views have both periods.
Short stationary rAF samples at 1440 × 900 / DPR 1 / Quest quality have a
16.7 ms median and 16.7–16.8 ms p95 on Apple M1 Pro / ANGLE Metal. The CPU unit
suite ran concurrently. These are neither sustained walking nor headset
performance measurements. Twelve additional captures use the baseline parcel
contract to retain camera sites for a before/after comparison.

Five forced-GC page snapshots give 215.87–216.73 MiB of JS heap and separate
backing storage of 217.61–228.09 MiB. Three full collider-cache sweeps retain
128 entries, peak 1,967,760 bytes, and 216.17–216.28 MiB of JS heap. No page
errors or failed requests occur. These reload/cache-pressure probes do not
measure continuous travel, cold-load peaks or total process/GPU memory.

The initial VR run found a fixture assumption: the garden test followed only
forward-oriented edges, requiring two paths to form a chain. The selected
garden now has two paths branching from its entrance. The fixture now treats
paths as undirected, retraces the first branch to its junction, and walks the
second branch. It still requires two distinct connected paths and native
rendered ground under the moving body. Junctions are retained when thinning
the walking waypoints. No geometry or tolerance is changed for this fix.
That run passed thirteen current cases before it was interrupted during an
unintended archived test: Playwright's recursive discovery had also included
three `.xr.mjs` copies inside the rejected-experiment evidence directory.
`playwright.config.mjs` now excludes evidence and artifacts; `--list` confirms
exactly fifteen current cases in four source files. The archived test's result
is not counted. The repaired garden case and the unrun four-world/wrist case
then both passed in 2.0 minutes on the same served build. Together the runs
cover all fifteen current cases. The initial failure and archive interruption
remain in `xr/`; the two successful follow-ups are in `xr-repaired/`.

The garden walk covers 90.5 m through both branches and back, with all 115
samples grounded and a 0.07 m return error. It is the current small garden,
not the earlier model's longer garden route. Actual VR entry, controller input,
version 0.3.0 diagnostics and native visible-floor checks remain enabled.
The four worlds retain their separate geometry and wrist travel in the sampled
stereo/head-roll views. Physical-headset performance and comfort are unmeasured.
After verification, all four HTML/JS hashes still match the starting hashes,
disk and HTTP (`served-after.json`).

The three completed back-lane walks cover 412.1 / 408.6 / 420.1 m. All 1,291
recorded samples are grounded, with return errors at most 0.25 m and no page
errors. The simulation clock advances during each roughly five-minute walk,
so its entry and return images can have different daylight conditions.

Visual review separates an improvement in footprint occupancy from street
enclosure. The root inspected all 82 captures as labelled contact sheets and
selected views at full size; an independent reviewer inspected eight daytime
and eight nighttime views, then twelve matched before/after pairs. Old-town
and market overviews have deeper roofs and smaller green gaps. From the
retained old-town and housing street viewpoints, replacement of taller blocks
with lower rows increases the visible sky and weakens enclosure. Market lamps
wash out less wall area in the matched night view; a housing entrance is
darker. Old-town's new selected night viewpoint still has local white clipping.
The streets retain wide one-sided grass openings, repeated facades and weak
use-specific cues. Those are unfinished design issues, not visual passes.
The root also inspected twelve entrance captures and nine stereo loop images.
Both eyes retain corresponding scenery; no obvious major floating body or
missing road is visible in this sample. Repeated porch/door forms and dark
entrances remain. This static review does not clear hidden joins or headset
comfort. Source frames ep01 `0006` and ep06 `0073` were additionally reopened:
the overhead city layers and tight service alley remain substantially missing.

The land builder currently validates only the shortest geometrically clear
approach chosen by the planner. If its native road/terrain junction fails the
grade check, it drops that access without trying the other candidates. The
next access correction should evaluate alternative reserved routes against
native ground, preserving the grade and obstruction limits. Merely choosing
an easier garden for the VR case would not restore the five lost approaches.
