---
origin: ai
created: 2026-09-28
---

# Full reference resolution with adaptive XR distance detail

The user accepted 85% clarity on Quest, then preferred 100% resolution with
adaptive distant scenery. Standalone framebuffer scale now defaults to 1;
finite explicit `xrScale` overrides in [0.7, 1] remain available after reload.
No-MSAA and fixed foveation=1 remain. "100%" means the XR runtime's reference
framebuffer dimensions, not full-resolution peripheral shading or panel pixels.

## Feedback and quality scope

- Read the XR animation timestamp, independently of the physics delta clamp.
  Use session.frameRate when available; fallback 72 Hz standalone / 90 Hz other.
- Wait three seconds after entry, readiness changes, or each quality change.
  Over two-second windows, two windows with >12% late frames lower distance
  detail one step. Eight windows with <2% late frames trial one step higher.
  A late frame is an interval >1.35 times the target interval.
- Exclude hidden/blurred XR sessions, incomplete arrivals and gaps >250 ms.
  Ordinary continuous streaming does not disable the controller indefinitely.
  Exit restores original flat-view detail. Re-entry starts at full detail.
- Three levels: original distance; 75% optional distant stream/lowrise range
  plus terrain LOD beyond ~1.4 km; 50% range plus terrain LOD beyond ~650 m.
  Terrain selection has 10% distance hysteresis. Cache decisions until moving
  25 m or changing the level; do not scan on every head rotation.
- Terrain LOD is prepared once in the existing worker pool. meshoptimizer
  preserves each ownership tile's boundary edges and uses a 0.35 m approximate
  projected-space error cap. All original vertex attributes, normals, UVs,
  coverage IDs, source arrays and collision data stay intact. Switching quality
  selects precomputed index ranges; it does not download a different release.
- Near tile/facade/physics budgets are unchanged. Buildings retain their original
  skyline geometry; some distant lowrise silhouettes flatten into the existing
  textured overview when their optional detail range shrinks.

This is a bounded workload controller, not GPU utilization measurement. At the
lowest detail it reports `detail-floor` if misses continue; it never silently
reduces resolution. FPS is not guaranteed. Compared with 85%, 100% requests
38.4% more pixels, and the measured triangle saving below does not imply an
identical saving in frame time or memory.

## Verification

- 27 focused unit tests pass; TypeScript and production metro build pass.
  Coverage includes cadence at 72/90 Hz, recovery, startup/visibility pauses,
  source immutability, ownership restoration, stream disposal and retries.
- Offline audit of the current release: 30 districts / 10,200 terrain tiles.
  Every source boundary edge is identical in its coarse version. Total terrain
  indices 7,088,400 -> 5,988,444 (15.5% reduction if all terrain uses coarse LOD).
  Largest simplifier-reported error: 0.3499975 m. This is not a ground-height
  collision error; collision stays exact. No entire-city performance claim.
- `playwright-webxr` 0.3.0, Chrome / Apple M1 Pro / ANGLE Metal, with software-GPU
  rejection. Actual VR entry, framebuffer allocation options and re-entry.
- Fixed camera comparisons cover Shibuya day and Omiya day/night at levels
  0 -> 2 -> 0, both eyes. Near resident IDs and geometry index counts match.
  A separate test synthesizes XR callback timestamps to prove the real feedback
  wiring lowers detail, recovers, and resets. It is not a GPU benchmark.
- IWER still allocates 2560 x 960 at all requested framebuffer scales. Native
  Quest resolution, thermal behavior and frame-rate acceptance require the
  physical device; only requested settings and emulator behavior are proven.

Final-build comparison (same 100% requested scale for both levels):

| Scene/view | Full detail triangles | Lowest detail triangles | Reduction |
|---|---:|---:|---:|
| Shibuya street | 918,108 | 915,756 | 0.3% |
| Shibuya overhead | 1,287,812 | 1,265,684 | 1.7% |
| Omiya street | 6,104,400 | 5,580,852 | 8.6% |
| Omiya overhead | 4,630,416 | 4,177,892 | 9.8% |

Recovery returned these daytime triangle and draw counts to the baseline.
Independent visual review uses observation-before-judgment and records small
reversible distant silhouette changes. The welcome card is not a stable visual
reference: unchanged `tourGuide.ts` expires it after nine seconds, and unchanged
`tourCardPanel.ts` follows the head with interpolated position/orientation.

The extra precomputed coarse indices retain approximately 24 MB of CPU arrays
across all 30 districts. They reuse the original GPU index-buffer allocations
and vertex attributes; this increment does not claim a total-memory reduction.

Final frozen-build XR suite: 7/7 passing. The final daytime counts match the
initial visual-review build after a stationary-selection caching change.
The independent reviewer found no new near-window, visible-ground or one-eye
loss across 18 images; a small distant silhouette flattening is reversible.
Three-band continuity outside the screenshot views remains unverified.

## Distribution and evidence

Only the existing public candidate is in scope. Production, the data CDN
release, source PLATEAU data and shared model package are unchanged. No commit
or repository push in this increment.

Application inventory SHA-256:
`d75289938d0b744baaf49bea507cce164c0510dc5256565020e524750dab4b2e`.
With the unchanged diagnostic page (122 files):
`70da6c0d231782f21b7fec8c7a1386587f2072a28e6cec9ecb73881de67bc469`.

Working evidence: `/tmp/spinward-xr-adaptive-20260928/`.
Retained evidence destination:
`/Volumes/BLAZE/Spinward/inland-b-20260924/production-20260925/xr-adaptive-20260928/`.

Published candidate Worker: `494f2a92-48b4-4016-acc0-7dae0ff7943e`.

Public URL verification: 2/2 tests pass (48.8 s): default full-resolution
allocation/re-entry and actual feedback wiring with synthetic cadence. Twelve
published HTML/JS/CSS/worker/diagnostic files match the frozen package hashes.
Both temporary local preview servers were stopped after acceptance.
