// The throwables you can switch between (cycle with X on PC / right stick-click
// in VR). The ball is the original grab-and-throw toy; the beam rifle and the
// rocket firework are fire-and-forget glowing bolts that burst on impact.
export type ProjectileType = 'ball' | 'beam' | 'firework'

export type ProjectileSpec = {
  label: string
  radius: number
  // Mesh albedo and (for the glowing kinds) a constant emissive so the bolt
  // reads as light, not a lit sphere. emissive 0 means "no glow" (the ball).
  color: number
  emissive: number
  // Fixed muzzle speed in m/s for fire-and-forget kinds; 0 means "use the
  // grab-charge / desktop throw speed" (the ball).
  launchSpeed: number
  lifetimeSeconds: number
  // Burst a one-shot explosion FX and despawn on the first wall/building hit.
  explodeOnImpact: boolean
  explosionColor: number
  explosionRadius: number
  // Whether the right-hand can grab/hold it (only the ball; bolts fire on press).
  grabbable: boolean
  // If set, render as an elongated glowing bolt of this length (oriented to the
  // velocity) rather than a sphere. The beam uses this.
  boltLength?: number
  // Whether to draw the motion trail behind it (default true). The beam bolt is
  // its own streak, so it turns this off.
  trail?: boolean
}

// The beam flies at Gundam's on-screen mega-particle speed (~10 km/s; the
// canonical ≥0.1c is an instant invisible flash at colony scale). It is drawn as
// a bolt long enough to read as a CONTINUOUS ray — proportional to the speed, so
// the faster it flies the longer the streak (it spans this many seconds of
// travel, comfortably more than one frame even at 30 fps).
const BEAM_SPEED = 10000
const BEAM_LENGTH_SECONDS = 0.04

export const PROJECTILES: Record<ProjectileType, ProjectileSpec> = {
  ball: {
    label: 'Ball',
    radius: 0.18,
    color: 0xf59e0b,
    emissive: 0,
    launchSpeed: 0,
    lifetimeSeconds: 0, // 0 → use habitat ballLifetimeSeconds
    explodeOnImpact: false,
    explosionColor: 0,
    explosionRadius: 0,
    grabbable: true
  },
  beam: {
    label: 'Beam',
    // Glowing bolt; radius is the cross-section (it also sets the collider). Sized
    // so the bolt's DIAMETER (2 × 0.14 = 0.28 m) matches the firework projectile's
    // diameter (2 × radius 0.14) — a thin, clean shaft of light. boltLength scales
    // with the speed (BEAM_SPEED × BEAM_LENGTH_SECONDS ≈ 400 m) so the fast bolt
    // reads as a long continuous ray rather than a dot that teleports between
    // frames.
    radius: 0.14,
    boltLength: BEAM_SPEED * BEAM_LENGTH_SECONDS,
    trail: false,
    color: 0xc8f7ff,
    emissive: 0x4fd6ff,
    launchSpeed: BEAM_SPEED,
    lifetimeSeconds: 4,
    explodeOnImpact: true,
    explosionColor: 0x67e8f9,
    // The beam bursts FAR away (10 km/s → it reaches a distant wall in a blink),
    // so its burst must be large to read at range — bigger than the firework's,
    // which detonates close to the thrower.
    explosionRadius: 7,
    grabbable: false
  },
  firework: {
    label: 'Firework',
    radius: 0.14,
    color: 0xffe2b0,
    emissive: 0xff7a2a,
    launchSpeed: 30,
    lifetimeSeconds: 6,
    explodeOnImpact: true,
    explosionColor: 0xffb347,
    explosionRadius: 3.2,
    grabbable: false
  }
}

// Order the X / stick-click switch steps through.
export const PROJECTILE_CYCLE: ProjectileType[] = ['ball', 'beam', 'firework']

export const cycleProjectile = (current: ProjectileType): ProjectileType => {
  const index = PROJECTILE_CYCLE.indexOf(current)
  return PROJECTILE_CYCLE[(index + 1) % PROJECTILE_CYCLE.length]
}
