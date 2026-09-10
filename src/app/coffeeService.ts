import * as THREE from 'three'
import spec from '../../assets/blender/coffee-service.json'
import { CAFE_PILOT, cafePilotPoint, matchesAuthoredPilot } from '../objects/cafePilot'
import type { BuildingInterior } from '../objects/buildingInteriors'
import type { PlayerTraversalState } from './playerTraversal'

export const COFFEE_SERVICE = spec
export type CoffeeStation = { interior: BuildingInterior; radius: number; azimuth: number; axialPosition: number }
export type CoffeeContext = { station: CoffeeStation | null; player: PlayerTraversalState; radius: number; blocked: boolean }
export function planCoffeeStation(interiors: Iterable<BuildingInterior>, radius: number): CoffeeStation | null {
  for (const interior of interiors) {
    if (!matchesAuthoredPilot(interior, radius, CAFE_PILOT)) continue
    const p = cafePilotPoint(interior, radius, new THREE.Vector3(spec.counterX, 0, -interior.depth / 2 + spec.approachFromBack))
    return { interior, radius, azimuth: Math.atan2(p.z, p.x), axialPosition: p.y }
  }
  return null
}
export function nearCoffeeCounter({ station, player, radius, blocked }: CoffeeContext) {
  if (!station || blocked || station.radius !== radius || player.mode !== 'grounded' || Math.abs(player.groundHeight) > .2) return false
  const b = station.interior.building, f = b.front!
  const t = Math.atan2(Math.sin(player.surface.azimuth-b.azimuth), Math.cos(player.surface.azimuth-b.azimuth)) * radius
  const a = player.surface.axialPosition-b.axial
  const x = f.axis === 'tangent' ? f.side*a : -f.side*t
  const z = f.axis === 'tangent' ? f.side*t : f.side*a
  // Only the clear customer side: never reach through the solid counter/back wall.
  return Math.abs(x-spec.counterX) < 1.05 && z > -station.interior.depth/2+2.12 && z < -station.interior.depth/2+3.35
}

export class CoffeeService {
  phase: 'idle' | 'brewing' | 'ready' | 'holding' = 'idle'
  servings = 0
  elapsed = 0
  sipRemaining = 0
  private station: CoffeeStation | null = null
  get sipProgress() { return this.sipRemaining > 0 ? 1-this.sipRemaining/spec.sipSeconds : 0 }
  reset() { this.phase='idle'; this.servings=0; this.elapsed=0; this.sipRemaining=0 }
  update(dt: number, context: CoffeeContext) {
    if (this.station !== context.station || context.radius !== context.station?.radius || context.blocked) this.reset()
    this.station = context.station
    const near = nearCoffeeCounter(context)
    if (this.phase === 'brewing') {
      if (!near) this.reset()
      else if ((this.elapsed += Math.max(0,dt)) >= spec.brewSeconds) { this.phase='ready'; this.servings=spec.servings }
    }
    if (this.sipRemaining > 0) {
      if (context.player.mode !== 'grounded') this.sipRemaining=0
      else {
        this.sipRemaining=Math.max(0,this.sipRemaining-Math.max(0,dt))
        if (this.sipRemaining === 0) this.servings=Math.max(0,this.servings-1)
      }
    }
  }
  prompt(context: CoffeeContext): { label: string; enabled: boolean } | null {
    if (!context.station || context.blocked || context.player.mode !== 'grounded' || Math.abs(context.player.groundHeight) > .2) return null
    if (this.sipRemaining > 0) return { label:'Taking a sip…', enabled:false }
    const near=nearCoffeeCounter(context)
    if (near) {
      if (this.phase==='idle') return { label:'Brew coffee · self service', enabled:true }
      if (this.phase==='brewing') return { label:`Brewing… ${Math.min(99,Math.floor(this.elapsed/spec.brewSeconds*100))}%`, enabled:false }
      if (this.phase==='ready') return { label:'Take your coffee', enabled:true }
      return { label:'Return cup', enabled:true }
    }
    if (this.phase==='holding') return this.servings > 0
      ? { label:'Sip coffee', enabled:true }
      : { label:'Empty cup · return at counter', enabled:false }
    return null
  }
  activate(context: CoffeeContext) {
    this.update(0,context)
    if (!this.prompt(context)?.enabled) return false
    if (nearCoffeeCounter(context)) {
      if (this.phase==='idle') { this.phase='brewing'; this.elapsed=0 }
      else if (this.phase==='ready') this.phase='holding'
      else if (this.phase==='holding') this.reset()
    } else this.sipRemaining=spec.sipSeconds
    return true
  }
}
