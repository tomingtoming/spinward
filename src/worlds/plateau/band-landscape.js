import * as T from 'three'
import {WalkWorld,SpatialIndex,insideShape} from './walking.js'
import {surfacePoint,surfaceAngle} from './surface-frame.js'

// Query the actual authored terrain triangles, not a second noise/height
// function. Narrow cross-band triangles bound the cylinder chord error.
export class TerrainTriangles {
  constructor(position,index){
    this.position=position;this.index=index;this.cells=new Map();this.size=200
    for(let k=0;k<index.length;k+=3){
      const ids=[index[k]*3,index[k+1]*3,index[k+2]*3],x=ids.map(i=>position[i]),y=ids.map(i=>position[i+1])
      for(let ix=Math.floor(Math.min(...x)/this.size);ix<=Math.floor(Math.max(...x)/this.size);ix++)for(let iy=Math.floor(Math.min(...y)/this.size);iy<=Math.floor(Math.max(...y)/this.size);iy++){
        const key=ix+','+iy;if(!this.cells.has(key))this.cells.set(key,[]);this.cells.get(key).push(k)
      }
    }
  }
  height(x,y){
    const p=this.position,idx=this.index,candidates=this.cells.get(Math.floor(x/this.size)+','+Math.floor(y/this.size))??[]
    for(const k of candidates){
      const a=idx[k]*3,b=idx[k+1]*3,c=idx[k+2]*3,dx=p[b]-p[a],dy=p[b+1]-p[a+1],ex=p[c]-p[a],ey=p[c+1]-p[a+1],det=dx*ey-dy*ex
      if(Math.abs(det)<1e-9)continue
      const u=((x-p[a])*ey-(y-p[a+1])*ex)/det,v=(dx*(y-p[a+1])-dy*(x-p[a]))/det
      if(u>=-1e-5&&v>=-1e-5&&u+v<=1.00001)return p[a+2]+u*(p[b+2]-p[a+2])+v*(p[c+2]-p[a+2])
    }
    return NaN
  }
}

export class BandWorld extends WalkWorld {
  constructor(core,data,terrain){
    const obstacles=data.trees.map(([x,y,h])=>({bounds:[x-.23,y-.23,x+.23,y+.23],rings:[Array.from({length:9},(_,i)=>[x+.23*Math.cos(i*Math.PI/4),y+.23*Math.sin(i*Math.PI/4)])]}))
    for(const d of data.destinations)for(const offset of [-1.26,1.26]){const sign=d.sign??{x:d.point[0]+8,y:d.point[1]+4,yaw:0},x=sign.x+offset*Math.cos(sign.yaw),y=sign.y+offset*Math.sin(sign.yaw),r=.026;obstacles.push({bounds:[x-r,y-r,x+r,y+r],rings:[[[x-r,y-r],[x+r,y-r],[x+r,y+r],[x-r,y+r],[x-r,y-r]]]})}
    super({...data,obstacles,arrival:core.data.arrival});this.core=core;this.outerTerrain=terrain
    // Source tiles keep source collision, but the band boundary now governs
    // movement. A core edge must not become an invisible enclosing wall.
    core.boundsOverride=data.bounds
  }
  insideCore(x,y){const b=this.data.sourceBounds;return x>=b[0]&&x<=b[2]&&y>=b[1]&&y<=b[3]}
  readyAt(x,y){return !this.insideCore(x,y)||this.core.readyAt(x,y)}
  terrain(x,y){return this.insideCore(x,y)?this.core.terrain(x,y):this.outerTerrain.height(x,y)}
  ground(x,y){return this.insideCore(x,y)?this.core.ground(x,y):super.ground(x,y)}
  blocked(x,y,r){
    if(this.insideCore(x,y)){const blocked=this.core.blocked(x,y,r);this.lastCandidateCount=this.core.lastCandidateCount;return blocked}
    return super.blocked(x,y,r)||!Number.isFinite(this.outerTerrain.height(x,y))
  }
  move(state,dx,dy){this.waiting=!this.readyAt(state.x,state.y)||!this.readyAt(state.x+dx,state.y+dy);return this.waiting?state:super.move(state,dx,dy)}
  spawn(){return this.core.spawn()}
  update(...args){this.core.update(...args)}
  retry(){this.core.retry()}
  get entries(){return this.core.entries}
  diagnostics(){return{...this.core.diagnostics(),waiting:this.waiting,designedTerrainTriangles:this.outerTerrain.index.length/3}}
  dispose(){this.core.dispose()}
}

