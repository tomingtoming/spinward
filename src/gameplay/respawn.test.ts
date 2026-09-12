import { expect, test } from 'bun:test'
import * as THREE from 'three'

import { createPlayerTraversalState, getPlayerBodyRadius } from '../app/playerTraversal'
import { initRapier } from '../physics/rapierContext'
import {
  getOverlookAltitude,
  getExteriorVantage,
  respawnAxisEnd,
  respawnExterior,
  respawnInnerWall,
  respawnOldTown,
  respawnOverlook
} from './respawn'
import { getArrivalSquare } from '../objects/cityLayout'
import { centralPlazaArrival } from '../objects/civicArrival'
import { inertialPositionToRotating, inertialVelocityToRotating } from '../sim/frameTransforms'
import { createUnitsContext } from '../units/units'

test('respawnInnerWall places the player back on the inner wall center', () => {
  const state = createPlayerTraversalState({ axialPosition: 5, azimuth: 1 }, 10, 0.4, 1.1)

  respawnInnerWall(state, {
    radius: 10,
    frameAngle: 0.4,
    omega: 1.1
  })

  expect(state.mode).toBe('grounded')
  expect(state.surface.axialPosition).toBeCloseTo(0, 6)
  expect(state.surface.azimuth).toBeCloseTo(0, 6)
})

test('respawnOverlook places the player co-rotating above the plaza', () => {
  const radius = 18
  const state = createPlayerTraversalState({ axialPosition: 5, azimuth: 1 }, radius, 0.2, 0.5)

  respawnOverlook(state, {
    radius,
    frameAngle: 0.2,
    omega: 0.5
  })

  const rotatingPosition = inertialPositionToRotating(
    state.inertialPosition,
    0.2,
    new THREE.Vector3()
  )

  expect(state.mode).toBe('free-fly')
  expect(rotatingPosition.x).toBeCloseTo(radius - getOverlookAltitude(radius), 6)
  expect(rotatingPosition.y).toBeCloseTo(0, 6)
  expect(rotatingPosition.z).toBeCloseTo(0, 6)
})

test('respawnOldTown grounds the player on the arrival square at the port end', () => {
  const radius = 3200
  const length = 40000
  const state = createPlayerTraversalState({ axialPosition: 5, azimuth: 1 }, radius, 0.4, 1.1)

  const didRespawn = respawnOldTown(state, {
    radius,
    length,
    frameAngle: 0.4,
    omega: 1.1
  })

  expect(didRespawn).toBe(true)
  expect(state.mode).toBe('grounded')
  expect(state.surface.azimuth).toBeCloseTo(0, 6)
  expect(state.surface.axialPosition).toBeCloseTo(getArrivalSquare(radius, length)!.axial, 6)
  // The arrival square is in the old town near the port (-Y) end.
  expect(state.surface.axialPosition).toBeLessThan(-length * 0.25)
})

test('respawnOldTown refuses habitats too small for districts', () => {
  const state = createPlayerTraversalState({ axialPosition: 5, azimuth: 1 }, 18, 0.4, 1.1)

  const didRespawn = respawnOldTown(state, {
    radius: 18,
    length: 120,
    frameAngle: 0.4,
    omega: 1.1
  })

  expect(didRespawn).toBe(false)
  // The failed respawn must not move the player.
  expect(state.surface.axialPosition).toBeCloseTo(5, 6)
  expect(state.surface.azimuth).toBeCloseTo(1, 6)
})

test('respawnExterior hangs the player at inertial rest, letting the colony spin past', () => {
  const radius = 18
  const omega = 0.5
  const frameAngle = 0.2
  const state = createPlayerTraversalState({ axialPosition: 5, azimuth: 1 }, radius, frameAngle, omega)

  const didRespawn = respawnExterior(state, {
    type: 'cylinder',
    radius,
    length: 120,
    frameAngle,
    omega
  })

  const rotatingPosition = inertialPositionToRotating(
    state.inertialPosition,
    frameAngle,
    new THREE.Vector3()
  )
  const rotatingVelocity = inertialVelocityToRotating(
    state.inertialPosition,
    state.inertialVelocity,
    omega,
    frameAngle,
    new THREE.Vector3()
  )

  expect(didRespawn).toBe(true)
  expect(state.mode).toBe('free-fly')
  const vantage=getExteriorVantage({type:'cylinder',radius,length:120})
  expect(rotatingPosition.distanceTo(vantage)).toBeLessThan(1e-6)
  expect(Math.hypot(rotatingPosition.x,rotatingPosition.z)).toBeGreaterThan(radius)
  // The point: at rest in the INERTIAL frame, hanging in space while the
  // colony rotates past. (This flip-flopped once: co-rotating kept the colony
  // still in view but hid the spin — the reason the vantage exists — and a
  // free body can't orbit anyway.) Inertial rest = rotating-frame velocity
  // of magnitude omega * r, sweeping backwards.
  expect(state.inertialVelocity.length()).toBeCloseTo(0, 6)
  expect(rotatingVelocity.length()).toBeCloseTo(omega * Math.hypot(vantage.x,vantage.z), 6)
})

