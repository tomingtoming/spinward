---
origin: ai
created: 2026-09-26
---

# Quest 3S: crash immediately after immersive entry

User observation: the public candidate opens in Quest 3S Browser; after Enter VR,
the VR scene appears briefly and the browser closes. This is a physical-headset
failure. It invalidates treating desktop emulation acceptance as headset acceptance.
No device crash log is available, so OOM, GPU/driver failure, and browser failure
are not distinguished.

## Bounded mitigation

- Standalone Quest: set XR framebuffer scale to 0.7 **before** session creation
  (49% of the original pixel area; not a measured total-memory reduction).
- Disable antialias on its WebGL context. three r180 otherwise also creates a
  four-sample render target on the native projection-layer path.
- Cap the separate flat canvas DPR at 1. Keep the existing foveation setting of 1.
- Preserve logarithmic depth, all three city bands, collision, Places and datasets.
  Desktop rendering stays unchanged. This trades sharper edges for lower entry cost.

Implementation: `src/xr/renderProfile.ts`, `src/app/main.ts`, `src/app/quality.ts`.
The official [WebXRManager contract](https://threejs.org/docs/pages/WebXRManager.html)
requires setting the scale before presenting. Installed r180's `WebXRManager.js`
confirms `samples: attributes.antialias ? 4 : 0` for projection layers.

## Verification and limits

- Original public application rebuilt byte-for-byte after substituting only the
  two saved pre-edit source files. All inventory files matched. No unrelated
  workspace changes entered the candidate rebuild.
- Five focused unit tests and TypeScript/production build pass.
- `qa/webxr/quest-entry.xr.mjs`: original and modified versions both pass actual
  entry, exit and re-entry on Apple M1 Pro / ANGLE Metal / playwright-webxr 0.3.0.
  The test initially used a nonexistent `exitVR` helper; corrected to `endSession`
  and rerun successfully. This was a harness error, not an application failure.
- Existing stereo wrist Places test passes: three-band destinations and Shibuya
  return using actual controller rays/buttons, on the frozen modified build.
- The original settled view drew 2,704,080 triangles in 574 calls across two eyes.
  Scene geometry attribute arrays counted ~202 MB and texture estimates ~208 MB.
  These are partial allocations, **not total RAM, VRAM or a Quest OOM threshold**.
- Independent screenshot comparison: both eyes retain city, ground and intro UI;
  the modified version has more jagged edges/stripes. No clear large new geometry
  loss. A very thin rectangle edge was less discernible; its cause is uncertain.
- IWER uses XRWebGLLayer at 2560×960 and does not reproduce native Quest projection
  layers or its memory limit. The new context has antialias disabled, but the
  native resolution reduction and physical crash recovery still require Quest.

Application package SHA-256:
`b2478857ee1d22a866320c013388df684db9115326a0376d2998307714848553`.
Data release remains `ce65ac50fdc0bb7e8ddc3c7ce8de3f9243c5d2129ecefd4ce8a304574fa3c8f4`.
This is a candidate update, not the production cutover.

Candidate Worker version: `bfbc2ca2-2e6b-4dda-8991-03d8711acd9f`.
The same entry/re-entry test passes on the deployed candidate (53.8 seconds).
Published HTML, JS, CSS and the tile worker are read back and checksum-compared
with the frozen package. The initial Python urllib client received 403; curl
and the actual browser path returned the expected assets.

The optional broad unit run hit timeouts in unchanged procedural-city tests
(`izmaTransport`, `nativeDistricts`) and was stopped. It is **not a full-suite
pass**. The focused render-profile/quality tests and build above are the completed
code checks for this patch. No production switch or repository push was made.

Frozen build/package, baseline sources, readback and test evidence are retained at
`/Volumes/BLAZE/Spinward/inland-b-20260924/production-20260925/quest-entry-20260926/`.
Physical-headset retest remains open; if it still closes, obtain the Quest crash
or remote-debug log and isolate native rendering from resident-city load.

## Physical retest: mitigation did not resolve the failure

The user retried on Quest 3S and reported that the browser now closes without
even briefly showing the scene; audio is heard briefly. This is another failure,
not evidence that lowering buffers fixed OOM. No crash log is available. The
exact cause remains unknown, and further blind quality reductions are deferred.

An isolated page is now at `/diagnostics/xr-entry-v1/` and linked first in Quest
Launcher. It uses the installed Three.js r180 and unchanged VRButton, with the
candidate's antialias=false, scale=.7, foveation=1 and logarithmic-depth settings.
Only a floor and blue box render; no city, audio, physics or external texture
loads occur. It exits after about ten seconds. A `?depth=plain` comparison changes
only the depth-buffer setting. Audio and simulation are additional differences
from the app, so a passing minimal test would not alone prove a city-memory bug.

Each attempt stores a few startup checkpoints and the browser/GPU/actual layer
type in **localStorage on that device only**. Reopening displays the last stage.
An unfinished attempt is not automatically called a crash; ordinary tab closure
can leave the same record. No diagnostic information is uploaded.

The local log/plain tests passed on M1 Pro / Metal / playwright-webxr 0.3.0,
including real entry, ten seconds of frames, automatic session end and result
retention after reload. Network assertions confirmed diagnostic-only requests.
Independent inspection found the floor and blue box in both eyes with no large
missing region. These are desktop emulation checks, not physical Quest results.

Source: `qa/quest-diagnostic/`; regression: `qa/webxr/quest-isolation.xr.mjs`.
The diagnostic package preserves **all 115 original app files byte-for-byte** and
adds six files (including the Three.js license). Candidate Worker version:
`8d12919f-f123-4398-859b-9586355b84c2`; package SHA-256:
`0de00fd735613821a0e7e07b92e8ec18f6bd3f83d55c5638a98a8d9b7b8a502d`.
The scene itself was not replaced with another speculative fix.

Both depth variants also passed against the deployed diagnostic (2 tests, 31.9s),
including automatic exit, retained checkpoints and diagnostic-only requests.
Quest Launcher lists the diagnostic first; its update is commit `0392387`,
deployed as version `cf07bcb3-0bfd-4e85-81bd-b2ecbbb9a2b6`.

The user subsequently reported that **other WebXR works also close on this same
Quest 3S**, and chose to restart the headset. This broadens the investigation to
shared browser/device state; it does not establish a specific cause or rule out
an additional Spinward-specific load problem. Further speculative app reductions
are paused pending the user's post-restart result. The isolated diagnostic has
not yet been verified on the physical headset.

## User retest: entry recovered, experience remains difficult

On 2026-09-26 the user reported that clearing browsing history made the scene
viewable on Quest, but that the experience is demanding for the headset. The
exact browser data cleared and the effect of the previously announced restart
are not known. This is a user-observed recovery, not proof that the app mitigation
fixed the crash or that a specific cache/storage mechanism caused it. Physical
frame timing and the most troublesome interaction remain unmeasured; the user
was asked to distinguish stationary head turns, movement/loading, and visual or
control quality. Further quality changes have not been deployed on this evidence.
