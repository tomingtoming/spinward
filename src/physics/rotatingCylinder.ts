import * as THREE from 'three'

import type { RapierModule } from './rapierContext'
import { getStableWallThicknessReal, scaleLengthForRapier } from './rapierBoundary'
import { createUnitsContext, type UnitsContext } from '../units/units'

// Physics spec for the elevated expressway, in REAL metres (scaled for
// Rapier inside rebuild, like radius/length). Mirrors cityLayout's
// CityExpressway — keep the two in lockstep via buildExpresswayWallConfig.
export type ExpresswayWallConfig = {
  axial: number
  deckHeight: number
  deckWidth: number
  rampWidth: number
  collectorSpan: number
  ramps: Array<{ azimuthStart: number; azimuthSpan: number }>
}

export type RotatingCylinderConfig = {
  radius: number
  length: number
  units?: UnitsContext
  segmentCount?: number
  wallThickness?: number
  expressway?: ExpresswayWallConfig | null
}

export type CylinderWallPanel = {
  translation: THREE.Vector3
  rotation: THREE.Quaternion
  halfExtents: THREE.Vector3
  // Override for guide barriers: real fences deflect because they are
  // slick — at highway-gore angles the floor friction (1.8) self-locks a
  // sliding body instead of shepherding it along.
  friction?: number
}

// The colony spins about +Y (its longitudinal axis); panels co-rotate around it.
const spinAxis = new THREE.Vector3(0, 1, 0)

export const resolveCylinderWallSegmentCount = ({
  radius,
  segmentCount,
  targetSagitta = 0.04,
  targetRidgeAngle = 0.02,
  minSegments = 24,
  maxSegments = 1024
}: Pick<RotatingCylinderConfig, 'radius' | 'segmentCount'> & {
  targetSagitta?: number
  targetRidgeAngle?: number
  minSegments?: number
  maxSegments?: number
}) => {
  if (segmentCount !== undefined) {
    return Math.max(6, Math.floor(segmentCount))
  }

  // Flat panels chord the true cylinder. Two budgets pick the segment count:
  // - sagitta (R*theta^2/8): floor undulation depth, dominates at large R.
  // - ridge angle (theta): the dihedral between neighbouring panels. A body
  //   crossing a seam at speed v picks up ~v*theta of radial kick, so on
  //   small habitats (playground R=18 had 7.5 deg seams) walkers were
  //   launched airborne at every panel boundary.
  const safeRadius = Math.max(radius, 0.001)
  const maxArc = Math.min(
    Math.sqrt((8 * targetSagitta) / safeRadius),
    targetRidgeAngle
  )
  const estimated = Math.ceil((Math.PI * 2) / maxArc)
  return Math.min(maxSegments, Math.max(minSegments, estimated))
}

export const buildCylinderWallPanels = ({
  radius,
  length,
  segmentCount,
  wallThickness = 2
}: RotatingCylinderConfig): CylinderWallPanel[] => {
  const panels: CylinderWallPanel[] = []
  const clampedSegments = resolveCylinderWallSegmentCount({
    radius,
    segmentCount
  })
  const halfThickness = wallThickness * 0.5
  // Exactly the circumscribed-polygon side: adjacent inner faces then share
  // their edges with no overlap. Widening panels (the old +wallThickness)
  // made each box jut centimeters above its neighbour's walking surface —
  // a curb that wedged walkers and cars at every panel boundary.
  const panelWidth = 2 * radius * Math.tan(Math.PI / clampedSegments)

  for (let index = 0; index < clampedSegments; index += 1) {
    const angle = (index / clampedSegments) * Math.PI * 2
    panels.push({
      translation: new THREE.Vector3(
        Math.cos(angle) * (radius + halfThickness),
        0,
        Math.sin(angle) * (radius + halfThickness)
      ),
      // A +Y right-handed rotation maps local +X to (cos, 0, -sin): the
      // panel sits at azimuth +angle, so the box must rotate by -angle for
      // its thickness axis to point outward there. The old +angle yawed
      // every panel by twice its azimuth, turning the wall into a saw blade
      // that snagged tangential drivers at every seam.
      rotation: new THREE.Quaternion().setFromAxisAngle(spinAxis, -angle),
      halfExtents: new THREE.Vector3(halfThickness, length * 0.5, panelWidth * 0.5)
    })
  }

  return panels
}

