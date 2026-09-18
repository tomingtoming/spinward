// Authoring and geometry audits deliberately assemble every saved part.
// This helper is not imported into the browser application.
import { readFile } from 'node:fs/promises'
import { readColonyDocument } from '../../src/worlds/colonyManifestDocument'

export async function readColonySource(path: string | URL = new URL('../../src/worlds/generated/izmaColony.json', import.meta.url)) {
  const source = JSON.parse(await readFile(path, 'utf8'))
  return readColonyDocument(source, {
    load: async url => {
      const bytes = await readFile(new URL('../../public' + url, import.meta.url))
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    }
  })
}
export default await readColonySource()
