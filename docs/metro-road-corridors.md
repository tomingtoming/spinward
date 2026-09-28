---
origin: ai
created: 2026-09-25
---

# Tokyo road corridors: first connected walking district

Tokyo Station → Imperial Palace / Takebashi → Suidobashi now has a connected
walking guide, available in both directions from Places. The two legs are
2,026.9 m and 1,740.4 m. The default Shibuya arrival and all sixteen instant
visits are retained. This is the first supported corridor, not a declaration
that the entire colony's transport network is complete.

## Data and topology

- OSM public walking ways and streets provide shared-node connectivity. A
  geometric crossing alone never creates an intersection. Footways have lower
  route cost than ordinary roads. Motorways, stairs, tunnels, elevated station
  passages, private/restricted access and timed access are excluded.
- Each selected edge is checked against PLATEAU building clearance (0.65 m),
  water clearance (0.4 m), and road footprints for motor streets. There are
  720 runtime vertices and 719 undirected edges. The original source data and
  pre-existing render tiles are unchanged.
- Starting/rerouting may join only within 8 m and 1.2 m vertically. The complete
  connector must remain in the exported clear corridor, including all intervals
  between polygon crossings. Endpoint-only and fixed-step obstacle tests are
  insufficient for thin barriers. A location on another band cannot snap in.
- Road graph, bridges and geographical frames must agree before activation.
  The three named guide destinations are explicitly bounded; outside this
  corridor the UI explains where to start instead of inventing a shortcut.

## Kijibashi adaptation

All 338,365 stored PLATEAU `tran` polygons have zero min/max Z in the acquired
source database. OSM bridge/layer tags give classification and relative layers,
not surveyed deck elevations. Consequently this bridge is a documented colony
adaptation rather than a claim of exact reconstruction.

The selected source way is OSM 203035368 (雉子橋). A designed 24 m wide deck is
clipped to the original road footprint and building clearance. It spans the
moat at 4.357 m above the local datum, using bank DEM samples 50 m beyond its
ends plus 0.20 m. The approach envelope descends at 5.5% and joins the original
terrain. Existing terrain grades can be steeper; the whole walking graph's
maximum sampled grade is 13.93%.

The bridge has a 0.65 m slab and 1.05 m parapets. Width, depth, parapets and
vertical profile are design values. The complete bridge/approach geometry is
2,478 triangles, 40.6 KB compressed / 165.6 KB decoded, two drawn meshes. It is
resident separately from streamed terrain, partitioned into the same bounded
physics index. The same native triangles drive rendering and collision; terrain
eviction cannot remove its floor, and leaving the world removes both.

The road is still visually simple: no full lane/sidewalk furniture, traffic,
traffic-signal simulation, or complete adjacent highway reconstruction. Some
walking guidance follows street centreline where OSM has no separate connected
sidewalk. The UI calls these bridge/street crossings, not painted sidewalks.

## Reproduction

Work/data root: `/Volumes/BLAZE/Spinward/inland-b-20260924`.
The frozen OSM response, request and hash are in
`roads-20260925/reference/east-roads.json` and its receipt. Request bounds are
35.673,139.745–35.707,139.774; the corridor crop is further restricted locally.
No background service or recurring acquisition was added.

```sh
/tmp/spinward-metro-python/bin/python assets/plateau/prepare_metro_roads.py \
  --root /Volumes/BLAZE/Spinward/inland-b-20260924 \
  --source /Volumes/BLAZE/Spinward/inland-b-20260924/roads-20260925/reference/east-roads.json \
  --output /Volumes/BLAZE/Spinward/inland-b-20260924/derived/roads-v2/network.json

/tmp/spinward-metro-python/bin/python assets/plateau/audit_metro_roads.py \
  --root /Volumes/BLAZE/Spinward/inland-b-20260924 \
  --network /Volumes/BLAZE/Spinward/inland-b-20260924/derived/roads-v2/network.json
```

Build with `VITE_METRO_ROADS=/roads-v2/network.json` in addition to the existing
finish and lowrise manifests. Final build is `roads-20260925/main-dist-v5`.
The original 5318 preview can serve this directory using the existing
`qa/plateau/metro-main.vite.config.mjs` configuration.

ODbL-derived routes remain separately downloadable as `network.geojson`; the
attribution footer links to that export. OSM attribution remains present next
to PLATEAU and GSI. No source data are bundled into the application repository.

## Verification, 2026-09-25

- 69 relevant Bun tests, TypeScript and production build pass. Two Python
  source-access/topology tests pass. Full-repository Bun was not rerun here.
- All six inter-place directions connect; the source-space audit finds zero
  uncovered edges. Maximum guide height error versus real deck triangles is
  0.0586 m (threshold 0.08 m).
- Continuous keyboard walks across the bridge and approaches, roughly 240 m
  in each direction, remain grounded with regional readiness and active guide.
  Rendered surface contact is checked at the start, bridge centre and end.
- Both parapets stop the physical body before leaving the deck. PC guidance
  starts without teleportation and can be cancelled. A 390×844 mobile viewport
  retains the direction card and actions.
- Hardware-GPU playwright-webxr **0.3.0**: actual app VR entry, wrist laser
  navigation through Places → Directions, guide selection and cancellation.
  The navigation text was enlarged after independent image review. Physical
  HMD comfort/readability remains untested.
- Evidence: `roads-20260925/qa-v2` (all five initial acceptance tests), `qa-final`
  (PC/mobile/parapets/VR), `qa-vr-final` (final text sizing). The rejected `qa-v1`
  exposed a wrong-band structure placement; that is fixed and guarded by tests.
- Whole 3.8 km geometry/connectivity is audited. Continuous end-to-end walking
  of the entire 3.8 km and all possible off-route departures are not claimed.
- Independent images show continuous bridge surface and attached parapets.
  A mobile screenshot with `?debug` includes the developer toolbar overlapping
  the card; normal-URL PC/mobile screenshots (`accepted-desktop.png` and
  `accepted-mobile.png`) confirm that the card is unobstructed. Final larger
  wrist text passed a second independent image review without clipping.

Next: expand only after separating elevated-road footprints from their ground
projection. Reconstruct highway decks, ramps and tunnel portals with explicit
height evidence/design rules, then connect additional Places and bands. Do not
turn OSM layer numbers into metre elevations or geometric crossings into graph
junctions.
