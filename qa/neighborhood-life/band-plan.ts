// Generate a self-contained, local planning review. No running app mutation.
import fs from 'node:fs/promises'
import path from 'node:path'
import { planCity } from '../../src/objects/cityLayout'
import { rebuildNativeDistricts } from '../../src/objects/nativeDistricts'
import { streetPathSamples } from '../../src/objects/streetPath'
import { proposedBandLand } from '../../src/objects/bandLand'
import { planBandStreets, bandGraph, type BandRoad, type BandStreetPlan } from '../../src/objects/bandStreetPlan'

const out=process.env.OUTPUT_DIR
if(!out||!path.isAbsolute(out))throw Error('OUTPUT_DIR must be an absolute directory')
await fs.mkdir(out,{recursive:true})
const site=proposedBandLand(),start=performance.now(),proposed=planBandStreets(site),elapsed=performance.now()-start
const closed=planBandStreets({...site,crossings:site.crossings.filter(c=>c.id!=='existing-river-bridge')})
const city=planCity({radius:3200,length:40000,maxBuildings:18000});rebuildNativeDistricts(city,3200)
const current:BandRoad[]=city.streetNetwork!.streets.filter(s=>s.kind==='arterial'||s.kind==='collector').flatMap(s=>{
  const p=streetPathSamples(s,.3).map(p=>[Math.atan2(Math.sin(s.azimuth),Math.cos(s.azimuth))*3200+p.x,s.axial+p.y] as [number,number])
  return p.slice(1).flatMap((to,i)=>Math.min(Math.abs(p[i][0]),Math.abs(to[0]))>site.width/2+40?[]:[{from:p[i],to,kind:s.kind as BandRoad['kind'],reason:'current'}])
})
const summary=(p:BandStreetPlan)=>{
  const g=bandGraph(p.roads)
  return {segments:p.roads.length,centres:p.site.centres.length,demand:p.demand.length,unallocatedDemand:p.unallocatedDemand,unconnected:p.unconnected,
    components:g.components,cycles:g.cycles,degree:g.degree.reduce((o,n)=>(o[n]=(o[n]??0)+1,o),{} as Record<number,number>),
    lengthMetres:p.roads.reduce((s,r)=>s+Math.hypot(r.from[0]-r.to[0],r.from[1]-r.to[1]),0),
    bridges:[...new Set(p.roads.map(r=>r.bridge).filter(Boolean))],regionalLinks:p.links.filter(l=>l.added),localLinks:p.localLinks.length}
}
const report={generated:new Date().toISOString(),scope:'planning only; simulation remains unchanged',dimensions:{width:site.width,length:site.length},elapsedMs:elapsed,currentPolylineSegments:current.length,proposed:summary(proposed),closed:summary(closed)}
await fs.writeFile(path.join(out,'plan.json'),JSON.stringify({report,proposed,closed,current},null,2))
const colours={water:'#adcbd2',facility:'#dfc7b7',green:'#cad9b7'}
const pt=(p:number[])=>`${p[1].toFixed(3)},${(-p[0]).toFixed(3)}`
const esc=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')
const roadSvg=(roads:BandRoad[])=>roads.map(r=>`<path class="${r.kind}${r.bridge?' bridge':''}" d="M${pt(r.from)}L${pt(r.to)}"/>`).join('')
const labels:Record<string,string>={'south-port':'南端物流','repair':'整備地区','south-market':'南部商業','garden-housing':'南部住宅','civic':'公共施設','campus':'学園地区','old-town':'旧市街','arrival':'到着地区','east-bank':'東岸住宅','west-bank':'西岸住宅','park-centre':'公園周辺','north-market':'北部商業','north-works':'北部工業','north-housing':'北部住宅','north-port':'北端物流'}
const landSvg=(p:BandStreetPlan)=>p.site.reserves.map(r=>`<polygon points="${r.polygon.map(pt).join(' ')}" fill="${colours[r.kind]}"/>`).join('')
const centreSvg=(p:BandStreetPlan)=>p.site.centres.map(c=>`<g class="centre"><circle cx="${c.point[1]}" cy="${-c.point[0]}" r="30" fill="${c.use==='centre'?'#ab493a':'#555b60'}"/><text x="${c.point[1]+50}" y="${-c.point[0]-55}" font-size="80" fill="#24383a">${labels[c.id]??esc(c.id)}</text></g>`).join('')
const frame=`<rect x="${-site.length/2}" y="${-site.width/2}" width="${site.length}" height="${site.width}" fill="#f5f3eb"/>`
const box=[-site.length/2,-site.width/2,site.length,site.width].join(' ')
const chart=(content:string,id:string,overview=false)=>`<svg id="${id}" ${overview?'class="overview"':'class="detail"'} viewBox="${box}" role="img" aria-label="${id}">${frame}${content}</svg>`
const baseContent=roadSvg(current),newContent=(p:BandStreetPlan)=>landSvg(p)+roadSvg(p.roads)+centreSvg(p)
const initial=newContent(proposed)
const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spinward — 居住帯全域の道路計画</title>
<style>*{box-sizing:border-box}body{margin:0;background:#eae8de;color:#24383a;font:15px/1.6 system-ui,sans-serif}main{max-width:1440px;margin:0 auto;padding:32px}h1{font-size:28px;margin:6px 0}h2{font-size:17px;margin:0 0 8px}p{margin:8px 0}.eyebrow{letter-spacing:.12em;font-size:12px;color:#687675}.note{color:#62706d;max-width:1050px}.controls{display:flex;gap:22px;align-items:center;flex-wrap:wrap;background:#fffdf6;padding:16px;border-radius:8px;margin:20px 0}select,input,button{font:inherit}select{padding:6px}input[type=range]{width:240px}article{background:#fffdf6;border:1px solid #d3d7cb;border-radius:8px;padding:16px;margin:12px 0}.compare{display:grid;grid-template-columns:1fr 1fr;gap:16px}.detail{width:100%;height:440px}.overview{display:block;width:100%;height:115px}.arterial,.collector{fill:none;vector-effect:non-scaling-stroke;stroke-linecap:round;stroke-linejoin:round}.arterial{stroke:#334e50;stroke-width:2}.collector{stroke:#7b8980;stroke-width:1}.bridge{stroke:#b35d2e;stroke-width:3}.overview .arterial{stroke-width:1.1}.overview .collector{stroke-width:.65}.overview .centre{display:none}.major-only .collector{display:none}#facts{font-variant-numeric:tabular-nums}.legend{display:flex;gap:20px;flex-wrap:wrap;font-size:13px}.legend span:before{content:'';display:inline-block;width:14px;height:10px;margin-right:6px;background:var(--c)}.badge{color:#a15235;font-size:12px}@media(max-width:850px){main{padding:16px}.compare{grid-template-columns:1fr}.controls{gap:12px}}</style>
<main><div class="eyebrow">SPINWARD / LAND BAND 01 / PLANNING STUDY</div><h1>街区を置く前に、街の骨格を決める</h1><p class="note">約39.8km × 3.15kmを同じ縮尺で比較。現行の幹線・集散道路と、土地・地区中心・渡河地点から生成した計画です。新案の川筋・施設・地区名は独自の仮配置。既存の橋の中心位置を1地点だけ引き継いでいます。</p>
<div class="controls"><label>渡河条件（新案） <select id="scenario"><option value="proposed">4地点で渡河可能</option><option value="closed">既存の橋を閉鎖</option></select></label><label>道路 <select id="roads"><option value="all">幹線＋集散道路</option><option value="major">幹線のみ</option></select></label><label>詳細の中心 <input id="position" type="range" min="-16800" max="16800" step="100" value="1400"><output id="station">+1.4 km</output></label><label>詳細の幅 <select id="span"><option value="6000">6 km</option><option value="12000">12 km</option><option value="39840">全域</option></select></label></div>
<div class="legend"><span style="--c:#334e50">幹線</span><span style="--c:#7b8980">集散道路</span><span style="--c:#b35d2e">渡河区間</span><span style="--c:#adcbd2">河川・護岸の確保範囲</span><span style="--c:#cad9b7">緑地</span><span style="--c:#dfc7b7">施設保留地</span></div>
<article><h2>現行の全域 <span class="badge">現在のプレビューと同じ配置</span></h2>${chart(baseContent,'current-overview',true)}</article>
<article><h2>新案の全域 <span class="badge">生成器の計画図・3Dへの切替前</span></h2>${chart(initial,'proposal-overview',true)}<p id="facts"></p></article>
<div class="compare"><article><h2>現行 / 詳細</h2>${chart(baseContent,'current-detail')}</article><article><h2>新案 / 同じ範囲</h2>${chart(initial,'proposal-detail')}</article></div>
<p class="note">線は中心線で、太さは識別用です。住宅路地・敷地・建物を埋める前の骨格なので、道路本数や空白量の直接比較は完成度を表しません。橋の閉鎖で別の渡河点へ接続が移ることを確認できます。</p><p class="note">残件：交差点の角度と曲率、橋の高さ・斜面、施設や密度の再検討、地区内の細街路・敷地・建物、交通・案内・遠景との接続。灰色の小道が長い行き止まりになる箇所も含む設計途中の図です。現在の3D体験には適用していません。</p></main>
<script>const variants=${JSON.stringify({proposed:{content:newContent(proposed),report:summary(proposed)},closed:{content:newContent(closed),report:summary(closed)}}).replaceAll('<','\u003c')};const frame=${JSON.stringify(frame)};function draw(){const v=variants[document.querySelector('#scenario').value];for(const id of ['proposal-overview','proposal-detail'])document.getElementById(id).innerHTML=frame+v.content;document.body.classList.toggle('major-only',document.querySelector('#roads').value==='major');const span=+document.querySelector('#span').value,pos=Math.max(-19920+span/2,Math.min(19920-span/2,+document.querySelector('#position').value));for(const id of ['current-detail','proposal-detail']){const svg=document.getElementById(id);svg.setAttribute('viewBox',[pos-span/2,-${site.width/2},span,${site.width}].join(' '));svg.querySelector('.scale')?.remove();svg.insertAdjacentHTML('beforeend','<g class="scale"><path d="M'+(pos-span/2+160)+','+(${site.width/2}-160)+'h1000" fill="none" stroke="#334e50" stroke-width="2" vector-effect="non-scaling-stroke"/><text x="'+(pos-span/2+160)+'" y="'+(${site.width/2}-250)+'" font-size="'+(span/svg.clientWidth*12)+'" fill="#334e50">1 km</text></g>');svg.querySelectorAll('.centre text').forEach(t=>{t.setAttribute('font-size',String(span/svg.clientWidth*12));t.style.display=span>12000?'none':'';t.setAttribute('paint-order','stroke');t.setAttribute('stroke','#f5f3eb');t.setAttribute('stroke-width',String(span/svg.clientWidth*3))});}for(const id of ['current-overview','proposal-overview']){const svg=document.getElementById(id);svg.querySelector('.focus-window')?.remove();svg.insertAdjacentHTML('beforeend','<rect class="focus-window" x="'+(pos-span/2)+'" y="${-site.width/2}" width="'+span+'" height="${site.width}" fill="none" stroke="#bd633b" stroke-width="2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>')}document.querySelector('#station').textContent=(pos>=0?'+':'')+(pos/1000).toFixed(1)+' km';const r=v.report;document.querySelector('#facts').textContent=r.centres+'地区の中心 / '+r.bridges.length+'渡河地点を使用 / '+r.components+'つの接続網 / '+r.cycles+'個の独立した周回経路 / 孤立した目的地 '+r.unconnected.length;};document.querySelectorAll('select,input').forEach(e=>e.addEventListener('input',draw));draw();</script></html>`
await fs.writeFile(path.join(out,'map.html'),html)
await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(report,null,2))
console.log(JSON.stringify(report,null,2))
