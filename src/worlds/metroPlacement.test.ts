import { expect, test } from 'bun:test'
import { Vector3 } from 'three'
import { getSpaceportDimensions } from '../objects/spaceport'
import { metroArrivalOrientation, metroPlacementMatrix, metroSurfaceLocation } from './metroPlacement'

test('accepted inland B keeps the palace and Shibuya at the port end, Saitama farther inside', () => {
  // EPSG:6677 source pin positions from accepted B (2026-09-24).
  const palace=metroSurfaceLocation(0,336.9118245297386,17347.853154159304,3200)
  const shibuya=metroSurfaceLocation(2,-1174.412526209419,19300,3200)
  const omiya=metroSurfaceLocation(2,855.7428443688921,-8871.555184184786,3200)
  const port=getSpaceportDimensions(3200,40000).hubCenterY
  expect(palace.axial-port).toBeCloseTo(2652.146845840696,5)
  expect(shibuya.axial-port).toBeCloseTo(700,5)
  expect(omiya.axial-port).toBeGreaterThan(28000)
  expect(palace.axial).toBeLessThan(-17000)
})

test('source Tokyo lies at the spaceport side while Tachikawa stays at the opposite end', () => {
  // Saved geographic pins from tokyo-metro-plan.json (2026-09-23).
  const pins = { tachikawa: [0, -20000], kudanshita: [-1617.78563762487, 10486.280254740854], shimbashi: [1617.7856376248726, 11310.619309114894] }
  const port = getSpaceportDimensions(3200, 40000).hubCenterY
  expect(port).toBe(-20000)
  for (const [name, [x, y]] of Object.entries(pins)) {
    const { axial } = metroSurfaceLocation(0, x, y, 3200)
    if (name === 'tachikawa') expect(axial).toBe(20000)
    else {
      expect(axial).toBeLessThan(-10000)
      expect(Math.abs(axial - port)).toBeLessThan(Math.abs(axial + port))
    }
  }
})

test('the whole placement is a rigid rotation and keeps every band above its own floor', () => {
  const matrix = metroPlacementMatrix()
  expect(matrix.determinant()).toBeCloseTo(1, 12)
  for (const band of [0, 1, 2]) for (const x of [-1500, 317, 1600]) for (const y of [-19990, 8632, 19990]) {
    const h = 27, angle = band * Math.PI * 2 / 3 + x / 3200
    // Actual study vertex convention, independent of the collision transform.
    const drawn = new Vector3((3200-h)*Math.sin(angle), -(3200-h)*Math.cos(angle), -y).applyMatrix4(matrix)
    const placed = metroSurfaceLocation(band, x, y, 3200)
    const support = new Vector3((3200-h)*Math.cos(placed.azimuth), placed.axial, (3200-h)*Math.sin(placed.azimuth))
    expect(drawn.distanceTo(support)).toBeLessThan(1e-8)
    for (const yaw of [0, -.91, Math.PI/2]) {
      const studyForward = new Vector3(-Math.sin(yaw)*Math.cos(angle), -Math.sin(yaw)*Math.sin(angle), -Math.cos(yaw)).transformDirection(matrix)
      const cameraForward = new Vector3(0, 0, -1).applyQuaternion(metroArrivalOrientation(placed.azimuth, yaw))
      expect(cameraForward.distanceTo(studyForward)).toBeLessThan(1e-8)
    }
  }
})
