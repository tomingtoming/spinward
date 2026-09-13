// Width-accurate review; generated artifacts stay in an explicit ignored folder.
import fs from 'node:fs/promises'
import path from 'node:path'
import { proposedBandLand } from '../../src/objects/bandLand'
import { proposedBandExpressway } from '../../src/objects/bandExpresswayLand'
import { planBandTransport } from '../../src/objects/bandExpressway'
import { bandGraph } from '../../src/objects/bandStreetPlan'
import { prepareBandStreetGeometry } from '../../src/objects/bandStreetGeometry'
import { StreetSurfacePlan, type StreetSurface } from '../../src/objects/streetSurfacePlan'
import { getStreetProfile } from '../../src/objects/streetProfile'
import { buildStreetSurfaceGeometry } from '../../src/objects/streetSurfaceGeometry'

const out=process.env.OUTPUT_DIR
if(!out||!path.isAbsolute(out))throw Error('OUTPUT_DIR must be absolute')
await fs.mkdir(out,{recursive:true})
const plan=planBandTransport(proposedBandLand(),proposedBandExpressway()).surface,start=performance.now()
const after=prepareBandStreetGeometry(plan),elapsed=performance.now()-start
const rawPaths=plan.roads.map((r,i)=>{const tangent:[number,number]=[r.to[0]-r.from[0],r.to[1]-r.from[1]];return {
  id:`before-${i}`,azimuth:0,axial:0,level:0,groundHeight:0,kind:r.kind,width:getStreetProfile(r.kind).carriageway,
  knots:[{point:r.from,tangent},{point:r.to,tangent}]}})
const raw=new StreetSurfacePlan(rawPaths,3200),before={roads:plan.roads,carriageways:raw.roadSurfaces(),sidewalks:raw.sidewalks()}
const stats=(p:typeof before)=>{
  const g=bandGraph(p.roads),lengths=p.roads.map(r=>Math.hypot(r.to[0]-r.from[0],r.to[1]-r.from[1]))
  return {segments:p.roads.length,components:g.components,cycles:g.cycles,totalMetres:lengths.reduce((a,b)=>a+b,0),shortestSampleMetres:Math.min(...lengths),
    carriagewayPieces:p.carriageways.length,sidewalkPieces:p.sidewalks.length}
}
const meshes=[before,after].map(p=>[p.carriageways,p.sidewalks].map(s=>{
  const geometry=buildStreetSurfaceGeometry(s,3200,10)!,json=geometry.toJSON();geometry.dispose();return json
}))
const report={date:new Date().toISOString(),scope:'whole-band ground-road geometry only; not active 3D colony, bridge elevations or expressway engineering',
  referenceHashes:{'izma-ep07-0092':'3d436a496f758f8aa88f392078f5038e78ca33ad8b50fb4c3fe073da4dfc9a28','izma-ep04-0024':'74330871397a3b589db285d9d85f3c3e8323ff19547b5929454a827d67df056c'},
  refinementAndSurfacesMs:elapsed,before:{...stats(before),issues:after.before},after:{...stats(after),issues:after.remaining},edits:after.edits,
  triangles:meshes.map(pair=>pair.map(g=>g.data.index.array.length/3))}
await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(report,null,2))
await fs.writeFile(path.join(out,'plan.json'),JSON.stringify({site:plan.site,before:plan.roads,after:after.roads},null,2))
const surface=(s:StreetSurface)=>s.polygon.map((p,i)=>(i?'L':'M')+`${p.x},${-p.y}`).join(' ')+'Z'
const colours={water:'#b4d1d5',green:'#bfcea9',facility:'#dcc9b3',transport:'#d6c8e2'}
const land=plan.site.reserves.map(r=>`<path d="${r.polygon.map((p,i)=>(i?'L':'M')+`${p[0]},${-p[1]}`).join(' ')}Z" fill="${colours[r.kind]}"/>`).join('')
const anchors=[...plan.site.centres.map(c=>({point:c.point,name:c.id})),...plan.site.accesses!.map(a=>({point:a.point,name:a.id}))]
  .map(a=>`<circle cx="${a.point[0]}" cy="${-a.point[1]}" r="4" fill="#d9822c"><title>${a.name}</title></circle>`).join('')
