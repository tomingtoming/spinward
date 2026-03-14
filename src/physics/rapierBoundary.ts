import * as THREE from 'three'
import type { RigidBody, RigidBodyDesc, World } from '@dimforge/rapier3d-compat'

import {
  asSim,
  asReal,
  toRealLength,
  toSimLength,
  toRealVec3,
  toSimVec3
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

export const scaleLengthForRapier = (realLength: number, simScale: number) =>
  Number(toSimLength(asReal(realLength), simScale))

export const scaleVector3ForRapier = (
  realVector: THREE.Vector3,
  simScale: number
) => {
  const scaled = toSimVec3(toRealStruct(realVector), simScale)

  return {
    x: Number(scaled.x),
    y: Number(scaled.y),
    z: Number(scaled.z)
  }
}

export const readRapierVectorAsReal = (
  value: { x: number; y: number; z: number },
  simScale: number,
  target = new THREE.Vector3()
) =>
  writeRealStruct(
    toRealVec3(
      {
        x: asSim(value.x),
        y: asSim(value.y),
        z: asSim(value.z)
      },
      simScale
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
  simScale: number
) => {
  const simPosition = scaleVector3ForRapier(pose.position, simScale)
  const simVelocity = scaleVector3ForRapier(
    pose.linearVelocity ?? new THREE.Vector3(),
    simScale
  )

  return world.createRigidBody(
    rigidBodyDesc
      .setTranslation(simPosition.x, simPosition.y, simPosition.z)
      .setLinvel(simVelocity.x, simVelocity.y, simVelocity.z)
  )
}

export const readRigidBodyPoseAsReal = (
  body: RigidBody,
  simScale: number,
  target = {
    position: new THREE.Vector3(),
    linearVelocity: new THREE.Vector3()
  }
) => {
  readRapierVectorAsReal(body.translation(), simScale, target.position)
  readRapierVectorAsReal(body.linvel(), simScale, target.linearVelocity)
  return target
}

export const setRigidBodyTranslationFromReal = (
  body: RigidBody,
  position: THREE.Vector3,
  simScale: number,
  wakeUp: boolean
) => {
  body.setTranslation(scaleVector3ForRapier(position, simScale), wakeUp)
}

export const setRigidBodyLinvelFromReal = (
  body: RigidBody,
  linearVelocity: THREE.Vector3,
  simScale: number,
  wakeUp: boolean
) => {
  body.setLinvel(scaleVector3ForRapier(linearVelocity, simScale), wakeUp)
}

export const setNextKinematicTranslationFromReal = (
  body: RigidBody,
  position: THREE.Vector3,
  simScale: number
) => {
  body.setNextKinematicTranslation(scaleVector3ForRapier(position, simScale))
}

export const applyImpulseReal = (
  body: RigidBody,
  impulse: THREE.Vector3,
  simScale: number,
  wakeUp: boolean
) => {
  const simImpulse = toSimVec3(toRealStruct(impulse), simScale)
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
  simScale: number,
  nominalRealThickness = 2,
  minimumSimThickness = 0.05
) =>
  Math.max(
    nominalRealThickness,
    Number(toRealLength(asSim(minimumSimThickness), simScale))
  )
