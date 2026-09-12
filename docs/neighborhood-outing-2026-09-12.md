# Neighbourhood outing — 2026-09-12

A resident can choose Central Square, Café, Park or their parked car from
Places → Directions, travel there, park, walk through the entrance and return
to the same car. Phone uses Travel → Directions. The wrist has
Places → Directions. Immediate visits remain explicitly under Visit now on
screen and on the wrist's original Places page.

## Behavior

- Street driving is the default: nominal 3.8 m/s² acceleration, 7 m/s² braking,
  roughly 50 km/h forward and 11 km/h reverse governors. Tire capability still
  depends on the car's own rotating-gravity load. The locked sphere uses zero
  engine friction in Street so the gentle engine can move it across real wall
  seams; explicit tire forces supply lateral grip and rolling resistance.
- Street / Experiment is selectable in the driving dock or wrist. Experiment
  preserves the existing 36 m/s² engine, 178 m/s cap and 0.3 contact friction.
  Selecting Street while moving removes excess engine power without abruptly
  clipping current momentum. This is not a calibrated road-car simulation.
- Each destination reserves an existing kerb slot, away from junctions. A
  supported sign identifies the stop and ordinary parked cars avoid the bay.
  The car is not reset when a route is selected, a café is used or a bench is
  occupied. Habitat rebuilds create fresh destination bindings.
- Driving directions end at the bay. Park appears only below 0.6 m/s, within
  two metres and approximately parallel. The deliberate action assists the
  last alignment and steps onto a clear pavement. Ordinary Street dismounts
  require a near stop; a car in the middle of a wide road must pull over.
  Experiment retains momentum-carrying dismounts.
- Dismounting changes the route endpoint to the entrance. Re-entering after
  Your car finishes that guidance. Indoor café and seated park instructions
  reflect the current activity instead of repeating the entrance instruction.

## Route model and limits

The bounded local A* search uses a two-metre grid, actual road footprints and
street-profile pavement widths. It excludes building rectangles, prefers
pavements on foot and follows certified entrance points when starting inside
a building. Park paths connect the entrance to the garden. Only collinear
points collapse; shortcuts never intentionally cut across a building corner.
Angle deltas wrap at the cylinder seam. A route is computed on selection,
walk/drive handoff, or sustained departure from it, not every render frame.

Directions are not lane following, signal obedience or autonomous driving.
Pedestrians, traffic and every indoor furnishing are not route obstacles.
The local search rejects over 1.6 km displacement in either surface axis or
600,000 cells. Unreachable destinations say so and retry after moving nearer.
Signs and parking paint are visual equipment; the vehicle collision body
remains a sphere. Actual car chassis, doors and wheel suspension are outside
this increment.

## Validation

- Unit suite: 815 tests; build includes TypeScript checking. Added obstruction,
  disconnected-road, azimuth seam, parking alignment, pavement exit and route
  progress checks. Real Rapier tests cover gentle acceleration, forward
  governor, braking, re-entry, and the preserved high-speed near-float test.
- `qa/neighborhood-life/outing.mjs`: all 18 ordered same/different destination
  combinations for walking/driving in Izma, plus the real Places selection.
  Initial timing sample: approximately 5–26 ms per route on this host; not a
  hardware-independent performance guarantee.
- `outing-roundtrip.mjs`: real keyboard throttle and brake on the last 18 m
  of each destination approach, Park, actual walking through the café door,
  brew/take coffee, park path and bench, and re-entry into the unchanged car.
  A debug setup positions the vehicle at each approach; this does not claim
  a fully continuous automated drive across the entire colony. Camera-facing
  helpers aim the QA walker; physical movement remains real input/contact.
  The same script checks the 390 px card and dock mode selection.
- `outing-wrist.mjs`: the real wrist canvas and UV hit/click path, route
  selection without teleport, cancel, mode switching, and disabled actions
  across Izma, Cooper, Elysium and Playground. Synthetic controller anchors
  exercise rendering in Chrome; physical XR hardware is not validated.
- Independent screenshot review checked the compact cue, car forward view,
  café/coffee state, park seating and phone layout. It found stale entrance
  and post-reentry messages, both addressed. Images that omit the wheels do
  not establish vehicle contact visually; contact/parking is checked by
  numerical probes and real dynamics tests instead.

Evidence images and JSON remain local under `qa/neighborhood-life/`; scripts
are tracked. Existing immediate-visit QA selectors choose the Visit now entry
when the Directions menu contains the same destination name.
