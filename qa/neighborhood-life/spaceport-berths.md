---
origin: ai
created: 2026-09-13
---
# Spaceport berth checks

```sh
SPINWARD_URL=https://127.0.0.1:5192 LABEL=reviewed bun qa/neighborhood-life/spaceport-berths.mjs
SPINWARD_URL=https://127.0.0.1:5192 LABEL=reviewed TIER=quest bun qa/neighborhood-life/spaceport-berths.mjs
SPINWARD_URL=https://127.0.0.1:5192 LABEL=fallback FALLBACK=1 bun qa/neighborhood-life/spaceport-berths.mjs
SPINWARD_URL=https://127.0.0.1:5192 bun run test:xr
```

Keep the owned production preview fixed throughout the browser/XR runs. The
browser captures use public free-flight poses and zero spin for stable framing.
They do not alter ship placement. Ten views include both occupied berths, both
empty berths, close contact, night, middle/far LOD and the Playground's occupied
and empty berths. Night capture waits for the ordinary 1.4-second navigation
strobe to brighten; it does not write the lamp state or clock. Other captures
may show the strobe during its unlit interval.

The initial `before` and `first` occupied/empty views faced the colony side.
That old arrangement put ships inside large berth blocks and across the small
habitat's end wall. The final `reviewed` views face the space-side fittings.
Only `far` retains the same camera for a direct before/after comparison. Do not
attribute view-dependent lighting changes to a material change. The first
small capture was occluded and did not establish docking correctness.

The collar is authored in Blender through MCP, in its owned scene
`SWDC_docking_collar`. The prior scene is restored; the asset library contains
only the owned scene. Nominal flange diameter 3.3m, reach 2.4m, throat diameter
1.52m. Two LODs contain 708/378 triangles, and the GLB is 87,776 bytes with vertex
colours and no textures. Each of four fittings draws one shared-material mesh,
with 70m and 320m transitions and 15% hysteresis. Beyond 320m its fine geometry
is omitted. No new lights, reflection passes or spacecraft instances are added.

`bun test`: 845 passed, zero failed (143 files). TypeScript and production build
passed, with the existing Vite chunk-size warning. The geometry test reads
actual shuttle vertices at three habitat sizes: they remain outside the end
wall and 2.4m beyond the real port face. The mating plane is the flat shuttle
interface, not a cone tip inside a block. Rays from all twelve actual navigation
lamp matrices hit the support mesh within the 0.24m lamp radius. The first rim
probe exposed a polygon-corner/seam placement; lamps now sit inside the actual
faceted front surface. Mirrored planning and resource disposal are also tested.

The browser reads the loaded collar geometry and placement matrices and checks
its front plane against the actual shuttle vertex buffer, with 5mm tolerance
for world-coordinate Float32 precision. It also requires all four fittings and
exercises near, middle and empty far LODs. The failed-asset run retains the same
metric interfaces and ship placement with simple fallback geometry.

These are stationary scenery berths. Pressure-door opening, transfer corridors,
ship boarding, docking dynamics and new spacecraft/hub collision bodies are not
implemented. The existing moving approach shuttle is separate. This does not
claim an operable airlock, flight simulation or physical-headset performance.

Desktop and Quest-budget browser runs each passed all ten final views with no
page exceptions. Loaded collar-to-ship interface gaps were at most 0.000407m,
within the 5mm Float32 check. Near, middle and empty far LODs were exercised.
The ten-view aborted-asset run also passed with the fallback and unchanged
interfaces. These runs are not FPS measurements.

Independent desktop image review confirms full hulls outside the port blocks
and small habitat end wall, connected nose/seal/trunk/base, both closed empty
berths and preserved hub/arm/end-wall silhouettes. The earlier dark navigation
point was an unlit strobe phase; the final night capture shows a small bright
lamp. Standard-size lamp contact remains too small to judge precisely from
images and is covered by the geometry rays instead. Contact and Playground
crops supplement the wider views. The evidence prefix is `spaceport-*-reviewed-*`;
`before`, `first` and the earlier `final` captures are intermediate conditions.

The full playwright-webxr 0.2.0 suite passed nine tests, eleven immersive sessions
and eleven exits in 2.9 minutes. It includes actual wrist/controller interaction
and exit/re-entry. The new spaceport check requires the near Blender LOD, fixed
ship/collar matrices, an on-camera connection and 0/±25° stereo capture metadata
matching the session. Each eye is 1280×960, the canvas 2560×960. GPU/browser:
Apple M1 Pro / ANGLE Metal, Chrome 152.0.7977.83. Evidence is retained under
`qa/webxr/evidence/spaceport-berths-20260913/`. Native Quest performance and
comfort remain unverified.

Independent stereo review confirmed the full shuttle, nose/collar/base
connection and surrounding arms in both eyes at all three rolls. Ship and
structure roll together, with no observed separation, burial, opposite roll or
one-eye disappearance. Equal-scale crops cover the berth and the connection.
Precise contact dimensions, exact roll angles and native headset behaviour are
not established by these images. The Quest-budget desktop comparison also
retains both occupied and empty berths, including the small habitat; differences
in navigation-light phase and reduced bloom do not indicate missing geometry.
