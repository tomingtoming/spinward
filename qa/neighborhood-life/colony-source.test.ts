import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readColonySource } from './colony-source'

test('a staged colony reads and verifies parts from the same package as its header', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spinward-colony-source-'))
  try {
    const generated = join(root, 'src/worlds/generated'), publicRoot = join(root, 'public/landscapes/izma')
    await mkdir(generated, { recursive: true }); await mkdir(publicRoot, { recursive: true })
    const bytes = '[1,2,3]\n', hash = createHash('sha256').update(bytes).digest('hex')
    const file = 'data-' + hash + '.json', header = join(generated, 'izmaColony.json')
    await writeFile(join(publicRoot, file), bytes)
    await writeFile(header, JSON.stringify({ storage: 'colony-json-parts-v1', sourceSha256: hash,
      parts: 1, partBytes: bytes.length, data: { vertices: { $part: '/landscapes/izma/' + file, bytes: bytes.length } } }))
    expect(await readColonySource(header)).toEqual({ vertices: [1, 2, 3] })
    expect(await readColonySource(pathToFileURL(header))).toEqual({ vertices: [1, 2, 3] })
    await writeFile(join(publicRoot, file), '[1,2,4]\n')
    await expect(readColonySource(header)).rejects.toThrow('Corrupt colony data')
  } finally { await rm(root, { recursive: true, force: true }) }
})
