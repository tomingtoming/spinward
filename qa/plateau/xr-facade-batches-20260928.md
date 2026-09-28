---
origin: ai
created: 2026-09-28
---

# Quest: stationary head motion and facade draw submission

The user reports that Quest 3S remains slow while standing still and turning
their head. Keep the requested 100% XR framebuffer scale. This increment
reduces submission overhead without removing nearby windows or changing the
existing distant-detail governor.

## Change

Quest facade rendering now packs visible source instances by prototype and
material. Both XR eye frusta select the original chunk spheres before packing;
a large combined sphere does not admit extra off-screen neighbours. Preserve
the instance matrix, colour, size, frame, surface/owner and light attributes.
Source chunks still own distance LOD, recipes, streaming and collision. A
preparing site is excluded; eviction releases packed copies before source
geometry. Stable selection does not upload the buffers again. Capacity is
reused when the player turns. Additional packed instance buffers are the
memory tradeoff; this is not a memory-reduction claim.

Desktop uses its existing source batches. Quest retains full resolution,
existing window geometry, near contacts, night lighting, source residency and
adaptive distant detail.

## Measurements

Apple M1 Pro / ANGLE Metal, Chrome, playwright-webxr 0.3.0 / IWER stereo,
2560 × 960. These are **not physical Quest frame times**. Hold actual city
detail at level 2 in the QA harness. In one build, the control temporarily
restores original source draw submission; the second render uses batching.

| Scene / pose | Calls before → after | Render submission median, ms | Triangles before → after |
|---|---:|---:|---:|
| Shibuya day, turned | 456 → 126 | 2.3 → 1.8 | 1,112,234 → 1,112,234 |
| Shibuya day, overhead | 512 → 144 | 2.5 → 1.9 | 1,265,680 → 1,265,680 |
| Omiya day, street | 552 → 242 | 2.9 → 2.5 | 5,580,848 → 5,580,848 |
| Omiya day, turned | 630 → 168 | 2.8 → 2.1 | 1,897,022 → 1,897,022 |
| Omiya night, turned | 650 → 188 | 2.9 → 2.1 | 2,003,422 → 2,003,422 |

Raw JSON contains all nine poses. The first Shibuya street pair has a small
triangle-count change between time-separated samples; do not use it as an
exact geometry comparison. GPU query recordings are diagnostic only: the
baseline Omiya run overlapped another Chrome run and cannot establish a GPU
speedup. The defensible result is fewer draws and lower measured CPU submission
time, not a demonstrated physical Quest FPS increase.

A 400 m overview-chunk experiment was rejected. Relative to 2 km chunks,
Shibuya lost only about 6% of submitted triangles while render submission rose
from 1.9 to 4.3 ms; Omiya lost about 2% while submission rose from 2.6 to 4.8 ms.
The deployed version retains 2 km overview chunks. Terrain error was also
explored offline; no terrain-LOD geometry change ships in this increment.

## Validation

- 25 targeted unit tests; TypeScript check; metro build. Contracts include
  every packed attribute/owner, stereo culling, stable upload count, prepared
  sites, near/mid/far replacement and eviction.
- Six final local XR cases: default/manual resolution and reentry, Shibuya
  day, Omiya day/night. Each scenery case includes street, turned and overhead
  views, unchanged near residency, no context loss, and no page/shader errors.
- Independent visual review: no missing window groups, frames, signs, road
  areas, distant terrain or night colour patterns in the visible regions of
  the 18 stereo images. Omiya's close wall limits what is visible in street
  views. Continuous motion and physical stereo comfort are not certified.
- The reviewer noticed a 2–6 px wall-edge difference in time-separated
  captures. A follow-up renders both versions synchronously with exactly the
  same scene/cameras and reads the XR framebuffer. Omiya day, turned view:
  2560 × 960, **zero differing RGB pixels**; independent image inspection and
  comparison confirm a normal nonblank scene. This establishes equivalence
  for that pose, not pixel identity across every location and animation.
- An initial QA wait requested 600 frames within a 10 s timeout and failed;
  corrected to 30 s. This was a harness deadline, not a rendering failure.
- Rebuilding restored source after the rejected experiment produced identical
  hashes for all eight frozen build outputs checked.

## Candidate delivery

Candidate: https://spinward-metro-candidate.toming.workers.dev/?city=tokyo&preset=izma

Worker version: `d31d0d5f-2161-4199-9ecd-7cf8d0b8358d`.
Application inventory: `bb6597a6a0274c907d88234cf021d7603be0c1521c56c95499ee6730e67eac63`.
With unchanged diagnostics: `fa2499c268b7a6f97bdf82dd878c1938ff4508a79a225f163609a30711a550a1` (122 packaged files).
Eleven public HTML/JS/CSS files match the staged hashes, including the unchanged
diagnostic page. Two public XR cases pass: default 100% allocation/reentry and
Omiya's three-view comparison, including the zero-difference same-frame check.
Production routes and immutable city data are unchanged.
No commit or push was performed.

Evidence: `/tmp/spinward-xr-cost-20260928/`, retained at
`/Volumes/BLAZE/Spinward/inland-b-20260924/production-20260925/xr-cost-20260928/`.
Key files: `final-xr.log`, `final-xr/*/batches.json`, `same-frame/`,
`visual-review.md`, `public-xr.log`, `readback.json`, `source.json`,
`changes.patch`, `package/inventory.json` and `deploy.log`.

Physical Quest testing is still required. If head motion remains slow, this
draw-call reduction should not be presented as a complete fix: GPU pixel and
overview costs remain, and require separate device evidence.