// Panels for the expressway: a full symmetric deck ring (so the kinematic
// body's centre of mass stays on the axis, which the contact surface velocity
// depends on) plus short ramp treads pitched to the climb. Everything in the
// SCALED space of the given config, like buildCylinderWallPanels.
export const buildExpresswayPanels = (
  config: RotatingCylinderConfig & { expressway: ExpresswayWallConfig },
  realRadius: number
): CylinderWallPanel[] => {
  const panels: CylinderWallPanel[] = []
  const { expressway } = config
  const halfThickness = (config.wallThickness ?? 2) * 0.5
  // Everything in here lives in the SCALED space of `config`; literal sizes
  // (kerb height, barrier thickness...) are real metres and must be scaled
  // through this factor. Forgetting it once turned the kerbs into an
  // invisible 50 m ceiling ring that wedged the car at the top of the ramp.
  const metre = config.radius / realRadius
  const deckRadius = config.radius - expressway.deckHeight
  const segments = resolveCylinderWallSegmentCount({
    radius: realRadius - (expressway.deckHeight / config.radius) * realRadius,
    segmentCount: undefined
  })
  const panelWidth = 2 * deckRadius * Math.tan(Math.PI / segments)

  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2
    panels.push({
      translation: new THREE.Vector3(
        Math.cos(angle) * (deckRadius + halfThickness),
        expressway.axial,
        Math.sin(angle) * (deckRadius + halfThickness)
      ),
      rotation: new THREE.Quaternion().setFromAxisAngle(spinAxis, -angle),
      halfExtents: new THREE.Vector3(
        halfThickness,
        expressway.deckWidth * 0.5,
        panelWidth * 0.5
      )
    })
  }

  // Kerbs: two low full-circle rings standing on the deck edges, so a driver
  // (or an ambient car nudged by the player) cannot simply sail off the side.
  // Symmetric rings keep the kinematic body's centre of mass on the axis.
  const kerbHeight = 1 * metre
  const kerbHalfWidth = 0.3 * metre

  const wrapAngle = (angle: number) => {
    const wrapped = ((angle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
    return wrapped
  }
  // The ramps merge through the +axial edge, so that ring opens a gate over
  // each merge zone (three gates, 120 degrees apart — still symmetric).
  const inMergeGate = (angle: number) =>
    expressway.ramps.some((ramp) => {
      const progress = wrapAngle(angle - ramp.azimuthStart) / ramp.azimuthSpan
      return (
        progress >= 0.55 &&
        progress <= 1.05 + expressway.collectorSpan / ramp.azimuthSpan
      )
    })

  for (const side of [-1, 1]) {
    for (let index = 0; index < segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2

      if (side === 1 && inMergeGate(angle)) {
        continue
      }

      panels.push({
        translation: new THREE.Vector3(
          Math.cos(angle) * (deckRadius - kerbHeight * 0.5),
          expressway.axial + side * (expressway.deckWidth * 0.5 - kerbHalfWidth),
          Math.sin(angle) * (deckRadius - kerbHeight * 0.5)
        ),
        rotation: new THREE.Quaternion().setFromAxisAngle(spinAxis, -angle),
        halfExtents: new THREE.Vector3(kerbHeight * 0.5, kerbHalfWidth, panelWidth * 0.5)
      })
    }
  }

  // Ramp treads: ~9 real metres of arc each, surface following the linear
  // climb, pitched by rotating the box a touch further about the axis (the
  // surface normal lives in the outward-tangent plane, so pitch IS an extra
  // yaw here — see the -angle comment above).
  const rampAxial =
    expressway.axial + expressway.deckWidth * 0.5 + expressway.rampWidth * 0.5

  for (const ramp of expressway.ramps) {
    const arcLength = ramp.azimuthSpan * realRadius
    const treadCount = Math.max(6, Math.ceil(arcLength / 9))
    const pitch = Math.atan(
      expressway.deckHeight / Math.max(ramp.azimuthSpan * config.radius, 1e-6)
    )
    // Overshoot both ends: the first treads start BELOW grade (buried in the
    // wall, so the lane emerges with no lip to catch a wheel) and the last
    // run flat at deck height to close the seam with the deck ring.
    const padTreads = 2

    for (let index = -padTreads; index < treadCount + padTreads; index += 1) {
      const t = (index + 0.5) / treadCount
      const clamped = Math.min(1, t)
      const angle = ramp.azimuthStart + t * ramp.azimuthSpan
      const surfaceRadius = config.radius - expressway.deckHeight * clamped
      const treadArc = ramp.azimuthSpan / treadCount
      // Slight overlap hides the seams between pitched treads.
      const treadHalfLength = surfaceRadius * treadArc * 0.62
      const treadPitch = t < 1 ? pitch : 0

      // Street-side catch bonus near the ground (mirror of cityLayout's
      // getExpresswayRampCatchBonus, in this file's scaled space): a gore
      // straddler still hooks on instead of sliding to the street.
      const treadElevation = expressway.deckHeight * Math.max(0, Math.min(1, t))
      const catchBonus =
        1.2 * metre * Math.max(0, 1 - treadElevation / (3.5 * metre))

      panels.push({
        translation: new THREE.Vector3(
          // Toward the ground the climb continues below grade (t < 0 sinks
          // the tread outside the wall surface — a flush, catch-free mouth).
          Math.cos(angle) * (surfaceRadius + halfThickness),
          rampAxial + catchBonus * 0.5,
          Math.sin(angle) * (surfaceRadius + halfThickness)
        ),
        // Climbing +azimuth means the surface radius SHRINKS along local +Z,
        // and d|r|/dZ = sin(delta) for an extra +delta rotation — so the
        // uphill tilt needs -pitch. (+pitch tilted every tread against
        // travel: a sawtooth that hard-stopped the car at the ramp mouth.)
        rotation: new THREE.Quaternion().setFromAxisAngle(spinAxis, -angle - treadPitch),
        halfExtents: new THREE.Vector3(
          halfThickness,
          expressway.rampWidth * 0.5 + catchBonus * 0.5,
          treadHalfLength
        )
      })

      // Kerbs along both lane edges through the climb proper: once you are
      // on the ramp you cannot slip off sideways. The mouth (t < 0.08) stays
      // open so imprecise entries roll on, and the top hands over to the
      // collector's own kerbs and funnel.
      if (t > 0.08 && t < 0.97) {
        for (const side of [-1, 1] as const) {
          // The street-side kerb rides the catch band's outer edge and, low
          // on the climb, angles gently inward with barrier-slick friction:
          // a gore straddler slides along it INTO the lane instead of
          // stalling against it (same physics as the collector funnel).
          const guiding = side === 1 && t < 0.4
          const kerbAxial =
            side === -1
              ? rampAxial - expressway.rampWidth * 0.5 + 0.2 * metre
              : rampAxial +
                expressway.rampWidth * 0.5 +
                catchBonus -
                0.2 * metre

          const kerbRotation = new THREE.Quaternion().setFromAxisAngle(
            spinAxis,
            -angle - treadPitch
          )

          if (guiding) {
            kerbRotation.multiply(
              new THREE.Quaternion().setFromAxisAngle(
                new THREE.Vector3(1, 0, 0),
                0.04
              )
            )
          }

          panels.push({
            translation: new THREE.Vector3(
              Math.cos(angle) * (surfaceRadius - 0.4 * metre),
              kerbAxial,
              Math.sin(angle) * (surfaceRadius - 0.4 * metre)
            ),
            rotation: kerbRotation,
            halfExtents: new THREE.Vector3(
              0.4 * metre,
              0.2 * metre,
              treadHalfLength
            ),
            friction: guiding ? 0.05 : undefined
          })
        }
      }
    }

    // The collector: flat deck-height floor across the widened band (deck
    // edge to the lane's outer edge) past the top, plus an angled funnel
    // barrier that shepherds a straight driver onto the carriageway — the
    // highway-gore treatment, in colliders.
    const collectorStart = ramp.azimuthStart + ramp.azimuthSpan
    const collectorArc = expressway.collectorSpan
    const collectorSegments = Math.max(6, Math.ceil((collectorArc * realRadius) / 9))
    const laneOuter =
      expressway.axial + expressway.deckWidth * 0.5 + expressway.rampWidth
    const bandCentre = (expressway.axial + expressway.deckWidth * 0.5 + laneOuter) * 0.5
    const bandHalfWidth = laneOuter - bandCentre

    for (let index = 0; index < collectorSegments; index += 1) {
      const t = (index + 0.5) / collectorSegments
      const angle = collectorStart + t * collectorArc
      const segmentArc = collectorArc / collectorSegments

      panels.push({
        translation: new THREE.Vector3(
          Math.cos(angle) * (deckRadius + halfThickness),
          bandCentre,
          Math.sin(angle) * (deckRadius + halfThickness)
        ),
        rotation: new THREE.Quaternion().setFromAxisAngle(spinAxis, -angle),
        halfExtents: new THREE.Vector3(
          halfThickness,
          bandHalfWidth,
          deckRadius * segmentArc * 0.62
        )
      })

      // Funnel barrier segment: yawed about the radial axis so its face
      // meets traffic at a few degrees and the sphere slides along it.
      const barrierAxial =
        laneOuter +
        (expressway.axial + expressway.deckWidth * 0.5 - 0.6 * metre - laneOuter) * t
      const funnelYaw = Math.atan(
        (expressway.rampWidth / Math.max(collectorArc * config.radius, 1e-6)) * 1
      )
      const barrierRotation = new THREE.Quaternion()
        .setFromAxisAngle(spinAxis, -angle)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), funnelYaw))

      panels.push({
        translation: new THREE.Vector3(
          Math.cos(angle) * (deckRadius - 0.75 * metre),
          barrierAxial,
          Math.sin(angle) * (deckRadius - 0.75 * metre)
        ),
        rotation: barrierRotation,
        halfExtents: new THREE.Vector3(
          0.75 * metre,
          0.25 * metre,
          deckRadius * segmentArc * 0.7
        ),
        friction: 0.05
      })
    }
  }

  return panels
}

