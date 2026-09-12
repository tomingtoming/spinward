---
origin: ai
created: 2026-09-13
---
# Riverside traffic verification

Use an owned production preview and keep its served build frozen until each
browser/XR run has closed. The existing Kenney fleet and traffic capacity are
reused; this increment adds no Blender geometry, textures or draw batches.

```sh
SPINWARD_URL=https://127.0.0.1:5192 LABEL=final bun qa/neighborhood-life/river-traffic.mjs
SPINWARD_URL=https://127.0.0.1:5192 LABEL=final TIER=quest bun qa/neighborhood-life/river-traffic.mjs
SPINWARD_URL=https://127.0.0.1:5192 bun qa/neighborhood-life/traffic-streaming.mjs
SPINWARD_URL=https://127.0.0.1:5192 bun run test:xr
```

The new browser check advances the actual city traffic integrator through 650
simulated seconds, in bounded 0.1s steps. This accelerated check is not an FPS
measurement. It keeps the ordinary traffic and measures oriented body envelopes
from the loaded vehicle geometry, full-loop progression, height, step distance,
and stable identity/speed across zero-time focus changes. Near screenshots read
actual instance matrices; distant views must release the reserved route slots.
Three bridge frames then observe ordinary real-time movement without changing
vehicle position, phase or speed.

The circuit is 1,395.713m and uses two existing avenues, the new bridge, and the
next collector street to the north. It has no discontinuous return at a bridge
endpoint. The first narrow local return corner was rejected because the wheel
envelope crossed its pavement. At the two bridge mouths the trajectory moves
0.4m inward, returning to the usual lane centre over twelve metres. Road mesh
height is baked into the route once. A 2.5m design axle span provides pitch and
support height, with wheel probes 0.68m either side of the centreline. These are
kinematic design dimensions, not measurements of a physical wheel rig. Loaded
vehicle geometry is measured separately for body-overlap checks. This does not
add a wheel/suspension simulation.

Results on 2026-09-13:

- `bun test`: 843 passed, zero failed. TypeScript and production build passed.
  The route is identical at the 16k/18k/64k building budgets. Full-route wheel
  samples remain on actual asphalt; the inspected worst support difference at
  grade transitions was about 0.0851m. Existing river walk/collision tests pass.
- Both desktop and Quest budget runs completed about 2.91–2.94 laps per car,
  with no river-car body-envelope overlap against other traffic during the
  650-second sample. Maximum step was 0.7m per 0.1s; height ranged 0.2–5.2m.
  Merge/cross-traffic stops and release are also covered by unit tests.
- Five views and three real-time bridge frames per budget recorded no page
  errors. Actual traffic instance transforms matched the reported road pose,
  retained a right-handed unit-scale basis and stayed within fleet capacity.
- Existing traffic streaming regression: Izma, Cooper and Elysium each passed
  ten axial/tangent focus cases, without reported identity/speed changes,
  nearby disappearances or same-lane overlaps.
- Independent desktop/Quest image review confirmed visible wheel contact,
  road-aligned motion and preserved bridges, paths and guardrails in the
  photographed areas. Hidden wheels and sub-pixel contact are not judged from
  screenshots. The initial browser attempt's far-view wait incorrectly required
  cars that should be culled; the fixture was corrected, without changing
  runtime culling. Keep `first` and accepted `final` evidence separate.
- The initially suspected sparse Quest far view was compared with the earlier
  Quest-budget golden. The same gaps and road/building layout were already
  present; no new geometry loss was found. Minor brightness differences remain.
  The earlier night golden uses another viewpoint, so it cannot establish an
  exact night-lighting regression result.
- The complete playwright-webxr 0.2.0 suite passed eight tests, ten immersive
  sessions and ten exits in 2.6 minutes, including actual wrist/controller
  interaction and exit/re-entry. The bridge check waits for ordinary traffic
  to arrive, without relocating a car or advancing its clock. Three 0/±25°
  stereo captures show about 5.25m of forward progress at 5.2m road height;
  instance pose, fleet capacity and active screenshot/session metadata agree.
  Each eye is 1280×960, the canvas 2560×960. Chrome 152.0.7977.83 used the
  Apple M1 Pro / ANGLE Metal GPU throughout the frozen-build run.
- Independent XR review found no obvious floating, road penetration, guardrail
  intrusion or reverse roll in the six eye/pose views. Separate wrist-menu
  captures from the same run retain the PLACES panel and labels in both eyes
  through all three rolls. Images do not prove exact wheel contact or every
  intermediate frame. Full-suite evidence is retained under
  `qa/webxr/evidence/river-traffic-20260913/` (ignored).

The route reserves at most three existing traffic slots when the neighborhood
is nearby and replaces only ordinary slots beyond 200m. It does not reroute every
ambient car, implement a city-wide destination graph, add a bus service or add
player-versus-traffic physics. Existing player driving and pedestrian crossing
systems remain separate. Recorded GPU: Apple M1 Pro / ANGLE Metal. Native Quest
frame rate, comfort and wheel-level physical contact remain unverified.
