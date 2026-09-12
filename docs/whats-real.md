# What's real, what's approximated

Spinward is a physics demo first and a city second. This page says which parts
of what you feel are computed, which are closed-form approximations, and which
are art direction. If you find a claim here that the app contradicts, that is a
bug: please open an issue.

## The frames

- **The physics engine never sees a rotating world.** The [Rapier](https://rapier.rs/)
  world is created with zero gravity (`new rapier.World({ x: 0, y: 0, z: 0 })`)
  in an inertial frame. The colony wall is a collider that spins inside that
  frame at the habitat's ω.
- **Everything you see is that inertial simulation redrawn in the rotating
  frame.** Positions and velocities of the balls and the flying player live in
  the inertial frame and are transformed to colony coordinates each frame for
  rendering and input. The transform is a display layer; it never feeds forces
  back into the engine.
- So there is no "Coriolis force" or "centrifugal force" anywhere in the
  simulation code. Both appear because the camera rotates, which is the point.
  A debug HUD (`?debug`, *verification*) computes the rotating-frame
  pseudo-accelerations −2Ω×v and −Ω×(Ω×r) from the observed motion and compares
  them against the engine's actual acceleration; a mismatch raises a warning.

## Standing, jumping, throwing

- **Your weight is a real normal force.** Standing, you are a dynamic sphere
  resting on the spinning wall collider. The wall pushes you into a circle; the
  radial support you feel (shown as *felt g* in the dock) is Rapier's contact
  force, not a number typed in. Walking is a traction controller: it steers your
  tangential/axial velocity toward the stick with grip proportional to the
  local spin gravity, so on a slow spin you skid.
- **Airborne, nothing pulls on you.** Jump and you are a free body in the
  inertial frame; the floor curves up to meet you, slightly to one side, because
  the floor is what is moving. Landing hands you back to the contact model.
- The visible first-person body is an articulated visual approximation. Planted
  feet follow the ground while walking; flat-screen flight uses relaxed arms
  and bent knees aligned with the existing jetpack view attitude. These limbs
  do not apply forces or replace the player's sphere collider. Grounded XR
  hands follow current grips; XR flight still uses its existing controllers.
- **Thrown balls are rigid bodies in the same world.** They fly in straight
  lines in the inertial frame and curve on screen. They bounce off the wall via
  Rapier and off buildings via an analytic sphere-vs-box test done in the
  rotating frame (buildings are static there). They can leave through the open
  end caps. **There is no air drag on balls or on you.**
- **The dashed "Earth" line** drawn after a throw is not a simulation. It is the
  closed-form path the same release would take on a flat floor with constant
  gravity equal to the felt g at the release point, no Coriolis, no floor
  curvature. The gap between the ghost and the real trail is the spin, drawn.
- The public garden's supported hoop is a scoring plane for these same balls.
  Its supports/signs are visual equipment, without additional rigid-body
  colliders. Instructions and hit feedback are local to the practice area.

## Neighbourhood car share

- The usable car shares the city's ordinary sedan geometry and palette. Its
  near cabin adds seats, dashboard, steering wheel and inner pillars, with a
  seated camera. The exterior mesh is not the physical collision shape.
- Driving retains the sphere contact body and rotating-gravity grip model.
  Street mode starts by default: 3.8 m/s² nominal acceleration, 7 m/s² braking,
  an approximately 14 m/s forward governor and 3 m/s reverse governor. These
  are gameplay values. Experiment mode retains the original acceleration,
  contact friction and 178 m/s limit, including cancelling the wall's motion.
  Changing modes never instantly discards existing street-mode overspeed.
- One usable car remains where it was left. Central Square, the café and park
  have reserved kerb bays when suitable slots exist. A deliberate Park action
  assists alignment within two metres, below 0.6 m/s, already parallel to the
  bay. Street-mode dismounts require a near stop and a clear pavement within
  reach. Experimental dismounts retain the existing momentum-carrying behavior.
- Places → Directions guides a local outing without teleporting. Walking
  routes favour pavements; driving routes use the road footprint and end at
  parking. Dismounting changes the destination to the entrance. Your car uses
  the actual parked position. Visit now retains the immediate travel actions.
- Directions use a bounded two-metre street grid, exclude building footprints,
  and leave an indoor start through its certified entrance. They are not lane
  guidance or traffic-signal instructions, and do not account for pedestrians
  or every indoor furnishing. Routes beyond the local search bound report
  unavailable. Signs and bay markings are visual; the car keeps its sphere
  collision body, not a full vehicle chassis.

## Spin rate and the gravity gradient

- Surface gravity is g = ω²R. Change the rpm and the wall spins at a different
  rate; nothing else changes, and your weight, your jumps and the ball curves
  follow from that.
- Gravity falls linearly toward the axis, g(r) = ω²r. The Overlook stop is at
  an altitude capped at 60 m (about 0.981 g₀ on Izma); the Axis stop is at
  r = 0 (no weight). Half-weight requires h = R/2, which is 1,600 m on Izma.
- Rapier runs in scaled units (`simScale`, 0.02 for Izma) for floating-point
  headroom. All numbers shown to you are converted back to metres.

## Rain

- Rain is **analytic, not simulated per drop.** With air drag a falling drop
  reaches terminal velocity almost immediately, so the visible motion is a
  steady velocity field evaluated in closed form at the camera each frame.
- Two effects are in that field: terminal velocity scales with the local spin
  gravity ω²r (rain falls slower aloft and near-floats by the axis), and
  falling at v_t the drop feels the Coriolis push 2ωv_t against the spin,
  which drag balances at a steady antispinward drift of 2ω·v_t²/g. That is
  the slant you see, and it grows with altitude.
- Clouds are placed at the top of the air layer (art-directed altitude) and
  drift; they are not a weather model.
- Nearby room roofs reject streaks beneath their footprints, preserving open
  courtyard wells. This bounded vertical roof shadow is a rendering
  approximation, not rain colliding with every solid or drifting under eaves.

## Air and haze

- Horizontal visibility at street level is 16 km (Koschmieder, the
  Tokyo-summer number), tunable with `?fog=<metres>`.
- Extinction is Beer–Lambert, integrated along the view ray through a
  **boundary layer with a 500 m scale height** (`?bl=<metres>`, `?bl=0` gives
  the old uniform fog). A uniform fog of the same visibility washes the far
  side of the cylinder to sky colour from the ground (overhead contrast ≈ 21%);
  the layered air keeps the 10 km horizontal look and lets the opposite land
  strip read overhead (≈ 74%). Derivation (Japanese):
  [オニールシリンダーの空は何色か](https://toming.app/tech/2026/08/oneill-cylinder-sky/).
- Air pressure, temperature, wind and humidity are not modelled.
- Haze integration is clipped to the finite habitat cylinder. Vacuum before
  the outer hull contributes no haze; a view through a window counts only the
  air interval inside. The eight samples span that clipped interval, so moving
  far outside does not make them skip the interior air. The ring still uses
  its existing representative air-column approximation inside that envelope.

## Sun, mirrors, sky colour, day length

- The habitat is an Island Three layout: three 60° land strips alternating
  with three 60° window strips. The windows are real openings in the shell;
  through them you see the stars and the three exterior mirrors, hinged at the
  far end cap. Sunlight enters as three directional lights aimed through the
  windows, so buildings carry window-shaped shadows.
- The beam keeps the Sun's true colour at every hour. Inside the colony the
  reflected light crosses at most a few kilometres of air on a straight path,
  so Rayleigh reddening is roughly 50× weaker than an Earth sunset and would be
  imperceptible. Dusk reads from the beam sweeping off the floor and dimming,
  not from a warm tint.
- **The sky gradient itself is art direction**, a keyframed colour profile per
  habitat, not a scattering model. The haze takes its colour from that grade.
- Stars and the sun are a distant directional background. Their shell follows
  the observer, expands beyond the colony and preserves angular positions/size;
  it does not simulate a nearby star system. Star brightness is art-directed,
  with daylight suppression inside the air and an independent dim star field
  in vacuum. This is not eye adaptation or exposure-based stellar radiometry. Exterior travel frames the hull
  and mirror wings. On desktop/touch its view starts at inertial rest, retaining
  the chosen heading while the colony rotates; manual look remains available.
- One day-night cycle is **180 seconds** by default (a demo compression; a real
  colony would run 24 h). `?debug` exposes the cycle length.

## The city

- Everything built is procedural and fictional: road grids per land strip,
  parcels facing the roads, districts (old town at the spaceport end, civic
  core at the centre, farmland toward the frontier end), parked cars, street
  lamps, crossings. Vehicle and road models are [Kenney](https://www.kenney.nl/)
  CC0 assets; buildings are generated.
- Nearby street lamps contribute soft downward illumination to people and
  pavement using two local lights on desktop and one on phone/Quest profiles.
  The sources remain attached to visible fixtures and fade between selections.
  They cast no dynamic shadows; this is a bounded local-light approximation,
  not a full city lighting or occlusion simulation.
- **Gravity decreases with height.** Because g(h) = g₀(1 − h/R),
  high floors are lighter than the surface. Building massing and height caps
  are art-directed, not a structural simulation or evidence that taller
  buildings are structurally feasible.
- Selected public buildings contain ground-floor cafes, passages or open
  courtyards. Their walls, lintels, ceilings and major furniture share geometry
  with streamed player colliders and analytic ball collision. Detail changes
  do not change contact. [Scope and limits](building-interiors.md).
- Each city-scale preset also has one small public garden within an existing
  park parcel, reached from an adjacent road. Its loop, two usable benches and
  eight nearby trees are an authored amenity. Three supported garden lamps
  share the existing 2/1 local-light budgets and illuminate the entrance/seats.
  Benches, posts and these trunks have collision; paving and planted feet
  follow the curved floor. Other green
  parcels retain their existing landscape without automatically gaining paths.
- The spaceport sits on the axis at one end cap because docking is only
  possible where the habitat is not spinning against you. That is a layout
  decision the physics forces, not a physics result the app computes.
- Far geometry is baked into the shell texture past about 0.55 R and fades in
  with distance; near geometry is real meshes. This is level-of-detail, not
  physics, and it is why Quest sees the same city as desktop.

## Verification

- Automated tests cover frames, units, collisions, rain, haze, earth ghosts,
  city layout and interactions. Several compare a
  closed-form answer against the engine: e.g. the haze integral's CPU twin is
  checked against the analytic 2ρ₀H(1−e^(−R/H)), and the rotating-frame
  pseudo-force estimate is checked against inertial motion.
- Visual changes are judged against fixed camera stations before and after
  (luminance spread and edge variance in the same crop), not by eye alone.

## Not modelled

Structural mass and stress, radiation, life support, the colony's orbit and
attitude (no precession, no wobble), mirror optics beyond direction, sound
propagation (the exterior is silent by design: only your breath and heartbeat),
air drag, weather beyond the rain toggle, crowds.

## Numbers (Izma Colony, the default)

| | |
|---|---|
| Radius | 3,200 m |
| Length | 40,000 m |
| Spin | 0.5286 rpm (period 113.5 s) |
| Surface gravity | 1.00 g (ω²R) |
| Coriolis factor 2ω | 0.111 s⁻¹ (a 20 m/s throw curves at 2.2 m/s²) |
| Far side overhead | 6,400 m away |
| Street-level visibility | 16 km |
| Haze scale height | 500 m |
| Day-night cycle | 180 s (demo) |

Other presets: Playground (R 18 m, 5 rpm), Cooper Station (R 3,200 m, 0.5 rpm),
Elysium (ring, R 30,000 m, 0.1724 rpm).
