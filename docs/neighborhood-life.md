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
  while driving. The September 12 increment below extends the same model to standing.
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

## Cafe journey increment (2026-09-11)

The cafe's right bench now belongs to the pedestrian arriving from across the
street. The left bench stays available to the player. The resident walks along
the opposite pavement, waits at the zebra crossing, enters through the middle
of the doorway, passes behind the tables and approaches the bench from its
clear aisle. Sitting and standing blend over 1.2 seconds. After a 24-second
coffee pause the same person returns along the route. The optional resident
asset does not own collision or the player chair contract.

Two warm, unshadowed local lights make the cafe's interior and people legible
at night. The resident uses the existing Blender coffee mug; its wrist animation
raises it periodically while seated. Hand and mouth positions were measured
from the exported hierarchy. The first-person grip remains the existing
continuous sleeve asset; its complete player coffee cycle was rechecked.

At the collector junction about 59 metres along the cafe street, one member of
the existing traffic fleet takes a curved right turn into the street. Minor
approaches yield to nearby major-road traffic; the turning vehicle waits for
major-road and merge clearance, follows vehicles ahead and obeys the pedestrian
crossing. The stop-line equality case has a regression test: reaching the line
must not authorize departure on the next frame. This is a single local junction
and bounded demonstration route, not citywide pathfinding or intersection AI.
Ambient traffic still uses its existing repeated spans beyond this pilot.

Validation for this increment:

- `bun test`: 653 passed; production TypeScript/Vite build passed. Existing large
  bundle warning remains.
- Geometry tests sample the doorway/aisle route against solid room furniture in
  both 64,000 and 16,000 building plans; turn geometry is continuous at the curve.
- Real-browser journey: 953 samples, all outbound and return stages reached,
  zero JavaScript errors and zero sampled cars overlapping the central crossing
  while the resident crossed. Sampling is not a proof for every traffic state.
- Controlled main-road obstruction: turn held at progress 90 m / speed 0, then
  resumed to 113.7 m / 4 m/s after clearance. The probe waits for car asset loading
  before placing the obstacle, so a route rebuild cannot erase the test setup.
- Player coffee cycle: all three drinks consumed, then cup returned to idle;
  seat facing remained correct, zero JavaScript errors.
- Independent image review: no definite body/bench penetration or floating,
  and night visibility improved. Exact sole contact remains image-limited.
- Browser scripts and local PNG/JSON evidence are in `qa/neighborhood-life/`.
  Screenshots and measurements are ignored by Git. Quest hardware was not
  available; desktop browser tier emulation must not be called a Quest test.

Useful probes: `journey.mjs`, `junction.cjs`, `traffic.cjs`, `room-light.mjs`,
`tiers.cjs`. Set `PLAYWRIGHT_MODULE` to the installed Playwright module if it is
not resolvable locally. The new probes default to a fixed local Vite preview at
port 5192, avoiding development hot reload during long animation captures.

Measured on this Mac/Chrome (DPR 1, 180 frames each, not hardware mobile/XR):
phone preset at 390×844 reached seated state, median/p95 16.7/16.7 ms; Quest
preset at 1440×1000 was 16.7/33.4 ms; desktop preset was 33.3/33.4 ms. Draw counts
were 167/188/208. These are current-scene readings, not a controlled before/after
speedup claim. All three reported no immersive VR session support and no
JavaScript errors.

Controlled crossing probe: 320 samples including 67 with a stopped car, zero
unsafe central-crossing overlaps. Its console records the existing local
Cloudflare RUM CORS rejection and favicon 404 separately from application
behavior. `shared-seat.mjs` replays the player's full coffee cycle while waiting
for the resident to arrive at the other bench.

## Road lighting and crosswalk clearance (2026-09-11)

The regular warm spheres above arterial centre lines came from Cityscape's
old global lamp proxy. It had no poles and remained visible beside the actual
near-field kerb lamps. That batch and its material have been removed; supported
StreetLamps fixtures and the distant surface-shell lighting retain their roles.

Axial crosswalk bars still used an obsolete negative junction-height offset,
although the current road mesh gives both road orientations the same elevation.
Their positions also used the intersection's tangent plane, causing the outer
bars to sink into the cylinder. Each stripe now follows its own cylindrical
position and normal. Paint clearance accounts for the road mesh's inward chord
and each flat bar's outward corners, using shared road elevation/tessellation
constants. Signal assemblies keep their common frame so their parts stay joined.
This changes instance transforms without adding geometry or draw calls.

