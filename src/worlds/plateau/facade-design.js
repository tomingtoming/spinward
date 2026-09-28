// Source usage chooses the family. Openings/materials are Spinward designs,
// not surveyed elevations. A building's room plan stays stable across tiles/LODs.
import {PALETTE,bodyColour} from './facade-rules.js'
import {isStation,composeStationFacades} from './station-facades.js'

export function designSeed(text){
  let n=2166136261
  for(let i=0;i<text.length;i++)n=Math.imul(n^text.charCodeAt(i),16777619)
  return n>>>0
}

export function facadeFamily(usage){
  if(usage==='共同住宅'||usage==='店舗等併用共同住宅')return 'apartments'
  if(['住宅','店舗等併用住宅','作業所併用住宅'].includes(usage))return 'house'
  if(usage==='業務施設')return 'office'
  if(['商業施設','商業系複合施設'].includes(usage))return 'commercial'
  if(usage==='宿泊施設')return 'hotel'
  if(['官公庁施設','文教厚生施設'].includes(usage))return 'civic'
  if(['工場','運輸倉庫施設','農林漁業用施設','供給処理施設'].includes(usage))return 'utility'
  return 'unknown'
}

const STYLES={house:['paired-rooms','service-bay','horizontal-rooms'],apartments:['paired-flats','french-guards','vertical-flats'],
  office:['ribbon','piers','glazed'],commercial:['display','piers','ribbon'],hotel:['paired-flats','vertical-flats'],
  civic:['piers','ribbon'],utility:['clerestory'],unknown:['plain'],station:['concourse']}
const ACCENTS=['#a49c8a','#788986','#8d6f60','#bab09c','#627479']
const FRAMES=['#4e5553','#999b95','#655b50']
const GLASS=['#536b73','#627a80','#4d636a']
const CURTAINS=['#8b9997','#b5aa92','#9c9e93','#849397']

export function buildingDesign(row){
  const family=isStation(row)?'station':facadeFamily(row.usage),n=designSeed(row.id+':elevation-v2'),styles=STYLES[family]
  const shop=['店舗等併用住宅','店舗等併用共同住宅','商業施設','商業系複合施設'].includes(row.usage)
  return {family,style:family==='station'?row.station.kind:styles[n%styles.length],shop,seed:n,colour:bodyColour(row.seed),
    accent:ACCENTS[(n>>>5)%ACCENTS.length],frame:FRAMES[(n>>>9)%FRAMES.length],glass:GLASS[(n>>>12)%GLASS.length]}
}

export function facadeWallRoles(walls){
  if(!walls.length)return []
  let front=0,best=Infinity
  walls.forEach((w,i)=>{const score=w.roadDistance-Math.min(w.length,18)*.08;if(score<best){best=score;front=i}})
  const primary=walls[front]
  return walls.map((w,i)=>{
    const dot=w.normal[0]*primary.normal[0]+w.normal[1]*primary.normal[1]
    return i===front?'entrance':dot>.65&&w.roadDistance<primary.roadDistance+12?'front':
      dot>-.25&&w.roadDistance<Math.min(6,primary.roadDistance+1.5)?'corner':dot<-.45?'rear':'side'
  })
}

function roomColour(id,floor,bay,d){
  if(['office','commercial','civic','utility'].includes(d.family))return d.glass
  const n=designSeed(`${id}:room:${floor}:${bay}`)%9
  return n<5?d.glass:CURTAINS[n-5]
}

export function facadeRoomLight(id,floor,bay,family,store=false){
  const residential=['house','apartments','hotel'].includes(family)&&!store
  // Paired panes share a household; offices share a floor's occupancy and a
  // building-wide daylight-white temperature. No frame-to-frame randomness.
  const n=designSeed(`${id}:light:${floor}:${residential?bay:'floor'}`)
  let tint=designSeed(`${id}:temperature:${floor}:${bay}`)
  tint=Math.imul(tint^(tint>>>16),0x85ebca6b);tint=Math.imul(tint^(tint>>>13),0xc2b2ae35);tint=(tint^(tint>>>16))>>>0
  return {colour:residential?['#ffc98c','#fff0db','#dceaff'][tint%3]:store?'#fff0db':'#dceaff',
    strength:(residential?n%10<6:n%10<7)?(store?.28:residential?.36:.26):0}
}

