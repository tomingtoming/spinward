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
  stand every 50 m, and axial crawler rails lie every 100 m, 25 m off the pier
  lines.
- `prepare_metro_transit.py` now joins the east and central strips across the
  Arakawa cut. It stores points in the east source frame (a later strip's x
  is shifted by 2πR/3), keeps the window section level at the deck height,
  and blends 60 m of land. It limits the grade to 8% by averaging the
  tightest envelopes above and below the profile; the DEM cutting before
  学習院下 was 21%. The line is 11.7 km with 19 stops (12 east, 7 central to
  早稲田). The largest ground deviation is 4.8 m, in that cutting.

## Runtime

- `src/worlds/metroBridges.ts` builds decks, parapets, piers and pier caps
  (solid, collided), visual Yamanote rails, and every window's crawler rails
  with parked crawlers every 4 km (drawn only). `metroCity.js` draws them
  through the curved-tile path and adds the solids to structure collision.
- Edge walls open exactly across each deck
  (`metroEdgeWallMeshes(..., openings)`).
- The tram service runs 12 cars on the longer line.

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

- Unit: viaduct spans, heights, pier/rail clearance, deck height equal to the
  tram crossing, crawler rails on all three windows, wall openings, line
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
- The Yamanote viaduct is not reachable on foot from the east strip: a
  station building stands on the line at the edge. Rail viaducts are not
  public walkways, so this was left as found.

## Open

- Only the east–central window has viaducts; other surface-line cuts remain
  (about 20 in total). Crawlers are parked, not moving.
- No lighting, catenary or night treatment on the viaducts yet.
