---
origin: ai
created: 2026-09-12
---
# Overnight development — 2026-09-12

User-authorized window: until 08:00 Asia/Tokyo (2026-09-11 23:00 UTC).
Continue from the working branch `codex/neighborhood-life` in
`/Users/toming/keel/lake/spinward-development`. Public deployment/push is not
part of this request. The existing local preview is `https://127.0.0.1:5192`.

The accepted direction is embodied first-person presence: stand, walk, stop,
look down, then connect hands/seating and eventually artificial-gravity actions.
The user also explicitly asks to improve the colony as a whole and avoid
spending the whole night on one detail. Complete bounded, tested increments,
then reassess the street, movement, life, environment and performance together.

## First increment — standing body (00:52)

Standing body uses the original Blender resident hierarchy, hidden head,
independent torso heading, surface-space foot anchors and two-segment leg IK.
The existing room-only timed footsteps are being replaced with foot-contact
sounds indoors and outdoors. The existing seat and coffee hand must remain
intact. PC/touch walking is 1.8 m/s; PC Shift retains the previous 6 m/s speed.
VR still uses its original movement and controller display; the tracked body
adapter is not implemented yet and must not be claimed complete.

Current checks: motion, leg reach and surface-selection tests pass. Browser
checks passed desktop walking/running, large head turns, stopping, portrait
night display, coffee preparation/carrying/drinking/return and optional model
failure. Torso eye offset keeps both feet visible at rest. Contact events drive
sound; the camera does not inherit the gait. Independent image review found
no visible leg penetration but flagged the existing four-row phone HUD hiding
the body and the low contrast of unlit shoes at night. The HUD is a useful next
increment across the whole walking experience. Probe:
`qa/neighborhood-life/player-body.mjs` (`PLAYWRIGHT_MODULE` as in other probes).

## Second increment — phone view clearance (00:59)

At widths up to 720 px the dock keeps one 44 px row for fullscreen, the colony
preset, Travel and More. More reveals the secondary controls; Escape/click
closes them. Mobile game actions continue to measure the live dock height.
Chrome touch emulation at 320/390/720 px passes bounds, overlap, expansion,
weather toggles and the Travel menu; wide desktop controls remain visible.
Independent images confirm the improved view of the legs. Jump/Gyro still
overlap a small part of the right knee; this is a bounded remaining overlay,
not a reason to spend the whole night on HUD polish. 698 tests/build passed.

## Third increment — XR pose adapter (01:13)

Grounded XR uses the current local-floor viewer and grip poses projected into
the rotating colony. The camera, controller spaces and physics stay unchanged.
The head projection drives the inferred body/feet; crouching lowers only the
pelvis. Left/right palms stay on grip centres, with bounded arm IK; missing
tracking hides the affected limb, and extreme reach retains the true hand
position without stretching a sleeve across the view. XR entry/exit resets gait
anchors. The authored model's +Z-forward naming needs a side swap at the XR
boundary; the same correction hides the correct arm behind the coffee grip.

Deterministic pose injection confirms both palms within 0.01 mm of targets,
standing/crouching, one missing hand, extreme reach and restoration of authored
bone lengths on flat-screen return. Independent images show the expected sides
and no clear penetration. The crouched view hides the toes behind the knees;
actual XR framing, latency, body proportions and comfort still need hardware.
The full coffee regression also passes. This is a grounded body prototype;
free-fly/driving body poses and inferred physical body collisions remain open.

## Fourth increment — nearby street residents (01:37)

The wider street network now gets a small persistent nearby population: eight
on desktop and four on phone/Quest presets, in six clothing palettes and modest
body-size variants. Pavement routes stop short of intersections, pause/turn at
their ends and stop approaching the player within 1.65 m (3.5 m for a rover).
They do not have physical colliders or a global crowd simulation. Route pieces
are generated only near the player; a first city-wide design would have stored
178,034 route objects and was replaced before committing. Sampled routes from
the real 18k-building plan avoid road and building footprints.

The Blender resident gets eyes and overlapping knee/elbow/waist volumes.
GLB is 147,832 bytes and body topology remains under 5k triangles. Export now
uses the active scene, checks actual GLB roots/images/size, and writes only the
resident scene to its source blend. This fixes an observed export contamination
from unrelated GUI scenes. First-person head/cuff visibility and tracked palms
pass regression after the model change. Whole suite: 709 tests and build pass.

Desktop day and portrait phone-preset night checks confirm bounded population,
approach/stop/resume with normal player movement, and no page errors. Independent
image review found no obvious wall/road penetration; close phone framing led to
the increased stop distance. Night silhouettes remain dark, and the simplified
character art/foot planting are not a finished animation system. Hardware phone
and XR performance remain unverified.

