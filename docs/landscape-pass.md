# Landscape and architecture pass

Implementation order agreed in conversation: landscape 1–5, then buildings 1–4.
This is the first implementation pass, not a visually approved final design.

| Step | First pass |
| --- | --- |
| Landscape 1: overhead districts | Two contiguous park districts per land strip, with stronger park colour in the distant shell bake. The central arrival corridor remains built. |
| Landscape 2: human scale | Benches, planters and small sign structures at the plaza corners, outside both arterial carriageways. |
| Landscape 3: night hierarchy | Dimmer residential/industrial far-field light, warm entrance lighting in the near civic details. |
| Landscape 4: window grid | Structural glazing pattern fades with camera distance, retaining the close view. |
| Landscape 5: destinations | Seating, greenery and a public telescope on the existing observation tower deck. |
| Buildings 1: entrances | Human-sized glazed entrances, projecting portals, columns and canopies on selected nearby block buildings. |
| Buildings 2: use and form | Residential balcony bands versus vertical office frames, using a bounded selection of nearby blocks. |
| Buildings 3: roofs | Garden colour masses and angled skylights, avoiding non-rectangular building archetypes. |
| Buildings 4: openings and materials | Geometric window ledges and surrounds; separate glass, masonry, metal and wood materials. |

The civic layer uses at most six material batches, no extra dynamic lights,
and no new image assets. It is limited to the starting district and tower,
and omitted for small physics playgrounds. Furniture and roof ornaments are
decorative, with no new collision surfaces. The telescope is not interactive.

## Architectural premise

Island Three has three land strips alternating with three window strips and
external mirrors. A building's local illumination depends on its location and
the active reflected beams; “every building receives vertical sunlight” is not
an assumption of this pass. Skylights and terraces are speculative architectural
responses, not output from a daylight/thermal/structural simulation.

Reference: [NSS: O'Neill Cylinder](https://nss.org/o-neill-cylinder-space-settlement/).

## Outstanding visual review

Check daytime and night at Surface, Overlook and Axis, on desktop and mobile.
In particular, confirm attachment of facade additions to loaded building assets,
roof clearances against existing equipment, readability of the park shapes,
window shader appearance, and the added GPU cost. Browser control was unavailable
during implementation; passing geometry tests and TypeScript/build checks do not
replace this review. No production deployment is part of this pass.

## Ground-floor frontage study (2026-09-10)

The opaque exterior shells now distinguish shops, office lobbies, residential
entrances and workshops. Lot identity and district character select the use
without consuming the city planner's random stream. Four related texture bays
per use vary awning colour, door position or glazing; floor heights range from
3.2 to 4.6 metres. Each wall fits its own whole number of bays so an elongated
footprint no longer compresses the same eight shop windows into its narrow end.
The facade UV program has a separate cache key from the upper-floor grid.

These are painted architectural openings on the existing opaque band, not new
rooms or projecting awning meshes. The existing enterable cafe/passage/court
buildings remain excluded upstream and retain their real openings and collision.
Four use batches consolidate the box faces into sides and caps, limiting this
layer to eight draw calls (previously six), with the same triangle count.
Textures and emissive maps share the bay layout and are disposed with the city.

Validation: 604 tests and TypeScript/production build; matching street views at
day/night on Radeon 780M/RADV. Desktop/phone/Quest quality profiles are exercised
on that desktop GPU; these measurements do not establish physical phone/Quest
performance. Visual review covers the photographed street views, not all lots.
This remains a local design study pending the user's visual review.

## Night hierarchy, second pass (2026-09-11): the overhead reference

Reference: an overhead night frame of a land strip from the source colony
(Izma, GQuuuuuuX). What it shows, and what this pass maps it to:

| Reference | Spinward (far-field bake, `cityShellBake.ts`) |
| --- | --- |
| Only the arterials glow as continuous teal veins; residential streets read as building speckle, not lines. | `SHELL_ROAD_*_ALPHA`: arterial 0.95 / collector 0.4 / local 0.05 core (locals were 0.26 and drew a lattice). Veins use `SHELL_VEIN_COLOR` (teal). Near geometry: local road emissive 0.95 → 0.4. |
| Several saturated white clusters strung along the veins, dim fabric between. | `districtNodeAt` (four secondary cores per strip) raises the bake's night urbanization; `districtNightGain` is steeper (`0.3 + 0.7·u^1.7`); the shop-band bloom ramps with core-ness and adds a soft halo above 0.85. |
| Irregular dark holes between clusters. | `districtVoidAt` (three light-only voids) dims the window blobs by up to 75 %. |
| Fine irregular speckle rather than equal blobs. | Per-building brightness roll (0.5–1.0) on the window blob. |

Deliberately light-only: the nodes and voids modulate the emissive bake, not
the city plan. Changing `urbanizationAt` re-calibrates the keep probability
for the whole strip and moves every authored lot (café, lobby, neighbourhood
shops, Nyaan's apartment), so the geometry — and those contracts — stay as
they are. Not in this pass: the reference's curved/irregular street network
(the plan's grid is untouched) and the mid-distance far-batch geometry, which
still renders as lit boxes.

Fixed views for before/after: `spinward-bench/overhead-view.mjs` (AX = from the
spin axis at the +120° strip, B60/B86 = grounded look-ups), night `t=0.9`.
`?grid=<0..2>` still scales the vein glow on device.

## Outdoor vegetation and ground colour (2026-09-11)

The next outdoor pass starts with the green spaces. The previous 1,500-tree
cap was consumed in city-plan traversal order: the desktop plan's three land
strips received 1,500 / 0 / 0 trees. Position-ranked selection now distributes
the same budget as 496 / 477 / 527. Ranking uses no layout RNG draws. The hash
of all buildings, roads and patches matches the pre-change plan exactly;
a regression test protects the established authored lots.

Trees use three asymmetric crown lobes, smooth normals and varied lower rims.
The final crown is 120 triangles (previously 80); a 60-triangle prototype was
rejected after its near-view silhouette looked too angular. At 1,500 trees the
net crown increase is 60,000 triangles, with the same two tree draw batches.
This is a simplified landscape tree, not a close-up botanical model.

Parks now have a shared 128-pixel seamless meadow texture and restrained
per-parcel tint. Patch merging now preserves vertex colours: the old custom
merge dropped them, also losing the pre-existing farm tints. The initial park
prototype exposed this as black ground. Switching the patch merge to the
attribute-preserving Three.js merger fixed the ground and restored crop colours.
The meadow uses periodic value noise rather than visible sine-wave stripes.
No new lights, image downloads, roads or collision surfaces were added.

Validation: 656 tests and TypeScript/Vite build passed (existing bundle-size
warning remains). The sampled park's vertex-colour count matches its position
count in the browser. Day/night park images, matching Surface/Overlook views,
and desktop/phone preset captures are under `qa/neighborhood-life/outdoor-*`;
`park.mjs` and `landscape.mjs` reproduce them. Independent image review found
the repaired ground readable and the trunk attached, with no blocking visual
fault; simplified crown masses remain visible up close. Phone preset results
are desktop browser measurements, not physical phone or Quest certification.
This remains local and is not a production deployment.

## Parked lamps (2026-09-12)

Parked vehicles drew the traffic pack's added light-bar boxes with a single
palette material, displaying the whole colour atlas on each bar. Parking now
owns a geometry copy whose draw range contains only the original vehicle body.
Its authored lamps remain unlit, while moving traffic keeps the separate
emissive groups. Day/night same-view comparisons in `parked-lamps.mjs` show the
checker strips removed with no added draw calls. The ownership test protects
the shared traffic geometry/material and checks disposal of the parked copy.
