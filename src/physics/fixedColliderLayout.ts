import * as THREE from 'three'

export type FixedColliderSectorGrid = {
  azimuthCount: number
  azimuthStepRadians: number
  axialCount: number
  axialStepMeters: number
  halfLength: number
}

export type FixedColliderSectorCoord = {
  azimuthIndex: number
  axialIndex: number
}

export type FixedColliderSpec = {
  id: string
  center: THREE.Vector3
  halfExtents: THREE.Vector3
  rotation: THREE.Quaternion
}

type SectorGridOptions = {
  radius: number
  length: number
  targetArcLength?: number
  axialStepMeters?: number
}

type ActiveSectorOptions = {
  azimuthPadding?: number
  axialPadding?: number
}

const normalizeAngle = (angle: number) =>
  THREE.MathUtils.euclideanModulo(angle, Math.PI * 2)

const AIRLOCK_DEPTH = 0.24
const airlockQuaternion = new THREE.Quaternion().setFromUnitVectors(
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(-1, 0, 0)
)

export const createFixedColliderSectorGrid = ({
  radius,
  length,
  targetArcLength = 120,
  axialStepMeters = 160
}: SectorGridOptions): FixedColliderSectorGrid => {
  const azimuthCount = Math.max(
    12,
    Math.ceil((Math.PI * 2 * Math.max(radius, 1)) / targetArcLength)
  )
  const axialCount = Math.max(1, Math.ceil(Math.max(length, 1) / axialStepMeters))

  return {
    azimuthCount,
    azimuthStepRadians: (Math.PI * 2) / azimuthCount,
    axialCount,
    axialStepMeters: length / axialCount,
    halfLength: length * 0.5
  }
}

export const getFixedColliderSectorCoord = (
  position: THREE.Vector3,
  grid: FixedColliderSectorGrid
): FixedColliderSectorCoord => {
  const azimuth = normalizeAngle(Math.atan2(position.z, position.x))
  const azimuthIndex = Math.min(
    grid.azimuthCount - 1,
    Math.floor(azimuth / grid.azimuthStepRadians)
  )
  const axialRatio = THREE.MathUtils.clamp(
    (position.y + grid.halfLength) / Math.max(grid.halfLength * 2, 1e-6),
    0,
    0.999999
  )
  const axialIndex = Math.min(
    grid.axialCount - 1,
    Math.floor(axialRatio * grid.axialCount)
  )

  return { azimuthIndex, axialIndex }
}

export const getFixedColliderSectorKey = (coord: FixedColliderSectorCoord) =>
  `${coord.azimuthIndex}:${coord.axialIndex}`

export const getActiveFixedColliderSectorKeys = (
  positions: readonly THREE.Vector3[],
  grid: FixedColliderSectorGrid,
  options: ActiveSectorOptions = {}
) => {
  const azimuthPadding = Math.max(0, options.azimuthPadding ?? 1)
  const axialPadding = Math.max(0, options.axialPadding ?? 1)
  const activeKeys = new Set<string>()

  for (const position of positions) {
    const center = getFixedColliderSectorCoord(position, grid)

    for (let azimuthOffset = -azimuthPadding; azimuthOffset <= azimuthPadding; azimuthOffset += 1) {
      const wrappedAzimuth =
        (center.azimuthIndex + azimuthOffset + grid.azimuthCount) % grid.azimuthCount

      for (let axialOffset = -axialPadding; axialOffset <= axialPadding; axialOffset += 1) {
        const axialIndex = center.axialIndex + axialOffset

        if (axialIndex < 0 || axialIndex >= grid.axialCount) {
          continue
        }

        activeKeys.add(getFixedColliderSectorKey({
          azimuthIndex: wrappedAzimuth,
          axialIndex
        }))
      }
    }
  }

  return activeKeys
}

export const buildCylinderFixedColliderSpecs = (
  radius: number,
  length: number
): FixedColliderSpec[] => {
  const airlockY = -length * 0.32
  const radialInset = AIRLOCK_DEPTH * 0.5

  return [
    {
      id: 'airlock-door',
      center: new THREE.Vector3(radius - radialInset, airlockY, 0),
      halfExtents: new THREE.Vector3(AIRLOCK_DEPTH * 0.5, 3.75, 3.75),
      rotation: airlockQuaternion.clone()
    },
    {
      id: 'airlock-frame-top',
      center: new THREE.Vector3(radius - radialInset, airlockY + 4, 0),
      halfExtents: new THREE.Vector3(AIRLOCK_DEPTH * 0.5, 0.13, 4.2),
      rotation: airlockQuaternion.clone()
    },
    {
      id: 'airlock-frame-bottom',
      center: new THREE.Vector3(radius - radialInset, airlockY - 4, 0),
      halfExtents: new THREE.Vector3(AIRLOCK_DEPTH * 0.5, 0.13, 4.2),
      rotation: airlockQuaternion.clone()
    },
    {
      id: 'airlock-frame-left',
      center: new THREE.Vector3(radius - radialInset, airlockY, 4),
      halfExtents: new THREE.Vector3(AIRLOCK_DEPTH * 0.5, 4.2, 0.13),
      rotation: airlockQuaternion.clone()
    },
    {
      id: 'airlock-frame-right',
      center: new THREE.Vector3(radius - radialInset, airlockY, -4),
      halfExtents: new THREE.Vector3(AIRLOCK_DEPTH * 0.5, 4.2, 0.13),
      rotation: airlockQuaternion.clone()
    }
  ]
}
