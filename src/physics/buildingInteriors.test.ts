import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { initRapier } from './rapierContext'
import { createRotatingCityColliders } from './rotatingCityColliders'
import { applyWorldLengthUnit, PLAYER_COLLISION_GROUPS, readRigidBodyPoseAsReal, scaleLengthForRapier } from './rapierBoundary'
import { createUnitsContext } from '../units/units'
import { buildCityCollisionIndex, type CityBuilding } from '../objects/cityLayout'
import { createBuildingInterior, interiorCollisionBuildings } from '../objects/buildingInteriors'

// Exercise the real streamed Rapier path, not only the analytic ball resolver.
test('a player-sized body crosses both doors; the same elevated ceiling survives streaming', async () => {
  const rapier = await initRapier(), radius = 3200
  const units = createUnitsContext(0.02), s = (v: number) => scaleLengthForRapier(v, units)
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  applyWorldLengthUnit(world, units)
  const building: CityBuilding = { kind: 'block', tone: 0.5, azimuth: 0, axial: 0, width: 18, depth: 18, height: 24, front: { axis: 'axial', side: 1 } }
  const boxes = interiorCollisionBuildings(createBuildingInterior(building, 'passage'), radius)
  const city = createRotatingCityColliders(rapier, world, { radius, index: buildCityCollisionIndex(boxes, radius, 40000), units, omega: 0 })
  city.update(0, 0)
  const body = world.createRigidBody(rapier.RigidBodyDesc.dynamic().setTranslation(s(radius - 1.5), s(12), 0).setLinvel(0, s(-3), 0).setCcdEnabled(true))
  world.createCollider(rapier.ColliderDesc.ball(s(0.35)).setCollisionGroups(PLAYER_COLLISION_GROUPS), body)
  const position = new THREE.Vector3(), linearVelocity = new THREE.Vector3()
  for (let i = 0; i < 480; i++) { world.timestep = 1 / 60; world.step() }
  readRigidBodyPoseAsReal(body, units, { position, linearVelocity })
  expect(position.y).toBeLessThan(-11)
  expect(position.x).toBeCloseTo(radius - 1.5, 2)
  city.update(1, 10000)
  expect(city.activeCount()).toBe(0)
  city.update(0, 0)
  body.setTranslation({ x: s(radius - 3.5), y: 0, z: 0 }, true)
  body.setLinvel({ x: s(-2), y: 0, z: 0 }, true)
  for (let i = 0; i < 120; i++) world.step()
  readRigidBodyPoseAsReal(body, units, { position, linearVelocity })
  expect(radius - position.x).toBeLessThan(4.2)
  expect(radius - position.x).toBeGreaterThan(3)
  city.dispose(); world.free()
})
