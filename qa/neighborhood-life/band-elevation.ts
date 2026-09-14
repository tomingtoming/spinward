import fs from 'node:fs/promises'
import path from 'node:path'
import { proposedBandLand, bandRiverCentre } from '../../src/objects/bandLand'
import { proposedBandExpressway } from '../../src/objects/bandExpresswayLand'
import { planBandTransport } from '../../src/objects/bandExpressway'
import { prepareBandStreetGeometry } from '../../src/objects/bandStreetGeometry'
import { BAND_LEVELS, auditElevatedRoads, proposeExpresswayElevations, sampleElevatedRoad, elevatedRoadMesh, bandBankHeight, type ElevatedRoad, type BandMesh } from '../../src/objects/bandElevation'
import { buildBandRiverMeshes, buildBandPavement, buildExpresswayDeck, solidBandDeck, bandMeshGeometry } from '../../src/objects/bandElevationGeometry'
import { clipStreetPolygon } from '../../src/objects/streetPolygon'
import { getStreetProfile } from '../../src/objects/streetProfile'
import type { StreetSurface } from '../../src/objects/streetSurfacePlan'
import { bandGraph } from '../../src/objects/bandStreetPlan'

const out=process.env.OUTPUT_DIR
if(!out||!path.isAbsolute(out))throw Error('OUTPUT_DIR must be absolute')
await fs.mkdir(out,{recursive:true})
const start=performance.now(),plan=planBandTransport(proposedBandLand(),proposedBandExpressway()),geometry=prepareBandStreetGeometry(plan.surface)
const raised=proposeExpresswayElevations(plan.expressway),audit=auditElevatedRoads(raised)
const oldDesign=proposedBandExpressway('direct');oldDesign.interchanges.forEach(ic=>{ic.layout='direct'})
const oldPlan=planBandTransport(proposedBandLand(),oldDesign),oldGeometry=prepareBandStreetGeometry(oldPlan.surface)
const oldRaised=proposeExpresswayElevations(oldPlan.expressway),oldAudit=auditElevatedRoads(oldRaised)
const previous=planBandTransport(proposedBandLand(),proposedBandExpressway('direct')),previousGeometry=prepareBandStreetGeometry(previous.surface)
const previousRaised=proposeExpresswayElevations(previous.expressway),previousAudit=auditElevatedRoads(previousRaised)
const underpasses:ElevatedRoad[]=geometry.roads.filter(r=>r.underpass).map(r=>({id:r.underpass!,from:r.underpass+'-from',to:r.underpass+'-to',width:getStreetProfile(r.kind).carriageway,
  depth:.2,samples:sampleElevatedRoad([r.from,r.to],()=>.2)}))
const groundAudit=auditElevatedRoads([...raised,...underpasses]).crossings.filter(c=>underpasses.some(r=>r.id===c.a||r.id===c.b))
const scenes:any[]=[]
const places=[{id:'river',name:'川沿いと既存橋の位置',x:bandRiverCentre(1445.8064516129052),y:1445.8064516129052,span:380},
  {id:'underpass',name:'一般道と高架本線',x:1373,y:4700,span:300},
  {id:'ic-before',name:'到着地区 IC — 変更前',x:1370,y:1600,span:700},
  {id:'ic',name:'到着地区 IC — 両側接続',x:1370,y:1600,span:700},
  {id:'terminal',name:'北端 IC — 往復ランプ',x:1200,y:19600,span:500},
  {id:'port',name:'物流ゲート IC — 往復ランプ',x:-600,y:-19260,span:500},
  {id:'jct-before',name:'南部物流 JCT — 変更前',x:1200,y:-18300,span:1300},
  {id:'jct',name:'南部物流 JCT — 上下に分離',x:1200,y:-18300,span:1300}]
