import * as THREE from 'three'
import type { Collider, World } from '@dimforge/rapier3d-compat'

import type { RapierModule } from './rapierContext'
import { scaleLengthForRapier } from './rapierBoundary'
import {
  buildCylinderFixedColliderSpecs,
  createFixedColliderSectorGrid,
  getActiveFixedColliderSectorKeys,
  getFixedColliderSectorCoord,
  getFixedColliderSectorKey,
  type FixedColliderSectorGrid
} from './fixedColliderLayout'
import { createUnitsContext, type UnitsContext } from '../units/units'

type FixedColliderEntry = {
  id: string
  collider: Collider
  sectorKey: string
}

type FixedColliderManagerConfig = {
  radius: number
  length: number
  units?: UnitsContext
}

const radialAxis = new THREE.Vector3(0, 1, 0)
const bodyRotation = new THREE.Quaternion()

export class FixedColliderManager {
  private readonly body
  private readonly entries: FixedColliderEntry[] = []
  private grid: FixedColliderSectorGrid | null = null
  private units: UnitsContext

  constructor(
    private readonly rapier: RapierModule,
    private readonly world: World,
    units?: UnitsContext
  ) {
    this.units = units ?? createUnitsContext(1)
    this.body = this.world.createRigidBody(this.rapier.RigidBodyDesc.kinematicPositionBased())
  }

  rebuild(config: FixedColliderManagerConfig) {
    this.units = config.units ?? this.units
    this.grid = createFixedColliderSectorGrid({
      radius: config.radius,
      length: config.length
    })

    for (const entry of this.entries.splice(0)) {
      this.world.removeCollider(entry.collider, false)
    }

    for (const spec of buildCylinderFixedColliderSpecs(config.radius, config.length)) {
      const sectorKey = getFixedColliderSectorKey(
        getFixedColliderSectorCoord(spec.center, this.grid)
      )
      const collider = this.world.createCollider(
        this.rapier.ColliderDesc.cuboid(
          scaleLengthForRapier(spec.halfExtents.x, this.units),
          scaleLengthForRapier(spec.halfExtents.y, this.units),
          scaleLengthForRapier(spec.halfExtents.z, this.units)
        )
          .setTranslation(
            scaleLengthForRapier(spec.center.x, this.units),
            scaleLengthForRapier(spec.center.y, this.units),
            scaleLengthForRapier(spec.center.z, this.units)
          )
          .setRotation(spec.rotation)
          .setFriction(0.7)
          .setRestitution(0.02),
        this.body
      )

      collider.setEnabled(false)
      this.entries.push({
        id: spec.id,
        collider,
        sectorKey
      })
    }
  }

  syncToFrame(frameAngle: number) {
    bodyRotation.setFromAxisAngle(radialAxis, frameAngle)
    this.body.setNextKinematicRotation(bodyRotation)
  }

  updateActiveColliders(dynamicPositions: readonly THREE.Vector3[]) {
    if (this.grid === null) {
      return
    }

    const activeKeys = getActiveFixedColliderSectorKeys(dynamicPositions, this.grid)

    for (const entry of this.entries) {
      entry.collider.setEnabled(activeKeys.has(entry.sectorKey))
    }
  }

  getDebugSnapshot() {
    let activeCount = 0

    for (const entry of this.entries) {
      if (entry.collider.isEnabled()) {
        activeCount += 1
      }
    }

    return {
      totalCount: this.entries.length,
      activeCount
    }
  }

  dispose() {
    for (const entry of this.entries.splice(0)) {
      this.world.removeCollider(entry.collider, false)
    }

    this.world.removeRigidBody(this.body)
  }
}
