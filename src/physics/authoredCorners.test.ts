import { expect, test } from 'bun:test'
import raw from '../../qa/neighborhood-life/colony-source'
import corners from '../../assets/blender/izma-corner-blocks.json'
import { readColonyManifest } from '../worlds/authoredColony'
import { ColonyCollisionCache } from '../worlds/colonyCollisionCache'
import { buildCityCollisionIndex, getCityGroundHeight } from '../objects/cityLayout'
import { createPlayerTraversalState, disposePlayerTraversalState, resetPlayerToGrounded, stepGroundedPlayer, syncGroundedSurfaceFromPhysics } from '../app/playerTraversal'
import { createUnitsContext, periodToOmega } from '../units/units'
import { initRapier } from './rapierContext'
import { createRotatingCityColliders } from './rotatingCityColliders'
import { applyWorldLengthUnit } from './rapierBoundary'

test('all native corner approaches reach the door and their polygon walls stop the live rotating body', async () => {
  const m=readColonyManifest(raw),radius=3200,omega=periodToOmega(113.5),dt=1/60,cache=new ColonyCollisionCache()
  const layers=[m.base,m.architecture!.fixed,m.publicRealm!.fixed,m.neighbourhoods!.fixed,m.railways!.fixed,
    m.landUse!.fixed,m.streetFrontages!.fixed,m.cornerBlocks!.fixed]
  const index=buildCityCollisionIndex(layers.flatMap(p=>cache.colliders(p,radius)),radius,40000)
  const rapier=await initRapier(),units=createUnitsContext(.02)
  for(const p of corners.parcels) {
    const start=p.entrance.start,end=p.entrance.end,length=Math.hypot(end[0]-start[0],end[1]-start[1])
    const dx=(end[0]-start[0])/length,dy=(end[1]-start[1])/length
    const target=[end[0]-dx*.6,end[1]-dy*.6]
    const world=new rapier.World({x:0,y:0,z:0});applyWorldLengthUnit(world,units);world.timestep=dt
    const city=createRotatingCityColliders(rapier,world,{radius,index,units,omega})
    const state=createPlayerTraversalState({azimuth:start[0]/radius,axialPosition:start[1]},radius,0,omega,{rapier,world,units})
    resetPlayerToGrounded(state,{azimuth:start[0]/radius,axialPosition:start[1],radius,frameAngle:0,omega,groundHeight:start[2]})
    let reached=false
    try {
      for(let frame=1;frame<=600;frame++) {
        city.update(state.surface.azimuth,state.surface.axialPosition)
        stepGroundedPlayer(state,{radius,length:40000,omega,frameAngleEnd:frame*omega*dt,deltaSeconds:dt,
          tangentDistanceDelta:frame<60?0:dx*1.2*dt,axisDistanceDelta:frame<60?0:dy*1.2*dt,
          sampleGroundHeight:(a,y,h)=>getCityGroundHeight(index,radius,a,y,h)})
        world.step();syncGroundedSurfaceFromPhysics(state,frame*omega*dt)
        const rawX=state.surface.azimuth*radius,x=rawX+Math.round((start[0]-rawX)/(Math.PI*6400))*Math.PI*6400
        const y=state.surface.axialPosition
        if(Math.hypot(x-target[0],y-target[1])<.24)reached=true
        // The body can slide past the end of one frontage; the extension of
        // that wall's infinite plane is not the actual building boundary.
        const inside=Math.min(...p.outline.map((a,i)=>{
          const b=p.outline[(i+1)%p.outline.length],span=Math.hypot(b[0]-a[0],b[1]-a[1])
          return ((b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]))/span
        }))
        expect(inside,p.id+' body remains outside polygon').toBeLessThan(.08)
        expect(state.mode,p.id).toBe('grounded')
      }
      expect(reached,p.id+' reaches threshold').toBe(true)
      expect(cache.stats.bytes).toBeLessThanOrEqual(4*1024*1024)
    } finally {city.dispose();disposePlayerTraversalState(state);world.free()}
  }
},30000)