const serial=(m:BandMesh)=>{const g=bandMeshGeometry(m),json=g.toJSON();g.dispose();return json}
for(const place of places){
  const before=place.id==='ic-before',jctBefore=place.id==='jct-before',surface=before?oldGeometry:jctBefore?previousGeometry:geometry,express=before?oldPlan.expressway:jctBefore?previous.expressway:plan.expressway,elevated=before?oldRaised:jctBefore?previousRaised:raised,checked=before?oldAudit:jctBefore?previousAudit:audit
  const parts:{name:string;color:string;geometry:any;opacity?:number}[]=[]
  const add=(name:string,color:string,mesh:BandMesh,opacity?:number)=>{if(mesh.indices.length)parts.push({name,color,geometry:serial(mesh),opacity})}
  const clip=(s:StreetSurface)=>{
    let polygon=s.polygon
    for(const [a,b,c] of [[1,0,-place.x+place.span],[-1,0,place.x+place.span],[0,1,-place.y+place.span],[0,-1,place.y+place.span]])polygon=clipStreetPolygon(polygon,a,b,c)
    return {...s,polygon}
  }
  const roads=surface.carriageways.map(clip).filter(s=>s.polygon.length),walks=surface.sidewalks.map(clip).filter(s=>s.polygon.length)
  const localBridges=new Set(surface.paths.filter((_,i)=>surface.roads[i].bridge).map(p=>p.id))
  // A finely tessellated hull reference, at the same radius as the terrain.
  const hull:BandMesh={vertices:[],indices:[]},count=Math.ceil(place.span*2/10)
  for(let i=0;i<=count;i++)for(const y of [place.y-place.span,place.y+place.span])hull.vertices.push([place.x-place.span+2*place.span*i/count,y,0])
  for(let i=1;i<=count;i++){const a=2*(i-1),b=2*i;hull.indices.push(a,a+1,b,b,a+1,b+1)}
  add('外殻基準面','#a8ae93',hull)
  if(place.id==='river'){
    const river=buildBandRiverMeshes(place.y-place.span,place.y+place.span)
    add('土と護岸','#a49b85',river.soil);add('水面','#6c9d9d',river.water,.85);add('護岸の歩道','#d1c7b2',river.walks);add('法面','#8f9f70',river.grass)
    const top=elevatedRoadMesh({id:'bridge-deck',from:'west',to:'east',width:25.5,depth:.55,
      samples:sampleElevatedRoad([[place.x-30,place.y],[place.x+30,place.y]],()=>5.2)})
    const deck=solidBandDeck(top,.55);deck.indices=deck.indices.slice(top.indices.length)
    add('橋桁の側面と下面','#847e70',deck)
  }
  add('一般道路面','#4c5759',buildBandPavement(roads,localBridges));add('道路歩道','#b8bdb7',buildBandPavement(walks,localBridges))
  if(place.id!=='river')for(let i=0;i<elevated.length;i++){
    const r=elevated[i],p=r.samples
    if(Math.max(...p.map(v=>v[0]))<place.x-place.span||Math.min(...p.map(v=>v[0]))>place.x+place.span||Math.max(...p.map(v=>v[1]))<place.y-place.span||Math.min(...p.map(v=>v[1]))>place.y+place.span)continue
    const kind=express.edges[i].kind,colour=kind==='ic-link'?'#4c5759':kind.endsWith('ramp')?'#9b86ac':'#677f88'
    add('専用道路・'+r.id,colour,buildExpresswayDeck(r))
  }
  const inView=(c:{point:number[]})=>Math.abs(c.point[0]-place.x)<place.span&&Math.abs(c.point[1]-place.y)<place.span
  scenes.push({...place,parts,junctionPoint:express.junction.point,conflicts:checked.conflicts.filter(inView),crossings:checked.crossings.filter(inView)})
}
const fullRiver=buildBandRiverMeshes(-plan.surface.site.length/2,plan.surface.site.length/2)
const graph=bandGraph(geometry.roads)
const report={generated:new Date().toISOString(),scope:'independent elevation/mesh proposal; not applied to the inhabited colony',levels:BAND_LEVELS,
  source:{id:'izma-ep04-0024',sha256:'74330871397a3b589db285d9d85f3c3e8323ff19547b5929454a827d67df056c',adopted:'upper street / lower river walk / water; no copied bridge design or combat imagery'},
  surface:{sharp:geometry.remaining.sharp.length,short:geometry.remaining.short.length,segments:geometry.roads.length,components:graph.components,cycles:graph.cycles,edits:geometry.edits.length,
    length:geometry.roads.reduce((n,r)=>n+Math.hypot(r.to[0]-r.from[0],r.to[1]-r.from[1]),0)},
  river:{length:plan.surface.site.length,triangles:Object.fromEntries(Object.entries(fullRiver).map(([name,m])=>[name,m.indices.length/3])),
    bridgeCount:geometry.roads.filter(r=>r.bridge).length,deckUnderside:5.2-.55,walkHeadroom:5.2-.55-1.26,waterHeadroom:5.2-.55-.65},
  expressway:{...audit,nonSharedConflicts:audit.conflicts.filter(c=>!c.sharedNode).length},underpasses:groundAudit,
  interchanges:{source:{id:'izma-ep03-0020',sha256:'6fe65b007a07710e9ed9b41e29f75da0042d47bfe3024c616794c440fdbb3ae5',adopted:'separated lower civilian routes below elevated structure; source does not establish an interchange layout'},
    beforeConflicts:oldAudit.conflicts.length,afterConflicts:audit.conflicts.length,
    sites:plan.expressway.interchanges.map(ic=>{const own=(c:{a:string;b:string})=>c.a.startsWith(ic.id+':')||c.b.startsWith(ic.id+':');return {id:ic.id,layout:ic.layout,gate:ic.gate,serves:ic.serves,before:oldAudit.conflicts.filter(own).length,after:audit.conflicts.filter(own).length}})},
  junction:{beforeConflicts:previousAudit.conflicts.length,afterConflicts:audit.conflicts.length,
    crossings:audit.crossings.filter(c=>c.a.includes('south-logistics-jct:')||c.b.includes('south-logistics-jct:')),
    rampGrades:audit.grades.filter(g=>g.id.startsWith('south-logistics-jct:')),
    branchLength:plan.expressway.design.routes[1].points.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-plan.expressway.design.routes[1].points[i][0],p[1]-plan.expressway.design.routes[1].points[i][1]),0)},
  generationMs:performance.now()-start,remaining:['single merge surfaces, lane movements and curve speeds for all ICs/JCT','support spans and piers','river-walk access ramps and safety barriers','existing bridge yaw and living-place integration','full surface-road/expressway width audit','LOD and physical Quest performance']}
