import { Matrix4, Quaternion, Vector3 } from 'three'

/** Orient positive source Y (the downtown end) toward the -Y spaceport.
 * This is a rigid half-turn, not a reflected street network.
 * Source coordinates/band IDs remain unchanged for tiles and geographic data. */
export const metroPlacementMatrix = () => new Matrix4().set(
  0, -1, 0, 0,
  0, 0, 1, 0,
  -1, 0, 0, 0,
  0, 0, 0, 1
)

export const metroSurfaceLocation = (band: number, x: number, y: number, radius: number) => ({
  azimuth: -(band * Math.PI * 2 / 3 + x / radius),
  axial: -y
})

export function metroArrivalOrientation(azimuth: number, sourceYaw: number) {
  const up = new Vector3(-Math.cos(azimuth), 0, -Math.sin(azimuth))
  const tangent = new Vector3(-Math.sin(azimuth), 0, Math.cos(azimuth))
  const forward = tangent.multiplyScalar(Math.sin(sourceYaw)).add(new Vector3(0, -Math.cos(sourceYaw), 0))
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(forward.clone().cross(up), up, forward.negate()))
}
