import * as THREE from 'three'

export type CylinderCollisionConfig = {
  radius: number
  length: number
  sphereRadius: number
  restitution: number
}

const radialNormal = new THREE.Vector2()

export const confineSphereToCylinder = (
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  config: CylinderCollisionConfig
) => {
  let collided = false
  const maxRadialDistance = Math.max(0, config.radius - config.sphereRadius)
  const radialDistance = Math.hypot(position.x, position.z)

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
