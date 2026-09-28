import { expect, test } from 'bun:test'
import { Vector3 } from 'three'
import { initRapier } from '../physics/rapierContext'
import { applyWorldLengthUnit, createRigidBodyAtRealPose, readRigidBodyPoseAsReal, PLAYER_COLLISION_GROUPS } from '../physics/rapierBoundary'
import { createRotatingCityColliders } from '../physics/rotatingCityColliders'
import { buildCityCollisionIndex } from '../objects/cityLayout'
import { createUnitsContext, periodToOmega } from '../units/units'
import { metroCollisionParts } from './metroCollision'
import { metroSurfaceLocation } from './metroPlacement'
import { metroPhysicsSubsteps } from './metroPhysics'

const radius = 3200, omega = periodToOmega(113.5), units = createUnitsContext(.02)

test('co-rotation and ordinary walking do not subdivide a 60 Hz frame', () => {
  for (const a of [0, 2 * Math.PI / 3, 4 * Math.PI / 3]) {
    const p = new Vector3(Math.cos(a) * radius, -8700, Math.sin(a) * radius)
    const v = new Vector3(omega * p.z, 3, -omega * p.x)
    expect(metroPhysicsSubsteps(p, v, omega, 1 / 60)).toBe(1)
  }
})

// Real Rapier contact, native triangles, full colony radius and production
// scaling. No altitude clamp or analytic ground-follow may rescue the fall.
async function fall(band: number, speed: number, dt: number, adaptive: boolean) {
  const rapier = await initRapier(), world = new rapier.World({ x: 0, y: 0, z: 0 })
  applyWorldLengthUnit(world, units)
  const parts = metroCollisionParts([{ name: 'terrain', attributes: {
    position: Float32Array.from([-20, 8680, 29, 20, 8680, 29, 20, 8720, 29, -20, 8720, 29]),
    index: Uint32Array.from([0, 1, 2, 0, 2, 3])
  } }], band, radius)
  const index = buildCityCollisionIndex(parts, radius, 40000)
  const city = createRotatingCityColliders(rapier, world, { radius, omega, units, index })
  const location = metroSurfaceLocation(band, 0, 8700, radius)
  city.update(location.azimuth, location.axial)
  const outward = new Vector3(Math.cos(location.azimuth), 0, Math.sin(location.azimuth))
  const p = outward.clone().multiplyScalar(radius - 30); p.y = location.axial
  const v = new Vector3(omega * p.z, 0, -omega * p.x).addScaledVector(outward, speed)
  const body = createRigidBodyAtRealPose(world, rapier.RigidBodyDesc.dynamic().setGravityScale(0)
    .setLinearDamping(0).lockRotations().setCanSleep(false).setCcdEnabled(false), { position: p, linearVelocity: v }, units)
  world.createCollider(rapier.ColliderDesc.ball(.32 * units.simScale).setFriction(.5)
    .setFrictionCombineRule(rapier.CoefficientCombineRule.Min).setRestitution(.02)
    .setCollisionGroups(PLAYER_COLLISION_GROUPS), body)
  const pose = { position: p, linearVelocity: v }
  let maxRadial = 0
  try {
    for (let frame = 0; frame < Math.round(2 / dt); frame++) {
      const steps = adaptive ? metroPhysicsSubsteps(pose.position, pose.linearVelocity, omega, dt) : 1
      world.timestep = dt / steps
      for (let step = 0; step < steps; step++) world.step()
      readRigidBodyPoseAsReal(body, units, pose)
      maxRadial = Math.max(maxRadial, Math.hypot(pose.position.x, pose.position.z))
    }
    return { maxRadial, speed: pose.linearVelocity.length(), radial: Math.hypot(pose.position.x, pose.position.z) }
  } finally { city.dispose(); world.free() }
}

test('a high-speed fall through thin native terrain reproduces without substeps', async () => {
  expect((await fall(0, 100, 1 / 30, false)).maxRadial).toBeGreaterThan(radius)
})

test('adaptive contact catches fast falls on all three rotated strips', async () => {
  for (const band of [0, 1, 2]) for (const [speed, dt] of [[40, 1 / 30], [100, 1 / 20]]) {
    const result = await fall(band, speed, dt, true)
    expect(result.maxRadial).toBeLessThan(radius - 29)
    expect(result.radial).toBeGreaterThan(radius - 30)
    // Contact preserves transport by the spinning surface rather than CCD
    // arresting the body in the inertial frame.
    expect(result.speed).toBeGreaterThan(170)
    expect(result.speed).toBeLessThan(182)
  }
})

test('high-speed activation includes a wall beyond the old 28 m window before the physics step',async()=>{
  const rapier=await initRapier(),world=new rapier.World({x:0,y:0,z:0})
  applyWorldLengthUnit(world,units)
  const parts=metroCollisionParts([{name:'buildings',attributes:{
    position:Float32Array.from([-20,-40,0,20,-40,0,20,-40,40,-20,-40,40]),
    index:Uint32Array.from([0,2,1,0,3,2])
  }}],0,radius)
  const city=createRotatingCityColliders(rapier,world,{radius,omega,units,index:buildCityCollisionIndex(parts,radius,40000)})
  const p=new Vector3(radius-10,0,0),v=new Vector3(0,100,-omega*(radius-10))
  const body=createRigidBodyAtRealPose(world,rapier.RigidBodyDesc.dynamic().setGravityScale(0).setLinearDamping(0).lockRotations().setCanSleep(false),{position:p,linearVelocity:v},units)
  world.createCollider(rapier.ColliderDesc.ball(.6*units.simScale).setCollisionGroups(PLAYER_COLLISION_GROUPS),body)
  try{
    expect(city.update(0,0)).toBe(0)
    expect(city.update(0,0,60)).toBeGreaterThan(0)
    const steps=metroPhysicsSubsteps(p,v,omega,.05);world.timestep=.05/steps
    for(let i=0;i<steps*12;i++)world.step()
    const pose={position:p,linearVelocity:v};readRigidBodyPoseAsReal(body,units,pose)
    expect(pose.position.y).toBeLessThan(40)
    expect(pose.position.y).toBeGreaterThan(35)
  }finally{city.dispose();world.free()}
})
