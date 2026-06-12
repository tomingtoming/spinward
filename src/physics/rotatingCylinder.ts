import * as THREE from 'three'

import type { RapierModule } from './rapierContext'
import { getStableWallThicknessReal, scaleLengthForRapier } from './rapierBoundary'
import { createUnitsContext, type UnitsContext } from '../units/units'

export type RotatingCylinderConfig = {
  radius: number
  length: number
  units?: UnitsContext
  segmentCount?: number
  wallThickness?: number
}

export type CylinderWallPanel = {
  translation: THREE.Vector3
  rotation: THREE.Quaternion
  halfExtents: THREE.Vector3
}

const radialAxis = new THREE.Vector3(0, 1, 0)

export const resolveCylinderWallSegmentCount = ({
  radius,
  segmentCount,
  targetSagitta = 0.04,
  minSegments = 24,
  maxSegments = 1024
}: Pick<RotatingCylinderConfig, 'radius' | 'segmentCount'> & {
  targetSagitta?: number
  minSegments?: number
  maxSegments?: number
}) => {
  if (segmentCount !== undefined) {
    return Math.max(6, Math.floor(segmentCount))
  }

  // Flat panels chord the true cylinder: pick the segment count so the
  // floor undulation (sagitta ~ R*theta^2/8) stays below targetSagitta
  // even on multi-kilometer habitats. The old fixed cap of 144 left the
  // Izma floor rippling by ~0.8m.
  const safeRadius = Math.max(radius, 0.001)
  const maxArc = Math.sqrt((8 * targetSagitta) / safeRadius)
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
  const panelWidth = 2 * radius * Math.tan(Math.PI / clampedSegments) + wallThickness

  for (let index = 0; index < clampedSegments; index += 1) {
    const angle = (index / clampedSegments) * Math.PI * 2
    panels.push({
      translation: new THREE.Vector3(
        Math.cos(angle) * (radius + halfThickness),
        0,
        Math.sin(angle) * (radius + halfThickness)
      ),
      rotation: new THREE.Quaternion().setFromAxisAngle(radialAxis, angle),
      halfExtents: new THREE.Vector3(halfThickness, length * 0.5, panelWidth * 0.5)
    })
  }

  return panels
}

type PanelEntry = {
  collider: ReturnType<InstanceType<RapierModule['World']>['createCollider']>
  localAzimuth: number
}

const normalizeAngleDiff = (diff: number) => {
  const wrapped = THREE.MathUtils.euclideanModulo(diff + Math.PI, Math.PI * 2) - Math.PI
  return Math.abs(wrapped)
}

export const createRotatingCylinderBody = (
  rapier: RapierModule,
  world: InstanceType<RapierModule['World']>,
  config: RotatingCylinderConfig
) => {
  const body = world.createRigidBody(rapier.RigidBodyDesc.kinematicVelocityBased())
  const panels: PanelEntry[] = []
  let currentRadius = config.radius

  const rebuild = (nextConfig: RotatingCylinderConfig) => {
    const units = nextConfig.units ?? createUnitsContext(1)
    currentRadius = nextConfig.radius
    const scaledConfig: RotatingCylinderConfig = {
      ...nextConfig,
      radius: scaleLengthForRapier(nextConfig.radius, units),
      length: scaleLengthForRapier(nextConfig.length, units),
      wallThickness: scaleLengthForRapier(
        nextConfig.wallThickness ?? getStableWallThicknessReal(units),
        units
      )
    }

    for (const panel of panels.splice(0)) {
      world.removeCollider(panel.collider, false)
    }

    const builtPanels = buildCylinderWallPanels(scaledConfig)

    for (let index = 0; index < builtPanels.length; index++) {
      const panel = builtPanels[index]
      const localAzimuth = (index / builtPanels.length) * Math.PI * 2
      const collider = world.createCollider(
        rapier.ColliderDesc.cuboid(
          panel.halfExtents.x,
          panel.halfExtents.y,
          panel.halfExtents.z
        )
          .setTranslation(panel.translation.x, panel.translation.y, panel.translation.z)
          .setRotation(panel.rotation)
          .setFriction(1.8)
          .setRestitution(0.02),
        body
      )
      collider.setEnabled(false)
      panels.push({ collider, localAzimuth })
    }
  }

  rebuild(config)

  return {
    body,
    rebuild,
    setAngularVelocity(omega: number) {
      body.setAngvel({ x: 0, y: omega, z: 0 }, true)
    },
    updateActiveColliders(
      playerAzimuth: number,
      frameAngle: number,
      activationRadius = 100
    ) {
      const maxAngle = currentRadius > 0.001
        ? activationRadius / currentRadius
        : Math.PI

      for (const panel of panels) {
        const worldAzimuth = panel.localAzimuth + frameAngle
        const angularDist = normalizeAngleDiff(worldAzimuth - playerAzimuth)
        panel.collider.setEnabled(angularDist < maxAngle)
      }
    },
    syncToFrame(frameAngle: number) {
      body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      const rotation = new THREE.Quaternion().setFromAxisAngle(radialAxis, frameAngle)
      body.setRotation(rotation, true)
    },
    dispose() {
      for (const panel of panels.splice(0)) {
        world.removeCollider(panel.collider, false)
      }

      world.removeRigidBody(body)
    }
  }
}
