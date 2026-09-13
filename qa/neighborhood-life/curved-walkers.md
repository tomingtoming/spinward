---
origin: ai
created: 2026-09-13
---

# Residents on the curved neighborhood footways

Re-inspected the original episode 01 images `0017` and `0020`. The former
shows overlapping civilian pedestrians with different clothing and heights;
the latter shows a person moving through a clear band between buildings and
railings / street equipment. Their SHA-256 identifiers are
`57ea23f3f5c1609d4f559b358e73e1d7c16ee26506f339aed0a4bf8b04e95652` and
`d478f6c8c1307e250e4fd4ccc2f42565a717c7868bb694dca2aed1aed780c25b`.
The reference scan found 150 files, 147 unique images and no new content.

The adopted idea is a civilian street used by people with room to pass its
fixed edges. Neither image establishes the new road's curvature or traffic
rules. Characters, crowd density, running choreography, signs and blue
lighting are not copied. Street equipment and signal supports remain separate
work. The existing Spinward resident GLB supplies the original characters.

## Implementation and limits

One out-and-back route follows the centre of each two-metre curved footway.
The walks are 224.321 and 225.079 m long, with different speeds, phases and
existing clothing variants. They start in opposite directions. Endpoints are
at least five metres inside the arterial boundaries, beyond the short kerb
ramps. Existing 1.8-second turns and player / rover yielding remain active.
These are local walks; there is no cross-city commuting or arterial crossing.

The two paths contain 1,098 points altogether and are planned once per city
rebuild. Runtime uses the existing distance lookup and foot support correction.
The routes share the existing desktop eight / Quest and phone four resident
slots, instanced rendering, materials and contact shadows. There is no new
actor pool, asset, light or collider. This bounds the worst-case population;
it is not a physical-device performance measurement.

## Checklist and observations

| Check | Observation / measurement | Result |
|---|---|---|
| Both footways, full forward / turn / return cycle | Unit samples centre and both shoulders against actual walk triangles; a body sphere stays outside building collision, including the bend | Passed |
| Curve direction and seam | Heading changes by more than 0.5 rad along the walk, speed stays bounded, wrap and endpoint turns remain continuous | Passed |
| Determinism and disabled district | Identical routes for 16k / 18k / 64k city budgets; null / small district yields no route | Passed |
| Daytime street, visible body placement | The foreground resident stands over the pale pavement; the opposite resident follows the far pavement. Neither overlaps a kerb or facade in the reviewed start / yield / resume images | Passed within captures |
| Close yield and resume | Real elapsed motion approaches the player, the local actor clock holds for 600 ms, and ordinary S movement makes it resume | Passed on desktop / Quest budget |
| Feet and shadows | Sampled actual shoe geometry has 1.999–2.000 cm clearance for curved residents; contact shadows stay in the ground band | Passed mechanically; close yield image crops the feet |
| Night | Clothes and shoes are dark against the pavement, with the existing building windows providing the bright background. No new NPC emission is visible | Passed; centimetre-scale support cannot be judged from this dark image |
| Population / visibility | At most five residents observed on desktop, four on Quest budget; layer hides at altitude and with `people=0` | Passed |
| Stereo at 0 / ±25° roll | The foreground resident and far pavement remain visible in both 1280×960 eyes; the figures keep their placement relative to the rotating street | Passed within captures |

The existing resident shape has visibly simplified joints and facial features.
This increment changes where it walks. Foot fitting remains a pelvis/support
correction rather than independent ankle IK, so stance-foot sliding remains a
known limitation. Images do not establish frame rate or physical Quest comfort.

## Reproduction and evidence

Verify preview ownership, build, then keep `dist/` frozen while running:

```sh
SPINWARD_URL=https://127.0.0.1:<port> TIER=desktop node qa/neighborhood-life/curved-walkers.mjs
SPINWARD_URL=https://127.0.0.1:<port> TIER=quest node qa/neighborhood-life/curved-walkers.mjs
SPINWARD_URL=https://127.0.0.1:<port> PEOPLE=0 VIEW=street LABEL=disabled node qa/neighborhood-life/curved-walkers.mjs
SPINWARD_URL=https://127.0.0.1:<port> bun run test:xr
```

Fixtures use public grounded URL poses and ordinary rotation / gravity. Scripts
observe actor positions and use actual keyboard input; they do not set actor
clocks or move runtime objects. The far capture alone uses a static free-flight
pose. PNG / JSON evidence is ignored under `qa/neighborhood-life/`.

Both normal browser budgets passed seven captures (day start, movement, yield,
resume; night start / movement; altitude hide), plus one disabled-layer capture.
The foreground resident moved 1.600 / 1.552 m between the first two captures
(desktop / Quest budget), including capture time. Neither run had page or
console errors. Hardware preflight reported Apple M1 Pro / ANGLE Metal.

`bun test`: **891 passed, zero failed**, 153 files. TypeScript and production
build passed; the existing large-bundle warning remains. The frozen tested
bundle was `/assets/index-CF2sUWOh.js` before recording the local commit ID.

The new playwright-webxr **0.3.0** test performs actual VR entry, confirms
64 mm stereo IPD, measures 0.659 m of ordinary actor motion independently of
head movement, waits for actual XR frames after head changes, captures the
three rolls and exits the matching session through `endSession`. No page or
console errors occurred. Chrome 152.0.7977.83 ran on Apple M1 Pro / ANGLE Metal;
this is emulation, not a physical Quest result.

The complete suite passed **22 tests in 5.0 minutes**, without retries. It
includes the existing real wrist selections, river residents / traffic and
mono / stereo exit and re-entry with stale-session guards. Evidence is retained
under `qa/webxr/evidence/curved-walkers-20260913/`. No package failure was
observed in this run.

## Remaining development

The arterial junction needs a deliberate right-of-way policy before residents
or autonomous cars cross it. Connecting the curved street to the places / route
graph and extending the road layout to further districts are still open. The
current change neither replaces the whole rectangular road network nor claims
that unrelated reference equipment is implemented.
