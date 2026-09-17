---
origin: collaborative
created: 2026-09-17
---

# Designed landscapes for Spinward

On 2026-09-17 the user accepted an authored-landscape direction: Spinward
remains a place to experience rotating habitats. Izma leads the work, with
Cooper and Elysium represented early enough to test the shared infrastructure.
Playground remains a small, freely adjustable physics space.

This first increment is an **opt-in landscape study**, not a replacement of
the developed city or a completed reconstruction of any film. Open
`/?landscape=authored&preset=izma` (also `cooper`, `elysium`, `playground`).
The existing preset selector and VR wrist Habitat page switch between them.
Surface and Places → Landscape return to the authored district entrance.
Shared location links retain `landscape=authored`.

## What is designed

Each major world has a 640 × 800 m playable study, made in Blender:

| World | Study | Initial structure |
| --- | --- | --- |
| Izma | River terraces | Drawn river bends, lower/upper bank walks, a bridge, hills, mixed low/mid-rise building masses |
| Cooper | Ballpark neighbourhood | An open commons and baseball diamond, a neighbourhood loop, detached houses and lawns |
| Elysium | Hillside gardens | A pond basin, hills, a garden avenue, lakeside walk and widely spaced estate masses |

### River neighbourhood increment

Izma now has a continuous **420 m walk** from the bridge's east side to a
west-bank market, then up to a hillside porch. Ground rises from 8.2 to about
18.1 m. The market occupies the bridge approach because it lies on the route
between the river crossing and homes; its uphill street bends with the grade
and branches into the existing western lane. This is a proposed everyday
relationship between places, not a reconstruction of a particular Earth town.

Six small two/three-storey shops have different widths, plaster colours,
awnings and roof profiles. The bakery and tea shop have pitched roofs; the
other frontages include parapets, roof service rooms and a bookshop balcony.
Four stores can be entered, with counters, shelving and use-specific stock or
tea tables; two are shuttered. Glass shopfronts reveal these rooms. Upstairs
housing has waist windows; the repair shop's office floors use taller glazing.
Five houses have paved approaches and level porch landings, varied gable/hip
roofs, window frames, gutters, mailboxes, planters and attached entrance lamps.
House doors are closed; domestic interiors, shop transactions, seating actions
and NPC activity are not implemented in this district.

Residential rooms retain a mixture of warm, neutral and cool lights and dark
windows. Office glazing uses consistent cool light with blinds. Curtain/blind
patterns soften the panes. Paving, masonry, plaster and asphalt have small
original material textures projected in metres, rather than reference images.
Twenty-four authored lamp positions share a pool of at most **six shadow-free
point lights** near the player. Lamps and window emission fade with daylight;
asphalt has no emission. Sources are exported from actual Blender light objects
next to their visible fittings. Textures, materials and lights are released
when switching worlds.

The bridge has a masonry arch and supported deck; the lower waterside paths
remain open below it. Guardrails, benches and deck lamps give the crossing and
river walk a public scale. Drain channels follow the street curves. Shop
aprons meet the footway and all five home ramps reach their porch at its edge,
without the original abrupt step on the second home's approach.

The existing **Places → Market street / Garden street / Riverside** controls
now resolve to this map's own locations. Surface / Landscape starts at the
bridge facing the market. URLs accept `visit=shops`, `visit=garden` or
`visit=river` alongside the authored-mode parameters. Destinations absent from
the other worlds remain unavailable.

The route recipe is `assets/blender/izma_river_neighborhood.py`, with street
finish in `izma_neighborhood_finish.py`, called by the main landscape builder.
To rebuild only Izma in an existing blend through the
isolated MCP tool, set `SWL_REBUILD_WORLDS=['izma']` before executing the builder.
Other worlds and their master-plan scenes are saved unchanged. Scene `visits`,
`walks`, material properties and local lights are exported with the meshes; the walking polyline is for
authoring and verification and does not move the player automatically.

The finished model has **46,352 / 27,323 / 26,347 triangles** across three LODs.
Small lettering, window frames, stock and lamp details disappear beyond the
near level; building masses, awnings, window light and entrances remain. The
near-LOD budget is 48,000 triangles for Izma, with the other worlds' limits
unchanged. Its 140 surface tiles and 414 solids use existing spatial collision
streaming. See the [route increment](../qa/neighborhood-life/river-neighborhood.md)
and [street finish checks](../qa/neighborhood-life/river-neighborhood-finish.md).

The city-copying premise is a **Spinward design proposal**, not an assertion
about Izma's canonical construction history. The layouts are original studies;
an exact Earth-city model has not been selected. No combat or Mobile Suit
elements are used. The Cooper and Elysium dimensions retain the existing
presets' assumptions and confidence; making a map does not verify those values.
Elysium's landscape direction also draws on its VFX supervisor's description
of Beverly Hills / Hollywood Hills transplanted into a ring:
https://www.artofvfx.com/elysium-andrew-chapman-associate-vfx-supervisor-image-engine/

`src/worlds/worldDefinitions.ts` holds physical-envelope constraints and coarse
land-use proposals. The three `SWL_plan_*` Blender scenes show their unrolled
extents and the small study footprint. These master plans are **planning
diagrams**: the full regions are not rendered terrain yet. Izma's diagram
currently describes its first inhabited strip, not three finished strips.

