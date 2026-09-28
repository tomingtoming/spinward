// Shared-kit station elevations over unmodified PLATEAU volumes. Station
// identity comes from the offline N02 match, never a runtime proximity guess.
export function isStation(row){
  return row.usage==='運輸倉庫施設'&&row.station?.source==='N02 + PLATEAU transport footprint'
    &&['hall','platform'].includes(row.station.kind)&&typeof row.station.name==='string'
}

export function composeStationFacades(row,design){
  const parts=[],platform=row.station.kind==='platform'
  const metal=platform?'#737f80':'#909c9b',frame='#526564',glass='#456471',accent='#567d71'
  const longest=Math.max(...row.walls.map(w=>w.length))
  for(const seam of row.station.roofSeams??[]){
    const length=Math.hypot(seam.b[0]-seam.a[0],seam.b[1]-seam.a[1]),u=[(seam.b[0]-seam.a[0])/length,(seam.b[1]-seam.a[1])/length]
    const n=Math.max(1,Math.ceil(length*Math.abs(u[0])/8)),width=length/n
    for(let i=0;i<n;i++)parts.push({kind:'strip',id:row.id,origin:[seam.a[0]+u[0]*width*(i+.5),seam.a[1]+u[1]*width*(i+.5),seam.top+.15],
      u,width,height:.10,depth:.15,colour:metal,frame,wall:-1,role:'roof',family:'station',style:design.style,purpose:'station-roof-seam'})
  }
  for(let wi=0;wi<row.walls.length;wi++){
    const w=row.walls[wi],length=w.length,h=w.top-w.base
    if(length<3||h<4.5)continue
    const u=[(w.b[0]-w.a[0])/length,(w.b[1]-w.a[1])/length]
    const emit=(kind,x,z,width,height,colour,depth=.09,offset=.025,extra={})=>{
      parts.push({kind,id:row.id,origin:[w.a[0]+u[0]*x+w.normal[0]*offset,w.a[1]+u[1]*x+w.normal[1]*offset,z],
        u,width,height,depth,colour,frame,wall:wi,role:'station',family:'station',style:design.style,...extra})
    }
    const strip=(x,bottom,width,height,colour,depth=.10,offset=.03,extra={})=>{
      const n=Math.max(1,Math.ceil(width*Math.abs(u[0])/8)),piece=width/n
      for(let i=0;i<n;i++)emit('strip',x-width/2+(i+.5)*piece,bottom+height/2,piece,height,colour,depth,offset,extra)
    }
    const ground=Math.max(...w.ground),bottom=Math.max(w.base+.18,ground+.18)
    if(bottom>w.top-3)continue
    // A station has a broad hall and an upper daylight band, not apartment
    // floor stacks. Platform boxes remain opaque source volumes underneath.
    const upperBottom=w.top-Math.min(platform?2.1:4.2,h*.27)
    const upperHeight=Math.min(platform?1.15:2.55,w.top-upperBottom-.8)
    const bays=Math.max(1,Math.ceil((length-.7)/(platform?7.5:6.5))),pitch=(length-.7)/bays
    for(let i=0;i<bays;i++){
      const x=.35+(i+.5)*pitch,width=Math.max(.3,pitch-.3)
      if(upperBottom>bottom+.4&&upperHeight>.5)
        emit('glazing',x,upperBottom,width,upperHeight,glass,1,0,{purpose:'station-clerestory',roughness:.32,light:{colour:'#e3eff0',strength:.18}})
      if(!platform&&h>10){
        const z=Math.max(bottom+.65,w.base+h*.18),height=Math.min(5.5,h*.3,upperBottom-z-.8)
        if(height>1.5)emit('glazing',x,z,width,height,glass,1,0,{purpose:'station-hall-glazing',ground,roughness:.32,light:{colour:'#e3eff0',strength:.14}})
      }
      if(i>0)strip(.35+i*pitch,bottom,.22,w.top-bottom-.38,metal,.12,.035,{purpose:'station-pier',surface:2})
    }
    const trim=Math.min(.8,h*.045)
    strip(length/2,w.top-trim-.08,length-.15,trim,metal,.16,.02,{purpose:'station-roof-edge'})
    strip(length/2,bottom,length-.2,.4,metal,.10,.035,{purpose:'station-plinth',surface:2})
    strip(length/2,upperBottom-.23,length-.2,.19,accent,.11,.04,{purpose:'station-line-band'})
    // Restrained projections only where the offline source-space clearance
    // permits them. No poles, invented doors, road obstruction or new lights.
    if(w.projectionClearance>=.66){
      const canopyZ=platform?upperBottom-.4:Math.min(w.top-1,bottom+Math.max(4,h*.18))
      strip(length/2,canopyZ,length-.7,.16,metal,Math.min(1.04,w.projectionClearance-.08),0,{purpose:'station-canopy'})
    }
    // Nameboards on broad elevations; short returns do not get repeated text.
    if(length>=Math.max(12,longest*.18)&&Number.isInteger(row.station.signIndex)){
      const signWidth=Math.min(7,length*.6),signH=signWidth/8
      const signZ=platform?Math.max(bottom+2.8,upperBottom-.25-signH):Math.min(w.top-signH-.9,bottom+Math.max(4.5,h*.18)+.25)
      if(signZ+signH<w.top-.5)
        strip(length/2,signZ,signWidth,signH,'#ffffff',.10,.19,{purpose:'station-name',surface:-1-row.station.signIndex,light:{colour:'#fff0dc',strength:.14}})
    }
  }
  return parts
}
