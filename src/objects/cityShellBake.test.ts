import { expect, test } from 'bun:test'
import * as THREE from 'three'

import {
  CITY_SHELL_MIN_RADIUS,
  axialToShellYFraction,
  azimuthToShellU,
  createCityShellTextureSet,
  shellBuildingEmission,
  SHELL_VEIN_COLOR
} from './cityShellBake'
import type { CityBuilding, CityPlan } from './cityLayout'
import {colonyBuildingDesign} from './colonyBuildingDesign'
import {CITY_BLOCK_PLACEMENTS} from './authoredCityBlockPlan'
import { splitCylinderShellArcs } from './cylinder'

const TWO_PI = Math.PI * 2

test('azimuthToShellU maps plan azimuths into cylinder-geometry angular space', () => {
  // θ = π/2 − azimuth (x = R·sinθ vs x = R·cos a), normalized to one turn.
  expect(azimuthToShellU(Math.PI * 0.5)).toBeCloseTo(0, 10)
  expect(azimuthToShellU(0)).toBeCloseTo(0.25, 10)
  expect(azimuthToShellU(-Math.PI * 0.5)).toBeCloseTo(0.5, 10)
  expect(azimuthToShellU(Math.PI)).toBeCloseTo(0.75, 10)

  for (const azimuth of [-7.3, -1, 0, 0.4, 2, 9.9]) {
    const u = azimuthToShellU(azimuth)
    expect(u).toBeGreaterThanOrEqual(0)
    expect(u).toBeLessThan(1)
  }
})

test('azimuthToShellU agrees with the shell geometry theta convention', () => {
  // splitCylinderShellArcs centres its near arc on the focus azimuth using
  // the same θ = π/2 − azimuth convention the shell UVs are baked in; the
  // bake must land city texels at exactly that U or the far city would sit
  // on the wrong arc.
  for (const azimuth of [0, 0.7, 2.1, 4.4, 6.1]) {
    const arc = splitCylinderShellArcs(azimuth)
    const centerTheta = THREE.MathUtils.euclideanModulo(
      arc.near.thetaStart + arc.near.arcRadians * 0.5,
      TWO_PI
    )
    expect(centerTheta / TWO_PI).toBeCloseTo(azimuthToShellU(azimuth), 10)
  }
})

test('axialToShellYFraction puts the port end at the canvas bottom', () => {
  const length = 40000
  // V=0 (y=−L/2, the port end) samples the flipped canvas bottom row.
  expect(axialToShellYFraction(-length / 2, length)).toBeCloseTo(1, 10)
  expect(axialToShellYFraction(length / 2, length)).toBeCloseTo(0, 10)
  expect(axialToShellYFraction(0, length)).toBeCloseTo(0.5, 10)
})

test('createCityShellTextureSet skips habitats below the far-field threshold', () => {
  const plan: CityPlan = {
    roads: [],
    buildings: [
      {
        azimuth: 0,
        axial: 0,
        width: 10,
        depth: 10,
        height: 12,
        tone: 0.5,
        kind: 'block'
      }
    ],
    patches: [],
    trees: [],
    tower: null,
    expressway: null
  }

  expect(createCityShellTextureSet(plan, CITY_SHELL_MIN_RADIUS - 1, 2000)).toBeNull()
})

test('createCityShellTextureSet skips empty plans', () => {
  const plan: CityPlan = {
    roads: [],
    buildings: [],
    patches: [],
    trees: [],
    tower: null,
    expressway: null
  }

  expect(createCityShellTextureSet(plan, 3200, 40000)).toBeNull()
})

