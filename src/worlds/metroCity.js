import * as T from 'three'
import {MetroTiles,fetchMetroTile,fetchCompressedJSON} from './plateau/metro-tiles.js'
import {fetchTile,nativeTiles} from './plateau/base-tiles.js'
import {yieldScene} from './plateau/tile-worker-client.js'
import {LowriseStream} from './plateau/lowrise-stream.js'
import {FacadeInstances} from './plateau/facade-instances.js'
import {FacadeStream} from './plateau/facade-stream.js'
import {FacadeContacts} from './plateau/facade-contacts.js'
import {MetroCollision,metroCollisionParts} from './metroCollision'
import {MetroRoads,metroRoadsMatchStudy} from './metroRoads'
import {metroPlacementMatrix,metroSurfaceLocation,metroArrivalOrientation} from './metroPlacement'
import {NightPaneStream} from './plateau/night-pane-stream.js'
import {MetroNight} from './plateau/metro-night.js'
import {MetroTrees} from './plateau/metro-trees.js'
import {createMetroCredits} from './plateau/metro-credits.js'
import {metroPlacesForStudy} from './metroPlaces'
import {readMetroJSON,loadMetroRelease,objectHash,metroDataURL} from './plateau/data-source.js'
import {distantDetail,selectTerrainLOD} from './plateau/adaptive-detail.js'
import {metroRenderBudget} from './plateau/render-budget.js'

const read=readMetroJSON
export async function loadMetroCity(tier='desktop'){
  if(import.meta.env.VITE_METRO_RELEASE){
    const c=await loadMetroRelease(import.meta.env.VITE_METRO_RELEASE)
    const frames=JSON.stringify(c.study.samples.map(s=>[s.id,s.band,s.frame]))
    if(!c.study.ready||c.study.radius!==3200||c.study.span!==40000)throw Error('Incompatible metro release dimensions')
    for(const manifest of [c.finish,c.lowrise,c.night,c.night?.obstruction])if(manifest&&(!manifest.ready||JSON.stringify(manifest.frames)!==frames))throw Error('Incompatible metro release frames')
    if(c.roads&&!metroRoadsMatchStudy(c.roads,c.study))throw Error('Incompatible metro release roads')
    const catalogs=c.study.samples.map(sample=>({sample,base:c.geometry[sample.id],facades:{sites:[]}}))
    return new MetroCity(c.study,c.arrivals,c.kit,catalogs,c.finish,c.lowrise,c.roads,c.night,null,c,tier)
  }
  const [study,arrivals,kit]=await Promise.all([read('/metro-overview.json'),read('/metro-arrivals.json'),read(import.meta.env.VITE_METRO_FACADE_KIT??'/facade-kit.json')])
  const finish=import.meta.env.VITE_METRO_FINISH?await read(import.meta.env.VITE_METRO_FINISH):null
  const lowrise=import.meta.env.VITE_METRO_LOWRISE?await read(import.meta.env.VITE_METRO_LOWRISE):null
  const nightPanes=import.meta.env.VITE_METRO_NIGHT_PANES?await read(import.meta.env.VITE_METRO_NIGHT_PANES):null
  if(nightPanes&&(!nightPanes.ready||JSON.stringify(nightPanes.frames)!==JSON.stringify(study.samples.map(s=>[s.id,s.band,s.frame]))))throw Error('Tokyo night panes have incompatible source frames')
  const night=import.meta.env.VITE_METRO_NIGHT?await read(import.meta.env.VITE_METRO_NIGHT):null
  if(night&&(!night.ready||JSON.stringify(night.frames)!==JSON.stringify(study.samples.map(s=>[s.id,s.band,s.frame]))))throw Error('Tokyo night has incompatible source frames')
  const obstruction=import.meta.env.VITE_METRO_OBSTRUCTION?await read(import.meta.env.VITE_METRO_OBSTRUCTION):null
  if(obstruction&&(!obstruction.ready||JSON.stringify(obstruction.frames)!==JSON.stringify(study.samples.map(s=>[s.id,s.band,s.frame]))))throw Error('Tokyo roof lights have incompatible source frames')
  if(night)night.obstruction=obstruction
  const roads=import.meta.env.VITE_METRO_ROADS?await read(import.meta.env.VITE_METRO_ROADS):null
  if(roads&&!metroRoadsMatchStudy(roads,study))throw Error('Tokyo roads have incompatible source frames or structure bands')
  if(finish&&(!finish.ready||JSON.stringify(finish.frames)!==JSON.stringify(study.samples.map(s=>[s.id,s.band,s.frame]))))throw Error('Tokyo finish has incompatible source frames')
  if(lowrise&&(!lowrise.ready||JSON.stringify(lowrise.frames)!==JSON.stringify(study.samples.map(s=>[s.id,s.band,s.frame]))))throw Error('Tokyo district LOD has incompatible source frames')
  if(!study.ready||study.radius!==3200||study.span!==40000)throw Error('Tokyo world has incompatible dimensions')
  const catalogs=await Promise.all(study.samples.map(async s=>({sample:s,
    base:await read('/'+s.id+'/base.json'),facades:await read(import.meta.env.VITE_METRO_FACADE_CATALOG?`${import.meta.env.VITE_METRO_FACADE_CATALOG}/${s.id}.json`:'/'+s.id+'/facades.json')})))
  return new MetroCity(study,arrivals,kit,catalogs,finish,lowrise,roads,night,nightPanes,null,tier)
}

