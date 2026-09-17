---
origin: ai
created: 2026-09-18
---

# Public spaces in all 18 Izma districts

This increment adds one usable public place per district. It does not complete
the whole-colony goal or turn the sparse building rows into complete neighbourhoods.
The 18 places occupy 48 × 34 m or 60 × 42 m plots, 56–717 m from their district
centres. Each plot has a four-metre pedestrian connection to an existing ordinary
street or its pavement. Existing buildings, entry paths, water-bank reservations,
motorways, other alignments and the protected study remain in place.

Seven use-based layouts share a public furniture kit: works rest courts, market
courts, a civic square, neighbourhood greens, park gardens, a campus court and
allotment rest gardens. There are 70 planted trees, 18 open shelters with tables,
benches, raised beds and supported noticeboards. Gardens use grass islands and
cross paths; industrial courts keep a broad paved apron clear. These are original
Spinward designs. They are not reproductions of official Gundam locations.
Shelters provide walkable space; sitting/table interactions and shops inside the
new district buildings are not implemented. Noticeboards currently have no text.

The **Nearby square** action joins the shared Places menu on desktop and wrist.
It resolves to the closest public entrance from the live location, faces into
the square and preserves all previous destinations. Twelve actions still fit
the existing six-row wrist layout without shrinking or overlapping its targets.
Named local previews use `?landscape=authored&preset=izma&visit=public-<district>`.

## Blender and reproduction

The independent, metric `SW_izma_public` scene is saved in
`assets/blender/izma-public-spaces.blend`: 54 meshes, near/middle/fixed for each
place, plus 54 native point-light objects. `izma-public-spaces.json` records the authored locations, purpose, route,
entrance, crossfall-aware walk samples, furniture proxy parts and source hashes.
The offline recipe searches actual vacant ground and finished drawn road heights;
the app does not generate or relocate these plots at runtime.

In isolated Blender MCP CLI:

1. Run `assets/blender/build_izma_public_spaces.py` against `izma-colony.blend`.
2. Run `assets/blender/export_izma_public_spaces.py` against the saved
   `izma-public-spaces.blend`.
3. Run unit/build checks and the desktop/XR fixtures below.

Run public authoring/export **after** terrain, transport and district architecture.
The exporter preserves the existing base and building tiles and replaces only
its own public layer. Terrain/parcel hashes reject stale authoring sources.
Exporting district architecture invalidates the dependent public layer until it
has been rebuilt. No GUI scene is modified by this isolated pipeline.

## Geometry and budgets

The saved source supplies 14,920 near and 10,720 middle triangles. Eighteen
additional tile requests are 34,912–63,075 bytes each (890,900 bytes total); they share the existing 18-resident,
three-request cache. Roofs, pillars, trunks and foliage retain inexpensive far
proxies. The public ground adds 5,328 resident drawing triangles. Its ground and
physical furniture boundaries add 10,704 collision triangles across the colony,
expanded only through the existing 128-entry/4 MiB collision LRU.

Each place is one local collision compound. Siting checks the existing 64 m
collision grid across every window affected by a new compound, reserving room
under the 32-descriptor / 4,096-triangle budget. This moved the B housing court
away from a congested station junction. Test coverage includes the full sampled
transport network and each public approach, not merely the spawn point.

Access walks preserve gentle transverse slopes. Making every four-metre row
horizontal originally created a raised edge on the river district's hillside;
both sides now connect to their respective drawn heights and share the plaza
threshold. The tests check both sides of that threshold, road contact, rendered
versus sampled support, clear central traversal, route grades and local costs.

## Verification

Evidence directory: `qa/webxr/evidence/colony-public-20260918/verified/`.
The build inventory is frozen before browser checks. Reproduce desktop views
with `SPINWARD_URL` and `SPINWARD_EVIDENCE_DIR` set, then run
`node qa/neighborhood-life/colony-public.mjs` (all 18 places, day and night).
The new XR fixture is `qa/webxr/colony-public.xr.mjs`: actual VR entry, stereo
stick walking along the connection into the square, and ray/trigger activation
of Nearby square in the real wrist menu, once in each inhabited strip.

The first XR attempt checked only the new paving at the road/paving boundary.
Its initial ray missed that mesh's exact floating-point edge. The fixture now
includes the adjoining rendered street/sidewalk and records the initial body
state before validation. The production build was not changed for this fixture
correction; failed evidence is retained separately under `attempt-1-xr-public`.

