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
- **Thrown balls are rigid bodies in the same world.** They fly in straight
  lines in the inertial frame and curve on screen. They bounce off the wall via
  Rapier and off buildings via an analytic sphere-vs-box test done in the
  rotating frame (buildings are static there). They can leave through the open
  end caps. **There is no air drag on balls or on you.**
- **The dashed "Earth" line** drawn after a throw is not a simulation. It is the
  closed-form path the same release would take on a flat floor with constant
  gravity equal to the felt g at the release point, no Coriolis, no floor
  curvature. The gap between the ghost and the real trail is the spin, drawn.

## Spin rate and the gravity gradient

- Surface gravity is g = ω²R. Change the rpm and the wall spins at a different
  rate; nothing else changes, and your weight, your jumps and the ball curves
  follow from that.
- Gravity falls linearly toward the axis, g(r) = ω²r. The Overlook stop is at
  R/2 (half weight); the Axis stop is at r = 0 (no weight). Both are the same
  contact model at a different radius, not separate modes.
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
- One day-night cycle is **180 seconds** by default (a demo compression; a real
  colony would run 24 h). `?debug` exposes the cycle length.

## The city

- Everything built is procedural and fictional: road grids per land strip,
  parcels facing the roads, districts (old town at the spaceport end, civic
  core at the centre, farmland toward the frontier end), parked cars, street
  lamps, crossings. Vehicle and road models are [Kenney](https://www.kenney.nl/)
  CC0 assets; buildings are generated.
- **Building height follows the gravity gradient.** Because g(h) = g₀(1 − h/R),
  high floors are lighter than on Earth, so the civic core is allowed towers to
  about 230 m (0.93 g₀ on Izma) while the rest of the city is capped near 55 m.
  This is a design rule derived from the physics, not a simulation of
  structures.
- The spaceport sits on the axis at one end cap because docking is only
  possible where the habitat is not spinning against you. That is a layout
  decision the physics forces, not a physics result the app computes.
- Far geometry is baked into the shell texture past about 0.55 R and fades in
  with distance; near geometry is real meshes. This is level-of-detail, not
  physics, and it is why Quest sees the same city as desktop.

## Verification

- The simulation core (frames, units, collisions, rain field, haze integral,
  earth ghost, city layout) has about 490 unit tests. Several compare a
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