class MetroCity{
  constructor(study,arrivals,kit,catalogs,finish,lowrise,roads,night,nightPanes,releaseData=null,tier='desktop'){
    this.renderBudget=metroRenderBudget(tier)
    this.xrDetailLevel=0;this.detailSelectionAt=-Infinity
    this.places=metroPlacesForStudy(study)
    arrivals={...arrivals,...Object.fromEntries(this.places.map(p=>[p.id,p]))}
    Object.assign(this,{study,arrivals,kit,catalogs,finish,lowrise,night,nightPanes})
    this.release=releaseData?.release;this.detailPaths=releaseData?.details;this.farPaths=releaseData?.far
    this.roads=roads?new MetroRoads(roads):null;this.roadMeshes=[];this.structuresReady=!roads
    this.credit=finish?createMetroCredits(roads?releaseData?metroDataURL(releaseData.roadSource):import.meta.env.VITE_METRO_ROADS.replace(/\.json$/,'.geojson'):null):null
    this.group=new T.Group();this.group.name='tokyo-metro-city'
    this.group.quaternion.setFromRotationMatrix(metroPlacementMatrix())
    this.active=false;this.layers=[];this.generation=0;this.ready=false;this.failure=null;this.operational=false;this.visualFocus=null
    this.prepareVisual=async()=>{};this.bootstrap=[];this.bootstrapReady=!lowrise?.bootstrap
    this.daylight=1;this.contactUpdate=-Infinity;this.facadeContacts=new FacadeContacts(study.radius)
    this.selected=new URLSearchParams(location.search).get('region')??study.defaultRegion??study.samples[0].id
    if(!study.samples.some(s=>s.id===this.selected))this.selected=study.defaultRegion??study.samples[0].id
    const requested=new URLSearchParams(location.search).get('place')
    this.arrivalId=requested&&arrivals[requested]&&study.samples.some(s=>s.id===arrivals[requested].region)?requested:this.selected
    this.selected=arrivals[this.arrivalId].region??this.selected
  }
  configure(dimensions){
    const arcs=dimensions.topology?.landArcs
    const active=dimensions.worldId==='izma'&&dimensions.type==='cylinder'&&Math.abs(dimensions.radius-this.study.radius)<.001&&Math.abs(dimensions.length-this.study.span)<.001&&arcs?.length===3&&arcs.every((a,i)=>Math.abs(a.centerAzimuth-i*Math.PI*2/3)<1e-6&&Math.abs(a.arcRadians-Math.PI/3)<1e-6)
    if(active===this.active)return active
    this.clear();this.active=!!active;this.group.visible=this.active
    if(this.credit)this.credit.hidden=!this.active
    if(this.active){
      const tiles=this.catalogs.flatMap(c=>c.base.tiles.map(t=>({...t,id:c.sample.id+'/'+t.id,band:c.sample.band})))
      this.collision=new MetroCollision(tiles,this.study.radius,this.study.span,fetchTile)
      const generation=this.generation;this.loading=this.loadVisuals(generation).catch(error=>{if(generation===this.generation)this.failure=error})
    }
    return this.active
  }
  async loadVisuals(generation){
    this.nightscape=this.night?new MetroNight(this.study,this.night,{defer:!!this.release}):null
    if(this.nightscape){this.group.add(this.nightscape.group);this.nightscape.setDaylight(this.daylight)}
    for(const c of this.catalogs){
      const base=new MetroTiles(this.study,c.sample,c.base,[],{...this.renderBudget.near,farOptions:this.renderBudget.far,overviewTilesPerChunk:this.renderBudget.overviewTilesPerChunk,finish:this.finish??{},ownershipMask:true,night:this.nightscape?.fields.get(c.sample.id),prepareVisual:mesh=>this.prepareVisual(mesh),onError:()=>{}})
      const facade=new FacadeInstances(this.kit,[],this.study,c.sample,{flatOpenings:this.renderBudget.flatOpenings,batchFacades:this.renderBudget.batchFacades});facade.midRange=180;facade.updateMode('colony')
      facade.uniforms.kitNightTransition.value=0
      facade.setDaylight(this.daylight)
      const stream=new FacadeStream(facade,c.facades,{...c.facades,...this.renderBudget.facades,fetchSite:fetchCompressedJSON,prepareVisual:mesh=>this.prepareVisual(mesh),onError:()=>{}})
      const lowrise=this.lowrise?new LowriseStream(base,this.lowrise.bands[c.sample.id],this.renderBudget.lowrise):null
      const panes=this.nightPanes&&this.nightscape?new NightPaneStream(base,facade,this.nightPanes.bands[c.sample.id],this.nightscape.fields.get(c.sample.id),this.renderBudget.panes):null
      this.layers.push({base,facade,stream,lowrise,panes,overview:new Set(),detail:{status:this.release?'unloaded':'ready',attempts:0,retryAt:0},farCatalog:{status:this.farPaths?'unloaded':'ready',attempts:0,retryAt:0}});this.group.add(base.group,facade.group)
    }
    if(this.lowrise?.bootstrap){
      for(const layer of this.layers){
        if(generation!==this.generation)return
        const data=await fetchMetroTile(this.lowrise.bootstrap[layer.base.sample.id],this.visualController.signal,{},this.study.radius,layer.base.sample)
        for(const d of data){
          if(generation!==this.generation){d.bitmap?.close();continue}
          const mesh=layer.base.mesh(d,'near')
          try{await this.prepareVisual(mesh)}catch(error){mesh.geometry.dispose();mesh.material.dispose();throw error}
          if(generation!==this.generation){mesh.geometry.dispose();mesh.material.dispose();continue}
          mesh.name='temporary-land-cover';mesh.castShadow=false;this.bootstrap.push(mesh);this.group.add(mesh)
        }
      }
      if(generation!==this.generation)return
      this.bootstrapReady=true
    }
    if(this.roads){
      const parts=[]
      for(const bridge of this.roads.data.bridges){
        const data=await fetchTile(bridge,this.visualController.signal)
        if(generation!==this.generation)return
        const layer=this.layers.find(l=>l.base.sample.band===bridge.band)
        for(const d of data){
          const mesh=layer.base.mesh(d,'structure')
          try{await this.prepareVisual(mesh)}catch(error){mesh.geometry.dispose();mesh.material.dispose();throw error}
          if(generation!==this.generation){mesh.geometry.dispose();mesh.material.dispose();return}
          this.roadMeshes.push(mesh);this.group.add(mesh)
        }
        parts.push(...metroCollisionParts(data,bridge.band,this.study.radius))
      }
      if(generation!==this.generation)return
      this.collision.setStructures(parts);this.structuresReady=true
    }
    // Trees can be close to the arrival. Prepare them before its first overview
    // releases the motion gate, not when the last remote district finishes.
    if(this.finish?.trees){
      const data=await read('/'+this.finish.trees)
      if(generation!==this.generation)return
      const trees=await MetroTrees.create(this.study,data)
      try{await this.prepareVisual(trees.group)}catch(error){trees.dispose();throw error}
      if(generation!==this.generation){trees.dispose();return}
      this.trees=trees;this.group.add(trees.group)
    }
    const remaining=this.layers.flatMap(layer=>layer.base.sample.overview.map(descriptor=>({layer,descriptor})))
    while(remaining.length){
      // Start with the arrival's skyline. Background strips no longer hold the
      // physics gate or compete with the first nearby streets for bandwidth.
      const focus=this.visualFocus??this.visit('landscape')
      const score=({layer,descriptor:d})=>{
        const p=metroSurfaceLocation(layer.base.sample.band,(d.bounds[0]+d.bounds[2])/2,(d.bounds[1]+d.bounds[3])/2,this.study.radius)
        return Math.abs(p.axial-focus.axial)+Math.abs(Math.atan2(Math.sin(p.azimuth-focus.azimuth),Math.cos(p.azimuth-focus.azimuth)))*this.study.radius
      }
      remaining.sort((a,b)=>score(a)-score(b))
      const {layer,descriptor}=remaining.shift(),data=await fetchMetroTile(descriptor,this.visualController.signal,this.finish??{},this.study.radius,layer.base.sample,{textureScale:this.renderBudget.overviewTextureScale,terrainLOD:true})
      let added=0
      try{
        for(const mesh of data){
          await yieldScene()
          if(generation!==this.generation)return
          const object=layer.base.mesh(mesh,'overview')
          try{await this.prepareVisual(object)}catch(error){object.geometry.dispose();object.material.dispose();throw error}
          if(generation!==this.generation){object.geometry.dispose();object.material.dispose();return}
          layer.base.addOverview(mesh,object);added++
        }
        layer.overview.add(descriptor.id);layer.base.refreshFar()
      }finally{for(const mesh of data.slice(added))mesh.bitmap?.close()}
      if(generation!==this.generation)return
      // The first local skyline and exact nearby floor release the movement
      // gate. Do not spend cold-start bandwidth on the other 29 districts.
      while(this.release&&!this.operational&&generation===this.generation)await new Promise(resolve=>setTimeout(resolve,20))
      if(generation!==this.generation)return
    }
    this.clearBootstrap()
    this.ready=true
  }
  get index(){return this.collision.index}
  get floorHeight(){return -16}
  prepareRegions(foci,preparation){
    this.visualFocus=preparation?.arrival??(!this.operational?this.visit('landscape'):null)
    if(this.failure&&(!this.operational||(this.visualFocus&&!this.arrivalSceneryReady(this.visualFocus))))throw this.failure
    const collisionReady=this.collision.request(foci,preparation)
    const sceneryReady=this.structuresReady&&this.bootstrapReady&&(!this.visualFocus||this.arrivalSceneryReady(this.visualFocus))
    if(collisionReady&&sceneryReady&&!this.operational){this.operational=true;this.operationalAt=performance.now()}
    return collisionReady&&sceneryReady
  }
  arrivalSceneryReady(focus){
    const radius=this.study.radius
    for(const l of this.layers){
      const s=l.base.sample,a=-focus.azimuth-s.band*Math.PI*2/3,x=Math.atan2(Math.sin(a),Math.cos(a))*radius-s.anchor.local[0],y=-focus.axial-s.anchor.local[1]
      if(x<s.bounds[0]||x>s.bounds[2]||y<s.bounds[1]||y>s.bounds[3])continue
      const segment=s.overview.find(d=>y>=d.bounds[1]&&y<=d.bounds[3])
      if(!segment||!l.overview.has(segment.id))return false
      const nearby=s.tiles.filter(t=>{const b=t.bounds;return Math.hypot(Math.max(0,b[0]-x,x-b[2]),Math.max(0,b[1]-y,y-b[3]))<32})
      if(nearby.some(t=>{const e=l.base.entries.get(t.id);return e?.status==='failed'&&e.attempts>=3}))throw Error('Nearby street scenery could not be loaded. Choose the destination again to retry.')
      return nearby.length>0&&nearby.every(t=>l.base.entries.get(t.id)?.status==='resident')
    }
    return false
  }
  getRegionalStatus(){return this.active?this.collision.stats:null}
  retryRegions(){
    this.collision?.retry()
    // Queueing the initial arrival also calls retryRegions. Optional night
    // data must not steal bandwidth from the first required ground download.
    if(this.operational)this.nightscape?.retry()
    for(const l of this.layers)l.base.retry()
    for(const l of this.layers)for(const state of [l.detail,l.farCatalog])if(state.status==='failed'){state.status='unloaded';state.attempts=0;state.retryAt=0}
    if(this.failure){
      this.visualController.abort();this.visualController=new AbortController()
      this.clearBootstrap();this.bootstrapReady=!this.lowrise?.bootstrap
      this.clearRoads();this.collision.setStructures([])
      this.collision.setDecorations([]);this.facadeContacts=new FacadeContacts(this.study.radius);this.contactUpdate=-Infinity
      this.failure=null;this.ready=false;this.operational=false;this.trees?.dispose();this.trees=null;this.nightscape?.dispose();this.nightscape=null
      for(const l of this.layers){l.panes?.dispose();l.stream.dispose();l.facade.dispose();l.lowrise?.dispose();l.base.dispose()}
      this.layers=[];this.group.clear()
      const g=++this.generation;this.loading=this.loadVisuals(g).catch(e=>{if(g===this.generation)this.failure=e})
    }
  }
  setXRDetail(level){
    if(this.xrDetailLevel===level)return
    this.xrDetailLevel=level;this.detailSelectionAt=-Infinity
  }
  updateDistantDetail(eye){
    const now=performance.now()
    if(now-this.detailSelectionAt<300)return
    this.detailSelectionAt=now
    const detail=distantDetail(this.xrDetailLevel)
    for(const l of this.layers){
      if(selectTerrainLOD(l.base.far,l.base.group.worldToLocal(eye.clone()),detail.terrainDistance))l.base.refreshFar()
      const far=l.base.farStream
      if(far){
        far.loadDistance=(this.renderBudget.far.loadDistance??5000)*detail.range
        far.evictDistance=(this.renderBudget.far.evictDistance??6000)*detail.range
        // Restore unbounded desktop defaults on exit, including already loaded catalogs.
        if(this.xrDetailLevel===0){far.loadDistance=this.renderBudget.far.loadDistance??Infinity;far.evictDistance=this.renderBudget.far.evictDistance??Infinity}
      }
      if(l.lowrise){
        l.lowrise.fadeStart=(this.renderBudget.lowrise.fadeStart??2000)*detail.range
        l.lowrise.fadeEnd=(this.renderBudget.lowrise.fadeEnd??2800)*detail.range
        for(const e of l.lowrise.residents)e.uniforms.lowFade.value.set(l.lowrise.fadeStart,l.lowrise.fadeEnd)
      }
    }
  }
  update(azimuth,axial,altitude){
    if(!this.active)return
    if(this.visualFocus){({azimuth,axial}=this.visualFocus);altitude=this.visualFocus.groundHeight??0}
    // Selection needs the root transform; the renderer updates descendants once.
    this.group.updateWorldMatrix(true,false)
    const eye=new T.Vector3(Math.cos(azimuth)*(this.study.radius-altitude),axial,Math.sin(azimuth)*(this.study.radius-altitude))
    this.group.parent?.localToWorld(eye)
    this.updateDistantDetail(eye)
    const background=this.operational&&(!this.release||performance.now()-this.operationalAt>250)
    if(background)this.nightscape?.start()
    for(const l of this.layers){
      let allowedTiles=null
      if(this.release&&!background){
        const s=l.base.sample,a=-azimuth-s.band*Math.PI*2/3,x=Math.atan2(Math.sin(a),Math.cos(a))*this.study.radius-s.anchor.local[0],y=-axial-s.anchor.local[1]
        allowedTiles=new Set(s.tiles.filter(t=>{const b=t.bounds;return Math.hypot(Math.max(0,b[0]-x,x-b[2]),Math.max(0,b[1]-y,y-b[3]))<32}).map(t=>t.id))
      }
      if(background&&this.release){
        const s=l.base.sample,a=-azimuth-s.band*Math.PI*2/3,x=Math.atan2(Math.sin(a),Math.cos(a))*this.study.radius-s.anchor.local[0],y=-axial-s.anchor.local[1]
        const distance=Math.hypot(Math.max(0,s.bounds[0]-x,x-s.bounds[2]),Math.max(0,s.bounds[1]-y,y-s.bounds[3]),altitude)
        if(distance<3200)this.loadDetails(l)
        if(this.farPaths)this.loadFarCatalog(l)
      }
      l.base.update(eye,{active:altitude<700,visible:true,overview:altitude>2000,distant:background,allowedTiles});l.stream.update(eye,{active:background&&altitude<500})
      const now=performance.now()
      if(!l.lodAt||now-l.lodAt>=this.renderBudget.lodIntervalMs){l.facade.updateLOD(eye);l.lodAt=now}
      l.lowrise?.update(eye,{active:background});l.panes?.update(eye,{active:background})
    }
    const now=performance.now()
    if(now-this.contactUpdate>200){this.contactUpdate=now;if(this.facadeContacts.update(this.layers,{azimuth,axial,altitude}))this.collision.setDecorations(this.facadeContacts.parts)}
    this.trees?.update(eye);this.nightscape?.update(eye,this.layers)
  }
  loadDetails(layer){
    const state=layer.detail,now=performance.now()
    if(['loading','ready'].includes(state.status)||state.attempts>=3||now<state.retryAt)return
    const generation=this.generation,sample=layer.base.sample,path=this.detailPaths[sample.id]
    state.status='loading';state.attempts++
    readMetroJSON(path,{signal:this.visualController.signal,sha256:objectHash(path)}).then(data=>{
      if(generation!==this.generation||!this.active)return
      if(data.version!==1||data.band!==sample.id||JSON.stringify(data.frame)!==JSON.stringify(sample.frame))throw Error('Invalid metro detail frame')
      const stream=new FacadeStream(layer.facade,data.facades,{...data.facades,...this.renderBudget.facades,fetchSite:fetchCompressedJSON,prepareVisual:mesh=>this.prepareVisual(mesh),onError:()=>{}})
      const panes=new NightPaneStream(layer.base,layer.facade,data.panes,this.nightscape.fields.get(sample.id),this.renderBudget.panes)
      layer.stream.dispose();layer.stream=stream;layer.panes=panes;state.status='ready';state.error=null
    }).catch(error=>{
      if(generation!==this.generation||!this.active)return
      state.status='failed';state.error=String(error);state.retryAt=performance.now()+500*2**(state.attempts-1)
    })
  }
  loadFarCatalog(layer){
    const state=layer.farCatalog,now=performance.now()
    if(['loading','ready'].includes(state.status)||state.attempts>=3||now<state.retryAt)return
    const generation=this.generation,sample=layer.base.sample,path=this.farPaths[sample.id]
    state.status='loading';state.attempts++
    readMetroJSON(path,{signal:this.visualController.signal,sha256:objectHash(path)}).then(data=>{
      if(generation!==this.generation||!this.active)return
      if(data.version!==1||data.band!==sample.id||JSON.stringify(data.frame)!==JSON.stringify(sample.frame))throw Error('Invalid metro far frame')
      layer.base.setFarCatalog(data.tiles);state.status='ready';state.error=null
    }).catch(error=>{
      if(generation!==this.generation||!this.active)return
      state.status='failed';state.error=String(error);state.retryAt=performance.now()+500*2**(state.attempts-1)
    })
  }
  setDaylight(value){this.daylight=value;this.nightscape?.setDaylight(value);for(const l of this.layers)l.facade.setDaylight(value)}
  nightLights(target){return this.nightscape?.lightsFor(target)??[]}
  visit(kind){
    const place=this.places.find(p=>kind===`metro-${p.id}`)
    const region=this.study.samples.find(s=>s.id===kind)
    if(kind!=='landscape'&&!region&&!place)return null
    const id=place?.region??region?.id??this.selected
    const s=this.study.samples.find(s=>s.id===id),p=place??this.arrivals[region?id:this.arrivalId]
    const location=metroSurfaceLocation(s.band,p.spawn[0],p.spawn[1],this.study.radius)
    return{...location,groundHeight:p.ground,orientation:metroArrivalOrientation(location.azimuth,p.yaw)}
  }
  diagnostics(){
    // The app publishes this status every frame. Catalog-wide diagnostics are
    // inspection data: sample them at 5 Hz while keeping readiness live.
    const now=performance.now()
    if(!this.diagnosticSample||now-this.diagnosticAt>=200){this.diagnosticAt=now;this.diagnosticSample={
      nativeTiles:nativeTiles.diagnostics(),
      layers:this.layers.map(l=>({base:l.base.diagnostics(),facade:l.facade.diagnostics(),recipes:l.stream.diagnostics().recipeBytes,lowrise:l.lowrise?.diagnostics(),nightPanes:l.panes?.diagnostics()}))}}
    return{...this.diagnosticSample,renderBudget:this.renderBudget,xrDetailLevel:this.xrDetailLevel,active:this.active,ready:this.ready,operational:this.operational,visualFailure:this.failure?String(this.failure):null,floorHeight:this.floorHeight,collision:this.collision?.stats,
    roads:this.roads?{ready:this.structuresReady,nodes:this.roads.data.nodes.length,edges:this.roads.data.edges.length,bridges:this.roads.data.bridges.length,structureMeshes:this.roadMeshes.length}:null,
    night:this.nightscape?.diagnostics(),release:this.release,detailCatalogs:this.layers.map(l=>({band:l.base.sample.id,...l.detail,far:{...l.farCatalog}})),
    finish:this.finish?{version:this.finish.version,trees:this.trees?.group.userData}:null,facadeContacts:this.facadeContacts.stats}}
  clearBootstrap(){for(const mesh of this.bootstrap){mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose()}this.bootstrap=[]}
  clearRoads(){for(const mesh of this.roadMeshes){mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose()}this.roadMeshes=[];this.structuresReady=!this.roads}
  clear(){this.generation++;this.visualController?.abort();this.visualController=new AbortController();this.clearBootstrap();this.clearRoads();this.bootstrapReady=!this.lowrise?.bootstrap;this.collision?.dispose();this.facadeContacts=new FacadeContacts(this.study.radius);this.contactUpdate=-Infinity;this.trees?.dispose();this.trees=null;this.nightscape?.dispose();this.nightscape=null;for(const l of this.layers){l.panes?.dispose();l.stream.dispose();l.facade.dispose();l.lowrise?.dispose();l.base.dispose()};this.layers=[];this.group.clear();this.ready=false;this.failure=null;this.operational=false;this.visualFocus=null;nativeTiles.clear()}
  dispose(){this.clear();this.active=false;this.credit?.remove();this.group.removeFromParent()}
}
