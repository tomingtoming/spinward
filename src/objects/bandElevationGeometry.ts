import * as THREE from 'three'
import { bandRiverCentre, proposedBandRiver } from './bandLand'
import { BAND_LEVELS, bandBankHeight, bandRoadHeight, elevatedRoadMesh, type BandMesh, type BandVertex, type ElevatedRoad } from './bandElevation'
import { clipStreetPolygon } from './streetPolygon'
import type { StreetSurface } from './streetSurfacePlan'

class MeshBuilder {
  mesh:BandMesh={vertices:[],indices:[]}
  private keys=new Map<string,number>()
  vertex(p:BandVertex) {
    const key=p.map(n=>Math.round(n*1e6)).join(':');let i=this.keys.get(key)
    if(i===undefined){i=this.mesh.vertices.length;this.keys.set(key,i);this.mesh.vertices.push(p)}return i
  }
  triangle(a:BandVertex,b:BandVertex,c:BandVertex) {
    const u=b.map((n,i)=>n-a[i]),v=c.map((n,i)=>n-a[i])
    if(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])<1e-8)return
    this.mesh.indices.push(this.vertex(a),this.vertex(b),this.vertex(c))
  }
  quad(a:BandVertex,b:BandVertex,c:BandVertex,d:BandVertex){this.triangle(a,b,c);this.triangle(a,c,d)}
}

/** Closed soil above the hull, including the bed and vertical retaining faces.
 * All source bends and bank-height breaks are retained. Chords are at most 10m
 * across the cylinder; the QA/LOD budget is independent of rendering distance. */
export function buildBandRiverMeshes(fromY:number,toY:number,step=20) {
  if(!Number.isFinite(step)||step<=0||!(toY>fromY))throw Error('Invalid river mesh interval')
  bandRiverCentre(fromY);bandRiverCentre(toY)
  const breaks=[fromY,...proposedBandRiver().map(p=>p[1]).filter(y=>y>fromY&&y<toY),toY],stations:number[]=[]
  for(let i=1;i<breaks.length;i++){
    const a=breaks[i-1],b=breaks[i],n=Math.ceil((b-a)/step)
    for(let j=0;j<n;j++)stations.push(a+(b-a)*j/n)
  }
  stations.push(toY)
  const ramp=Array.from({length:14},(_,i)=>30+125*i/13)
  const section:[number,number][]=[...ramp.slice().reverse().map(d=>[-d,bandBankHeight(d)] as [number,number]),
    [-18,5],[-18,1.2],[-9.5,1.2],[-9.5,.12],[0,.12],[9.5,.12],[9.5,1.2],[18,1.2],[18,5],
    ...ramp.map(d=>[d,bandBankHeight(d)] as [number,number])]
  const soil=new MeshBuilder(),water=new MeshBuilder(),walks=new MeshBuilder(),grass=new MeshBuilder()
  const row=(y:number)=>section.map(([d,h])=>[bandRiverCentre(y)+d,y,h] as BandVertex)
  const strip=(builder:MeshBuilder,y0:number,y1:number,d0:number,d1:number,height:(d:number)=>number)=>{
    const a=bandRiverCentre(y0),b=bandRiverCentre(y1)
    builder.quad([a+d0,y0,height(d0)],[a+d1,y0,height(d1)],[b+d1,y1,height(d1)],[b+d0,y1,height(d0)])
  }
  for(let k=1;k<stations.length;k++){
    const a=row(stations[k-1]),b=row(stations[k])
    for(let i=1;i<a.length;i++){
      soil.quad(a[i-1],a[i],b[i],b[i-1])
      const floor=(p:BandVertex):BandVertex=>[p[0],p[1],0]
      soil.quad(floor(a[i-1]),floor(b[i-1]),floor(b[i]),floor(a[i]))
    }
    strip(water,stations[k-1],stations[k],-9.5,9.5,()=>BAND_LEVELS.water)
    for(const sign of [-1,1]){
      strip(walks,stations[k-1],stations[k],sign*10,sign*17,()=>BAND_LEVELS.lowerWalk+.06)
      strip(walks,stations[k-1],stations[k],sign*20,sign*28,()=>BAND_LEVELS.bank+.06)
      for(let i=1;i<ramp.length;i++)strip(grass,stations[k-1],stations[k],sign*ramp[i-1],sign*ramp[i],d=>bandBankHeight(d)+.015)
    }
  }
  for(const [y,reverse] of [[fromY,false],[toY,true]] as const){
    const r=row(y)
    for(let i=1;i<r.length;i++){
      const a=r[i-1],b=r[i]
      if(b[0]-a[0]<1e-6)continue
      // Split the cap at both heights of a retaining wall; otherwise a long
      // cap edge spans several wall edges and leaves a topological T junction.
      const cuts=(p:BandVertex)=>[...new Set(r.filter(q=>Math.abs(q[0]-p[0])<1e-6&&q[2]>0&&q[2]<p[2]).map(q=>q[2]))].sort((a,b)=>a-b)
      const boundary:BandVertex[]=[a,b,...cuts(b).reverse().map(h=>[b[0],y,h] as BandVertex),[b[0],y,0],[a[0],y,0],...cuts(a).map(h=>[a[0],y,h] as BandVertex)]
      const centre:BandVertex=[(a[0]+b[0])/2,y,(a[2]+b[2])/4]
      for(let j=0;j<boundary.length;j++){
        const p=boundary[j],q=boundary[(j+1)%boundary.length]
        if(reverse)soil.triangle(centre,q,p);else soil.triangle(centre,p,q)
      }
    }
  }
  return {soil:soil.mesh,water:water.mesh,walks:walks.mesh,grass:grass.mesh}
}

