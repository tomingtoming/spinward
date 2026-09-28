---
origin: ai
created: 2026-09-28
---

# Appearance-preserving XR CPU and canvas work reduction

User request: find further optimizations without changing appearance. Preserve
the 100% XR framebuffer request, geometry, materials, visibility distances and
the existing adaptive detail policy.

## Changes

- `MetroCity.update` updates its root transform without recursively updating
  every descendant. Selection routines update the roots they need through
  `worldToLocal`; Three's render traversal still updates descendant world
  transforms before culling/drawing. Physical contact boxes use logical surface
  coordinates rather than rendered mesh world matrices.
- Base, far and facade streaming pumps filter eligible requests before sorting.
  Full concurrency/capacity returns early. Nearest-first ordering, stable ties,
  byte/residency limits, backoff and cancellation are unchanged. Large catalogs
  no longer get sorted again when all requested data is already resident.
- The wrist canvas paints in the mesh's `onBeforeRender`, once per updated
  snapshot. Offscreen panels retain current pose, interaction and state without
  painting/uploading. The first visible eye renders current content; the second
  uses the same texture revision. No refresh-rate cap or reduced texture size.

## Measurements and limits

Chrome hardware GPU: ANGLE Metal / Apple M1 Pro. `playwright-webxr` 0.3.0,
stereo 2560×960. These are application CPU measurements in emulation, **not
physical Quest FPS or a claim of equivalent percentage improvement overall**.

CDP CPU sampling at 200µs for 300 XR frames, unminified builds:

| Sampled function self time, ms | Shibuya before | Shibuya after | Omiya before | Omiya after |
|---|---:|---:|---:|---:|
| Streaming `pump` functions combined | 81.683 | 9.742 | 178.515 | 9.421 |
| `updateWorldMatrix` | 64.561 | 3.973 | 61.462 | 2.321 |
| Matrix multiplication | 128.410 | 100.172 | 142.155 | 100.355 |
| Renderer `updateMatrixWorld` | 102.491 | 124.675 | 115.985 | 131.082 |

Do not add these selected reductions and call them total render savings.
Sampling varies and descendant matrices still need updating in the renderer.
The default emulated controller pose leaves the wrist visible in this CPU
profile; its canvas work correctly remains. Separate offscreen tests assert
zero texture-version changes across four 180-frame samples.

All large `getParameter` samples (4.8–8.3 seconds) had IWER's `onDeviceFrame` as
their parent, not an application caller. They prevent treating emulated frame
time as Quest hardware frame time. Raw profiles retain the call stacks.

The minified build also alternates the original root traversal and optimized
path twice in one session. Only the first explicit root update is restored for
the control; recursive parent visits from `worldToLocal` must stay non-recursive.
In both cities the `MetroCity.update` median was about 0.6ms → 0.1ms.
Shibuya p95 was 1.8–1.9ms → 1.4ms; Omiya 1.9–2.0ms → 1.5–1.7ms.
These measurements isolate the redundant matrix traversal; both alternatives
already use the filtered streaming pumps. The first Shibuya sample still
contained a timed arrival card (two draws/four triangles), so only the settled
second pair is used for draw-count equality. Results are in
`corrected-artifacts/*/overhead.json`.

## Validation

- 74 relevant unit tests passed, including tile recovery after three failed
  requests, eviction/hysteresis, far coverage and wrist layouts. TypeScript and
  the production metro build passed.
- Actual WebXR entry, trigger/raycast navigation through Places and Controls,
  ±25° head roll, session exit and re-entry at Shibuya and Omiya.
- Offscreen texture remains unchanged. Both eyes share one texture revision
  when the wrist is visible. Returning the wrist restores current menus.
- Six same-frame city comparisons (forward, turned, overhead × two places):
  unchanged RGB pixels in both eyes. Independent visual verification additionally
  checks RGBA equality, UI text, layout and the scope of scene visibility.
- Omiya's forward/upward views include a large nearby wall in both controls;
  these images cannot establish correctness of scenery hidden behind it.

Measurement setup corrections are retained as evidence: the first test server
invocation omitted its required release environment and never started; those
connection failures are not app results. A lowered controller was not reliably
outside the emulated frustum, so the offscreen test uses a pose behind the head.
The first timing control erroneously made all parent visits recursive; discard
its performance values in `final-artifacts`. Corrected timings restore only the
single original traversal. Image comparisons and input checks were unaffected.

## Remaining candidates

- A zero-intensity local spotlight still participates in Three's light list.
  Skipping it in full daylight may reduce fragment lighting work, but changing
  the light count selects different shader programs. Measure GPU benefit and
  precompile transitions before adoption; otherwise sunset can introduce a hitch.
- Static city objects still participate in the render-time matrix traversal.
  Further suppression must account for colony/parent motion, source meshes used
  for culling and newly attached streamed content. This increment removes only
  the proven redundant traversal.

Neither candidate is included in this build. Previously rejected finer terrain
chunks remain rejected: they increased submission work despite fewer triangles.

## Evidence

Working evidence: `/tmp/spinward-xr-overhead-20260928/`.
Retained evidence target:
`/Volumes/BLAZE/Spinward/inland-b-20260924/production-20260925/xr-overhead-20260928/`.

Unchanged immutable city release:
`ce65ac50fdc0bb7e8ddc3c7ce8de3f9243c5d2129ecefd4ce8a304574fa3c8f4`.
App package inventory:
`09a052a81739e4f3ddcc908b6e4a2919858a56dd2c8ec8f09f90bb8c2325ba0e`.
With the unchanged diagnostic files, 122 objects:
`8619f0065f8a8584ae5857637ba9ac749896b1fb853d1a42a7b0953b42078aed`.

Candidate Worker `a99a3e8b-74f0-4af7-a922-0408e4628331` deployed successfully.
Readback matched SHA-256 for all 11 public HTML/JS/CSS files, including the
unchanged diagnostic application. Independent image review found no new visual
regression within the six city pairs and the tested wrist screens. See
`visual-review.md` and its native-resolution crops/probes in retained evidence.
Public-candidate Shibuya WebXR entry, wrist navigation, stereo comparisons and
session re-entry passed (58.6s), with zero page errors. Local corrected Shibuya
and Omiya checks passed (2.1 minutes). Public timing comparisons use the settled
second pair, as distant streaming was still finishing in the initial sample.
No production deployment, commit or push is part of this increment.
