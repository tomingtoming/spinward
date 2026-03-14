import * as THREE from 'three'

export type CylinderCollisionConfig = {
  radius: number
  length: number
  sphereRadius: number
  restitution: number
}

export type RotatingCylinderCollisionConfig = CylinderCollisionConfig & {
  omega: number
  capEnds?: boolean
}

const radialNormal = new THREE.Vector2()
const collisionNormal = new THREE.Vector3()
const wallVelocity = new THREE.Vector3()
const relativeVelocity = new THREE.Vector3()

export const confineSphereToCylinder = (
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  config: CylinderCollisionConfig
) => {
  let collided = false
  const maxRadialDistance = Math.max(0, config.radius - config.sphereRadius)
  const radialDistance = Math.hypot(position.x, position.z)

  // Keep the sphere center on or inside the inner wall and reflect outward motion.
  if (radialDistance > maxRadialDistance && radialDistance > 0) {
    collided = true
    radialNormal.set(position.x / radialDistance, position.z / radialDistance)
    position.set(radialNormal.x * maxRadialDistance, position.y, radialNormal.y * maxRadialDistance)

    const outwardSpeed = velocity.x * radialNormal.x + velocity.z * radialNormal.y

    if (outwardSpeed > 0) {
      velocity.x -= (1 + config.restitution) * outwardSpeed * radialNormal.x
      velocity.z -= (1 + config.restitution) * outwardSpeed * radialNormal.y
    }
  }

  const halfLength = Math.max(0, config.length * 0.5 - config.sphereRadius)

  // Treat the cylinder ends as simple caps for Sprint 1.
  if (position.y > halfLength) {
    collided = true
    position.y = halfLength

    if (velocity.y > 0) {
      velocity.y *= -config.restitution
    }
  } else if (position.y < -halfLength) {
    collided = true
    position.y = -halfLength

    if (velocity.y < 0) {
      velocity.y *= -config.restitution
    }
  }

  return collided
}

export const confineSphereToRotatingCylinder = (
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  config: RotatingCylinderCollisionConfig
) => {
  let collided = false
  const maxRadialDistance = Math.max(0, config.radius - config.sphereRadius)
  const halfLength = Math.max(0, config.length * 0.5 - config.sphereRadius)
  const radialDistance = Math.hypot(position.x, position.z)
  const capEnds = config.capEnds ?? true

  if (
    radialDistance > maxRadialDistance &&
    radialDistance > 0 &&
    (capEnds || Math.abs(position.y) <= halfLength)
  ) {
    collided = true
    radialNormal.set(position.x / radialDistance, position.z / radialDistance)
    position.set(radialNormal.x * maxRadialDistance, position.y, radialNormal.y * maxRadialDistance)
    collisionNormal.set(radialNormal.x, 0, radialNormal.y)
    reflectAgainstMovingWall(position, velocity, collisionNormal, config.restitution, config.omega)
  }

  if (!capEnds) {
    return collided
  }

  if (position.y > halfLength) {
    collided = true
    position.y = halfLength
    collisionNormal.set(0, 1, 0)
    reflectAgainstMovingWall(position, velocity, collisionNormal, config.restitution, config.omega)
  } else if (position.y < -halfLength) {
    collided = true
    position.y = -halfLength
    collisionNormal.set(0, -1, 0)
    reflectAgainstMovingWall(position, velocity, collisionNormal, config.restitution, config.omega)
  }

  return collided
}

const reflectAgainstMovingWall = (
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  normal: THREE.Vector3,
  restitution: number,
  omega: number
) => {
  // The habitat wall is stationary only in the rotating frame, so reflect relative to its transport velocity.
  wallVelocity.set(omega * position.z, 0, -omega * position.x)
  relativeVelocity.copy(velocity).sub(wallVelocity)

  const outwardSpeed = relativeVelocity.dot(normal)

  if (outwardSpeed <= 0) {
    return
  }

  relativeVelocity.addScaledVector(normal, -(1 + restitution) * outwardSpeed)
  velocity.copy(relativeVelocity).add(wallVelocity)
}
