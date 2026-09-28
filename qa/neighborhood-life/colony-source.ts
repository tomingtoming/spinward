// Authoring and geometry audits deliberately assemble every saved part.
// This helper is not imported into the browser application.
import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readColonyDocument } from '../../src/worlds/colonyManifestDocument'

export async function readColonySource(path: string | URL = new URL('../../src/worlds/generated/izmaColony.json', import.meta.url)) {
  // A staged header must read its own public parts, never the working tree's.
  // Both canonical and staged packages keep src/worlds/generated and public.
  const sourceUrl = path instanceof URL ? path : pathToFileURL(resolve(path))
  const source = JSON.parse(await readFile(sourceUrl, 'utf8'))
  return readColonyDocument(source, {
    load: async url => {
      const bytes = await readFile(new URL('../../../public' + url, sourceUrl))
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    }
  })
}
const auditSource = process.env.SPINWARD_AUDIT_SOURCE
if (auditSource && !isAbsolute(auditSource)) throw Error('Use an absolute SPINWARD_AUDIT_SOURCE')
export default await readColonySource(auditSource)