type WallCollider = ReturnType<InstanceType<RapierModule['World']>['createCollider']>

export const createRotatingCylinderBody = (
  rapier: RapierModule,
  world: InstanceType<RapierModule['World']>,
  config: RotatingCylinderConfig
) => {
  const body = world.createRigidBody(rapier.RigidBodyDesc.kinematicVelocityBased())
  const panels: WallCollider[] = []

  const rebuild = (nextConfig: RotatingCylinderConfig) => {
    const units = nextConfig.units ?? createUnitsContext(1)
    const scaledConfig: RotatingCylinderConfig = {
      ...nextConfig,
      radius: scaleLengthForRapier(nextConfig.radius, units),
      length: scaleLengthForRapier(nextConfig.length, units),
      // The sagitta budget is a real-world ripple tolerance, so the segment
      // count must come from the REAL radius. Resolving it from the scaled
      // radius gave izma 89 panels (2m floor ripple) instead of 628.
      segmentCount: resolveCylinderWallSegmentCount({
        radius: nextConfig.radius,
        segmentCount: nextConfig.segmentCount
      }),
      wallThickness: scaleLengthForRapier(
        nextConfig.wallThickness ?? getStableWallThicknessReal(units),
        units
      )
    }

    for (const panel of panels.splice(0)) {
      world.removeCollider(panel, false)
    }

    // Every panel stays enabled, always. Rapier derives the kinematic body's
    // center of mass from its enabled colliders and computes contact surface
    // velocity as angvel x (point - com): only the full symmetric ring keeps
    // the com on the axis. Enabling just an arc near the player put the com
    // at the player's feet, so the wall surface read as static and friction
    // braked walkers/cars toward inertial rest (~13 m/s lost at izma scale).
    const builtPanels = buildCylinderWallPanels(scaledConfig)

    if (nextConfig.expressway != null) {
      builtPanels.push(
        ...buildExpresswayPanels(
          {
            ...scaledConfig,
            expressway: {
              ...nextConfig.expressway,
              axial: scaleLengthForRapier(nextConfig.expressway.axial, units),
              deckHeight: scaleLengthForRapier(nextConfig.expressway.deckHeight, units),
              deckWidth: scaleLengthForRapier(nextConfig.expressway.deckWidth, units),
              rampWidth: scaleLengthForRapier(nextConfig.expressway.rampWidth, units)
            }
          },
          nextConfig.radius
        )
      )
    }
    // Rounded edges: bodies rest a few millimeters into the face, so a sharp
    // neighbour edge at each seam was a lip that hard-blocked tangential
    // motion. A fillet bigger than the rest penetration turns the seam into
    // a smooth ridge; capping it against the panel width keeps most of the
    // walking face flat.
    const borderRadius = builtPanels.length > 0
      ? Math.min(
          scaleLengthForRapier(0.15, units),
          builtPanels[0].halfExtents.x * 0.5,
          builtPanels[0].halfExtents.z * 0.3
        )
      : 0

    for (const panel of builtPanels) {
      panels.push(
        world.createCollider(
          rapier.ColliderDesc.roundCuboid(
            Math.max(panel.halfExtents.x - borderRadius, borderRadius),
            Math.max(panel.halfExtents.y - borderRadius, borderRadius),
            Math.max(panel.halfExtents.z - borderRadius, borderRadius),
            borderRadius
          )
            .setTranslation(panel.translation.x, panel.translation.y, panel.translation.z)
            .setRotation(panel.rotation)
            .setFriction(panel.friction ?? 1.8)
            .setRestitution(0.02),
          body
        )
      )
    }
  }

  rebuild(config)

  return {
    body,
    rebuild,
    setAngularVelocity(omega: number) {
      body.setAngvel({ x: 0, y: omega, z: 0 }, true)
    },
    syncToFrame(frameAngle: number) {
      body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      const rotation = new THREE.Quaternion().setFromAxisAngle(spinAxis, frameAngle)
      body.setRotation(rotation, true)
    },
    dispose() {
      for (const panel of panels.splice(0)) {
        world.removeCollider(panel, false)
      }

      world.removeRigidBody(body)
    }
  }
}
