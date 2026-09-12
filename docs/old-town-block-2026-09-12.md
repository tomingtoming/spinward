---
origin: ai
created: 2026-09-12
---
# Old Town service court and roofscape

The first block east of the port-end arrival square now has a bounded layer of
everyday building services. The reference principle is to connect a close,
inhabited space with the long view across the colony. This increment changes
up to 16 existing lots; it does not regenerate the city or expand the district.

Rear corners carry supported risers, brackets and meter cabinets. Repairs sit
below the window sills. Mixed-use buildings with a blank rear service zone get
a closed maintenance door; the conduit stops before its frame. The original
entrances, windows, balconies and external stairs retain their placement.

Two different rooftop water-storage assemblies and occasional residential
laundry break up the roof silhouette. Placement checks the actual highest roof,
existing HVAC, a metre of perimeter clearance, an 80 cm equipment aisle and the
beacon centre. Tanks have permanent collision volumes whose centres follow the
actual elevated mesh on the cylinder. Their ladders and the closed service
doors are visual details, not new climbing or interior interactions.

A small concrete court joins the arrival street through a 1.4 m path when a
clear route exists. Both are curved surfaces, with matching 12 cm collision
slabs. Buildings, streets, planters and external stair envelopes veto blocked
sites. The desktop default fits a 15.88 × 18 m court and a 48.08 m path; the
current phone/Quest city plans do not fit this court and keep the existing
ground instead. Their building services still render. Small habitats omit the
layer entirely.

## Assets and rendering

`assets/blender/build_old_town_services.py` produces original geometry through
Blender MCP, in the tagged `SWOT_services` scene, then restores the prior scene.
The editable source is `assets/blender/old-town-services.blend`; the runtime
`public/assets/buildings/old-town-services.glb` is 89,392 bytes with vertex colours
and no textures. Coordinates are normalized X/Z about zero, with Y = 0..1;
the planner supplies metre dimensions.

| Module | Triangles |
| --- | ---: |
| Cylindrical water tank | 612 |
| Distant cylindrical tank | 176 |
| Rectangular header tank | 168 |
| Meter bank | 132 |
| Laundry stand | 204 |

Instancing shares these meshes. Wall details and laundry enter within 85 m;
rooftop equipment remains detailed to 250 m, then retains a simplified silhouette
to 700 m. Exit thresholds add hysteresis. All distance checks include height.
Failed asset loading retains solid tank proxies and collision. Leaving the
district hides this layer; rebuilding/disposal releases its instance buffers,
paving geometry and owned assets. Existing night lighting stays unchanged.

## Verification

`bun test` passes 822 tests; `bun run build` passes (the existing large-bundle
warning remains). Seven new tests cover all three city budgets, unchanged city
plans, roof/HVAC/beacon clearance, door/conduit separation, exact tank-centre
collision alignment, unobstructed court paths, small-habitat omission, LOD
hysteresis and the exported Blender bounds/vertex-colour/triangle contract.

`qa/neighborhood-life/old-town-block.mjs` records fixed views, compares actual
instance matrices to planned attachments and verifies collision registration.
It checks the hardware GPU before loading the colony. Evidence PNG/JSON files
are ignored by Git. Example, against a running frozen production preview:

```sh
SPINWARD_URL=https://127.0.0.1:5192 LABEL=final WALK=1 node qa/neighborhood-life/old-town-block.mjs
SPINWARD_URL=https://127.0.0.1:5192 TIER=quest VIEWS=arrival,block,distant node qa/neighborhood-life/old-town-block.mjs
SPINWARD_URL=https://127.0.0.1:5192 LABEL=fallback ASSET_FAILURE=1 VIEWS=roof,distant node qa/neighborhood-life/old-town-block.mjs
```

The read-only visual review found a conduit crossing the service door; it was
shortened and the non-intersection was added to the tests. Image inspection
checks attachment, visible route continuity, roof layering and night emission;
geometry probes and actual walking cover the quantities images cannot prove.
Quality-tier checks run in desktop Chrome, not on a physical headset.

On Apple M1 Pro / ANGLE Metal, the final desktop run walked 47.60 m from the
arrival street into the court and ended grounded at its 0.12 m surface. Seven
fixed views had no page errors; their 7–90 rendered instances matched the
planned attachments, and all seven tanks plus two paving slabs appeared in
the city collision plan. The busiest sampled view added 5,612 triangles across
six mesh batches; this is layer geometry cost, not a measured FPS guarantee.
The Quest quality profile also passed its arrival/block/distant attachment
checks with eight permanent tanks and no forced court.
An aborted GLB request preserved all seven desktop tank proxies and the nine
collision volumes in both the roof and distant views, without page errors.