const lightFixture:CityBuilding={azimuth:.2,axial:500,width:24,depth:20,height:40,tone:.5,kind:'tower',urban:.8,front:{axis:'axial',side:1},streetKind:'arterial'}
test('unresolved windows retain use, glazing and occupancy instead of a uniform warm footprint',()=>{
 const colours=new Map<string,THREE.Color>(),alphas=new Set<number>()
 for(let i=0;i<400;i++){
  const b={...lightFixture,axial:i*17},design=colonyBuildingDesign(b),light=shellBuildingEmission(b,design,null)
  expect(light.alpha).toBeGreaterThan(0);expect(light.alpha).toBeLessThanOrEqual(.3)
  expect(shellBuildingEmission({...b},colonyBuildingDesign({...b}),null)).toEqual(light)
  colours.set(design.use.primary,light.color);alphas.add(light.alpha)
 }
 expect(alphas.size).toBeGreaterThan(100)
 const office=colours.get('office')!,home=colours.get('apartments')!
 expect(office.b).toBeGreaterThan(office.r);expect(home.r).toBeGreaterThan(home.b)
 const d=colonyBuildingDesign(lightFixture,'apartment'),base=shellBuildingEmission(lightFixture,d,null).alpha
 expect(shellBuildingEmission(lightFixture,{...d,windows:{...d.windows,occupied:d.windows.occupied/2}},null).alpha).toBeCloseTo(base/2)
 expect(shellBuildingEmission(lightFixture,{...d,profile:{...d.profile,paneHeight:d.profile.paneHeight/2}},null).alpha).toBeCloseTo(base/2)
})

test('the same building dims in a district hollow and retains the secondary core',()=>{
 const b={...lightFixture,urban:0},d=colonyBuildingDesign(b,'apartment')
 const plain=shellBuildingEmission(b,d,{tangent:.9,axial:0}).alpha
 expect(shellBuildingEmission(b,d,{tangent:-.35,axial:-.55}).alpha).toBeGreaterThan(plain*2)
 expect(shellBuildingEmission(b,d,{tangent:.05,axial:-.12}).alpha).toBeLessThan(plain*.3)
})

test('the actual shell bake varies generated lights while preserving pilot lights and road exposure',()=>{
 type Draw={color:string;alpha:number;rect:number[]}
 const passes:Draw[][]=[],previous=globalThis.document
 globalThis.document={createElement:()=>{
  const draws:Draw[]=[];passes.push(draws)
  const context={fillStyle:'',globalAlpha:1,clearRect:()=>{},fillRect:(...rect:number[])=>draws.push({color:context.fillStyle,alpha:context.globalAlpha,rect})}
  return {width:0,height:0,getContext:()=>context}
 }} as unknown as Document
 try{
  const pilot=CITY_BLOCK_PLACEMENTS[0].building
  const plan:CityPlan={roads:[{azimuth:1,axial:5000,tangentWidth:20,axialLength:200,kind:'arterial'}],buildings:[pilot,...Array.from({length:40},(_,i)=>({...lightFixture,azimuth:1,axial:1000+i*90}))],patches:[],trees:[],tower:null,expressway:null}
  const textures=createCityShellTextureSet(plan,3200,40000,1024)!
  const emissive=passes[0],road=emissive.filter(d=>d.color==='#'+SHELL_VEIN_COLOR.getHexString())
  expect(road.length).toBe(6)
  expect(road[0].alpha).toBeCloseTo(.044);expect(road[3].alpha).toBeCloseTo(.19)
  const windows=emissive.filter(d=>d.color!=='#000000'&&!road.includes(d))
  expect(windows.some(d=>d.color==='#ffd89b'&&d.alpha===.12)).toBe(true)
  expect(new Set(windows.map(d=>d.color)).size).toBeGreaterThan(4)
  expect(new Set(windows.map(d=>d.alpha)).size).toBeGreaterThan(30)
  expect(windows.every(d=>d.alpha>0&&d.alpha<=.3)).toBe(true)
  textures.albedo.dispose();textures.emissive.dispose()
 }finally{
  if(previous===undefined)delete (globalThis as {document?:Document}).document
  else globalThis.document=previous
 }
})
