// Partition existing PLATEAU meshes; never regenerate footprints or acquire new data.
// meshoptimizer 0.22.0 is pinned by the repository's @types/three dependency.
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {gzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import * as T from 'three'
import {MeshoptSimplifier as simplify} from 'meshoptimizer'
import {packTile} from '../../qa/plateau/tile-format.js'
const streamFar=process.env.PLATEAU_FAR_STREAM==='1'
const bandOverview=process.env.PLATEAU_BAND_OVERVIEW==='1'
const root=path.resolve(process.argv[2]??fileURLToPath(new URL('../../qa/webxr/evidence/plateau-transfer-20260922/derived',import.meta.url)))
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p))),study=read('study.json')
const colourSnapshot=new Map(study.samples.map(s=>[s.id,s.facadeSites?read(s.facadeSites).bodyColours:{}]))
const size=200,report={tileSizeM:size,regions:[],sourceTriangles:0,farTriangles:0,nearBytes:0,farBytes:0,buildings:0}
fs.mkdirSync(path.join(root,'base-tiles'),{recursive:true})
await simplify.ready
function weld(p,indices){
  const map=new Map(),vertices=[],out=[]
  for(const i of indices){const v=Array.from(p.subarray(i*3,i*3+3)),key=v.join(',');let n=map.get(key)
    if(n===undefined){n=vertices.length/3;map.set(key,n);vertices.push(...v)}out.push(n)
  }
  return{p:Float32Array.from(vertices),i:Uint32Array.from(out)}
}
function compact(attributes,indices){
  // Include normals/colours in the key: welding a roof to a wall must not smooth it.
  const keys=Object.keys(attributes),map=new Map(),out=Object.fromEntries(keys.map(k=>[k,[]])),idx=[]
  for(const i of indices){const key=keys.map(k=>Array.from(attributes[k].subarray(i*3,i*3+3)).join(',')).join(';');let n=map.get(key)
    if(n===undefined){n=map.size;map.set(key,n);for(const k of keys)out[k].push(...attributes[k].subarray(i*3,i*3+3))}idx.push(n)
  }
  return{...Object.fromEntries(keys.map(k=>[k,Float32Array.from(out[k])])),index:Uint32Array.from(idx)}
}
function normals(p,i){const g=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(p,3));g.setIndex(new T.BufferAttribute(i,1));g.computeVertexNormals();return g.attributes.normal.array}
function emit(name,meshes){const raw=packTile(meshes),gzip=gzipSync(raw,{level:9}),file='base-tiles/'+name+'.bin.gz';fs.writeFileSync(path.join(root,file),gzip);return{path:file,bytes:gzip.length,decodedBytes:raw.byteLength,sha256:createHash('sha256').update(raw).digest('hex')}}
function orientedFootprint(position,indices){
  const seen=new Map();for(const i of indices){const x=position[i*3],y=position[i*3+1];seen.set(x+','+y,[x,y])}
  const points=[...seen.values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]),cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
  const chain=list=>{const out=[];for(const point of list){while(out.length>1&&cross(out.at(-2),out.at(-1),point)<=0)out.pop();out.push(point)}return out}
  const hull=[...chain(points).slice(0,-1),...chain([...points].reverse()).slice(0,-1)];let best=null
  for(let i=0;i<hull.length;i++){
    const a=hull[i],b=hull[(i+1)%hull.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!length)continue
    const ux=(b[0]-a[0])/length,uy=(b[1]-a[1])/length,projected=hull.map(p=>[p[0]*ux+p[1]*uy,-p[0]*uy+p[1]*ux]),lo=[Infinity,Infinity],hi=[-Infinity,-Infinity]
    for(const p of projected)for(let k=0;k<2;k++){lo[k]=Math.min(lo[k],p[k]);hi[k]=Math.max(hi[k],p[k])}
    const area=(hi[0]-lo[0])*(hi[1]-lo[1]);if(best&&best.area<=area)continue
    best={area,points:[[lo[0],lo[1]],[hi[0],lo[1]],[hi[0],hi[1]],[lo[0],hi[1]]].map(([x,y])=>[x*ux-y*uy,x*uy+y*ux])}
  }
  if(!best)throw Error('Degenerate building footprint');return best.points
}
for(const sample of study.samples){
  const colours=colourSnapshot.get(sample.id)
  const tiles=new Map(),features=read(sample.features),farGroups=new Map(),audit={id:sample.id,buildings:features.length,sourceTriangles:0,farTriangles:0,sourceHashes:{},maxBuildingSimplifierErrorM:0}
  const skyline=new Map(),terrainOverview=[];audit.maxOverviewTerrainErrorM=0
  const domain=sample.bounds??[-sample.half,-sample.half,sample.half,sample.half]
  function tileFor(x,y){const nx=Math.ceil((domain[2]-domain[0])/size),ny=Math.ceil((domain[3]-domain[1])/size),ix=Math.max(0,Math.min(nx-1,Math.floor((x-domain[0])/size))),iy=Math.max(0,Math.min(ny-1,Math.floor((y-domain[1])/size))),id=ix+'-'+iy
    if(!tiles.has(id))tiles.set(id,{id,bounds:[ix*size+domain[0],iy*size+domain[1],Math.min(domain[2],(ix+1)*size+domain[0]),Math.min(domain[3],(iy+1)*size+domain[1])],heightRange:[Infinity,-Infinity],meshes:[],buildingIds:[]})
    return tiles.get(id)
  }
  for(const descriptor of sample.meshes.filter(m=>!m.name.startsWith('frontage-'))){
    const binary=name=>{const b=fs.readFileSync(path.join(root,descriptor.path,descriptor[name]));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}
    const p=new Float32Array(binary('positions')),indices=new Uint32Array(binary('indices')),normal=normals(p,indices),attributes={position:p,normal},buckets=new Map(),farBuckets=new Map()
    audit.sourceHashes[descriptor.name]=createHash('sha256').update(new Uint8Array(p.buffer)).update(new Uint8Array(indices.buffer)).digest('hex')
    const material={name:descriptor.name,colour:descriptor.material,roughness:descriptor.roughness??.96,solid:!!descriptor.solid}
    if(descriptor.name==='buildings'&&sample.facadeSites){
      attributes.color=new Float32Array(p.length);const base=new T.Color(descriptor.material);for(let j=0;j<p.length;j+=3)base.toArray(attributes.color,j)
      for(const f of features)if(colours[f.id]){const c=new T.Color(colours[f.id]);for(let j=f.firstIndex;j<f.firstIndex+f.indexCount;j++)c.toArray(attributes.color,indices[j]*3)}
    }
    function bucket(tile){if(!buckets.has(tile.id))buckets.set(tile.id,[]);return buckets.get(tile.id)}
    if(descriptor.name==='buildings'){
      for(const feature of features){
        const original=indices.subarray(feature.firstIndex,feature.firstIndex+feature.indexCount),low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity]
        for(const i of original)for(let a=0;a<3;a++){low[a]=Math.min(low[a],p[i*3+a]);high[a]=Math.max(high[a],p[i*3+a])}
        const tile=tileFor((low[0]+high[0])/2,(low[1]+high[1])/2);tile.buildingIds.push(feature.id);bucket(tile).push(...original)
        if(bandOverview){
          // Third level: one inexpensive source-bounds volume per building.
          // It remains only outside loaded exact-source far/near tiles, so an
          // entire 12 km city never turns into empty ground after budget culling.
          const footprint=orientedFootprint(p,original),bp=Float32Array.from([low[2],high[2]].flatMap(z=>footprint.flatMap(([x,y])=>[x,y,z])))
          const bi=Uint32Array.from([4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7]),bc=new Float32Array(24)
          const shade=attributes.color?.subarray(original[0]*3,original[0]*3+3)??new T.Color(descriptor.material).toArray()
          for(let k=0;k<24;k+=3)bc.set(shade,k)
          if(!skyline.has(tile.id))skyline.set(tile.id,[]);skyline.get(tile.id).push({position:bp,color:bc,index:bi})
        }
        // A whole source feature belongs to one tile, including components/holes.
        const welded=weld(p,original),[reduced,error]=simplify.simplify(welded.i,welded.p,3,Math.min(welded.i.length,Math.max(36,Math.floor(welded.i.length*.5/3)*3)),.05,['ErrorAbsolute','LockBorder'])
        audit.maxBuildingSimplifierErrorM=Math.max(audit.maxBuildingSimplifierErrorM,error)
        const fp=new Float32Array(reduced.length*3);for(let k=0;k<reduced.length;k++)fp.set(welded.p.subarray(reduced[k]*3,reduced[k]*3+3),k*3)
        const fi=Uint32Array.from({length:reduced.length},(_,i)=>i),fa={position:fp}
        if(attributes.color){fa.color=new Float32Array(fp.length);const c=attributes.color.subarray(original[0]*3,original[0]*3+3);for(let k=0;k<fp.length;k+=3)fa.color.set(c,k)}
        if(!farBuckets.has(tile.id))farBuckets.set(tile.id,[]);farBuckets.get(tile.id).push(compact(fa,fi))
      }
    }else{
      // Never clip a road triangle. Its complete source triangle has a single owner;
      // both LODs use it exactly, so mixed residency has no gap or double surface.
      for(let k=0;k<indices.length;k+=3){const tri=indices.subarray(k,k+3);let x=0,y=0;for(const i of tri){x+=p[i*3]/3;y+=p[i*3+1]/3}bucket(tileFor(x,y)).push(...tri)}
    }
    let owned=0
    for(const [id,list] of buckets){
      owned+=list.length;const tile=tiles.get(id),a=compact(attributes,list),mesh={...material,attributes:a};tile.meshes.push(mesh)
      for(let i=0;i<a.position.length;i+=3){tile.bounds[0]=Math.min(tile.bounds[0],a.position[i]);tile.bounds[1]=Math.min(tile.bounds[1],a.position[i+1]);tile.bounds[2]=Math.max(tile.bounds[2],a.position[i]);tile.bounds[3]=Math.max(tile.bounds[3],a.position[i+1]);tile.heightRange[0]=Math.min(tile.heightRange[0],a.position[i+2]);tile.heightRange[1]=Math.max(tile.heightRange[1],a.position[i+2])}
      const farAttributes=descriptor.name==='terrain'?a:compact(Object.fromEntries(Object.entries(a).filter(([key])=>key!=='normal'&&key!=='index')),a.index)
      if(bandOverview&&descriptor.name==='terrain'){
        const [reduced,error]=simplify.simplify(a.index,a.position,3,Math.max(96,Math.floor(a.index.length*.06/3)*3),.15,['ErrorAbsolute','LockBorder'])
        terrainOverview.push({tile:id,attributes:compact(Object.fromEntries(Object.entries(a).filter(([key])=>key!=='index')),reduced)})
        audit.maxOverviewTerrainErrorM=Math.max(audit.maxOverviewTerrainErrorM,error)
      }
      const pieces=farBuckets.get(id)??[farAttributes]
      if(!farGroups.has(material.name))farGroups.set(material.name,{...material,pieces:[]})
      farGroups.get(material.name).pieces.push({tile:id,attributes:merge(pieces)})
    }
    if(owned!==indices.length)throw Error('Missing source triangles: '+descriptor.name)
    audit.sourceTriangles+=indices.length/3
  }
  const far=[]
  for(const g of farGroups.values()){
    const segments=[];let first=0;for(const piece of g.pieces){segments.push({tile:piece.tile,first,count:piece.attributes.index.length});first+=piece.attributes.index.length}
    const {pieces,...material}=g;far.push({...material,segments,attributes:merge(pieces.map(p=>p.attributes))});audit.farTriangles+=first/3
  }
  const farTiles=[]
  if(streamFar){
    const chunks=new Map()
    for(const group of farGroups.values())for(const piece of group.pieces){
      const [x,y]=piece.tile.split('-').map(Number),id=Math.floor(x/3)+'-'+Math.floor(y/3)
      if(!chunks.has(id))chunks.set(id,new Map())
      const bucket=chunks.get(id);if(!bucket.has(group.name))bucket.set(group.name,{...group,pieces:[]})
      bucket.get(group.name).pieces.push(piece)
    }
    for(const [id,groups] of chunks){
      const meshes=[],owned=new Set(),bounds=[Infinity,Infinity,-Infinity,-Infinity],heightRange=[Infinity,-Infinity]
      for(const group of groups.values()){
        let first=0;const segments=group.pieces.map(p=>{owned.add(p.tile);const row={tile:p.tile,first,count:p.attributes.index.length};first+=row.count;return row})
        const {pieces,...material}=group;meshes.push({...material,segments,attributes:merge(pieces.map(p=>p.attributes))})
      }
      for(const tileId of owned){const t=tiles.get(tileId);for(let i=0;i<2;i++){bounds[i]=Math.min(bounds[i],t.bounds[i]);bounds[i+2]=Math.max(bounds[i+2],t.bounds[i+2])}heightRange[0]=Math.min(heightRange[0],t.heightRange[0]);heightRange[1]=Math.max(heightRange[1],t.heightRange[1])}
      farTiles.push({id,bounds,heightRange,tiles:[...owned],...emit(sample.id+'-far-'+id,meshes)})
    }
  }
  // A small source terrain fallback stays resident while view-dependent city chunks load.
  let overviewMeshes=streamFar?far.filter(m=>m.name==='terrain'):far
  if(bandOverview){
    const material=far.find(m=>m.name==='terrain');let first=0
    const segments=terrainOverview.map(p=>{const segment={tile:p.tile,first,count:p.attributes.index.length};first+=segment.count;return segment})
    overviewMeshes=[{name:'terrain',colour:material.colour,roughness:material.roughness,segments,attributes:merge(terrainOverview.map(p=>p.attributes))}]
    const groups=new Map()
    for(const [id,pieces] of skyline){const [x,y]=id.split('-').map(Number),key=Math.floor(x/6)+'-'+Math.floor(y/6);if(!groups.has(key))groups.set(key,[]);groups.get(key).push({tile:id,attributes:merge(pieces)})}
    for(const [id,pieces] of groups){let first=0;const segments=pieces.map(p=>{const row={tile:p.tile,first,count:p.attributes.index.length};first+=row.count;return row})
      overviewMeshes.push({name:'skyline-buildings',colour:'#ffffff',roughness:1,segments,attributes:merge(pieces.map(p=>p.attributes))})
    }
    audit.skylineProxyBuildings=features.length;audit.skylineProxyTriangles=features.length*10;audit.skylineProxyMethod='Minimum-area footprint prisms at original base/top heights; replaced by source geometry when the tile is resident';audit.overviewTerrainTriangles=terrainOverview.reduce((n,p)=>n+p.attributes.index.length/3,0)
  }
  const overview=emit(sample.id+'-far',overviewMeshes),manifest={version:streamFar?2:1,tileSizeM:size,overview,tiles:[],...(streamFar?{farTiles}:{})}
  for(const t of tiles.values()){const {meshes,...meta}=t;manifest.tiles.push({...meta,...emit(sample.id+'-'+t.id,meshes)})}
  const ids=manifest.tiles.flatMap(t=>t.buildingIds);if(ids.length!==features.length||new Set(ids).size!==features.length)throw Error('Building ownership mismatch')
  sample.baseTiles='base-tiles/'+sample.id+'.json';fs.writeFileSync(path.join(root,sample.baseTiles),JSON.stringify(manifest))
  audit.tiles=tiles.size;audit.nearBytes=manifest.tiles.reduce((n,t)=>n+t.bytes,0);audit.farBytes=overview.bytes+farTiles.reduce((n,t)=>n+t.bytes,0);audit.nearDecodedBytes=manifest.tiles.reduce((n,t)=>n+t.decodedBytes,0);audit.farDecodedBytes=overview.decodedBytes+farTiles.reduce((n,t)=>n+t.decodedBytes,0)
  report.regions.push(audit);for(const key of ['sourceTriangles','farTriangles','nearBytes','farBytes','buildings'])report[key]+=audit[key]
}
fs.writeFileSync(path.join(root,'study.json'),JSON.stringify(study));fs.writeFileSync(path.join(root,'../base-tiles-audit.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
function merge(pieces){
  const keys=Object.keys(pieces[0]).filter(k=>k!=='index'),vertices=pieces.reduce((n,p)=>n+p.position.length,0),index=new Uint32Array(pieces.reduce((n,p)=>n+p.index.length,0)),out=Object.fromEntries(keys.map(k=>[k,new Float32Array(vertices)]));let v=0,j=0
  for(const p of pieces){for(const k of keys)out[k].set(p[k],v);for(const i of p.index)index[j++]=i+v/3;v+=p.position.length}return{...out,index}
}