The regression test raycasts actual road triangles under the rendered Float32
stripe matrices, sampling centres and corners on both axes at four radii
(18, 180, 3,200 and 10,000 m), three azimuths and distant axial coordinates.
Every sampled paint top clears the road by more than 2 cm. All 693 tests and
the TypeScript/Vite production build pass.

`qa/neighborhood-life/crosswalk-clearance.mjs` checks the first arterial/local
junction south of spawn (the spawn plaza intentionally has no crosswalks).
It captures three approach positions on both axes and the arterial light chain;
`MOTION=1` adds forward-motion frames, `TIME=.42` selects day, `TIER=phone`
uses the phone preset, and `EXPECT_FIXED=1` checks that the old spheres are absent
while supported lamps and crosswalks remain. Set `PLAYWRIGHT_MODULE` as above.

Desktop day/night and phone-preset night captures passed without JavaScript or
shader errors. The old sphere count changed from 678 to zero; at the same
arterial approach, supported lamp pools remained 186 and crosswalk bars 378.
Independent image review found continuous stripes in both directions and in
three forward-motion samples, with signals and supported fixtures retained.
These are browser samples, not an exhaustive temporal or hardware XR check.
A thin distant lamp post against lit windows shows horizontal aliasing-like
marks in one moving view; the cause and whether it predates this change remain
unresolved. The requested crosswalk defect is absent in those samples.

## Standing presence — 2026-09-12

The same original resident now supplies a headless first-person torso, arms,
legs and shoes while standing. A separate surface-space gait keeps each support
foot in place, alternates swings, and takes small steps after a large head turn.
Two-link leg IK preserves bone lengths; shoes follow their own local ground
normal. Carriageways, kerbs, indoor floors and roof heights have distinct finish
levels. Teleports, plan changes and landing reset anchors without false steps.
The torso sits 18 cm behind the eye, including while seated, so looking down
reveals the legs rather than the inside of the chest. Coffee keeps its existing
grip and hides the duplicate right arm. The camera does not inherit gait motion.

Ordinary PC/touch walking is 1.8 m/s; PC Shift retains the previous 6 m/s travel
speed. VR locomotion retains its original speed and controller visuals for this
increment. Actual foot contacts now trigger quiet footsteps inside and outside;
the motion state still runs if the optional body is hidden or unavailable.
This initial increment hid the body in flight/driving and XR; the later
September 12 increments below add grounded XR and flat-screen flight.
Running uses the same bounded procedural gait,
not an authored athletic animation or a full physical body.

All 698 unit tests and the production build passed. New checks cover planted
anchors, stopping, seam/teleport transitions, IK reach and finish-level selection.
`player-body.mjs` covers desktop day, phone-preset night and Shift movement;
`seated-body.mjs` captures the seated/standing downward view. The full coffee
sequence and optional-asset failure path passed without runtime errors.
Independent image review found no clear leg penetration in these samples,
but the existing phone HUD obscures much of the lower body and shoes have low
contrast on an unlit road at night. These remain follow-up items; phone/Quest
hardware comfort and continuous-motion fidelity have not been verified.

The follow-up phone dock now folds secondary actions behind More below 720 px.
Fullscreen, colony selection and Travel remain in one row; touch game actions
track the live expanded/collapsed height. `mobile-dock.mjs` verifies actual
touch input, viewport bounds and menu/weather access at 320, 390 and 720 px,
plus the full desktop arrangement. The collapsed dock measures 44 px at all
three widths. Independent visual review confirms clearer feet and legs; the
Jump/Gyro overlay still covers a small portion of the right knee. Full tests
and production build pass. This is browser emulation, not phone hardware QA.

## Grounded XR body prototype — 2026-09-12

