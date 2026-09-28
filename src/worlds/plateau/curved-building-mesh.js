/** Bound cylinder interpolation error, including tall walls' X/height term.
 * Subdivision preserves the original planar source triangles and attributes.
 * It changes only the render approximation, never the collision/source data. */
export function refineCurvedBuilding(attributes,radius,tolerance=.008){
  if(!(radius>0&&tolerance>0&&Number.isFinite(radius+tolerance)))throw Error('Invalid cylinder refinement bounds')
  const keys=Object.keys(attributes).filter(k=>k!=='index')
  const sizes=Object.fromEntries(keys.map(k=>[k,attributes[k].length/(attributes.position.length/3)]))
  const arrays=Object.fromEntries(keys.map(k=>[k,Array.from(attributes[k])]))
  const p=arrays.position,indices=[],midpoints=new Map()
  const error=(a,b)=>{
    const dx=p[a*3]-p[b*3],dz=p[a*3+2]-p[b*3+2]
    const r=Math.max(Math.abs(radius-p[a*3+2]),Math.abs(radius-p[b*3+2]))
    return (r*(dx/radius)**2+2*Math.abs(dx*dz)/radius)/8
  }
  const midpoint=(a,b)=>{
    const key=a<b?a+':'+b:b+':'+a
    if(midpoints.has(key))return midpoints.get(key)
    const n=p.length/3
    for(const [key,values] of Object.entries(arrays))for(let k=0;k<sizes[key];k++)values.push(Math.fround((values[a*sizes[key]+k]+values[b*sizes[key]+k])/2))
    midpoints.set(key,n);return n
  }
  const source=attributes.index,stack=[]
  for(let i=0;i<source.length;i+=3){
    stack.push([source[i],source[i+1],source[i+2]])
    while(stack.length){
      const face=stack.pop(),errors=[error(face[0],face[1]),error(face[1],face[2]),error(face[2],face[0])]
      const largest=Math.max(...errors)
      if(largest<=tolerance){indices.push(...face);continue}
      const edge=errors.indexOf(largest),a=face[edge],b=face[(edge+1)%3],c=face[(edge+2)%3],m=midpoint(a,b)
      stack.push([a,m,c],[m,b,c])
    }
  }
  if(!midpoints.size)return attributes
  return {...Object.fromEntries(keys.map(k=>[k,new attributes[k].constructor(arrays[k])])),index:new Uint32Array(indices)}
}

// Wire byte counts still validate the downloaded payload. Keep refinement's
// additional resident arrays separate so both streamers can enforce their caps.
export const meshArrayBytes=meshes=>meshes.reduce((n,m)=>n+Object.values(m.attributes).reduce((s,a)=>s+a.byteLength,0),0)
