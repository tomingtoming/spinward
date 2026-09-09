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