export class BandLandscape {
  constructor(study,sample,data,meshes,{initialMode='flat'}={}){
    Object.assign(this,{study,sample,data});this.group=new T.Group();this.group.name='band-landscape';this.mode=null;this.meshes=[]
    for(const item of meshes){
      const g=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(item.position.slice(),3)).setIndex(new T.BufferAttribute(item.index,1))
      if(item.color)g.setAttribute('color',new T.BufferAttribute(item.color,3))
      const material=new T.MeshStandardMaterial({color:item.color?'#ffffff':item.material,vertexColors:!!item.color,roughness:item.roughness??.96,side:T.DoubleSide,
        polygonOffset:['band-roads','band-water'].includes(item.name),polygonOffsetFactor:-1,polygonOffsetUnits:-3})
      const mesh=new T.Mesh(g,material);mesh.name=item.name;mesh.receiveShadow=true;mesh.castShadow=item.name==='band-buildings';mesh.userData.native=item.position
      this.group.add(mesh);this.meshes.push(mesh)
      if(item.name==='band-terrain')this.terrain=new TerrainTriangles(item.position,item.index)
    }
    const count=data.trees.length
    this.trunks=new T.InstancedMesh(new T.CylinderGeometry(1,1,1,5),new T.MeshStandardMaterial({color:'#79735a',roughness:1}),count)
    this.canopies=new T.InstancedMesh(new T.IcosahedronGeometry(1,1),new T.MeshStandardMaterial({color:'#ffffff',roughness:1}),count)
    this.trunks.name='band-tree-trunks';this.canopies.name='band-tree-canopies';this.canopies.castShadow=true
    for(let i=0;i<count;i++)this.canopies.setColorAt(i,new T.Color(['#708967','#839770','#8fa076','#677f64'][i%4]))
    this.group.add(this.trunks,this.canopies);this.signs=[]
    for(const destination of data.destinations){
      const placement=destination.sign??{x:destination.point[0]+8,y:destination.point[1]+4,yaw:0},x=placement.x,y=placement.y,h=this.terrain.height(x,y),sign=new T.Group()
      if(!Number.isFinite(h))continue
      const metal=new T.MeshStandardMaterial({color:'#526760',roughness:.85})
      for(const x of [-1.26,1.26]){const post=new T.Mesh(new T.BoxGeometry(.05,1.9,.05),metal);post.position.set(x,.95,0);sign.add(post)}
      const back=new T.Mesh(new T.BoxGeometry(3.2,.82,.08),metal);back.position.y=1.75;sign.add(back)
      const canvas=document.createElement('canvas');canvas.width=960;canvas.height=256;const c=canvas.getContext('2d');c.fillStyle='#294f4e';c.fillRect(0,0,960,256);c.fillStyle='#f1f0d9';c.textAlign='center';c.font='600 65px system-ui';c.fillText(destination.label.replace(/^(始端側|終端側) /,''),480,114,890);c.font='32px system-ui';c.fillStyle='#c1d0bf';c.fillText(`SPINWARD · 内壁 ${sample.band+1}`,480,195)
      const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace
      for(const side of [-1,1]){const panel=new T.Mesh(new T.PlaneGeometry(3.05,.72),new T.MeshBasicMaterial({map:texture}));panel.position.set(0,1.75,side*.045);if(side<0)panel.rotation.y=Math.PI;sign.add(panel)}
      sign.name='band-wayfinding';this.group.add(sign);this.signs.push({sign,x,y,h,yaw:placement.yaw})
    }
    this.updateMode(initialMode)
  }
  setWalking(walking){
    // At grazing angles the back of a distant terrain fold can compete with
    // its front in the depth buffer. Walkers see the inward surface only;
    // the tabletop overview retains the reverse side of the land sheets.
    for(const mesh of this.meshes)if(['band-terrain','band-roads','band-water','band-crops'].includes(mesh.name)){
      const side=walking?T.FrontSide:T.DoubleSide
      if(mesh.material.side!==side){mesh.material.side=side;mesh.material.needsUpdate=true}
    }
  }
  updateMode(mode){
    if(this.mode===mode)return;this.mode=mode
    for(const mesh of this.meshes){const native=mesh.userData.native,p=mesh.geometry.attributes.position
      for(let i=0;i<native.length;i+=3)p.array.set(surfacePoint(this.study.radius,this.sample,mode,native[i],native[i+1],native[i+2]),i)
      p.needsUpdate=true;mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingSphere()
    }
    const matrix=new T.Matrix4(),q=new T.Quaternion(),scale=new T.Vector3(),point=new T.Vector3(),zAxis=new T.Vector3(0,0,1)
    this.data.trees.forEach(([x,y,h,height,radius],i)=>{
      const angle=mode==='flat'?0:surfaceAngle(this.study.radius,this.sample,mode,x);q.setFromAxisAngle(zAxis,angle)
      point.set(...surfacePoint(this.study.radius,this.sample,mode,x,y,h+height*.33));scale.set(.22,height*.66,.22);matrix.compose(point,q,scale);this.trunks.setMatrixAt(i,matrix)
      point.set(...surfacePoint(this.study.radius,this.sample,mode,x,y,h+height*.73));scale.set(radius,height*.40,radius);matrix.compose(point,q,scale);this.canopies.setMatrixAt(i,matrix)
    })
    for(const mesh of [this.trunks,this.canopies]){mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere()}
    for(const {sign,x,y,h,yaw} of this.signs){sign.position.set(...surfacePoint(this.study.radius,this.sample,mode,x,y,h));sign.quaternion.setFromAxisAngle(zAxis,mode==='flat'?0:surfaceAngle(this.study.radius,this.sample,mode,x)).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),yaw))}
  }
}

export async function loadBandLandscape(study,sample,fetchJSON,fetchBuffer,options={}){
  const data=await fetchJSON('/'+sample.bandLandscape),meshes=await Promise.all(data.meshes.map(async m=>({
    ...m,position:new Float32Array(await fetchBuffer('/'+m.path+m.positions)),index:new Uint32Array(await fetchBuffer('/'+m.path+m.indices)),
    ...(m.colours?{color:new Float32Array(await fetchBuffer('/'+m.path+m.colours))}:{})})))
  return new BandLandscape(study,sample,data,meshes,options)
}
