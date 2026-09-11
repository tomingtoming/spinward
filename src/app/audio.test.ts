import { expect, test } from 'bun:test'
import { GameAudio } from './audio'

class Parameter {
  value = 0
  linearRampToValueAtTime(value: number) { this.value = value }
  setTargetAtTime(value: number) { this.value = value }
}
class Node {
  gain = new Parameter()
  frequency = new Parameter()
  Q = new Parameter()
  connect() {}
  start() {}
}
class Context {
  static instances: Context[] = []
  static fail = false
  state: AudioContextState = 'running'
  sampleRate = 1000
  currentTime = 0
  destination = {}
  gains: Node[] = []
  calls: string[] = []
  constructor() {
    if (Context.fail) throw Error('Device unavailable')
    Context.instances.push(this)
  }
  resume() { this.calls.push('resume'); this.state = 'running'; return Promise.resolve() }
  suspend() { this.calls.push('suspend'); this.state = 'suspended'; return Promise.resolve() }
  close() { this.calls.push('close'); this.state = 'closed'; return Promise.resolve() }
  createGain() { const node = new Node(); this.gains.push(node); return node }
  createBiquadFilter() { return new Node() }
  createOscillator() { return new Node() }
  createBufferSource() { return new Node() }
  createBuffer(_channels: number, length: number) { return { getChannelData: () => new Float32Array(length) } }
}
const withContext = async (run: () => Promise<void> | void) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { AudioContext: Context } })
  Context.instances = []; Context.fail = false
  try { await run() } finally {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else Reflect.deleteProperty(globalThis, 'window')
  }
}

test('prepared audio remains suspended and silent through visibility changes until a gesture', () => withContext(() => {
  const audio = new GameAudio()
  audio.prepare(); audio.prepare()
  const context = Context.instances[0]
  expect(Context.instances).toHaveLength(1)
  expect(context.state).toBe('suspended')
  expect(context.gains[0].gain.value).toBe(0)
  expect(audio.roomAudioState.state).toBe('locked')
  audio.setActive(false); audio.setActive(true)
  audio.setMuted(true); audio.setMuted(false)
  expect(context.calls).not.toContain('resume')
  expect(context.gains[0].gain.value).toBe(0)
  const nodeCount = context.gains.length
  audio.unlock(); audio.unlock()
  expect(Context.instances).toHaveLength(1)
  expect(context.gains).toHaveLength(nodeCount)
  expect(context.state).toBe('running')
  expect(context.gains[0].gain.value).toBeCloseTo(0.6)
  audio.dispose()
}))

test('a hidden first gesture cannot resume prepared audio and preserves mute on return', () => withContext(() => {
  const audio = new GameAudio()
  audio.setActive(false); audio.setMuted(true); audio.prepare(); audio.unlock()
  const context = Context.instances[0]
  expect(context.state).toBe('suspended')
  expect(context.gains[0].gain.value).toBe(0)
  audio.setActive(true)
  expect(context.state).toBe('running')
  expect(audio.isMuted).toBe(true)
  expect(context.gains[0].gain.value).toBe(0)
  audio.dispose(); audio.dispose(); audio.prepare(); audio.unlock()
  expect(context.calls.filter(call => call === 'close')).toHaveLength(1)
  expect(Context.instances).toHaveLength(1)
}))

test('unavailable audio devices do not break preparation and can retry on a gesture', () => withContext(() => {
  const audio = new GameAudio()
  Context.fail = true
  expect(() => audio.prepare()).not.toThrow()
  expect(audio.roomAudioState.state).toBe('locked')
  Context.fail = false
  audio.unlock()
  expect(Context.instances).toHaveLength(1)
  expect(Context.instances[0].state).toBe('running')
  audio.dispose()
}))
