import * as T from 'three'
import {outsideShellBounds} from './closed-building-shell.js'

// Rasterizer back-face culling for meshes made only of certified shells. It is
// a per-draw state change, so it follows the same both-eye exterior test as
// the shader discard. It can move isolated silhouette-edge pixels, so
// ?shellCull=off restores the two-sided draw for on-device A/B comparisons.
export const shellFaceCulling={enabled:globalThis.location?new URLSearchParams(globalThis.location.search).get('shellCull')!=='off':true}

export function patchBuildingShellCulling(mesh,data,base){
  if(!data.shellBounds||!data.attributes.closedShell)return
  const material=mesh.material,previous=material.onBeforeCompile,key=material.customProgramCacheKey()
  const enabled={value:0},eye=new T.Vector3(),inverse=new T.Matrix4()
  material.onBeforeCompile=(shader,renderer)=>{
    previous.call(material,shader,renderer)
    shader.uniforms.metroExteriorEye=enabled
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float closedShell; varying float vClosedShell;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvClosedShell=closedShell;')
    // The program may compile during a front-only draw; keep two-sided normals.
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#ifndef DOUBLE_SIDED\n#define DOUBLE_SIDED\n#endif\n#include <common>\nuniform float metroExteriorEye; varying float vClosedShell;')
      // Preserve normal/texture derivatives before any distance-dependent
      // discard. Rejecting a helper invocation earlier can alter edge pixels.
      // Distant silhouettes retain the original double-sided path.
      .replace('#include <lights_physical_fragment>','if(metroExteriorEye>.5 && vClosedShell>.5 && !gl_FrontFacing && dot(vViewPosition,vViewPosition)<10000.0)discard;\n#include <lights_physical_fragment>')
  }
  material.customProgramCacheKey=()=>`${key}-closed-exterior-near-v4`
  const before=mesh.onBeforeRender
  mesh.onBeforeRender=function(renderer,scene,camera,...rest){
    before.call(this,renderer,scene,camera,...rest)
    eye.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inverse.copy(mesh.matrixWorld).invert())
    let x=eye.x,y=-eye.z,z=eye.y,warp=1
    // A near plane cutting into a solid exposes its interior even while the
    // eye itself is outside. Bound all four asymmetric XR near-plane corners.
    const projection=camera.projectionMatrix.elements,near=camera.near??0
    const nearRadius=near*Math.hypot(1,(1+Math.abs(projection[8]))/Math.abs(projection[0]),(1+Math.abs(projection[9]))/Math.abs(projection[5]))
    if(base.mode!=='flat'){
      const colony=base.mode==='colony',radius=base.study.radius
      const localY=eye.y-(colony?0:radius)
      const angle=Math.atan2(eye.x,-localY)-(colony?base.sample.band*Math.PI*2/3:0)
      x=Math.atan2(Math.sin(angle),Math.cos(angle))*radius-(colony?base.sample.anchor.local[0]:0)
      y-=colony?base.sample.anchor.local[1]:0;z=radius-Math.hypot(eye.x,localY)
      warp=Math.max(1,radius/Math.max(1,radius-z-nearRadius))
    }
    enabled.value=outsideShellBounds(data.shellBounds,x,y,z,.05+nearRadius*warp)?1:0
  }
  mesh.userData.shellCulling=enabled;mesh.userData.shellFaceCulling=shellFaceCulling
  if(!data.attributes.closedShell.every(v=>v>.5))return
  // Shadows derive their side from material.side unless shadowSide is set.
  const side=material.side,beforeMaterial=material.onBeforeRender,after=mesh.onAfterRender
  material.shadowSide??=side
  material.onBeforeRender=function(...args){
    beforeMaterial.apply(this,args)
    if(enabled.value&&shellFaceCulling.enabled)material.side=T.FrontSide
  }
  mesh.onAfterRender=function(...args){after.apply(this,args);material.side=side}
}
