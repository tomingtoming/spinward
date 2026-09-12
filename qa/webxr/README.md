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
