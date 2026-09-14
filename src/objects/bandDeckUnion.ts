import { elevatedRoadMesh, type BandMesh, type BandVertex, type ElevatedRoad } from './bandElevation'
import { intersectStreetPolygons, polygonArea, positivePolygon, subtractStreetPolygon, type StreetPolygon, type StreetVertex } from './streetPolygon'

export type OwnedDeckPiece={road:string;polygon:StreetPolygon}
export type DeckBoundary={road:string;from:BandVertex;to:BandVertex}
type Box={x0:number;x1:number;y0:number;y1:number}
const EPS=1e-6
const bounds=(p:StreetPolygon):Box=>({x0:Math.min(...p.map(v=>v.x)),x1:Math.max(...p.map(v=>v.x)),y0:Math.min(...p.map(v=>v.y)),y1:Math.max(...p.map(v=>v.y))})
const keys=(b:Box)=>{const out:string[]=[];for(let x=Math.floor((b.x0-EPS)/32);x<=Math.floor((b.x1+EPS)/32);x++)for(let y=Math.floor((b.y0-EPS)/32);y<=Math.floor((b.y1+EPS)/32);y++)out.push(`${x}:${y}`);return out}
const overlap=(a:Box,b:Box)=>a.x0<b.x1&&a.x1>b.x0&&a.y0<b.y1&&a.y1>b.y0
const snap=(n:number)=>Math.round(n/EPS)*EPS
const key=(p:StreetVertex)=>[p.x,p.y,p.u,p.v].map(n=>Math.round(n/EPS)).join(':')
const interpolate=(a:StreetVertex,b:StreetVertex,t:number):StreetVertex=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,u:a.u+(b.u-a.u)*t,v:a.v+(b.v-a.v)*t})
function cleanPolygon(input:StreetPolygon) {
  const p=input.filter((v,i)=>key(v)!==key(input[(i+input.length-1)%input.length]))
  for(let i=p.length-1;i>=0&&p.length>=3;i--){
    const a=p[(i+p.length-1)%p.length],b=p[i],c=p[(i+1)%p.length]
    if(Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))<=EPS*Math.hypot(c.x-a.x,c.y-a.y))p.splice(i,1)
  }
  return p.length>=3&&polygonArea(p)>1e-8?p:[]
}
function removeSpikes(input:StreetPolygon) {
  let p=input
  for(let changed=true;changed;){
    changed=false
    for(let i=0;i<p.length&&!changed;i++)for(let j=i+1;j<p.length;j++)if(key(p[i])===key(p[j])){
      const a=p.slice(i,j),b=[...p.slice(j),...p.slice(0,i)]
      if(Math.abs(polygonArea(a))<1e-8){p=b;changed=true;break}
      if(Math.abs(polygonArea(b))<1e-8){p=a;changed=true;break}
    }
  }
  return p
}
const plane=(f:StreetPolygon,p:StreetVertex,field:'u'|'v')=>{
  const [a,b,c]=f,den=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)
  return a[field]+((p.x-a.x)*(c.y-a.y)-(p.y-a.y)*(c.x-a.x))/den*(b[field]-a[field])+((b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x))/den*(c[field]-a[field])
}

/** Own each coplanar merge once, using explicit graph joins. A coincident XY
 * crossing is never enough. Both top and underside must agree, within one
 * micrometre, inside the same 60m join extent used by the clearance audit.
 * Heights and graph connectivity are not changed to make a join pass. Shared
 * endpoint XY vertices may weld by at most 0.1mm to regularize microscopic
 * slivers where independently sampled, almost straight ribbons meet.
 * Polygon u/v carry top/bottom heights through clipping, not texture UVs. */