await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(report,null,2))
await fs.writeFile(path.join(out,'scenes.json'),JSON.stringify(scenes))
const section=Array.from({length:311},(_,i)=>i-155).map(x=>`${x+155},${110-bandBankHeight(x)*15}`).join(' ')
await fs.writeFile(path.join(out,'index.html'),`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spinward — 川と道路の高さ</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f0eee7;color:#293c3d;font:15px/1.5 system-ui}main{max-width:1320px;margin:auto;padding:20px}h1{font-size:25px;margin:0}p{margin:8px 0}.muted{color:#60716b}.controls{display:flex;align-items:center;gap:18px;flex-wrap:wrap;padding:10px 0}select,button{font:inherit;padding:7px;background:#fffdf8;border:1px solid #adbbb2;border-radius:4px}#mesh{height:384px;background:#cbd3cb}canvas{display:block;width:100%;height:100%}#note{min-height:54px;background:#e3e7db;padding:10px}#status{font-size:13px}.alert{color:#923f35}.key{padding:8px;background:#fffdf8}details{margin-top:16px}code{font-size:13px}a{color:#317166}svg{max-width:640px;width:100%;height:130px}</style>
<main><h1>川と街路を、上下につなぐ</h1><p class="muted">一居住帯の立体化案。現行コロニーへは未適用。3Dの高さは実寸比、桁の厚みも表示します。</p>
<div class="controls"><label>場所 <select id="place">${places.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select></label><label>視点 <select id="view"><option value="near">低い斜め</option><option value="wide">俯瞰</option><option value="side">横から</option><option value="top">真上</option><option value="conflict">交差位置の近く</option><option value="jct-lower">JCTの下段から</option><option value="jct-upper">JCTの上段から</option><option value="ic-crossing">ICの本線下から</option><option value="west-walk">西岸の歩道から</option><option value="east-walk">東岸の歩道から</option></select></label><label><input id="issues" type="checkbox" checked>未解決箇所</label><label><input id="shadows" type="checkbox" checked>影</label><span id="gpu"></span></div>
<div id="mesh"></div><p id="note" role="status"></p><p class="key" id="dimensions">水面 0.65m ／ 川沿い歩道 1.26m ／ 上部歩道 5.06m ／ 橋面 5.20m ／ 橋桁下面 4.65m。外殻を高さ0とする設計値。</p>
<p id="status" role="status" aria-label="描画状態"></p><p class="alert">改設計全体：JCT ${report.junction.beforeConflicts}→${report.junction.afterConflicts}組、ICの残件${report.interchanges.sites.reduce((n,ic)=>n+ic.after,0)}組（共通ノードなし${audit.conflicts.filter(c=>!c.sharedNode).length}組）。変更前の図を選んだ場合も、この集計を表示します。</p>
<details><summary>橋への土の勾配と検査範囲</summary><p>下図だけ高さを15倍に拡大。上の3D表示は高さの強調なし。護岸の断面は3Dで確認できます。</p><svg viewBox="0 0 310 130" role="img" aria-label="橋のアプローチ縦断"><polyline points="${section}" fill="none" stroke="#597466" stroke-width="1"/><path d="M0 112H310" stroke="#849085"/><text x="2" y="128" font-size="9">0m</text><text x="138" y="28" font-size="9">5m</text><text x="282" y="128" font-size="9">310m</text></svg>
<p>一般道の立体横断${underpasses.length}か所、専用道路との幅の重なり${groundAudit.length}組を計算。柱、車線の合流面、護岸歩道への上下移動、柵、物理Questの性能は未実装・未検証です。</p></details><p><a href="summary.json">寸法・有限幅の干渉・未解決箇所の記録</a></p></main><script type="module" src="viewer.js"></script></html>`)
const built=await Bun.build({entrypoints:[path.resolve('qa/neighborhood-life/band-elevation-viewer.ts')],target:'browser',minify:true})
if(!built.success)throw Error(built.logs.join('\n'))
await fs.writeFile(path.join(out,'viewer.js'),await built.outputs[0].text())
console.log(JSON.stringify({surface:report.surface,river:report.river,conflicts:audit.conflicts.length,nonShared:report.expressway.nonSharedConflicts,
  maxGrade:Math.max(...audit.grades.map(g=>g.maximum)),underpasses:groundAudit.map(c=>({a:c.a,b:c.b,clearance:c.minimumClearance})),generationMs:report.generationMs},null,2))