## Fifth increment — parked vehicle lamps (01:40)

Street inspection exposed a coloured checker strip across parked cars. Their
shared traffic geometry includes extra head/tail-light boxes; parking applied
the single car-palette material to those boxes as well. Parking now owns a
geometry copy restricted to the original body group, keeping authored unlit
lamps and leaving moving traffic's emissive lights intact. The source pack and
shared material survive disposal; owned copies are released. Same-view day/night
comparisons remove the atlas pattern without additional draws. This is a small
scene-wide repair, not a vehicle redesign.

## Sixth increment — destination framing and arrival guidance (01:53)

The whole-colony tour exposed stale cards at Old Town/Exterior and boot-reveal
pitch overwriting travel orientation. Both destinations now replace the previous
location card; explicit look changes and entry to flight cancel the reveal.
Overlook arrives looking down the avenue with local vertical, while natural
jumps preserve gaze. Exterior uses an oblique viewpoint sized to the hull's
radius/length and the smaller viewport angle; rings now show their opening.
Mirror wings can extend beyond the hull framing. Inertial-rest positioning is
preserved. Street walkers no longer refresh outside the hull.

713 tests/build pass, including hull projection across three sizes and three
aspects, inertial rest, and reveal cancellation through real control updates.
`colony-tour.mjs` records the main travel stops in all four presets plus Izma
day/night and portrait phone; it asserts the current location card. This is
browser/profile coverage, not headset or mobile hardware validation.

## Seventh increment — finite atmospheric haze (02:00)

Exterior rays previously counted vacuum as floor-density air, washing the hull
into a sky-coloured capsule. CPU/GLSL now clip the ray to the radial shell and
axial end planes before applying the existing eight midpoint samples. A long
vacuum lead-in leaves the interior air column unchanged; the outer hull has no
foreground haze. The legacy Gaussian branch uses its existing formula over
the clipped air length. The ring's internal representative-air approximation
is retained. Interior-to-interior segments take a cheap unchanged fast path.

716 tests/build pass, including empty vacuum paths, far observers, reversal,
axial clipping and the established interior contrast/closed-form checks.
All-preset exterior and Izma day/night/phone interior probes show no page or
shader errors. The sampled scenes still report 60 fps on the local M1 Pro;
this is not an on-device GPU budget certification.

Independent tour review flags Izma's long mirror wings outside the hull-based
framing and bright objects behind the translucent guide text. Next: include
the complete mirror envelope in Exterior and protect guide readability. Keep
the wider scene/movement survey moving after those bounded repairs.

## Eighth increment — complete exterior and stable sky (02:13)

Exterior distance now includes the entire 45-degree mirror envelope and uses
the narrower viewport angle. The star shell and sun follow the active eye in
the sky's coordinate frame, expanding behind the complete scene and extending
the camera far plane as needed. Their apparent direction and size remain fixed;
the habitat air glow stays anchored to the colony. Guide backgrounds are more
opaque and touch clearance lifts only actual overlap, keeping portrait cards
below the colony rather than across it.

A 12-second hold exposed a separate orientation defect: the observer was at
inertial rest but the desktop/touch view rotated with the colony, drifting well
outside the portrait screen. Exterior now counter-rotates the view's reference
frame. Mouse/key look and accumulated roll still work; this is a retained
heading, not continuous target tracking. Other travel targets and grounding
restore the original view behavior; XR head-look is unchanged.

720 tests/build pass. Tests cover mirror-tip projection over a rotation at
three aspects, sky directions/occlusion distance at remote positions, repeated
frame wraps and manual look while holding an inertial heading. All four preset
exteriors and Izma day/night/portrait pass the real-camera centre check; Izma
also passes after 12 seconds. Independent image review passed Izma framing and
guidance but caught the small Playground's port beyond the hull frame. The
envelope now also includes the actual port dimensions and human-sized shuttles;
authored mesh bounds are checked through their approach cycle. Next: broader
travel/streaming soak and everyday
street interactions, without turning this into an exterior-only redesign.

## Ninth increment — repeated-travel resource release (02:34)

The same-page soak exposed 41 unreleased WebGL buffers per complete four-preset
tour after warm-up. Several older Cityscape paths and Spaceport released only
geometry, omitting InstancedMesh.dispose, which separately releases instance
transforms/colours. Near/far building replacements, traffic, trees/beacons,
expressway pylons and port navigation lights now release both owners while
retaining shared materials. A port rebuild test protects that ownership split.

