import {planCity} from '../../src/objects/cityLayout';
import {planBuildingInteriors} from '../../src/objects/buildingInteriors';
import c from './city-block.json';
import fs from 'node:fs';
const destination=new URL('./city-block-expansion.json',import.meta.url);
const existing=JSON.parse(fs.readFileSync(destination,'utf8'));
const p=planCity({radius:3200,length:40000,maxBuildings:64000}),ins=planBuildingInteriors(p.buildings,3200);
const placements=p.buildings.filter(b=>b.front?.axis==='axial'&&b.front.side===-1&&Math.abs(b.azimuth-.05)*3200<1800&&Math.abs(b.axial)<1800&&!ins.has(b)&&!c.blocks.some(s=>s.building.azimuth===b.azimuth&&s.building.axial===b.axial)).flatMap((b,i)=>{const fits=c.blocks.filter(s=>b.width>=s.building.width&&b.depth>=s.building.depth&&b.height>=s.building.height);if(!fits.length)return[];const previous=existing.find(p=>p.building.azimuth===b.azimuth&&p.building.axial===b.axial);const s=fits.find(s=>s.id===previous?.model)??fits[Math.abs(Math.round(b.azimuth*1e6+b.axial*10))%fits.length];return[{model:s.id,building:b,offsetZ:(b.depth-s.building.depth)/2}]});
fs.writeFileSync(destination,JSON.stringify(placements,null,2)+'\n');console.log(placements.length)
