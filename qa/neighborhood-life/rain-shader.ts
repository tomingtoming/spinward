import * as THREE from 'three'
import { RainStreaks } from '../../src/objects/rain'
import { getCityExpressway } from '../../src/objects/cityLayout'
import { planExpresswayRainRoofs, type RainArcRoof, type RainRoof } from '../../src/objects/rainShelter'

/** Render the real rain shader into a small GPU target. Known exposed streaks
 * are positive controls, so a broken/blank shader cannot pass the dry checks. */
async function runRainShaderProbe() {
  const R=3200,road=getCityExpressway(R,40000)!,arcs=planExpresswayRainRoofs(road,R)
  const point=(a:number,y:number,h:number)=>new THREE.Vector3(Math.cos(a)*(R-h),y,Math.sin(a)*(R-h))
  const ramp=road.ramps[1],half=ramp.azimuthStart+ramp.azimuthSpan*.5
  const rampAx=road.axial+road.deckWidth/2+road.rampWidth/2,edge=road.axial-road.deckWidth/2
  const flat:RainRoof={cos:1,sin:0,axial:500,radial:R-5.2,halfWidth:20,halfDepth:6}
  const yaw=Math.atan(.25),oblique={...flat,halfWidth:25,halfDepth:5.8,yaw}
  const corner=(u:number,v:number)=>new THREE.Vector3(R-2,500+u*Math.sin(yaw)+v*Math.cos(yaw),u*Math.cos(yaw)-v*Math.sin(yaw))
  const cases:{name:string,p:THREE.Vector3,wet:boolean,roofs?:RainRoof[],arcs?:RainArcRoof[],velocity?:THREE.Vector3}[]=[
    {name:'ring-below',p:point(-.02,road.axial,2),wet:false},
    {name:'ring-outside',p:point(-.02,edge-2,2),wet:true},
    {name:'ring-above',p:point(-.02,road.axial,21),wet:true},
    {name:'ring-crossing-ceiling',p:point(-.02,road.axial,18.7),wet:false},
    {name:'ring-crossing-side',p:point(-.02,edge-.4,2),wet:false,velocity:new THREE.Vector3(0,40,0)},
    {name:'ring-other-strip',p:point(2*Math.PI/3,road.axial,2),wet:false},
    {name:'ring-wrap-minus',p:point(-Math.PI+.0001,road.axial,2),wet:false},
    {name:'ring-wrap-plus',p:point(Math.PI-.0001,road.axial,2),wet:false},
    {name:'ramp-below',p:point(half,rampAx,3),wet:false},
    {name:'ramp-above',p:point(half,rampAx,12),wet:true},
    {name:'ramp-outside',p:point(half,rampAx+road.rampWidth/2+2,3),wet:true},
    {name:'merge-below',p:point(ramp.azimuthStart+ramp.azimuthSpan+road.collectorSpan*.8,rampAx,3),wet:false},
    {name:'past-merge',p:point(ramp.azimuthStart+ramp.azimuthSpan+road.collectorSpan+.01,rampAx,3),wet:true},
    ...[-1,1].flatMap(side=>[{name:'oblique-edge-'+side,p:corner(24,side*5.6),wet:false,roofs:[oblique],arcs:[]},{name:'oblique-outside-'+side,p:corner(24,side*6.1),wet:true,roofs:[oblique],arcs:[]}]),
    {name:'bridge-below',p:point(0,500,2),wet:false,roofs:[flat],arcs:[]},
    {name:'bridge-outside',p:point(0,510,2),wet:true,roofs:[flat],arcs:[]},
    {name:'bridge-above',p:point(0,500,8),wet:true,roofs:[flat],arcs:[]}
  ]
  const renderer=new THREE.WebGLRenderer({antialias:false});renderer.setSize(128,128);renderer.setClearColor(0x000000,1)
  const target=new THREE.WebGLRenderTarget(128,128),rain=new RainStreaks(1),scene=new THREE.Scene();scene.add(rain.lines);rain.setBounds(R,40000)
  const seeds=rain.lines.geometry.getAttribute('aSeed');for(let i=0;i<seeds.count;i++)seeds.setXYZ(i,.5,.5,.5);seeds.needsUpdate=true
  const camera=new THREE.OrthographicCamera(-2,2,2,-2,.1,30),pixels=new Uint8Array(128*128*4),results=[]
  try{
    for(const c of cases){
      const a=Math.atan2(c.p.z,c.p.x),out=new THREE.Vector3(Math.cos(a),0,Math.sin(a))
      camera.position.copy(c.p).add(new THREE.Vector3(-Math.sin(a)*10,5,Math.cos(a)*10));camera.up.copy(out).negate();camera.lookAt(c.p);camera.updateMatrixWorld(true)
      const draw=(cover:boolean)=>{
        rain.update({cameraPosition:c.p,rainVelocity:c.velocity??out.clone().multiplyScalar(40),cameraVelocity:new THREE.Vector3(),deltaSeconds:0,intensity:1,roofs:cover?(c.roofs??[]):[],arcs:cover?(c.arcs??arcs):[]})
        ;(rain.lines.material as THREE.ShaderMaterial).uniforms.uOffset.value.copy(c.p)
        renderer.setRenderTarget(target);renderer.clear();renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,128,128,pixels)
        let count=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]+pixels[i+1]+pixels[i+2]>3)count++
        return count
      }
      const without=draw(false),withRoof=draw(true)
      if(without<8||(c.wet?withRoof<8:withRoof!==0))throw Error(JSON.stringify({name:c.name,wet:c.wet,without,withRoof}))
      results.push({name:c.name,wet:c.wet,without,withRoof})
    }
    return results
  }finally{rain.dispose();target.dispose();renderer.dispose();renderer.forceContextLoss()}
}
Object.assign(window,{runRainShaderProbe})