The body now also reads the current WebXR viewer and grip poses in local-floor
space. Projection into the rotating colony is read-only: it does not modify
the tracked camera, controller spaces, locomotion rig or player collider.
Grip origins follow the [WebXR grip-space contract](https://www.w3.org/TR/webxr/#dom-xrinputsource-gripspace).
Room-scale head movement drives inferred footsteps; crouching lowers the pelvis
while foot anchors stay on the surface. The legs remain inferred, not tracked.

The original +Z-forward model has opposite side names to the -Z-forward XR
viewer. The adapter maps physical left/right explicitly, including the arm
hidden behind the flat-screen coffee grip. Palms stay at the real grip centres;
arm IK permits at most about 15% length adaptation. Out-of-reach poses keep the
tracked palm and hide the disconnected sleeve. Missing/emulated grip tracking
hides that arm; missing/emulated head tracking hides the body. All authored
transforms restore each frame and gait resets on XR/flat-screen transitions.
Existing controller models, grabbing, wrist controls and camera motion remain.

`tracked-body.mjs` injects deterministic poses into the ordinary renderer and
checks both palm positions (within 0.01 mm), physical side mapping, crouching,
tracking loss, unreachable hands and bind-length restoration. Unit tests cover
the coordinate projection, current-frame sampling and arm reach. Independent
image review finds the expected side changes and no clear penetration in those
frames; crouching obscures toes behind knees. The full coffee path still passes.
These checks do not emulate an XR runtime or validate hardware latency, comfort,
fit to different people, controller occlusion or continuous retargeting. XR
free-fly and driving body poses, and physical collisions for the inferred body,
remain open.

## Wider street activity (2026-09-12)

`StreetWalkers` reuses the original Blender person in six quiet clothing palettes
and modest height/width variants. It keeps eight nearby people on desktop or
four on phone/Quest presets, using six material/contact-shadow batches. A spatial
index finds nearby pavements; only the local pieces of long sidewalks become
walk routes. People persist across focus refreshes, are removed beyond 135 m,
and replacements appear beyond 22 m. Above 8 m altitude the layer is hidden.

Routes stay inside clipped pavements, leave 3 m end buffers and pause to turn.
Approaching a player inside 1.65 m or a driven rover inside 3.5 m stops the local
clock. They resume when the way clears; the player can walk through them because
these are visual inhabitants, not rigid colliders. There is no population,
commuting or crowd simulation. `?people=0` skips the population/index entirely.

The resident GLB adds eyes and joint/waist overlap volumes (147,832 bytes; 4,368
body triangles). A new export contract catches foreign scenes, unexpected image
textures and size growth. The saved blend contains only this asset scene.
Regression checks preserve hidden first-person head parts, missing tracked arms,
exact palm targets and clothing tint reset when batch occupants change.

`street-walkers.mjs` checks day/portrait-night approach, yield and resume, bounded
counts and JS errors. `street-walkers-performance.mjs` isolates the new layer in
one warmed scene in reversed order. Unit sampling uses the real city to reject
road/building overlap and protects route continuity and local allocation size.
Independent image review found no obvious road/wall penetration or torn joints;
the close portrait stop was moved farther away after review. Dark night clothing,
simplified mannequin-like shapes and approximate NPC foot planting remain.
On the local M1 Pro/Metal browser, reversed-order warm measurements added six
draws: 143–144 without versus 149–150 with the street layer. Both held a
16.7 ms median; p95 changed from 16.7 to 16.8 ms. These vsync-limited samples
show no observed frame-rate regression there, not spare GPU capacity or phone
hardware performance.

## Public bench seating (2026-09-12)

The two existing plaza benches in Izma, Cooper and Elysium now offer E / the
touch Sit action. They use the same seating attachment and clear-front exit
as indoor chairs, with an actual 0.53 m seat support and 1.23 m eye height.
Seated leg IK keeps the shoes on the visible pavement while the pelvis follows
the support; the indoor bench's existing 0.6 m support remains unchanged.

Each plaza bench has its own radial frame and shares its four mesh parts with
four precise collision boxes. Thin supports opt out of the broad roof contact
margin, which otherwise raised the player while walking beside the seat. Seat
and back remain separate so throws can pass through the real gaps. No extra
draw batches, lights or textures were added. The decorative tower-deck bench
remains unavailable because that landing floor is not certified for seating.
Public seats are separate from the indoor population's occupied-seat list.

`public-seats.mjs` exercises both seats in all three inhabited presets plus
Izma portrait/night, including real touch Sit/Stand up, eye height, body state,
sensor restoration, clear exit and normal walking into the solid bench. All
eight paths pass; the ground height beside the bench remains zero. Unit checks
compare mesh support, collision/exit and actual shoe vertices across seat/floor
heights and cylinder orientations. These are browser and geometry checks, not
phone/headset hardware certification.