test('exterior views frame each inhabited hull on landscape and portrait screens',()=>{
  for(const [type,radius,length] of [['cylinder',18,120],['cylinder',3200,40000],['ring',30000,2000]] as const){
    for(const aspect of [390/844,1440/1000,2.4]){
      const camera=new THREE.PerspectiveCamera(70,aspect,.1,1e6)
      camera.position.copy(getExteriorVantage({type,radius,length,aspect,verticalFovDegrees:70}))
      camera.lookAt(0,0,0);camera.updateMatrixWorld(true)
      for(const y of [-length/2,length/2])for(let i=0;i<64;i++){
        const angle=i/64*Math.PI*2
        const point=new THREE.Vector3(Math.cos(angle)*radius,y,Math.sin(angle)*radius).project(camera)
        expect(Math.abs(point.x)).toBeLessThan(.94)
        expect(Math.abs(point.y)).toBeLessThan(.94)
        expect(point.z).toBeGreaterThan(-1);expect(point.z).toBeLessThan(1)
      }
    }
  }
})

test('getOverlookAltitude is clamped for tiny and giant habitats', () => {
  expect(getOverlookAltitude(4)).toBeCloseTo(8)
  expect(getOverlookAltitude(18)).toBeCloseTo(9)
  expect(getOverlookAltitude(3200)).toBeCloseTo(60)
})

test('exterior framing includes full-length mirror tips throughout a rotation', () => {
  const radius = 3200, length = 40000, mirrorReach = length * 1.02
  for (const aspect of [390 / 844, 1440 / 1000, 2.4]) {
    const camera = new THREE.PerspectiveCamera(70, aspect, .1, 1e6)
    camera.position.copy(getExteriorVantage({ type: 'cylinder', radius, length, mirrorReach, aspect }))
    camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true)
    for (let i = 0; i < 96; i++) for (const tip of [false, true]) for (const side of [-1, 1]) {
      const angle = i / 96 * Math.PI * 2
      const reach = radius + (tip ? mirrorReach : 0)
      const halfWidth = radius * 1.05 / 2 * side
      const point = new THREE.Vector3(
        Math.cos(angle) * reach - Math.sin(angle) * halfWidth,
        -length / 2 + (tip ? mirrorReach : 0),
        Math.sin(angle) * reach + Math.cos(angle) * halfWidth
      ).project(camera)
      expect(Math.abs(point.x)).toBeLessThan(.94)
      expect(Math.abs(point.y)).toBeLessThan(.94)
      expect(point.z).toBeGreaterThan(-1); expect(point.z).toBeLessThan(1)
    }
  }
})

test('respawnAxisEnd places the player on the axis near the cylinder end', () => {
  const state = createPlayerTraversalState({ axialPosition: 0, azimuth: 0 }, 10, 0.3, 1)

  const didRespawn = respawnAxisEnd(state, {
    type: 'cylinder',
    length: 120,
    frameAngle: 0.3,
    omega: 1,
    endMargin: 12
  })

  const rotatingPosition = inertialPositionToRotating(
    state.inertialPosition,
    0.3,
    new THREE.Vector3()
  )

  expect(didRespawn).toBe(true)
  expect(state.mode).toBe('free-fly')
  expect(rotatingPosition.x).toBeCloseTo(0, 6)
  expect(rotatingPosition.z).toBeCloseTo(0, 6)
  expect(rotatingPosition.y).toBeCloseTo(-48, 6)
})

test('respawnAxisEnd uses an adaptive end margin for short cylinders', () => {
  const state = createPlayerTraversalState({ axialPosition: 0, azimuth: 0 }, 18, 0, 1)

  const didRespawn = respawnAxisEnd(state, {
    type: 'cylinder',
    length: 120,
    frameAngle: 0,
    omega: 1
  })

  expect(didRespawn).toBe(true)
  expect(state.inertialPosition.y).toBeCloseTo(-48, 6)
})