721 tests and the production build passed for this increment. Before/after
Chrome runs each performed 24 preset rebuilds and 72 travel actions over about
8.4 minutes without reloading the page. The served dist tree was held fixed
during each run. Between cycles 2 and 5 every sampled preset gained 123 buffers
before the fix and zero afterward. Textures, programs, frame/render buffers
and vertex arrays also have zero growth over that interval after the fix;
no page/shader/context-loss errors occurred. GC-retained JavaScript heap still
varied by 0.26–0.34 MiB. These are resource counts, not GPU byte measurements,
frame-rate certification, proof of all leaks being gone, or a confirmed cause
of the user's earlier transient slowdown. The reproducible probe is
`qa/neighborhood-life/travel-soak.mjs`, with `EXPECT_STABLE=1` for the plateau gate.

Public-bench work was prepared in source while the fixed dist build ran the
comparison; it is a separate uncommitted increment at this checkpoint.

## Tenth increment — usable public benches (02:46)

Both existing plaza benches now support the shared Sit/Stand up interaction,
correct lower seat/eye height and planted shoes. Their four physical parts
share the visible placement, and narrow furniture has an exact support margin
so walking beside it does not float the body. The indoor population continues
using only indoor seats; both public seats remain available. No render batches
were added, and the decorative deck bench remains outside this increment.

724 unit tests and production build pass. The browser probe passes all eight
seat/exit/collision cases over Izma, Cooper, Elysium and portrait/night. Existing
indoor seating and the full coffee route also pass with zero page errors.
Independent image review confirms readable Sit/Stand up controls and no clear
penetration; knees obscure much of the shoes, particularly at night. On a direct
bench-link boot, the temporary introduction also obscures part of the seat.
These visual limits remain documented rather than expanding into a character
art overhaul. Next: cross-cutting input interruption and navigation reliability.

## Eleventh increment — input interruption and keyboard focus (02:52)

Lost key/pointer releases on window blur, page hiding or field focus now cancel
desktop movement, touch stick/jump/brake and queued jump/throw/drive intent.
Cancelled right drags cannot cycle a projectile on a later stray release.
Text fields and browser shortcuts retain their keys; Space/Enter on a focused
button activates that control, and Tab can reach the dock. Movement still works
after clicking a button. Existing physical velocity and coasting roll are kept.

729 tests and production build pass, including event cancellation, renewed input,
pointer ownership, field focus, listener disposal and preserved roll momentum.
Before/after browser probes show 1.18 m of continued walking over 0.7 seconds
before the fix and about 0.01 m of ordinary contact settling afterward, on both
desktop and touch paths. Fresh movement, typing without world actions, native
Rain-button activation, Tab focus, cancelled touch/queued jumps and car coasting
all pass with no page errors. A released accelerator lets the rover slow from
about 11.1 to 8.2–8.7 m/s rather than imposing a brake or retaining the throttle.
These are browser-delivered interruption events, not a mobile OS lifecycle test.
Next: connect junction signals to ambient traffic and survey the resulting flow.

## Twelfth increment — signal-controlled street traffic (03:29)

Both axes of arterial junctions now have correctly facing three-lens signal
heads, a shared 32-second vehicle/render clock, alternating green/amber phases,
all-red clearance and painted approach stop lines. Ordinary ground traffic
brakes before those lines and resumes on green; nearby cars can clear on amber.
The 2.7 m centre setback also clears the longest 5 m truck's scaled nose.
Existing instanced batches carry the extra arms/lenses/paint without new lights.
Empty-plan switches now clear the previous intersection instances.

Natural-flow observation caught two cars overlapping near block boundaries:
contiguous avenue artwork was being treated as independent short repeating
routes. Continuous same-width/profile spans now form one route, lane following
also respects the repeating endpoint, and circular roads exclude the artwork's
seam overlap from their travel length. Real road gaps remain separate.

737 tests and the production build pass. Eight controlled day/night, road-axis
and direction cases stop at 2.7 m and travel about 8.1 m after green. Independent
image review verifies attached signal heads and readable painted lines; exact
motion/distances come from runtime probes. Two 85-second normal-fleet probes
(420 desktop Izma / 120 phone-tier Cooper vehicles) detect 22 line entries,
zero red entries, zero overlaps and matching lamp/traffic clocks. Minimum
observed same-lane centre gaps are 5.2 / 10.58 m. The pedestrian crossing has
zero unsafe samples and the priority-turn regression waits/releases correctly.
The older crossing probe also logs unrelated analytics CORS/HTTP errors; the
new signal and turn probes have no page errors. These are sampled local runs,
not full traffic-network or target-hardware certification. Player rovers remain
manually driven; the authored neighbourhood turn keeps its existing yield rules.

Next: make everyday places reachable from the normal travel controls and repair
keyboard menus and travel while driving. Dropdown source work is prepared but
excluded from this traffic commit.

