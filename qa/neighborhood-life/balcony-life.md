---
origin: ai
created: 2026-09-13
---
# Residential balcony life checks

The public preview must be owned and its build must stay frozen during a run.
The script selects actual solid-parapet and rail-balcony homes from the current
city, then visits shared free-flight URLs. It never moves scene objects or
writes gameplay state. It runs with Bun because the selection imports the
application's TypeScript balcony planner.

```sh
SPINWARD_URL=https://127.0.0.1:5192 LABEL=final bun qa/neighborhood-life/balcony-life.mjs
SPINWARD_URL=https://127.0.0.1:5192 LABEL=framed TIER=quest bun qa/neighborhood-life/balcony-life.mjs
SPINWARD_URL=https://127.0.0.1:5192 LABEL=fallback VIEWS=near,detail ASSET_FAILURE=1 bun qa/neighborhood-life/balcony-life.mjs
SPINWARD_URL=https://127.0.0.1:5192 bun run test:xr
```

Views cover near/day, a view over the rail, night, medium and far. Native-metre
furniture matrices are read from the live GPU instances and compared with their
owning building/deck. The existing independent balcony/glazing probe remains
active. Near views must actually render chairs; far views must release the
target home's furniture. Other nearby buildings can still have furnishings.
The asset-failure route returns a valid empty glTF: buildings, existing balcony
decks and planting remain; furniture is omitted without an application error.

Initial captures used the body position as the eye position. Independent review
found that the close inspection cut the furniture off at the bottom. The
fixture now accounts for the 1.8m camera offset, and asserts that the near,
detail and night target projects within 0.1 of the screen centre. Wider surveys
require it within 0.95; nearby geometry can resolve a free-flight body away from
the requested position. The new XR fixture accounts for its 1.6m head pose and
checks the chair's screen position and invariant actual instance matrix.

Golden images use the same current source tree with only `colonyBuildings.ts`
read from commit b615a6d by a Vite pre-transform, into an isolated temporary
output. At this increment that is the only changed pre-existing runtime file.
Playwright routes just the resulting app JS for `BASELINE_DIR`; source assets
and the user's running preview are not replaced. `baselineAsset` records that
bundle. The original `before/after/detail` attempts are retained separately
from the final framed evidence; they are not proof of furniture foot contact.

This increment adds visual household use to existing exterior balconies. It
does not add apartment access, walkable balcony floors, furniture collision,
seat prompts or rooftop terraces. The 0.6m facade strip, 1.1m central approach
and partition margin are local layout constraints, not a legal egress claim.
Day/night captures verify unchanged window-light patterns; no new local light
or emissive furniture is introduced. Hardware GPU is a preflight requirement,
not proof of native Quest performance, headset comfort or frame-rate stability.

## Results — 2026-09-13

- Unit suite: 840 passed, zero failed; TypeScript and production build passed.
- `before-final` / `final`: ten desktop views each. `quest-framed`: ten Quest
  budget views. `fallback`: four views with the furniture asset unavailable.
  All recorded zero page errors. Observed furniture maxima were 432 triangles
  on desktop and 528 on the Quest budget; these are additional furniture only,
  not total scene cost or headset performance measurements.
- Live matrices match the owning balcony's metric transform, and far views
  release the target home's furniture. `plant-proof` additionally checks all
  3 solid-view and 12 rail-view pots against their leaf matrices and the actual
  pot mesh bottom, including the portions hidden by the guard.
- Independent review confirmed visible chair/table foot contact, scale,
  partitions and empty bays in desktop/Quest captures. A reported missing
  night-window mullion was withdrawn after equal-scale crops and pixel checks:
  all 146 inspected rows retained the dark bar in both versions. Window-frame
  matrix hashes also matched. No window change was needed.
- The baseline JS is the exact b615a6d bundle, SHA-256
  `5c53cc1b9ab0e3ffc82830c4c8b14784b49ea095c7fc107e072538267b773547`.
  The repeat crops are `before-repeat` / `plant-proof`; initial, incorrectly
  framed captures remain separate from the accepted images.

Limits apply per `ColonyBuildings` layer: 24 furnished bays in the main city
and 24 in the riverside layer, 48 allocated in total. The two scene budgets
observed at most 13 and 18 bays respectively. The planner leaves roughly 58%
of candidates empty before dimensional and per-building limits. No global
occupancy percentage or continuous frame-time claim is inferred from this rule.

The complete playwright-webxr 0.2.0 suite passed seven tests, nine immersive
sessions and nine exits in 2.2 minutes. Balcony stereo captures at 0/±25° retained
their world placement and passed independent image review in both eyes. The
hardware path was Apple M1 Pro / ANGLE Metal, Chrome 152.0.7977.83. See
`qa/webxr/evidence/balcony-life-20260913/` and `qa/webxr/README.md` for scope and
headset limitations. No served assets changed during the suite.
