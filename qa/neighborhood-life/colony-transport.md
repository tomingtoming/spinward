---
origin: ai
created: 2026-09-17
---

# Whole-Izma transport surfaces and supports

The full-colony goal remains active. This increment replaces the 90
intra-strip planning ribbons with graded street/deck surfaces and visible
supports. It is not a finished transport network: rail service, stations,
IC/JCT lanes and the 18 inter-strip reservations remain unfinished.

## Model and runtime

`assets/blender/build_izma_transport.py` reads the actual exported earth,
including the original study's graded collar. It creates editable geometry
in both scenes of `izma-colony.blend`; the old planning ribbons remain hidden.
`export_izma_colony.py` then exports the saved meshes. Run the transport builder
after rebuilding/exporting the original colony model, or the planning builder
will replace the transportation work. Neither script changes Cooper, Elysium
or the original study's model.

Ordinary streets sit at least 0.16 m above the sampled finished ground at
their centre and edges; larger streets receive 2.2 m pavements. Narrow shared
streets blend into the grass over 1.5 m shoulders, allowing the physical body
to cross the raised road edge. Raised
approaches have retaining faces. River bridges have a deck, underside and
bank abutments. The longitudinal motorways have 2.4 m decks and 3,578 piers,
with bases below the terrain. Piers avoid the watercourse and general roads.
This is visible support geometry, not structural engineering certification.

The height solver shares explicit junction heights and caps profile grades
at 6% for ordinary roads, 4% for motorways and 2.5% for rail. Seven geometric
street crossings absent from the plan's explicit node list now share level
turning areas. One road/rail crossing has a separate bridge: rail top is
7.2 m above the road, leaving at least 6.2 m under its 0.9 m deck at the centre.
These constraints do not establish railway loading gauge, vehicle swept paths,
drainage or feasible lane merges. The design graph still needs those virtual
street junctions when routing services are introduced.

Junction plateau boundaries are inserted explicitly even when their length
is shorter than an ordinary profile sample interval. Terminal caps sample
their whole perimeter, including the uphill half beyond the route endpoint.
A regression checks both the caps and approaches immediately outside them;
the old sampled-only plateau failed this check before the model correction.

Road overlaps are clipped before cylinder projection. Pavements, parapets
and retaining faces are cut away from crossing carriageways. In particular,
the retaining walls inside a junction must not remain: their top edges showed
through the curved road as dotted circles/diagonals. Parapets follow the
longitudinal slope and leave openings at ordinary-road approaches.

The runtime base now has **582,120 triangles**, **244 building tiles** and
**1,715 building masses**. It remains an always-resident base, including the
transport geometry. Building requests are still limited to 3 and retained
tiles to 18. This does not yet bound all terrain/transport memory or draw cost.
The colony JavaScript chunk is about 31.24 MB, 6.39 MB gzipped. Fine transport
geometry needs spatial LOD/streaming before the full architecture is added.

Piers/abutments have box colliders. Parapets export as locally streamed
triangle colliders with `groundSurface:false`, so they obstruct a body but do
not become floors in the ground sampler. Retaining faces and deck undersides
are visual geometry; their side/underside collision is not yet implemented.
Ground-edge sampling tolerates up to approximately 2 mm of physical rounding
between collider origins, with a separate test rejecting points 4 mm outside.

## Verification and evidence

Evidence is gitignored under `qa/webxr/evidence/colony-transport-20260917/`.
The earlier `desktop/`, `final/desktop/`, `final-walls/desktop/`,
`final-verge/desktop/` and `plateau-check/desktop/` images retain the geometry
iterations. Final images and build hashes are under `verified/`.

Geometry tests use the actual exported meshes: profile grade/shared-height
constraints, thousands of sampled deck positions, all pier/abutment foundation
corners, both formerly buried study-join positions, road/rail separation and
rays through all ordinary-road motorway approaches. Passing these samples
does not certify every route's continuous usability.

Sampling every fifth profile point gives 6,716 collision windows outside the
study. The 3×3 window of 64 m cells contains at most 22 body descriptors and
2,716 mesh triangles in this sample (13,620 descriptors remain resident in the
whole index). The regression ceilings are 32 descriptors and 4,096 triangles
per sampled window. These are physics-geometry budgets, not headset FPS claims.

`colony-transport-audit.ts` diagnoses route-centre samples at nominal intervals
of at most 100 m. Local and arterial junctions share one visible surface, so
both road materials form the ordinary-street coverage index. A missing local
material alone is not a hole after overlapping road faces are removed.

Independent review checks day/night supports on all three strips, bridge
abutments, road/rail separation, the street crossing, district centres and the
original study join. A same-camera structure-visible/hidden comparison
confirmed that the dotted crossing artifact depended on the structure group.
Model inspection identified the internal retaining faces; the final fix
clips them at the road union's boundary rather than hiding all structures.
The close street-crossing view is clear after that change. The subsequent
plateau/perimeter correction removes the large grass arc at the B terminal;
the cap/approach regression failed on the preceding asset. Thin green seams
and dotted lines remain in some district-centre views. Their remaining cause
is not established; a conforming boundary between differently subdivided
curved road polygons is a hypothesis, not a verified diagnosis. Do not report
that all road seams have been eliminated.

