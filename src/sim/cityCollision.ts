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
const axialAxis = new THREE.Vector3()
const triangle = new THREE.Triangle(), closest = new THREE.Vector3()
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
    if (building.surfaceMesh) {
      const dx = wrapToPi(sphereAzimuth - building.azimuth) * config.habitatRadius, dy = position.y - building.axial
      if (Math.abs(dx) > building.width / 2 + config.sphereRadius || Math.abs(dy) > building.depth / 2 + config.sphereRadius) continue
      const mesh = building.surfaceMesh
      const vertex = (v: THREE.Vector3, i: number) => {
        const a = building.azimuth + mesh[i] / config.habitatRadius, r = config.habitatRadius - mesh[i + 2]
        return v.set(Math.cos(a) * r, building.axial + mesh[i + 1], Math.sin(a) * r)
      }
      for (let i = 0; i < mesh.length; i += 9) {
        if (dx < Math.min(mesh[i],mesh[i+3],mesh[i+6])-config.sphereRadius || dx > Math.max(mesh[i],mesh[i+3],mesh[i+6])+config.sphereRadius ||
          dy < Math.min(mesh[i+1],mesh[i+4],mesh[i+7])-config.sphereRadius || dy > Math.max(mesh[i+1],mesh[i+4],mesh[i+7])+config.sphereRadius) continue
        vertex(triangle.a,i);vertex(triangle.b,i+3);vertex(triangle.c,i+6)
        if(triangle.getArea()<1e-10)continue
        triangle.closestPointToPoint(position,closest)
        normal.copy(position).sub(closest)
        const distance = normal.length()
        if (!Number.isFinite(distance) || distance >= config.sphereRadius) continue
        if(distance > 1e-9) normal.divideScalar(distance); else triangle.getNormal(normal)
        position.addScaledVector(normal,config.sphereRadius-distance)
        const speed=velocity.dot(normal)
        if(speed<0)velocity.addScaledVector(normal,-(1+config.restitution)*speed)
        collided=true
      }
      continue
    }
    const yawCos = Math.cos(building.yaw ?? 0), yawSin = Math.sin(building.yaw ?? 0)
    const halfWidth = building.width * 0.5
    const halfHeight = building.height * 0.5
    const halfDepth = building.depth * 0.5

    // Cheap rejects before any trig: axial band, radial band, azimuth arc.
    if (Math.abs(position.y - building.axial) > halfDepth * Math.abs(yawCos) + halfWidth * Math.abs(yawSin) + config.sphereRadius) {
      continue
    }

    const buildingRadialCenter = config.habitatRadius - (building.baseHeight ?? 0) - halfHeight

    if (Math.abs(sphereRadial - buildingRadialCenter) > halfHeight + config.sphereRadius) {
      continue
    }

    const tangentDistance =
      Math.abs(wrapToPi(sphereAzimuth - building.azimuth)) * sphereRadial

    if (tangentDistance > halfWidth * Math.abs(yawCos) + halfDepth * Math.abs(yawSin) + config.sphereRadius + 1) {
      continue
    }

    const cos = Math.cos(building.azimuth)
    const sin = Math.sin(building.azimuth)
    outward.set(cos, 0, sin)
    tangent.set(-sin * yawCos, yawSin, cos * yawCos)
    axialAxis.set(sin * yawSin, yawCos, -cos * yawSin)
    center.copy(outward).multiplyScalar(buildingRadialCenter).setY(building.axial)
    offset.copy(position).sub(center)

    const localTangent = offset.dot(tangent)
    const localRadial = offset.dot(outward)
    const localAxial = offset.dot(axialAxis)

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
      normal.addScaledVector(axialAxis, deltaAxial / distance)
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
        normal.copy(axialAxis).multiplyScalar(localAxial >= 0 ? 1 : -1)
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
