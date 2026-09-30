---
origin: ai
created: 2026-09-30
---

# Tokyo: window viaducts, window upkeep and the Arakawa line to Waseda

toming compared four bridge concepts over the east–central window
([comparison page](https://claude.ai/artifact/55wqu4ERmnFqsKEbQjMP9k)) and
chose short-span viaducts. A window carries no ships, so it needs no long
spans. toming also chose to have window maintenance ("あることにしたい") and
asked to proceed (2026-09-30).

## Data

- `assets/plateau/prepare_metro_bridges.py` writes
  `src/worlds/generated/metroBridges.json`. The viaducts sit at the verified
  source cuts of the Yamanote line (y 11,842.5 m, 24.71 m, 11 m deck) and the
  Arakawa line (y 11,933.1 m, 20.13 m, 8 m deck). Both strips' edge heights
  agree within 1 cm. Each deck runs level across the 3,351 m window. Piers
  stand every 50 m. The first build also laid axial crawler rails on every
  window; they were removed the same day (see Window upkeep).
- `prepare_metro_transit.py` now joins the east and central strips across the
  Arakawa cut. It stores points in the east source frame (a later strip's x
  is shifted by 2πR/3), keeps the window section level at the deck height,
  and blends 60 m of land. It limits the grade to 8% by averaging the
  tightest envelopes above and below the profile; the DEM cutting before
  学習院下 was 21%. The line is 11.7 km with 19 stops (12 east, 7 central to
  早稲田). The largest ground deviation is 4.8 m, in that cutting.

## Runtime

- `src/worlds/metroBridges.ts` builds decks, parapets, piers and pier caps
  (solid, collided) and visual Yamanote rails. `metroCity.js` draws them
  through the curved-tile path and adds the solids to structure collision.
- Edge walls open exactly across each deck
  (`metroEdgeWallMeshes(..., openings)`).
- The tram service runs 12 cars on the longer line.

## Window upkeep

toming wondered whether rails were needed at all ("ルンバみたいなのが走り回る
だけでもいい") and accepted the proposal to drop them ("はい！"), then asked
for a more considered robot shape (2026-09-30). `src/objects/windowRobots.ts`:

- Spin gravity (~1 g) holds a robot on the glass, so it needs no suction,
  tethers or rails; soft rubber tracks grip and do not scratch.
- The body is square, not round: there is no furniture to slip past, and a
  1.1 m full-width brush and squeegee must reach pane corners on straight
  lanes. A camera mast at the back carries an amber beacon so people on the
  viaducts can see it, as airside vehicles do.
- One robot per 1 km cell sweeps lanes one brush width (1 m) apart at
  0.5 m/s, a full pass in about 23 days: sealed air soils the glass slowly,
  so a monthly pass is enough. That is 480 robots on three windows. The
  first build used 250 m cells (6,720 robots, a pass every three days);
  toming saw the night windows and found them far too many ("ルンバ多すぎ
  気持ち悪い", 2026-10-01). Lanes within 2.35 m of a pier
  line (every 50 m from the window edge) are skipped, so no robot meets a
  pier. Poses are a pure function of time; the renderer instances the
  robots within 1.5 km of the camera.

### Night view

toming asked for the night view (2026-09-30). Each robot carries three
lights, split by who should see them:

- A rotating amber beacon beamed along the glass, for people close by on
  the viaducts or the edge walls. It flashes (1.1 s, a phase per robot) and
  is drawn only for the near robots.
- A shielded, steady, dim position lamp on the mast that faces up, the only
  light the far side of the colony sees. Thousands of flashing lights across
  a window would repeat the wind-farm complaint about flashing aviation
  lights on a colony scale. All lamps are one point cloud (2.5 px,
  fogged like everything else). It fades in with night, and a slice of
  1/90 moves each frame. At 250 m cells, near robots plus lamps cost
  0.07 ms per frame on the CPU; 1 km cells cost less.
- A low raking work light along the brush, on only at night. Clean glass
  scatters almost nothing, so it lights no pool: raking light shows
  scratches and chips, which is why the inspection light is low.

Hardware-GPU captures at t=.02: from the Oji arrival the windows overhead
show amber points among the stars. They were dense at 250 m cells; at
1 km cells they are about as sparse as the stars. Close up, the work light bar and
the beacon read, and the body stays dark.

## Two physics faults found by the crossing ride

1. **Falling through the street after leaving a tram.** Riders are sensors.
   At 向原 the carried position and the door point lie over the same 20 m
   terrain part, so the sensor pair never ends. Rapier then kept no contact
   after the sensor was switched off, and the walker fell to the −16 m floor.
   Re-enabling the collider or switching collision groups did not help.
   `refreshPlayerCollider` replaces the collider on leaving a tram or a seat
   (`railRide.ts`, `roomSeating.ts`). `src/physics/sensorRelease.test.ts`
   reproduces both behaviours.
2. **A waiting walker flung ~45 m by a car streamed in beside them.** A new
   car body was created at the step's end pose, so it stood still in
   inertial space for one step while everything co-rotated at about
   177 m/s. `RailColliders.update` now takes the step angle and creates each
   body at the step's start pose. `src/physics/railColliders.test.ts` checks
   first-step co-rotation. This is shared with the Izma tram.

## Verification

- Unit: viaduct spans, heights, deck height equal to the tram crossing,
  nothing laid on the windows, robot paths continuous and clear of piers, wall openings, line
  continuity and level crossing, sensor release, rail co-rotation.
- WebXR 0.3.0 on the hardware GPU:
  - A walker goes from the east strip along the tram street onto the Arakawa
    deck, grounded at 20.13 m.
  - A real-time ride from 大塚駅前 across the window to 向原 (7 min) passes
    mid-window at 20.75 m (deck plus car floor) and alights grounded at
    30.01 m.
  - The 王子駅前 ride still passes.
  - All 38 island edges on the 19 stops stay within 0.2 m of the street,
    including the 荒川車庫前 edge where a waiting tram had flung the walker.
- After the robots were added, the Otsuka–Mukohara ride failed twice at
  boarding (the trigger did not board although the car was pointed at),
  passed with the robots disabled, then with them enabled on the same code
  boarded in an instrumented run and passed the full ride once. It failed
  once more in a later combined run. A boarding-only probe (the ride test
  up to the trigger, alone and after the walk test) then boarded 14/14 with
  robots and 12/12 with `?robots=0`; the edge-wall walk failed once in 20
  runs with robots. The shared machine was also running someone else's
  headless Chrome, 12 days old. The harness holds a button for only
  120 ms, so a stalled frame could drop the press. That is a hypothesis,
  not a measurement; the cause is still open.
- The Yamanote viaduct is not reachable on foot from the east strip: a
  station building stands on the line at the edge. Rail viaducts are not
  public walkways, so this was left as found.

## Open

- Only the east–central window has viaducts; other surface-line cuts remain
  (about 20 in total). Robots have no docks yet and do not react to people.
- No lighting, catenary or night treatment on the viaducts yet.
