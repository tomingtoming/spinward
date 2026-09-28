// Light leaves a visible opening. The source recipe owns position, occupancy
// and colour, so a dark shop never receives an unrelated pool of light.
export function frontageLight(part){
  if(!(part.light?.strength>0))return null
  const store=part.purpose==='storefront',station=part.purpose==='station-hall-glazing',entry=part.purpose==='entry-lamp'||part.purpose==='entrance'
  if(!store&&!station&&!entry)return null
  const normal=[part.u[1],-part.u[0]],offset=.16
  const origin=[part.origin[0]+normal[0]*offset,part.origin[1]+normal[1]*offset,
    part.origin[2]+(part.kind==='strip'?0:part.height*.65)]
  const radius=station?12:store?8:4.5
  return{id:`${part.id}:${part.wall}:${part.purpose}:${part.bay??part.origin[0]}:${part.origin[1]}`,origin,normal,
    width:part.width,radius,height:origin[2]-(part.ground??part.origin[2]-(part.kind==='strip'?2.12:.25)),colour:part.light.colour,strength:part.light.strength,intensity:station?65:store?45:18}
}
