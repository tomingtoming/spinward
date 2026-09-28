---
origin: ai
created: 2026-09-28
---

# Appearance-preserving Quest rendering work

The user rejected ordinary depth because the distant colony suffered severe
z-fighting. This increment retains logarithmic depth, 100% XR framebuffer
scale, the existing scene geometry, distance budgets, materials and haze.
Physical Quest improvement has **not** been measured in this session.

## Implementation

During tile preparation, certify only consistently outward-wound, closed,
positive-volume building components. Every source edge must occur exactly
twice in opposite directions. Open, inward, inconsistent, non-manifold and
oversized source meshes keep the original two-sided rendering. The bounded
check runs once in the existing tile worker; source/collision arrays and
triangle winding remain unchanged. The scalar certification attribute
survives curved subdivision and is included in resident byte accounting.

For an eye outside all certified component bounds, omit lighting and haze of
back-facing certified fragments within 100 metres. Both eyes are checked
separately, including conservative padding for their asymmetric near planes.
Entering a building or approaching its near-plane intersection restores the
original interior faces. Farther surfaces keep their original shader path.
Material side, depth encoding and shadows stay unchanged.

Normal/texture derivatives run before the distance-dependent discard. GLSL ES
makes derivatives after non-uniform discard undefined; see the
[Khronos shading-language specification](https://registry.khronos.org/OpenGL/specs/es/3.2/GLSL_ES_Specification_3.20.html).
This ordering correction is independent of the still-unresolved cause of the
few silhouette pixels changed in the wider experiments below.

## Rejected experiments

- Removing haze visibly changes the scene; not shipped.
- Unconditionally making every building front-sided lost 1,296 changed pixels
  in an Omiya ground view; not shipped.
- Certified shells without a distance bound retained all ground pairs but
  changed 16 isolated pixels across 36 stereo image pairs (maximum 67 channel
  values). The independent reviewer could not rule out tiny coverage gaps.
- Restricting the discard to 250 metres still changed 1–2 pixels in several
  comparisons. One diagnostic repeat did not reproduce the difference, so its
  absence cannot establish correctness. Moving discard after derivatives did
  not eliminate every changed pixel. These versions are not deployment input.
- The 100-metre early-discard experiment was pixel-identical across all 36
  pairs. Warm GPU median differences were small: Shibuya 24.35 to 23.87 ms and
  Omiya 37.87 to 37.74 ms on Apple M1 Pro. These are experimental desktop GPU
  query results, not Quest FPS or evidence of a large improvement.
- Per-draw GPU timer queries produced intrusive driver synchronization and
  implausible aggregate costs; those timings are discarded.

The final fixed build is `build-safe`, using the 100-metre bound and computing
normal/texture derivatives before discard. Other build/package directories
under the evidence root are superseded experiments.

## Verification

Unit checks: 58 passed / 1,575 assertions across 18 PLATEAU files. Coverage
includes invalid shells, open neighbours, unchanged source data, curved
attribute refinement, both-eye interior/near-plane guards and shader chaining.
TypeScript and fixed Vite build checks run separately.

WebXR verification uses playwright-webxr 0.3.0, hardware ANGLE Metal Apple M1
Pro, stereo 2560×960, a forced constant city detail budget, logarithmic depth
and framebuffer scale 1.0. Shibuya/Omiya × day/night × nine poses cover ground,
80 m and 300 m heights. Each before/after pair is rendered at the same pose
without advancing the application frame, toggling only the rejection uniform.
The final regression threshold is zero changed pixels.

GPU measurements query the complete city render, with 300 warm-up XR frames,
then six disabled/enabled windows and 60 settling frames per window. The
first two windows are excluded from the final comparison. Reported adaptive
controller state is diagnostic; the actual city detail budget is forced to 2.
An arrival card may change 2 draw calls / 4 triangles early in a run. CPU
submission and GPU elapsed times are separate; software GPU is rejected.

Static comparisons cannot establish temporal z-fighting, all viewpoints, or
physical Quest performance. Existing wrist-menu entry, ray/trigger actions
and VR re-entry are also checked. This remains a modest optimization; a
larger gain at unchanged visual quality needs a separately validated rendering
architecture, not wider application of the failed culling experiments.

Evidence root: `/tmp/spinward-gpu-preserve-20260928/`.
Final local gate: 7 XR tests passed (4.3 minutes), including all 36 stereo
pairs with **zero changed RGBA pixels**, VR entry, wrist interaction and VR
re-entry. The independent visual review also passed all 72 eyes, including the
previously suspect 16 pixel locations. TypeScript and the fixed build passed.

Final GPU median windows (ms; the last four windows, listed separately to
retain variability):

| Place | Rejection disabled | Rejection enabled |
| --- | --- | --- |
| Shibuya | 24.42, 25.17 | 24.02, 24.00 |
| Omiya | 38.10, 38.42 | 38.15, 38.06 |

This supports a small benefit in Shibuya, not a large or universal speedup.
Omiya is effectively unchanged. The second Shibuya control window also had a
higher p95 (28.18 ms versus 24.49 ms), so a precise pooled improvement
percentage would overstate these data. No physical Quest result is inferred.

Final app inventory: `1701a25eb14fe6136189b337df1969cbc9fc86cdb4fd35f59e3a4c30b093b060`.
Package including unchanged diagnostics:
`67e7203a9c010a12c32924e31b1f99f33bbbfe5b0b8a7f4586566c1024520228`.
Data release remains
`ce65ac50fdc0bb7e8ddc3c7ce8de3f9243c5d2129ecefd4ce8a304574fa3c8f4`.


## Candidate deployment

Candidate Worker: `ec0fdd42-fcc6-4fe0-b8b0-565d093395e3`.
Previous candidate: `0668e87e-5a11-43b3-87f5-f13d69f4d396`.
Only the candidate was deployed; production/data release were not changed.
All 11 public HTML/JS/CSS app and diagnostic objects matched package SHA-256.
Public-candidate checks passed (2 tests, 1.2 minutes): Shibuya's nine stereo
poses remained pixel-identical, and VR entry, wrist controls and re-entry
worked. These are emulated hardware-GPU tests, not physical-headset results.

[Open candidate with stable logarithmic depth](https://spinward-metro-candidate.toming.workers.dev/?city=tokyo&preset=izma&depth=log).

Evidence archive:
`/Volumes/BLAZE/Spinward/inland-b-20260924/production-20260925/gpu-preserve-20260928/`.
Owned local preview servers were stopped after the checks. No commit/push was
performed; the existing shared working tree was preserved.
