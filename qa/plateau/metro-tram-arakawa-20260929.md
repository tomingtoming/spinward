---
origin: ai
created: 2026-09-29
---

# Tokyo: rideable Toden Arakawa line in the east strip

First public-transport increment toward milestone conditions 4–5
([tokyo-metro-milestone](../../docs/tokyo-metro-milestone.md)). Inter-band
service is not part of this increment.

## Data

`assets/plateau/prepare_metro_transit.py` writes
`src/worlds/generated/metroTransit.json` (92 KB, bundled like
`metroPlaces.json` and valid only for the same crop frames).

- Alignment: the 26 N02-2025 `荒川線` (東京都) LineStrings of the east strip,
  chained without branches and resampled every 4 m: 5,201.6 m, 1,302 points,
  from the x-min window cut near 小台 to 大塚駅前.
- Height: the shared GSI 5 m grid (`terrain/east.json`,
  `2bf1c5d5…`), a 17-sample (±32 m) running median, then a 7-sample mean.
  The median removes the DEM's JR embankment spike (+2.5 m) and Shakujii
  river channel beside 王子駅前 that otherwise gave a 16% grade. Maximum
  grade is now 7.3% on the Asukayama climb.
- Stops: 12 N02 stops projected onto the centreline (≤1.1 m). 小台 lies 6 m
  from the strip edge and is omitted; the car needs track on both sides.
  Each stop's height is the mean ground at both island edges (crossfall up to
  0.27 m at 大塚駅前).
- Receipts: N02 station/track SHA-256 values from
  `metro-transport-source.json`. Its recorded paths name the Mac clone.

## Runtime

`src/worlds/metroTransit.ts` converts source metres through the same mapping
as `metroSurfaceLocation` and builds `ColonyRailData` with the shipped
`three-band-tram.json` car. The existing `RailService`, `ColonyRail`,
`RailColliders` and `RailRide` run it unchanged. In Tokyo mode `main.ts`
passes this data instead of the authored-colony rail, so the Izma service is
unaffected. The service runs at 40 km/h with 20 s dwells and six cars.
Doors face the centreline, so stops are street-level islands between the
tracks. `MetroTramTrack` draws visual rails, terminal crossovers, islands and
name signs. Walking and collision keep the unchanged source street surface.

A missing tram model logs a warning and leaves Tokyo without service rather
than failing the boot.

## Verification

- Unit (`metroTransit.test.ts`): the mapping equals `metroSurfaceLocation`;
  other crop frames or radii get no track; a full timetable cycle stops at all
  12 islands; boarding succeeds from the door-side island edge and fails 0.5 m
  above it; the `place=oji` arrival is within 60 m of 王子駅前.
- WebXR 0.3.0 on the hardware GPU (`qa/webxr/metro-tram.xr.mjs`):
  - Stand on the 王子駅前 island (live ground 8.5 cm from the stop height),
    advance only the timetable, board by controller ray and trigger, and
    ride in real time to 飛鳥山. Then alight onto its island: grounded,
    within 0.5 m of the door point, height within 0.2 m.
  - All 24 island edges: the live walker ground is within 0.2 m of the stop
    height (maximum 0.165 m at 大塚駅前). The spawn there is pushed 0.25–0.4 m
    by an adjacent small building.
- Visual spot checks at 王子駅前 and 大塚駅前: the car, rails, crossovers,
  island and sign sit on the street. Near 王子駅前 the N02 line runs in a
  light-grey source land-use strip between the dark road surface and the
  river channel.

## Not done

- Street traffic and residents do not yield to trams. The car colliders
  still block the walker.
- No bridge deck where the smoothed track spans the river channel.
- The central-strip continuation (7 stops to 早稲田) and the window-bay span
  (`tracks-13305`, axial −11,933) remain. Inter-band service remains.
- Physical Quest was not tested. `bun run build` and the full unit suite are
  recorded in the commit.
