import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import lobbyContract from '../../assets/blender/lobby-pilot.json'
import cafeContract from '../../assets/blender/cafe-pilot.json'
import { CAFE_PILOT, LOBBY_PILOT, matchesAuthoredPilot } from './cafePilot'
import { createBuildingInterior, planBuildingInteriors, interiorPartBuilding } from './buildingInteriors'
import { planCity, type CityBuilding } from './cityLayout'
import { cafePilotPoint } from './cafePilot'

function glb(path: string) {
  const data = readFileSync(new URL(`../../${path}`, import.meta.url))
  const length = data.readUInt32LE(12), json = JSON.parse(data.subarray(20, 20 + length).toString())
  return { data, length, json }
}
async function geometry(path: string) {
  const { data, length, json } = glb(path)
  const strip = (object: Record<string, unknown>) => {
    for (const key of Object.keys(object)) {
      if (key.endsWith('Texture')) delete object[key]
      else if (object[key] && typeof object[key] === 'object') strip(object[key] as Record<string, unknown>)
    }
  }
  json.materials.forEach(strip);data.fill(32, 20, 20 + length);data.write(JSON.stringify(json), 20)
  const gltf = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '')
  gltf.scene.updateMatrixWorld(true);return gltf.scene
}

test('both authored lots are in the actual city and keep their existing collision contracts', () => {
  const interiors = [...planBuildingInteriors(planCity(cafeContract.habitat).buildings, 3200).values()]
  for (const [spec, contract] of [[CAFE_PILOT, cafeContract], [LOBBY_PILOT, lobbyContract]] as const) {
    const matches = interiors.filter(i => matchesAuthoredPilot(i, 3200, spec))
    expect(matches).toHaveLength(1)
    expect(matches[0].parts).toEqual(contract.interior.parts)
    for (const key of ['azimuth', 'axial', 'width', 'depth', 'height'] as const) {
      const changed = createBuildingInterior({ ...matches[0].building, [key]: matches[0].building[key] + .01 }, spec.kind)
      expect(matchesAuthoredPilot(changed, 3200, spec)).toBe(false)
    }
    expect(matchesAuthoredPilot(matches[0], 1600, spec)).toBe(false)
  }
  const lobby = createBuildingInterior(lobbyContract.interior.building as CityBuilding, 'passage')
  expect(lobby.building.front?.axis).toBe('tangent')
  for (const part of lobby.parts) {
    const box = interiorPartBuilding(lobby, part, 3200)
    const expected = new THREE.Vector3(Math.cos(box.azimuth) * (3200-part.y), box.axial, Math.sin(box.azimuth)*(3200-part.y))
    expect(cafePilotPoint(lobby,3200,new THREE.Vector3(part.x,part.y,part.z)).distanceTo(expected)).toBeLessThan(1e-9)
  }
})

test('runtime packs share baked maps across all three levels with current source pixels', () => {
  for (const [file, prefix, ao] of [['cafe', 'cafe-lod', 'cafe-pilot-ao'], ['lobby', 'lobby', 'lobby-ao']]) {
    const { data, length, json } = glb(`public/assets/buildings/${file}-pilot-runtime.glb`)
    expect(json.images).toHaveLength(4)
    for (const name of [ao, `${prefix}-albedo`, `${prefix}-orm`, `${prefix}-emission`]) {
      const expected = readFileSync(new URL(`../../assets/blender/${name}.png`, import.meta.url))
      expect(json.images.filter((image: { bufferView: number }) => {
        const view = json.bufferViews[image.bufferView], start = 28 + length + (view.byteOffset ?? 0)
        return data.subarray(start,start+view.byteLength).equals(expected)
      })).toHaveLength(1)
    }
    expect(data.byteLength).toBeLessThan(file === 'cafe' ? 4_200_000 : 1_500_000)
    const facade = json.materials.find((m: {name:string}) => m.name.endsWith('BAKED_LIGHT'))
    expect(json.textures[facade.pbrMetallicRoughness.metallicRoughnessTexture.index].source).toBe(json.textures[facade.occlusionTexture.index].source)
  }
})

