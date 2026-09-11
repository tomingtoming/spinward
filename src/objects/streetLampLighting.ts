import * as THREE from 'three'

export type StreetLampSource = { id: string; position: THREE.Vector3; down: THREE.Vector3 }
export const STREET_LIGHT_RANGE = 42
const LIGHT_INTENSITY = 200

type LightSlot = { light: THREE.SpotLight; source: StreetLampSource | null; fade: number; strength: number }

// A bounded local response to the rendered fixtures. Stable slots fade to
// darkness before changing source, so a moving observer never drags a light
// along the street. No shadow maps or additional luminous geometry are used.
export class StreetLampLighting {
  readonly slots: LightSlot[] = []
  private sources: StreetLampSource[] = []
  private desired: StreetLampSource[] = []
  private night = 0

  constructor(private parent: THREE.Group, count: number) {
    for (let i = 0; i < count; i++) {
      const light = new THREE.SpotLight(0xffdfb5, 0, 32, Math.PI / 3, .65, 2)
      light.name = `local-street-light-${i}`
      light.target.name = `local-street-light-target-${i}`
      parent.add(light, light.target)
      this.slots.push({ light, source: null, fade: 0, strength: 0 })
    }
  }

  setSources(sources: StreetLampSource[]) { this.sources = sources }

  reset() {
    this.sources = []
    this.desired.length = 0
    for (const slot of this.slots) {
      slot.source = null; slot.fade = 0; slot.strength = 0; slot.light.intensity = 0
    }
  }

  setDaylight(daylight: number) {
    this.night = 1 - THREE.MathUtils.clamp(daylight, 0, 1)
    for (const slot of this.slots) slot.light.intensity = slot.strength * this.night ** 2
  }

  update(focus: THREE.Vector3, deltaSeconds: number, available = true) {
    if (this.night === 0) return
    const step = Math.min(.1, Math.max(0, deltaSeconds)) * 4
    const score = (source: StreetLampSource) => source.position.distanceToSquared(focus) *
      (this.slots.some(slot => slot.source?.id === source.id) ? .85 : 1)
    this.desired.length = 0
    if (available) for (const source of this.sources) {
      if (source.position.distanceToSquared(focus) >= STREET_LIGHT_RANGE ** 2) continue
      const at = this.desired.findIndex(other => score(source) < score(other))
      if (at < 0) { if (this.desired.length < this.slots.length) this.desired.push(source) }
      else { this.desired.splice(at, 0, source); this.desired.length = Math.min(this.desired.length, this.slots.length) }
    }
    for (const slot of this.slots) {
      let changed = false
      const wanted = this.desired.find(source => source.id === slot.source?.id)
      if (wanted) slot.source = wanted
      else slot.fade = Math.max(0, slot.fade - step)
      if (!slot.source || slot.fade === 0) {
        const next = this.desired.find(source => !this.slots.some(other => other !== slot && other.source?.id === source.id))
        if (next) {
          changed = slot.source?.id !== next.id
          slot.source = next
          slot.light.position.copy(next.position)
          slot.light.target.position.copy(next.position).add(next.down)
        } else slot.source = null
      }
      if (!changed && slot.source && this.desired.some(source => source.id === slot.source!.id)) slot.fade = Math.min(1, slot.fade + step)
      const distance = slot.source?.position.distanceTo(focus) ?? STREET_LIGHT_RANGE
      const rangeFade = 1 - THREE.MathUtils.smoothstep(distance, 22, STREET_LIGHT_RANGE)
      slot.strength = LIGHT_INTENSITY * slot.fade * rangeFade
      slot.light.intensity = slot.strength * this.night ** 2
    }
  }

  dispose() {
    for (const { light } of this.slots) {
      this.parent.remove(light, light.target)
      light.dispose()
    }
    this.reset()
  }
}
