import * as T from 'three'
import {surfacePoint} from './surface-frame.js'

export const ROOF_SUPPORT_LIMIT=128
export class ObstructionLights{
  constructor(study,manifest){
    this.group=new T.Group();this.group.name='metro-obstruction-lights';this.rows=[];this.night={value:0}
    for(const sample of study.samples)for(const native of manifest.bands[sample.id]){
      const base=new T.Vector3(...surfacePoint(study.radius,sample,'colony',...native))
      const head=new T.Vector3(...surfacePoint(study.radius,sample,'colony',native[0],native[1],native[2]+manifest.supportHeightM))
      this.rows.push({base,head})
    }
    const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(this.rows.flatMap(r=>r.head.toArray()),3));geometry.computeBoundingSphere()
    const material=new T.PointsMaterial({color:'#ff2816',size:.22,transparent:true,depthWrite:false,blending:T.AdditiveBlending})
    material.onBeforeCompile=s=>{
      s.uniforms.roofNight=this.night
      s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying float roofDistance;')
        .replace('#include <fog_vertex>',`#include <fog_vertex>
          roofDistance=length(mvPosition.xyz);
          // Preserve a small, stable distant marker in each eye. It never
          // changes world position, and the roof still depth-occludes it.
          gl_PointSize=clamp(gl_PointSize,1.35,5.0);
        `)
      s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nuniform float roofNight; varying float roofDistance;')
        .replace('#include <color_fragment>',`#include <color_fragment>
          float core=1.0-smoothstep(.15,.5,length(gl_PointCoord-vec2(.5)));
          diffuseColor.a*=core*roofNight*(1.0-smoothstep(18000.0,32000.0,roofDistance));
        `).replace('#include <fog_fragment>',T.ShaderChunk.fog_fragment.replace('fogColor','vec3(0.0)'))
    }
    material.customProgramCacheKey=()=>`metro-roof-markers-v1`
    this.points=new T.Points(geometry,material);this.points.name='roof-beacon-red';this.group.add(this.points)
    this.posts=new T.InstancedMesh(new T.CylinderGeometry(.055,.075,1,6),new T.MeshStandardMaterial({color:'#555959',roughness:.8}),ROOF_SUPPORT_LIMIT)
    this.posts.name='roof-beacon-supports';this.posts.count=0;this.posts.frustumCulled=false;this.group.add(this.posts)
    this.heads=new T.InstancedMesh(new T.SphereGeometry(.105,6,4),new T.MeshStandardMaterial({color:'#64150d',emissive:'#ff2816',emissiveIntensity:0,roughness:.6}),ROOF_SUPPORT_LIMIT)
    this.heads.name='roof-beacon-housings';this.heads.count=0;this.heads.frustumCulled=false;this.group.add(this.heads)
  }
  update(eye){
    const local=this.group.worldToLocal(eye.clone())
    if(this.last?.distanceToSquared(local)<20**2)return;this.last=local.clone()
    const rows=this.rows.map(r=>({r,d:r.head.distanceToSquared(local)})).filter(x=>x.d<650**2).sort((a,b)=>a.d-b.d).slice(0,ROOF_SUPPORT_LIMIT)
    const matrix=new T.Matrix4(),q=new T.Quaternion(),up=new T.Vector3(0,1,0),scale=new T.Vector3()
    rows.forEach(({r},i)=>{
      const delta=r.head.clone().sub(r.base);q.setFromUnitVectors(up,delta.clone().normalize());scale.set(1,delta.length(),1)
      matrix.compose(r.base.clone().add(r.head).multiplyScalar(.5),q,scale);this.posts.setMatrixAt(i,matrix)
      matrix.makeTranslation(...r.head.toArray());this.heads.setMatrixAt(i,matrix)
    })
    for(const m of [this.posts,this.heads]){m.count=rows.length;m.instanceMatrix.needsUpdate=true}
  }
  setDaylight(value){const night=T.MathUtils.smoothstep(1-value,.1,.78);this.night.value=night;this.points.visible=night>.001;this.heads.material.emissiveIntensity=night*.8}
  diagnostics(){return{markers:this.rows.length,supports:this.posts.count,maxSupports:ROOF_SUPPORT_LIMIT,sourceBytes:this.points.geometry.attributes.position.array.byteLength}}
  dispose(){for(const m of [this.points,this.posts,this.heads]){m.geometry.dispose();m.material.dispose();m.dispose?.()}this.group.removeFromParent()}
}
