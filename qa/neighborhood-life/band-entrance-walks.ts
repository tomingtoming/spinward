import fs from 'node:fs/promises'
import path from 'node:path'
import {proposedBandLand} from '../../src/objects/bandLand'
import {proposedBandExpressway} from '../../src/objects/bandExpresswayLand'
import {planBandTransport} from '../../src/objects/bandExpressway'
import {planBandParcels} from '../../src/objects/bandParcels'
import {planBandEntranceWalks} from '../../src/objects/bandEntranceWalks'
import {interiorPartBuilding} from '../../src/objects/buildingInteriors'
import cafe from '../../assets/blender/cafe-pilot.json'
import lobby from '../../assets/blender/lobby-pilot.json'
import apartment from '../../assets/blender/nyaan-apartment.json'

const out=process.env.OUTPUT_DIR
if(!out||!path.isAbsolute(out))throw Error('OUTPUT_DIR must be absolute')
await fs.mkdir(out,{recursive:true})
const start=performance.now(),transport=planBandTransport(proposedBandLand(),proposedBandExpressway()),land=planBandParcels(transport.surface)
const planningMs=performance.now()-start,walkStart=performance.now(),results=planBandEntranceWalks(land),certifyMs=performance.now()-walkStart
if(results.some(r=>!r.walk))throw Error(JSON.stringify(results.map(r=>({id:r.place.id,rejected:r.rejected}))))
const summary={scope:'One proposed band; three door-to-sidewalk connections. Inhabited colony not switched.',planningMs,certifyMs,
  blocks:land.blocks.length,candidates:land.parcels.length,landArea:land.landArea,parcelArea:land.parcelArea,unallocatedFraction:land.unallocatedArea/land.landArea,
  issues:land.geometry.remaining,walks:results.map(({place,walk:w})=>({id:place.id,door:place.entrance,gate:place.access.point,
    length:w!.length,width:w!.width,grade:w!.maximumGrade,landing:w!.landing,triangles:w!.surfaceMesh.length/9}))}
const data=results.map(({place,walk:w})=>{
  const near=(p:any[])=>Math.min(...p.map(v=>v.x))<w!.entrance.x+80&&Math.max(...p.map(v=>v.x))>w!.entrance.x-80&&Math.min(...p.map(v=>v.y))<w!.entrance.y+80&&Math.max(...p.map(v=>v.y))>w!.entrance.y-80
  const model={cafe,lobby,apartment}[place.id]
  return{place,walk:w,sidewalks:land.geometry.sidewalks.filter(s=>near(s.polygon)),roads:land.geometry.carriageways.filter(s=>near(s.polygon)),
    parts:model.interior.parts.map(p=>({box:interiorPartBuilding(model.interior as any,p as any,3200),material:p.material}))}
})
await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2))
await fs.writeFile(path.join(out,'walks.json'),JSON.stringify(data))
await fs.writeFile(path.join(out,'index.html'),`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spinward — 玄関と歩道</title>
<style>*{box-sizing:border-box}body{margin:0;background:#ecece3;color:#273e3c;font:15px/1.6 system-ui}main{max-width:1400px;margin:auto;padding:18px}h1{font-size:26px;margin:0}p{margin:7px 0}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center;padding:12px 0}button,select{font:inherit;padding:7px;border:1px solid #9da99b;background:#fffdf5;color:inherit;border-radius:4px}#mesh{height:clamp(280px,calc(100vh - 360px),620px);min-height:280px}canvas{display:block;width:100%;height:100%}.small{font-size:12px;color:#54655c}#status{min-height:27px}#measure{font-weight:600}a{color:#386a62}@media(max-width:600px){main{padding:10px}h1{font-size:21px}p{font-size:12px}.controls{gap:6px}button,select{font-size:12px}#mesh{height:360px}}</style>
<main><p class="small">SPINWARD / 新しい街の入口を検証</p><h1>玄関から、手前の歩道まで</h1><p>既存の3拠点を動かさず、幅2mの緩い通路で接続。車道へ出る手前で歩道に着きます。</p>
<div class="controls"><label>場所 <select id="focus" disabled><option value="cafe">カフェ</option><option value="lobby">ロビー</option><option value="apartment">アパート</option></select></label><button id="overview">全体を見る</button><button id="walk">玄関から歩道まで歩く</button><button id="back">歩道から玄関へ戻る</button></div>
<p id="measure"></p><div id="mesh"></div><p id="status" role="status">読み込み中…</p><p class="small">白茶：接続通路　灰緑：既存幅の歩道　濃灰：車道　青線：今回検証する案内。建物は作者モデルの室内構造で入口の位置を確認しています。</p><p class="small">独立した計画検証です。現行コロニーへの切替、街区をまたぐ徒歩案内、仕上げの景観は未完。歩行表示は既存の足元計算を使う定速カメラです。</p><p class="small" id="gpu"></p><a href="summary.json">数値記録</a></main><script type="module" src="viewer.js"></script></html>`)
const build=await Bun.build({entrypoints:[path.resolve('qa/neighborhood-life/band-entrance-walks-viewer.ts')],target:'browser',minify:true})
if(!build.success)throw Error(build.logs.join('\n'))
await fs.writeFile(path.join(out,'viewer.js'),await build.outputs[0].text())
console.log(JSON.stringify(summary,null,2))
