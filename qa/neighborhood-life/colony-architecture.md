---
origin: ai
created: 2026-09-18
---

# Whole-Izma district architecture

The full-colony goal remains unfinished. This increment replaces the 1,715
whole-colony massing boxes with saved Blender architecture on all 18 districts.
It does not fill the still-sparse land with complete neighbourhoods, add new
interiors, or complete rail, motorway junctions and inter-strip connections.

## Source and spatial logic

`izma-architecture-plan.json` assigns use weights by district. They are
Spinward design choices, not population estimates or canonical Gundam geography.
The exported distribution is 541 apartments, 294 shop-houses, 223 offices,
185 houses, 185 civic buildings, 133 workshops, 97 warehouses, 31 farmhouses
and 26 pavilions. 406 buildings have a shop ground floor: all shop-houses and
roughly one fifth of apartment buildings. The rest retain residential entrances.

After the terrain and transport exports, run `build_izma_districts.py` with
Blender MCP's isolated CLI against `izma-colony.blend`. It writes the separate
`izma-districts.blend`, with editable metre-scale near/middle meshes and access
walks, and `izma-parcels.json`. Then run `export_izma_districts.py` against that
saved blend. The exporter reads actual saved meshes and checks their terrain
hash. This does not change the GUI scene or the Cooper/Elysium/study sources.
Rebuilding the underlying terrain/transport requires rebuilding these districts.

The initial block sites incorrectly treated elevated motorway approaches as
ordinary frontages. The builder now rejects those sections, selects a vacant
site on a ground-level street within the same district, and checks separation
from other parcels, every transport alignment, water/banks, strip reserves and
the protected original study. 171 parcels move; stable IDs and uses remain.
This is an offline siting rule over the authored roads, not a new random city
at runtime. It is still a sparse allocation, not a finished cadastral plan.

Foundations use nine samples of the actual drawn terrain. Exposed aprons have
both rendered tops and physical walls/floors. Frontage walks sample the actual
pavement, including the shifted position of warehouse personnel doors. They
reach the plinth before the door and use a continuous 1:12 supporting ramp
where feasible. 142 plots need stairs; their treads rise less than 15 cm. This
geometric rule is not an accessibility or building-code certification. Long
stairs still need handrails and landings as part of detailed site design.

## Architecture and levels of detail

Residential upper windows are waist-height except balcony openings. Offices
have larger openings with two height variants; their lit panes are cool white.
Residential rooms vary warm/neutral/cool, independently by room; some stay dark.
The emission follows the live daylight value without adding point lights.
Six wall finishes, three roofs, bay rhythms, heights and family envelopes vary.
Houses mostly have two floors, apartments recessed balcony fronts, offices a
podium and setback upper block, civic buildings a side court, and warehouses
loading bays with a separate personnel door. These are nine first-generation
families, not nine individually finished landmark designs.

Near and middle meshes come from the same saved buildings; near detail adds
mullions, partitions, handles, shutters and rooftop plant. Resident box/gable
proxies retain the body, foundation, stepped roof and balcony mass when detail
is distant or unavailable. Near/middle switching has 60 m hysteresis around
850 m; middle requests extend to 2,600 m. Only the nearest 18 tiles are kept,
with three simultaneous requests. A failed middle payload cannot allocate a
partial near model or remove the fallback. Distant proxies do not yet carry
individual illuminated panes.

There are 222 requests, split spatially when a payload would exceed 4 MiB.
Near geometry totals 1,360,004 triangles across the entire colony; middle
807,418. These totals are not simultaneous draw counts. Access geometry adds
146,332 always-resident triangles to the unchanged 582,120-triangle terrain/
transport base. The largest tile is 3,898,226 bytes; all tiles total 128,740,889
bytes. The manifest is 48,500,646 bytes. Terrain, access and collision metadata
still need spatial streaming; bounding building requests alone does not bound
all colony memory. Do not treat the current chunk size as the final VR budget.

Collision is independent of visual tile arrival: one compound mesh per parcel
covers exposed foundations, building walls, roofs, access and balcony guards.
The U-shaped guards omit internal overlapping faces. Roof tessellation bounds
a 12 m cylindrical chord's sag below 6 mm, using the same faces for drawing and
support. Sampling 6,716 road positions gives at most 20 local descriptors and
4,055 mesh triangles within the existing 32 / 4,096 ceilings. The whole index
still has 13,620 descriptors. This is sampled local geometry cost, not FPS or a
continuous worst-case proof.

## Verification

Evidence is gitignored under `qa/webxr/evidence/colony-architecture-20260918/`.
`initial/`, `candidate/` and `pre-frontage/` retain preceding trials;
`verified/` is the final frozen build after the street-link correction. Build hashes identify the exact version used for browser checks.

