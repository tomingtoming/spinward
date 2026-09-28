---
origin: ai
created: 2026-09-27
---

# Quest resolution after the city-budget retest

The user reported that the previous candidate felt lighter on Quest 3S, but the
resolution was too low. This is physical-device feedback on the preceding
candidate, not a measured frame-rate result.

Standalone XR framebuffer scale now defaults to 0.85 instead of 0.7. Relative
to the XR runtime's reference dimensions this requests 72.25% rather than 49%
of the pixel area, a 47.45% increase over the preceding setting. It is not a
claim about the display panel's resolution or total GPU time.

`?xrScale=0.7` restores the old scale; `?xrScale=1` requests the runtime's full
reference dimensions. Finite overrides in [0.7, 1] apply only to the standalone
profile. Invalid values fall back to 0.85. Reload and re-enter VR to apply a
change: Three r180 allocates native targets when the session begins and does
not support changing framebuffer scale during presentation.

The Quest city budget, no-MSAA context, foveation=1 and flat-canvas DPR cap stay
as in the previous candidate. Desktop/phone XR defaults stay at 1. The three
city bands, PLATEAU release and shared/diagnostic assets are unchanged.

## Verification and limits

- 11 focused tests pass: resolution/profile validation, device detection and
  the previous city-budget ownership/geometry/texture contracts.
- TypeScript and the frozen metro production build pass.
- `qa/webxr/quest-resolution.xr.mjs` passes default 0.85, old 0.7 and full 1.
  A synthetic Quest UA exercises automatic detection without `tier=quest`.
  The test observes actual `XRWebGLLayer` allocation arguments on entry and
  re-entry, checks the retained Quest city budget and no-MSAA setting, and
  rejects software GPUs. Local run: three cases, 14.8 s, Apple M1 Pro / Metal.
- playwright-webxr 0.3.0/IWER kept its emulated framebuffer at 2560 x 960 for
  all three scales. It verifies the requested parameters and lifecycle,
  **not the native Quest resolution, clarity or performance**.
- The first very rapid exit test ended before the asynchronous Three controller
  model loaded, yielding two `motionController.assetUrl` null errors. The
  installed, unchanged `XRControllerModelFactory.js` callback dereferences that
  field after disconnect clears it. The accepted test waits for both controller
  models before exiting; this does not establish that rapid exit is safe, and
  no controller-loader fix is included in this resolution change.
- No full-suite pass or physical-headset acceptance is claimed for this patch.

App inventory SHA-256:
`4cec61dad053094f40a6a71eb4a213848698ff5c29aad9215bd037cf97742ac7`.
With the unchanged diagnostic page:
`f045ccaa34096e661d298a5bcffc3aeaa5533a196f072c38a4419b39606599db`.
Only the public candidate is updated; no production cutover or repository push.

Published Worker: `a9861b22-bd44-4c4f-8016-ab3dafafef03`. All three resolution
cases pass against the public URL (17.4 s), including re-entry and automatic
Quest detection. Seven published application/diagnostic files match their
package hashes. Native Quest clarity and performance await the user's retest.

Source snapshots, packages, initial failed traces and passing local/public
evidence are retained at
`/Volumes/BLAZE/Spinward/inland-b-20260924/production-20260925/quest-resolution-20260927/`.
