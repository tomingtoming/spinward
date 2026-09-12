---
origin: ai
created: 2026-09-13
---
# River district checks

Use the existing production preview after checking its owning PID/cwd. Keep
`dist` fixed for the entire browser/XR run. These commands require hardware-GPU
Chrome; the scripts reject SwiftShader and record the GPU renderer.

```sh
SPINWARD_URL=https://127.0.0.1:5192 LABEL=reviewed CAR=1 WALK=1 node qa/neighborhood-life/river.mjs
SPINWARD_URL=https://127.0.0.1:5192 LABEL=budget TIER=quest VIEWS=bank,junction,far,night PERF=1 node qa/neighborhood-life/river.mjs
SPINWARD_URL=https://127.0.0.1:5192 LABEL=fallback VIEWS=bank FALLBACK=1 node qa/neighborhood-life/river.mjs
SPINWARD_URL=https://127.0.0.1:5192 bun run test:xr
```

Generated PNG/JSON files are local ignored evidence. `river-views.mjs` specifies
repeatable public URL poses. Ground routes retain ordinary rotation/gravity;
overview/far captures use free flight and zero spin. No hidden state replaces
movement, seating, UI selection or steering. The car's initial placement uses
the existing debug `enterAt` hook; subsequent motion uses actual W/A/D input.

The driving route starts near the west junction, follows the lane up the curved
approach, over the bridge and down the east approach. It does not test turning
from moving arterial traffic. Walking checks both slopes, below/above the
bridge and a road approach, followed by two actual E sit/stand operations and
walking into the water-side guard. These sampled routes do not claim a sweep
of every square metre or a complete waterway swim simulation.

The fallback fixture returns a valid empty glTF document for the bridge asset:
it checks missing module handling and the procedural arch, not offline caching.
Far view requires LOD2. Rain probes check a point under the real deck and one
outside using the app's roof masks, not per-drop/wind simulation. `PERF=1`
records six seconds of browser rAF intervals per view; it is not native Quest
performance and has no pre-change baseline.

2026-09-13 desktop review: actual driving covered 222.56m without a crash;
road support rose to 5.2m. Walking covered 46.29m down the bank slope, 43.80m
up, 33.12m below the bridge, 33.41m on the bridge and 36.31m on an approach.
Both bench exits returned to the 1.2m promenade with the player sensor off.
Water-side guard stopped the player outside the channel. No page or console
errors. Images and state are `river-desktop-reviewed-*`.

Independent review of six views confirmed the repaired rail/deck junction,
continuous paving and road mouth, rails following the slope, and supported
local night lights. A thin existing arterial edge marking still crosses the
junction mouth; this is a marking detail, not a remaining raised curb.


Quest-budget bank/junction/far/night views passed with no page/console errors.
LOD2 was active at the far viewpoint; supported bridge rain masks covered the
under-deck point and excluded the outside point. At 1440×900, DPR1, Apple M1 Pro
/ ANGLE Metal, each six-second rAF sample was about 60.1fps, p95 16.7ms. This
bounded, refresh-limited desktop result is not a before/after improvement or
native Quest measurement. Evidence: `river-quest-budget-*`.

The empty-module fallback run retained the visible procedural arch, ground
height 1.2m and the same rain masks with no page/console errors. Evidence:
`river-desktop-fallback-*`. The final full suite passed 832 unit tests and six
playwright-webxr 0.2.0 tests (eight sessions/exits); see `qa/webxr/README.md` for
stereo checks and native-headset limits.