test('cafe contact mesh stays under 13k triangles and all levels keep the portal and roof', async () => {
  const scene = await geometry('public/assets/buildings/cafe-pilot-runtime.glb')
  const { frontage:w,depth:d,building:{height:h} }=cafeContract.interior
  for (const [level,budget] of [[0,13000],[1,3000],[2,400]]) {
    const model=scene.getObjectByName(`cafe_runtime_lod${level}`)!
    expect(model).toBeDefined()
    let count=0;model.traverse(o=>{if(o instanceof THREE.Mesh)count+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3})
    expect(count).toBeLessThanOrEqual(budget)
    if (level === 0) model.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      const positions=object.geometry.attributes.position,index=object.geometry.index
      const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3()
      for(let i=0;i<(index?.count??positions.count);i+=3) {
        const vertices=[a,b,c].map((point,j)=>point.fromBufferAttribute(positions,index?.getX(i+j)??i+j))
        for(let j=0;j<3;j++) {
          const p=vertices[j],q=vertices[(j+1)%3]
          // Long horizontal chords produced visible seams after cylinder wrapping.
          if(Math.min(p.y,q.y)>4.6&&Math.max(p.y,q.y)<h-.5&&Math.abs(p.y-q.y)<1e-4)
            expect(Math.hypot(p.x-q.x,p.z-q.z)).toBeLessThan(4)
        }
      }
    })
    const box=new THREE.Box3().setFromObject(model)
    expect(box.max.y).toBeCloseTo(h,3);expect(box.min.y).toBeCloseTo(0,3)
    expect(box.getSize(new THREE.Vector3()).x).toBeLessThan(w+.2)
    for(const x of [-1.5,0,1.5]) {
      const ray=new THREE.Raycaster(new THREE.Vector3(x,1.6,d/2+2),new THREE.Vector3(0,0,-1))
      expect(ray.intersectObject(model,true)[0]?.distance??Infinity).toBeGreaterThan(5)
    }
    const ray=new THREE.Raycaster(new THREE.Vector3(0,h+1,0),new THREE.Vector3(0,-1,0))
    expect(ray.intersectObject(model,true)[0]?.distance).toBeLessThan(1.3)
  }
})

test('lobby preserves two full-height exits and both road edges at every LOD', async () => {
  const scene=await geometry('public/assets/buildings/lobby-pilot-runtime.glb')
  const {frontage:w,depth:d,building:{height:h}}=lobbyContract.interior
  for(const [level,budget] of [[0,4000],[1,1500],[2,250]]) {
    const model=scene.getObjectByName(`lobby_runtime_lod${level}`)!
    expect(model).toBeDefined()
    let count=0;model.traverse(o=>{if(o instanceof THREE.Mesh)count+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3})
    expect(count).toBeLessThanOrEqual(budget)
    const box=new THREE.Box3().setFromObject(model)
    expect(box.max.y).toBeCloseTo(h,3);expect(box.min.y).toBeCloseTo(0,3)
    expect(box.max.z).toBeLessThanOrEqual(d/2+.01);expect(box.min.z).toBeGreaterThanOrEqual(-d/2-.01)
    expect(box.getSize(new THREE.Vector3()).x).toBeLessThan(w+.2)
    for(const end of [-1,1]) for(const x of [-1.5,0,1.5]) for(const height of [.3,1.6,3.0]) {
      const ray=new THREE.Raycaster(new THREE.Vector3(x,height,end*(d/2+2)),new THREE.Vector3(0,0,-end))
      expect(ray.intersectObject(model,true).filter(hit=>hit.distance<d+4)).toHaveLength(0)
    }
    const roof=new THREE.Raycaster(new THREE.Vector3(0,h+1,0),new THREE.Vector3(0,-1,0))
    expect(roof.intersectObject(model,true)[0]?.distance).toBeLessThan(1.3)
    // The facade must meet the deck at H-.22, without the former 6cm light leak.
    for(const y of [h-.27,h-.24,h-.215]) {
      const rim=new THREE.Raycaster(new THREE.Vector3(0,y,d/2+1),new THREE.Vector3(0,0,-1))
      expect(rim.intersectObject(model,true)[0]?.distance).toBeLessThan(1.05)
    }
  }
})
