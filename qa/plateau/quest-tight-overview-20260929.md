---
origin: ai
created: 2026-09-29
---

# Quest: conservative district-frustum culling

The user reports that the previous candidate helped physical Quest performance,
but requests further improvement. This is user feedback, not a measured headset
frame rate. Preserve full XR framebuffer scale, logarithmic depth, source models,
lighting, atmosphere and the existing distance budgets.

## Final implementation

`overview-chunks.js` tests indexed chunk bounding boxes in the district's local
frame against both eye frusta. A chunk stays eligible when either eye sees it.
A one-metre conservative margin absorbs matrix rounding at screen edges. The
existing whole/partition draw hierarchy remains; within the partition branch,
exclude the individually offscreen chunks instead of relying on their much
looser spherical bounds. Empty index ranges stay hidden. No geometry, material,
shader, fog or depth encoding changes are included.

The only production source delta from the previously deployed snapshot is this
module. New tests cover slender blocks whose spheres admit offscreen geometry,
colony transforms, either-eye visibility, turns and return to whole-district
rendering. Unit checks: 20 passed / 230 assertions across six relevant suites.
TypeScript and the immutable production build also pass.

## Validation and limits

The preliminary unpadded version preserved all pixels in 36 same-frame stereo
comparisons (Shibuya/Omiya, day/night, nine ground/flying poses). Submitted
triangles fell by 0–19.4% across those views; this is not an FPS percentage.
Head-forward changes were zero in Shibuya and approximately 0.5% in Omiya,
with no clear desktop GPU timing benefit in those forward views.

Final padded-build stereo comparisons, turned-head GPU timings and candidate
readback results appear below. Hardware preflight rejects
software renderers. Testing uses playwright-webxr 0.3.0 with 2560×960 stereo,
constant city detail, scale 1 and logarithmic depth. GPU queries enclose the
complete render; they do not add per-draw synchronization. Comparisons toggle
the exact old sphere-selection logic, leaving geometry and shaders unchanged.
Warm-up and settling frames precede measurements; the first two timing windows
are excluded from the summary. Physical Quest GPU performance, thermal
stability and temporal flicker remain unmeasured by these desktop tests.

## Experiments excluded from deployment

- Near/far stencil rendering: keeps the original far logarithmic-depth formula,
  but adds CPU submission work. The tighter-frustum trial increased Shibuya
  GPU medians from about 25–26 ms to 36–37 ms. Rejected. Omiya's 300-frame
  warm-up exceeded the harness's 10-second wait, so that run provides no result.
- Bounded short-ray haze quadrature: 14,400 CPU rays remained within the
  1/65536 optical-depth budget, but the desktop GPU results did not establish
  a worthwhile improvement. Rejected; all haze and app changes were restored.
- Ownership-index compaction was inspected but not implemented: the probe
  showed little covered overview geometry in the measured Quest views.

Prototypes, logs and immutable builds are in
`/tmp/spinward-xr-occlusion-20260929/`. Rejected source lives under `rejected/`;
only `build-final` and `package-final` are deployment inputs. All diagnostics
are copied unchanged from the previous candidate. No data release changes,
production deployment, git commit or push are part of this increment.

Application inventory: `e6f447855c283ca47bb2a57101e5e9782f51d341b263b53178dc3b103cd2c4f7`.
Package inventory including existing diagnostics:
`e555f8056e4451dd44a5e09f18b3b2f6a9f42529adb1dbd2033c52aa35b06254`.
Immutable data release remains
`ce65ac50fdc0bb7e8ddc3c7ce8de3f9243c5d2129ecefd4ce8a304574fa3c8f4`.

## Final local results

Seven WebXR checks passed (5.4 minutes). All 36 stereo pairs / 72 eyes retained
zero changed pixels, including the padded bounds. Maximum submitted triangle
reduction across those poses was 19.4%. Wrist interaction and VR re-entry passed.

Turned-head GPU timings (Apple M1 Pro; two warmed windows per mode):

| Scene | Old bounds (ms) | Tight bounds (ms) | Submitted triangles |
|---|---|---|---|
| shibuya | 26.35, 26.61 | 26.03, 26.43 | 1121174 → 918526 |
| omiya | 33.79, 34.18 | 33.33, 33.31 | 1905962 → 1668068 |

Desktop GPU gains are modest (roughly 1–2% in these turned views), despite
the larger geometry reduction. This does not establish a Quest FPS gain.

Independent image review rechecked all 36 pairs / 72 eyes, including native-size
crops of screen edges, rooftops, ground and opposite/overhead city bands. All
RGBA pixels and PNG hashes matched. Omiya's near wall occludes much of one
forward view in both modes; other views cover the city. Mode independence is
confirmed separately by changed submitted triangle counts in each image group.
See `visual-review.md` and `independent-review/` in the evidence directory.


## Candidate rollout

Deployed only `spinward-metro-candidate`, version
`6760f1e9-a694-416b-9518-52200dd4aec2`, replacing
`ec0fdd42-fcc6-4fe0-b8b0-565d093395e3`. Five changed assets were uploaded; 115
existing served assets were reused. All 11 public HTML/JS/CSS files matched
`package-final` hashes, including the unchanged diagnostics. An initial urllib
readback received HTTP 403; Node fetch with a browser User-Agent completed the
hash verification. No server-side failure is inferred from that client result.

Two checks passed against the public candidate (1.7 minutes): actual VR entry,
controller-operated wrist UI and re-entry, plus Omiya's nine same-frame stereo
comparisons with zero changed pixels and scale 1 / logarithmic depth asserted.

All preview servers started for this increment were stopped. No commit or push.
Evidence archive:
`/Volumes/BLAZE/Spinward/inland-b-20260924/production-20260925/quest-tight-overview-20260929/`.
