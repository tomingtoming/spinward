# Spinward WebXR UI and scenery checks

Run the real VR entry, wrist laser and controller trigger through
[playwright-webxr](https://github.com/tomingtoming/playwright-webxr). These are
emulated sessions in Chrome, not measurements from a physical Quest.
The current locked version is **0.3.0** (updated at the user’s direction on 2026-09-13).

## Run

Install the locked development dependencies with `bun install --frozen-lockfile`.
Build with `bun run build`, then serve that build using `bun run preview` on an
available local port. Check the server's printed URL and ownership before using
an existing preview. Keep the build unchanged during a run.

```sh
SPINWARD_URL=https://127.0.0.1:<preview-port> bun run test:xr
```

The suite uses installed Google Chrome by default. `XR_BROWSER_CHANNEL` can
select another installed Playwright browser channel. HTTPS certificates from
the local preview are accepted. A WebGL2 probe rejects software rendering before
loading the colony. Use a host with a working hardware GPU; this suite does not
install a browser, start a server, choose a fixed port, or kill existing ones.
The fixture closes its own browser when finished.

`*.xr.mjs` deliberately keeps Playwright tests out of `bun test` discovery.
They run sequentially, with no retries. Captures, raw wrist textures, evidence
JSON and failure traces go into ignored `qa/webxr/artifacts/`; Playwright clears
that directory on the next run. Reviewed comparison captures may be copied to
ignored `qa/webxr/evidence/` before another run.

## Coverage

- Desktop Menu → VR button, and Quest user-agent first-entry CTA → subsequent
  entry from Menu. The Quest user agent checks app routing only.
- Granted immersive-vr session, both input sources, hidden flat dock/notice,
  visible wrist panel, and the actual rendering layer and eye viewports.
- Target-ray aiming and trigger selection: Places, directions to the café,
  cancel, rain on/off, Controls, Back. Directions must not teleport the player.
- Head roll 0/±25°: wrist transform stays fixed relative to the tracking rig;
  actual Back/Places selections still work.
- Disabled Park and blank panel padding consume trigger input without spawning
  a ball. Moving off the panel restores the world ray and throwing.
- The active introductory card and generic grab rays yield to wrist focus.
- Exit, regain the flat dock, re-enter, use the wrist, and exit again without
  browser errors or failed HTTP resources.

The fixture reads existing `?debug` layout/state probes to aim and observe. It
never calls app click handlers, writes gameplay state, or fabricates XR state.
Input travels through IWER poses/buttons, Three's controller events and app
raycasts. Session termination uses `xr.endSession({ sessionId, timeout })`;
app cleanup and the expected session's end event remain separate assertions.

Mono uses 1280×960; stereo uses 2560×960, so each eye has the same 1280×960
viewport. Halving a 1280×960 canvas had made each eye an unusually narrow
640×960 portrait view and clipped the wrist at its edge; that was a fixture
framing issue. Head/controller poses otherwise match between the runs.

## Integration findings — 2026-09-12

Original integration versions: playwright-webxr 0.1.0, @playwright/test 1.63.0,
IWER 2.4.0. Production dependencies are unchanged.

The original build reproduced a disabled Park press spawning a ball (0 → 1).
UI ownership had depended on an enabled hovered button, so disabled buttons and
padding leaked input to the world. Ownership now uses a fresh hit on the whole
panel, including at selectstart before the next frame updates hover. Generic
grab rays also respect ownership. The introductory card yields while aiming at
the wrist, with a 1.5-second grace period between targets.

Independent image review caught Controls text crossing its columns, a Places
footnote cut by the bottom border, and a preset name behind Directions. Long
bindings now wrap, footnotes fit inside the panel and the shared header makes
room for Directions.

XR exit intermittently stopped Rapier with `RuntimeError: unreachable` in
`World.step()`. Timing probes changed reproducibility and did not capture the
failing timestep; the exact trigger was not established. The loop could pass a
negative timestep when clocks regressed. It now resets its clock on XR session
boundaries and guarantees a positive bounded physics step; a unit regression
covers repeated/backward timestamps and both session transitions. The E2E exit
and re-entry checks remain in the suite to detect a recurrence.

## Verification result — 2026-09-12

- `bun test`: 815 pass, 0 fail; `bun run build`: TypeScript and production build
  pass. Existing Vite large-chunk warning remains.
- Both E2E routes passed twice on the corrected build: four test executions,
  eight immersive sessions and eight successful exits; no browser errors or
  failed HTTP resources. The second run also asserts eye viewport dimensions.
- Wrist-to-tracking-rig matrix error stayed below 1e-12 at 0/±25° head roll.
- Independent visual review passed Controls wrapping, Places footnotes/header,
  wrist attachment, focus clutter suppression and complete panels in both eye
  viewports. Raw 720×700 wrist textures were also inspected.
- Reviewed images are saved locally as `qa/webxr/evidence/final-*`; the latest
  generated execution evidence remains under `qa/webxr/artifacts/`.

## 0.2.0 integration — 2026-09-12

At this integration, the dependency pinned **playwright-webxr 0.2.0**, with Playwright
1.63.0 and IWER 2.4.0 unchanged. This is a real application integration run,
not a test of every package failure branch.

- Stereo and 64 mm IPD now use the public fixture options. This removed our
  direct writes to `window.__xrDevice.stereoEnabled` and `.ipd`.
- `xr.diagnostics()` replaced the custom session/rendering probe, and records
  package/runtime/browser version, hardware GPU, active session, both viewports
  and canvas/base-layer dimensions. Its explicit null/reason fields corrected
  our earlier claim that unavailable projection layers meant zero layers.
- `sessionCursor()` and session-ID-scoped event waits distinguish both entries
  and exits. `sessionMode()` must become null after each end. The former check
  counted only the first exit; the new check requires both ends and distinct IDs.
- `xr.screenshot(..., {canvas, timeout, metadata:true})` records and checks the
  actual pixel dimensions, capture kind and active session ID. PNGs and raw
  panel textures still get independent visual inspection.
- Both routes passed on the initial migration and again after correcting the
  Controls summary found during image review: “B = menu” conflicted with its
  own binding table. The summary now says R B travels and L B recentres, and
  the corrected wording fits the panel in both routes.

Latest UI verification: two tests, four immersive sessions, four exits, zero
browser errors or failed HTTP resources. Apple M1 Pro / ANGLE Metal, Chrome
152.0.7977.83; mono 1280×960, stereo 2560×960 with two 1280×960 eye viewports.
Wrist/rig roll error below 1e-12. Review captures are retained locally in
`qa/webxr/evidence/0.2.0-20260912/` (ignored). The active suite's output directory
is disposable and may hold a newer execution.

Feedback from use: the new APIs eliminated our ad-hoc probing and made unknown
rendering capabilities explicit. No 0.2.0 package failure was observed in these
successful flows. A public session-ending helper could remove the last direct
emulator access, currently the genuine `XRSession.end()` call. Diagnostics are
clear about their limits; they do not prove native headset/compositor behavior.
Failure cases such as a rejected session, a missing canvas, or a zero IPD stereo
override were not exercised by this application suite.

## Rooftop scenery — 2026-09-12

`roofs.xr.mjs` adds an inspection of the original Blender plant room under the
Quest city budget. It enters VR through the actual desktop Menu, waits for the
introductory card to finish, and captures both eyes at 0/±25° head roll. The
room's instance matrix must stay fixed in the world, its centre stay in view,
and capture metadata match the active session and 2560×960 stereo canvas.
The real session then ends and the session-ID-scoped end event is checked.

The combined suite passed three tests: this scenery check and the two wrist
routes, totalling five immersive sessions and five exits. No browser errors
were observed. Hardware was Apple M1 Pro / ANGLE Metal, Chrome 152.0.7977.83.
Independent image review confirmed that the room remains attached to its roof
in both eyes and through head roll. Reviewed captures and diagnostics are
retained locally in `qa/webxr/evidence/roofs-20260912/` (ignored).

This scenery view uses a public free-flight share URL with zero spin for a
repeatable inspection; it does not test rooftop walking or native headset
comfort. Desktop walking with ordinary spin is checked separately by the
`roof-walk` view in `qa/neighborhood-life/old-town-block.mjs`. The accompanying
production change passed all 822 unit tests and the TypeScript/production build.

## City massing — 2026-09-12

`skyline.xr.mjs` adds a district view using the Quest city budget and the same
public share pose as the desktop comparison. It enters VR through Menu, waits
for the introductory card, and captures stereo at 0/±25° roll. Thirty nearby
buildings' actual instance matrices must remain unchanged. It verifies the
0.2.0 diagnostics, both 1280×960 eye viewports, screenshot/session metadata and
the session-ID-scoped exit. No gameplay handlers or placements are written.

The combined suite passed **four tests, six immersive sessions and six exits**
with no browser errors: rooftops, city massing and the two wrist routes. Unit
verification passed 823 tests and the TypeScript/production build. Reviewed
city captures and diagnostics are retained in the ignored directory
`qa/webxr/evidence/skyline-20260912/`. The district uses zero spin in free flight
for a repeatable visual inspection, not as a native locomotion/comfort test.
Hardware and rendering limits are the same as the rooftop run above.
Independent review confirmed the major masses in both eyes at all three rolls.
The lower Quest building budget remains visibly sparser than desktop; preserving
shape does not imply equal density. The edge-on wrist in the district capture
is not a readability check; wrist interaction and panel text have separate tests.

## Limits

The integration run uses Apple M1 Pro / ANGLE Metal, Three.js r180 and
XRWebGLLayer (base layer present; renderState.layers is unavailable, so
projection-layer count is unknown). IWER's mono mode
still exposes left/right views, but the right viewport has width zero; stereo
uses two equal viewports with 64 mm eye separation. Tests assert those view
properties rather than assuming one viewer view in mono mode.

This does not verify native Quest rendering, compositor layers, multiview/MSAA,
hand tracking, performance, stereo comfort, readability through lenses, or
motion sickness. Those require a physical headset. Review wrist text in the
saved textures as well as the full scene; an emulator screenshot alone can hide
small typography defects.

## Covered public walk — 2026-09-12

`underpass.xr.mjs` adds the actual downtown covered walkway at ground level,
with stereo, 64mm IPD and head roll 0/±25°. The public layer and plan remain
fixed in the rotating colony; the ground stays at 0.34m, below the 18m road
deck. Diagnostics and screenshot metadata agree on two 1280×960 views, a
2560×960 canvas and the active session ID. Entry and exit use the real app/runtime.

All five tests passed: seven sessions and seven successful exits, including the
existing wrist/controller/exit/re-entry routes and roof/skyline checks. Hardware
preflight: Apple M1 Pro / ANGLE Metal, Chrome 152.0.7977.83, playwright-webxr
0.2.0. Evidence is retained in `qa/webxr/evidence/underpass-20260912/` (ignored).
This is emulation; native headset performance, comfort and seated VR are not
verified by this increment. Raised-paving sit/stand input and the 1.57m seated
eye height were checked separately in ordinary browser locomotion.

Independent image review caught an off-camera scenery test: grounded XR entry
faces along its own tracking heading, not the desktop URL's look quaternion.
The fixture now aims the head from the real tracking transform and checks that
points 10m and 35m down the path project inside the camera for every roll.
The corrected scenery test passed again on the same build (six test executions,
eight sessions/exits across the full suite and this repeat). The retained
underpass images/diagnostics were replaced with the correctly framed captures;
this was a test-framing defect, not a playwright-webxr package failure.


## Riverside district — 2026-09-13

`river.xr.mjs` enters through the actual Menu/VR route at the 1.2m lower bank,
using the Quest city budget, stereo 64mm IPD, and head roll 0/±25°. The fixture
aims from the real tracking frame and asserts that bridge/promenade points
remain on camera. The district matrix and ground height must stay unchanged;
diagnostics and screenshot metadata must agree on the session and two
1280×960 eyes. Exit is checked against that session's cursor and ID.

The complete 0.2.0 suite passed **six tests, eight immersive sessions and eight
exits** in 1.7 minutes, including both real wrist/controller routes, exit/re-entry,
roofs, city massing and the underpass. Hardware was Apple M1 Pro / ANGLE Metal,
Chrome 152.0.7977.83. Evidence is retained in
`qa/webxr/evidence/river-20260913/` (ignored). Independent image review confirmed
the water, banks, paths, railings and bridge in both eyes at every roll, with no
observed separation or floating parts. The bridge deck/upper junction is
occluded at this low viewpoint and was reviewed separately in desktop captures.
Native Quest performance, comfort and VR seated interaction remain unverified.

## Rain shelter — 2026-09-13

The covered public walk now runs with `&rain`, asserting a full rain field,
shelter one and the public-cover sound multiplier .45. It retains the actual
Menu/VR entry, Quest city budget, stereo 64mm IPD, head roll 0/±25°, on-camera
path probes, fixed terrain and session-scoped exit checks. Audio state is
measured; listening through a headset is not part of this test.

The final complete 0.2.0 suite passed **six tests, eight immersive sessions and
eight exits** in 1.7 minutes on Apple M1 Pro / ANGLE Metal, Chrome 152.0.7977.83.
The rainy underpass has two 1280×960 eye views and a 2560×960 canvas, with
matching screenshot/session metadata and no recorded page errors. Evidence
is retained in `qa/webxr/evidence/rain-20260913/` (ignored).

The initial attempt passed five tests and failed the river fixture because
it compared 1.2000000000000002 with 1.2 metres exactly. Ground height now uses
sub-micrometre tolerance; the district matrix and asset readiness still require
exact equality. This corrects test precision, not terrain or a 0.2.0 package
defect. The initial trace remains in `qa/webxr/evidence/rain-initial-20260913/`.
Native headset rendering, performance, sound and comfort remain unverified.

Independent review confirmed dry near paving/ceiling, visible outdoor rain and
connected walkway/columns/rails in both eyes at all three rolls. A suspected
fine dotted paving seam is present in both earlier golden sets as well; it
appears brighter in rain and was not a new geometry defect. These findings
apply to the captured views, not every frame or every roof in the colony.

## Residential balcony life — 2026-09-13

`balcony.xr.mjs` selects a real furnished apartment in the Quest city budget,
enters through the actual Menu/VR route and uses 64mm stereo with head roll
0/±25°. The actual chair instance must remain fixed to its building and project
inside the camera at each pose. Screenshot metadata must agree with the active
session and the two 1280×960 eyes. Exit uses that session's cursor and ID.

The complete playwright-webxr 0.2.0 suite passed **seven tests, nine immersive
sessions and nine exits** in 2.2 minutes, including the wrist/controller actions
and re-entry routes. Hardware preflight: Apple M1 Pro / ANGLE Metal, Chrome
152.0.7977.83. The served production build stayed fixed throughout. Evidence is
retained in `qa/webxr/evidence/balcony-life-20260913/` (ignored).

Independent full-image and equal-scale crop review confirmed the chair/table
in all six eye/roll views, fixed relative to the same windows, partitions and
guard. Visible window bars remained present. Hidden furniture feet and pot
bottoms are not judged from these images; metric geometry and live attachment
matrices are checked separately by the unit/desktop probes. This adds exterior
scenery, not a new traversable balcony or seat interaction. Native Quest
rendering, performance and comfort remain unverified.

## Riverside traffic — 2026-09-13

`river-traffic.xr.mjs` enters through the actual Menu/VR route on the bridge,
with the Quest city budget and 64mm stereo. It waits for ordinary traffic to
arrive, without relocating a vehicle or advancing the city clock. At head roll
0/±25°, the real car instance must agree with its road pose, remain inside the
camera and fleet budget, and advance between captures. The measured movement
was about 5.25m at 5.2m road height. The two 1280×960 eye views, 2560×960 canvas
and screenshot metadata must agree with the active session. Exit uses that
session's cursor and ID.

The complete playwright-webxr 0.2.0 suite passed **eight tests, ten immersive
sessions and ten exits** in 2.6 minutes, including wrist/controller interaction,
exit/re-entry, balconies, river terrain, roofs, skyline and the rainy underpass.
Hardware preflight: Apple M1 Pro / ANGLE Metal, Chrome 152.0.7977.83. The served
production build stayed fixed throughout. Full-suite evidence is retained in
`qa/webxr/evidence/river-traffic-20260913/` (ignored).

Independent full-image and equal-scale crop review found the car in both eyes
at all three rolls, with no obvious floating, road penetration, guardrail
intrusion or opposite roll. Bridges, paths and railings remained present.
Separate wrist images from the same suite retain the PLACES panel, labels and
Courtyard selection through the three rolls. Exact tyre contact and every
intermediate frame are not established by these images. Native Quest rendering,
frame rate and comfort remain unverified.


## Spaceport berths — 2026-09-13

`spaceport.xr.mjs` enters through the actual Menu/VR route at a public free-flight
pose outside the docking end, using the Quest city budget and 64mm stereo. It
waits for the Blender collars, aims from the real tracking frame and checks the
loaded near LOD. The ship and collar world matrices must stay unchanged at head
roll 0/±25°, and the connection must remain inside the camera. Screenshot
metadata agrees with the active session and the two 1280×960 eye views.

The complete playwright-webxr 0.2.0 suite passed **nine tests, eleven immersive
sessions and eleven exits** in 2.9 minutes, including both wrist/controller
routes and exit/re-entry. Hardware preflight: Apple M1 Pro / ANGLE Metal,
Chrome 152.0.7977.83. The production build stayed frozen throughout. Full-suite
evidence is retained in `qa/webxr/evidence/spaceport-berths-20260913/` (ignored).
This is emulated rendering of stationary berths, not physical Quest performance,
boarding, pressure-door interaction or a docking manoeuvre.

Independent stereo review confirmed the full shuttle, nose/collar/base
connection and surrounding arms in both eyes at all three rolls. Ship and
structure roll together, with no observed separation, burial, opposite roll or
one-eye disappearance. Equal-scale crops cover the berth and the connection.
Precise contact dimensions, exact roll angles and native headset behaviour are
not established by these images. The Quest-budget desktop comparison also
retains both occupied and empty berths, including the small habitat; differences
in navigation-light phase and reduced bloom do not indicate missing geometry.


## Crosswalk directions (2026-09-13)

`ui.xr.mjs` also enters VR on the central avenue pavement, selects Central Square through the actual wrist target ray and trigger, checks the painted-crossing route and approach hint, captures stereo at 0/±25° roll plus the raw wrist texture, then cancels and exits. The instruction uses a bright 28px two-line area with the destination on a separate line. It does not interpret vehicle signals as pedestrian permission.

The complete suite passed 10 tests / 12 sessions before the final wrist typography adjustment. The three affected UI tests were then repeated on the final build: 3 tests / 5 sessions, including both exit/re-entry paths. Scenery was unchanged by that adjustment. Evidence is under `evidence/crosswalk-directions-initial-20260913/` and `evidence/crosswalk-directions-final-20260913/`. These are hardware-GPU Chrome emulation results; physical Quest legibility and performance remain unverified.

## Signal hoods and support — 2026-09-13

`signals.xr.mjs` enters through the actual Menu/VR route near an existing signal,
using the Quest city budget and 64mm stereo. It waits for the Blender asset,
aims in the real tracking frame and verifies that the head and near visor
instances stay fixed at head roll 0/±25°. The head's upper and lower bounds
remain inside the camera. Screenshot metadata agrees with the current session
and two 1280×960 eye views. Exit is checked with that session's cursor and ID.

The complete playwright-webxr 0.2.0 suite passed **11 tests, 13 immersive sessions
and 13 exits** in 3.2 minutes, including both controller/wrist routes and
exit/re-entry. Hardware preflight: Apple M1 Pro / ANGLE Metal, Chrome
152.0.7977.83. The production build stayed fixed throughout. Evidence is kept in
`qa/webxr/evidence/signal-visors-20260913/` (ignored).

Independent review of both eyes at all three rolls found the circular lenses,
hoods and short hanger connected to the arm, rotating with the street. No
obvious floating, large missing geometry or one-eye disappearance was found in
these images. Fine edge aliasing remains. Precise contact is checked separately
with geometry rays; continuous head motion and native Quest performance,
legibility and comfort remain unverified.

## Covered walking directions — 2026-09-13

The covered scenario in `ui.xr.mjs` enters VR inside the existing underpass,
selects Central Square using the real wrist target ray and trigger, verifies a
route through the supported clear strip and the `Covered walk` hint, then
cancels and exits. Selecting directions must not move the player. Captures use
64mm IPD, two 1280×960 eye views and 0/±25° head roll, plus the raw wrist texture.

The full playwright-webxr 0.2.0 suite passed **12 tests, 14 immersive sessions
and 14 exits** in 3.3 minutes, including both entry/re-entry paths. Hardware
preflight: Apple M1 Pro / ANGLE Metal, Chrome 152.0.7977.83. The production app
build stayed fixed throughout. Evidence is retained in
`qa/webxr/evidence/covered-directions-20260913/` (ignored).

The first run passed the new wrist scenario but the existing underpass test
rejected a ground-height difference of `0.33999999999999997` versus `0.34` after
the floor changed to shared sloping triangles. Geometry, transforms and counts
still use exact equality; sampled height drift now has a sub-nanometre bound.
That run is preserved separately under `covered-directions-20260913-initial/`.

Independent image-only review used that first run's unchanged app build:
the raw texture and both eyes at all three rolls retain the destination, hint
and buttons without clipping, overlap or one-eye disappearance. The visible
floor and bench bases have no obvious holes or penetration; the railing is
outside the wrist capture's view. The small place name and secondary destination
remain thinner than the main hint. Physical Quest readability, performance and
comfort remain unverified. Normal desktop W input separately traversed the
entrance, covered link and exit; see `qa/neighborhood-life/covered-directions.md`.

## Distant night districts — 2026-09-13

`night-districts.xr.mjs` enters through the real Menu/VR path at a free-flight
view of a secondary district, with the Quest city budget and 64mm stereo. It
aims at the district in the real tracking frame and requires that target to
remain in the camera at 0/±25° head roll. The installed shell texture identity,
size, upload version, fade distances and city transform stay fixed. Captures
must belong to the current session and contain two 1280×960 views; exit waits
for that session's cursor and ID.

The night-bake change uses the replacement buildings' existing uses, glazing,
occupancy and district gain. It adds no light or render pass. Desktop comparison
separately checks that the city plan, daytime bake and per-view mesh counts
match the baseline. The near-window GLSL remains byte-identical. This test
checks emulated world attachment, not physical illumination, hardware Quest
performance or whether a user can identify building uses at that distance.
Wrist interaction, controllers and exit/re-entry are exercised by the existing
UI scenarios in the full suite.

The complete playwright-webxr 0.2.0 suite passed **13 tests, 15 immersive
sessions and 15 exits** in 3.6 minutes. Hardware preflight: Apple M1 Pro / ANGLE
Metal, Chrome 152.0.7977.83. The served build stayed fixed. Evidence is kept in
`qa/webxr/evidence/night-districts-20260913/` (ignored).

Independent stereo review found matching city lights, roads and window bands
in both eyes at all three rolls, with no observed one-eye disappearance or
lights detached from the world. The scenery view leaves the wrist panel at a
grazing angle and partly outside the frame; wrist legibility is not judged from
those images. Desktop comparisons show a subtle colour change with no obvious
daytime or nearby-window regression. Building use cannot be identified from
these distant images alone, and the road grid remains prominent at the Quest
budget. Native headset performance and comfort remain unverified.

## Old Town courtyard — 2026-09-13

`court.xr.mjs` enters the actual VR session with the desktop city budget, where
the certified court exists. Two reused Blender chairs remain in view at 0/±25°
head roll and their instance matrices stay fixed. Captures retain session IDs,
eye dimensions and runtime diagnostics. The independent image review checks
both eyes; this scenery scenario is not a VR seating or wrist-readability test.
The existing Quest UI entry/exit/re-entry checks remain in the full suite.

The suite passed 14 tests, 16 immersive sessions and 16 exits in 4.0 minutes on
Chrome 152.0.7977.83 / Apple M1 Pro / ANGLE Metal with playwright-webxr 0.2.0.
Evidence is preserved in `qa/webxr/evidence/court-life-20260913/`. No physical
headset measurement is implied.


## Riverside directions — 2026-09-13

The Outing wrist panel now includes Riverside. The new stereo UI scenario
enters VR on the bridge sidewalk at 5.34 m, selects Riverside with the real
controller ray and trigger, and checks that the route includes the actual end
ramp and the 1.2 m lower bank without moving the player. It captures the raw
wrist texture and both eye viewports at 0/±25° roll, then cancels and exits.
The eight-action panel and directions detail passed independent image review.

The full 0.2.0 suite passed 15 tests, 17 sessions and 17 exits in 4.1 minutes.
A later small paving correction at the ramp mouths passed a focused rerun of
river, river traffic and UI: 7 tests, 9 sessions and 9 exits in 1.8 minutes.
Both runs used separate fixed production builds, hardware ANGLE Metal on Apple
M1 Pro, Chrome 152.0.7977.83, and reported no page errors. Existing desktop and
Quest entry scenarios still cover exit and re-entry. These are emulated VR
sessions; the continuous walk to the bank used actual desktop keyboard input.
Physical Quest performance and comfort remain unmeasured.

Reviewed captures, diagnostics and logs are saved locally under
`qa/webxr/evidence/river-directions-20260913/`. Geometry, walking measurements,
initial failures and the paving re-review are in
[River directions](../neighborhood-life/river-directions.md).


## Bulkhead bays and cladding — 2026-09-13

`bulkheads.xr.mjs` adds far-wall and close-cladding stereo fixtures under the
Quest budget. Actual VR entry, 0/±25° head roll and session-ID-scoped exit use
0.2.0. The target must project inside the camera; mesh matrices, opacity,
non-emission, triangle count and the installed panel shader remain fixed.
Independent image review checks both 1280×960 eyes, with full-resolution
inspection for subtle cladding. These fixed free-flight material fixtures use
zero spin; ordinary gravity and wrist/controller operation remain covered by
the existing UI scenarios. They do not establish walking access to the wall.

The full suite passed **17 tests, 19 immersive sessions and 19 exits** in 4.2
minutes on Chrome 152.0.7977.83 / Apple M1 Pro / ANGLE Metal, with the production
build unchanged throughout. Both desktop and Quest-style UI entry paths still
exercise exit/re-entry. Evidence: `qa/webxr/evidence/bulkheads-20260913/`.
No physical-headset measurements are implied. Material topology, the corrected
oblique raster seams and retained dark-night limits are documented in
[Bulkheads](../neighborhood-life/bulkheads.md).

## Riverside residents — 2026-09-13

`river-walkers.xr.mjs` adds actual elapsed resident movement on the lower bank,
with normal gravity/rotation and the Quest population budget. Actual entry,
0/±25° roll, actor projection, radial root height, matching 1280×960 eyes and
session-ID-scoped exit are checked with playwright-webxr 0.2.0. The resident
moved 0.763 m in the final motion probe without actor-clock or position writes.

After route-setup optimization and shoe-support correction, the complete suite
passed **18 tests / 20 sessions / 20 exits in 4.5 minutes**, including actual
wrist/controller interaction and both exit/re-entry scenarios. The production
build remained frozen. Chrome 152.0.7977.83 / Apple M1 Pro / ANGLE Metal hardware
preflight passed. Independent image review found no new body or single-eye
defects in the supplied views; small/dark feet remain unsuitable for judging
precise contact. These are emulation results, not physical Quest measurements.

Evidence is retained under `qa/webxr/evidence/river-walkers-20260913/`, with
initial and final builds separated. Route, actual GLB shoe tests, browser
yield/resume and retained limitations: [River residents](../neighborhood-life/river-walkers.md).

## Observation deck (2026-09-13)

`observation-deck.xr.mjs` enters VR through the app, opens Places with the real
controller ray/trigger, selects Observation deck and checks supported arrival
at 58.5 m. It captures the full wrist texture plus stereo views at 0/±25°
head roll, verifies the floor/guard root remains fixed, and waits for the
matching session end. Both eye viewports are 1280×960 with 64 mm IPD. The fifth
Places row retains 290×80 targets and has no cropped footer.

The expanded suite has 19 tests (21 session entries/exits including the two
re-entry cases). Evidence is kept under ignored
`qa/webxr/evidence/observation-deck-20260913/`. All checks use the pinned
playwright-webxr 0.2.0 and hardware-GPU preflight; physical Quest comfort and
performance remain untested. Browser walking, seating, fallback and model
budget: [Observation deck](../neighborhood-life/observation-deck.md).

The broad run passed all 19 tests / 21 entries / 21 exits in 4.4 minutes.
A subsequent rail-joint geometry correction passed the focused deck test
again on the final model. The broad result is in `full-suite/`, and the focused
result in `final-deck-xr/`; the UI did not change between them. All 879 unit
tests and the final TypeScript/production build also pass.


## Upstairs apartment and curved neighborhood (2026-09-13)

`city-access.xr.mjs` uses the actual wrist Places → Apartment action, checks the shared street entrance and controller locomotion, then verifies the upstairs room and curved district in stereo at 0/±20° head roll. Diagnostics and capture metadata are tied to each session and its end event. The full suite passed 21 tests. Driveway and navigation changes subsequently passed the seven affected UI/scenery tests; the final Blender door correction passed both city-access tests again.

Evidence is in `evidence/city-access-20260913/`: `full-before-driveway`, `final-ui-and-seams`, and `final-apartment`. Tests used hardware Chrome / ANGLE Metal on Apple M1 Pro and playwright-webxr 0.2.0. Physical Quest comfort and performance are unverified. Walking, parking envelopes, balcony contact costs and reference provenance are recorded in [city-access.md](../neighborhood-life/city-access.md).


## 0.3.0 integration — 2026-09-13

The exact package and lockfile pin are now 0.3.0. Playwright 1.63.0 and IWER 2.4.0 are unchanged. [Release notes](https://github.com/tomingtoming/playwright-webxr/releases/tag/v0.3.0) and the shipped README/source were checked against the installed package.

- Every direct `window.__xrDevice.activeSession.end()` call in the suite is replaced by the public, session-scoped `xr.endSession` helper. App cleanup, dock visibility, re-entry and session logs are still checked.
- Head/controller pose propagation uses `xr.waitForFrames(2, { timeout: 5000 })`. Loaded assets, hover, grounded state, scene transforms and captures retain their own assertions. Timed walking, resident motion and settling/negative-input observation intervals still use elapsed time. Frames alone do not prove application readiness.
- All three wrist aiming helpers use the packaged `aimQuaternion` example after converting the panel target through the complete inverse tracking rig. Hover and actual trigger selection remain the oracle; a quaternion alone is not treated as a successful hit.
- The two existing exit/re-entry scenarios now attempt both exit and frame waiting with the stale first-session ID. Both must reject while the second session stays active, then a scoped two-frame wait on the second session must return its ID and exactly two frames. This checks the integration failure that motivated the API.

Historical 0.2.0 measurements and screenshots above retain their original version labels. Current continuation instructions and the existing hourly automation now select 0.3.0.

The first complete migrated run passed **21 tests in 5.2 minutes**, without retries. Both mono desktop-entry and stereo Quest-entry scenarios passed the stale-ID guards, two-frame result and real wrist selections after re-entry. Inspected stereo captures of the room, curved district and Places panel retain both eyes and supported geometry; this was self-review, not an independent visual audit. Diagnostics identify playwright-webxr 0.3.0, Chrome 152 and Apple M1 Pro / ANGLE Metal. No package failure was observed in this suite.

`bun test` (CI-aligned Bun 1.3.10) passed **888 tests**, and TypeScript/production build passed. Evidence is retained in `evidence/0.3.0-20260913/` (ignored). Physical-headset compositor output, performance and comfort remain untested.

## Curved street residents — 2026-09-13

The next frozen build passed **22 tests in 5.0 minutes** on playwright-webxr **0.3.0**, without retries. `curved-walkers.xr.mjs` adds actual entry, 0.659 m of independently observed resident motion, both 1280×960 eyes at 0/±25° roll, radial root placement and session-scoped exit. Frame waits follow pose changes; elapsed time remains intentional for motion. Existing wrist selections and both exit/re-entry scenarios also passed, including stale-session rejection. No package failure was observed.

Desktop / Quest-budget browser checks cover ordinary walking, player yielding and resuming, night and altitude / disabled visibility, with the existing eight/four population ceiling. Unit tests: **891 passed**; TypeScript and production build passed. See [reference, observations and limitations](../neighborhood-life/curved-walkers.md). Current evidence is in `evidence/curved-walkers-20260913/` (ignored). The stereo images were self-reviewed; Apple M1 Pro / ANGLE Metal and Chrome 152 remain the tested environment, not a physical headset.


## Garden street directions — 2026-09-13

Garden street is now a real Places / Directions destination on PC, phone and VR. Its two footways have four supported street mouths and connect to the existing crossing and river-route rules. `garden.xr.mjs` uses playwright-webxr **0.3.0** to select guidance without moving the player, inspect stereo at 0/±25° roll, choose the actual Go now target, walk on the arrival footway and end the matching session.

The complete suite passed **23 tests in 5.3 minutes**. Enlarged texture review then exposed the application's new fifth button row overlapping the direction text. A shared footer now reserves two instruction lines while retaining 290×80 buttons; a regression check covers text/target separation. The Garden hint also reports remaining walking distance. These final changes passed **six relevant XR UI tests in 1.3 minutes**, including the existing directions and both exit/re-entry cases.

Unit tests: **897 passed**; TypeScript and build passed. Four entrance round trips and approximately 48 m of guided walking on desktop / Quest budgets also passed using actual keys. [Observations, scope and remaining work](../neighborhood-life/garden-directions.md). Evidence is under `evidence/garden-directions-20260913/` (ignored), with baseline, overlap and final UI captures kept separate. No package failure was observed. Validation remains Chrome 152 / Apple M1 Pro / ANGLE Metal emulation, with self-reviewed images; physical headset behavior is untested.


## Traffic yielding to the player — 2026-09-13

`body-traffic.xr.mjs` uses playwright-webxr **0.3.0** to enter through Menu, wait
for an actual ambient car to stop before the grounded body, observe it in
stereo at 0/±25° head roll, then walk sideways using the left controller stick.
The car resumes when the body clears its lane; the player stays on the 5.34 m
bridge sidewalk. Vehicle/body positions and clocks are never written. The
public frame, screenshot and session-ending helpers retain session-ID checks.

The initial full suite passed **24 tests in 6.1 minutes**. Follow-up side views
exposed a missing 14 cm face between the bridge road and sidewalk. Adding 432
triangles to the existing stone batch closes the gap, with the same 1,063
colliders. The final build passed **11 affected traffic, river, Garden, covered
walk and wrist/UI tests in 3.4 minutes**, including both exit/re-entry scenarios,
without retries. All **901 unit tests** and TypeScript/production build passed.

An intermediate fixture rejected 1.73 mm of car movement while the live body
settled on the curved support. It now checks stopped speed, stable clearance
to the body and bounded body settling separately. This was a fixture tolerance
failure, not a package failure; its trace is preserved. No 0.3.0 package failure
was observed in the final flows. At the bridge centre, the final probe records
3.742 m centre-to-body clearance, then 10.191 m of resumed travel at 5 m/s.

Independent review of final day/night passing images confirms the old water/
railing slit is closed. The final stereo images retain matching car/road/curb
geometry in both eyes at all three rolls, without observed one-eye loss or
world detachment. Exact tyre contact and continuous head movement are outside
that still-image review. Chrome 152 / Apple M1 Pro / ANGLE Metal remains the
tested environment; physical Quest performance and comfort are unmeasured.

Evidence, including the full initial run, failed fixture, final run and source
mesh investigation, is under `evidence/body-traffic-20260913/` (ignored).
[Behaviour, cost, reference provenance and limits](../neighborhood-life/body-traffic.md).


## Rain-wet paving — 2026-09-13

`wet-paving.xr.mjs` enters the app in a real immersive session on the lower
river walk in rain. It inspects the bridge's dry underside and floor, and the
exposed paving outside, in both 1280×960 eyes at 0/±25° roll. Material identities
and the river transform stay fixed. A real left-stick walk then leaves the
bridge cover while retaining the 1.2 m supported path and saturated paving
state. Frame waits, captures and session termination use the public 0.3.0 API
with the current session ID. The existing suite exercises wrist selection,
both entry/re-entry routes and stale-session rejection.

Independent desktop comparison first caught the bridge ceiling being treated
as an upward surface. The production hook now follows Three's front/back face
rules; an isolated real-GPU regression covers the ceiling, reversed footway
winding and BackSide cylinder roads. The final 17 GPU cases preserve original
dry pixels and shelter while allowing exposed paving to darken. The final
six desktop comparisons preserve the ceiling, dry floors, texture and street
lights. Mesh counts match each baseline view. Details, initial failed viewpoints
and limits: [Wet paving](../neighborhood-life/wet-paving.md).

The final full suite passed all 25 tests in 6.8 minutes without retries on
playwright-webxr 0.3.0. The new case walked 15.204 m axially out of cover:
shelter changed from 1 to 0, supported height stayed at 1.2 m and paving
wetness stayed at 1. Independent review of the four final stereo captures
found no one-eye loss, material detachment or new geometry gaps at 0/±25°
roll or outside the bridge. Stone joints remain readable; strong gloss is
not apparent from these views. Continuous motion, exact disparity and
physical Quest performance/comfort remain unmeasured. Full artifacts and
logs are retained under `evidence/wet-paving-20260913/` (ignored).


## Shared street centreline and graph — 2026-09-13

The 13,173 legacy ground streets and Garden street now share the native
centreline format and static cylindrical graph (13,176 paths with its two
avenue links). Driving directions rasterise those same metric ribbons; the
existing curved road/footway geometry and support use the shared sampler.
This increment preserves the city layout. General junction surface ownership,
sidewalk cuts and district street/parcel generation are the next migration.

`garden.xr.mjs` records the live graph and still uses actual wrist Places,
Directions, Go now and controller walking. `body-traffic.xr.mjs` now retains
its state report even on failure. The initial full run had one instantaneous
stop-speed failure: the body moved about 9.9 mm and the car followed about
9.6 mm, retaining its 3.75 m clearance. The same build passed a diagnostic
single run. The check now allows up to 3 seconds for contact settling after
a pose input, retaining the 0.02 m/s stop limit and adding a 5 cm vehicle
displacement bound; it still checks relative clearance and lane release.
No vehicle-physics code was changed. Initial failed trace and diagnostic run
are preserved separately under `evidence/street-network-20260913/`.

[Implementation, reference provenance, tests and limits](../neighborhood-life/street-network.md).

The final fixed build passed all 25 XR tests in 6.7 minutes, with retries
disabled. The yielding car's final three poses each measured 0 m/s and it
resumed at 5 m/s after lane clearance. Independent review of four traffic
and six Garden captures found no new one-eye loss, detached geometry or
road/footway gaps; Garden text was readable in the VR captures themselves.
Exact tyre contact is hidden in the frontal view. Continuous motion, exact
disparity and physical Quest comfort/performance remain unmeasured.
Chrome 152 / Apple M1 Pro / ANGLE Metal; full final artifacts are in
`evidence/street-network-20260913/xr-final/`.


## Native pavement polygons — 2026-09-13

All 13,173 ground streets now render through the shared polygon compiler;
ordinary street sidewalks use the same clipping and cylindrical geometry.
The current layout and the authored Garden floor/ramps are preserved.
Native crossings own shared asphalt once, and sidewalks are cut against
carriageways and each other. The full-city road area and triangle count match
the old compiler; the common-input sidewalk geometry loses 93,940 triangles.
Generation CPU cost increases and is reported separately from rendering.

`street-surfaces.xr.mjs` enters VR through the actual desktop Menu, verifies
all six pavement batches through stereo 0/±25° roll, then walks with the real
left controller and exits. It checks geometry/material identity, transforms,
2560×960 captures and the current session ID using playwright-webxr 0.3.0.
The dedicated run passed and moved about 3.03 m while remaining grounded.
Independent review found no visible holes, one-eye loss or kerb detachment
in those four captures. Six desktop before/after pairs also had no new
confirmed defect. An initial crosswalk-shortening concern was withdrawn
after exact-coordinate comparison showed a maximum RGB difference of 1/255.
Physical Quest performance/comfort and exact tyre/foot contact are unmeasured.

The same final application build passed all 26 XR tests in 6.8 minutes with
retries disabled, including body/traffic yielding, upstairs access, river,
Garden, walking directions and wrist UI regressions. Full artifacts are in
`evidence/street-surfaces-20260913/xr-final/`.

Details, CPU/triangle measurements and the remaining migration:
[Native road and sidewalk surfaces](../neighborhood-life/street-surfaces.md).
Evidence: `evidence/street-surfaces-20260913/` (ignored).

## Graph-based crosswalks — 2026-09-13

Crosswalks now follow outgoing native road-graph arms, including skew and T
junctions and curves. The six pavement batches stay unchanged; one nearby
stripe batch shares the existing paint material. Legacy stop lines and signal
control remain. Details and limits: [Crosswalk generation](../neighborhood-life/street-markings.md).

The fixed build passed all 26 XR cases in 6.9 minutes with no retries. The
street-surface test now also checks native stripe geometry, material and
transform identity through stereo roll. Its first 4.5-second walk stopped
before the crossing; distance alone was insufficient evidence of crossing.
The test was strengthened to read the painted band's bounds and finish beyond
the far edge while remaining within its lateral bounds. A focused rerun on
the same build passed in 17.7 seconds (test: 15.8 seconds), walking about
19.81 m, from axial 300.0000 to 319.7882 m across the 314.4903–317.0903 m band.
Start and end were grounded; page errors were zero. Independent review of
stereo captures found no new stripe loss, detachment or kerb discontinuity.
Physical Quest performance, comfort and continuous contact/flicker are unmeasured.
Evidence: `evidence/street-markings-20260913/xr-full/` and `xr-crossing/`.


## Native building frontage — 2026-09-13

`city-access.xr.mjs` now inspects the apartment's certified native road ID,
retains entrance paving geometry/material/transform identity at 0/±25° roll,
and walks through the actual entrance plane with the left controller. The
1.2-second input moved from axial −213.7764 to −209.6993 m, crossing the
−211.7769 m doorway. Both endpoints were grounded. Garden's eight rotated
buildings have certified connections to the same road graph; the upstairs
room and curved street retain their stereo checks at 0/±20° roll.

The final frozen build passed all **26 tests in 7.0 minutes**, without retries,
on playwright-webxr **0.3.0**, Chrome 152 / Apple M1 Pro / ANGLE Metal. Actual
wrist actions, session-scoped public helpers, exit/re-entry and stale-ID guards
remain covered. Independent review of the seven entrance/Garden stereo
captures found no new one-eye loss or large shape detachment in those views.
Precise contact, continuous flicker and physical Quest comfort/performance
remain unmeasured. Unit tests: **945 passed**; TypeScript/production build passed.

[Implementation, CPU cost, desktop walking and retained observations](../neighborhood-life/street-frontage.md).
Evidence: `evidence/street-frontage-20260913/`, including `xr-full/`.

## Connected native districts — 2026-09-13

`native-districts.xr.mjs` visits the rebuilt arterial sidewalk using the actual
app entry. It checks three connected district plans, actual traffic and native
residents within the existing Quest population cap, and uses controller poses,
raycasts and trigger input to open wrist Places and return home. Stereo views
use 2560×960, IPD 0.064 m, with road geometry and world transforms checked at
0/±25° head roll. Left-stick walking, traffic/resident movement, grounded state
and session-scoped termination are separate assertions. The Garden fixture
counts the district paths when checking the shared graph instead of assuming
all streets come from axis-aligned legacy roads.

[Implementation, generation cost, desktop evidence and remaining work](../neighborhood-life/native-districts.md).
Evidence: `evidence/native-districts-20260913/`.

The frozen build passed all **27 cases in 7.6 minutes**, with **zero retries**,
on playwright-webxr **0.3.0**, Chrome 152.0.7977.83 / Apple M1 Pro / ANGLE Metal.
The new district case walked about 2.96 m while grounded, observed both traffic
and resident movement, and completed actual wrist Places actions and the
matching session's end event. Independent review of its four stereo captures
found no new one-eye disappearance, world-roll detachment or Places overflow.
The separate four-position shoe/actual-pavement probe resolved a distant PC
pedestrian's uncertain foot placement; it does not validate continuous gait.
Unit tests: **965 passed**; TypeScript/production build passed. Physical Quest
performance, comfort and continuous flicker remain unmeasured.