## Thirteenth increment — reachable places and reliable menus (03:44)

Places now exposes the current city's café, courtyard, apartment and market
street. Compact screens keep them inside Travel's Street life section. The list
is rebuilt only when the city plan changes and omits unavailable destinations.
Arrivals use real entrances; Izma prefers the authored café, with room to see
the doorway rather than starting against the service counter. Brief location
cards explain the next step, and the initial welcome is shorter.

Travel now detaches the old rover/bench, restores ordinary body contact and
cancels held movement/jump/throw before placing the new body. A before probe
confirmed that Exterior previously left driving active and returned to the car.
Both desktop and phone paths now stay outside, return to Surface, and leave a
public bench for the café without retaining the sensor/seat attachment.

Dropdowns support native Space/Enter, arrows, Home/End, Escape with focus return,
visible focus and scrolling in short viewports. Pointer-down dismissal still
cannot reopen on the finishing click. Independent image review caught Jump
overlapping a phone menu; a subsequent real click also hit that obstruction.
Gameplay overlays now sit below the popup/backdrop layer. Repeat image review
and elementFromPoint checks confirm the fix. All menu items keep 44 px height.

739 tests and the production build pass. Twenty-four desktop/phone visits across
four presets and in-page preset rebuilds retain contact and their arrival pose;
entrance walking advances more than 3 m without raising the player or detaching.
Four viewport sizes pass keyboard, focus, viewport and tap-target checks. The
existing mobile dock suite passes 320/390/720 px and 1280 px, keeping its compact
height at 44 px. No page errors were reported. Static image review confirms
legible entrance views; Cooper's café remains comparatively dark. These are
browser checks, without phone/Quest hardware validation.

Next: survey continuous street movement, streaming cost and state continuity.

## Fourteenth increment — continuous street streaming (04:23)

Walking along the axial avenue exposed a separate state defect: each detail
refresh stopped every car for a frame (`advanceTraffic(dt=0)` returned speed
zero), and clipping/reseeding routes moved cars and changed their models.
A zero-time refresh now preserves motion. Physical roads are compiled before
visibility clipping, cars use per-road identities and random streams, and their
world position, velocity, model and fallback paint survive window changes.
Changing road quotas retires a distant slot before removing a car within 200 m.
New/recycled cars require 6.2 m of free lane, including the repeating seam.
The fleet can briefly stay below its cap while such a slot is occupied. It
still follows bounded repeated road spans, not citywide pathfinding.

Fine focus updates also retain unchanged room plans and their GPU resources,
and avoid invalidating the whole building layer for the same interior set.
The per-model car matrix capacity is now the fleet cap, so stable variants no
longer depend on array order; this adds about 131 KiB of matrix capacity per
CPU/GPU copy at the 420-car desktop cap without extra draw calls.

Same-route six-minute comparisons on this Mac: before, each of 76 focus
refreshes produced hundreds of speed resets and many positional jumps. After,
zero retained-car jumps, speed resets, model changes or disappearances within
150 m were measured. Near-batch median work fell from 15.4–16.4 ms to 1.8–2.2 ms;
coarse room changes still cost up to about 21 ms. Median frame time stayed at
16.7 ms, and a first-leg frame near 167 ms remained. This is not an all-hitches
fix or a phone/Quest performance claim. Live GPU buffer counts returned to
727/725 at one endpoint and 765 at the other, before and after; continuous
walking did not establish a leak. The last spawn-spacing change is additionally
covered by the focus matrix and a shorter final walk.

Three actual city plans, with changes along both surface axes and a coarse
320 m focus change, pass continuity and non-overlap checks. Eight controlled
signal cases stop 2.7 m before the paint and move about 8.1 m after release.
Natural traffic observed 26 Izma entries in 85 s and 5 Cooper entries in 180 s,
with zero red entries, overlap or clock disagreement; minimum gaps reach 5.2 m.
The first 85 s Cooper sample had no stop at a red light and was insufficient,
so its duration was extended without relaxing the gate. The pedestrian probe
records zero unsafe overlaps/66 stopped samples, and the turn holds at 90 m
then resumes past 111 m. Unit suite at this increment: 744 tests pass; build
passes. Probes: `street-streaming.mjs`, `traffic-streaming.mjs`, existing
`intersection-signals.mjs`, `traffic-signal-flow.mjs`, `traffic.cjs`, `junction.cjs`.

Next: remove overlapping coplanar facade/windows in the original Blender city
block asset; add local roof occlusion for rain while preserving open courtyards.
Both defects are visible in current browser captures. The latter already has
an isolated, unused planning helper prepared for the next increment.
