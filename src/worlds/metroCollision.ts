import { buildCityCollisionIndex, type CityBuilding, type CityCollisionIndex } from '../objects/cityLayout'
import type { ColonyFocus } from './colonyRegionStore'
import { metroSurfaceLocation } from './metroPlacement'
import { MetroSpatialIndex, metroMotionVolumes } from './metroStreaming'
import type { RegionalPreparation } from './regionalMotion'

export type NativeMesh = { name: string; attributes: { position: Float32Array; index: Uint32Array } }
export type MetroTile = { id: string; path: string; decodedBytes: number; bounds: number[]; heightRange?: number[]; band: number }
type Entry = { tile: MetroTile; wanted: boolean; status: string; parts: CityBuilding[]; bytes: number;
  controller?: AbortController; attempts: number; retryAt: number; message: string; critical: boolean; priority: number; touched: number }

/** Split ownership meshes for bounded Rapier/contact queries. Triangles are
 * assigned whole, including walls and source compounds crossing tile edges. */
export function metroCollisionParts(meshes: NativeMesh[], band: number, radius: number): CityBuilding[] {
  const groups = new Map<string, number[]>()
  for (const mesh of meshes) {
    if (!['terrain', 'buildings', 'bridge-decks', 'bridge-rails'].includes(mesh.name)) continue
    const { position: p, index: ids } = mesh.attributes
    for (let i = 0; i < ids.length; i += 3) {
      const a = ids[i] * 3, b = ids[i + 1] * 3, c = ids[i + 2] * 3
      const key = `${mesh.name}:${Math.floor((p[a] + p[b] + p[c]) / 60)}:${Math.floor((p[a + 1] + p[b + 1] + p[c + 1]) / 60)}`
      let group = groups.get(key)
      if (!group) { group = []; groups.set(key, group) }
      for (const j of [a, b, c]) group.push(p[j], p[j + 1], p[j + 2])
    }
  }
  return [...groups.values()].map(vertices => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, height = -Infinity
    for (let i = 0; i < vertices.length; i += 3) {
      x0 = Math.min(x0, vertices[i]); x1 = Math.max(x1, vertices[i])
      y0 = Math.min(y0, vertices[i + 1]); y1 = Math.max(y1, vertices[i + 1]); height = Math.max(height, vertices[i + 2])
    }
    const x = (x0 + x1) / 2, y = (y0 + y1) / 2
    return { ...metroSurfaceLocation(band, x, y, radius), width: x1 - x0, depth: y1 - y0,
      height, surfaceMesh: Float64Array.from(vertices, (v, i) => i % 3 === 0 ? x - v : i % 3 === 1 ? y - v : v),
      groundMargin: 0, collisionMargin: 0, kind: 'block', tone: .5 }
  })
}

