import * as T from 'three'
import {surfaceAngle,surfacePoint} from './surface-frame.js'

let sharedParts
function templates(){
  // Both LODs use the same broad crown dimensions and muted palette. A tall
  // conifer kit would change species and colour when crossing the LOD radius.
  return sharedParts??=[
    {geometry:new T.IcosahedronGeometry(1,1).scale(.36,.46,.36).translate(0,.67,0),foliage:true,
      material:new T.MeshStandardMaterial({color:'#ffffff',roughness:1,flatShading:true})},
    {geometry:new T.CylinderGeometry(.016,.026,.6,8).translate(0,.3,0),foliage:false,
      material:new T.MeshStandardMaterial({color:'#756957',roughness:1})}
  ]
}

/** A bounded reusable tree kit. Woodland outlines are source data; individual
 * tree positions and dimensions are authored, deterministic approximations. */
export class MetroTrees{
  static async create(study,data){return new MetroTrees(study,data,await templates())}
  constructor(study,data,parts){
    this.group=new T.Group();this.group.name='metro-woodland';this.last=-Infinity
    const sample=study.samples.find(s=>s.id===data.band),point=new T.Vector3(),basis=new T.Matrix4(),matrix=new T.Matrix4()
    const up=new T.Vector3(),right=new T.Vector3(),forward=new T.Vector3(0,0,1),q=new T.Quaternion(),scale=new T.Vector3()
    this.rows=data.trees.map(([x,y,h,height,radius,colour])=>{
      const a=surfaceAngle(study.radius,sample,'colony',x)
      point.fromArray(surfacePoint(study.radius,sample,'colony',x,y,h-.05))
      up.set(-Math.sin(a),Math.cos(a),0);right.set(Math.cos(a),Math.sin(a),0)
      q.setFromRotationMatrix(basis.makeBasis(right,up,forward))
      const near=matrix.compose(point,q,scale.setScalar(height)).clone()
      const crown=matrix.compose(point.clone().addScaledVector(up,height*.67),q,scale.set(radius,height*.46,radius)).clone()
      const trunk=matrix.compose(point.clone().addScaledVector(up,height*.3),q,scale.set(height*.026,height*.6,height*.026)).clone()
      return{point:point.clone(),near,crown,trunk,colour:new T.Color(['#788864','#82916d','#697f5c','#8d9874'][colour])}
    })
    const count=this.rows.length
    this.crowns=new T.InstancedMesh(new T.IcosahedronGeometry(1,0),new T.MeshStandardMaterial({color:'#ffffff',roughness:1,flatShading:true}),count)
    this.trunks=new T.InstancedMesh(new T.CylinderGeometry(1,1,1,5),new T.MeshStandardMaterial({color:'#756957',roughness:1}),count)
    this.near=parts.map(p=>{
      const materials=Array.isArray(p.material)?p.material.map(m=>m.clone()):p.material.clone()
      const mesh=new T.InstancedMesh(p.geometry,materials,384);mesh.userData.foliage=p.foliage;mesh.count=0;return mesh
    })
    for(const mesh of [this.crowns,this.trunks,...this.near]){
      mesh.name='woodland-tree';mesh.receiveShadow=true
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);this.group.add(mesh)
    }
    this.update(new T.Vector3(),true)
    // Initial far instances include the entire grove, so these conservative
    // bounds remain valid when nearby trees move into the detailed kit.
    this.crowns.computeBoundingSphere();this.trunks.computeBoundingSphere()
  }
  update(cameraWorld,force=false){
    if(!force&&performance.now()-this.last<350)return;this.last=performance.now()
    const eye=this.group.worldToLocal(cameraWorld.clone())
    if(!force&&this.lastEye&&eye.distanceToSquared(this.lastEye)<1)return
    this.lastEye=eye.clone()
    const candidates=this.rows.map((r,i)=>({i,d:r.point.distanceTo(eye)})).filter(r=>r.d<160).sort((a,b)=>a.d-b.d)
    const nearIds=new Set(candidates.slice(0,384).map(r=>r.i));let low=0,high=0
    for(const [i,r] of this.rows.entries()){
      if(nearIds.has(i)){
        for(const m of this.near){m.setMatrixAt(high,r.near);if(m.userData.foliage)m.setColorAt(high,r.colour)}
        high++
      }else{
        this.crowns.setMatrixAt(low,r.crown);this.crowns.setColorAt(low,r.colour)
        this.trunks.setMatrixAt(low,r.trunk);low++
      }
    }
    this.crowns.count=this.trunks.count=low
    for(const m of this.near)m.count=high
    for(const m of this.near)m.computeBoundingSphere()
    for(const m of this.group.children){m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true}
    this.group.userData={trees:this.rows.length,near:high,far:low,maximumNear:384}
  }
  dispose(){
    for(const m of this.group.children){m.dispose();for(const mat of Array.isArray(m.material)?m.material:[m.material])mat.dispose()}
    this.crowns.geometry.dispose();this.trunks.geometry.dispose();this.group.clear();this.group.removeFromParent()
  }
}