export function composeBuildingFacades(rows,{life=false}={}){
  const parts=[],buildings=new Map()
  for(const row of rows){
    const d=buildingDesign(row),roles=facadeWallRoles(row.walls)
    buildings.set(row.id,{id:row.id,...d})
    if(d.family==='unknown')continue
    if(d.family==='station'){parts.push(...composeStationFacades(row,d));continue}
    for(let wi=0;wi<row.walls.length;wi++){
      const w=row.walls[wi],role=roles[wi],front=['entrance','front','corner'].includes(role)
      const height=w.top-w.base,floors=w.floors,floorH=(height-.3)/floors
      if(!Number.isFinite(floorH)||floorH<1.8||w.length<2.4)continue
      const u=[(w.b[0]-w.a[0])/w.length,(w.b[1]-w.a[1])/w.length]
      const emit=(kind,x,z,width,h,colour,depth=1,offset=0,extra={})=>{
        if(width<=(kind==='strip'?.015:.15)||h<=.08||z+h>(w.top+.01)&&kind!=='strip')return
        parts.push({kind,id:row.id,origin:[w.a[0]+u[0]*x+w.normal[0]*offset,w.a[1]+u[1]*x+w.normal[1]*offset,z],
          u,width,height:h,depth,colour,frame:d.frame,wall:wi,role,family:d.family,style:d.style,...extra})
      }
      // Strip authoring geometry is centred in Z; opening geometry starts at Z=0.
      const strip=(x,bottom,width,h,colour,depth=.05,offset=.035,extra={})=>{
        // Match the curved wall instead of spanning a long cylinder chord:
        // an unsplit 100m cornice can disappear half a metre inside its wall.
        const segments=Math.max(1,Math.ceil(width*Math.abs(u[0])/8)),piece=width/segments
        for(let i=0;i<segments;i++)emit('strip',x-width/2+piece*(i+.5),bottom+h/2,piece,h,colour,depth,offset,extra)
      }
      const margin=.45,span=w.length-margin*2
      const nominal=d.family==='house'?3.1:d.family==='apartments'?4.5:d.family==='utility'?5.2:3.2
      const count=Math.max(1,Math.floor(span/(nominal+((d.seed>>>2)%3-.9)*.25)))
      const weights=Array.from({length:count},(_,i)=>d.family==='house'&&i===count-1?.66:1)
      const total=weights.reduce((a,b)=>a+b,0),bays=[];let cursor=margin
      for(const weight of weights){const width=span*weight/total;bays.push({x:cursor+width/2,width});cursor+=width}
      const service=(d.seed+wi)%count,doorBay=Math.floor(count/2)
      const regularOffice=['office','commercial','civic'].includes(d.family)
      for(let floor=0;floor<floors;floor++){
        const z=w.base+floor*floorH,store=d.shop&&front&&floor===0
        // Horizontal courses and vertical piers change the large-scale reading,
        // without covering the source massing with a second complete wall.
        if(floor>0&&front&&['ribbon','glazed','paired-flats','french-guards'].includes(d.style))
          strip(w.length/2,z-.10,w.length-.10,d.family==='apartments'?.22:.30,d.accent,.13,.025,{surface:2,purpose:'course'})
        for(let j=0;j<bays.length;j++){
          const bay=bays[j],isDoor=floor===0&&role==='entrance'&&j===doorBay
          if(isDoor)continue
          const quiet=!front&&(d.family==='house'||d.family==='apartments'||d.family==='hotel')
          // Service bays form columns rather than independently missing windows.
          if(quiet&&role==='side'&&j%3!==service%3)continue
          const small=quiet||d.family==='house'&&j===service
          const balcony=life&&d.family==='apartments'&&d.style==='french-guards'&&front&&floor>0&&floorH>=2.65&&bay.width>2.7&&w.projectionClearance>=1.1
          let sill=1.0,h=Math.min(1.2,floorH-1.6),width=bay.width*.62,kind='window'
          if(store){sill=.24;h=Math.min(2.4,floorH-.65);width=bay.width-.2;kind='glazing'}
          else if(d.family==='utility'){sill=Math.max(1.4,floorH-1.15);h=.65;width=bay.width*.68;kind='glazing'}
          else if(regularOffice){
            const glazed=d.style==='glazed',ribbon=d.style==='ribbon'
            sill=glazed?.25:ribbon?.9:.75;h=Math.min(glazed?3.0:ribbon?1.7:2.05,floorH-sill-.4)
            width=bay.width*(glazed?.95:ribbon?.93:.69);kind='glazing'
          }else if(small){h=.65;sill=1.65;width=Math.min(.8,bay.width*.38);kind='glazing'}
          else if(d.style==='horizontal-rooms'){width=bay.width*.8;h=.95;sill=1.3}
          else if(d.family==='apartments'&&d.style==='french-guards'&&floor>0&&front){sill=.2;h=Math.min(2.3,floorH-.55);width=Math.min(2.5,bay.width*.76)}
          // A shop's low sill follows the terrain datum. Rejecting the whole
          // display when source base and DEM differ leaves a blank ground floor.
          const bottom=store?Math.max(z+sill,Math.max(...w.ground)+.22):z+sill
          if(store)h=Math.min(h,z+floorH-.40-bottom)
          if(bottom<Math.max(...w.ground)+.20||h<.55)continue
          const colour=roomColour(row.id,floor,j,d),extra={roughness:colour===d.glass?.3:.85,purpose:store?'storefront':small?'service':'room',floor,bay:j,ground:Math.max(...w.ground),
            ...(life?{light:facadeRoomLight(row.id,floor,j,d.family,store)}:{})}
          if(d.family==='apartments'&&d.style==='paired-flats'&&front&&!store&&bay.width>3.4){
            const gap=.40,pane=Math.min(1.45,(bay.width*.78-gap)/2)
            for(const side of [-1,1])emit('window',bay.x+side*(pane+gap)/2,bottom,pane,h,colour,1,0,extra)
          }else emit(kind,bay.x,bottom,width,h,colour,1,0,extra)
          if(balcony){
            emit('balcony',bay.x,z+.10,Math.min(bay.width-.22,3.8),1,d.accent,1,0,{purpose:'balcony',floor,bay:j})
          }else if(d.family==='apartments'&&d.style==='french-guards'&&floor>0&&front){
            // A French-window guard is attached to the wall, not a walkable balcony.
            emit('guard',bay.x,z+.12,width+.15,1.02,d.frame,1,.11,{purpose:'window-guard',floor,bay:j})
          }
        }
        if(store)strip(w.length/2,z+floorH-.42,span,.32,d.accent,.06,.06,{surface:2,purpose:'shop-band'})
        if(life&&store){
          const signZ=Math.max(z+floorH-.65,Math.max(...w.ground)+2.45)
          if(signZ+.42<w.top){
            const signWidth=Math.min(3.4,span*.7),signKind=(d.seed>>>4)%4,awning=w.projectionClearance>=.66
            // The fascia sits on the canopy's front edge, so a street-level
            // view cannot lose the lower lettering behind the canopy itself.
            strip(w.length/2,signZ,signWidth,.40,d.accent,.055,awning?.58:.105,{surface:-1-signKind,purpose:'shop-sign',light:{colour:'#fff0db',strength:.12}})
            if(awning)strip(w.length/2,signZ-.10,Math.min(span,6),.10,d.accent,.58,0,{purpose:'shop-awning'})
          }
        }
      }
      if(front&&['piers','vertical-flats','service-bay'].includes(d.style)){
        for(let j=0;j<bays.length-1;j++){
          const x=bays[j].x+bays[j].width/2
          strip(x,w.base+(d.shop?floorH:.15),.28,height-(d.shop?floorH:.15)-.3,d.accent,.10,.025,{surface:1,purpose:'pier'})
        }
      }
      strip(w.length/2,w.top-.22,w.length,.18,d.accent,.11,.025,{purpose:'cornice'})
      if(role==='entrance'&&Math.max(...w.ground)-Math.min(...w.ground)<.65){
        const access=life?w.entryAccess:null,bottom=access?access.ground+.065:w.entryGround??w.ground[1]+.2,wide=['office','commercial','civic','apartments','hotel'].includes(d.family)
        if(access){
          const [a,b]=[access.start,access.end],length=Math.hypot(b[0]-a[0],b[1]-a[1]),dx=(b[0]-a[0])/length,dy=(b[1]-a[1])/length
          // Clear the source finish (DEM +16mm) and curvature/float rounding.
          // Embed the bottom below even the lowest certified terrain sample.
          if(length>.15&&length<=8)parts.push({kind:'strip',id:row.id,origin:[a[0],a[1],access.ground-.005],u:[-dy,dx],width:1,height:.08,depth:length,
            colour:'#9d9c92',frame:d.frame,wall:wi,role,family:d.family,style:d.style,surface:2,purpose:'entry-apron',nearOnly:true})
        }
        if(bottom+2.4<w.top){
          const entryWidth=Math.min(bays[doorBay].width-.25,wide?1.8:.92)
          emit('entry',bays[doorBay].x,bottom,entryWidth,2.2,wide?d.glass:d.frame,1,0,{purpose:'entrance',roughness:wide?.3:.86,
            ...(life&&wide?{light:{colour:d.family==='office'?'#dceaff':'#fff0db',strength:.16}}:{})})
          const rise=bottom-w.ground[1]
          if(rise>.02&&rise<.35)strip(bays[doorBay].x,w.ground[1],entryWidth+.12,rise,d.accent,.15,.02,{purpose:'threshold'})
          const entryDepth=life&&w.projectionClearance>=.66?.56:.24
          strip(bays[doorBay].x,bottom+2.27,Math.min(bays[doorBay].width,wide?2.2:1.35),.10,d.accent,entryDepth,.02,{purpose:'entrance-hood'})
          if(life){
            if(wide)for(const side of [-1,1])strip(bays[doorBay].x+side*(entryWidth/2+.12),bottom,.14,2.27,d.accent,.16,.02,{surface:d.family==='apartments'?1:2,purpose:'entrance-surround'})
            // Small wall-mounted entrance light / intercom; never a freestanding
            // obstruction on the footway. Only close LOD needs the small detail.
            strip(bays[doorBay].x-entryWidth/2-.22,bottom+1.45,.14,.22,d.frame,.065,.03,{purpose:'intercom',nearOnly:true})
            strip(bays[doorBay].x,bottom+2.12,Math.min(.65,entryWidth*.7),.10,'#ddd4b9',.04,.11,{purpose:'entry-lamp',nearOnly:true,light:{colour:'#ffd9a6',strength:.3}})
          }
        }
      }
    }
  }
  return {parts,buildings:[...buildings.values()]}
}