test('respawnAxisEnd uses the ring center for ring habitats', () => {
  const state = createPlayerTraversalState({ axialPosition: 0, azimuth: 0 }, 10, 0, 1)

  const didRespawn = respawnAxisEnd(state, {
    type: 'ring',
    length: 2000,
    frameAngle: 0,
    omega: 1
  })

  expect(didRespawn).toBe(true)
  expect(state.mode).toBe('free-fly')
  expect(state.inertialPosition.x).toBeCloseTo(0, 6)
  expect(state.inertialPosition.y).toBeCloseTo(0, 6)
  expect(state.inertialPosition.z).toBeCloseTo(0, 6)
})

test('respawnInnerWall is defined in real meters while Rapier pose follows sim scale', async () => {
  const rapier = await initRapier()
  const izmaWorld = new rapier.World({ x: 0, y: 0, z: 0 })
  const elysiumWorld = new rapier.World({ x: 0, y: 0, z: 0 })
  const radius = 3200

  const izmaState = createPlayerTraversalState(
    { axialPosition: 0, azimuth: 0 },
    radius,
    0,
    0,
    { rapier, world: izmaWorld, units: createUnitsContext(0.02) }
  )
  const elysiumState = createPlayerTraversalState(
    { axialPosition: 0, azimuth: 0 },
    radius,
    0,
    0,
    { rapier, world: elysiumWorld, units: createUnitsContext(0.005) }
  )

  respawnInnerWall(izmaState, { radius, frameAngle: 0, omega: 0 })
  respawnInnerWall(elysiumState, { radius, frameAngle: 0, omega: 0 })

  expect(izmaState.inertialPosition.x).toBeCloseTo(Math.cos(centralPlazaArrival(radius).azimuth) * getPlayerBodyRadius(radius), 6)
  expect(elysiumState.inertialPosition.x).toBeCloseTo(Math.cos(centralPlazaArrival(radius).azimuth) * getPlayerBodyRadius(radius), 6)
  expect(izmaState.physics?.freeFlyBody.translation().x).toBeCloseTo(
    Math.cos(centralPlazaArrival(radius).azimuth) * getPlayerBodyRadius(radius) * 0.02,
    5
  )
  expect(elysiumState.physics?.freeFlyBody.translation().x).toBeCloseTo(
    Math.cos(centralPlazaArrival(radius).azimuth) * getPlayerBodyRadius(radius) * 0.005,
    5
  )

  izmaWorld.free()
  elysiumWorld.free()
})

test('respawnAxisEnd is defined in real meters while Rapier pose follows sim scale', async () => {
  const rapier = await initRapier()
  const izmaWorld = new rapier.World({ x: 0, y: 0, z: 0 })
  const elysiumWorld = new rapier.World({ x: 0, y: 0, z: 0 })
  const length = 40000
  const expectedAxisEndY = -(length * 0.5 - 50)

  const izmaState = createPlayerTraversalState(
    { axialPosition: 0, azimuth: 0 },
    3200,
    0,
    0,
    { rapier, world: izmaWorld, units: createUnitsContext(0.02) }
  )
  const elysiumState = createPlayerTraversalState(
    { axialPosition: 0, azimuth: 0 },
    3200,
    0,
    0,
    { rapier, world: elysiumWorld, units: createUnitsContext(0.005) }
  )

  expect(
    respawnAxisEnd(izmaState, {
      type: 'cylinder',
      length,
      frameAngle: 0,
      omega: 0
    })
  ).toBe(true)
  expect(
    respawnAxisEnd(elysiumState, {
      type: 'cylinder',
      length,
      frameAngle: 0,
      omega: 0
    })
  ).toBe(true)

  expect(izmaState.inertialPosition.y).toBeCloseTo(expectedAxisEndY, 6)
  expect(elysiumState.inertialPosition.y).toBeCloseTo(expectedAxisEndY, 6)
  expect(izmaState.physics?.freeFlyBody.translation().y).toBeCloseTo(expectedAxisEndY * 0.02, 6)
  expect(elysiumState.physics?.freeFlyBody.translation().y).toBeCloseTo(expectedAxisEndY * 0.005, 6)

  izmaWorld.free()
  elysiumWorld.free()
})
