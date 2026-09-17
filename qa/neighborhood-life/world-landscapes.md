---
origin: ai
created: 2026-09-17
---

# Authored landscape study checks

Scope and editing workflow: [authored worlds](../../docs/authored-worlds.md).
Evidence is local and ignored by git under
`qa/webxr/evidence/world-landscapes-20260917/`.

## Repeatable checks

```sh
SPINWARD_URL=<production-preview-url> node qa/neighborhood-life/world-landscapes.mjs
SPINWARD_URL=<production-preview-url> bun run test:xr qa/webxr/world-landscapes.xr.mjs
```

Both scripts require Chrome hardware acceleration and reject software GPU
backends. The desktop script walks the three districts, captures street and
overview images, then uses the preset menu to switch all four habitats. The XR
test enters the app's VR mode, uses ray/trigger input on the wrist menu, walks
after each preset change, compares the actual drawn floor with the physics
body, captures stereo roll frames, and returns through Playground to Izma.

## Findings and fixes

Independent image review found these defects during the increment:

- Izma's west lane was buried in places. Long terrain triangles projected
  through the cylinder above the more finely divided road. Bounded terrain
  edges and road clipping against the actual terrain triangles fixed it.
- Elysium's path crossed a terrain crest between its sampled edges. Clipping
  the road faces against the terrain fixed the geometric intersection.
- Walking after preset changes could fall under the whole district. The
  rendered frame reset to zero but the retained collision body kept rotating
  from its previous phase. A Rapier regression reproduced a 351.9 m lateral
  offset after two seconds of rotation. Rebuild now synchronizes the city
  collision body's phase; habitat synchronization also aligns the hull.
- The first XR assertions missed that fall because the hull below was also
  `grounded`. The test now checks clearance from the actual rendered floor.
- Cooper's ballfield was difficult to identify. Foul lines and an outfield
  arc made the coarse diamond legible.

Elysium's near-eye screenshot still has a thin, dark edge where a downhill
path passes behind the intervening crest. This was investigated separately:
all road and walk face centroids lie above the projected terrain (minimum
clearance 7.7 cm), hiding the terrain reveals the continuing path, and raising
the viewpoint shows its full width. The evidence images are
`elysium-no-earth.png` and `elysium-above-crest.png`. This is occlusion of the
coarse terrain, rather than the previously buried road faces. Refining the
terrain silhouette remains part of subsequent visual work.

## Recorded validation

- Full unit suite: **1,084 passed**, before final geometry and phase refinements
  (`unit.log`).
- Final geometry/runtime/wrist focused run: **33 passed** (`focused-final.log`).
- After the collision-phase fix, terrain, collider streaming, hull/expressway,
  player traversal and runtime checks: **44 passed** (`physics-final.log`).
- TypeScript and Vite production build passed after the phase fix
  (`build-final.log`).
- Final desktop run: all three worlds walked 4.49 / 4.49 / 4.54 m, all four
  preset selections succeeded, no page errors (`grounding/desktop.json`).
- Final XR run: **3 passed** in 1.6 minutes (`xr-grounding/`). This includes
  ordinary-city wrist UI, input ownership and session return through both
  desktop and Quest-UA entry paths, plus the authored-landscape stereo test.
  The latter walked 7.10 / 7.21 / 7.21 m in Izma / Cooper / Elysium and 7.10 m
  after returning to Izma. At the end of each walk, body-centre clearance above
  the actual drawn floor was 0.314–0.319 m; ground-sampler disagreement was at
  most 6.3 mm. No page
  errors or failed resource requests occurred in that test.
- Hardware: Apple M1 Pro, ANGLE Metal. XR uses playwright-webxr **0.3.0** with
  IWER's Meta Quest 3 profile; stereo uses two 1280 × 960 eye views and 64 mm IPD.
- `build.json` and `served-build.json` record matching SHA-256 hashes of the
  local build and preview responses. Study data is a separate 808 kB gzip
  chunk; the main application's build retains its existing large-chunk warning.
- A fresh ordinary Izma page reached `grounded` without requesting the study
  chunk (`ordinary-loading.json`).
- Independent final image review confirmed that the Elysium underground view
  was gone, both eye views were coherent after roll, and Izma remained on its
  bridge after returning through Playground. The raised-viewpoint comparison
  resolved the remaining path-burial suspicion. Tracking a path beyond a coarse
  crest remains visually difficult from the low starting viewpoint.

These checks cover the named routes, viewpoints and interactions. They do not
establish complete district accessibility, finished visual quality, physical
Quest frame rate, stereo comfort, or a reproduction of the films' geography.
