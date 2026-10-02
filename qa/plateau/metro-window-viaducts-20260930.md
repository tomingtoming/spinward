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

History, all 2026-09-30 to 10-01:

1. The first build laid crawler rails along every window. toming wondered
   whether rails were needed at all ("ルンバみたいなのが走り回るだけでもいい")
   and accepted dropping them ("はい！").
2. Small free-roaming crawlers replaced the rails. toming asked for a more
   considered shape, then for the night view. At one per 250 m (6,720) and
   then one per 1 km (480), the night windows looked crowded ("ルンバ多すぎ
   気持ち悪い").
3. toming pointed out that a Roomba is round because it roams a furnished
   floor, while the window has almost no obstacles, so a wide wiper could
   sweep it. That is the current design.

`src/objects/windowRobots.ts` (names kept from the robot stage):

- Spin gravity (~1 g) holds the machine on the glass, so it needs no
  suction, tethers or rails. It runs on soft tracks and wheels.
- A 45 m truss beam carries a brush housing and a squeegee on each face (it
  sweeps both ways). It rides on a crawler bogie at each end and on two
  wheel towers between. The analogues are solar-farm row cleaners and
  centre-pivot irrigation spans.
- Lanes are 50 m apart along the axis, each centred between two viaduct
  pier lines (every 50 m from the window edge). The beam passes every pier
  with 1.1 m to spare, and it crabs sideways between lanes without turning.
- The bogies stand on the glass, so the straight beam's middle rides 8 cm
  above the curve. The squeegee is taken to be segmented so that it follows
  the curve.
- Sealed air soils the glass slowly. One wiper per 10 km of window covers
  its section in about 14 days, giving 12 wipers on three windows. Poses
  are a pure function of time, and all 12 are drawn instanced.

- The hex glazing used to sit 0.3 m inside the datum, while the Tokyo
  structural floor, the window opening, the edge walls, the pier feet and
  the wipers lie 16 m lower. toming saw the hex pattern and the wipers'
  contact surface disagree (2026-10-02). `cityscape.ts` now scales the
  glazing down to the floor whenever a world lowers it, and the wipers'
  bogies stand on the glazing (0.3 m inside the floor). A brightened
  capture from above a pier foot now shows the hex mullions at the pier
  base; the same view before the fix showed none there.

### Night view

toming asked for the night view (2026-09-30). The lights are split by who
should see them:

- **Rotating beacons.** An amber beacon on each bogie is beamed along the
  glass for people close by on the viaducts or the edge walls. It flashes
  every 1.1 s, with a phase per wiper.
- **Position lamps.** A shielded, steady, dim position lamp beside each
  beacon faces up. It is the only light the far side of the colony sees.
  Thousands of flashing lights across a window would repeat, on a colony
  scale, the complaints about flashing aviation lights on wind farms. The
  24 lamps are one point cloud (2.5 px, fogged like everything else) that
  fades in with night.
- **Work lights.** A low raking work light along each face comes on only at
  night. Clean glass scatters almost nothing, so it lights no pool; the
  low raking angle is what shows scratches and chips.

Hardware-GPU captures:

- From the Arakawa deck by day, the wiper reads as a long white truss over
  the glass.
- At t=.02 its work light bars read.
- From the Oji arrival at night, the window overhead shows one pair of
  amber points among the stars. At 250 m crawler cells the same view was
  dense with them.

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
  nothing laid on the windows, wiper lanes between pier lines and
  continuous paths inside each section, wall openings, line
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
  (about 20 in total). Wipers have no docks yet and do not react to people.
- No lighting, catenary or night treatment on the viaducts yet.
