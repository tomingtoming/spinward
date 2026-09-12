---
origin: ai
created: 2026-09-13
---
# Rain shelter checks

Use the owning production preview with a fixed build. The browser scripts
reject software GPU rendering and close their own browsers.

```sh
SPINWARD_URL=https://127.0.0.1:5192 LABEL=final WALK=1 node qa/neighborhood-life/rain-public.mjs
node qa/neighborhood-life/rain-shader.mjs
SPINWARD_URL=https://127.0.0.1:5192 bun run test:xr
```

`rain-public.mjs` records three rainy frames per location: grass beneath the
viaduct beside the public path, outside it, beneath the river bridge, and on
the viaduct deck. Its final W-input route starts on the 0.34m public path and
walks south into open weather. It records the actual support height, rain field
strength, shelter and audio multiplier; it does not move by writing game state.
Rain strength stays one while the direct sound multiplier changes from .45
under open-sided cover to one outside. The unchanged Web Audio stage glides
its gain/frequency over 0.25 seconds. These state checks are not an acoustic
assessment through headphones or a headset.

`rain-shader.mjs` bundles `rain-shader.ts` into a uniquely named temporary
file, then renders the real application rain shader into a 128×128 GPU target.
Each case first renders an exposed positive-control streak (40–45 lit pixels),
then applies the real roof uniforms. Cases cover the ring, opposite land strip,
±π seam, ramps, merge shelves, rotated bridge edges, roofs above/below and an
entire streak crossing a roof boundary. A blank/broken shader cannot pass:
exposed controls must remain visible. It tests rasterized shader output, not a
second CPU implementation of the shader. Its deterministic seeds/uniforms are
isolated test fixtures; they are never written into the running game.

Roof masks follow radial cover and are an approximation of shelter. They do
not simulate wind-driven drops, roof runoff, puddles or wet materials. The
ramp apron at street height is not a rain shelter for standing pedestrians.
The public cover does not turn the space into an enclosed room. Existing
indoor audio attenuation remains stronger.

Rain remains one draw call. The viaduct uses seven analytic arc masks in a
separate fixed budget of eight; indoor/bridge rectangles keep their budget of
sixteen. The river bridge now uses one rotated footprint instead of twelve
inscribed rectangles, covering the side wedges as well as the central bank.
No meshes, point lights, asset downloads or reflection passes were added.

Local evidence prefixes are `rain-desktop-before-*`, `rain-desktop-after-*`
(initial implementation), `rain-desktop-final-*`, and `rain-shader-result.json`.
They are ignored by git. The source scripts and assertions are versioned.

The first XR run found an overly strict equality assertion in the river fixture:
1.2000000000000002 versus 1.2 metres failed despite identical transforms. Ground
height now has a sub-micrometre tolerance; matrices and asset readiness remain
exact comparisons. This was test precision, not a terrain or playwright-webxr
0.2.0 failure. The initial trace is retained in
`qa/webxr/evidence/rain-initial-20260913/`.

Final validation on 2026-09-13 passed 837 unit tests, TypeScript/production
build, all 20 GPU cases, and the desktop four-view/15.13m walk checks without
browser errors. The complete playwright-webxr 0.2.0 suite passed six tests,
eight immersive sessions and eight asserted exits in 1.7 minutes. The covered
walk now runs in rain at the Quest city budget, with stereo 64mm IPD and head
roll 0/±25°. Its diagnostics report shelter one and audibility .45, two
1280×960 eyes and a 2560×960 canvas. Evidence is preserved in
`qa/webxr/evidence/rain-20260913/`.

The browser/XR checks used Apple M1 Pro / ANGLE Metal and Chrome 152.0.7977.83.
This verifies emulation, not physical Quest performance, headset comfort or
the perceived sound transition. Independent desktop image review covered
the four views over three frames each and four exit frames; those 16 captures
showed no remaining under-bridge streak or adjacent geometry regression.
Independent stereo review also passed the rainy underpass at all three rolls:
the near walkway/ceiling were free of rain streaks, outside rain remained
visible, and columns/rails stayed connected in both eyes. A fine dotted paving
seam was compared with both earlier XR evidence sets and is pre-existing;
rainy lighting makes it brighter. This is not a newly missing surface.
