import * as T from 'three'
import {ColonyRail} from '../../objects/colonyRail'
import {railPoint} from '../../gameplay/railService'
import {planBandRail,TERMINAL_AXIAL} from './transitPlan'
import {SpatialIndex} from '../../worlds/plateau/walking.js'

const transform=new T.Matrix4().makeBasis(new T.Vector3(0,-1,0),new T.Vector3(0,0,-1),new T.Vector3(1,0,0))
const point=(x,y,h)=>[(3200-h)*Math.cos(x/3200),y,(3200-h)*Math.sin(x/3200)]
export class ThreeBandTransit {
  constructor(scene,study,worlds,navigations,asset){
    this.root=new T.Group();this.root.setRotationFromMatrix(transform);scene.add(this.root)
    const terminals=study.samples.map(sample=>{const stop=navigations.get(sample.id).data.destinations.find(d=>d.id==='outer-1-3');return{...stop,region:sample.id,label:{tokyo:'東京',tama:'多摩',azumino:'安曇野'}[sample.id],sample}})
    this.data=planBandRail(terminals,asset,(x,y)=>{
      let height=-Infinity
      for(const sample of study.samples){const h=worlds.get(sample.id).terrain(x-sample.band*Math.PI*2/3*3200-sample.anchor.local[0],y-sample.anchor.local[1]);if(Number.isFinite(h))height=Math.max(height,h)}
      return height
    });this.rail=new ColonyRail(this.root);this.rail.configure(this.data,asset.palette,asset.materialDetails)
    this.service=this.rail.service;this.service.time=-this.service.tables[0].offset;this.service.step(0);this.riding=null
    this.study=study;this.worlds=worlds;this.lamps=[];this.buildGuideway()
    // Platforms and ramps add their exact drawn triangles to the same source
    // support index as the landscape. Boarding uses the raised platform floor.
    for(const station of this.data.stations){
      const sample=study.samples[station.band],world=worlds.get(sample.id),offset=sample.band*Math.PI*2/3*3200+sample.anchor.local[0],axial=sample.anchor.local[1]
      const x=station.position[0],y=TERMINAL_AXIAL,h=station.platform[2],ground=station.position[2]
      const surfaces=[[[x-12,y-1.7,h],[x+10,y-1.7,h],[x+10,y+1.7,h],[x-12,y+1.7,h]],
        [[x-11.5,y+1.7,h],[x-8.5,y+1.7,h],[x-8.5,y+6,ground],[x-11.5,y+6,ground]],
        [[x-11.5,y+6,ground],[x+1.5,y+6,ground],[x+1.5,y+8,ground],[x-11.5,y+8,ground]]]
      const triangles=[]
      for(const quad of surfaces){this.surface(quad,'#a9ad9f');for(const ids of [[0,1,2],[0,2,3]]){
        const [a,b,c]=ids.map(i=>[quad[i][0]-offset,quad[i][1]-axial,quad[i][2]])
        triangles.push({a,b,c,bounds:[Math.min(a[0],b[0],c[0]),Math.min(a[1],b[1],c[1]),Math.max(a[0],b[0],c[0]),Math.max(a[1],b[1],c[1])]})
      }}
      world.supports=new SpatialIndex([...world.supports.shapes,...triangles])
      const lamp=new T.PointLight('#ffdea0',12,18,2);lamp.position.set(...point(x,y,h+3));lamp.visible=false;this.root.add(lamp);this.lamps.push({lamp,x,y})
      const sign=new T.Group(),up=new T.Vector3(-Math.cos(x/3200),0,-Math.sin(x/3200)),forward=new T.Vector3(0,1,0),right=new T.Vector3().crossVectors(up,forward)
      sign.matrixAutoUpdate=false;sign.matrix.makeBasis(right,up,forward).setPosition(...point(x+8,y,h))
      const metal=new T.MeshStandardMaterial({color:'#526760'}),post=new T.Mesh(new T.BoxGeometry(.06,2.6,.06),metal);post.position.y=1.3;sign.add(post)
      const canvas=document.createElement('canvas');canvas.width=960;canvas.height=256;const c=canvas.getContext('2d');c.fillStyle='#25494b';c.fillRect(0,0,960,256);c.fillStyle='#fafaf5';c.textAlign='center';c.font='52px system-ui';c.fillText(station.name,480,90);c.font='36px system-ui';c.fillText('東京 ↔ 多摩 ↔ 安曇野',480,170)
      const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace
      const panel=new T.Mesh(new T.PlaneGeometry(3.2,.85),new T.MeshBasicMaterial({map:texture,side:T.DoubleSide}));panel.position.y=2.25;sign.add(panel);this.root.add(sign)
    }
    for(const sample of study.samples){const world=worlds.get(sample.id),blocked=world.blocked.bind(world)
      world.blocked=(x,y,r=.28)=>{
        if(blocked(x,y,r))return true
        const tangent=x+sample.anchor.local[0]+sample.band*Math.PI*2/3*3200,axial=y+sample.anchor.local[1]
        return this.service.trains.some(train=>Math.abs(tangent-train.position[0])<this.data.configuration.carLength/2+r&&Math.abs(axial-train.position[1])<this.data.configuration.carWidth/2+r)
      }
    }
  }
  surface(quad,color){
    const geometry=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(quad.flatMap(p=>point(...p)),3)).setIndex([0,2,1,0,3,2]);geometry.computeVertexNormals()
    const mesh=new T.Mesh(geometry,new T.MeshStandardMaterial({color,side:T.DoubleSide,roughness:.8}));mesh.receiveShadow=true;mesh.name='transit-platform';this.root.add(mesh)
  }
  buildGuideway(){
    const line=this.data.lines[0]
    // A continuous structural beam carries both tracks across the window bays.
    const rails=[-3.15,3.15].flatMap(lane=>[-.7175,.7175].map(gauge=>[lane+gauge,.09,.05,.12,'#bbc3c0']))
    for(const [offset,width,lift,depth,color] of [[0,10,-.18,4,'#858b83'],...rails]){
      const positions=[],indices=[]
      for(let i=0;i<line.points.length;i++){
        const [s]=line.points[i]
        for(const [side,drop] of [[-1,0],[1,0],[1,depth],[-1,depth]]){const p=railPoint(line,s,offset+side*width/2);p[2]+=lift-drop;positions.push(...point(...p))}
        if(i){const k=i*4;for(let j=0;j<4;j++){const n=(j+1)%4;indices.push(k-4+j,k+j,k-4+n,k-4+n,k+j,k+n)}}
      }
      const end=positions.length/3-4;indices.push(0,1,2,0,2,3,end,end+2,end+1,end,end+3,end+2)
      const geometry=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(positions,3)).setIndex(indices);geometry.computeVertexNormals()
      const mesh=new T.Mesh(geometry,new T.MeshStandardMaterial({color,side:T.DoubleSide,roughness:.8}));mesh.name='interband-guideway';this.root.add(mesh)
    }
    // Terminal vehicles reverse tracks over the service's 150 m smoothstep.
    // Draw those switch rails as well as the two continuous through tracks.
    for(const end of [false,true])for(const gauge of [-.7175,.7175]){
      const vertices=[],indices=[]
      for(let i=0;i<=30;i++){
        const d=i*5,u=d/150,lane=(end?-1:1)*3.15*(1-2*u*u*(3-2*u)),s=end?line.length-d:d
        for(const [side,drop] of [[-1,0],[1,0],[1,.12],[-1,.12]]){const p=railPoint(line,s,lane+gauge+side*.045);p[2]+=.05-drop;vertices.push(...point(...p))}
        if(i){const k=i*4;for(let j=0;j<4;j++){const n=(j+1)%4;indices.push(k-4+j,k+j,k-4+n,k-4+n,k+j,k+n)}}
      }
      const geometry=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(vertices,3)).setIndex(indices);geometry.computeVertexNormals()
      const mesh=new T.Mesh(geometry,new T.MeshStandardMaterial({color:'#bbc3c0',side:T.DoubleSide,roughness:.8}));mesh.name='terminal-switch-rail';this.root.add(mesh)
    }
  }
  step(dt,player,sample,daylight){
    const tangent=player.x+sample.anchor.local[0]+sample.band*Math.PI*2/3*3200,axial=player.y+sample.anchor.local[1]
    for(const {lamp,x,y} of this.lamps)lamp.visible=Math.hypot(tangent-x,axial-y)<80
    this.rail.update(dt,(player.x+sample.anchor.local[0])/3200+sample.band*Math.PI*2/3,player.y+sample.anchor.local[1],daylight,this.riding?.id??null)
    if(!this.riding)return null
    const [x,y,h]=this.riding.position
    return{...player,x:x-sample.band*Math.PI*2/3*3200-sample.anchor.local[0],y:y-sample.anchor.local[1],h:h+this.data.configuration.carFloor,rejected:0}
  }
  nearby(player,sample){
    return this.service.nearestBoarding((player.x+sample.anchor.local[0])/3200+sample.band*Math.PI*2/3,player.y+sample.anchor.local[1],player.h,3200)
  }
  action(player,sample){
    if(this.riding){const train=this.riding;if(!train.station||train.doorOpen<.95||train.departureIn<2)return null
      const station=train.station,point=station.boarding[train.lane<0?0:1];this.riding=null;return{leave:station.id,point}
    }
    const train=this.nearby(player,sample);if(!train)return null
    this.riding=train;return{board:true}
  }
  prompt(player,sample){
    const train=this.riding??this.nearby(player,sample)
    if(this.riding)return train.station?`${train.station.name} · 扉が開いたら降車できます`:`次は ${train.next.name} · 約${Math.ceil(train.arrivalIn)}秒`
    if(train)return `${train.station.name} · 発車まで${Math.ceil(train.departureIn)}秒`
    const station=this.data.stations.find(s=>s.band===sample.band)
    const x=station.entry[0]-sample.band*Math.PI*2/3*3200-sample.anchor.local[0],y=station.entry[1]-sample.anchor.local[1]
    return Math.hypot(player.x-x,player.y-y)<25?'車両の端側のスロープからホームへ。扉の前で乗車できます。':'終端側の端部連絡口から、三帯連絡線に乗れます。'
  }
}
