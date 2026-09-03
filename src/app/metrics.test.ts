import { describe, expect, test } from 'bun:test'
import {
  classifyBootFailure,
  createRecorder,
  createShipper,
  readAudience,
  readVisitor,
  referrerHost,
  reportBootFailure,
  type MetricsEvent,
  type StorageLike
} from './metrics'

const makeStore = (broken = false): StorageLike & { map: Map<string, string> } => {
  const map = new Map<string, string>()
  const deny = () => {
    throw new Error('denied')
  }
  return {
    map,
    getItem: (k) => (broken ? deny() : (map.get(k) ?? null)),
    setItem: (k, v) => (broken ? deny() : void map.set(k, v)),
    removeItem: (k) => (broken ? deny() : void map.delete(k))
  }
}

const DAY = 86_400_000
const T0 = Date.parse('2026-09-02T09:00:00Z')

describe('readVisitor', () => {
  test('first load mints an id, visits 1, days 0', () => {
    const v = readVisitor(makeStore(), T0, () => 'abc')
    expect(v).toMatchObject({ id: 'abc', visits: 1, days: 0, persisted: true })
  })
  test('a return visit keeps the id and counts', () => {
    const store = makeStore()
    readVisitor(store, T0, () => 'abc')
    const v = readVisitor(store, T0 + 3 * DAY, () => 'zzz')
    expect(v).toMatchObject({ id: 'abc', visits: 2, days: 3 })
  })
  test('storage denied reports visits 0, not 1', () => {
    const v = readVisitor(makeStore(true), T0, () => 'abc')
    expect(v.visits).toBe(0)
    expect(v.persisted).toBe(false)
  })
  test('a corrupt record is treated as absent', () => {
    const store = makeStore()
    store.map.set('spinward-visitor', '{not json')
    expect(readVisitor(store, T0, () => 'new').visits).toBe(1)
  })
})

describe('readAudience', () => {
  test('defaults to public and the flag is sticky', () => {
    const store = makeStore()
    expect(readAudience(store, '')).toBe('public')
    expect(readAudience(store, '?metrics=dev')).toBe('dev')
    expect(readAudience(store, '')).toBe('dev')
    expect(readAudience(store, '?metrics=public')).toBe('public')
    expect(readAudience(store, '?metrics=off')).toBe('off')
  })
  test('honours the flag for this load when storage is denied', () => {
    expect(readAudience(makeStore(true), '?metrics=dev')).toBe('dev')
    expect(readAudience(makeStore(true), '')).toBe('public')
  })
})

describe('referrerHost', () => {
  test('host only, never our own', () => {
    expect(referrerHost('https://t.co/abc?x=1', 'spinward.toming.app')).toBe('t.co')
    expect(referrerHost('https://spinward.toming.app/?m=g', 'spinward.toming.app')).toBe('')
    expect(referrerHost('', 'spinward.toming.app')).toBe('')
    expect(referrerHost('nonsense', 'spinward.toming.app')).toBe('')
  })
})

const drive = () => {
  let t = 0
  const events: MetricsEvent[] = []
  const recorder = createRecorder({
    now: () => t,
    emit: (e) => events.push(e),
    context: { preset: 'izma', entry: 'landing', device: 'desktop', lang: 'ja', tier: 'desktop' }
  })
  return { recorder, events, tick: (ms: number) => (t += ms) }
}

describe('createRecorder', () => {
  test('a visit: session → throw → axis → leave, with visible seconds', () => {
    const { recorder, events, tick } = drive()
    recorder.session({ id: 'v', first: '2026-09-02', visits: 1, days: 0, persisted: true }, 't.co')
    tick(12_000)
    expect(recorder.milestone('throw')).toBe(true)
    tick(30_000)
    recorder.milestone('axis')
    tick(5_000)
    recorder.leave('pagehide')
    expect(events.map((e) => e.e)).toEqual(['session', 'milestone', 'milestone', 'leave'])
    expect(events[1]).toMatchObject({ m: 'throw', secs: 12, depth: 1 })
    expect(events[2]).toMatchObject({ m: 'axis', secs: 42, depth: 2 })
    expect(events[3]).toMatchObject({ secs: 47, hidden: 0, depth: 2, reason: 'pagehide' })
  })

  test('milestones are one-shot and non-funnel events are ignored', () => {
    const { recorder, events } = drive()
    expect(recorder.milestone('throw')).toBe(true)
    expect(recorder.milestone('throw')).toBe(false)
    expect(recorder.milestone('start')).toBe(false)
    expect(recorder.milestone('enter-grounded')).toBe(false)
    expect(events.length).toBe(1)
  })

  test('hidden time is subtracted and shipped alongside', () => {
    const { recorder, events, tick } = drive()
    tick(10_000)
    recorder.visibility(true)
    tick(60_000)
    recorder.visibility(false)
    tick(5_000)
    recorder.milestone('jump')
    recorder.visibility(true)
    tick(20_000)
    recorder.leave('pagehide')
    expect(events[0]).toMatchObject({ m: 'jump', secs: 15 })
    expect(events[1]).toMatchObject({ e: 'leave', secs: 15, hidden: 80 })
  })

  test('VR flips the device and leave closes an open VR session', () => {
    const { recorder, events, tick } = drive()
    recorder.milestone('throw')
    tick(1_000)
    recorder.vrStart()
    tick(90_000)
    recorder.milestone('axis')
    recorder.leave('pagehide', 71.5)
    expect(events[0].device).toBe('desktop')
    expect(events[1]).toMatchObject({ e: 'vr-start', device: 'vr', secs: 1 })
    expect(events[2]).toMatchObject({ m: 'axis', device: 'vr' })
    expect(events[3]).toMatchObject({ e: 'vr-end', secs: 90, reason: 'pagehide', fps: 71.5 })
    expect(events[4]).toMatchObject({ e: 'leave', device: 'vr', depth: 2 })
  })

  test('leave is idempotent and nothing is recorded after it', () => {
    const { recorder, events } = drive()
    recorder.leave('pagehide')
    recorder.leave('pagehide')
    recorder.milestone('throw')
    expect(events.length).toBe(1)
  })
})

