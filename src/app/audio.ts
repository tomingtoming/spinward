// Synthesized audio: no assets, everything generated with WebAudio. The
// context unlocks on the first user gesture (browser autoplay policy).

const AMBIENCE_GAIN = 0.05
const MASTER_GAIN = 0.6

export class GameAudio {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private ambienceGain: GainNode | null = null
  private muted = false

  // Call from a user-gesture handler; safe to call repeatedly.
  unlock() {
    if (this.context !== null) {
      if (this.context.state === 'suspended') {
        void this.context.resume()
      }
      return
    }

    const AudioContextClass =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

    if (AudioContextClass === undefined) {
      return
    }

    this.context = new AudioContextClass()
    this.master = this.context.createGain()
    this.master.gain.value = this.muted ? 0 : MASTER_GAIN
    this.master.connect(this.context.destination)
    this.startAmbience()
  }

  get isMuted() {
    return this.muted
  }

  setMuted(muted: boolean) {
    this.muted = muted

    if (this.context !== null && this.master !== null) {
      this.master.gain.linearRampToValueAtTime(
        muted ? 0 : MASTER_GAIN,
        this.context.currentTime + 0.1
      )
    }
  }

  toggleMuted() {
    this.setMuted(!this.muted)
    return this.muted
  }

  // Habitat hum: looping filtered noise + a faint low drone.
  private startAmbience() {
    const ctx = this.context
    const master = this.master

    if (ctx === null || master === null) {
      return
    }

    const seconds = 4
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let brown = 0

    for (let index = 0; index < data.length; index += 1) {
      const white = Math.random() * 2 - 1
      brown = (brown + 0.02 * white) / 1.02
      data[index] = brown * 3.5
    }

    const noise = ctx.createBufferSource()
    noise.buffer = buffer
    noise.loop = true

    const noiseFilter = ctx.createBiquadFilter()
    noiseFilter.type = 'lowpass'
    noiseFilter.frequency.value = 320
    noiseFilter.Q.value = 0.4

    const drone = ctx.createOscillator()
    drone.type = 'sine'
    drone.frequency.value = 55

    const droneGain = ctx.createGain()
    droneGain.gain.value = 0.25

    this.ambienceGain = ctx.createGain()
    this.ambienceGain.gain.value = 0
    this.ambienceGain.gain.linearRampToValueAtTime(AMBIENCE_GAIN, ctx.currentTime + 2.5)

    noise.connect(noiseFilter)
    noiseFilter.connect(this.ambienceGain)
    drone.connect(droneGain)
    droneGain.connect(this.ambienceGain)
    this.ambienceGain.connect(master)
    noise.start()
    drone.start()
  }

  // Filtered noise burst with a falling band-pass sweep.
  playThrow() {
    this.playNoiseSweep(1400, 350, 0.22, 0.16)
  }

  playJump() {
    this.playNoiseSweep(500, 1600, 0.28, 0.14)
  }

  playLand() {
    const ctx = this.context
    const master = this.master

    if (ctx === null || master === null) {
      return
    }

    const now = ctx.currentTime
    const thud = ctx.createOscillator()
    thud.type = 'sine'
    thud.frequency.setValueAtTime(110, now)
    thud.frequency.exponentialRampToValueAtTime(45, now + 0.18)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.4, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22)

    thud.connect(gain)
    gain.connect(master)
    thud.start(now)
    thud.stop(now + 0.24)
  }

  // Short ping whose volume follows the impact speed.
  playBounce(impactSpeed: number) {
    const ctx = this.context
    const master = this.master

    if (ctx === null || master === null) {
      return
    }

    const level = Math.min(0.35, 0.05 + impactSpeed * 0.03)

    if (level < 0.06) {
      return
    }

    const now = ctx.currentTime
    const ping = ctx.createOscillator()
    ping.type = 'triangle'
    ping.frequency.setValueAtTime(560 + Math.min(640, impactSpeed * 40), now)
    ping.frequency.exponentialRampToValueAtTime(180, now + 0.09)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(level, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12)

    ping.connect(gain)
    gain.connect(master)
    ping.start(now)
    ping.stop(now + 0.14)
  }

  playClick() {
    const ctx = this.context
    const master = this.master

    if (ctx === null || master === null) {
      return
    }

    const now = ctx.currentTime
    const blip = ctx.createOscillator()
    blip.type = 'square'
    blip.frequency.value = 1320

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.07, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05)

    blip.connect(gain)
    gain.connect(master)
    blip.start(now)
    blip.stop(now + 0.06)
  }

  private playNoiseSweep(
    fromHz: number,
    toHz: number,
    level: number,
    seconds: number
  ) {
    const ctx = this.context
    const master = this.master

    if (ctx === null || master === null) {
      return
    }

    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate)
    const data = buffer.getChannelData(0)

    for (let index = 0; index < data.length; index += 1) {
      data[index] = Math.random() * 2 - 1
    }

    const now = ctx.currentTime
    const noise = ctx.createBufferSource()
    noise.buffer = buffer

    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.Q.value = 1.1
    filter.frequency.setValueAtTime(fromHz, now)
    filter.frequency.exponentialRampToValueAtTime(toHz, now + seconds)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(level, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + seconds)

    noise.connect(filter)
    filter.connect(gain)
    gain.connect(master)
    noise.start(now)
  }
}
