---
origin: ai
created: 2026-09-18
---

# Whole-colony collision expansion

The full-colony goal remains unfinished. This increment removes two resident
copies of expanded whole-colony collision triangles. The saved Blender models,
ground geometry, facade tiles, collision boundaries and terrain heights are
unchanged. It is not yet network streaming of terrain or a new terrain LOD.

The global spatial index still holds stable descriptors and compact indexed
source data. A descriptor expands its surface only when a ground query or
Rapier needs it. Recently used surfaces retain identity; the LRU keeps at most
128 surfaces and 4 MiB of expanded Float64 coordinates. Both limits apply.
The same descriptor can be queried anywhere after eviction, which preserves
cold destination-height queries without waiting for a visual tile request.
Rapier continues to retain only its nearby bodies; it does not rebuild a body
merely because an expanded source array leaves the cache.

The projected-ray cache is weakly keyed by the expanded array. Once that array
leaves the LRU and external callers release it, its projected triangles can be
collected. The 4 MiB bound covers retained expanded coordinate buffers; it does
not claim to bound the spatial index, packed source, projected-ray objects,
temporary allocations, drawing buffers or the complete application. Individual
surfaces that exceed the byte budget are rejected before walking starts.

Four new unit cases cover cold descriptors, stable identity, least-recently-used
eviction, the independent byte ceiling, clearing, malformed/oversized input and
support preservation after traversing all 1,715 parcel approaches in both orders.
At three positions per approach, the old and new support heights are exactly
equal. The existing rendering path now skips the unnecessary collision expansion
when decoding a mesh solely for drawing.

## Browser measurements

Evidence: `qa/webxr/evidence/colony-cache-20260918/verified/`. Build hashes freeze
584 files; the colony data bundle and separate other-world bundle are unchanged
from the architecture increment. The comparison uses the same Chrome hardware
renderer (Apple M1 Pro / ANGLE Metal), locations, build geometry, viewport and
five stable page reloads, then forces V8 GC. The old evidence is under
`colony-architecture-20260918/verified/memory-and-served-build.json`.

| Location | Prior JS heap, MiB | New JS heap, MiB | Saved, MiB |
| --- | ---: | ---: | ---: |
| A civic | 228.33 | 140.54 | 87.80 |
| B campus | 228.90 | 141.11 | 87.80 |
| C market | 227.75 | 139.95 | 87.80 |
| A civic again | 228.39 | 140.58 | 87.81 |
| B campus night | 228.91 | 141.11 | 87.80 |

That is about 38% of the measured JS heap, not of total process/GPU memory.
Backing storage remains approximately 141.54–160.68 MiB, reported separately.
Three full cache-pressure sweeps expand 593,017 surface triangles each; they
reach 128 retained entries with a peak 1,990,944 coordinate bytes. After GC the
three sweep snapshots use 141.16 / 141.21 / 141.23 MiB of JS heap, with backing
storage stable at 154.33 MiB. The sweeps touch collision getters directly; they
are not a claim that a player walked the full colony. No page errors or failed
requests were recorded. Live day/night window emission and served bundle hashes
also passed. These are stable snapshots, not cold-load peak or headset measures.

To repeat the memory/cache-pressure probe against an already frozen build,
set `SPINWARD_URL` and `SPINWARD_EVIDENCE_DIR`, with the fixed inventory at
`$SPINWARD_EVIDENCE_DIR/build.json`, then run
`node qa/neighborhood-life/colony-collision-cache.mjs`.
The script verifies served hashes before comparing snapshots.

Desktop verification captures the centres of all three strips and the whole
colony, each day/night: eight views, with empty error/request-failure lists.
Short refresh-limited frame samples remain near 16.7 ms median; this is not a
continuous-travel or physical Quest performance benchmark.

Final verification: **1,131 unit tests passed** across 192 files (593.97 s),
and TypeScript/production build passed. Rebuilding after the browser checks
reproduces all 584 frozen file hashes. The checked-in measurement script also
passed a repeat run under `verified/repeat-memory/`, retaining the approximately
88 MiB JS-heap reduction and the same backing-storage ceiling.

**13 XR cases passed in 6.4 minutes** with playwright-webxr **0.3.0**, hardware
rendering, 1,280 × 960 per eye and 64 mm IPD. They cover stairs down/back uphill,
a relocated entrance, a balcony guard, three district walks, the original-study
boundary, three motorway decks/parapets, the 420 m route/shop, night wrist/lighting
and four-world wrist switching. Ten cases now assert the cache entry/byte limits
alongside live support and movement. Across their 249 recorded states, the cache
holds at most 17 meshes / 248,544 coordinate bytes. The all-surface pressure
sweeps, rather than these short walks, exercise actual LRU eviction.
All thirteen page-error lists and twelve recorded resource-failure lists are
empty; the night case has no resource-failure list.

Independent review compares eight desktop and three XR images with the previous
versions. It finds no new large ground/overhead omissions, one-eye-only missing
surfaces or clear shift below the floor. The visible stairs, entrance paving
and balcony floor persist in both eyes. The body hides the floor directly under
it; exact contact, intermediate frames and physical VR comfort are outside that
image verdict. Existing fine green road-junction seams and dark night paving
remain. Desktop comparison uses the preceding pre-frontage images, so the known
earlier pavement-extension changes are not attributed to this cache increment.
Physical-headset performance and comfort remain unmeasured.

## Remaining whole-colony work

The source manifest is still large and resident. Terrain/access render geometry,
compact collision inputs and the global index still need spatial delivery and
appropriate distant representations. This CPU-memory improvement does not
complete that requirement. Sparse street-frontage rows, incomplete exterior
spaces, station/rail/inter-strip travel and new building interiors also remain.
No push, merge, deploy or scheduled task is part of this increment.
