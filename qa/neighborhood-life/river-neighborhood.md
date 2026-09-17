---
origin: ai
created: 2026-09-17
---

# Bridge, market and hillside walking increment

The authored Izma study connects its river crossing, a six-shop market and
five hillside homes with a 420.20 m route. Its endpoint is a residential porch,
about 9.9 m above the bridge. Four shops have open shells; two are shuttered.
The houses' doors remain closed. Scope and editing workflow:
[authored worlds](../../docs/authored-worlds.md).

The already supplied reference `04 [1080p] [AMZN]-0024.png` was viewed again:
it shows a lower riverside walking level, a bridge, upper streets and buildings.
Those vertical relationships inform the setting. The new market, lots and
route are original designs. This is not a reconstruction of the source bridge
or a claim about Izma's construction history; no combat content was adopted.

## Checks

```sh
SPINWARD_URL=<production-preview-url> node qa/neighborhood-life/river-neighborhood.mjs
SPINWARD_URL=<production-preview-url> bun run test:xr qa/webxr/river-neighborhood.xr.mjs qa/webxr/world-landscapes.xr.mjs
```

Local, ignored evidence lives in
`qa/webxr/evidence/river-neighborhood-20260917/`.

- The unit checks sample the walking lines every 0.5 m, reject gaps over 0.3 m,
  and test body clearance against solid walls including the bakery doorway.
  Trees and narrow posts must also clear the market and hillside carriageways.
  Existing checks compare exported collision surfaces with drawn LOD0,
  projected road clearance, preset identity, LOD changes and disposal.
- The XR route uses real head orientation and thumbstick movement from bridge
  to porch without teleporting between route points. Samples check the live
  body's clearance against the actual rendered ground. After the full walk,
  real wrist ray/trigger input selects Market street, followed by a walk
  through the bakery doorway into its shell.
- The separate world test covers four-preset switching, clearing the authored
  layer in Playground, stereo roll, walking and ending the VR session.
- Desktop images cover the bridge, market, home approaches, riverside and
  overview. Both browser scripts reject software GPU backends.

## Findings during implementation

The first market apron meshes extended to the road centre and fragmented the
visible asphalt into a saw-toothed pattern. They now join the footway, leaving
a continuous road strip. The first bridge underside duplicated the deck's top
height and produced flickering bands; its top now sits below the walking mesh.
An independent image review then found a tree inside the bend. A new clearance
test reproduced the problem, also catching a signpost. Two trees and the sign
now stand beside the roadway. Final captures are in `clearance/`, with
`desktop/` and `final/` retained for the earlier comparisons.
The independent follow-up compared the bend in desktop and stereo images:
the trunks and signpost are outside the asphalt, and the road remains continuous.

The terrain keeps its three LODs. Izma contains 30,913 / 21,150 / 20,526
triangles and 140 surface tiles; collision is streamed near the player.
Window frames, text and lamp details are near-only. Cooper and Elysium's
decoded exports are byte-for-byte equivalent after canonical JSON ordering,
checked against the prior increment (`baseline.json`, `world-changes.json`).

The final TypeScript/production build and 15 focused tests passed
(`build.log`, `focused.log`). `build.json` and `served-build.json` record matching
SHA-256 hashes for both served chunks. The optional study-data chunk is about
893 kB gzip; it is requested only when `landscape=authored` is set.

Final WebXR verification: **2 passed in 2.1 minutes** (`xr-clearance/`), using
playwright-webxr **0.3.0**, the Meta Quest 3 emulation profile and Apple M1 Pro /
ANGLE Metal hardware rendering. Both eyes rendered at 1280 × 960 with 64 mm
IPD. The measured continuous route was **418.83 m** (arrival tolerance stops
short of polyline vertices), followed by **25.02 m** from the Market street
arrival through the bakery door. All **526 recorded samples** were grounded;
minimum body-centre clearance over the drawn terrain/paving was **0.304 m**.
The final porch ground height was 18.08 m and the bakery floor 8.64 m.
The route test recorded no page errors or failed requests. The second test
passed four-world switching, stereo walking and Playground cleanup.

Five final desktop captures passed the GPU check and recorded no page errors.
The long VR walk intentionally lets the existing day/night cycle advance, so
the late-route and indoor captures are at night; desktop captures show the
same structures in daylight. Night lighting and material finish remain part
of the broader study's unfinished presentation.

Physical Quest frame rate and comfort remain unmeasured. The scope does not
include house interiors, interactive shops, populated streets, complete
district accessibility, finished materials, or the colony-wide terrain.
