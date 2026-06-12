import * as THREE from 'three'

import { resolveBuildingsNear, type CityBuildingSource } from '../objects/cityLayout'

type CityCollisionConfig = {
  habitatRadius: number
  sphereRadius: number
  restitution: number
}

const TWO_PI = Math.PI * 2

const wrapToPi = (angle: number) => {
  const wrapped = ((angle % TWO_PI) + TWO_PI) % TWO_PI
  return wrapped > Math.PI ? wrapped - TWO_PI : wrapped
}

const outward = new THREE.Vector3()
const tangent = new THREE.Vector3()
const center = new THREE.Vector3()
const offset = new THREE.Vector3()
const normal = new THREE.Vector3()

// Resolves a sphere (rotating-frame position/velocity) against the city's
// building boxes. Buildings co-rotate with the habitat, so they are static in
// the rotating frame; each is an oriented box standing on the inner wall.
// Mutates position/velocity in place and returns true when a collision was
// resolved.
export const collideSphereWithBuildings = (
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  buildings: CityBuildingSource,
  config: CityCollisionConfig
): boolean => {
  if (config.habitatRadius <= 0) {
    return false
  }

  const sphereAzimuth = Math.atan2(position.z, position.x)
  const sphereRadial = Math.hypot(position.x, position.z)
  let collided = false

  for (const building of resolveBuildingsNear(buildings, sphereAzimuth, position.y)) {
    const halfWidth = building.width * 0.5
    const halfHeight = building.height * 0.5
    const halfDepth = building.depth * 0.5

    // Cheap rejects before any trig: axial band, radial band, azimuth arc.
    if (Math.abs(position.y - building.axial) > halfDepth + config.sphereRadius) {
      continue
    }

    const buildingRadialCenter = config.habitatRadius - halfHeight

    if (Math.abs(sphereRadial - buildingRadialCenter) > halfHeight + config.sphereRadius) {
      continue
    }

    const tangentDistance =
      Math.abs(wrapToPi(sphereAzimuth - building.azimuth)) * sphereRadial

    if (tangentDistance > halfWidth + config.sphereRadius + 1) {
      continue
    }

    const cos = Math.cos(building.azimuth)
    const sin = Math.sin(building.azimuth)
    outward.set(cos, 0, sin)
    tangent.set(-sin, 0, cos)
    center.copy(outward).multiplyScalar(buildingRadialCenter).setY(building.axial)
    offset.copy(position).sub(center)

    const localTangent = offset.dot(tangent)
    const localRadial = offset.dot(outward)
    const localAxial = offset.y

    const clampedTangent = THREE.MathUtils.clamp(localTangent, -halfWidth, halfWidth)
    const clampedRadial = THREE.MathUtils.clamp(localRadial, -halfHeight, halfHeight)
    const clampedAxial = THREE.MathUtils.clamp(localAxial, -halfDepth, halfDepth)

    const deltaTangent = localTangent - clampedTangent
    const deltaRadial = localRadial - clampedRadial
    const deltaAxial = localAxial - clampedAxial
    const distanceSq =
      deltaTangent * deltaTangent + deltaRadial * deltaRadial + deltaAxial * deltaAxial

    if (distanceSq >= config.sphereRadius * config.sphereRadius) {
      continue
    }

    let pushDistance: number

    if (distanceSq > 1e-12) {
      // Sphere center outside the box: push along the contact direction.
      const distance = Math.sqrt(distanceSq)
      normal
        .copy(tangent)
        .multiplyScalar(deltaTangent / distance)
        .addScaledVector(outward, deltaRadial / distance)
      normal.y += deltaAxial / distance
      pushDistance = config.sphereRadius - distance
    } else {
      // Center inside the box: exit through the nearest face.
      const exitTangent = halfWidth - Math.abs(localTangent)
      const exitRadial = halfHeight - Math.abs(localRadial)
      const exitAxial = halfDepth - Math.abs(localAxial)

      if (exitTangent <= exitRadial && exitTangent <= exitAxial) {
        normal.copy(tangent).multiplyScalar(localTangent >= 0 ? 1 : -1)
        pushDistance = exitTangent + config.sphereRadius
      } else if (exitRadial <= exitAxial) {
        normal.copy(outward).multiplyScalar(localRadial >= 0 ? 1 : -1)
        pushDistance = exitRadial + config.sphereRadius
      } else {
        normal.set(0, localAxial >= 0 ? 1 : -1, 0)
        pushDistance = exitAxial + config.sphereRadius
      }
    }

    position.addScaledVector(normal, pushDistance)

    const approachSpeed = velocity.dot(normal)

    if (approachSpeed < 0) {
      velocity.addScaledVector(normal, -(1 + config.restitution) * approachSpeed)
    }

    collided = true
  }

  return collided
}
