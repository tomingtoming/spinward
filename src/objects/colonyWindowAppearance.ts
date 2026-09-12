import type {ColonyUse} from './colonyBuildingUse'

/** Fixed per-building glazing and night occupancy; never depends on LOD or time. */
export function colonyWindowAppearance(use:ColonyUse,seed:number){
 const kind=use==='office'?1:use==='commercial'?2:use==='industrial'?3:0
 const pick=((seed>>>5)&255)/255
 const occupied=kind===1?.12+pick*.24:kind===2?.38+pick*.22:kind===3?.08+pick*.16:.28+pick*.28
 return {kind,tint:((seed>>>21)&255)/255,occupied}
}

// Linear RGB averages used once individual rooms are smaller than a pixel.
// Keep the shell bake and the filtered facade on the same use-based palette.
export const COLONY_AVERAGE_LAMPS = [[.92,.84,.76],[.76,.86,1.],[1.,.83,.59]] as const
export const colonyAverageLamp = (kind:number) => COLONY_AVERAGE_LAMPS[kind<.5?0:kind<2.5?1:2]
const lampGLSL=(index:number)=>COLONY_AVERAGE_LAMPS[index].map(v=>Number.isInteger(v)?`${v}.`:String(v).replace(/^0\./,'.')).join(',')

// Inputs use window-local coordinates. Derivatives are supplied by the caller
// before divergent glass/detail branches, so thin blinds can fade without aliasing.
export const COLONY_WINDOW_GLSL=`
float colonyWindowHash(vec2 p) {
 vec3 p3=fract(vec3(p.xyx)*.1031);
 p3+=dot(p3,p3.yzx+33.33);
 return fract((p3.x+p3.y)*p3.z);
}
vec3 colonyLamp(float kind) {
 return kind<.5?vec3(${lampGLSL(0)}):kind<2.5?vec3(${lampGLSL(1)}):vec3(${lampGLSL(2)});
}
vec3 colonyRoomLamp(float kind,float pick) {
 if(kind>=.5)return colonyLamp(kind);
 // Warm, neutral and daylight lamps vary by dwelling; offices share daylight.
 return pick<.34?vec3(1.,.65,.36):pick<.68?vec3(.98,.94,.85):vec3(.76,.86,1.);
}
void colonyWindowSurface(vec2 cell,vec2 pane,vec2 paneSize,float bottom,vec4 appearance,
 float seed,vec3 face,vec2 footprint,out vec3 colour,out float light,out float surfaceRoughness,out vec3 lamp) {
 bool residential=appearance.x<.5;
 float floorId=floor(cell.y)+appearance.w;
 float faceId=dot(face,vec3(7.,0.,19.));
 float room=colonyWindowHash(vec2(floor(cell.x)+faceId,floorId)+seed*103.);
 lamp=colonyRoomLamp(appearance.x,colonyWindowHash(vec2(room*131.,seed*29.+17.)));
 float floorState=colonyWindowHash(vec2(floorId,seed*71.));
 vec2 uv=(pane-vec2((1.-paneSize.x)*.5,bottom))/paneSize;
 vec2 aa=max(vec2(.001),footprint/paneSize);
 float shade;
 if(residential) {
  float edge=room>.8?0.:.10+room*.3;
  shade=1.-smoothstep(edge-aa.x,edge+aa.x,min(uv.x,1.-uv.x));
  if(room>.94)shade=1.;
 } else {
  float drop=floor(room*5.)*.2;
  shade=smoothstep(1.-drop-aa.y,1.-drop+aa.y,uv.y);
 }
 vec3 glass=mix(vec3(.075,.125,.15),vec3(.15,.17,.145),appearance.y);
 glass*=.8+.3*uv.y;
 vec3 fabric=residential?mix(vec3(.31,.33,.30),vec3(.48,.39,.28),room):vec3(.30,.33,.33);
 // Slat contrast vanishes before a slat becomes subpixel.
 if(!residential)fabric*=1.-.12*step(.6,fract(uv.y*14.))*(1.-smoothstep(.025,.065,aa.y));
 colour=mix(glass,fabric,shade);
 light=residential?step(1.-appearance.z,colonyWindowHash(vec2(room*43.,seed*97.))):step(1.-appearance.z,floorState)*step(.12,room);
 light*=mix(1.,.58,shade);
 surfaceRoughness=mix(residential?.4:.27,.85,shade);
}
`
