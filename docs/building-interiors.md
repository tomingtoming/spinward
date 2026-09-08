# Enterable buildings and five detail levels

Suitable rectangular buildings across the colony now host a cafe, a passage,
or a courtyard open to the overhead city. Warm entrance strips and an
**OPEN · WALK IN** sign identify public entrances. Walk through normally; throwing
uses the existing Ball controls. The centre plaza dome and its reserved lot,
collision proxy, and day/night bake have been removed.

## Try locally

Start `bun run dev`, then open:

- [Cafe](https://localhost:5173/?visit=cafe&metrics=off&t=0.35)
- [Passage](https://localhost:5173/?visit=passage&metrics=off&t=0.35)
- [Courtyard](https://localhost:5173/?visit=court&metrics=off&t=0.35)

`visit` resolves the nearest matching entrance in the current device's plan.
It also works with `tier=phone` or `tier=quest`. An explicit shared pose takes
precedence. Unknown values and presets without eligible buildings retain normal
startup. Existing Link/Photo sharing works inside buildings.

## Detail and ownership

| Level | What is drawn |
| --- | --- |
| 4: distant city | Existing shell bake and screen-size culling |
| 3: block | Existing distant boxes; hollow structural shells in the near disk |
| 2: street | Metre-sized entrance markers and public entrance sign |
| 1: entry | Benches, counters, tables and courtyard planting |
| 0: room | Small tabletop objects |

The existing coarse near/far grid owns exterior shells (up to 1 km near range
on Izma, quantized as before). Interior detail is independent: distance to the
building footprint, including altitude, promotes entry furniture at 48 m,
entrance signs at 160 m, and small objects at 10 m. A 20% exit hysteresis and
one-metre update threshold prevent flicker. Inside the ground-floor footprint,
room detail stays active; flying over a roof does not count as entering.
Structural shells keep their openings throughout the near disk. No fake door
or opaque proxy is inserted when furniture detail changes. Existing far-box
and shell-bake approximations remain; this pass does not implement portal
occlusion or screen-projected per-room LOD.

Six instanced material batches plus one merged curved floor cover the nearby
interiors. There are no per-building lights, external room assets, or mesh
allocations during room LOD changes. Fine/coarse city rebucketing rebuilds the
near layer, as it already does for external detail. Render geometry and
materials are released on habitat rebuild and disposal.

## Layout and contact contract

One eligible building per 180 m surface cell is selected deterministically.
Eligibility requires a certified street entrance, a rectangular block with a
10–32 m frontage and depth, at least 8 m height, and no fitted suburban house.
Small habitats below 800 m radius keep their open physics playgrounds. Selection
uses the generated plan, so the same seed and quality budget reproduce the
same entries; different quality tiers can generate different buildings.
Passages whose rear landing overlaps another building become cafes.

Templates use a 4.2 m ground floor and a 3.2 m wide, 3.1 m high doorway. Cafes
and passages preserve the upper mass; courts cut a light well through it.
The cylinder remains the walkable floor. Its decorative finish follows curvature
at the same visual lift as pavement, with no new floor collider or step.

All solid walls, lintels, ceilings and furniture are converted from the same
part data into render transforms, streamed Rapier boxes and analytic ball boxes.
The synthetic boxes have `baseHeight`, so a ceiling never becomes a solid block
down to the street. Contact does not depend on LOD. Major furniture is shown
before the player can reach it; only non-solid small dressing uses room LOD0.

## Validation and limits

Tests sweep player/ball clearances through every template in all four frontage
directions, check walls and ceilings, courtyard openings, determinism, distant
placement, the cylinder seam, altitude-aware LOD, and hysteresis. A real Rapier
body crosses both passage doors and hits the elevated ceiling after colliders
stream out and back in. Existing city and physics tests also run.

These are ground-floor templates, not procedural complete apartments. Upper
floors have no usable rooms, stairs or elevators. Small props are decorative;
use the existing throwing controls to experiment. Rear landings are checked
against building footprints, not a full pedestrian or vegetation graph.
