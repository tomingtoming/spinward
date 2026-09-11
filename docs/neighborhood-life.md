# Neighbourhood life — 2026-09-11

This pass connects a small amount of everyday activity to the existing cafe and
lobby: original Blender residents, a working pedestrian crossing, seated legs
and a hand holding the coffee cup. It is a local development branch based on
`199dad28eff4`; no production deployment is part of this pass.

## What changes

- One neighbour occupies the right bench in each authored cafe/lobby. The left
  bench remains available through E/touch. A loaded neighbour reserves its seat;
  if a player already occupies it, that neighbour is hidden until the player
  leaves. Asset failure does not reserve an invisible seat.
- A pedestrian waits and crosses a real road by the nearest eligible cafe.
  Planning uses each quality tier's actual lots, pavement width and road identity;
  it excludes intersections and small habitats without public rooms. Both kerbs
  and the road surface have different heights, respected during the crossing.
- Background cars have persistent motion rather than deriving position from
  global elapsed time. They brake before the crossing, resume with acceleration,
  and leave space behind a leader. Axial roads now use the same right-hand rule
  as circumferential roads; local streets have a lower cruise speed.
- The pedestrian requests a gap, waits for the actual nearby cars to clear, then
  crosses while traffic is held. A player-driven rover also delays the pedestrian;
  the rover is not silently steered or braked. Leaving the local area resets the
  offscreen pedestrian to a pavement before releasing the traffic hold.
- Seated legs remain anchored to the bench in the rotating habitat, independently
  of camera pitch. Entering a seat faces its clear aisle, compensating for the
  camera parent rotation. A Blender hand follows the held cup. Both are hidden in XR and
  while driving. No body tracking is inferred from a headset or two controllers.
- During seating/coffee actions the generic welcome card is suppressed, keeping
  the cup and room visible, especially on portrait screens. Contextual E/C
  instructions remain available. Low-cost contact shadows support grounding.

## Asset and rendering

`assets/blender/build_resident.py` creates **original** restrained architectural
entourage in a separate, tagged Blender scene. It uses no external character,
texture, or animation. The proportions target a 1.76 m adult, muted clothes and
an unobtrusive face. This is an articulated hierarchy, not a skinned humanoid
rig or a claim of motion-capture quality.

The source is `assets/blender/resident.blend`; the single runtime asset is
`public/assets/people/resident.glb` (118,472 bytes, 4,368 triangles including the
separate cup hand). The script can be rerun through Blender MCP: set `__file__`
to the script's absolute path and execute it. It replaces only its own tagged
scene, exports that scene's selected objects, saves a copy and restores the
previous scene. Regeneration and the exported metre/axis contract are checked.

All body parts share UV-sphere topology. Named joints drive their transforms;
five material instance batches draw the visible neighbours together, plus a
contact-shadow batch. There are at most two room residents and one crossing
resident; only nearby ones render. The optional asset is fetched once. The cup
hand and the player legs reuse it. Far city geometry and urban layout are unchanged.

## Validation and scope

- Unit checks cover actual GLB topology, adult height, seated sole height, inward
  up vectors, stopping/resuming, direction and cylinder-seam handling, and road
  selection/pavement clearance for 64k, 18k and 16k building plans.
- Browser checks use Chrome/ANGLE Metal on an Apple M1 Pro. Screenshots and
  runtime JSON live in `qa/neighborhood-life/`. Portrait/tier checks are browser
  emulation, not measurements on phone or Quest hardware.
- The 32-second controlled traffic run puts an existing car on its actual cafe
  road 60 m before the crossing, then uses the ordinary runtime. It observed
  waiting, crossing, a stopped car and resumption, with no car inside the crossing
  during the sampled pedestrian passage. A separate 45-second natural run saw
  crossings but no close car during them; it alone does not prove braking.
- Local console includes the existing favicon/Cloudflare telemetry network errors;
  these are separate from JavaScript exceptions and model/shader failures.

This is a bounded ambient-life pass. It does not implement citywide pathfinding,
intersection signal cycles, collision bodies for people, NPC conversations,
economy/schedules, or full first-person walking/XR bodies. Traffic still follows
its existing assigned road spans rather than a connected route graph. Walking
is a procedural cycle, and near-camera hands/character appearance remain an
art-direction review point. Citywide building LOD3/4 and physical Quest
performance/stereo acceptance are still outstanding.

For A/B, `?people=0` disables neighbours and their crossing. The existing
`?visit=cafe`, `?visit=lobby`, `?visit=coffee` links remain valid. In `?debug`,
`__spinward.neighborhood` reports crossing state and resident count, and
`__spinwardTraffic()` returns current road positions/speeds.

Final checks: 649 tests passed, with TypeScript/Vite build passing. The normal
keyboard coffee cycle and failed-person-asset sit/stand also passed. Reproduce
with `qa/neighborhood-life/verify.mjs` and `traffic.cjs`, setting
`PLAYWRIGHT_MODULE` to an installed Playwright module and optionally
`SPINWARD_URL` to the local server. Generated screenshots/JSON are ignored by git.

At the same 1440×1000 cafe view, DPR pinned to 1, the optional people pass
changed 202 to 208 draw calls; both readings rounded to 3.2M triangles.
The 180-frame samples had median frame intervals 16.7/16.8 ms and p95
33.4/33.4 ms (off/on). This compares the optional people layer, not the whole
branch against main, and does not establish mobile or XR headroom.
