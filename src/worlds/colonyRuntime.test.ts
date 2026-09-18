import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import authoring from './generated/izmaColony.json'
import runtime from './generated/izmaColonyRuntime.json'
import { readColonyDocument } from './colonyManifestDocument'
import { readColonyManifest } from './authoredColony'

const root = new URL('../../', import.meta.url)
const load = async (url: string) => {
  const bytes = await readFile(new URL('public' + url, root))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

test('shipped runtime belongs to the current authored colony and every regional payload is present and intact', async () => {
  // The outer document hashes the derived runtime; the regional catalog records
  // the authored input from which both the far and exact near meshes were made.
  expect(runtime.data.streaming.sourceSha256).toBe(authoring.sourceSha256)
  const manifest = readColonyManifest(await readColonyDocument(runtime, { load }))
  expect(manifest.streaming?.sourceSha256).toBe(authoring.sourceSha256)
  expect(manifest.streaming!.regions.length).toBeGreaterThan(0)
  const blend = await readFile(new URL('assets/blender/izma-far-ground.blend', root))
  expect(createHash('sha256').update(blend).digest('hex')).toBe(runtime.data.streaming.farBlendSha256)
  for (const region of manifest.streaming!.regions) {
    const data = new Uint8Array(await load(region.url))
    expect(data.byteLength).toBe(region.bytes)
    expect(createHash('sha256').update(data).digest('hex')).toBe(region.url.match(/data-([a-f0-9]+)\.json$/)![1])
  }
}, 30000)
