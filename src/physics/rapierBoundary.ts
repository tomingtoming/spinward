import * as THREE from 'three'
import type { RigidBody, RigidBodyDesc, World } from '@dimforge/rapier3d-compat'

import {
  asSim,
  asReal,
  createUnitsContext,
  type UnitsContext
} from '../units/units'

// Three/Rapier data crosses the real<->sim boundary only through these helpers.
const toRealStruct = (value: THREE.Vector3) => ({
  x: asReal(value.x),
  y: asReal(value.y),
  z: asReal(value.z)
})

const writeRealStruct = (
  value: { x: number; y: number; z: number },
  target = new THREE.Vector3()
) => target.set(value.x, value.y, value.z)

const resolveUnits = (units: UnitsContext | number) =>
  typeof units === 'number' ? createUnitsContext(units) : units

export const scaleLengthForRapier = (realLength: number, units: UnitsContext | number) =>
  resolveUnits(units).toSimLength(realLength)

export const scaleVector3ForRapier = (
  realVector: THREE.Vector3,
  units: UnitsContext | number
) => {
  const scaled = resolveUnits(units).toSimVec3(toRealStruct(realVector))

  return {
    x: Number(scaled.x),
    y: Number(scaled.y),
    z: Number(scaled.z)
  }
}

export const readRapierVectorAsReal = (
  value: { x: number; y: number; z: number },
  units: UnitsContext | number,
  target = new THREE.Vector3()
) =>
  writeRealStruct(
    resolveUnits(units).toRealVec3(
      {
        x: asSim(value.x),
        y: asSim(value.y),
        z: asSim(value.z)
      }
    ),
    target
  )

export const createRigidBodyAtRealPose = (
  world: World,
  rigidBodyDesc: RigidBodyDesc,
  pose: {
    position: THREE.Vector3
    linearVelocity?: THREE.Vector3
  },
  units: UnitsContext | number
) => {
  const resolvedUnits = resolveUnits(units)
  const simPosition = scaleVector3ForRapier(pose.position, resolvedUnits)
  const simVelocity = scaleVector3ForRapier(
    pose.linearVelocity ?? new THREE.Vector3(),
    resolvedUnits
  )

  return world.createRigidBody(
    rigidBodyDesc
      .setTranslation(simPosition.x, simPosition.y, simPosition.z)
      .setLinvel(simVelocity.x, simVelocity.y, simVelocity.z)
  )
}

export const readRigidBodyPoseAsReal = (
  body: RigidBody,
  units: UnitsContext | number,
  target = {
    position: new THREE.Vector3(),
    linearVelocity: new THREE.Vector3()
  }
) => {
  const resolvedUnits = resolveUnits(units)
  readRapierVectorAsReal(body.translation(), resolvedUnits, target.position)
  readRapierVectorAsReal(body.linvel(), resolvedUnits, target.linearVelocity)
  return target
}

export const setRigidBodyTranslationFromReal = (
  body: RigidBody,
  position: THREE.Vector3,
  units: UnitsContext | number,
  wakeUp: boolean
) => {
  body.setTranslation(scaleVector3ForRapier(position, resolveUnits(units)), wakeUp)
}

export const setRigidBodyLinvelFromReal = (
  body: RigidBody,
  linearVelocity: THREE.Vector3,
  units: UnitsContext | number,
  wakeUp: boolean
) => {
  body.setLinvel(scaleVector3ForRapier(linearVelocity, resolveUnits(units)), wakeUp)
}

export const setNextKinematicTranslationFromReal = (
  body: RigidBody,
  position: THREE.Vector3,
  units: UnitsContext | number
) => {
  body.setNextKinematicTranslation(scaleVector3ForRapier(position, resolveUnits(units)))
}

export const applyImpulseReal = (
  body: RigidBody,
  impulse: THREE.Vector3,
  units: UnitsContext | number,
  wakeUp: boolean
) => {
  const simImpulse = resolveUnits(units).toSimVec3(toRealStruct(impulse))
  body.applyImpulse(
    {
      x: Number(simImpulse.x),
      y: Number(simImpulse.y),
      z: Number(simImpulse.z)
    },
    wakeUp
  )
}

export const getStableWallThicknessReal = (
  units: UnitsContext | number,
  nominalRealThickness = 2,
  minimumSimThickness = 0.05
) =>
  Math.max(
    nominalRealThickness,
    resolveUnits(units).toRealLength(minimumSimThickness)
  )
