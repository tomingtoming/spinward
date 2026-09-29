---
origin: ai
created: 2026-09-29
---

# Quest: keep the structural floor only beside the windows

toming asked whether the texture under Tokyo costs anything. It did. The
host cylinder's floor shell, lowered to −16 m under the real terrain, is
textured, lit and carries the Izma far-field city bake. With logarithmic
depth there is no early-Z, so it was shaded under every ground pixel while
staying hidden.

## Measurement (saturated, `qa/webxr/xr-fragment-cost.xr.mjs`)

Hiding each non-Tokyo surface below the ground (Shibuya / Omiya, share of
GPU time):

| Surface | Shibuya | Omiya |
|---|---|---|
| Floor shells at −16 m (near + far) | −8.6% | −13% |
| Window-side overlays at +0.3 m | −1% | −1% |
| Outward hull at −19.2 m | 0 | 0 |
| Izma lawn and car props | 0 | 0 |

The floor cannot simply go. The Tokyo terrain is an open sheet. At the land
edges beside the windows, sightlines pass under it and show the floor as a
thin olive band. Hiding the whole floor changed 700–8,000 pixels per view
there, and the band turned dark.

## Change

`CylinderHabitat.setFloorEdgeBand(width)` keeps only strips of that width
along each land edge; the hull stays whole. `main.ts` sets 400 m while the
Tokyo world is active and `null` otherwise, so the other colonies are
unchanged. The land walk starts at a window's end. A first version started
at 0 rad and left an extra strip mid-band where a land arc crosses 0; the new
unit test found this.

| Place | Whole floor (ms) | 400 m strips (ms) | Change |
|---|---|---|---|
| Shibuya | 7.07 | 6.65–6.75 | −5.5% |
| Omiya | 7.92–7.96 | 6.97–7.04 | −12% |

Shibuya saves less because it lies about 500 m from a land edge, so part of a
strip is on screen.

## Visual equality

Same-frame stereo comparisons of the whole floor versus 400 m strips
(Shibuya/Omiya × day/night × nine poses): at most 349 pixels changed per
image, every one by a single channel value (maximum 1). A 150 m strip showed
visible floor gaps (up to 100 channel values) and was rejected.

## Verification

- Unit: the strips stay within 400 m of the real window edges, the interior
  of every land arc is removed, the hull vertex count is unchanged, and
  `null` restores the whole floor.
- WebXR 0.3.0 on the hardware GPU: `quest-entry`, `xr-building-shells` and
  `xr-overview-visual` passed (9 tests).
- Physics builds its wall from `structuralRadius()`, not from these meshes;
  only the drawn shells changed. Physical Quest is not measured.