Automated geometry checks cover five points on each of all 1,715 frontage
walks, foundation aprons outside the walls, feasible grades/treads, all tile
hashes and request sizes, transport/profile regressions, and asynchronous LOD
fallbacks. The new XR fixture uses actual VR entry and controller sticks for
the largest-rise stair, a relocated ground-level entrance and a first-floor
balcony barrier, checking the body against the drawn geometry. The balcony fixture starts on
the balcony; it does not establish access from a dwelling.

The first XR fixture placed the ray exactly on the access mesh's outer edge;
rounding put it outside the finite triangle. Moving the fixture start 40 cm
inside the drawn approach resolves that measurement boundary. The movement
assertions and collision checks remain. The apron probe also moved away from
the central entrance, where raised access paving legitimately covers the
foundation surface. These were fixture corrections, separate from the model's
plinth, frontage and guard corrections.

Independent image review found grass gaps where private access walks ended
at the outer green verge of narrow shared streets. Access now extends to the
actual carriageway edge; offset doors project perpendicularly onto their street.
A new test samples every entrance start against drawn road/sidewalk materials,
excluding green verges, so a path that merely approaches the road does not pass.

Final verification on 2026-09-18:

- **1,127 unit tests passed** across 191 files (616.72 s), including all five
  architecture geometry/asset checks. TypeScript and the production build pass.
- **13 XR cases passed in 6.5 minutes**, using playwright-webxr **0.3.0**,
  real hardware rendering on Apple M1 Pro / ANGLE Metal, 1,280 × 960 pixels
  per eye and 64 mm IPD. The three new architecture cases join the existing
  three district walks, study-boundary crossing, three motorway parapets,
  420 m route/shop entry, night wrist/lighting case and four-world switching.
  All thirteen page-error lists and twelve recorded resource-failure lists
  are empty; the night case does not record a resource-failure list.
- A follow-up **3/3 XR cases passed in 35.8 s** on the same app build after
  improving the inspection viewpoints. The balcony fixture's former centre
  stood inside a near-detail divider; it now starts within an actual bay.
  Endpoint captures turn back/down without moving the body, so a close-up of
  a closed door does not stand in for a view of the supporting surface.
  The preceding captures and results are retained. This was a fixture change,
  not removal of the divider, barrier or movement assertions.
- In that follow-up, the largest-rise stair walk covers **18.49 m** and returns
  uphill, with 41 support samples. Maximum body-support/drawn-height difference
  is 89.8 mm, within one tread: the body samples nearby support with its foot
  radius. The relocated entrance walk covers **7.46 m**, seven samples, at most
  4.2 mm difference. Sustained balcony input stops after **0.385 m**, twelve
  samples, at most 0.15 mm difference. This does not prove entry from a dwelling
  or collision with near-only decorative balcony partitions.
- **26 final desktop views** cover all nine building families, the three
  corrected street-frontage districts and the longest stair, each day/night.
  All have empty page-error/resource-failure lists, at most 18 retained tiles
  and no failed tiles. Earlier `pre-frontage/desktop/` has 74 views including
  all 18 districts and whole-colony/study views; those are explicitly the
  preceding candidate, not 74 views of the final build.
- Independent image review confirms the three corrected grass gaps are gone,
  varied residential window colours and cool office lighting, with no large
  newly floating/buried buildings in the inspected images. Initial XR end
  captures hid the floor; independent review of the five follow-up images
  confirms the grey centre obstruction is gone and stairs, entrance paving
  and balcony floor are drawn in both eyes. The body still hides the floor
  directly beneath it; that area is not a visual PASS.
  Civic court layout and some access side heights remain incompletely visible.
- Short 1.5 s desktop frame samples are refresh-limited near 16.7 ms median,
  with maximum p95 16.8 ms. They are not a full travel, cold-load or Quest
  performance benchmark. Five stable page reloads across A/B/C/A/B-night,
  after forced V8 GC, use **227.75–228.91 MiB JS heap** and **141.40–160.44 MiB
  backing storage** (reported separately). The repeated A snapshot is stable
  at 228.33/228.39 MiB; this does not measure process/GPU memory or continuous
  travel retention. The same probe confirms live day/night window emission
  and the served main, colony and other-world bundle hashes.

The final inventory records 584 build files in `verified/build.json`.
The source audit is `verified/blender-audit.json`; saved scene SHA-256 is
`08b62cd16a5e52857284e60a88d3f41450855f7e41f843b8102c935ca0e7f111`.
The other-world bundle remains `worldLandscapes-D-R0TsOv.js`.

The city still reads as sparse rows along its road hierarchy. Completing blocks,
parcel boundaries, gardens, warehouse vehicle aprons, civic/station public spaces
and night entrance/step lighting is the next design work. Long stairs need
handrails/landings; near-only balcony partitions remain decorative. New homes
and public buildings remain closed. Whole-terrain/access streaming and actual
rail/IC/JCT/inter-strip travel are also unfinished. Physical-headset performance
and comfort remain unmeasured. No push, merge, deploy or scheduled task is part
of this increment.