export class MetroCollision {
  readonly index: CityCollisionIndex
  // This object's identity is the arrival gate's world ownership token.
  readonly stats = { entries: 0, pending: 0, bytes: 0, peakBytes: 0, ready: false,
    critical: 0, missingCritical: 0, prefetch: 0, retained: 0, loads: 0, aborts: 0,
    failed: [] as { id: string; attempts: number; message: string }[] }
  private entries: Entry[]
  private active = new Set<Entry>()
  private spatial: MetroSpatialIndex
  private running = 0
  private disposed = false
  private predictive = false
  private structures: CityBuilding[] = []
  private decorations: CityBuilding[] = []
  constructor(tiles: MetroTile[], readonly radius: number, readonly span: number,
    private load: (tile: MetroTile, signal: AbortSignal) => Promise<NativeMesh[]>,
    private options = { maxEntries: 96, maxBytes: 48 * 1024 * 1024, concurrency: 3 }) {
    this.index = { ...buildCityCollisionIndex([], radius, span), floorHeight: -16 }
    this.entries = tiles.map(tile => ({ tile, wanted: false, critical: false, priority: Infinity, touched: 0,
      status: 'unloaded', parts: [], bytes: 0, attempts: 0, retryAt: 0, message: '' }))
    this.spatial = new MetroSpatialIndex(tiles,radius)
  }
  private legacyDemand(foci: readonly ColonyFocus[], demand: Map<Entry,number>) {
    if (!foci.length) return
    for (const e of this.entries) {
      const b=e.tile.bounds,center=metroSurfaceLocation(e.tile.band,(b[0]+b[2])/2,(b[1]+b[3])/2,this.radius)
      if(foci.some(f=>{
        const dx=Math.max(0,Math.abs(Math.atan2(Math.sin(f.azimuth-center.azimuth),Math.cos(f.azimuth-center.azimuth))*this.radius)-(b[2]-b[0])/2)
        return Math.hypot(dx,Math.max(0,Math.abs(f.axial-center.axial)-(b[3]-b[1])/2))<=f.distance
      })) demand.set(e,-1)
    }
  }
  request(foci: readonly ColonyFocus[], preparation?: RegionalPreparation) {
    if (this.disposed) return false
    this.predictive=!!preparation
    const demand=new Map<Entry,number>(),now=performance.now()
    if(preparation){
      const volumes=metroMotionVolumes(preparation.motion)
      for(const bounds of volumes.critical) this.spatial.query(bounds,i=>demand.set(this.entries[i],-1))
      for(const {bounds,deadline} of volumes.prefetch) this.spatial.query(bounds,i=>{
        const e=this.entries[i];demand.set(e,Math.min(demand.get(e)??Infinity,deadline))
      })
      // A queued teleport is always mandatory and belongs to this world only.
      this.legacyDemand(preparation.arrival?[preparation.arrival]:[],demand)
    }else this.legacyDemand(foci,demand)
    let bytes=0,count=0
    for(const [e,p] of demand) if(p<0){bytes+=e.tile.decodedBytes;count++}
    if(count>this.options.maxEntries||bytes>this.options.maxBytes) throw Error('Tokyo critical collision demand exceeds its streaming budget')
    // Reserve admission for critical tiles, then near deadlines, then an 8 s
    // resident/in-flight grace period. Background pressure can evict retention.
    const selected=new Map<Entry,number>()
    for(const [e,p] of demand) if(p<0) selected.set(e,p)
    const candidates=[...demand].filter(([,p])=>p>=0)
    if(preparation) for(const e of this.active) if(!demand.has(e)&&now-e.touched<8000&&['resident','loading'].includes(e.status)) candidates.push([e,100+now-e.touched])
    candidates.sort((a,b)=>a[1]-b[1])
    for(const [e,p] of candidates) if(count<this.options.maxEntries&&bytes+e.tile.decodedBytes<=this.options.maxBytes){
      selected.set(e,p);count++;bytes+=e.tile.decodedBytes
    }
    let changed=false
    for(const e of this.active) if(!selected.has(e)) { changed=this.release(e)||changed;this.active.delete(e) }
    for(const [e,p] of selected){
      e.wanted=true;e.critical=p<0;e.priority=p
      if(demand.has(e))e.touched=now
      this.active.add(e)
    }
    if(changed)this.reindex()
    this.refresh();this.pump();this.refresh()
    return this.stats.ready
  }
  private release(e: Entry) {
    if(e.controller&&!e.controller.signal.aborted){e.controller.abort();this.stats.aborts++}
    const changed=e.status==='resident'
    e.parts=[];e.bytes=0;e.wanted=false;e.critical=false;e.attempts=0;e.retryAt=0
    // Keep an aborted in-flight slot occupied until its promise settles.
    if(e.status!=='loading')e.status='unloaded'
    return changed
  }
  private reindex() {
    Object.assign(this.index,buildCityCollisionIndex([...this.structures,...this.decorations,...[...this.active].flatMap(e=>e.parts)],this.radius,this.span))
  }
  setStructures(parts:CityBuilding[]) { this.structures=parts;this.reindex() }
  setDecorations(parts:CityBuilding[]) { this.decorations=parts;this.reindex() }
  private refresh() {
    const active=[...this.active]
    this.stats.entries=active.filter(e=>e.status==='resident').length
    this.stats.pending=this.running
    this.stats.bytes=active.reduce((n,e)=>n+e.bytes,0)
    this.stats.peakBytes=Math.max(this.stats.peakBytes,this.stats.bytes)
    this.stats.critical=active.filter(e=>e.critical).length
    this.stats.missingCritical=active.filter(e=>e.critical&&e.status!=='resident').length
    this.stats.prefetch=active.filter(e=>!e.critical&&e.priority<100).length
    this.stats.retained=active.filter(e=>e.priority>=100).length
    this.stats.failed=active.filter(e=>e.critical&&e.status==='failed').map(e=>({id:e.tile.id,attempts:e.attempts,message:e.message}))
    this.stats.ready=this.stats.missingCritical===0
  }
  private pump() {
    if(this.disposed)return
    const queue=[...this.active].sort((a,b)=>a.priority-b.priority)
    for(const e of queue){
      if(this.running>=this.options.concurrency)break
      if(!e.wanted||e.priority>=100||['resident','loading'].includes(e.status)||e.attempts>=3||performance.now()<e.retryAt)continue
      // Keep one network/decode slot available for an unpredicted close contact.
      if(this.predictive&&!e.critical&&this.running>=Math.max(1,this.options.concurrency-1))continue
      const controller=new AbortController();e.controller=controller;e.status='loading';e.attempts++;this.running++;this.stats.loads++
      this.load(e.tile,controller.signal).then(meshes=>{
        if(this.disposed||controller.signal.aborted||!e.wanted)return
        const parts=metroCollisionParts(meshes,e.tile.band,this.radius)
        if(!parts.length)throw Error('Empty Tokyo collision tile')
        const bytes=parts.reduce((n,b)=>n+b.surfaceMesh!.length * 8,0)
        // Decoded triangle memory has a hard independent cap. Reclaim background
        // residents first; mandatory data is never silently dropped to make room.
        let residentBytes=[...this.active].reduce((n,b)=>n+b.bytes,0)
        if(bytes+residentBytes>this.options.maxBytes*3){
          for(const old of [...this.active].filter(b=>b!==e&&!b.critical&&b.status==='resident').sort((a,b)=>b.priority-a.priority||a.touched-b.touched)){
            residentBytes-=old.bytes;this.release(old);this.active.delete(old)
            if(bytes+residentBytes<=this.options.maxBytes*3)break
          }
          this.reindex()
        }
        if(bytes+residentBytes>this.options.maxBytes*3)throw Error('Expanded Tokyo collision exceeds memory budget')
        e.parts=parts;e.bytes=bytes;e.status='resident';e.attempts=0;this.reindex()
      }).catch(error=>{
        if(controller.signal.aborted||this.disposed)return
        e.status='failed';e.retryAt=performance.now()+1000*2**(e.attempts-1);e.message=String(error)
      }).finally(()=>{
        this.running--;e.controller=undefined
        if(e.status==='loading')e.status='unloaded'
        this.refresh();this.pump()
      })
    }
  }
  retry() { for(const e of this.active)if(e.status==='failed'){e.attempts=0;e.retryAt=0};this.pump() }
  dispose() { this.disposed=true;for(const e of this.active)this.release(e);this.active.clear();this.structures=[];this.decorations=[];this.reindex();this.refresh() }
}
