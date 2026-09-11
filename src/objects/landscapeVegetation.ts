import * as THREE from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import type {CityTree} from './cityLayout'
/** Position-ranked sampling does not consume the city layout random stream. */
export function selectLandscapeTrees(trees:CityTree[],budget:number):CityTree[]{
 if(trees.length<=budget)return trees
 const rank=(t:CityTree)=>{const x=Math.sin(t.azimuth*917.13+t.axial*.173+ t.tone*71.7)*43758.5453;return x-Math.floor(x)}
 return trees.map(tree=>({tree,rank:rank(tree)})).sort((a,b)=>a.rank-b.rank).slice(0,budget).map(v=>v.tree)
}
/** Three asymmetric foliage masses, 120 triangles; smooth lower lobes break up the rim. */
export function createLandscapeCrown(){
 const parts=[[-.17,.67,.02,.34,.36,.34],[.19,.72,-.04,.32,.40,.30],[.01,.95,.03,.34,.28,.33]].map(([x,y,z,sx,sy,sz],index)=>{
  const g=new THREE.IcosahedronGeometry(1,index===2?1:0)
  const p=g.getAttribute('position'),n=g.getAttribute('normal'),v=new THREE.Vector3()
  for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).normalize();n.setXYZ(i,v.x,v.y,v.z)}
  g.rotateY(index*.73);g.rotateZ((index-1)*.17);g.scale(sx,sy,sz);g.translate(x,y,z);return g
 })
 const merged=mergeGeometries(parts)!
 parts.forEach(p=>p.dispose());return merged
}
/** Low contrast, seamless meadow variation; no roads or repeated fake paths. */
export function createMeadowTexture(){
 const size=128,canvas=document.createElement('canvas');canvas.width=canvas.height=size
 const ctx=canvas.getContext('2d')!,pixels=ctx.createImageData(size,size)
 const noise=(x:number,y:number,cells:number)=>{
  const gx=x/size*cells,gy=y/size*cells,ix=Math.floor(gx),iy=Math.floor(gy)
  const f=(t:number)=>t*t*(3-2*t),a=f(gx-ix),b=f(gy-iy)
  const value=(i:number,j:number)=>{const h=Math.sin((i%cells)*127.1+(j%cells)*311.7)*43758.5453;return h-Math.floor(h)}
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(value(ix,iy),value(ix+1,iy),a),THREE.MathUtils.lerp(value(ix,iy+1),value(ix+1,iy+1),a),b)
 }
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const tone=.88+.09*noise(x,y,5)+.035*noise(x,y,13)
  const i=(y*size+x)*4;pixels.data[i]=Math.round(198*tone);pixels.data[i+1]=Math.round(213*tone);pixels.data[i+2]=Math.round(180*tone);pixels.data[i+3]=255
 }
 ctx.putImageData(pixels,0,0);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;return texture
}
