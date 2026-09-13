---
origin: ai
created: 2026-09-13
---

# Finding and walking to Garden street

The previous increment made residents use the new curved street. This one
makes the district reachable through ordinary Places and pedestrian directions.
The name Garden street is original Spinward UI text, not a name inferred from
the reference images. Existing episode 01 images `0017` and `0020` remain
partial references for civilian use and clear walking space; their hashes and
observations are in [the resident report](curved-walkers.md). This run found
150 files / 147 unique images and no new content. It adds no interpretation
of the characters, combat or specific signs, and imports no reference asset.

## Behavior

- PC and phone Places offer **Directions to Garden street** and **Go now**.
  The first starts guidance without moving the player; the second arrives on
  the curved footway facing along the bend. VR has the same destination in
  Places and Directions. The place disappears when the current habitat has
  no supported district. Driving does not offer its pedestrian route.
- Each footway connects to the adjacent local avenue pavement at both ends.
  Four narrow, buried contact bevels join the old zero-height street physics
  to the new raised pavement. They add eight collision triangles and no
  rendered mesh, light, material, texture or vehicle lane.
- Guidance follows the curve and uses the existing street search outside it.
  Central Square and the river's lower bank can connect through their own
  supported paths and crossing rules. Opposite curved footways connect via
  the existing streets; there is no invented diagonal across the new road.
- Two paths contain 391 nodes in total and are cached per district. Bend
  chords are under two metres; approaches have quarter-metre support samples.
  Only a requested route runs the existing bounded street search. This does
  not add per-frame pathfinding, commuting or autonomous traffic.

## Verification checklist

| Check | Evidence / observation | Result |
|---|---|---|
| Four real street mouths | All portals lie inside the clipped avenue pavement with body clearance; contact samples agree with the actual mesh throughout both paths | Passed for 16k / 18k / 64k city budgets |
| Invalid starts and cross-road shortcuts | Carriageway and high-altitude starts are rejected; opposite footways take an exterior detour; driving keeps the previous graph | Passed |
| Other districts | Central Square route includes existing marked crossings; a route to the river retains the river ramp nodes | Passed |
| Both directions through all mouths | Actual W and arrow-key steering entered and left all four approaches while grounded; final contact height returned to zero | Passed in initial desktop capture |
| VR instruction area | Enlarged texture review found the new fifth button row under the instruction text. The layout now reserves a shared footer, retains 290×80 targets and moves rows above it; a regression test checks their separation | Passed in final texture, geometry test and real wrist selection |
| PC and phone menu | Garden street has separate guidance and Go now controls. At 390×844 the row fits inside the Places panel and Go now reaches the intended footway | Passed |
| Day / night guidance | The compact panel states Garden street above the view; the street remains visible below it. Final wording reports the remaining walking distance, not the spacing of internal path samples | Passed within captures |

Legacy avenue pavement is visually raised but still uses the habitat contact
floor. The bevels handle that boundary locally; this is not a migration of all
city pavement physics. The street-side openings are unchanged visually, so the
contact transition is established by physical probes rather than a screenshot.

The initial desktop camera fixture coincided with a resident's starting phase,
so its direction screenshot was crowded by that figure. The final fixture is
farther back on the same supported footway. That is a camera-fixture correction,
not a character-model change. Initial entrance measurements remain available.

## Reproduction

Verify preview ownership, build, then keep `dist/` unchanged while running:

```sh
SPINWARD_URL=https://127.0.0.1:<port> WALK=1 SEAMS=1 node qa/neighborhood-life/garden-directions.mjs
SPINWARD_URL=https://127.0.0.1:<port> TIER=quest WALK=1 node qa/neighborhood-life/garden-directions.mjs
SPINWARD_URL=https://127.0.0.1:<port> bun run test:xr
```

The scripts use public grounded URL fixtures, normal rotation and gravity,
real buttons and ordinary movement input. Debug probes only read position,
heading and route state. For the four entrance checks, the app's pure route
query supplies the itinerary; the script follows it with keys without writing
player or journey state. PNG / JSON browser evidence is ignored. Initial
entrance captures are retained under
`qa/webxr/evidence/garden-directions-20260913/browser-initial/`.

`bun test`: **897 passed**, zero failed, 154 files, including physical support,
cross-district routing and unavailable / driving UI checks. TypeScript and
production build passed. The existing bundle-size warning remains. The initial tested
bundle was `/assets/index-w_B8gANr.js`. A final wording pass makes the Garden
street hint show remaining walking distance rather than the one-metre spacing
of its internal curve samples.

## Browser and XR results

Both desktop and Quest-budget runs followed about 48 m of curved footway to
arrival with actual W / arrow-key input, and exercised Places, Go now, night
and phone-width views. No page or console errors were reported. The four
entrance round trips also passed, each returning to the legacy zero-height
contact floor. The verified limits are those fixtures and the unit coverage.

The complete playwright-webxr **0.3.0** suite passed **23 tests in 5.3 minutes**
without retries. The Garden street case performed actual wrist selection,
verified guidance did not teleport the player, retained stereo through
0/±25° head roll, used Go now to reach the footway, walked via the controller
and exited the matching session. Existing river / covered / crossing guidance
and both exit / re-entry paths passed. The suite's first evidence is preserved
under `xr-full-before-wording/`; it predates the final distance and footer fixes.

The final UI corrections passed **six relevant XR UI tests in 1.3 minutes**,
without retries: Garden street and the existing crossing, river, covered-walk
directions plus mono / stereo exit and re-entry. The enlarged final wrist
texture shows the 290×80 parking target above the instruction, with 26 px
between its bottom and the first text line. Garden street reports 49 m to
the destination instead of internal sample spacing. Final evidence is under
`xr-final-ui/`; the frozen bundle was `/assets/index-4YWZ7m20.js` before its
local commit stamp was recorded. The old footer overlap
is preserved in `xr-before-footer-fix/`. Review is self-review, not an independent
visual audit. Chrome 152 / Apple M1 Pro / ANGLE Metal is the tested hardware;
Quest and phone here are application budgets, and XR is emulated. Physical
headset performance and comfort remain untested. No package failure was observed.

## Remaining development

Vehicle guidance and autonomous traffic still use the rectangular street
network. Extending the curves to other districts and assigning right of way at
their intersections remain future increments. The reference's signal supports,
equipment and particular lighting are not marked implemented by these menus.
