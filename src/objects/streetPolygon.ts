/** Convex pavement pieces in surface metres. UVs follow every clipped vertex. */
export type StreetVertex = { x:number; y:number; u:number; v:number }
export type StreetPolygon = StreetVertex[]
const EPS=1e-8
export function polygonArea(p:StreetPolygon){
 if(p.length<3)return 0
 const a=p[0];let area=0
 for(let i=1;i<p.length-1;i++)area+=(p[i].x-a.x)*(p[i+1].y-a.y)-(p[i+1].x-a.x)*(p[i].y-a.y)
 return area/2
}
export function positivePolygon(p:StreetPolygon){return polygonArea(p)<0?[...p].reverse():p}
export function clipStreetPolygon(p:StreetPolygon,a:number,b:number,c:number):StreetPolygon{
 const out:StreetPolygon=[]
 for(let i=0;i<p.length;i++){
  const x=p[i],y=p[(i+1)%p.length],dx=a*x.x+b*x.y+c,dy=a*y.x+b*y.y+c
  if(dx>=-EPS)out.push(x)
  if((dx>EPS&&dy< -EPS)||(dx< -EPS&&dy>EPS)){
   const t=dx/(dx-dy);out.push({x:x.x+(y.x-x.x)*t,y:x.y+(y.y-x.y)*t,u:x.u+(y.u-x.u)*t,v:x.v+(y.v-x.v)*t})
  }
 }
 const clean=out.filter((p,i)=>i===0||Math.hypot(p.x-out[i-1].x,p.y-out[i-1].y)>EPS)
 if(clean.length>1&&Math.hypot(clean[0].x-clean.at(-1)!.x,clean[0].y-clean.at(-1)!.y)<EPS)clean.pop()
 return Math.abs(polygonArea(clean))>EPS?clean:[]
}
type Rect={x0:number;x1:number;y0:number;y1:number}
const rectangles=new WeakMap<StreetPolygon,Rect|null>()
function rectangle(p:StreetPolygon):Rect|null{
 if(rectangles.has(p))return rectangles.get(p)!
 let rect:Rect|null=null
 if(p.length===4){
  let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity
  for(const v of p){x0=Math.min(x0,v.x);x1=Math.max(x1,v.x);y0=Math.min(y0,v.y);y1=Math.max(y1,v.y)}
  if(x1>x0&&y1>y0&&p.every(v=>(v.x===x0||v.x===x1)&&(v.y===y0||v.y===y1)))rect={x0,x1,y0,y1}
 }
 rectangles.set(p,rect);return rect
}
function rectPiece(p:StreetPolygon,r:Rect,cut:Rect):StreetPolygon{
 const a=p.find(v=>v.x===r.x0&&v.y===r.y0)!,b=p.find(v=>v.x===r.x1&&v.y===r.y0)!,c=p.find(v=>v.x===r.x0&&v.y===r.y1)!
 const vertex=(x:number,y:number)=>{const sx=(x-r.x0)/(r.x1-r.x0),sy=(y-r.y0)/(r.y1-r.y0);return{x,y,u:a.u+(b.u-a.u)*sx+(c.u-a.u)*sy,v:a.v+(b.v-a.v)*sx+(c.v-a.v)*sy}}
 const out=[vertex(cut.x0,cut.y0),vertex(cut.x1,cut.y0),vertex(cut.x1,cut.y1),vertex(cut.x0,cut.y1)]
 rectangles.set(out,cut);return out
}
const rectIntersection=(a:Rect,b:Rect):Rect|null=>{
 const c={x0:Math.max(a.x0,b.x0),x1:Math.min(a.x1,b.x1),y0:Math.max(a.y0,b.y0),y1:Math.min(a.y1,b.y1)}
 return c.x1-c.x0>EPS&&c.y1-c.y0>EPS?c:null
}
export function intersectStreetPolygons(subject:StreetPolygon,clip:StreetPolygon){
 const a=rectangle(subject),b=rectangle(clip)
 if(a&&b){const cut=rectIntersection(a,b);return cut?rectPiece(subject,a,cut):[]}
 let result=subject
 for(let i=0;i<clip.length&&result.length;i++){
  const a=clip[i],b=clip[(i+1)%clip.length]
  result=clipStreetPolygon(result,a.y-b.y,b.x-a.x,b.y*a.x-b.x*a.y)
 }
 return result
}
/** Peel the outside of each half-plane; the pieces have disjoint interiors. */
export function subtractStreetPolygon(subject:StreetPolygon,clip:StreetPolygon):StreetPolygon[]{
 // Straight grid streets use the identical polygon contract with an exact
 // rectangle fast path. Curved/skew pieces retain half-plane clipping.
 const a=rectangle(subject),b=rectangle(clip)
 if(a&&b){
  const c=rectIntersection(a,b);if(!c)return[subject]
  return[{...a,x1:c.x0},{...a,x0:c.x1},{x0:c.x0,x1:c.x1,y0:a.y0,y1:c.y0},{x0:c.x0,x1:c.x1,y0:c.y1,y1:a.y1}]
   .filter(r=>r.x1-r.x0>EPS&&r.y1-r.y0>EPS).map(r=>rectPiece(subject,a,r))
 }
 if(!intersectStreetPolygons(subject,clip).length)return[subject]
 const pieces:StreetPolygon[]=[];let inside=subject
 for(let i=0;i<clip.length&&inside.length;i++){
  const a=clip[i],b=clip[(i+1)%clip.length],x=a.y-b.y,y=b.x-a.x,c=b.y*a.x-b.x*a.y
  const outside=clipStreetPolygon(inside,-x,-y,-c)
  if(outside.length)pieces.push(outside)
  inside=clipStreetPolygon(inside,x,y,c)
 }
 return pieces
}
