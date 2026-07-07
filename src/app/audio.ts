// Synthesized audio: no assets, everything generated with WebAudio. The
// context unlocks on the first user gesture (browser autoplay policy).
//
// Two buses hang off the master:
//  · world — every sound the AIR carries (ambience, city, wind, rain, impacts).
//    Outside the hull there is no air, so the whole bus ducks to silence.
//  · self — what your own body makes (breath, heartbeat). It rises exactly
//    when the world goes quiet: the vacuum is not silent, it is just you.

const AMBIENCE_GAIN = 0.05
const MASTER_GAIN = 0.6
const CITY_BED_GAIN = 0.07
const WIND_GAIN = 0.22
const SELF_GAIN = 0.8
// Resting-ish heart: the readout of a person floating alone in a hard vacuum.
const HEARTBEAT_PERIOD_SECONDS = 0.95

export type EnvironmentMix = {
  city: number
  wind: number
  vacuum: number
}

export class GameAudio {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private world: GainNode | null = null
  private ambienceGain: GainNode | null = null
  private cityGain: GainNode | null = null
  private windGain: GainNode | null = null
  private windFilter: BiquadFilterNode | null = null
  private selfGain: GainNode | null = null
  private nextHeartTime = 0
  private muted = false
  // Sustained jetpack voice (built lazily, modulated each frame by throttle).
  // The looping noise source stays alive via its graph connection to master.
  private jetFilter: BiquadFilterNode | null = null
  private jetGain: GainNode | null = null
  // Sustained rain voice: looping noise shaped into a hiss-patter, level
  // tracking the shower strength each frame (same lazy pattern as the jetpack).
  private rainFilter: BiquadFilterNode | null = null
  private rainGain: GainNode | null = null

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
    this.world = this.context.createGain()
    this.world.gain.value = 1
    this.world.connect(this.master)
    this.startAmbience()
  }

  // Air-carried sounds route here so the vacuum duck silences them together.
  private get worldBus(): GainNode | null {
    return this.world ?? this.master
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

  // 'pink' is the rain colour: white through a one-pole lowpass mix reads as
  // rain on foliage/pavement, where pure white reads as radio static.
  private makeLoopingNoise(seconds: number, kind: 'white' | 'brown' | 'pink') {
    const ctx = this.context

    if (ctx === null) {
      return null
    }

    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let smooth = 0

    for (let index = 0; index < data.length; index += 1) {
      const white = Math.random() * 2 - 1

      if (kind === 'white') {
        data[index] = white
      } else if (kind === 'pink') {
        smooth = smooth * 0.94 + white * 0.06
        data[index] = white * 0.35 + smooth * 3.2
      } else {
        smooth = (smooth + 0.02 * white) / 1.02
        data[index] = smooth * 3.5
      }
    }

    const noise = ctx.createBufferSource()
    noise.buffer = buffer
    noise.loop = true
    return noise
  }

  // The standing voices, all built once and silent until their gains rise:
  // structure hum (always), city bed + wind (setEnvironment), breath (vacuum).
  private startAmbience() {
    const ctx = this.context
    const world = this.world
    const master = this.master

    if (ctx === null || world === null || master === null) {
      return
    }

    // Habitat hum: looping filtered noise + a faint low drone.
    const noise = this.makeLoopingNoise(4, 'brown')

    if (noise === null) {
      return
    }

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
    this.ambienceGain.connect(world)
    noise.start()
    drone.start()

    // City bed: a mid-band murmur with a slow swell, the far streets breathing.
    const cityNoise = this.makeLoopingNoise(5, 'white')

    if (cityNoise !== null) {
      const cityFilter = ctx.createBiquadFilter()
      cityFilter.type = 'bandpass'
      cityFilter.frequency.value = 750
      cityFilter.Q.value = 0.4

      // The swell rides a series gain so a silent city stays exactly silent.
      const undulate = ctx.createGain()
      undulate.gain.value = 1
      const swell = ctx.createOscillator()
      swell.type = 'sine'
      swell.frequency.value = 0.06
      const swellDepth = ctx.createGain()
      swellDepth.gain.value = 0.3
      swell.connect(swellDepth)
      swellDepth.connect(undulate.gain)

      this.cityGain = ctx.createGain()
      this.cityGain.gain.value = 0

      cityNoise.connect(cityFilter)
      cityFilter.connect(undulate)
      undulate.connect(this.cityGain)
      this.cityGain.connect(world)
      cityNoise.start()
      swell.start()
    }

    // Wind: airspeed noise, brightness tracking the speed (setEnvironment).
    const windNoise = this.makeLoopingNoise(3, 'white')

    if (windNoise !== null) {
      const windHighpass = ctx.createBiquadFilter()
      windHighpass.type = 'highpass'
      windHighpass.frequency.value = 300

      this.windFilter = ctx.createBiquadFilter()
      this.windFilter.type = 'lowpass'
      this.windFilter.frequency.value = 400
      this.windFilter.Q.value = 0.6

      this.windGain = ctx.createGain()
      this.windGain.gain.value = 0

      windNoise.connect(windHighpass)
      windHighpass.connect(this.windFilter)
      this.windFilter.connect(this.windGain)
      this.windGain.connect(world)
      windNoise.start()
    }

    // The self voice bypasses the world duck: breath swells on a slow cycle,
    // the heartbeat is scheduled per beat in setEnvironment.
    this.selfGain = ctx.createGain()
    this.selfGain.gain.value = 0
    this.selfGain.connect(master)

    const breathNoise = this.makeLoopingNoise(4, 'white')

    if (breathNoise !== null) {
      const breathFilter = ctx.createBiquadFilter()
      breathFilter.type = 'lowpass'
      breathFilter.frequency.value = 480
      breathFilter.Q.value = 0.4

      // In-and-out at ~10 breaths/min: an LFO around a positive base gain.
      const breathShape = ctx.createGain()
      breathShape.gain.value = 0.11
      const breathLfo = ctx.createOscillator()
      breathLfo.type = 'sine'
      breathLfo.frequency.value = 0.16
      const breathDepth = ctx.createGain()
      breathDepth.gain.value = 0.09
      breathLfo.connect(breathDepth)
      breathDepth.connect(breathShape.gain)

      breathNoise.connect(breathFilter)
      breathFilter.connect(breathShape)
      breathShape.connect(this.selfGain)
      breathNoise.start()
      breathLfo.start()
    }
  }

  // A single lub-dub into the self bus.
  private scheduleHeartbeat(when: number) {
    const ctx = this.context
    const selfGain = this.selfGain

    if (ctx === null || selfGain === null) {
      return
    }

    const thump = (at: number, hz: number, level: number) => {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(hz, at)
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, hz * 0.6), at + 0.1)

      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(level, at + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.12)

      osc.connect(gain)
      gain.connect(selfGain)
      osc.start(at)
      osc.stop(at + 0.14)
    }

    thump(when, 56, 0.5)
    thump(when + 0.3, 44, 0.32)
  }

  // Call every frame with the computed ambience mix (see app/ambienceMix.ts).
  setEnvironment(mix: EnvironmentMix) {
    const ctx = this.context
    const world = this.world

    if (ctx === null || world === null) {
      return
    }

    const now = ctx.currentTime
    const vacuum = Math.max(0, Math.min(1, mix.vacuum))

    world.gain.setTargetAtTime(1 - vacuum, now, 0.35)
    this.cityGain?.gain.setTargetAtTime(
      Math.max(0, Math.min(1, mix.city)) * CITY_BED_GAIN,
      now,
      0.5
    )

    const wind = Math.max(0, Math.min(1, mix.wind))
    this.windGain?.gain.setTargetAtTime(wind * WIND_GAIN, now, 0.12)
    this.windFilter?.frequency.setTargetAtTime(400 + wind * 2600, now, 0.12)

    this.selfGain?.gain.setTargetAtTime(vacuum * SELF_GAIN, now, 0.6)

    // Keep the heartbeat scheduled a beat ahead while in vacuum.
    if (vacuum > 0.05) {
      if (this.nextHeartTime < now) {
        this.nextHeartTime = now + 0.2
      }

      while (this.nextHeartTime < now + 0.8) {
        this.scheduleHeartbeat(this.nextHeartTime)
        this.nextHeartTime += HEARTBEAT_PERIOD_SECONDS
      }
    }
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

  // Short ping whose volume follows the impact speed. Air-carried: silent in
  // vacuum via the world bus.
  playBounce(impactSpeed: number) {
    const ctx = this.context
    const master = this.worldBus

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

  // Heavy boom for the beam / firework bursts: a deep falling sine for weight
  // plus a low noise crack — much heavier than the ball's playBounce ping.
  // `loudness` is 0..1 (nearer impacts louder). Air-carried (world bus).
  playExplosion(loudness: number) {
    const ctx = this.context
    const master = this.worldBus

    if (ctx === null || master === null) {
      return
    }

    const now = ctx.currentTime
    const level = Math.min(0.6, 0.3 + Math.max(0, Math.min(1, loudness)) * 0.3)

    // Deep body: a sine sweeping down low for chest-thump weight.
    const boom = ctx.createOscillator()
    boom.type = 'sine'
    boom.frequency.setValueAtTime(120, now)
    boom.frequency.exponentialRampToValueAtTime(32, now + 0.45)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(level, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6)

    boom.connect(gain)
    gain.connect(master)
    boom.start(now)
    boom.stop(now + 0.62)

    // A low, fast-falling noise crack layered on top of the boom.
    this.playNoiseSweep(700, 110, level * 0.7, 0.28, master)
  }

  // Distinct rising chirp when locomotion flips grounded<->free-fly.
  playModeChange() {
    const ctx = this.context
    const master = this.master

    if (ctx === null || master === null) {
      return
    }

    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(330, now)
    osc.frequency.exponentialRampToValueAtTime(660, now + 0.16)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22)

    osc.connect(gain)
    gain.connect(master)
    osc.start(now)
    osc.stop(now + 0.24)
  }

  // Sustained jetpack hiss whose level + brightness track the throttle (0..1).
  // Call every frame; the gain ramps to silence at zero so it never clicks, and
  // the voice is built lazily on first use.
  setJetpackThrottle(throttle: number) {
    const ctx = this.context
    const master = this.master

    if (ctx === null || master === null) {
      return
    }

    const level = Math.max(0, Math.min(1, throttle))

    if (this.jetGain === null || this.jetFilter === null) {
      // Don't build the sustained voice until the jetpack is actually used.
      if (level <= 0) {
        return
      }

      const seconds = 2
      const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let index = 0; index < data.length; index += 1) {
        data[index] = Math.random() * 2 - 1
      }

      const noise = ctx.createBufferSource()
      noise.buffer = buffer
      noise.loop = true

      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 240
      filter.Q.value = 0.7

      const gain = ctx.createGain()
      gain.gain.value = 0

      noise.connect(filter)
      filter.connect(gain)
      gain.connect(master)
      noise.start()

      this.jetFilter = filter
      this.jetGain = gain
    }

    const now = ctx.currentTime
    // setTargetAtTime smooths per-frame updates so the level/brightness glides.
    this.jetGain.gain.setTargetAtTime(level * 0.16, now, 0.05)
    this.jetFilter.frequency.setTargetAtTime(240 + level * 1600, now, 0.05)
  }

  // Sustained rain hiss whose level and brightness track the shower (0..1).
  // Call every frame; ramps to silence at zero so it never clicks. Air-carried.
  setRainLevel(level: number) {
    const ctx = this.context
    const master = this.worldBus

    if (ctx === null || master === null) {
      return
    }

    const amount = Math.max(0, Math.min(1, level))

    if (this.rainGain === null || this.rainFilter === null) {
      // Don't build the voice until it actually rains.
      if (amount <= 0) {
        return
      }

      const noise = this.makeLoopingNoise(3, 'pink')

      if (noise === null) {
        return
      }

      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.value = 1500
      filter.Q.value = 0.35

      const gain = ctx.createGain()
      gain.gain.value = 0

      noise.connect(filter)
      filter.connect(gain)
      gain.connect(master)
      noise.start()

      this.rainFilter = filter
      this.rainGain = gain
    }

    const now = ctx.currentTime
    // A slow-ish glide: showers swell, they don't step.
    this.rainGain.gain.setTargetAtTime(amount * 0.11, now, 0.25)
    this.rainFilter.frequency.setTargetAtTime(1100 + amount * 1400, now, 0.25)
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
    seconds: number,
    destination?: GainNode
  ) {
    const ctx = this.context
    const master = destination ?? this.master

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
