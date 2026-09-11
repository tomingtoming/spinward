import * as THREE from 'three'
export const COLONY_SHOP_LABELS=['GROCER','BAKERY','BOOKS','COFFEE','PHARMACY','CYCLE','STUDIO','MARKET']
const LABELS=[...COLONY_SHOP_LABELS,'RESIDENCES','OFFICES','DIRECTORY']
/** One atlas and one instanced draw for all tenant signs. */
export function colonyShopSignMaterial(){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=64*LABELS.length
  const ctx=canvas.getContext('2d')!
  const colors=['#45605b','#755947','#505d67','#705146','#49625a','#586570','#656055','#6b5348','#57635b','#475967','#5f5d57']
  LABELS.forEach((label,i)=>{
    ctx.fillStyle=colors[i];ctx.fillRect(0,i*64,512,64)
    ctx.fillStyle='#ece2cf';ctx.font='500 35px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,256,i*64+33)
  })
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace
  const material=new THREE.MeshStandardMaterial({map,emissiveMap:map,emissive:0xffffff,emissiveIntensity:.18,roughness:.8})
  material.onBeforeCompile=shader=>{
    shader.vertexShader='attribute float aShopSign;\n'+shader.vertexShader
    shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>',`#include <uv_vertex>
      vMapUv.y=(vMapUv.y+${LABELS.length-1}.-aShopSign)/${LABELS.length}.;
      vEmissiveMapUv.y=(vEmissiveMapUv.y+${LABELS.length-1}.-aShopSign)/${LABELS.length}.;`)
  }
  material.customProgramCacheKey=()=> 'colony-tenant-sign-v2'
  return material
}