/** Retopologize the owned road polygons before raising their vertices. A long
 * triangle must not cut across the entire bridge's rising and falling grade. */
export function buildBandPavement(surfaces:readonly StreetSurface[],bridgeIds:Set<string>,step=5):BandMesh {
  if(!Number.isFinite(step)||step<=0)throw Error('Invalid pavement tessellation')
  const out=new MeshBuilder()
  for(const surface of surfaces){
    const s=surface,bridge=bridgeIds.has(s.source.id),p=s.polygon
    const minX=Math.min(...p.map(v=>v.x)),maxX=Math.max(...p.map(v=>v.x)),nx=Math.max(1,Math.ceil((maxX-minX)/step))
    for(let i=0;i<nx;i++){
      const lo=minX+(maxX-minX)*i/nx,hi=minX+(maxX-minX)*(i+1)/nx
      const strip=clipStreetPolygon(clipStreetPolygon(p,1,0,-lo),-1,0,hi);if(!strip.length)continue
      const minY=Math.min(...strip.map(v=>v.y)),maxY=Math.max(...strip.map(v=>v.y)),ny=Math.max(1,Math.ceil((maxY-minY)/step))
      for(let j=0;j<ny;j++){
        const a=minY+(maxY-minY)*j/ny,b=minY+(maxY-minY)*(j+1)/ny
        const piece=clipStreetPolygon(clipStreetPolygon(strip,0,1,-a),0,-1,b)
        const vertices=piece.map(v=>[v.x,v.y,bandRoadHeight([v.x,v.y],bridge)+s.lift-.2] as BandVertex)
        for(let k=2;k<vertices.length;k++)out.triangle(vertices[0],vertices[k-1],vertices[k])
      }
    }
  }
  return out.mesh
}

/** Extrude only boundary edges; the audit and rendering share the same top. */
export function solidBandDeck(top:BandMesh,depth:number):BandMesh {
  if(!Number.isFinite(depth)||depth<=0)throw Error('Invalid deck depth')
  const n=top.vertices.length,vertices=[...top.vertices,...top.vertices.map(p=>[p[0],p[1],p[2]-depth] as BandVertex)],indices=[...top.indices]
  const edges=new Map<string,{a:number;b:number;count:number}>()
  for(let i=0;i<top.indices.length;i+=3){
    const [a,b,c]=top.indices.slice(i,i+3);indices.push(a+n,c+n,b+n)
    for(const [ea,eb] of [[a,b],[b,c],[c,a]]){const key=ea<eb?`${ea}:${eb}`:`${eb}:${ea}`,old=edges.get(key);if(old)old.count++;else edges.set(key,{a:ea,b:eb,count:1})}
  }
  for(const {a,b,count} of edges.values())if(count===1)indices.push(a,a+n,b,b,a+n,b+n)
  return {vertices,indices}
}

export function buildExpresswayDeck(road:ElevatedRoad){return solidBandDeck(elevatedRoadMesh(road),road.depth)}

export function bandMeshGeometry(mesh:BandMesh,radius=3200) {
  const position=mesh.vertices.flatMap(([x,y,h])=>{const a=x/radius;return [Math.cos(a)*(radius-h),y,Math.sin(a)*(radius-h)]})
  const g=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(position,3)).setIndex(mesh.indices)
  g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();return g
}
