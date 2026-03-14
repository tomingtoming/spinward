import * as THREE from 'three'

import type { RapierModule } from './rapierContext'
import { getStableWallThicknessReal, scaleLengthForRapier } from './rapierBoundary'

export type RotatingCylinderConfig = {
  radius: number
  length: number
  simScale?: number
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

export const buildCylinderWallPanels = ({
  radius,
  length,
  segmentCount = 72,
  wallThickness = 2
}: RotatingCylinderConfig): CylinderWallPanel[] => {
  const panels: CylinderWallPanel[] = []
  const clampedSegments = Math.max(6, Math.floor(segmentCount))
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
    const simScale = nextConfig.simScale ?? 1
    const scaledConfig: RotatingCylinderConfig = {
      ...nextConfig,
      radius: scaleLengthForRapier(nextConfig.radius, simScale),
      length: scaleLengthForRapier(nextConfig.length, simScale),
      wallThickness: scaleLengthForRapier(
        nextConfig.wallThickness ?? getStableWallThicknessReal(simScale),
        simScale
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