The saved Blender model's unrolled/cylinder mapping was checked at 1,521,384
vertices, with maximum discrepancy 0.691 mm. This verifies scene correspondence,
not the absence of runtime surface seams. The route audit finds all 4,135
sampled intra-strip surface positions and no sampled burial over 10 cm;
the 18 unbuilt inter-strip links are reported separately.

### Browser and XR

playwright-webxr **0.3.0**, Chrome 152 / Apple M1 Pro / ANGLE Metal. Final XR:
**10 passed in 5.4 minutes**, with no automatic retries. It used the actual
Menu/VR entry, controller sticks, wrist ray/trigger and session exit. The
362-file build hash inventory is `verified/build.json`; the final run's files
are `verified/xr/`. `xr-final/` retains the preceding model's successful run;
it is not the final plateau geometry. Stereo views are 1280×960 per eye with
0.064 m IPD.

The first eight-case run passed seven cases but failed the old-study boundary
walk: a raised local-road edge deflected the physical body away from its target.
The 1.5 m verge transition fixes the geometry. The **unchanged 65 m walking
fixture** then passed alone in 44.1 seconds and again in the final ten-case
run. No collision check was disabled or movement endpoint relaxed.

| Route | Measured progress | Support samples |
| --- | ---: | ---: |
| A civic centre, axial | 29.837 m | 16 |
| B campus, axial | 30.145 m | 16 |
| C market, axial, then wrist return | 29.286 m | 29 |
| Old study → whole terrain, axial | 64.392 m | 58 |
| A motorway, along the deck then against parapet | 31.497 m | 32 |
| B motorway, along the deck then against parapet | 31.447 m | 37 |
| C motorway, along the deck then against parapet | 32.001 m | 32 |

The largest ground/drawn-deck discrepancy in these seven cases is 16.0 mm at
the old-study boundary. Every motorway case keeps sustained stick input toward
the edge and observes the body stop before crossing the parapet. The other
three cases preserve the original riverside walk (420.926 m) and shop entry
(28.165 m), night head-roll and wrist Places, and Cooper/Elysium/Playground
round-trip switching. The old-study route has a different support assertion:
it checks that the body does not penetrate the drawn floor, and is not part
of the seven-case ground/deck discrepancy measurement above. All ten
page-error logs are empty. The nine cases recording request failures have
empty failure lists; the night case does not record that field.

All 26 final desktop captures completed with no page or resource errors.
At 1440×900, DPR 1, Quest quality on the development Mac, each 1.5-second
frame-interval window has a median of 16.7 ms; the largest p95 is 16.8 ms.
These refresh-limited samples were taken while the unit suite ran on the CPU;
they are neither cold-load timing nor a sustained headset benchmark. At most
12 building tiles were loaded in these views, within the limit of 18.

The browser's approximate `performance.memory` used-heap readings ranged
from 300 to 1,083 MiB during the 26 page reloads. A separate four-load probe
(A → B → C → A) measured stable pages before/after forced V8 garbage collection.
After collection, CDP reports 165.5–166.4 MiB used heap and 105.2–105.6 MiB
backing storage. These fields are reported separately, not added as an estimate
of process memory. This does not measure cold peak, GPU memory, retention during
continuous travel or physical Quest memory. Evidence and served asset hashes:
`verified/memory-and-served-build.json`.

The final unit suite passed **1,120 tests across 190 files**, zero failures,
in 575.50 seconds. TypeScript/production build passed. Rebuilding after browser
verification reproduced all 362 saved file hashes exactly; the served main,
colony and other-world JavaScript assets also match. Logs are under `verified/`.

Independent final review inspected all 26 desktop images and 12 selected XR
images (three motorway start/walked/blocked sets, boundary start/end and night
Places). It confirms the close crossing's removed arc, visible supports and
stereo surfaces within those views. Thin district-centre seams, motorway-2's
dark upper-edge dots and the old-study join remain. No new large surface or
one-eye loss was identified. The other XR images, continuous intermediate
frames, collision response and physical-headset comfort are outside that
visual review; movement assertions above supply the separate numeric evidence.
Full observations: `verified/visual-review.md`.

## Remaining work

The riverbank connection still changes width/direction sharply at the study;
its water and terrain seams need finishing. A general road still ends in grass
before the old study's street. Longitudinal routes do not yet provide continuous
travel into every old entrance. Motorway access reaches a shared deck height,
but it has no complete acceleration/deceleration lanes or grade-separated JCT.
Rail is still a ballast/deck placeholder. The strip-crossing structures and
end transfer facilities are reservations, not usable connections.

The 18 districts need parcel layouts, building kits, greenery, water facilities,
local night lighting and usable residential/public interiors. Frame intervals
on the development Mac and emulated stereo tests do not certify physical Quest
performance or comfort. No push, merge, deploy or scheduler was added.
