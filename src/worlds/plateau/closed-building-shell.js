// Certify only closed, consistently wound, positive-volume components. Open
// source surfaces, inward shells and non-manifold edges keep both faces.
// Work is bounded and runs once in the tile worker, before curved refinement.
export const MAX_SHELL_TRIANGLES = 150_000

export function closedBuildingShells({position:p,index:idx}) {
  const count=p.length/3
  if(!count||idx.length/3>MAX_SHELL_TRIANGLES)return null
  const parent=Uint32Array.from({length:count},(_,i)=>i),edges=new Map()
  const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i]}return i}
  const join=(a,b)=>{a=root(a);b=root(b);if(a!==b)parent[b]=a}
  for(let i=0;i<idx.length;i+=3){
    const a=idx[i],b=idx[i+1],c=idx[i+2]
    if(a>=count||b>=count||c>=count)return null
    join(a,b);join(a,c)
    for(const [u,v] of [[a,b],[b,c],[c,a]]){
      const key=Math.min(u,v)*count+Math.max(u,v),sign=u<v?1:-1
      edges.set(key,edges.has(key)?edges.get(key)===-sign?0:2:sign)
    }
  }
  const bad=new Uint8Array(count),volume=new Float64Array(count),bounds=new Map()
  for(const [edge,state] of edges)if(state!==0)bad[root(Math.floor(edge/count))]=1
  for(let i=0;i<idx.length;i+=3){
    const a=idx[i],b=idx[i+1],c=idx[i+2],r=root(a),o=r*3
    const ax=p[a*3]-p[o],ay=p[a*3+1]-p[o+1],az=p[a*3+2]-p[o+2]
    const bx=p[b*3]-p[o],by=p[b*3+1]-p[o+1],bz=p[b*3+2]-p[o+2]
    const cx=p[c*3]-p[o],cy=p[c*3+1]-p[o+1],cz=p[c*3+2]-p[o+2]
    volume[r]+=ax*(by*cz-bz*cy)+ay*(bz*cx-bx*cz)+az*(bx*cy-by*cx)
    if(a===b||b===c||c===a)bad[r]=1
  }
  const mask=new Uint8Array(count)
  for(let i=0;i<count;i++){
    const r=root(i)
    if(bad[r]||!Number.isFinite(volume[r])||volume[r]<=1e-6)continue
    mask[i]=1
    let b=bounds.get(r)
    if(!b){b=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];bounds.set(r,b)}
    for(let k=0;k<3;k++){b[k]=Math.min(b[k],p[i*3+k]);b[k+3]=Math.max(b[k+3],p[i*3+k])}
  }
  return bounds.size?{mask,bounds:new Float32Array([...bounds.values()].flat())}:null
}

// A camera inside a certified volume still needs the original interior faces.
// Bounds are deliberately conservative; concavities can reduce the saving but
// never justify hiding a face. Pad beyond the 8 mm cylinder refinement error.
export function outsideShellBounds(bounds,x,y,z,padding=.05){
  for(let i=0;i<bounds.length;i+=6)if(x>=bounds[i]-padding&&x<=bounds[i+3]+padding&&
    y>=bounds[i+1]-padding&&y<=bounds[i+4]+padding&&z>=bounds[i+2]-padding&&z<=bounds[i+5]+padding)return false
  return true
}
