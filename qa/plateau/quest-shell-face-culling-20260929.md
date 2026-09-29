---
origin: ai
created: 2026-09-29
---

# Quest: saturated GPU timing and certified-shell face culling

First increment on toming-server (AMD Radeon 780M, ANGLE Vulkan/RADV) after
the Mac → server handoff. Logarithmic depth, 100% XR framebuffer scale,
geometry, materials, haze and distance budgets are unchanged. Physical Quest
performance is **not** measured here.

## Measurement correction: an unsaturated GPU hides savings

The earlier desktop GPU comparisons timed one render per XR frame. The
integrated GPU then runs below full clock (`pp_dpm_sclk` alternates between
800 MHz and ~2.2 GHz under `auto`), so removing work mostly lowers the clock
instead of the elapsed time. Measured on the same Shibuya pose:

- One render per frame: hiding any single category, including all
  `buildings` or all `facade-batch` meshes (43% of triangles), changed the
  GPU time by at most ±0.3 ms of ~8.5 ms.
- Four renders per timed query (`XR_COST_REPEAT=4`), clock ~2.2 GHz
  throughout: hiding `buildings` removed 42% of the time.

Objects must be hidden through `material.visible`; the app re-shows objects
every frame for LOD and streaming, so `object.visible=false` did not remove
their draws. Earlier desktop verdicts of "small gain" (for example district
frustum culling at 1–2%, or the rejected haze quadrature) were measured
unsaturated and may understate real savings. They were not re-measured.

Harness: `qa/webxr/xr-fragment-cost.xr.mjs`. Hardware GPU flags for this
server: `--enable-gpu --use-angle=vulkan --enable-features=Vulkan`.

## Where Quest-tier GPU time goes (saturated, day, stereo 2560×960)

Share removed by hiding one category, before this change:

| Category | Shibuya | Omiya |
|---|---|---|
| buildings | −42% | −42% |
| fog | −13% | −9% |
| terrain | −11% | −12% |
| facade-batch | −11% | −7% |
| source-surface-detail | −8% | −2% |

Building experiments (not all shippable): front faces only for every building
−19% / −20% (drops open or inward source faces; rejected on 09-28);
closed-shell discard at every distance −12% / −10%; front faces only for
overview buildings −5% / −5%.

Near and far building meshes were 100% certified closed shells. The
uncertified 95% of building triangles are overview meshes: multi-segment
meshes skip certification in `prepareTile`, independent of their shape.

## Change

`building-shell-culling.js`: for meshes whose every vertex is certified,
switch the draw to `FrontSide` while the existing both-eye exterior test
passes, and restore the original side after the draw. The shader still
defines `DOUBLE_SIDED`, so a program compiled during a front-only draw keeps
correct back-face normals when the eye later enters a building. Shadows keep
their original side through `shadowSide`. Partially certified meshes keep the
previous path. `?shellCull=off` restores the previous draw for A/B on device.

Saturated GPU median, culling off → on:

| Place | Off (ms) | On (ms) | Change |
|---|---|---|---|
| Shibuya | 8.19, 8.24, 8.27 | 7.06–7.14 | −14% |
| Omiya | 9.10, 9.11 | 7.93–7.98 | −13% |

## Visual difference (accepted by toming, 2026-09-29)

Same-frame stereo comparisons (Shibuya/Omiya × day/night × nine poses,
~2.46 M pixels per image) changed 0–7 pixels per image. The changes are
isolated single pixels along building silhouettes, often every ~16 px on one
edge, swapping between the same two colours in both directions (maximum 67
channel values by day, 4 at night). This matches the 16 pixels that led to
rejecting the unbounded discard on 09-28 and appears to follow the pixel-
centre coverage rule on folded silhouette edges. The Quest tier renders
without MSAA, so these edge pixels already vary as the head moves; that
comparison was not measured.

toming accepted these isolated silhouette pixels for the ~13–14% GPU saving
("画素差を受け入れる", 2026-09-29). `xr-building-shells.xr.mjs` now allows up
to 16 changed pixels per stereo image and fails if any changed pixel has a
changed 8-neighbour, so coverage gaps are still detected. The rerun passed all
36 pairs (0–5 pixels, none clustered). `?shellCull=off` remains for
comparison on the headset.

## Verification

- Unit: 61 PLATEAU tests (new: exterior-only culling, side restore, inside,
  near-plane, toggle, partial certification, `DOUBLE_SIDED` guard);
  TypeScript; application and Tokyo builds.
- WebXR 0.3.0 on the hardware GPU: `quest-entry`, `quest-budget`,
  `quest-resolution` and `xr-overview-visual` (36 pairs, zero changed
  pixels), 10/10 passed.
- No deployment. Candidate Worker, production and the data release are
  unchanged.

## Next candidates

1. Certify overview building meshes per component (about −5% more).
2. Re-measure fog and terrain under saturation; fog is the second-largest
   share and was previously judged only with unsaturated timings.
