---
origin: ai
created: 2026-09-18
---

# Colony data loading

The authored colony no longer embeds its complete 105 MB native manifest in a
JavaScript module. The same geometry is stored as ordinary, content-addressed
JSON parts, read by both native Blender scripts and the browser. This changes
storage and startup assembly; **region-dependent terrain/collision residency
remains unfinished**. The reader currently assembles the complete colony before
publishing it to the scene. It does not expose partially loaded ground.

## Storage and integrity

The previous 105,583,584-byte manifest becomes a 1,175,779-byte index and **67
parts**, each at most **2,097,152 bytes**. Parts contain ordinary arrays/objects,
with no numeric compression or quantization. Array slices preserve their order
and native float/int representation. A native round trip restores the exact
original bytes, SHA-256
`696f86943ba2177e6bb2caa1c643d0175c60e64868f9a00036696b5182cfcb47`.
An isolated Blender CLI also reads the package and verifies the saved terrain
hash against the neighbourhood contract; its scene is not modified.

All colony native builders/exporters use `colony_manifest_io.py`. The writer
verifies the real reader's reconstruction before atomically replacing the index.
Parts have immutable content-addressed names; a mismatched existing file is an
error. Old inline manifests remain readable. Geometry audits assemble all parts
through `qa/neighborhood-life/colony-source.ts`, using the same browser reader.

The browser fetches at most three data parts concurrently and checks each part's
length and SHA-256 before parsing it. Corruption, missing parts and cancellation
reject the assembly; a failure aborts the remaining requests. The failure screen
explains that the colony could not load and provides Reload. It does not suggest
that a missing scene file establishes a WebGL/WASM failure.

The JavaScript data chunk decreases from 105,301,484 to **1,175,135 bytes**. The
67 JSON responses still have to be downloaded. Sum-of-files gzip is essentially
unchanged: **24,693,268 → 24,691,867 bytes**, including the new index. These are
offline gzip sizes, not measured internet transfer or CDN compression behavior.

## Matched local startup measurement

`colony-startup.mjs` compares the same app and geometry with an inline-manifest
build and the partitioned build. Each format uses three fresh Chrome contexts,
cache disabled, alternating order, Apple M1 Pro / ANGLE Metal. Both local HTTPS
previews use the same public assets. No full CPU unit suite runs during this
measurement. The comparison precedes the later failure-message refinement;
the normal data/scene path remains the same.

| Measurement | Inline | JSON parts |
|---|---:|---:|
| Ready time, median | 6.203 s | 3.854 s |
| Ready time, range | 6.150–6.523 s | 3.828–3.900 s |
| Forced-GC JS heap | 297.13–297.20 MiB | 194.19–194.26 MiB |
| Separate backing storage | 248.29 MiB | 149.00 MiB |

The heap and backing-storage numbers are separate Chrome counters, not total
process/GPU memory. The local measurement does not establish remote-network or
physical-headset performance. It demonstrates the cost of retaining the large
JavaScript data module. The root inspected the paired desktop screenshots:
the bridge, terrain and building placement agree; small live lighting/HUD
differences are present.

## Verification and remaining scope

The full suite passes **1,160 tests across 200 files**. Five focused reader tests
cover out-of-order responses, concurrency, integrity, missing/truncated data,
cancellation, invalid references, array assembly and legacy input. Four native
persistence tests also pass, checking exact numeric restoration, deterministic
re-export, corruption detection and retention of the last complete index after
a failed export. Run them with
`python3 -m unittest discover -s assets/blender -p test_colony_manifest_io.py`.
Production build passes. The initial three WebXR 0.3.0 cases pass
in 54.4 seconds: missing/corrupt data prevents partial startup, Reload recovers
real VR entry, and the four-world/wrist regression passes. That run exposed the
misleading generic failure explanation, which was then refined. All **three
final cases pass in 59.8 seconds**, including an assertion on the specific error
message, actual VR re-entry and the four-world/wrist sequence. Served HTML and
all three JS bundle hashes match before/after the final run. Physical-headset
performance and comfort are unmeasured.

The geometry is byte-identical to the [verified interior-passage model](colony-block-depth.md#interior-passages).
That model's 72 day/night views and three complete interior walks remain evidence
of its shape, not evidence of the new data-loading path. The new path has its own
startup/failure/VR checks. No additional facades, usable interiors or roads are
claimed by this storage increment.

Next, separate the complete drawing/collision data into spatial regions with
shared boundaries and bounded residency. Synchronous ground queries currently
assume that every surface is immediately available, so local loading must be
connected to arrival, walking, free flight and rail travel before any global
collision source is removed. A slow request must not turn a floor into a hole.
The current change does not yet implement that regional readiness contract.

A read-only partition study groups the current drawing and complete collision
compounds into 1,887 regions of 512 m. It verifies the drawing triangle multiset
(including material/winding) and every collision compound's identity, bounds,
triangle order and grounding flag. The combined region payloads total 79.09 MB,
with the largest at 1.74 MB. At eighteen public destinations, regions intersecting
the local 256 m radius require 0.38–4.42 MB and at most six regions. This is a
payload estimate, not an integrated cache, performance measurement, terrain LOD
or proof of travel safety. `spatial-region-probe.json` retains the result.

Evidence: `qa/webxr/evidence/colony-data-parts-20260918/`, including
`manifest-inline.json` (verified recovery source), `partition.json`,
`native-read.json`, `transfer-size.json`, `startup-summary.json` and
`startup/startup.json`. The temporary baseline preview was stopped using its
recorded PID; the normal 5192 preview remains available. Local work only;
no push, merge, deployment or scheduler was created.
