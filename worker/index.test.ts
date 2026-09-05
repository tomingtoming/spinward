import { describe, expect, test } from 'bun:test'
import worker, { metric } from './index'

type Point = { indexes?: string[]; blobs?: string[]; doubles?: number[] }

const makeEnv = () => {
  const points: Point[] = []
  return {
    points,
    env: {
      ASSETS: { fetch: async () => new Response('asset', { status: 200 }) },
      PLAY: { writeDataPoint: (p: Point) => void points.push(p) }
    }
  }
}

const post = (body: unknown, init: RequestInit = {}) =>
  new Request('https://spinward.toming.app/metric', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init
  })

describe('/metric', () => {
  test('writes one sanitized data point per event with server-side host', async () => {
    const { env, points } = makeEnv()
    const request = Object.assign(
      post({
        vid: 'visitor1',
        sid: 'sid1',
        aud: 'dev',
        build: 'abc123',
        events: [
          { e: 'session', preset: 'izma', entry: 'landing', device: 'touch', lang: 'ja', tier: 'phone', ref: 't.co', visits: 3, days: 12 },
          { e: 'milestone', m: 'throw', preset: 'izma', entry: 'landing', device: 'touch', lang: 'ja', tier: 'phone', secs: 14, depth: 1 },
          { e: 'bogus' }
        ]
      }),
      { cf: { country: 'JP' } }
    )
    const response = await metric(request, env)
    expect(response.status).toBe(204)
    expect(points.length).toBe(2)
    expect(points[0].indexes).toEqual(['visitor1'])
    expect(points[0].blobs).toEqual([
      'session', '', 'izma', 'landing', 'touch', 'ja', 't.co', '', 'dev', 'sid1', 'abc123',
      'spinward.toming.app', 'JP', 'phone'
    ])
    expect(points[0].doubles).toEqual([0, 3, 12, 0, 0, 0])
    expect(points[1].blobs?.slice(0, 2)).toEqual(['milestone', 'throw'])
    expect(points[1].doubles).toEqual([14, 0, 0, 0, 1, 0])
  })

  test('accepts boot-fail from the entry point (the load that never became a session)', async () => {
    const { env, points } = makeEnv()
    const request = Object.assign(
      post({
        vid: 'visitor9',
        sid: 'sid9',
        aud: 'public',
        build: 'def456',
        events: [
          {
            e: 'boot-fail',
            reason: 'webgl',
            device: 'desktop',
            lang: 'en-US',
            ref: 'news.ycombinator.com',
            visits: 1,
            days: 0
          }
        ]
      }),
      { cf: { country: 'US' } }
    )
    const response = await metric(request, env)
    expect(response.status).toBe(204)
    expect(points.length).toBe(1)
    expect(points[0].blobs).toEqual([
      'boot-fail', '', '', '', 'desktop', 'en-US', 'news.ycombinator.com', 'webgl', 'public', 'sid9',
      'def456', 'spinward.toming.app', 'US', ''
    ])
    expect(points[0].doubles).toEqual([0, 1, 0, 0, 0, 0])
  })

  test('non-finite doubles and oversized blobs are clamped, unknown audience is public', async () => {
    const { env, points } = makeEnv()
    await metric(
      post({ vid: 'x'.repeat(200), aud: 'admin', events: [{ e: 'leave', secs: 'NaN', depth: Infinity, reason: 'r'.repeat(100) }] }),
      env
    )
    expect(points[0].indexes?.[0].length).toBe(64)
    expect(points[0].blobs?.[7].length).toBe(32)
    expect(points[0].blobs?.[8]).toBe('public')
    expect(points[0].doubles).toEqual([0, 0, 0, 0, 0, 0])
  })

  test('rejects GET, cross-origin, malformed and oversized bodies', async () => {
    const { env } = makeEnv()
    expect((await metric(new Request('https://spinward.toming.app/metric'), env)).status).toBe(405)
    expect((await metric(post({ events: [] }, { headers: { Origin: 'https://evil.example' } }), env)).status).toBe(403)
    expect((await metric(post('{nope'), env)).status).toBe(400)
    expect((await metric(post({ events: 'no' }), env)).status).toBe(400)
    expect((await metric(post({ events: [], pad: 'x'.repeat(9000) }), env)).status).toBe(413)
  })

  test('without the binding it accepts and drops (204)', async () => {
    const env = { ASSETS: { fetch: async () => new Response('asset') } }
    expect((await metric(post({ events: [{ e: 'session' }] }), env)).status).toBe(204)
  })

  test('the default export routes /metric and leaves assets alone', async () => {
    const { env, points } = makeEnv()
    const hit = await worker.fetch(post({ vid: 'v', events: [{ e: 'session' }] }), env)
    expect(hit.status).toBe(204)
    expect(points.length).toBe(1)
    const asset = await worker.fetch(new Request('https://spinward.toming.app/assets/x.js'), env)
    expect(await asset.text()).toBe('asset')
  })
})
