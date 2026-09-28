import * as T from 'three'

export const tileOrdinal=id=>{const [x,y]=id.split('-').map(Number);return y*17+x}

/** Ownership changes only after a complete replacement is ready. The district
 * silhouettes keep low buildings present in both tiers, so no screen-door
 * transparency is needed to disguise the old height-cutoff gap. */
export class TileCoverage{
  constructor(){
    this.values=new Uint8Array(64*64*4);this.texture=new T.DataTexture(this.values,64,64)
    this.texture.needsUpdate=true
    this.near=new Set()
  }
  nearTiles(ids){
    const next=new Set(ids)
    for(const id of this.near)if(!next.has(id))this.values[tileOrdinal(id)*4+1]=0
    for(const id of next)this.values[tileOrdinal(id)*4+1]=255
    this.near=next;this.texture.needsUpdate=true
  }
  target(id,visible){
    const index=tileOrdinal(id),target=visible?255:0
    if(this.values[index*4]===target)return
    this.values[index*4]=target;this.texture.needsUpdate=true
  }
  value(id){return this.values[tileOrdinal(id)*4]/255}
  patch(mesh,data,level){
    if(!['overview','far','near'].includes(level))return
    // Worker-generated IDs are constant over each ownership segment/triangle.
    mesh.geometry.setAttribute('metroTile',new T.BufferAttribute(data.tileOrdinals,1))
    const patch=material=>{
      material.onBeforeCompile=shader=>{
        shader.uniforms.metroCoverage={value:this.texture}
        shader.uniforms.metroLevel={value:level==='near'?2:level==='far'?1:0}
        shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float metroTile; varying float vMetroTile;')
          .replace('#include <begin_vertex>','#include <begin_vertex>\nvMetroTile=metroTile;')
        shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform sampler2D metroCoverage; uniform float metroLevel; varying float vMetroTile;')
          .replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
            float tile=floor(vMetroTile+0.5);
            float coverage=texture2D(metroCoverage,(vec2(mod(tile,64.0),floor(tile/64.0))+0.5)/64.0).r;
            if(metroLevel<0.5&&coverage>0.5)discard;
            if(metroLevel>0.5&&metroLevel<1.5&&coverage<0.5)discard;
          `)
      }
      material.customProgramCacheKey=()=>`metro-coverage-v3`
      return material
    }
    patch(mesh.material)
    mesh.customDepthMaterial=patch(new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking,side:T.DoubleSide}))
    mesh.customDistanceMaterial=patch(new T.MeshDistanceMaterial({side:T.DoubleSide}))
    mesh.material.addEventListener('dispose',()=>{mesh.customDepthMaterial.dispose();mesh.customDistanceMaterial.dispose()},{once:true})
  }
  dispose(){this.texture.dispose()}
}
