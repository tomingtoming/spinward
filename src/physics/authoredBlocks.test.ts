import { expect, test } from 'bun:test'
import raw from '../../qa/neighborhood-life/colony-source'
import plan from '../../assets/blender/izma-block-parcels.json'
import { readColonyManifest } from '../worlds/authoredColony'
import { ColonyCollisionCache } from '../worlds/colonyCollisionCache'
import { buildCityCollisionIndex, getCityGroundHeight } from '../objects/cityLayout'
import { createPlayerTraversalState, disposePlayerTraversalState, resetPlayerToGrounded, stepGroundedPlayer, syncGroundedSurfaceFromPhysics } from '../app/playerTraversal'
import { createUnitsContext, periodToOmega } from '../units/units'
import { initRapier } from './rapierContext'
import { createRotatingCityColliders } from './rotatingCityColliders'
import { applyWorldLengthUnit } from './rapierBoundary'

const m=readColonyManifest(raw),radius=3200,omega=periodToOmega(113.5),dt=1/60,cache=new ColonyCollisionCache()
const layers=[m.base,m.architecture!.fixed,m.publicRealm!.fixed,m.neighbourhoods!.fixed,m.railways!.fixed,
  m.landUse!.fixed,m.streetFrontages!.fixed,m.cornerBlocks!.fixed,m.cityBlocks!.fixed]
const index=buildCityCollisionIndex(layers.flatMap(p=>cache.colliders(p,radius)),radius,40000)

async function walk(start:number[],path:number[][],label:string,wall?:number[][]) {
  const rapier=await initRapier(),units=createUnitsContext(.02),world=new rapier.World({x:0,y:0,z:0})
  applyWorldLengthUnit(world,units);world.timestep=dt
  const city=createRotatingCityColliders(rapier,world,{radius,index,units,omega})
  const state=createPlayerTraversalState({azimuth:start[0]/radius,axialPosition:start[1]},radius,0,omega,{rapier,world,units})
  resetPlayerToGrounded(state,{azimuth:start[0]/radius,axialPosition:start[1],radius,frameAngle:0,omega,
    groundHeight:getCityGroundHeight(index,radius,start[0]/radius,start[1],start[2]+.2)})
  let target=0,threshold=false
  const direction=[path[0][0]-start[0],path[0][1]-start[1]],directionLength=Math.hypot(...direction)
  try {
    for(let frame=1;frame<18000;frame++) {
      const rawX=state.surface.azimuth*radius,x=rawX+Math.round((start[0]-rawX)/(Math.PI*6400))*Math.PI*6400
      const y=state.surface.axialPosition,dx=path[target][0]-x,dy=path[target][1]-y,distance=Math.hypot(dx,dy)
      if(frame>60&&distance<.2) {
        if(target===path.length-1){threshold=true;if(!wall)break}
        else target++
      }
      // Closed doors keep their physical wall. After reaching the threshold,
      // keep walking at it and check the actual polygon, not an infinite plane.
      const speed=frame<60?0:wall?1.2:Math.min(2,distance*2)
      city.update(state.surface.azimuth,y)
      stepGroundedPlayer(state,{radius,length:40000,omega,frameAngleEnd:frame*omega*dt,deltaSeconds:dt,
        tangentDistanceDelta:(wall?direction[0]/directionLength:dx/Math.max(distance,.001))*speed*dt,
        axisDistanceDelta:(wall?direction[1]/directionLength:dy/Math.max(distance,.001))*speed*dt,
        sampleGroundHeight:(a,y,h,tolerance)=>getCityGroundHeight(index,radius,a,y,h,tolerance)})
      world.step();syncGroundedSurfaceFromPhysics(state,frame*omega*dt)
      expect(state.mode,label).toBe('grounded')
      if(wall){
        const px=state.surface.azimuth*radius+Math.round((start[0]-state.surface.azimuth*radius)/(Math.PI*6400))*Math.PI*6400
        const py=state.surface.axialPosition
        const inside=Math.min(...wall.map((a,i)=>{const b=wall[(i+1)%wall.length];return((b[0]-a[0])*(py-a[1])-(b[1]-a[1])*(px-a[0]))/Math.hypot(b[0]-a[0],b[1]-a[1])}))
        expect(inside,label+' wall').toBeLessThan(.08)
        if(frame>=360)break
      }
    }
    expect(threshold,JSON.stringify({label,target,destination:path[target],surface:state.surface})).toBe(true)
    expect(cache.stats.bytes).toBeLessThanOrEqual(4*1024*1024)
  } finally {city.dispose();disposePlayerTraversalState(state);world.free()}
}

test('the rotating body crosses both gates of every complete block and its court',async()=>{
  for(const b of plan.blocks){
    const h=Math.min(...b.plots.map(p=>p.floor)),start=[...b.gates[0].start,h]
    await walk(start,[b.gates[0].end,b.centre,b.gates[1].end,b.gates[1].start],b.id)
  }
},120000)

test('all replacement front doors are reachable and their oblique walls contain the rotating body',async()=>{
  for(const b of plan.blocks)for(const p of b.plots){
    const a=p.entrance.start,z=p.entrance.end,span=Math.hypot(z[0]-a[0],z[1]-a[1])
    // The destination is the door face; arrival within .2 m of the walkable
    // threshold is recorded before continuing input into the closed wall.
    const dx=(z[0]-a[0])/span,dy=(z[1]-a[1])/span
    await walk(a,[[z[0]-.6*dx,z[1]-.6*dy]],p.id,p.outline)
  }
},120000)
