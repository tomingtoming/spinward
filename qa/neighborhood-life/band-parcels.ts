import fs from 'node:fs/promises'
import path from 'node:path'
import {proposedBandLand} from '../../src/objects/bandLand'
import {proposedBandExpressway} from '../../src/objects/bandExpresswayLand'
import {planBandTransport} from '../../src/objects/bandExpressway'
import {prepareBandStreetGeometry} from '../../src/objects/bandStreetGeometry'
import {planBandParcels} from '../../src/objects/bandParcels'
import {bandLivingPlaces} from '../../src/objects/bandLivingPlaces'
import {bandPublicPlaces} from '../../src/objects/bandPublicPlaces'
import {planBandEntranceWalks} from '../../src/objects/bandEntranceWalks'
import {bandGraph} from '../../src/objects/bandStreetPlan'

const out=process.env.OUTPUT_DIR
if(!out||!path.isAbsolute(out))throw Error('OUTPUT_DIR must be absolute')
await fs.mkdir(out,{recursive:true})
const start=performance.now(),transport=planBandTransport(proposedBandLand(),proposedBandExpressway()),geometry=prepareBandStreetGeometry(transport.surface)
const roadMs=performance.now()-start,parcelStart=performance.now(),land=planBandParcels(transport.surface,3200,geometry),parcelMs=performance.now()-parcelStart
const g=bandGraph(geometry.roads),places=bandLivingPlaces(),publicPlaces=bandPublicPlaces(),site=transport.surface.site
const walks=planBandEntranceWalks(land)
const summary={date:new Date().toISOString(),scope:'Whole-band subdivision, protected living/public places and three certified entrances; not the active colony or zoning',
  reference:{id:'izma-ep05-0039',sha256:'f12cea4b1e98d69771eacac21cfcf3a84240aae1ec5c241bf08230ddffd96088'},
  roadMs,parcelMs,blocks:land.blocks.length,candidates:land.parcels.length,totalArea:land.totalArea,landArea:land.landArea,parcelArea:land.parcelArea,
  unallocatedArea:land.unallocatedArea,unallocatedFraction:land.unallocatedArea/land.landArea,
  roads:geometry.roads.length,components:g.components,cycles:g.cycles,issues:geometry.remaining,
  livingPlaces:places.map(p=>({id:p.id,entrance:p.entrance,gate:p.access.point,links:transport.surface.accessLinks.filter(l=>l.access===p.access.id)})),
  publicPlaces,entranceWalks:walks.map(({place,walk,rejected})=>({id:place.id,rejected,length:walk?.length,grade:walk?.maximumGrade}))}
await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2))
const points=(p:{x:number;y:number}[])=>p.map(v=>[v.x,v.y])
const data={site,places,publicPlaces,summary,blocks:land.blocks.map(b=>({area:b.area,pieces:b.pieces.map(points)})),
  parcels:land.parcels.map(p=>({id:p.id,pieces:p.pieces.map(points),building:p.building})),
  carriageways:geometry.carriageways.map(s=>points(s.polygon)),sidewalks:geometry.sidewalks.map(s=>points(s.polygon))}
await fs.writeFile(path.join(out,'land.json'),JSON.stringify(data))
await fs.writeFile(path.join(out,'index.html'),`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spinward — 全域の土地と敷地</title>
<style>*{box-sizing:border-box}body{margin:0;background:#efeee7;color:#283b3b;font:15px/1.6 system-ui}main{max-width:1480px;margin:auto;padding:22px}h1{font-size:26px;margin:3px 0}p{margin:7px 0}.muted{color:#64716b}.metrics{display:flex;gap:35px;margin:14px 0}.metrics strong{display:block;font-size:23px}.metrics span{font-size:13px}.controls{display:flex;gap:22px;align-items:center;flex-wrap:wrap;background:#fffdf6;padding:10px 14px}select{font:inherit;padding:6px;background:white;border:1px solid #abb5aa}.maps{display:grid;grid-template-columns:110px 1fr;gap:14px;margin-top:12px}canvas{width:100%;height:clamp(260px,calc(100vh - 440px),520px);display:block;background:#dde3d8;border:1px solid #bdc8b9}#map{touch-action:none;cursor:grab}.legend{font-size:13px}#status{min-height:27px}.note{background:#e4e7dc;padding:10px 14px}a{color:#386a62}@media(max-width:700px){main{padding:10px}h1{font-size:20px}p{font-size:12px}.maps{grid-template-columns:48px 1fr;gap:8px}.metrics{gap:15px;margin:8px 0}.metrics strong{font-size:18px}.metrics span{font-size:11px}.controls{gap:8px;padding:8px;font-size:12px}select{font-size:12px}.legend{font-size:11px}canvas{height:330px}.note{font-size:11px;padding:7px}#status{font-size:11px;min-height:20px}}</style>
<main><p class="muted">SPINWARD / 一居住帯の土地利用案</p><h1>道に接する敷地と、残しておく土地</h1>
<p>川・施設・高速道路と生活拠点を先に確保。一本の居住帯をまとめて切り分け、道路に接する場所から建物候補を置いています。</p>
<p class="muted">現行コロニーへは未適用。建物の用途・高さ・庭・徒歩動線はこれから決めます。</p>
<div class="metrics"><div><strong>${land.blocks.length}</strong><span>道路と予約地が分ける街区</span></div><div><strong>${land.parcels.length.toLocaleString('en-US')}</strong><span>建物が収まる沿道区画候補</span></div><div><strong>${(land.unallocatedArea/land.landArea*100).toFixed(1)}%</strong><span>残った土地のうち未割当</span></div></div>
<div class="controls"><label>場所 <select id="focus" disabled><option value="arrival">到着地区・既存の生活拠点</option><option value="public">中央広場と公園</option><option value="garden">Garden streetと川沿い</option><option value="cafe">カフェとアパート</option><option value="lobby">ロビー</option><option value="market">南部商業・住宅地区</option><option value="park">北部の公園地区</option><option value="port">南端物流JCTと港</option></select></label><label><input id="parcels" type="checkbox" checked>沿道区画</label><label><input id="buildings" type="checkbox" checked>建物候補の輪郭</label><button id="reset">表示を戻す</button></div>
<p class="legend">薄緑：未割当を含む土地　黄土の色分け：沿道区画　濃灰：建物候補　緑の輪郭：既存の公共空間　灰：道路・歩道　青：川の予約地　紫：高速道路の予約地　淡桃：施設の予約地　橙：既存3拠点の保護域</p>
<div class="maps"><canvas id="overview" role="img" aria-label="居住帯全体と表示中の範囲"></canvas><canvas id="map" role="img" aria-label="道路、区画、建物候補と保護する生活拠点"></canvas></div>
<p id="status" role="status">土地を読み込み中…</p><p class="note">区画の色は境界を見分けるための表示です。橙の点線は入口と道路の接続候補で、横断や歩行経路の安全を確認した線ではありません。道路から遠い奥の土地は自動で埋めません。</p>
<p class="muted">ドラッグで移動、ホイールで拡大。左は全長39.84kmの全域図。右の範囲を枠で示します。<a href="summary.json">集計と接続記録</a></p></main><script type="module" src="viewer.js"></script></html>`)
const build=await Bun.build({entrypoints:[path.resolve('qa/neighborhood-life/band-parcels-viewer.ts')],target:'browser',minify:true})
if(!build.success)throw Error(build.logs.join('\n'))
await fs.writeFile(path.join(out,'viewer.js'),await build.outputs[0].text())
console.log(JSON.stringify(summary,null,2))
