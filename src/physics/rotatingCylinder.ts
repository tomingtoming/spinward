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
const wallRotation = new THREE.Quaternion()

export const resolveCylinderWallSegmentCount = ({
  radius,
  segmentCount,
  targetPanelWidth = 6,
  minSegments = 24,
  maxSegments = 144
}: Pick<RotatingCylinderConfig, 'radius' | 'segmentCount'> & {
  targetPanelWidth?: number
  minSegments?: number
  maxSegments?: number
}) => {
  if (segmentCount !== undefined) {
    return Math.max(6, Math.floor(segmentCount))
  }

  const estimated = Math.ceil((Math.PI * 2 * Math.max(radius, 0.001)) / targetPanelWidth)
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

export const createRotatingCylinderBody = (
  rapier: RapierModule,
  world: InstanceType<RapierModule['World']>,
  config: RotatingCylinderConfig
) => {
  const body = world.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased())
  const colliders: ReturnType<InstanceType<RapierModule['World']>['createCollider']>[] = []

  const rebuild = (nextConfig: RotatingCylinderConfig) => {
    const units = nextConfig.units ?? createUnitsContext(1)
    const scaledConfig: RotatingCylinderConfig = {
      ...nextConfig,
      radius: scaleLengthForRapier(nextConfig.radius, units),
      length: scaleLengthForRapier(nextConfig.length, units),
      wallThickness: scaleLengthForRapier(
        nextConfig.wallThickness ?? getStableWallThicknessReal(units),
        units
      )
    }

    for (const collider of colliders.splice(0)) {
      world.removeCollider(collider, false)
    }

    for (const panel of buildCylinderWallPanels(scaledConfig)) {
      const collider = world.createCollider(
        rapier.ColliderDesc.cuboid(
          panel.halfExtents.x,
          panel.halfExtents.y,
          panel.halfExtents.z
        )
          .setTranslation(panel.translation.x, panel.translation.y, panel.translation.z)
          .setRotation(panel.rotation)
          .setFriction(0.8)
          .setRestitution(0.25),
        body
      )
      colliders.push(collider)
    }
  }

  rebuild(config)

  return {
    body,
    rebuild,
    syncToFrame(frameAngle: number) {
      wallRotation.setFromAxisAngle(radialAxis, frameAngle)
      body.setNextKinematicRotation(wallRotation)
    },
    dispose() {
      for (const collider of colliders.splice(0)) {
        world.removeCollider(collider, false)
      }

      world.removeRigidBody(body)
    }
  }
}
