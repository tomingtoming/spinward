import { test, expect } from 'bun:test';
import fs from 'node:fs';
import * as THREE from 'three';
import { CITY_BLOCK, CITY_BLOCK_PLACEMENTS, cityBlockSpec, cityBlockCollision, cityBlockDistance, selectCityBlockLod } from './authoredCityBlockPlan';
import { planCity } from './cityLayout';
import { collideSphereWithBuildings } from '../sim/cityCollision';
for (const maxBuildings of [64000, 16000])
    test(`authored block keeps all certified lots in tier ${maxBuildings}`, () => {
        const p = planCity({ radius: 3200, length: 40000, maxBuildings });
        expect(p.buildings.filter(b => cityBlockSpec(b, 3200))).toHaveLength(maxBuildings===64000?112:68);
    });
for (const s of CITY_BLOCK.blocks)
    test(`${s.id}: GLB contains only four decreasing LODs within the lot`, () => {
        const b = fs.readFileSync(new URL(`../../public/assets/buildings/city-block-${s.id}.glb`, import.meta.url)), g = JSON.parse(b.toString('utf8', 20, 20 + b.readUInt32LE(12)));
        expect(g.nodes.map(n => n.name).sort()).toEqual([0, 1, 2, 3].map(i => s.id + '_lod' + i));
        let previous = Infinity;
        for (let lod = 0; lod < 4; lod++) {
            const node = g.nodes.find(n => n.name === s.id + '_lod' + lod), mesh = g.meshes[node.mesh];
            const triangles = mesh.primitives.reduce((sum, p) => sum + g.accessors[p.indices].count / 3, 0);
            expect(triangles).toBeLessThan(previous);
            previous = triangles;
            for (const p of mesh.primitives) {
                const a = g.accessors[p.attributes.POSITION];
                expect(a.min[0]).toBeGreaterThan(-s.building.width / 2);
                expect(a.max[0]).toBeLessThan(s.building.width / 2);
                expect(a.min[1]).toBeGreaterThanOrEqual(-.001);
                expect(a.max[1]).toBeLessThanOrEqual(s.building.height + .001);
                expect(a.min[2]).toBeGreaterThan(-s.building.depth / 2);
                expect(a.max[2]).toBeLessThan(s.building.depth / 2);
            }
        }
        expect(previous).toBeLessThanOrEqual(96);
    });
test('residential courtyard and office recess have no invisible full-lot collider', () => {
    for (const s of CITY_BLOCK.blocks.slice(0, 2)) {
        const colliders = cityBlockCollision(s.building as any, s, 3200), back = s.volumes[0].z + s.volumes[0].d / 2;
        for (let z = s.building.depth / 2 + 2; z > back + 1; z -= .2) {
            const a = s.building.azimuth, p = new THREE.Vector3(Math.cos(a) * 3199, s.building.axial - z, Math.sin(a) * 3199);
            expect(collideSphereWithBuildings(p, new THREE.Vector3(), colliders, { habitatRadius: 3200, sphereRadius: .3, restitution: 0 })).toBe(false);
        }
    }
});
test('block LOD observes altitude and keeps the skyline until sub-pixel size', () => {
    const s = CITY_BLOCK.blocks[1], b = s.building;
    const roof = cityBlockDistance(s, 3200, { azimuth: b.azimuth, axial: b.axial, altitude: b.height + 3 });
    const axis = cityBlockDistance(s, 3200, { azimuth: b.azimuth, axial: b.axial, altitude: 3200 });
    expect(roof).toBeLessThan(5);
    expect(axis).toBeGreaterThan(3000);
    expect(selectCityBlockLod(roof, b.height)).toBe(0);
    expect(selectCityBlockLod(axis, b.height)).toBe(3);
    expect(selectCityBlockLod(40000, b.height, 3)).toBe(4);
    expect(selectCityBlockLod(27, b.height, 0)).toBe(0);
    expect(selectCityBlockLod(31, b.height, 0)).toBe(1);
});

test('expanded lots retain metre-scale architecture, original entrances and clear neighbours',()=>{
 for(const s of CITY_BLOCK_PLACEMENTS){
  const model=CITY_BLOCK.blocks.find(m=>m.id===s.id)!;
  expect(s.building.front?.axis).toBe('axial');expect(Math.abs(s.building.front!.side)).toBe(1);
  expect(model.building.width).toBeLessThanOrEqual(s.building.width+1e-6);
  expect(model.building.height).toBeLessThanOrEqual(s.building.height+1e-6);
  for(const v of s.volumes){expect(Math.abs(v.x)+v.w/2).toBeLessThan(s.building.width/2);expect(Math.abs(v.z)+v.d/2).toBeLessThan(s.building.depth/2)}
  expect(model.building.depth/2+(s.offsetZ??0)).toBeCloseTo(s.building.depth/2,6);
 }
});

test('both street sides keep the courtyard and recessed approach open',()=>{
 for(const s of CITY_BLOCK_PLACEMENTS.filter(s=>s.id!=='commercial')){
  const b=s.building,side=b.front!.side,back=s.volumes[0].z+s.volumes[0].d/2;
  const colliders=cityBlockCollision(b,s,3200);
  for(let z=b.depth/2+1;z>back+1;z-=.5){
   const point=new THREE.Vector3(Math.cos(b.azimuth)*3199,b.axial+side*z,Math.sin(b.azimuth)*3199);
   expect(collideSphereWithBuildings(point,new THREE.Vector3(),colliders,{habitatRadius:3200,sphereRadius:.3,restitution:0})).toBe(false);
  }
  const focus={azimuth:b.azimuth,axial:b.axial+side*(b.depth/2+2),altitude:1};
  expect(cityBlockDistance(s,3200,focus)).toBeLessThan(b.depth);
  expect(cityBlockSpec({...b,front:{axis:'axial',side:side===1?-1:1}},3200)).toBeNull();
 }
});
