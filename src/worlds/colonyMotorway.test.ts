import { expect, test } from 'bun:test'
import { Group, Raycaster, Vector3 } from 'three'
import { AuthoredColony, colonyColliders, readColonyManifest, type ColonyManifest } from './authoredColony'
import { buildCityCollisionIndex, getCityGroundHeight } from '../objects/cityLayout'

const empty = () => ({ vertices: [], meshes: {}, surfaces: [] })
const fixture = (): ColonyManifest => ({ version: 1, radius: 3200, span: 40000,
  palette: { road: '#777777' }, base: empty(), tiles: [], visits: {} })

test('native motorway patches draw and support the same floor on all bands, then release on a world change', () => {
  for (let band = 0; band < 3; band++) {
    const x = band * Math.PI * 6400 / 3, manifest = fixture()
    manifest.motorway = { version: 1,
      fixed: { vertices: [x-2,-2,12,x+2,-2,12,x+2,2,12], meshes: { road: [0,1,2] },
        surfaces: [{ indices: [0,1,2], bounds: [x-2,-2,x+2,2], groundSurface: true }] },
      counts: { interchanges: 1, ramps: 4, fixedTriangles: 1, collisionTriangles: 1, surfaceGroups: 1, relocatedSupports: 0 } }
    manifest.visits.ic = { band, position: [.5,0], heightHint: 12 }
    const colony = new AuthoredColony(new Group(), async () => { throw Error('Detail unavailable') })
    colony.rebuild(readColonyManifest(manifest)); colony.group.updateMatrixWorld(true)
    const angle = (x+.5)/3200, outward = new Vector3(Math.cos(angle),0,Math.sin(angle))
    const hits = new Raycaster(outward.clone().multiplyScalar(2800),outward,0,600).intersectObject(colony.group,true)
    expect(hits.length).toBeGreaterThan(0)
    const height = 3200-Math.hypot(hits[0].point.x,hits[0].point.z)
    for (const bodies of [colony.getColliders(),colonyColliders(manifest)]) {
      const index = buildCityCollisionIndex(bodies,3200,40000)
      expect(Math.abs(getCityGroundHeight(index,3200,angle,0,height+.01,0)-height)).toBeLessThan(.001)
      expect(colony.visit('ic',index)?.groundHeight).toBeCloseTo(height,2)
    }
    colony.rebuild(fixture())
    expect(colony.group.getObjectByName('colony-motorway-ground')).toBeUndefined()
    expect(colony.getColliders()).toHaveLength(0)
    colony.dispose()
  }
})
