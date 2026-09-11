import { expect, test } from 'bun:test'
import { AudioActivity, isAudioActive } from './audioActivity'

class Context {
  state: AudioContextState = 'running'
  calls: string[] = []
  pending: Array<{ kind: 'resume' | 'suspend'; finish: () => void }> = []
  deferred = false
  private change(kind: 'resume' | 'suspend') {
    this.calls.push(kind)
    return new Promise<void>(resolve => {
      const finish = () => {
        if (this.state !== 'closed') this.state = kind === 'resume' ? 'running' : 'suspended'
        resolve()
      }
      if (this.deferred) this.pending.push({ kind, finish }); else finish()
    })
  }
  resume() { return this.change('resume') }
  suspend() { return this.change('suspend') }
  close() { this.calls.push('close'); this.state = 'closed'; return Promise.resolve() }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve() }

test('immersive visibility owns XR audio while ordinary pages follow their document', () => {
  expect(isAudioActive(false, null)).toBe(true)
  expect(isAudioActive(true, null)).toBe(false)
  expect(isAudioActive(true, 'visible')).toBe(true)
  expect(isAudioActive(true, 'visible-blurred')).toBe(true)
  expect(isAudioActive(false, 'hidden')).toBe(false)
})

test('hidden pages suspend an existing context and return without replacing it', async () => {
  const activity = new AudioActivity(), context = new Context()
  activity.attach(context)
  expect(context.calls).toEqual([])
  activity.setActive(false); await flush()
  expect(context.state).toBe('suspended')
  activity.setActive(true); await flush()
  expect(context.state).toBe('running')
  expect(context.calls).toEqual(['suspend', 'resume'])
  activity.dispose()
})

test('a late audio unlock respects the current hidden state', async () => {
  const activity = new AudioActivity(), context = new Context()
  activity.setActive(false); activity.attach(context); await flush()
  expect(context.state).toBe('suspended')
  activity.sync(); await flush()
  expect(context.calls).not.toContain('resume')
  activity.dispose()
})

test('a delayed resume cannot leave the latest hidden state audible', async () => {
  const activity = new AudioActivity(), context = new Context()
  context.state = 'suspended'; context.deferred = true
  activity.attach(context)
  activity.setActive(false)
  expect(context.pending.map(p => p.kind)).toEqual(['resume', 'suspend'])
  // Simulate the old resume completing after the newer hide operation.
  context.pending[1].finish(); await flush()
  context.pending[0].finish(); await flush()
  expect(context.pending.at(-1)?.kind).toBe('suspend')
  context.pending.at(-1)!.finish(); await flush()
  expect(context.state).toBe('suspended')
  activity.dispose()
})

test('a delayed hide completes with the latest visible state restored', async () => {
  const activity = new AudioActivity(), context = new Context()
  activity.attach(context); context.deferred = true
  activity.setActive(false); activity.setActive(true)
  context.pending[0].finish(); await flush()
  expect(context.pending.at(-1)?.kind).toBe('resume')
  context.pending.at(-1)!.finish(); await flush()
  expect(context.state).toBe('running')
  activity.dispose()
})

test('closing releases audio once and pending requests cannot reopen it', async () => {
  const activity = new AudioActivity(), context = new Context()
  context.state = 'suspended'; context.deferred = true
  activity.attach(context); activity.dispose(); activity.dispose()
  context.pending[0].finish(); await flush()
  activity.setActive(true); activity.sync()
  expect(context.calls).toEqual(['resume', 'close'])
  expect(context.state).toBe('closed')
  const late = new Context(); activity.attach(late); await flush()
  expect(late.calls).toEqual(['close'])
})

test('browser-denied resume remains retryable from a later user gesture', async () => {
  const activity = new AudioActivity(), context = new Context()
  context.state = 'suspended'
  const resume = context.resume.bind(context)
  context.resume = () => Promise.reject(new Error('autoplay denied'))
  activity.attach(context); await flush()
  context.resume = resume; activity.sync(); await flush()
  expect(context.state).toBe('running')
  activity.dispose()
})