const map=(p:typeof before,i:number)=>`<svg role="img" aria-label="${i?'整理後の道路面':'整理前の道路面'}" id="map-${i}" viewBox="-100 -150 300 300">
  <rect x="-1575" y="-19920" width="3150" height="39840" fill="#e7e6d9"/>${land}
  <g fill="#adbbb9">${p.sidewalks.map(s=>`<path d="${surface(s)}"/>`).join('')}</g>
  <g fill="#4c5b60">${p.carriageways.map(s=>`<path d="${surface(s)}"/>`).join('')}</g>
  <g class="centrelines">${p.roads.map(r=>`<path d="M${r.from[0]},${-r.from[1]}L${r.to[0]},${-r.to[1]}"/>`).join('')}</g>${anchors}
  <g fill="none" stroke="#c2503b" stroke-width="2" vector-effect="non-scaling-stroke">${(i?after.remaining:after.before).sharp.map(s=>`<circle cx="${s.point[0]}" cy="${-s.point[1]}" r="25" stroke="#e06542" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`).join('')}</g>
</svg>`
const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spinward — 道路幅と合流</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f0eee7;color:#293c3d;font:15px/1.6 system-ui}main{max-width:1440px;margin:auto;padding:24px}h1{font-size:26px;margin:4px 0}h2{font-size:16px;margin:4px 0}p{margin:8px 0}.muted{color:#657572}.controls{display:flex;gap:16px;flex-wrap:wrap;align-items:center;background:#fffdf8;padding:12px;margin:16px 0}select,button{font:inherit;padding:7px;border:1px solid #aab8b1;border-radius:4px;background:white}.compare{display:grid;grid-template-columns:1fr 1fr;gap:18px}.compare article{background:#fffdf8;padding:12px}svg{width:100%;height:480px;display:block}.centrelines path{fill:none;stroke:#f2d69a;stroke-width:.75;vector-effect:non-scaling-stroke;stroke-dasharray:4 4}.hide-lines .centrelines{display:none}.legend{font-size:13px}#mesh{height:520px;background:#d5ded9;margin-top:8px}canvas{display:block;width:100%;height:100%}.mesh-labels{display:flex;justify-content:space-around;font-weight:600}.metric{font-size:13px;color:#72557f}#focus-note{min-height:50px;padding:10px;background:#e4e7dc}a{color:#397364}@media(max-width:800px){main{padding:12px}.compare{grid-template-columns:1fr}svg{height:430px}}</style>
<main><p class="muted">SPINWARD / 一居住帯の道路形状</p><h1>近い交差点をまとめ、並走する合流を共有する</h1>
<p>車道は幹線19.5m・集散道路12m、歩道は片側3m・2.5m。線幅を誇張せず、共通の路面生成処理が作る多角形を表示します。</p>
<p class="muted">全域案の一般道を検討する段階です。現行コロニーの配置には未反映。橋や高速道路の高さ・ランプの設計は含みません。</p>
<div class="controls"><label>場所 <select id="focus"><option value="south">南端ICの近接合流</option><option value="east">東岸の合流</option><option value="short">公園地区の0.64m区間</option><option value="north">北部の残る鋭角</option></select></label><label><input id="lines" type="checkbox" checked>中心線を表示</label></div>
<p id="focus-note" role="status"></p><p class="legend">濃灰：車道　薄灰：歩道　紫：専用道路の予約地　赤円：30°未満の合流　橙点：固定した地区中心・IC。両図は同じ範囲・縮尺。</p>
<div class="compare"><article><h2>整理前</h2><p class="metric">鋭角 ${after.before.sharp.length} / 20m未満の交差点間 ${after.before.short.length}</p>${map(before,0)}</article><article><h2>整理後</h2><p class="metric">鋭角 ${after.remaining.sharp.length} / 20m未満の交差点間 ${after.remaining.short.length}</p>${map(after,1)}</article></div>
<h2>円筒面へ変換した路面の形状確認</h2><p class="muted">上の多角形から実行アプリと同じメッシュ生成器で作成。建物・地形・照明を省いた検査表示です。歩道端・交差部の角丸や勾配は今後の工程です。</p>
<div class="controls"><button id="angle">斜めから見る</button><button id="night">暗い背景で見る</button><span id="gpu" class="muted"></span></div><div class="mesh-labels"><span>整理前</span><span>整理後</span></div><div id="mesh"></div>
<p class="metric" id="mesh-status"></p><p><a href="summary.json">寸法・接続・未解決箇所の記録</a></p></main>
<script>window.bandGeometryReview=${JSON.stringify({meshes}).replaceAll('<','\\u003c')};</script><script src="viewer.js"></script></html>`
await fs.writeFile(path.join(out,'map.html'),html)
const built=await Bun.build({entrypoints:[path.resolve('qa/neighborhood-life/band-street-geometry-viewer.ts')],target:'browser',minify:true})
if(!built.success)throw Error(built.logs.join('\n'))
await fs.writeFile(path.join(out,'viewer.js'),await built.outputs[0].text())
console.log(JSON.stringify(report,null,2))