export function buildJoinedBandDecks(input:readonly ElevatedRoad[]) {
  if(input.some(r=>!Number.isFinite(r.width)||r.width<=0||!Number.isFinite(r.depth)||r.depth<=0||r.samples.length<2||r.samples.some(p=>!p.every(Number.isFinite)||p[2]<=0)))throw Error('Invalid deck dimensions or samples')
  if(new Set(input.map(r=>r.id)).size!==input.length)throw Error('Duplicate deck road identity')
  const roads=[...input].sort((a,b)=>b.width-a.width||a.id.localeCompare(b.id)),byId=new Map(roads.map(r=>[r.id,r]))
  const shared=new Map<string,BandVertex[]>()
  const joins=(a:string,b:string)=>{
    const k=[a,b].sort().join('\n');let out=shared.get(k)
    if(!out){const r=byId.get(a)!,s=byId.get(b)!;out=[r.from,r.to].filter(n=>n===s.from||n===s.to).map(n=>r.samples[n===r.from?0:r.samples.length-1]);shared.set(k,out)}return out
  }
  const localJoin=(a:string,b:string,p:StreetPolygon)=>joins(a,b).some(n=>p.every(v=>Math.hypot(n[0]-v.x,n[1]-v.y)<=60+EPS))
  const weld=.0001,weldGrid=new Map<string,{road:string;p:StreetVertex}[]>();let maximumWeld=0,weldAreaChange=0
  const weldVertex=(road:string,p:StreetVertex)=>{
    const x=Math.floor(p.x/weld),y=Math.floor(p.y/weld)
    for(let i=x-1;i<=x+1;i++)for(let j=y-1;j<=y+1;j++)for(const old of weldGrid.get(`${i}:${j}`)??[]){
      const d=Math.hypot(p.x-old.p.x,p.y-old.p.y)
      if(d<=weld&&Math.abs(p.u-old.p.u)<=EPS&&Math.abs(p.v-old.p.v)<=EPS&&(road===old.road||localJoin(road,old.road,[p,old.p]))){maximumWeld=Math.max(maximumWeld,d);return {...p,x:old.p.x,y:old.p.y}}
    }
    const k=`${x}:${y}`,row=weldGrid.get(k)??[];row.push({road,p});weldGrid.set(k,row);return p
  }
  type Face={road:string;polygon:StreetPolygon;box:Box}
  const faces:Face[]=[],grid=new Map<string,number[]>(),pieces:OwnedDeckPiece[]=[],mergedPairs=new Set<string>()
  let originalArea=0,removedArea=0
  for(const r of roads){
    const mesh=elevatedRoadMesh(r)
    for(let i=0;i<mesh.indices.length;i+=3){
      const source=positivePolygon(mesh.indices.slice(i,i+3).map(j=>{const [x,y,h]=mesh.vertices[j];return{x,y,u:h,v:Math.max(0,h-r.depth)}}))
      const polygon=positivePolygon(source.map(p=>weldVertex(r.id,p))),box=bounds(polygon)
      originalArea+=polygonArea(source);weldAreaChange+=polygonArea(polygon)-polygonArea(source)
      let owned=[polygon]
      for(const j of new Set(keys(box).flatMap(k=>grid.get(k)??[]))){
        const f=faces[j];if(f.road===r.id||!overlap(box,f.box)||!joins(r.id,f.road).length)continue
        const clip=intersectStreetPolygons(polygon,f.polygon)
        if(!clip.length||!localJoin(r.id,f.road,clip)||!clip.every(p=>Math.abs(p.u-plane(f.polygon,p,'u'))<=EPS&&Math.abs(p.v-plane(f.polygon,p,'v'))<=EPS))continue
        const next=owned.flatMap(p=>subtractStreetPolygon(p,f.polygon))
        const removed=owned.reduce((n,p)=>n+polygonArea(p),0)-next.reduce((n,p)=>n+polygonArea(p),0)
        if(removed>1e-8){removedArea+=removed;mergedPairs.add([r.id,f.road].sort().join('\n'))}owned=next
      }
      for(const p of owned){const polygon=cleanPolygon(p);if(polygon.length)pieces.push({road:r.id,polygon})}
      const index=faces.length;faces.push({road:r.id,polygon,box});for(const k of keys(box)){const row=grid.get(k)??[];row.push(index);grid.set(k,row)}
    }
  }
  // Clipping creates T vertices on neighbouring pieces. Split every matching
  // edge before triangulating; otherwise extrusion leaves internal end walls
  // and a visually closed top still has topological cracks.
  type Edge={piece:number;a:StreetVertex;b:StreetVertex;cuts:number[]}
  const edges:Edge[]=[],edgeGrid=new Map<string,number[]>(),pieceEdges:number[][]=[]
  pieces.forEach((p,pi)=>{
    const row:number[]=[];pieceEdges.push(row)
    p.polygon.forEach((a,i)=>{
      const b=p.polygon[(i+1)%p.polygon.length],box=bounds([a,b]),index=edges.length,e:Edge={piece:pi,a,b,cuts:[0,1]},dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)
      for(const j of new Set(keys(box).flatMap(k=>edgeGrid.get(k)??[]))){
        const f=edges[j],other=pieces[f.piece].road
        if(p.road!==other&&!localJoin(p.road,other,[a,b,f.a,f.b]))continue
        if(Math.abs(dx*(f.a.y-a.y)-dy*(f.a.x-a.x))>EPS*len||Math.abs(dx*(f.b.y-a.y)-dy*(f.b.x-a.x))>EPS*len)continue
        const t0=((f.a.x-a.x)*dx+(f.a.y-a.y)*dy)/(len*len),t1=((f.b.x-a.x)*dx+(f.b.y-a.y)*dy)/(len*len)
        if(Math.min(t0,t1)>1+EPS||Math.max(t0,t1)<-EPS)continue
        if(![t0,t1].every((t,k)=>{const v=interpolate(a,b,t),q=k?f.b:f.a;return Math.abs(v.u-q.u)<=EPS&&Math.abs(v.v-q.v)<=EPS}))continue
        for(const t of [t0,t1])if(t>EPS/len&&t<1-EPS/len)e.cuts.push(t)
        for(const t of [0,1]){const u=(t-t0)/(t1-t0);if(u>EPS/Math.hypot(f.b.x-f.a.x,f.b.y-f.a.y)&&u<1-EPS/Math.hypot(f.b.x-f.a.x,f.b.y-f.a.y))f.cuts.push(u)}
      }
      row.push(index);edges.push(e);for(const k of keys(box)){const list=edgeGrid.get(k)??[];list.push(index);edgeGrid.set(k,list)}
    })
  })
  const mesh:BandMesh={vertices:[],indices:[]},top:BandMesh={vertices:mesh.vertices,indices:[]},vertexIds=new Map<string,number>(),ownedIndices=new Map<string,number[]>(),boundaryEdges=new Map<string,{a:StreetVertex;b:StreetVertex;road:string;count:number}>()
  const vertex=(p:BandVertex)=>{const k=p.map(n=>Math.round(n/EPS)).join(':');let id=vertexIds.get(k);if(id===undefined){id=mesh.vertices.length;vertexIds.set(k,id);mesh.vertices.push(p.map(snap) as BandVertex)}return id}
  const triangle=(road:string,a:BandVertex,b:BandVertex,c:BandVertex,isTop=false)=>{
    const indices=[vertex(a),vertex(b),vertex(c)];if(new Set(indices).size<3)return
    mesh.indices.push(...indices);if(isTop)top.indices.push(...indices)
    const list=ownedIndices.get(road)??[];list.push(...indices);ownedIndices.set(road,list)
  }
  const topVertex=(p:StreetVertex):BandVertex=>[p.x,p.y,p.u],bottomVertex=(p:StreetVertex):BandVertex=>[p.x,p.y,p.v]
  const conformed=pieces.map((p,pi)=>{
    const polygon=removeSpikes(pieceEdges[pi].flatMap(i=>{const e=edges[i];return [...new Set(e.cuts)].sort((a,b)=>a-b).slice(0,-1).map(t=>interpolate(e.a,e.b,t))})
      .filter((v,i,arr)=>i===0||key(v)!==key(arr[i-1])))
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length],k=[key(a),key(b)].sort().join('|'),old=boundaryEdges.get(k)
      if(old)old.count++;else boundaryEdges.set(k,{a,b,road:p.road,count:1})
    }
    const triangles:StreetVertex[][]=polygon.length===3?[polygon]:polygon.map((a,i)=>[
      polygon.reduce((c,v)=>({x:c.x+v.x/polygon.length,y:c.y+v.y/polygon.length,u:c.u+v.u/polygon.length,v:c.v+v.v/polygon.length}),{x:0,y:0,u:0,v:0}),a,polygon[(i+1)%polygon.length]])
    for(const [a,b,c] of triangles){triangle(p.road,topVertex(a),topVertex(b),topVertex(c),true);triangle(p.road,bottomVertex(a),bottomVertex(c),bottomVertex(b))}
    return {road:p.road,polygon}
  })
  const boundary:DeckBoundary[]=[]
  for(const e of boundaryEdges.values())if(e.count===1){
    const a=topVertex(e.a),b=topVertex(e.b),c=bottomVertex(e.a),d=bottomVertex(e.b)
    boundary.push({road:e.road,from:a,to:b});triangle(e.road,a,c,b);triangle(e.road,b,c,d)
  }
  const compact=(indices:number[]):BandMesh=>{
    const ids=new Map<number,number>(),vertices:BandVertex[]=[]
    return {vertices,indices:indices.map(i=>{let next=ids.get(i);if(next===undefined){next=vertices.length;vertices.push(mesh.vertices[i]);ids.set(i,next)}return next})}
  }
  return {mesh,top,pieces:conformed,boundary,parts:roads.map(r=>({road:r.id,mesh:compact(ownedIndices.get(r.id)??[])})),
    boundaryIssues:[...boundaryEdges.values()].filter(e=>e.count>2),
    stats:{sourceTriangles:faces.length,topTriangles:top.indices.length/3,solidTriangles:mesh.indices.length/3,originalArea,removedArea,weldAreaChange,maximumWeld,ownedArea:conformed.reduce((n,p)=>n+polygonArea(p.polygon),0),mergedPairs:[...mergedPairs].map(k=>k.split('\n')),nonManifoldBoundaries:[...boundaryEdges.values()].filter(e=>e.count>2).length}}
}
