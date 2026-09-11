---
origin: ai
created: 2026-09-12
---
# Overnight development — 2026-09-12

User-authorized window: until 08:00 Asia/Tokyo (2026-09-11 23:00 UTC).
Continue from the working branch `codex/neighborhood-life` in
`/Users/toming/keel/lake/spinward-development`. Public deployment/push is not
part of this request. The existing local preview is `https://127.0.0.1:5192`.

The accepted direction is embodied first-person presence: stand, walk, stop,
look down, then connect hands/seating and eventually artificial-gravity actions.
The user also explicitly asks to improve the colony as a whole and avoid
spending the whole night on one detail. Complete bounded, tested increments,
then reassess the street, movement, life, environment and performance together.

## First increment — standing body (00:52)

Standing body uses the original Blender resident hierarchy, hidden head,
independent torso heading, surface-space foot anchors and two-segment leg IK.
The existing room-only timed footsteps are being replaced with foot-contact
sounds indoors and outdoors. The existing seat and coffee hand must remain
intact. PC/touch walking is 1.8 m/s; PC Shift retains the previous 6 m/s speed.
VR still uses its original movement and controller display; the tracked body
adapter is not implemented yet and must not be claimed complete.

Current checks: motion, leg reach and surface-selection tests pass. Browser
checks passed desktop walking/running, large head turns, stopping, portrait
night display, coffee preparation/carrying/drinking/return and optional model
failure. Torso eye offset keeps both feet visible at rest. Contact events drive
sound; the camera does not inherit the gait. Independent image review found
no visible leg penetration but flagged the existing four-row phone HUD hiding
the body and the low contrast of unlit shoes at night. The HUD is a useful next
increment across the whole walking experience. Probe:
`qa/neighborhood-life/player-body.mjs` (`PLAYWRIGHT_MODULE` as in other probes).

## Second increment — phone view clearance (00:59)

At widths up to 720 px the dock keeps one 44 px row for fullscreen, the colony
preset, Travel and More. More reveals the secondary controls; Escape/click
closes them. Mobile game actions continue to measure the live dock height.
Chrome touch emulation at 320/390/720 px passes bounds, overlap, expansion,
weather toggles and the Travel menu; wide desktop controls remain visible.
Independent images confirm the improved view of the legs. Jump/Gyro still
overlap a small part of the right knee; this is a bounded remaining overlay,
not a reason to spend the whole night on HUD polish. 698 tests/build passed.

Next: connect the VR head/controller frame carefully, then improve activity
and movement through the wider colony. Avoid unbounded character-art polish,
new UI systems or a full ragdoll rewrite.
