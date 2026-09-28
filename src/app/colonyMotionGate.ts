import type { RegionalMotion, RegionalPreparation } from '../worlds/regionalMotion'
import type { ColonyFocus } from '../worlds/colonyRegionStore'

export type RegionalReadiness = {
  prepareRegions(foci: readonly ColonyFocus[], preparation?: RegionalPreparation): boolean
  getRegionalStatus(): { failed: { attempts: number; message: string }[] } | null
  retryRegions(): void
}

/** A single pending arrival, owned by one world's immutable regional store.
 * The frame loop consumes it only after both the old body and destination are
 * ready. No timer or late promise can teleport into a replacement world. */
export class ColonyMotionGate {
  private arrival: { key: object | null; focus: ColonyFocus; apply: () => void } | null = null
  state: 'ready' | 'loading' | 'failed' = 'ready'
  error = ''
  get pendingArrival() { return this.arrival !== null }

  queue(source: RegionalReadiness, focus: ColonyFocus, apply: () => void) {
    const key = source.getRegionalStatus()
    this.cancel()
    if (!key) { apply(); return }
    source.retryRegions()
    this.arrival = { key, focus, apply }; this.state = 'loading'
  }

  step(source: RegionalReadiness, foci: readonly ColonyFocus[], motion?: RegionalMotion): boolean {
    const key = source.getRegionalStatus()
    if (this.arrival && this.arrival.key !== key) this.cancel()
    try {
      const ready = source.prepareRegions(this.arrival ? [...foci, this.arrival.focus] : foci,
        motion ? { motion, arrival: this.arrival?.focus } : undefined)
      if (!ready) {
        this.state = key?.failed.some(f => f.attempts >= 3) ? 'failed' : 'loading'
        this.error = key?.failed[0]?.message ?? ''
        return false
      }
      const arrival = this.arrival
      arrival?.apply()
      this.arrival = null
      this.state = 'ready'; this.error = ''
      return true
    } catch (error) {
      this.state = 'failed'; this.error = String(error)
      return false
    }
  }

  cancel() { this.arrival = null; this.state = 'ready'; this.error = '' }

  get card() {
    if (this.state === 'ready') return null
    return { title: this.state === 'failed' ? 'Area unavailable' : this.arrival ? 'Preparing destination' : 'Loading nearby streets',
      body: this.state === 'failed'
        ? ['Movement is paused while the area is unavailable.', 'Choose a destination again to retry, or choose another habitat.']
        : ['Movement will continue when the ground is ready.', 'You can look around or choose another destination.'],
      durationSeconds: Infinity }
  }
}
