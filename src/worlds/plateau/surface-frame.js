// Source coordinates: X cross-band, Y along the cylinder, Z above local datum.
// Collision stays in this source frame; rendering and the player share its placement.
export function surfaceAngle(radius,sample,view,x){
  return (x+(view==='colony'?sample.anchor.local[0]:0))/radius+(view==='colony'?sample.band*Math.PI*2/3:0)
}
export function surfacePoint(radius,sample,view,x,y,h){
  if(view==='flat')return[x,h,-y]
  const a=surfaceAngle(radius,sample,view,x),r=radius-h
  return[r*Math.sin(a),(view==='colony'?0:radius)-r*Math.cos(a),-(y+(view==='colony'?sample.anchor.local[1]:0))]
}
