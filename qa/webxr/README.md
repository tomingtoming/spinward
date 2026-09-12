# Spinward WebXR UI checks

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

Locked development versions: playwright-webxr 0.1.0, @playwright/test 1.63.0,
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

## Limits

The integration run uses Apple M1 Pro / ANGLE Metal, Three.js r180 and
XRWebGLLayer (base layer present, projection layers absent). IWER's mono mode
still exposes left/right views, but the right viewport has width zero; stereo
uses two equal viewports with 64 mm eye separation. Tests assert those view
properties rather than assuming one viewer view in mono mode.

This does not verify native Quest rendering, compositor layers, multiview/MSAA,
hand tracking, performance, stereo comfort, readability through lenses, or
motion sickness. Those require a physical headset. Review wrist text in the
saved textures as well as the full scene; an emulator screenshot alone can hide
small typography defects.
