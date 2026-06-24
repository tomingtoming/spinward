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
}

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
    // A fat glowing bolt — the beam reads thick even in the brief instant it is
    // visible at Gundam speed.
    radius: 0.4,
    color: 0xc8f7ff,
    emissive: 0x4fd6ff,
    // Gundam beam-rifle speed. The canonical mega-particle spec is ≥0.1c
    // (~30,000 km/s), which at colony scale is an instant invisible flash; this
    // matches the ON-SCREEN beam instead (frame-by-frame analysis ≈ 10 km/s) so
    // the bolt still streaks. ~10 km/s also crosses the ~40 km bore within its
    // lifetime, making it a true long-range beam vs the lobbed ball/firework.
    launchSpeed: 10000,
    lifetimeSeconds: 4,
    explodeOnImpact: true,
    explosionColor: 0x67e8f9,
    explosionRadius: 1.6,
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
