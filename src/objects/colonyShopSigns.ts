import * as THREE from 'three'
export const COLONY_SHOP_LABELS=['GROCER','BAKERY','BOOKS','COFFEE','PHARMACY','CYCLE','STUDIO','MARKET']
/** One atlas and one instanced draw for all tenant signs. */
export function colonyShopSignMaterial(){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512
  const ctx=canvas.getContext('2d')!
  const colors=['#45605b','#755947','#505d67','#705146','#49625a','#586570','#656055','#6b5348']
  COLONY_SHOP_LABELS.forEach((label,i)=>{
    ctx.fillStyle=colors[i];ctx.fillRect(0,i*64,512,64)
    ctx.fillStyle='#ece2cf';ctx.font='500 35px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,256,i*64+33)
  })
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace
  const material=new THREE.MeshStandardMaterial({map,emissiveMap:map,emissive:0xffffff,emissiveIntensity:.18,roughness:.8})
  material.onBeforeCompile=shader=>{
    shader.vertexShader='attribute float aShopSign;\n'+shader.vertexShader
    shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>',`#include <uv_vertex>
      vMapUv.y=(vMapUv.y+7.-aShopSign)/8.;
      vEmissiveMapUv.y=(vEmissiveMapUv.y+7.-aShopSign)/8.;`)
  }
  material.customProgramCacheKey=()=> 'colony-tenant-sign-v1'
  return material
}
