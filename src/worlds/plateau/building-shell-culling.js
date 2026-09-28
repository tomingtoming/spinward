import * as T from 'three'
import {outsideShellBounds} from './closed-building-shell.js'

export function patchBuildingShellCulling(mesh,data,base){
  if(!data.shellBounds||!data.attributes.closedShell)return
  const material=mesh.material,previous=material.onBeforeCompile,key=material.customProgramCacheKey()
  const enabled={value:0},eye=new T.Vector3(),inverse=new T.Matrix4()
  material.onBeforeCompile=(shader,renderer)=>{
    previous.call(material,shader,renderer)
    shader.uniforms.metroExteriorEye=enabled
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float closedShell; varying float vClosedShell;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvClosedShell=closedShell;')
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float metroExteriorEye; varying float vClosedShell;')
      // Preserve normal/texture derivatives before any distance-dependent
      // discard. Rejecting a helper invocation earlier can alter edge pixels.
      // Distant silhouettes retain the original double-sided path.
      .replace('#include <lights_physical_fragment>','if(metroExteriorEye>.5 && vClosedShell>.5 && !gl_FrontFacing && dot(vViewPosition,vViewPosition)<10000.0)discard;\n#include <lights_physical_fragment>')
  }
  material.customProgramCacheKey=()=>`${key}-closed-exterior-near-v3`
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
  mesh.userData.shellCulling=enabled
}
