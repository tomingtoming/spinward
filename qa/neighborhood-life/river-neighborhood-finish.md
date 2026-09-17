---
origin: ai
created: 2026-09-17
---

# River neighbourhood: completing the street study

The user asked to set a goal and finish it. The stated scope was the authored
Izma bridge–market–hillside district: a coherent everyday walking environment,
with varied frontages, connected plots, public edges and useful night lighting.
This completes a bounded playable street study; it is not the colony-wide city,
a photoreal asset pass or a reconstruction of a canonical Izma neighbourhood.

## Source and design

The existing episode 4 `0024` and episode 3 `0020` images were viewed at their
original resolution. The former shows a masonry arch, upper street and lower
waterside path; the latter shows supported infrastructure, railing and a clear
walking strip. Those public-space relationships inform the bridge and paths.
No characters, combat, source textures or source signage are included. The
layout, architecture, names and small material samples are original.

The geometry recipe is `assets/blender/izma_neighborhood_finish.py`, called
from the river neighbourhood builder through isolated Blender MCP. Its output
is the editable `world-landscapes.blend` and indexed landscape data. The three
LODs contain 46,352 / 27,323 / 26,347 triangles. Surface tiles remain 140; 414
solid parts are streamed near the player. Cooper/Elysium exports match the
prior increment's canonical JSON hashes (`world-changes.json`).

Six shops have different roof/upper-floor configurations and four accessible
interiors. Five homes have distinct roofs, waist windows, porches, utilities
and planting. Residential windows mix room temperatures and occupancy; the
repair shop's upstairs office uses consistent cool light and blinds. Curtains
and glazing carry a small original texture. Twenty-four source positions use
a maximum of six nearby, shadow-free point lights; the same daylight scalar
drives their intensity and window emission. Road materials emit no light.

## Findings fixed

- Testing every residential approach found a step in front of home B's porch.
  The ramps now reach porch height at the outer edge and finish with a level
  landing. All four shop and five house approaches are covered by the unit test.
- The first material pass made wall and asphalt grain too large. Material
  scale and contrast were reduced, while window glass now reveals the rooms.
- A source-to-fitting test originally measured only triangle corners, wrongly
  rejecting the centre of a ceiling light. It now measures distance to the
  triangle surface, retaining the 0.65 m attachment requirement.
- Independent review caught drainage bars standing proud of the hillside edge.
  They are now flat inlets aligned with the street tangent and draped to the
  actual terrain. A second measurement found that following terrain still left
  the panels 3.8–7.8 cm above the pavement. The final regression checks all 66
  corners against actual road/footway triangles: their offsets are now
  −2.02 to +2.00 cm (overlapping road/footway edges included). The fitting is
  decorative and does not introduce a new collision step.

## Reproduction and evidence

```sh
bun test
bun run build
LABEL=final SPINWARD_URL=<preview-url> node qa/neighborhood-life/river-neighborhood-finish.mjs
SPINWARD_URL=<preview-url> bun run test:xr qa/webxr/river-neighborhood.xr.mjs qa/webxr/river-neighborhood-night.xr.mjs qa/webxr/world-landscapes.xr.mjs
```

Ignored evidence: `qa/webxr/evidence/river-finish-20260917/`. `build.json` records
the served and local chunk identity. The same build is held during the browser
checks. Desktop captures cover nine views by day and night (18 total), with
the real GPU check and page/shader error collection. The full-route XR test
uses head orientation and thumbstick movement; wrist ray/trigger input returns
to Market street before entering the bakery. The night test covers both eyes
and ±22° head roll. The world test covers all four presets and cleanup.

The full unit suite passed **1,099 tests** in 562.67 s. The later decorative
drainage correction and new pavement-height regression passed the **26 focused
tests** covering authored worlds, place visits, runtime alignment and streamed
collisions. TypeScript and the final production build passed. The optional
data chunk is about 1.05 MB gzip and is only loaded in authored mode.

The 18-view daytime/night matrix passed without page or shader errors
(`release/`), followed by four local retakes after the final drain adjustment
(`grounded/`). Apple M1 Pro / ANGLE Metal was confirmed. The market's three-second
desktop frame samples had a 16.7 ms median and at most 16.8 ms p95; this is a
local desktop observation, not a headset benchmark.

Independent image review confirmed frontage/use variation, residential light
variation, uniform office light, visible rooms through glazing, open walking
lines, supported bridge/rail edges, and readable night paths. Night stereo
views at 0/±22° showed no eye-specific loss or large wall/ground penetration.
Light-fixture attachment is a geometry measurement; the indoor capture angles
do not show every ceiling fitting or all furniture.
The final local image comparison confirmed the drain panels now sit at the
pavement edge; combined with the corner measurements, the reviewer cleared
the remaining drainage concern.

Final XR verification (`xr-grounded/`): **3 passed in 2.3 minutes**, using
playwright-webxr **0.3.0**, Meta Quest 3 emulation, 1280 × 960 per eye and 64 mm
IPD on the hardware renderer. Continuous walking covered **419.64 m** to the
hillside porch, then **27.11 m** from the wrist-selected market arrival into
the bakery. All **455 samples** were grounded; the minimum body-centre
clearance over the drawn floor was **0.302 m**. No page errors or failed
requests were recorded. Night head roll and all four world transitions passed.

Physical headset frame rate and comfort are unmeasured. The district has no
shop transactions, NPCs, seating interaction or domestic interiors. Other
authored worlds remain layout studies, and the existing generated city remains
available outside `landscape=authored`.
