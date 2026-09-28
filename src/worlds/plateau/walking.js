// Planar queries in source metres. Only the visible pose is mapped onto the cylinder.
const CELL=24, RADIUS=.28, SKIN=.025
export function insideRing(x,y,ring){
  let inside=false
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j]
    if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside
  }
  return inside
}
export function insideShape(x,y,shape){return insideRing(x,y,shape.rings[0])&&!shape.rings.slice(1).some(r=>insideRing(x,y,r))}
export function segmentDistance(x,y,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],d=dx*dx+dy*dy,t=d?Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/d)):0
  return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy)
}
function supportHeight(x,y,{a,b,c}){
  const dx=b[0]-a[0],dy=b[1]-a[1],ex=c[0]-a[0],ey=c[1]-a[1],det=dx*ey-dy*ex
  if(Math.abs(det)<1e-10)return -Infinity
  const u=((x-a[0])*ey-(y-a[1])*ex)/det,v=(dx*(y-a[1])-dy*(x-a[0]))/det
  return u>=-1e-7&&v>=-1e-7&&u+v<=1.0000001?a[2]+u*(b[2]-a[2])+v*(c[2]-a[2]):-Infinity
}
export class SpatialIndex{
  constructor(shapes){
    this.shapes=shapes;this.cells=new Map()
    for(let id=0;id<shapes.length;id++){
      const [a,b,c,d]=shapes[id].bounds
      for(let x=Math.floor(a/CELL);x<=Math.floor(c/CELL);x++)for(let y=Math.floor(b/CELL);y<=Math.floor(d/CELL);y++){
        const key=`${x},${y}`;if(!this.cells.has(key))this.cells.set(key,[]);this.cells.get(key).push(id)
      }
    }
  }
  query(x,y,r=0){
    const ids=new Set()
    for(let i=Math.floor((x-r)/CELL);i<=Math.floor((x+r)/CELL);i++)for(let j=Math.floor((y-r)/CELL);j<=Math.floor((y+r)/CELL);j++)for(const id of this.cells.get(`${i},${j}`)??[])ids.add(id)
    return Array.from(ids,id=>this.shapes[id])
  }
}
export class WalkWorld{
  constructor(data){this.data=data;this.buildings=new SpatialIndex(data.buildings);this.water=new SpatialIndex(data.water);this.obstacles=new SpatialIndex(data.obstacles??[]);this.roads=new SpatialIndex(data.roads);this.pavements=new SpatialIndex(data.pavements??[]);this.lastCandidateCount=0
    const triangles=[]
    for(const support of data.heightSupports??[])for(let i=0;i<support.indices.length;i+=3){const [a,b,c]=support.indices.slice(i,i+3).map(j=>support.vertices[j]);triangles.push({a,b,c,bounds:[Math.min(a[0],b[0],c[0]),Math.min(a[1],b[1],c[1]),Math.max(a[0],b[0],c[0]),Math.max(a[1],b[1],c[1])]})}
    this.supports=new SpatialIndex(triangles)
  }
  terrain(x,y){
    const d=this.data.heightPatches?.find(p=>x>=p.bounds[0]&&x<=p.bounds[2]&&y>=p.bounds[1]&&y<=p.bounds[3])??this.data,n=d.axis.length,origin=d.terrainOrigin??[-d.half,-d.half],u=(x-origin[0])/d.step,v=(y-origin[1])/d.step
    const i=Math.max(0,Math.min(n-2,Math.floor(u))),j=Math.max(0,Math.min(d.heights.length-2,Math.floor(v))),a=u-i,b=v-j
    const z00=d.heights[j][i],z10=d.heights[j][i+1],z01=d.heights[j+1][i],z11=d.heights[j+1][i+1]
    return a>=b?z00+a*(z10-z00)+b*(z11-z10):z00+b*(z01-z00)+a*(z11-z01)
  }
  ground(x,y){let height=this.terrain(x,y)+(this.pavements.query(x,y).some(p=>insideShape(x,y,p))?.20:this.roads.query(x,y).some(p=>insideShape(x,y,p))?.09:.035)
    for(const triangle of this.supports.query(x,y))height=Math.max(height,supportHeight(x,y,triangle));return height
  }
  blocked(x,y,r=RADIUS){
    const b=this.data.bounds??[-this.data.half,-this.data.half,this.data.half,this.data.half]
    if(x<b[0]+r+.1||x>b[2]-r-.1||y<b[1]+r+.1||y>b[3]-r-.1)return true
    const candidates=[...this.buildings.query(x,y,r),...this.water.query(x,y,r),...this.obstacles.query(x,y,r)];this.lastCandidateCount=candidates.length
    for(const shape of candidates){
      if(insideShape(x,y,shape))return true
      for(const ring of shape.rings)for(let i=1;i<ring.length;i++)if(segmentDistance(x,y,ring[i-1],ring[i])<r+SKIN)return true
    }
    return false
  }
  move(state,dx,dy){
    const distance=Math.hypot(dx,dy),steps=Math.max(1,Math.ceil(distance/.12));let rejected=0
    // A tab resuming after a long pause must not jump across the city or consume unbounded work.
    if(steps>64)return{...state,rejected:1}
    let {x,y}=state
    const valid=(nx,ny)=>!this.blocked(nx,ny)&&Math.abs(this.ground(nx,ny)-this.ground(x,y))<=.22+Math.hypot(nx-x,ny-y)*.7
    for(let i=0;i<steps;i++){
      const sx=dx/steps,sy=dy/steps
      if(valid(x+sx,y+sy)){x+=sx;y+=sy}
      else if(valid(x+sx,y)){x+=sx;rejected++}
      else if(valid(x,y+sy)){y+=sy;rejected++}
      else rejected++
    }
    return {...state,x,y,h:this.ground(x,y),rejected}
  }
  spawn(){const [x,y]=this.data.arrival.spawn;if(this.blocked(x,y))throw Error('Unsafe walking arrival');return{x,y,h:this.ground(x,y),yaw:this.data.arrival.yaw,pitch:0,rejected:0}}
}
