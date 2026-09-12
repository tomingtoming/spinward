# Flat-screen UI refinement — 2026-09-12

PC and touch now share three permanent actions: Places, Explore and Menu.
The live felt-gravity measurement stays in the lower-left corner; driving
adds speed above it. This reduces competing controls around the city view.

- Places has one row per destination. The name and arrow start directions;
  a separately labelled Go now button performs the existing immediate visit.
  Destinations without routes retain only Go now. Availability rebuilds with
  the habitat, and Your car is disabled while already driving.
- Explore groups Surface, Old Town, Overlook, Axis and Exterior. Menu groups
  colony settings and controls, throwing, environment, driving, and sharing.
  All primary controls and menu buttons have at least 44 px touch targets.
- Menus scroll within the viewport without moving the footer or touch controls.
  Escape restores focus to a visible opener, including nested settings.
  Opening a menu clears held movement input; keyboard navigation cannot also
  move, jump, throw or operate the vehicle. Physical momentum is preserved.
- Controls is an explicit, dismissible reference that remains open while read.
  The automatic controls flash is removed. Flat-screen tour messages use
  readable DOM text near a corner, with a close action, and yield to menus
  and outing directions. The existing spatial tour panel remains for XR.
- Touch uses the same contextual car entry/exit button as PC; Brake remains
  nearby while driving. Motion look moved into Menu. Unsupported VR is omitted;
  Quest retains its first-entry CTA and subsequent entry from Menu.

## Verification

Baseline: c72024b at 1280×800 and touch 390×844. Driver controls decreased from
19 visible buttons to 4 on PC (three permanent actions plus Leave car), and
from 9 to 5 on touch (three actions plus Leave car and Brake). The PC footer
height decreased from 78 px to 45 px. Touch keeps the same compact footprint
(44 → 45 px) while retaining gravity and speed.

- `bun test`: 813 pass, 0 fail. Three obsolete breakpoint tests retired; one
  regression added for held movement cancelled by opening UI.
- `bun run build`: TypeScript and production build pass.
- `qa/neighborhood-life/ui-refinement.mjs`: real Chrome with Apple M1 Pro Metal
  rendering; PC and touch, 1280×800, 390×844, 320×568 and 844×390. Validates
  bounds and touch targets, stable footer, sound/rain, nested focus and manual
  controls, car entry/exit, both driving modes, directions versus immediate
  arrival, Exterior/Surface, input cancellation and four habitat presets.
- `qa/neighborhood-life/keyboard-menus.mjs`: Space, arrows, Home/End, Escape,
  scrolling focus, hit testing and pointer dismissal at four viewport sizes.
- `qa/neighborhood-life/controls-introduction.mjs`: manual help remains open
  beyond five seconds, Escape closes it, and coffee service does not trigger
  a delayed automatic controls panel.
- Before/after screenshots inspected independently for driving visibility,
  reading order and overlap. New UI artifacts are `qa/neighborhood-life/ui-after-*`
  and `ui-refinement.json` (ignored generated outputs).

No new point lights, geometry, assets or dependencies. The simulation continues
behind menus. Hardware XR and phone orientation sensors were not tested;
Chrome touch emulation checks the flat touch UI only. Existing Vite bundle-size
warning remains.


## VR verification follow-up

On 2026-09-12 the user requested considering
[playwright-webxr](https://www.npmjs.com/package/playwright-webxr) for VR UI.
The npm registry reports 0.1.0 (published 2026-07-31), depending on IWER ^2.3.0
and peer @playwright/test >=1.40. The [upstream README](https://github.com/tomingtoming/playwright-webxr#readme)
describes an IWER fixture for immersive sessions, head/controller poses,
controller buttons/axes and frame capture. This is a suitable candidate for
Spinward's VR UI verification. This initial assessment preceded installation;
the user then approved integration on the same date.

Integration checks:

- Add it only to the development/test environment. Existing QA uses standalone
  Playwright scripts, so the fixture needs a separate @playwright/test entry.
- On desktop, open Menu before `xr.enterVR()` so the actual #VRButton is visible.
  Assert immersive-vr, the hidden DOM dock, and visible spatial UI before taking
  screenshots. Then test wrist-menu pointing/selection and head roll at 0/±25°.
- Start on this host's verified Metal GPU. The README's software-rendering
  example is not a performance baseline for the full colony.
- Check the XR layer path actually exercised. Three.js r180 locally checks
  for createProjectionLayer before using layers; upstream documents IWER layer
  polyfill caveats. Emulation success does not certify native compositor,
  multiview/MSAA, hardware performance or comfort.

The follow-up now includes locked development dependencies and real controller-input
checks. See [WebXR UI checks](../qa/webxr/README.md) for the implementation,
reproduced defects, invocation and limits.
