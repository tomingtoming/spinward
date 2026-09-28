---
origin: ai
created: 2026-09-26
---

# Quest city rendering budget

The user recovered VR entry by clearing Quest 3S browsing history, then reported
that the city experience was heavy. That observation establishes entry recovery,
not an OOM diagnosis. This increment reduces ongoing rendering/residency cost.

## Implementation

- Apply a Quest-specific budget to the streamed Tokyo city, independently of the
  existing framebuffer profile. Desktop/phone keep the previous city defaults.
- Bound near/far/lowrise/night-pane residency and concurrent loads separately.
  Native collision/terrain sources remain exact; eviction restores overview ownership.
- Keep facade catalog coverage unchanged (24 source tiles in this release).
  Window/glazing near geometry retains authored outward glass/frame/sill faces;
  thin back/edge faces are omitted. Middle-distance panels and solid entrances,
  balconies, guards, signs and station details retain their existing paths.
- Scan facade LOD at most every 100 ms, independently of head-pose rendering.
- Partition overview ownership tiles into groups up to 2 km across, preserving
  every triangle and shared vertex/material/texture buffers. Use the partition
  only when at least half the groups are outside the **union of both eye frusta**;
  otherwise draw the whole district in one call. This avoids multiplying draw
  calls for the fully visible distant bands.
- Decode overview textures at half width/height; immediately close the original
  bitmap after resize, including error paths. Nearby surface textures retain
  their original resolution. All three bands and the immutable data release remain.

## Fixed-condition comparison

Hardware GPU: Apple M1 Pro / ANGLE Metal. playwright-webxr 0.3.0, stereo canvas
2560 x 960, Quest tier, identical poses, daylight cycle paused at startup.
Counts include both eyes; these are **not measured Quest frame rates**.

| Place/view | Before triangles | After triangles | Reduction | Draw calls before → after |
|---|---:|---:|---:|---:|
| Shibuya street | 2,356,632 | 918,108 | 61.0% | 512 → 478 |
| Shibuya overhead | 3,088,970 | 1,287,812 | 58.3% | 670 → 514 |
| Shibuya walked | 2,240,188 | 865,222 | 61.4% | 488 → 448 |
| Omiya street | 7,107,828 | 6,104,400 | 14.1% | 598 → 558 |
| Omiya overhead | 7,462,274 | 4,630,416 | 37.9% | 838 → 660 |
| Omiya walked | 7,113,352 | 6,107,482 | 14.1% | 602 → 562 |

After viewing overhead, the tracked texture estimate falls from ~208 MB to
~99 MB. Tracked geometry attribute/index arrays rise from ~199–202 MB to
~224–226 MB because the overview holds whole and partitioned index buffers.
The combined tracked categories are about 20% smaller. These are partial counts,
not total CPU memory, GPU memory, peak upload allocations or an OOM threshold.
Texture estimates include RGBA+mip assumptions; geometry counts omit several
runtime allocations. Do not add them into a claim about total headset RAM.

Omiya still submits over six million triangles in its ground view. Whole-city
terrain/skyline cost remains material; this increment does not establish a
comfortable or sustained headset frame rate.

## Validation and discarded experiments

- 54 focused unit tests pass (city streams, ownership, stereo-union hierarchy,
  bitmap cleanup, facade instance identity/lights, render profile and quality).
- TypeScript and frozen metro production build pass.
- Day/night stereo ground, overhead and walking: four final-candidate cases pass.
- Five existing regressions pass: west-band walk/jump/flight/landing, Omiya and
  Saitama-Shintoshin source-ground support/walking, actual controller-operated
  wrist Places through palace/Ikebukuro/Omiya/Shibuya, and stereo facade angle
  sweeps. The arrival ground matches rendered terrain within the test's 8 cm
  tolerance. The station-district tests do not identify every station facade.
- Desktop city profile passes the same three-view/walking probe. Its submitted
  triangle and draw-call counts exactly match the baseline Shibuya views.
- Independent visual audit: both eyes retain visible city bands, windows, roads
  and ground; no large new holes, duplicate stripes or black regions. Night
  windows remain lit. Thin oblique window/glass edges are more jagged: a known
  small quality tradeoff. Static images cannot establish flicker or real-headset
  stereo comfort. Station identity is not visible in these comparison images.
- The full unit suite was attempted, but the unchanged procedural transport
  test `motorway parapets leave each ordinary road approach open` exceeded its
  5-second timeout (29.5 s). The run was stopped at `nativeDistricts`. It is not
  a full-suite pass; no claim is made that this broad failure was caused or fixed
  by the Tokyo changes.
- Early v1/v2 facade budgets wrongly retained four source tiles instead of 24,
  dropping nearby windows. Those variants and their inflated reduction claims
  were rejected. Early screenshots also let the day cycle drift; comparisons
  use `baseline-frozen` and `v5-qa` instead.
- Always drawing partitioned overviews (v4) increased Omiya draw calls from 598
  to 786. The final whole/partition hierarchy avoids that regression.
- Read-only mesh simplification experiments were not adopted: preserving exact
  tile borders gave too little reduction; whole-district simplification would
  lose the ownership/seam contract. No terrain decimation is shipped.

## Package and scope

Application inventory SHA-256:
`cc5a02fd8eddb4e48f6d52b545ce210f01d65ee3ccd1af0dfe017f8a43a77f91`.
Including unchanged diagnostic page:
`a136a54030967db34590e438ca7bd9e8e1d8c61109f87acdb9781fe3138eb0ca`.
All shared assets and six diagnostic files match the preceding candidate.
Data release remains
`ce65ac50fdc0bb7e8ddc3c7ce8de3f9243c5d2129ecefd4ce8a304574fa3c8f4`.
Only the candidate is eligible for this update; production cutover and source
repository push are outside this increment. Physical Quest comfort remains
unconfirmed until the user retries the candidate.

Candidate Worker version: `babb83aa-5c17-4a40-b9a2-b29b2fb2c729`.
Published HTML, generated JS/CSS, tile worker and diagnostic HTML (seven files)
were read back and matched against the frozen package hashes. The package
contains exactly its 121 inventoried files; Wrangler's reported 142 entries
include the 21 directories.
The deployed candidate also passes stereo ground/overhead/walking and actual
VR exit/re-entry (46.6 s). Its Shibuya triangle/draw-call counts match the final
local run exactly. This remains hardware-GPU desktop emulation, not Quest QA.

Evidence and source snapshots are retained at
`/Volumes/BLAZE/Spinward/inland-b-20260924/production-20260925/quest-budget-20260926/`.
