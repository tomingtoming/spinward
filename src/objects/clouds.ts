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

// Cloud altitude above the ground, like real weather: small habitats get a
// proportional deck, large ones clamp to a realistic cloud layer so the
// clouds stay near the player's sky instead of kilometers away at mid-radius.
export const getCloudAltitudeCenter = (radius: number) =>
  Math.min(radius * 0.5, 1500)

export const getCloudAltitudeSpread = (radius: number) =>
  Math.min(radius * 0.13, 400)

export const getCloudClusterSize = (radius: number) =>
  Math.min(radius * 0.12, 500)

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
  const altitudeCenter = getCloudAltitudeCenter(radius)
  const altitudeSpread = getCloudAltitudeSpread(radius)
  const baseClusterSize = getCloudClusterSize(radius)
  const puffs: CloudPuff[] = []

  for (let cluster = 0; cluster < clusterCount; cluster += 1) {
    const clusterAzimuth = random() * TWO_PI
    const clusterRadial =
      radius - (altitudeCenter + (random() - 0.5) * 2 * altitudeSpread)
    const clusterAxial = (random() - 0.5) * length * 0.86
    const clusterSize = baseClusterSize * (0.7 + random() * 0.6)
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
const CLOUD_NIGHT = new THREE.Color(0x46505c)

// Slow drift relative to the ground, expressed as a tangential wind speed.
const WIND_SPEED = 1.2

export class Clouds {
  readonly group = new THREE.Group()

  // Near-opaque with depth writes: translucent clouds let the bright far
  // city bleed through, which reads as the clouds being behind the town.
  private readonly material = new THREE.MeshStandardMaterial({
    color: 0xf4f8fc,
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity: 0.96,
    depthWrite: true,
    emissive: new THREE.Color(0x232c38),
    emissiveIntensity: 0.55
  })

  private puffs: THREE.InstancedMesh | null = null
  private radius = 0
  private length = 0
  private opacityBase = 0.96
  private daylight = 1

  constructor(dimensions: { radius: number; length: number }) {
    this.setDimensions(dimensions)
  }

  setDimensions({ radius, length }: { radius: number; length: number }) {
    if (radius === this.radius && length === this.length) {
      return
    }

    this.radius = radius
    this.length = length
    // Small habitats put the cloud deck right overhead: keep those wispy.
    // Large habitats need near-opaque clouds, or the bright far-side city
    // bleeds through and the layering reads inverted.
    this.opacityBase = THREE.MathUtils.lerp(
      0.72,
      0.96,
      THREE.MathUtils.clamp((radius - 100) / 900, 0, 1)
    )
    this.applyDaylight()

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
    this.daylight = daylight
    this.applyDaylight()
  }

  private applyDaylight() {
    this.material.color.lerpColors(CLOUD_NIGHT, CLOUD_DAY, this.daylight)
    this.material.opacity = this.opacityBase * (0.88 + this.daylight * 0.12)
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
