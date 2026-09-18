import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { ColonyDataError, COLONY_DOCUMENT_CONCURRENCY, COLONY_DOCUMENT_FORMAT, readColonyDocument } from './colonyManifestDocument'

function fixture(values: unknown[]) {
  const buffers = values.map(value => new TextEncoder().encode(JSON.stringify(value) + '\n').buffer)
  const parts = buffers.map(buffer => ({
    $part: '/landscapes/izma/data-' + createHash('sha256').update(new Uint8Array(buffer)).digest('hex') + '.json',
    bytes: buffer.byteLength
  }))
  const lookup = new Map(parts.map((part, i) => [part.$part, buffers[i]]))
  return { buffers, parts, lookup, document: { storage: COLONY_DOCUMENT_FORMAT,
    sourceSha256: 'a'.repeat(64), parts: lookup.size,
    partBytes: [...lookup.values()].reduce((sum, buffer) => sum + buffer.byteLength, 0),
    data: { vertices: { $concat: parts } } } }
}

test('out-of-order JSON requests preserve native array order and limit concurrency', async () => {
  const f = fixture([[1.23456, -98765.4321], [], [3, 4, 5], [6], [7], [8]])
  let active = 0, peak = 0
  const complete: number[] = []
  const result = await readColonyDocument(f.document, {
    load: async url => {
      const i = f.parts.findIndex(p => p.$part === url)
      active++; peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, i === 0 ? 15 : 1))
      active--; complete.push(i)
      return f.lookup.get(url)!
    }
  })
  expect(result).toEqual({ vertices: [1.23456, -98765.4321, 3, 4, 5, 6, 7, 8] })
  expect(complete[0]).not.toBe(0)
  expect(peak).toBe(COLONY_DOCUMENT_CONCURRENCY)
})

test('corrupt, missing or truncated geometry rejects the whole assembly and cancels other requests', async () => {
  for (const failure of ['corrupt', 'missing', 'truncated']) {
    const f = fixture([[1, 2, 3], [4, 5, 6], [7, 8, 9]])
    const signals: AbortSignal[] = []
    await expect(readColonyDocument(f.document, { load: async (url, signal) => {
      signals.push(signal)
      if (url === f.parts[0].$part) {
        if (failure === 'missing') throw Error('404')
        const bytes = new Uint8Array(f.buffers[0].slice(0))
        if (failure === 'truncated') return bytes.buffer.slice(0, bytes.length - 1)
        bytes[1] = '9'.charCodeAt(0); return bytes.buffer
      }
      await new Promise(resolve => setTimeout(resolve, 5))
      return f.lookup.get(url)!
    } })).rejects.toBeInstanceOf(ColonyDataError)
    expect(signals.length).toBeGreaterThan(0)
    expect(signals.every(s => s.aborted)).toBe(true)
  }
})

test('external cancellation cannot return a partial manifest', async () => {
  const f = fixture([[1], [2], [3], [4]]), controller = new AbortController()
  let published = false
  const read = readColonyDocument(f.document, { signal: controller.signal, load: async url => {
    await new Promise(resolve => setTimeout(resolve, 5))
    return f.lookup.get(url)!
  } }).then(result => { published = true; return result })
  controller.abort()
  await expect(read).rejects.toThrow()
  expect(published).toBe(false)
})

test('rejects unsafe references, incomplete indexes and non-array slices', async () => {
  const f = fixture([[1], [2]])
  for (const change of [
    { parts: 1 },
    { partBytes: 1 },
    { data: { vertices: { $part: 'https://example.com/geometry', bytes: 4 } } },
    { data: { vertices: { $concat: 3 } } }
  ]) {
    let calls = 0
    await expect(readColonyDocument({ ...f.document, ...change }, { load: async () => { calls++; return f.buffers[0] } })).rejects.toThrow()
    expect(calls).toBe(0)
  }
  const bad = fixture([{ vertices: [] }])
  await expect(readColonyDocument(bad.document, { load: async url => bad.lookup.get(url)! })).rejects.toThrow('not an array')
})

test('keeps archived inline manifests readable without requesting data parts', async () => {
  const inline = { version: 1, base: { vertices: [1, 2, 3] } }
  expect(await readColonyDocument(inline, { load: async () => { throw Error('unexpected request') } })).toBe(inline)
})
