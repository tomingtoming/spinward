# Spinward WebXR UI and scenery checks

Run the real VR entry, wrist laser and controller trigger through
[playwright-webxr](https://github.com/tomingtoming/playwright-webxr). These are
emulated sessions in Chrome, not measurements from a physical Quest.

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
raycasts. Session termination uses the emulator's real `XRSession.end()`.

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

Development dependency now pins **playwright-webxr 0.2.0**, with Playwright
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
