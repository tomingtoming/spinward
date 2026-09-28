// Both the close-up pane shader and the distant irradiance baker use this
// exposure. Occupancy and colour still belong to facadeRoomLight, never time.
export const ROOM_MEAN_EXPOSURE = .58

// A shallow analytic room behind the pane. The ray is expressed in the
// opening's own tangent/up/outward frame, including the cylinder warp and
// each eye's view matrix. No camera-facing sprites or extra vertex attributes.
export const roomDeclarations = `varying vec3 vKitRay;`
export const roomVertex = `
  vec3 roomNative=(instanceMatrix*vec4(kitResize(position),1.0)).xyz;
  vec3 roomEye=-(modelViewMatrix*vec4(kitWarp(roomNative),1.0)).xyz;
  vec3 roomRight=normalize(mat3(modelViewMatrix)*kitNormal(instanceMatrix[0].xyz,roomNative));
  vec3 roomUp=normalize(mat3(modelViewMatrix)*kitNormal(instanceMatrix[2].xyz,roomNative));
  vec3 roomOut=normalize(mat3(modelViewMatrix)*kitNormal(-instanceMatrix[1].xyz,roomNative));
  vKitRay=vec3(dot(roomEye,roomRight),dot(roomEye,roomUp),dot(roomEye,roomOut));
`
export const roomFragment = `
  vec2 roomSize=max(vKitSize,vec2(.1));
  vec2 roomUV=clamp(p/roomSize,0.0,1.0);
  vec2 slope=-vKitRay.xy/max(abs(vKitRay.z),.15);
  float roomDepth=min(roomSize.x,roomSize.y)*.65;
  // First room boundary hit, with a safe denominator for frontal views.
  vec2 rayDiv=sign(slope+vec2(.000001))*max(abs(slope),vec2(.0001));
  vec2 boundary=mix(vec2(0.0),roomSize,step(vec2(0.0),slope));
  vec2 hit=(boundary-p)/rayDiv;
  float travel=min(roomDepth,max(0.0,min(hit.x,hit.y)));
  vec2 at=clamp((p+slope*travel)/roomSize,0.0,1.0);
  float backWall=smoothstep(roomDepth*.93,roomDepth,travel);
  float ceiling=smoothstep(.86,.98,at.y);
  float roomLight=mix(.22,.42+.24*at.y,backWall)+.20*ceiling;
  // Curtain/floor shadow, not a luminous white board. Mip-sized panes
  // converge to their area mean instead of shimmering at subpixel scale.
  roomLight*=mix(.65,1.0,smoothstep(.08,.32,at.y));
  float footprint=max(length(dFdx(roomUV)),length(dFdy(roomUV)));
  paneMask*=mix(roomLight,${ROOM_MEAN_EXPOSURE.toFixed(2)},smoothstep(.18,.65,footprint));
`

export function collectBuildingLight(rows, parts, linearColour) {
  const result = new Map()
  for (const row of rows) {
    let item=result.get(row.id)
    if(!item){item={id:row.id,area:0,flux:[0,0,0],panes:0};result.set(row.id,item)}
    item.area+=row.walls.reduce((sum,w)=>sum+w.length*Math.max(0,w.top-w.base),0)
  }
  for(const p of parts){
    if(!p.light?.strength)continue
    const item=result.get(p.id)
    if(!item)continue
    const exposure=['window','glazing','entry'].includes(p.kind)?ROOM_MEAN_EXPOSURE:1
    const rgb=linearColour(p.light.colour),area=p.width*p.height
    for(let i=0;i<3;i++)item.flux[i]+=rgb[i]*p.light.strength*area*exposure
    item.panes++
  }
  return [...result.values()].filter(r=>r.area>0).map(r=>({...r,mean:r.flux.map(c=>c/r.area)}))
}
