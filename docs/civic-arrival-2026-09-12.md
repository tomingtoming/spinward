---
origin: ai
created: 2026-09-12
---

# Central square, throwing lawn and car share

The growing city made three prototype objects conspicuous: the floating
THROUGH THE RING billboard, the spawn decal, and the separate procedural
player rover. The accepted direction was to give each facility a place in
the neighbourhood while retaining the rotating-gravity activities.

- **Arrival:** remove the ring and its old axial guide line. City starts and
  Surface returns use the pedestrian corner of Central Square. A bench,
  ordinary paving and a supported, lit-by-the-world sign identify the place.
  Small physics habitats retain their open central starting position.
- **Throwing lawn:** move the eight-metre axial lane inside the existing
  public garden. Park planning excludes trunks and buildings from that lane.
  The hoop has two supports, cross-members and feet; a small painted sign
  and throwing pad replace the camera-facing billboard. Instructions and
  results appear only near the practice area. The real ball, Earth comparison,
  single-score-per-ball rule and slow-throw unlock remain in use. Stable HUD
  card identities avoid repainting/uploading the same prompt every frame.
- **Car share:** reserve a real kerb slot outside intersections, excluding
  ordinary parked cars from the bay. The player car uses the same sedan
  geometry and palette as the traffic/parking fleet. Blender MCP inspection
  supplied the cabin dimensions; seats, dashboard, steering wheel, headlining
  and inner pillars supplement the shared exterior. The desktop eye is
  1.19 m above the wheel surface, within the cabin. Headlights operate when
  driving at night. A supported sign and muted bay corner markings identify
  the station. Entry/exit has a contextual action; exit follows the car's
  heading and uses the pavement side at its home bay.
- **Travel:** Ball practice and Car share join Places, mobile Travel and the
  wrist Places page. The wrist keeps 80 px target heights and expands its
  section/footer spacing to accommodate seven destinations. Preset changes
  resolve fresh city anchors and park the car after the new plan exists.

## Validation

Final checks: **807 tests passed**, production build passed. Both browser
interaction runs and both four-preset switch sequences completed without
page or shader errors.

- Unit coverage includes relocated real Rapier throws, city/phone/Quest
  planning budgets, clear arrival and car envelopes, shared fleet resource
  ownership, civic geometry disposal, and wrist target/footer bounds.
- `qa/neighborhood-life/civic-arrival.mjs`: desktop and 390 px touch-layout
  visits, real mouse/tap throws, car entry, throttle, braking, dismount,
  subsequent travel, and day/night screenshots. Evidence is the adjacent
  ignored `civic-arrival.json` and `civic-*.png` files.
- `qa/neighborhood-life/civic-presets.mjs`: Cooper, Elysium, Playground and
  Izma changes within one page at each screen size, checking the new anchors,
  destination availability, car placement, and stable practice card identity.
- Independent image review found the initial cabin's unsupported-looking
  headlining and stale driving instructions after dismount. Inner pillars
  and drive-card termination fixed both; revised screenshots were reviewed.

## Scope

There is one usable car and one reserved station per city. The cabin is a
visual approximation; the vehicle retains its existing rotating-wall physics
body and deliberately fast experiment tuning. The hoop is still a scoring
plane, not a solid disk; its supports and signs are visual equipment. These
changes do not add a fleet booking system, door animation, or solid equipment
colliders. Touch layout is browser-tested; physical phone and XR hardware
comfort have not been verified.
