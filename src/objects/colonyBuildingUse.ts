import type {CityBuilding} from './cityLayout'

export type ColonyUse = 'house' | 'apartments' | 'office' | 'commercial' | 'industrial'
export type GroundUse = 'residential' | 'lobby' | 'retail' | 'service'

export function colonyBuildingSeed(b: CityBuilding) {
  let seed=(Math.round(b.azimuth*1e6)^Math.imul(Math.round(b.axial*100),0x45d9f3b))>>>0
  seed=Math.imul(seed^(seed>>>16),0x45d9f3b)>>>0
  return (seed^(seed>>>16))>>>0
}

/** Land use follows the certified street, independently of camera, LOD and plan RNG. */
export function colonyBuildingUse(b: CityBuilding) {
  const seed=colonyBuildingSeed(b), urban=b.urban??0, road=b.streetKind??'local'
  const frontage=b.front?.axis==='tangent'?b.depth:b.width
  const mainStreet=road==='arterial'||road==='collector'
  const pick=(seed%65536)/65536, retailPick=((seed>>>16)%65536)/65536
  let primary: ColonyUse
  if(b.industrial) primary='industrial'
  else if(b.kind==='house') primary='house'
  else if(b.height<10||frontage<9) primary='apartments'
  else {
    const commercialChance=mainStreet?.13+urban*.18:.02+urban*.05
    const officeChance=mainStreet?.1+urban*.36:.025+urban*.12
    primary=pick<commercialChance?'commercial':pick<commercialChance+officeChance?'office':'apartments'
  }
  let ground: GroundUse=primary==='industrial'?'service':primary==='office'?'lobby':'residential'
  const eligible=primary!=='house'&&primary!=='industrial'&&b.height>=12&&frontage>=12
  const retailChance=road==='arterial'?.48+urban*.3:road==='collector'?.32+urban*.3:road==='local'?.04+urban*.16:.015+urban*.035
  if(primary==='commercial'||(eligible&&retailPick<retailChance)) ground='retail'
  const retailFloors=ground==='retail'&&b.height>=28&&urban>.6&&((seed>>>8)%5===0||primary==='commercial')?2:1
  const groundHeight=ground==='retail'?Math.min(b.height*.4,retailFloors*4.2):ground==='lobby'?Math.min(4.8,b.height*.35):0
  return {primary,ground,groundHeight,mixed:ground==='retail'&&primary!=='commercial',street:road}
}
