import * as THREE from 'three'

export type CloudPuff = {
  azimuth: number
  radial: number
  axial: number
  scale: number
  tone: number
}

export type CloudPlanConfig = {
  radius: number
  length: number
  seed?: number
}

const DEFAULT_SEED = 0x3d7a92c1
const TWO_PI = Math.PI * 2

const createRandom = (seed: number) => {
  let state = seed >>> 0

  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0xffffffff
  }
}

// Clouds gather toward the axis where the spin gravity is weak: clusters of
// puffs in a radial band between roughly a third and two thirds of the
// habitat radius.
export const planClouds = (config: CloudPlanConfig): CloudPuff[] => {
  const { radius, length } = config

  if (radius <= 0 || length <= 0) {
    return []
  }

  const random = createRandom(config.seed ?? DEFAULT_SEED)
  const clusterCount = Math.min(
    40,
    Math.max(8, Math.round(length / (radius * 0.9)))
  )
  const puffs: CloudPuff[] = []

  for (let cluster = 0; cluster < clusterCount; cluster += 1) {
    const clusterAzimuth = random() * TWO_PI
    const clusterRadial = radius * (0.34 + random() * 0.26)
    const clusterAxial = (random() - 0.5) * length * 0.86
    const clusterSize = radius * 0.12 * (0.7 + random() * 0.6)
    const puffCount = 4 + Math.floor(random() * 5)

    for (let puff = 0; puff < puffCount; puff += 1) {
      const tangentOffset = (random() - 0.5) * 2 * clusterSize
      const radialOffset = (random() - 0.5) * clusterSize * 0.5
      const axialOffset = (random() - 0.5) * 2.4 * clusterSize

      puffs.push({
        azimuth: clusterAzimuth + tangentOffset / Math.max(1, clusterRadial),
        radial: clusterRadial + radialOffset,
        axial: clusterAxial + axialOffset,
        scale: clusterSize * (0.4 + random() * 0.5),
        tone: random()
      })
    }
  }

  return puffs
}

const tangent = new THREE.Vector3()
const outward = new THREE.Vector3()
const binormal = new THREE.Vector3()
const basis = new THREE.Matrix4()
const instanceMatrix = new THREE.Matrix4()
const instanceQuaternion = new THREE.Quaternion()
const instancePosition = new THREE.Vector3()
const instanceScale = new THREE.Vector3()
const instanceColor = new THREE.Color()

const CLOUD_DAY = new THREE.Color(0xf4f8fc)
const CLOUD_NIGHT = new THREE.Color(0x39434f)

// Slow drift relative to the ground, expressed as a tangential wind speed.
const WIND_SPEED = 1.2

export class Clouds {
  readonly group = new THREE.Group()

  private readonly material = new THREE.MeshStandardMaterial({
    color: 0xf4f8fc,
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    emissive: new THREE.Color(0x202833),
    emissiveIntensity: 0.5
  })

  private puffs: THREE.InstancedMesh | null = null
  private radius = 0
  private length = 0

  constructor(dimensions: { radius: number; length: number }) {
    this.setDimensions(dimensions)
  }

  setDimensions({ radius, length }: { radius: number; length: number }) {
    if (radius === this.radius && length === this.length) {
      return
    }

    this.radius = radius
    this.length = length

    if (this.puffs !== null) {
      this.puffs.geometry.dispose()
      this.group.remove(this.puffs)
      this.puffs = null
    }

    const plan = planClouds({ radius, length })

    if (plan.length === 0) {
      return
    }

    const mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 1),
      this.material,
      plan.length
    )
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    mesh.frustumCulled = false

    for (let index = 0; index < plan.length; index += 1) {
      const puff = plan[index]
      const cos = Math.cos(puff.azimuth)
      const sin = Math.sin(puff.azimuth)
      outward.set(cos, 0, sin)
      tangent.set(-sin, 0, cos)
      binormal.copy(tangent).cross(outward)
      basis.makeBasis(tangent, outward, binormal)
      instanceQuaternion.setFromRotationMatrix(basis)
      instancePosition.copy(outward).multiplyScalar(puff.radial).setY(puff.axial)
      // Flattened along the radial direction, like a cloud deck layer.
      instanceScale.set(puff.scale, puff.scale * 0.45, puff.scale * 1.25)
      instanceMatrix.compose(instancePosition, instanceQuaternion, instanceScale)
      mesh.setMatrixAt(index, instanceMatrix)
      mesh.setColorAt(index, instanceColor.setScalar(0.9 + puff.tone * 0.1))
    }

    mesh.instanceMatrix.needsUpdate = true

    if (mesh.instanceColor !== null) {
      mesh.instanceColor.needsUpdate = true
    }

    this.puffs = mesh
    this.group.add(mesh)
  }

  setDaylight(daylight: number) {
    this.material.color.lerpColors(CLOUD_NIGHT, CLOUD_DAY, daylight)
    this.material.opacity = 0.5 + daylight * 0.28
  }

  update(deltaSeconds: number) {
    if (this.radius <= 0) {
      return
    }

    this.group.rotation.y += (WIND_SPEED / this.radius) * Math.max(0, deltaSeconds)
  }

  dispose() {
    if (this.puffs !== null) {
      this.puffs.geometry.dispose()
      this.group.remove(this.puffs)
      this.puffs = null
    }

    this.material.dispose()
  }
}
