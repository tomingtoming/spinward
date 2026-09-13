import {buildCityCollisionIndex,type CityBuilding,type CityCollisionIndex} from './cityLayout'

/** Replace only affected spatial buckets. The published index keeps its identity
 * so both walking queries and the existing Rapier streamer see the same set. */
export class CityCollisionOverlay {
 readonly index:CityCollisionIndex
 private cells:Map<number,readonly CityBuilding[]>
 private touched:number[]=[]
 private permanent:readonly CityBuilding[]=[]
 private previous:readonly CityBuilding[]=[]
 constructor(private base:CityCollisionIndex,private length:number){
  this.cells=new Map(base.cells)
  const owner=this
  this.index={...base,cells:this.cells,get all(){return [...base.all,...owner.permanent,...owner.previous]}}
 }
 setPermanent(buildings:readonly CityBuilding[]){
  const previous=this.previous;this.previous=[];this.permanent=buildings;this.set(previous)
 }
 set(buildings:readonly CityBuilding[]){
  if(buildings===this.previous)return
  this.previous=buildings
  for(const key of this.touched){const original=this.base.cells.get(key);if(original)this.cells.set(key,original);else this.cells.delete(key)}
  const extra=buildCityCollisionIndex([...this.permanent,...buildings],this.base.radius,this.length)
  this.touched=[...extra.cells.keys()]
  for(const [key,items] of extra.cells)this.cells.set(key,[...(this.base.cells.get(key)??[]),...items])
 }
}
