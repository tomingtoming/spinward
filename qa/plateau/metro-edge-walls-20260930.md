---
origin: ai
created: 2026-09-30
---

# Tokyo: retaining walls on the window-side edges

toming reported an unnatural cliff between the Tokyo terrain and the windows
and chose retaining walls ("縁に擁壁を立てる", 2026-09-30).

## Finding

The terrain is an open sheet that ends at each window-side land edge 0–43 m
above the window (median 7–15 m per edge; 69–78% of the west strip's edges
exceed 10 m). From the window side one saw the sheet's underside (the backs
of roads and ground) and the structural floor at −16 m below it. The green
band beside the windows seen from above was that floor.

## Change

- `assets/plateau/prepare_metro_edges.py` writes
  `src/worlds/generated/metroEdges.json` (87 KB, 16 KB gzip). It holds the
  edge height of all six edges every 10 m. Each value is the maximum within
  ±5 m, rounded up to 0.1 m, so the interpolated wall top never dips below
  the terrain edge. The terrain grid is linear between its 5 m rows. The file
  carries the crop frames and terrain SHA-256 values.
- `src/worlds/metroEdgeWalls.ts` builds walls from the structural floor
  (−16 m) to a 1.1 m parapet above the edge, with a 0.3 m cap and a land-side
  face buried 0.5 m. It is chunked every 2 km, about 144k triangles for all
  six edges. The concrete texture has formwork joints (6 m panels, 3 m
  courses) and faint streaks.
- `metroCity.js` draws them with the same curved-tile path as the source
  bridges and adds them to structure collision.
- The 400 m floor strips stay. With walls, removing the floor still exposed
  the floor through slivers along far overview edges (up to 832 pixels,
  values up to 60), so it remains the backstop there.

## Verification

- Unit: both edges of every strip are covered end to end. Chunks join, the
  wall runs from the floor to the edge plus the parapet, and the cap turns
  inland. A different crop frame gets no walls.
- WebXR 0.3.0 on the hardware GPU (`qa/webxr/metro-edge-walls.xr.mjs`): a
  VR walker 25 m inside the Shibuya-side west edge holds the stick toward the
  window for 8 s. It stops 0.64 m inside the edge, grounded at 33.9 m. The
  same test on the previous candidate, without walls, fails with the walker
  falling off (`free-fly`).
- Visual: from above the window and from the ground, the wall closes the
  underside and reads as paneled concrete. The parapet shows as a light line
  at the end of streets.
- Saturated GPU cost of the walls: Shibuya +1.1–1.5%, Omiya +0.6–0.7%.
  Physical Quest is not measured.

## Open

- Bridges over the windows (toming asked to consider them; see the proposal).
- Wall design is a first pass (no buttresses, drainage, lighting or fence).