## Shared engine, separate content

- `worldDefinitions.ts` resolves a named map against its actual radius, axial
  span, habitat type and land arcs. It does not guess a world from radius alone.
- The base preset identity survives RPM tweaks. Dimension/topology changes
  outside the fixed map envelope return to the ordinary generated environment;
  authored buildings, doors and paths are never stretched to fit.
- `AuthoredLandscape` consumes per-world meshes. All worlds use the existing
  surface coordinates, rotating reference frame, walking, throwing, VR input,
  collision index and streamed Rapier bodies.
- Active plans own expressway geometry. An empty study plan does not inherit
  the previous city's invisible expressway floor or physical deck.
- Preset changes reset both the visual frame and the co-rotating collision
  bodies. Previously the retained city body kept its old rotation while the
  view returned to zero; VR walking could fall to the bare hull underneath.
- The car remains in the ordinary city/Playground; these walking studies have
  no car-share bays or vehicle routes yet.
- Study meshes are a lazy chunk, requested only with `landscape=authored`.
  No additional renderer, service, scheduler, or dependency was introduced.

## Blender source and export

`assets/blender/world-landscapes.blend` contains three editable district
scenes (`SWL_izma`, `SWL_cooper`, `SWL_elysium`) and three master-plan scenes.
Coordinates are metric X=tangent, Y=axial, Z=height above the hull. Scene
properties retain spawn/look targets. Named curves retain the proposed road
alignments. Terrain meshes, bridge pieces and building masses can be edited.

`build_world_landscapes.py` creates the initial model; it only replaces its
owned `SWL_` scenes. Run it through Blender MCP's isolated `_for_cli` tool so
the open Blender work is unaffected. To rebuild the planning JSON from its
TypeScript definition:

```sh
bun -e 'import { WORLD_DEFINITIONS } from "./src/worlds/worldDefinitions.ts"; await Bun.write("assets/blender/world-plans.json", JSON.stringify(WORLD_DEFINITIONS, null, 2) + "\n")'
```

After **manual mesh edits**, run `export_world_landscapes.py` on that `.blend`.
It exports the current mesh datablocks, not the original terrain formulas.
Editing an alignment curve alone does not automatically rebuild its road mesh;
keep the corresponding deck in sync. Re-running the initial builder replaces
owned study geometry, so export manual edits rather than regenerating them.

`src/worlds/generated/worldLandscapes.json` shares a vertex pool between visual
LODs and collision triangles. The loader validates indices before expanding
the study data. Terrain is sampled into spatial tiles (140 per world); the
existing collision streamer loads only nearby tiles and solids.

Roads are clipped against the terrain triangles before being draped. Terrain
also has a bounded chord length before cylindrical projection. Both matter:
sampling road edges alone buried paths at crests, and long flat triangles
through the cylinder obscured the west hillside lane. A regression test now
casts against the **actual projected drawing**, as well as checking collision
triangles against the visible LOD0 export.

Near geometry stays active throughout the playable district. The mid/far
levels switch at 1,200 / 3,500 m from the study centre; collision uses LOD0.
The untextured masses share a daylight-dependent fill light for comparison,
alongside the existing habitat lighting. That fill is study presentation,
not a new physical claim about the station's illumination.

## Validation and remaining work

Scripts: `qa/neighborhood-life/world-landscapes.mjs` and
`qa/webxr/world-landscapes.xr.mjs`. They cover actual walking, four-preset
switching, clearing the authored layer in Playground, shared Surface/Places
travel, stereo head roll and real wrist ray/trigger interaction. The WebXR
package remains **0.3.0**. GPU checks reject software rendering.

Local evidence: `qa/webxr/evidence/world-landscapes-20260917/` (gitignored).
The full existing unit suite passed 1,084 tests before the final terrain/data
refinement; focused tests cover the final export, geometric regression,
runtime routing and wrist layout. TypeScript and production build are checked
again after refinement. See the [evidence notes](../qa/neighborhood-life/world-landscapes.md)
for final browser results.

The first XR run passed its original assertions but visual review found a
submerged view after preset switching. The expanded test now raycasts the
actual rendered ground and compares it with the live physics body and ground
sampler after walking. Merely being in `grounded` mode is not sufficient.

This is a spatial study. Finished building facades/interiors, complete building-to-road
access, all-district walking routes, public transport, vegetation detail,
finished lighting, and the full colony terrain remain subsequent work. The
ordinary city is the comparison environment. Physical Quest performance and
comfort have not been measured by the emulated tests.

On 2026-09-17 the user enlarged the goal to the whole Izma colony. The
[whole-colony design](izma-colony-design.md) now owns that work: all three
inhabited strips, their water systems, district identities and transport
connections. The first strip's five rectangles above are the earlier study
diagram, not the new full-colony plan. The 420 m district remains a completed
part within the much larger unfinished objective. Cooper/Elysium remain
comparison cases for topology and scale. Scheduled autonomous development
remains stopped; the new development goal does not recreate a scheduler.
