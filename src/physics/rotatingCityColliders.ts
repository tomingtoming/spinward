import * as THREE from 'three'

import type { RapierModule } from './rapierContext'
import { BUILDING_COLLISION_GROUPS, scaleLengthForRapier } from './rapierBoundary'
import {
  collectCityBuildingsInWindow,
  type CityBuilding,
  type CityCollisionIndex
} from '../objects/cityLayout'
import { createUnitsContext, type UnitsContext } from '../units/units'

const Y_AXIS = new THREE.Vector3(0, 1, 0)
const buildingRotation = new THREE.Quaternion()

export type RotatingCityCollidersConfig = {
  radius: number
  index: CityCollisionIndex
  omega: number
  units?: UnitsContext
  // Half-size of the cell window streamed around the focus (1 = 3x3 cells).
  cellRadius?: number
  // Tangential/axial inflation (m) of each box so the car's small physics
  // sphere stops near where its much larger body would, instead of clipping in.
  margin?: number
  friction?: number
  restitution?: number
  collisionGroups?: number
}

type CityCollider = ReturnType<InstanceType<RapierModule['World']>['createCollider']>

// A co-rotating kinematic body that carries Rapier colliders for the city's
// buildings — but only for the buildings near the car/walker, streamed in and
// out as the focus moves (a full city is 6k-48k boxes; keeping them all on a
// spinning body blows the frame budget). The body's centre of mass is PINNED to
// the spin axis: the skyline is not rotationally symmetric, so a collider-
// derived COM would drift off-axis and the contact surface velocity would read
// wrong, friction-braking anything resting on a roof (proven in
// physics/buildingContact.test.ts). Boxes per building: local X = radial
// (height), Y = axial (depth), Z = tangential (width), spanning the floor
// (radius) inward to the roof (radius - height).
export const createRotatingCityColliders = (
  rapier: RapierModule,
  world: InstanceType<RapierModule['World']>,
  config: RotatingCityCollidersConfig
) => {
  let units = config.units ?? createUnitsContext(1)
  let radius = config.radius
  let index = config.index
  let cellRadius = config.cellRadius ?? 1
  const margin = config.margin ?? 0
  const friction = config.friction ?? 1.0
  const restitution = config.restitution ?? 0.05
  const collisionGroups = config.collisionGroups ?? BUILDING_COLLISION_GROUPS

  const body = world.createRigidBody(
    rapier.RigidBodyDesc.kinematicVelocityBased().setAdditionalMassProperties(
      1,
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 },
      { x: 0, y: 0, z: 0, w: 1 }
    )
  )
  body.setAngvel({ x: 0, y: config.omega, z: 0 }, true)

  const active = new Map<CityBuilding, CityCollider>()
  const near = new Set<CityBuilding>()

  const addCollider = (building: CityBuilding) => {
    const s = (meters: number) => scaleLengthForRapier(meters, units)
    const centerRadial = radius - building.height / 2
    buildingRotation.setFromAxisAngle(Y_AXIS, -building.azimuth)
    return world.createCollider(
      rapier.ColliderDesc.cuboid(
        s(building.height / 2),
        s(building.depth / 2 + margin),
        s(building.width / 2 + margin)
      )
        .setTranslation(
          s(Math.cos(building.azimuth) * centerRadial),
          s(building.axial),
          s(Math.sin(building.azimuth) * centerRadial)
        )
        .setRotation({
          x: buildingRotation.x,
          y: buildingRotation.y,
          z: buildingRotation.z,
          w: buildingRotation.w
        })
        .setFriction(friction)
        .setRestitution(restitution)
        .setCollisionGroups(collisionGroups)
        .setDensity(0),
      body
    )
  }

  const clearColliders = () => {
    for (const collider of active.values()) {
      world.removeCollider(collider, false)
    }
    active.clear()
  }

  return {
    body,

    // Stream the active set to the buildings within the window around the focus
    // (the car/walker surface position). Returns the active collider count.
    update(focusAzimuth: number, focusAxial: number) {
      collectCityBuildingsInWindow(index, focusAzimuth, focusAxial, cellRadius, near)

      for (const building of near) {
        if (!active.has(building)) {
          active.set(building, addCollider(building))
        }
      }

      for (const [building, collider] of active) {
        if (!near.has(building)) {
          world.removeCollider(collider, false)
          active.delete(building)
        }
      }

      return active.size
    },

    activeCount: () => active.size,

    setAngularVelocity(omega: number) {
      body.setAngvel({ x: 0, y: omega, z: 0 }, true)
    },

    // Rebuild for a new habitat/preset (scale, radius and the index all change).
    rebuild(next: {
      radius: number
      index: CityCollisionIndex
      units?: UnitsContext
      cellRadius?: number
    }) {
      clearColliders()
      radius = next.radius
      index = next.index
      units = next.units ?? units
      cellRadius = next.cellRadius ?? cellRadius
    },

    dispose() {
      clearColliders()
      world.removeRigidBody(body)
    }
  }
}
