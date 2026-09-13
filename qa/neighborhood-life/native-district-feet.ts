import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { planCity } from '../../src/objects/cityLayout'
import { rebuildNativeDistricts } from '../../src/objects/nativeDistricts'
import { StreetSurfacePlan } from '../../src/objects/streetSurfacePlan'
import { buildStreetSurfaceGeometry } from '../../src/objects/streetSurfaceGeometry'
import { placeResident, poseResident } from '../../src/objects/residentModel'
import { fitResidentFeet } from '../../src/objects/residentFootContact'

// Resolve the independent review's uncertainty about the far-side pedestrian.
// Use captured actor positions, actual shoes and the rendered pavement builder.
const capture=JSON.parse(readFileSync(new URL('./native-districts-quest-final.json',import.meta.url),'utf8'))
const view=capture.views.find((v:any)=>v.name==='spine'),actors=view.walkers.actors
const radius=3200,city=planCity({radius,length:40000,maxBuildings:18000})
rebuildNativeDistricts(city,radius)
const network=city.streetNetwork!,near=new Set<number>()
for(const a of actors)for(const s of network.query(a.azimuth,a.axial,250,250))near.add(s.street)
const surfaces=new StreetSurfacePlan([...near].map(i=>network.streets[i]),radius).sidewalks()
const geometry=buildStreetSurfaceGeometry(surfaces,radius,3)!,material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),mesh=new THREE.Mesh(geometry,material)
mesh.updateMatrixWorld()
const glb=readFileSync(new URL('../../public/assets/people/resident.glb',import.meta.url))
const root=(await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength),'')).scene.getObjectByName('resident')!
const p=new THREE.Vector3(),inward=new THREE.Vector3(),ray=new THREE.Raycaster(),report=[]
for(const a of actors){
 let samples=0,unsupported=0,min=Infinity,maxSupport=-Infinity
 for(let phase=0;phase<32;phase++){
  placeResident(root,a.azimuth,a.axial,radius,a.heading,a.height+.02)
  root.scale.set(a.scale*(a.variant%2?1.04:.98),a.scale,a.scale)
  poseResident(root,phase/32*2*Math.PI/7.5,true,false);fitResidentFeet(root);root.updateMatrixWorld(true)
  let support=Infinity
  for(const side of ['left','right']){
   const shoe=root.getObjectByName(`${side}_shoe`) as THREE.Mesh,vertices=shoe.geometry.getAttribute('position')
   for(let i=0;i<vertices.count;i++){
    p.fromBufferAttribute(vertices,i).applyMatrix4(shoe.matrixWorld)
    inward.set(-p.x,0,-p.z).normalize()
    ray.set(p.clone().addScaledVector(inward,1),inward.clone().negate());ray.far=2
    const hit=ray.intersectObject(mesh)[0];samples++
    if(!hit){unsupported++;continue}
    const gap=hit.distance-1;support=Math.min(support,gap);min=Math.min(min,gap)
   }
  }
  maxSupport=Math.max(maxSupport,support)
 }
 if(unsupported||min<-.012||maxSupport>.05)throw Error(JSON.stringify({id:a.id,samples,unsupported,min,maxSupport}))
 report.push({id:a.id,phases:32,shoeVerticesTested:samples,unsupported,minShoeGap:min,maxLowestShoeGap:maxSupport})
}
console.log(JSON.stringify(report,null,2));geometry.dispose();material.dispose()