describe('createShipper', () => {
  const event = (e: MetricsEvent['e']): MetricsEvent => ({
    e,
    preset: 'izma',
    entry: 'landing',
    device: 'desktop',
    lang: 'ja',
    tier: 'desktop'
  })

  test('batches a burst into one request and flushes leave synchronously', () => {
    const sent: string[] = []
    let scheduled: (() => void) | null = null
    const shipper = createShipper({
      endpoint: '/metric',
      vid: 'v',
      sid: 's',
      aud: 'public',
      build: 'b',
      send: (_url, body) => {
        sent.push(body)
        return true
      },
      schedule: (flush) => {
        scheduled = flush
      }
    })
    shipper.emit(event('session'))
    shipper.emit(event('milestone'))
    expect(sent.length).toBe(0)
    expect(shipper.queued()).toBe(2)
    scheduled!()
    expect(sent.length).toBe(1)
    const batch = JSON.parse(sent[0])
    expect(batch).toMatchObject({ v: 1, vid: 'v', sid: 's', aud: 'public', build: 'b' })
    expect(batch.events.length).toBe(2)
    shipper.emit(event('leave'))
    expect(sent.length).toBe(2)
    expect(shipper.sent()).toBe(3)
  })
})

describe('classifyBootFailure', () => {
  const ok = { webgl2: true, wasm: true }

  test('a missing WebGL2 context wins over whatever the error said', () => {
    expect(classifyBootFailure(new Error('fetch failed'), { webgl2: false, wasm: true })).toBe('webgl')
  })

  test('missing WebAssembly is reported as wasm', () => {
    expect(classifyBootFailure(new Error('boom'), { webgl2: true, wasm: false })).toBe('wasm')
  })

  test('falls back to reading the message when the browser is capable', () => {
    expect(classifyBootFailure(new Error('Error creating WebGL context'), ok)).toBe('webgl')
    expect(classifyBootFailure(new Error('WebAssembly.instantiate failed'), ok)).toBe('wasm')
    expect(classifyBootFailure(new TypeError('Load failed'), ok)).toBe('network')
    expect(classifyBootFailure('something else entirely', ok)).toBe('unknown')
    expect(classifyBootFailure(undefined, ok)).toBe('unknown')
  })
})

describe('reportBootFailure', () => {
  const base = {
    error: new Error('Error creating WebGL context'),
    search: '',
    build: 'abc1234',
    language: 'en-US',
    touch: false,
    referrer: 'https://news.ycombinator.com/item?id=1',
    ownHost: 'spinward.toming.app',
    probe: { webgl2: true, wasm: true },
    mkId: () => 'fixedid0fixedid0'
  }

  test('sends one boot-fail event with the wire envelope', () => {
    const sent: { url: string; body: string }[] = []
    const reason = reportBootFailure({
      ...base,
      store: makeStore(),
      send: (url, body) => {
        sent.push({ url, body })
        return true
      }
    })

    expect(reason).toBe('webgl')
    expect(sent).toHaveLength(1)
    expect(sent[0].url).toBe('/metric')
    const payload = JSON.parse(sent[0].body)
    expect(payload.v).toBe(1)
    expect(payload.aud).toBe('public')
    expect(payload.build).toBe('abc1234')
    expect(payload.events).toHaveLength(1)
    expect(payload.events[0]).toMatchObject({
      e: 'boot-fail',
      reason: 'webgl',
      device: 'desktop',
      lang: 'en-US',
      ref: 'news.ycombinator.com',
      visits: 1
    })
  })

  test('honours ?metrics=off and sends nothing', () => {
    const sent: string[] = []
    const reason = reportBootFailure({
      ...base,
      search: '?metrics=off',
      store: makeStore(),
      send: (_url, body) => {
        sent.push(body)
        return true
      }
    })

    expect(reason).toBeNull()
    expect(sent).toHaveLength(0)
  })

  test('works with storage denied (private mode): visits 0, still reports', () => {
    const sent: string[] = []
    const reason = reportBootFailure({
      ...base,
      store: makeStore(true),
      send: (_url, body) => {
        sent.push(body)
        return true
      }
    })

    expect(reason).toBe('webgl')
    expect(JSON.parse(sent[0]).events[0].visits).toBe(0)
  })

  test('touch devices are tagged as touch', () => {
    const sent: string[] = []
    reportBootFailure({
      ...base,
      touch: true,
      store: makeStore(),
      send: (_url, body) => {
        sent.push(body)
        return true
      }
    })

    expect(JSON.parse(sent[0]).events[0].device).toBe('touch')
  })
})
