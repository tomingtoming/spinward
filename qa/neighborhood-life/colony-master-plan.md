---
origin: ai
created: 2026-09-17
---

# Whole-Izma master plan and Blender blockout

The active user goal is the entire Izma colony. This increment supplies the
first full plan and full-extent massing model; it does not complete the goal.
The executable app still contains the finished 420 m riverside route and the
three small study districts. No full-colony geometry is loaded by the app yet.

## Source and scope

- `src/worlds/izmaMasterPlan.ts`: three strips, 18 unequal districts, mixed land
  allocations, building-height ranges, construction periods, water reaches,
  hills, 108 transport/place nodes and 108 route reservations.
- `assets/blender/export_izma_plan.ts`: writes the versioned plan JSON.
- `assets/blender/build_izma_colony.py`: uses the authored alignments and land
  uses to build complete terrain, three rivers, station and water-plant
  reservations, road/rail alignments, transfer decks and 1,715 building masses.
  The building masses are candidate placements, not final parcels or city density.
- `assets/blender/izma-colony.blend`: editable unrolled and cylindrical scenes.
  Saved independently from `world-landscapes.blend`; the existing Izma,
  Cooper and Elysium study data are unchanged.
- `assets/blender/izma-colony-blocks.json`: baked mass locations and dimensions
  from the model recipe. They can seed later instances; they are not a runtime
  random city generator and are not final collision solids.

The topology graph reserves rail, general roads, motorways, ICs and JCTs.
It does not prove ramp geometry, surface grades, headroom or drivable turns.
There are 32 candidate route-segment water crossings, not 32 finished bridges.
The three transfer levels are at axial −19 km, +6.5 km and +19 km. The C→A
connection continues across the seam; the entire connection is visible in the
cylinder model and represented by explicit nodes in the graph.

The overall plan and its Japanese-town construction history are original
Spinward design proposals. No new canonical claims or source imagery were
introduced. The user’s reference folder remains closed to new-image polling.

## Verification

`bun test src/worlds/izmaMasterPlan.test.ts`: **6 pass**. Coverage includes the
physical envelope and three arcs, district coverage between end reserves,
mixed-use allocations, centre/station access, connected transport/place graph,
node positions clear of window strips, and downhill water reach reservations.

`bun test`: **1,106 pass, 0 fail**, 187 files, 556 seconds.
`bun run build`: success, including TypeScript. The existing bundle-size
advisory remains. No runtime/UI source changed in this increment, so this is
not a new VR result. Subsequent runtime integration must use playwright-webxr
0.3.0; previous study tests cannot prove the new colony’s correctness.

Blender **5.2.0 LTS**, isolated MCP CLI. Final model:

| Scene | Objects | Triangles |
| --- | ---: | ---: |
| `SWC_izma_unrolled` | 541 | 141,380 |
| `SWC_izma_cylinder` | 206 | 129,648 |

`verify_izma_colony.py` reopens the saved `.blend` and measures the actual
meshes, independently of the terrain-height recipe:

- 81,858 corresponding unrolled/cylindrical vertices, maximum mapping error
  **0.000691 m**.
- Terrain areas **134.041289 / 134.041270 / 134.041289 km²** for A/B/C, covering
  each 40 km strip. This is base-terrain coverage, not populated-city coverage.
- Water-centre cross-sections: **536 / 532 / 532**, all above the saved terrain.
  Minimum cylinder clearances **0.486 / 1.056 / 1.928 m**. No claim about edge
  contact, water simulation, hydraulic capacity, navigability or visible bridge
  clearances follows from this measurement.

An independent reviewer used the visual-verify checklist on the full unrolled
diagram, axial view and oblique cylinder view. Final result: all three strips,
unequal district allocations, distinct transport lines, readable legends,
continuous visible water and the limited existing study footprint are clear;
no huge straight end-plane cuts through the cylinder interior.

Defects found and corrected:

1. Wide end-reserve boxes became giant chords when wrapped. Replaced with
   sampled curved ribbons.
2. The initial regular terrain columns failed to resolve narrow river beds;
   hills could also lift a river bed. Columns now follow each river, include
   its control-point rows, and keep hills outside the channel.
3. Transfer lines crossed three labels; labels were moved and the missing
   general-road legend added. A filled study marker hid the underlying river;
   it is now an outline.
4. The cylinder’s water appeared mottled even after mesh clearance passed.
   The overview camera used near=0.1 m across a 40 km model. Using near=100 m,
   far=100 km restored depth precision. An independent before/after review
   confirmed that the water is now a continuous blue band. This change is to
   Blender overview cameras, not the application’s walking/VR camera.

Evidence (gitignored): `qa/webxr/evidence/colony-plan-20260917/`:
`unrolled.png`, `cylinder.png`, `oblique.png`, `model.json`, `geometry.json`,
`bridge-reservations.json`, `tests.log`, `build.log`.

## Remaining goal work

Integrate district/tile-based assets and LOD into the shared renderer and
collision streamer; replace the closed edges of the original study with
continuous terrain/water; develop the 18 districts’ actual street/parcels,
architecture and vegetation; finish water facilities, structural supports,
public transport, drivable IC/JCTs and walkable interchange connections; make
representative domestic and public interiors usable. Verify whole-colony
travel, near/far identity, memory/render/collision budgets, day/night views,
real wrist interaction and stereo walking. Physical headset performance
remains unmeasured. The goal stays active.
