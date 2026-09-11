import {colonyBuildingDesign} from './colonyBuildingDesign'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
export type ColonyModuleName='structure'|'window_frame'|'canopy'|'door'
export type ColonyModules=Record<ColonyModuleName,THREE.BufferGeometry>
let pending:Promise<ColonyModules>|undefined
// Shared immutable source geometry: rebuilds and interior layers never duplicate it.
export function loadColonyModules(){
  return pending??=new GLTFLoader().loadAsync('/assets/buildings/colony-modules.glb').then(g=>{
    const result={} as ColonyModules
    for(const name of ['structure','window_frame','canopy','door'] as const){
      const node=g.scene.getObjectByName(name)
      if(!(node instanceof THREE.Mesh))throw Error('Missing colony module '+name)
      node.updateWorldMatrix(true,false)
      result[name]=node.geometry.clone().applyMatrix4(node.matrixWorld)
    }
    g.scene.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose()}})
    return result
  })
}
export function colonyFacadeMaterial(entrance=false,perBuilding=false){
  const m=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.82})
  m.onBeforeCompile=shader=>{
    shader.vertexShader=(perBuilding?'attribute vec4 aColonyFacade; attribute vec4 aColonyStyle;\n':'')+'varying vec2 colonyPane; varying vec3 colonyStyle;\nvarying vec3 colonyPoint; varying vec3 colonyNormal; varying vec3 colonySize; varying vec2 colonyGrid;\n'+shader.vertexShader
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      colonyPoint=position+vec3(.5); colonyNormal=normal;
      ${perBuilding?'vec4 facade=aColonyFacade; colonyStyle=aColonyStyle.xyz;':'vec4 facade=vec4(2.8,3.2,.64,.6); colonyStyle=vec3(.2,0.,.76);'}
      colonySize=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
      colonyPane=facade.zw;
      float facadeWidth=abs(normal.x)>.5?colonySize.z:colonySize.x;
      colonyGrid=max(vec2(1.),floor(vec2(facadeWidth,colonySize.y)/facade.xy+.5));`)
    shader.fragmentShader='varying vec2 colonyPane; varying vec3 colonyStyle;\nvarying vec3 colonyPoint; varying vec3 colonyNormal; varying vec3 colonySize; varying vec2 colonyGrid;\n'+shader.fragmentShader
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec3 colonyBase=diffuseColor.rgb;
      bool wall=abs(colonyNormal.y)<.5;
      float width=abs(colonyNormal.x)>.5?colonySize.z:colonySize.x;
      float across=abs(colonyNormal.x)>.5?colonyPoint.z:colonyPoint.x;
      vec2 grid=colonyGrid;
      vec2 cell=vec2(across,colonyPoint.y)*grid;
      vec2 pane=fract(cell);
      bool glass=wall&&width>1.5&&colonySize.y>2.&&pane.x>(1.-colonyPane.x)*.5&&pane.x<(1.+colonyPane.x)*.5&&pane.y>colonyStyle.x&&pane.y<colonyStyle.x+colonyPane.y;
      ${entrance?`if(colonyNormal.z>.5&&abs(((floor(cell.x)+.5)/grid.x-.5)*colonySize.x)<min(2.2,colonySize.x*.6)/2.+width/grid.x*colonyPane.x*.5&&(floor(cell.y)+colonyStyle.x+colonyPane.y*.5)/grid.y*colonySize.y<min(2.5,colonySize.y*.8)+colonySize.y/grid.y*colonyPane.y*.5)glass=false;`:''}
      float lit=step(.78,fract(sin(dot(floor(cell)+colonyStyle.y*31.,vec2(12.9898,78.233)))*43758.5453));
      if(!wall)diffuseColor.rgb*=vec3(.49,.57,.5);
      if(glass)diffuseColor.rgb=mix(vec3(.032,.065,.082),vec3(.18,.235,.24),lit);
      if(wall&&!glass&&pane.y>.96)diffuseColor.rgb*=colonyStyle.z;
      float distant=smoothstep(.3,1.,max(fwidth(cell.x),fwidth(cell.y)));
      if(wall)diffuseColor.rgb=mix(diffuseColor.rgb,colonyBase*.67,distant);`)
    shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
      totalEmissiveRadiance*=wall?mix(glass?lit:0.,.08,distant):0.;`)
  }
  m.customProgramCacheKey=()=> 'colony-metric-facade-v3-'+entrance+'-'+perBuilding
  m.emissive.setHex(0xffd5a2)
  m.emissiveIntensity=.02
  return m
}

export function prepareColonyGeometry(source:THREE.BufferGeometry,capacity:number){
 const g=source.clone()
 g.setAttribute('aColonyFacade',new THREE.InstancedBufferAttribute(new Float32Array(capacity*4),4))
 g.setAttribute('aColonyStyle',new THREE.InstancedBufferAttribute(new Float32Array(capacity*4),4))
 return g
}
export function writeColonyFacade(mesh:THREE.InstancedMesh,index:number,design:ReturnType<typeof colonyBuildingDesign>){
 const p=design.profile
 ;(mesh.geometry.getAttribute('aColonyFacade') as THREE.InstancedBufferAttribute).setXYZW(index,p.bay,p.storey,p.paneWidth,p.paneHeight)
 ;(mesh.geometry.getAttribute('aColonyStyle') as THREE.InstancedBufferAttribute).setXYZW(index,p.paneBottom,design.seed,design.band,0)
}
export function dirtyColonyFacade(mesh:THREE.InstancedMesh){
 for(const name of ['aColonyFacade','aColonyStyle']){const a=mesh.geometry.getAttribute(name);if(a)a.needsUpdate=true}
}
