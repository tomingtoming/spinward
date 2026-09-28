// One recipe supplies near geometry and mid-distance panels. No Blender process per building.
export const PALETTE={
  'plaster-sand':'#cfc6b4','plaster-grey':'#b3b8b5','brick-muted':'#ab9181','plaster-ivory':'#e1d9c9',
  'cladding-grey':'#8c9c9c',frame:'#555b5a',sill:'#b9b9af','glass-blue':'#526971','glass-neutral':'#71817f',
  'curtain-cream':'#a99f87','curtain-grey':'#8d9391','shop-glass':'#485f65','shop-band':'#69786c',door:'#666255'}
export function bodyColour(seed){return PALETTE[['plaster-sand','plaster-grey','brick-muted','plaster-ivory','cladding-grey'][seed%5]]}

export function composeFacades(rows){
  const parts=[],buildings=new Map()
  for(const row of rows){
    const {id,usage,seed}=row,style=row.style;buildings.set(id,{id,colour:bodyColour(seed)})
    const office=['業務施設','官公庁施設','文教厚生施設'].includes(usage)
    const shop=usage.includes('店舗')||usage==='商業施設'
    const mixed=usage==='共同住宅'&&Math.max(...row.walls.map(w=>w.top-w.base))>18&&seed%3===0
    let doorWall=0,best=Infinity
    row.walls.forEach((w,i)=>{const score=w.roadDistance-Math.min(w.length,12)*.04;if(score<best){best=score;doorWall=i}})
    for(let wi=0;wi<row.walls.length;wi++){
      const w=row.walls[wi],u=[(w.b[0]-w.a[0])/w.length,(w.b[1]-w.a[1])/w.length]
      const emit=(kind,x,z,width,height,colour,depth=1,offset=0)=>parts.push({kind,id,origin:[w.a[0]+u[0]*x+w.normal[0]*offset,w.a[1]+u[1]*x+w.normal[1]*offset,z],u,width,height,depth,colour,wall:wi})
      const height=w.top-w.base,floors=w.floors,floorH=(height-.30)/floors
      const bay=office?2.1+seed%3*.23:2.9+seed%3*.35,bays=Math.max(1,Math.floor((w.length-.8)/bay)),spacing=(w.length-.8)/bays
      for(let floor=0;floor<floors;floor++){
        const z=w.base+floor*floorH
        if(floor===0&&(shop||mixed)){
          for(let j=0;j<bays;j++){
            const x=.4+spacing*(j+.5),bottom=Math.max(z+.18,Math.max(...w.ground)+.22),wh=Math.min(2.25,z+floorH-.55-bottom)
            if(wh>.8)emit('window',x,bottom,Math.min(spacing-.3,2.7),wh,PALETTE['shop-glass'])
          }
          emit('strip',w.length/2,z+floorH-.28,Math.max(.5,w.length-.2),.35,style===undefined?PALETTE['shop-band']:['#69786c','#777467','#6d757b','#837568'][style],.09,.03)
          continue
        }
        for(let j=0;j<bays;j++){
          if(floor===0&&wi===doorWall&&j===Math.floor(bays/2))continue
          const sill=style===undefined?(office?.55:.95):office?[.28,.55,.95,.40][style]:[.95,1.0,1.05,.90][style]
          const bottom=z+sill,wh=Math.min(style===undefined?floorH-(office?.95:1.55):floorH-sill-.6,style===undefined?(office?2.25:1.3):office?[2.9,2.25,1.6,2.55][style]:[1.0,1.1,1.3,1.2][style])
          if(bottom<Math.max(...w.ground)+.2||wh<.6)continue
          // Room seeds are precomputed from the original SHA recipe; shared across every LOD.
          const encoded=w.roomBands?.[floor]?.[j],room=w.rooms?.[`${floor}:${j}`]??(encoded===undefined?undefined:Number(encoded))
          if(room===undefined&&!office)throw Error('Missing deterministic room seed')
          const colour=office?PALETTE['glass-blue']:PALETTE[['glass-blue','glass-blue','glass-neutral','curtain-cream','curtain-grey'][room%5]]
          emit('window',.4+spacing*(j+.5),bottom,Math.min(spacing-.65,style===undefined?(office?1.85:1.4):office?[1.9,1.75,1.55,1.85][style]:[1.05,1.2,1.4,1.55][style]),wh,colour)
        }
      }
      emit('strip',w.length/2,w.top-.15,w.length,.18,PALETTE.sill,.10,.025)
      if(wi===doorWall&&w.length>2.4&&Math.max(...w.ground)-Math.min(...w.ground)<.65){
        const bottom=w.entryGround??w.ground[1]+.20
        if(bottom+2.3<w.top)emit('door',.4+spacing*(Math.floor(bays/2)+.5),bottom,1,1,PALETTE.door)
      }
    }
  }
  return{parts,buildings:Array.from(buildings.values())}
}
