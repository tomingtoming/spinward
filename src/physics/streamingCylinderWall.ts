import * as THREE from 'three'
import type { Collider, World } from '@dimforge/rapier3d-compat'

import type { RapierModule } from './rapierContext'
import { getStableWallThicknessReal, scaleLengthForRapier } from './rapierBoundary'
import { createUnitsContext, type UnitsContext } from '../units/units'

type StreamingCylinderWallConfig = {
  radius: number
  length: number
  units?: UnitsContext
  targetPanelWidth?: number
  minSegments?: number
  maxSegments?: number
  activationPadding?: number
}

type StreamingCylinderWallSnapshot = {
  activeSectorCount: number
  activeSectorIds: number[]
  totalSectorCount: number
}

const radialAxis = new THREE.Vector3(0, 1, 0)
const bodyRotation = new THREE.Quaternion()

const normalizeAngle = (angle: number) =>
  THREE.MathUtils.euclideanModulo(angle, Math.PI * 2)

const resolveSectorCount = ({
  radius,
  targetPanelWidth = 1.5,
  minSegments = 96,
  maxSegments = 720
}: Required<Pick<StreamingCylinderWallConfig, 'radius' | 'targetPanelWidth' | 'minSegments' | 'maxSegments'>>) => {
  const estimated = Math.ceil((Math.PI * 2 * Math.max(radius, 0.001)) / targetPanelWidth)
  return Math.min(maxSegments, Math.max(minSegments, estimated))
}

const buildWallPanel = (
  radius: number,
  length: number,
  segmentCount: number,
  wallThickness: number,
  segmentIndex: number
) => {
  const angle = (segmentIndex / segmentCount) * Math.PI * 2
  const halfThickness = wallThickness * 0.5
  const panelWidth = 2 * radius * Math.tan(Math.PI / segmentCount) + wallThickness

  return {
    translation: new THREE.Vector3(
      Math.cos(angle) * (radius + halfThickness),
      0,
      Math.sin(angle) * (radius + halfThickness)
    ),
    rotation: new THREE.Quaternion().setFromAxisAngle(radialAxis, angle),
    halfExtents: new THREE.Vector3(halfThickness, length * 0.5, panelWidth * 0.5)
  }
}

export class StreamingCylinderWall {
  private readonly body
  private readonly colliders = new Map<number, Collider>()
  private units: UnitsContext
  private radius = 0
  private length = 0
  private wallThickness = 0
  private segmentCount = 0
  private activationPadding = 2

  constructor(
    private readonly rapier: RapierModule,
    private readonly world: World,
    units?: UnitsContext
  ) {
    this.units = units ?? createUnitsContext(1)
    this.body = this.world.createRigidBody(this.rapier.RigidBodyDesc.kinematicPositionBased())
  }

  rebuild(config: StreamingCylinderWallConfig) {
    this.units = config.units ?? this.units
    this.radius = scaleLengthForRapier(config.radius, this.units)
    this.length = scaleLengthForRapier(config.length, this.units)
    this.wallThickness = scaleLengthForRapier(
      getStableWallThicknessReal(this.units),
      this.units
    )
    this.segmentCount = resolveSectorCount({
      radius: this.radius,
      targetPanelWidth: config.targetPanelWidth ?? 1.5,
      minSegments: config.minSegments ?? 96,
      maxSegments: config.maxSegments ?? 720
    })
    this.activationPadding = Math.max(1, config.activationPadding ?? 2)

    for (const collider of this.colliders.values()) {
      this.world.removeCollider(collider, false)
    }

    this.colliders.clear()
  }

  syncToFrame(frameAngle: number) {
    bodyRotation.setFromAxisAngle(radialAxis, frameAngle)
    this.body.setNextKinematicRotation(bodyRotation)
  }

  updateActiveSectors(dynamicPositions: readonly THREE.Vector3[]) {
    if (this.segmentCount <= 0) {
      return
    }

    const activeSectors = new Set<number>()

    for (const position of dynamicPositions) {
      const azimuth = normalizeAngle(Math.atan2(position.z, position.x))
      const centerIndex = Math.floor((azimuth / (Math.PI * 2)) * this.segmentCount)

      for (
        let offset = -this.activationPadding;
        offset <= this.activationPadding;
        offset += 1
      ) {
        activeSectors.add(
          (centerIndex + offset + this.segmentCount) % this.segmentCount
        )
      }
    }

    for (const [segmentIndex, collider] of this.colliders) {
      if (activeSectors.has(segmentIndex)) {
        continue
      }

      this.world.removeCollider(collider, false)
      this.colliders.delete(segmentIndex)
    }

    for (const segmentIndex of activeSectors) {
      if (this.colliders.has(segmentIndex)) {
        continue
      }

      const panel = buildWallPanel(
        this.radius,
        this.length,
        this.segmentCount,
        this.wallThickness,
        segmentIndex
      )
      const collider = this.world.createCollider(
        this.rapier.ColliderDesc.cuboid(
          panel.halfExtents.x,
          panel.halfExtents.y,
          panel.halfExtents.z
        )
          .setTranslation(
            panel.translation.x,
            panel.translation.y,
            panel.translation.z
          )
          .setRotation(panel.rotation)
          .setFriction(0.8)
          .setRestitution(0.25),
        this.body
      )
      this.colliders.set(segmentIndex, collider)
    }
  }

  getDebugSnapshot(): StreamingCylinderWallSnapshot {
    const activeSectorIds = [...this.colliders.keys()].sort((left, right) => left - right)

    return {
      activeSectorCount: activeSectorIds.length,
      activeSectorIds,
      totalSectorCount: this.segmentCount
    }
  }

  dispose() {
    for (const collider of this.colliders.values()) {
      this.world.removeCollider(collider, false)
    }

    this.colliders.clear()
    this.world.removeRigidBody(this.body)
  }
}