Independent review of the initial 36 images found that the emissive shelter
fixtures did not illuminate their tables, pillars or surrounding ground. The
final source adds actual roof-underlighting and two supported area fixtures per
place. Their 54 light definitions share the existing **six** shadow-free point
lights with the original study. Nearest-light selection now wraps the tangent
angle, so C-strip lamps also work with negative player azimuth. Daylight turns
them off. A unit case checks every place at three equivalent azimuth wraps,
night/day switching and removal on switching to Cooper.

Final desktop views also look back toward the street and across to the shelter
in three representative districts (48 day/night views). The new XR cases cover
A and B by day and C by night and capture the actual Nearby square wrist target.
Results and independent final image-review limits are recorded below.
Physical headset comfort, GPU/process memory and long continuous travel are
not established by these desktop and WebXR emulation checks.

## Final results

- **1,134 unit tests passed** across 193 files, 672.09 s. TypeScript and the
  production build pass. All **602** frozen file hashes still match after QA.
  The previous base, architecture, structure arrays and all 222 building tile
  entries are unchanged; the other-world bundle hash is unchanged too.
- **16 XR cases passed in 7.9 minutes**, then the three public cases passed an
  expanded route in **1.3 minutes** on the same build. The expanded route enters
  the clear aisle under each shelter roof and uses the wrist target to return
  to the entrance. These are 16 logical cases, with the three public cases
  repeated with stronger coverage. Roof clearance exceeds 2.8 m at the inspected
  stops; samples follow the visible floor and remain grounded. The C-field case
  runs at night with active local lighting. All use playwright-webxr **0.3.0**,
  Apple M1 Pro / ANGLE Metal, 1,280 × 960 per eye and 64 mm IPD.
  All 16 recorded page-error lists and 15 resource-failure lists are empty; the
  older night fixture does not record a resource-failure list.
- **48 final desktop views** cover all 18 places day/night, plus street-facing
  and shelter-facing views in all three strips. Page errors and failed requests
  are empty. The new compounds stay within limits across **8,104 sampled
  positions** (6,716 transport positions plus approaches and plaza grids).
  The maximum remains **20 descriptors / 4,055 triangles**, unchanged from the
  previous worst location. Public plots themselves peak at 14 / 3,484.
- Comparable stable, forced-GC page snapshots use **141.87–143.17 MiB of JS heap**,
  an increase of **1.93–2.24 MiB** over the previous cache increment's matching
  visits. Three complete collision-cache sweeps each expand 603,721 triangles,
  retain at most 128 entries and peak at 1,990,944 coordinate bytes. Their stable
  JS heap is 143.06–143.36 MiB, with backing storage 156.16 MiB. These are not
  cold-load peaks or process/GPU measurements.
- Short frame samples in the 48-view run are mostly refresh-limited near
  16.7 ms. Two daytime views reach 33.4 / 50 ms p95 while other automated jobs
  are running. Repeating only those two districts day/night after the other jobs
  finish yields 16.7–16.8 ms p95 (`isolated-frame/`). These 1.5 s stationary samples
  do not establish continuous-travel or physical-headset performance.

Whole-colony terrain network streaming, dense connected neighbourhoods around
these public places, complete rail/IC/JCT/inter-strip circulation, new building
interiors and physical-headset evaluation remain unfinished. The public plots
are a first set of everyday destinations, not proof of whole-colony completion.

Independent final image review inspected all **48 desktop + 4 XR images**,
with paired pre/post-lighting crops, three road-edge close-ups and both-eye
menu crops. It found no new large holes, floating furniture, separated roof
supports or one-eye-only omissions in those views. Entrance paving is visibly
joined to the road in the three close-ups. C-strip shelter furniture and ground
are readable from inside at night; rear columns remain dark in the outside
B/C views. Nearby square, all twelve labels, the lowest row and the wrist frame
are visible in the inspected night menu. The remaining fifteen road-edge
close-ups, hidden contact points, temporal LOD/light transitions and physical
headset comfort are outside that image verdict. These limits are separate
from the machine checks. Full review/crops/hashes are retained in `visual-review.md`,
`visual-crops/` and `visual-images.json` within the evidence directory.
