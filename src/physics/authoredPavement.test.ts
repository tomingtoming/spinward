import { expect, test } from 'bun:test'
import raw from '../../qa/neighborhood-life/colony-source'
import plan from '../../assets/blender/izma-neighbourhood-parcels.json'
import { readColonyManifest } from '../worlds/authoredColony'
import { ColonyCollisionCache } from '../worlds/colonyCollisionCache'
import { buildCityCollisionIndex, getCityGroundHeight } from '../objects/cityLayout'
import { createPlayerTraversalState, disposePlayerTraversalState, resetPlayerToGrounded, stepGroundedPlayer, syncGroundedSurfaceFromPhysics } from '../app/playerTraversal'
import { createUnitsContext, periodToOmega } from '../units/units'
import { initRapier } from './rapierContext'
import { createRotatingCityColliders } from './rotatingCityColliders'
import { applyWorldLengthUnit } from './rapierBoundary'

// These are the real street-edge crossings that failed the VR walk. A rendered
// height ray alone passed even while zero-area triangles blocked the live body.
for (const district of ['a-old-town','b-housing','c-market']) {
  test(`authored pavement at ${district} lets the rotating body cross the road edge`, async () => {
    const manifest = readColonyManifest(raw), radius = 3200, omega = periodToOmega(113.5), dt = 1/60
    const street = plan.streets.find(s=>s.district===district)!, row = Math.floor(street.profile.length/3)
    const point = (i:number) => {
      const p=street.profile[i],a=street.profile[i-1],b=street.profile[i+1]
      const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),offset=street.width/2+.65
      return [p[0]-dy/length*offset,p[1]+dx/length*offset,p[2]+.045]
    }
    const start=point(row),target=point(row+1),cache=new ColonyCollisionCache()
    const packed=[manifest.base,manifest.architecture!.fixed,manifest.publicRealm!.fixed,
      manifest.neighbourhoods!.fixed,manifest.railways!.fixed,manifest.landUse!.fixed,manifest.streetFrontages!.fixed,
      ...(manifest.cornerBlocks ? [manifest.cornerBlocks.fixed] : [])]
    const index=buildCityCollisionIndex(packed.flatMap(p=>cache.colliders(p,radius)),radius,40000)
    const rapier=await initRapier(),units=createUnitsContext(.02),world=new rapier.World({x:0,y:0,z:0})
    applyWorldLengthUnit(world,units);world.timestep=dt
    const city=createRotatingCityColliders(rapier,world,{radius,index,units,omega})
    const state=createPlayerTraversalState({azimuth:start[0]/radius,axialPosition:start[1]},radius,0,omega,{rapier,world,units})
    resetPlayerToGrounded(state,{azimuth:start[0]/radius,axialPosition:start[1],radius,frameAngle:0,omega,groundHeight:start[2]})
    let arrived=false
    try {
      for(let frame=1;frame<=900;frame++) {
        const rawX=state.surface.azimuth*radius,x=rawX+Math.round((start[0]-rawX)/(Math.PI*6400))*Math.PI*6400
        const y=state.surface.axialPosition,dx=target[0]-x,dy=target[1]-y,distance=Math.hypot(dx,dy)
        if(frame>60&&distance<.2){arrived=true;break}
        const speed=frame<60?0:Math.min(1.4,distance*2)
        city.update(state.surface.azimuth,y)
        stepGroundedPlayer(state,{radius,length:40000,omega,frameAngleEnd:frame*omega*dt,deltaSeconds:dt,
          tangentDistanceDelta:dx/Math.max(distance,.001)*speed*dt,axisDistanceDelta:dy/Math.max(distance,.001)*speed*dt,
          sampleGroundHeight:(a,y,h)=>getCityGroundHeight(index,radius,a,y,h)})
        world.step();syncGroundedSurfaceFromPhysics(state,frame*omega*dt)
        expect(state.mode).toBe('grounded')
      }
      expect(arrived,'the live body reaches the target under continuous walking input').toBe(true)
      expect(cache.stats.bytes).toBeLessThanOrEqual(4*1024*1024)
    } finally {city.dispose();disposePlayerTraversalState(state);world.free()}
  })
}
