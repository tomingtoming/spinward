/** Native JSON parts, without turning the entire colony into a JavaScript module.
 * Assembly is atomic: a failed part never publishes an incomplete collision map.
 * This reader also accepts the previous inline format for archived authoring data.
 */
export const COLONY_DOCUMENT_FORMAT = 'colony-json-parts-v1'
export const COLONY_DOCUMENT_PART_BYTES = 2 * 1024 * 1024
export const COLONY_DOCUMENT_CONCURRENCY = 3

export class ColonyDataError extends Error {
  readonly name = 'ColonyDataError'
}

type Part = { $part: string; bytes: number }
type LoadPart = (url: string, signal: AbortSignal) => Promise<ArrayBuffer>
const partURL = /^\/landscapes\/izma\/data-([a-f0-9]{64})\.json$/
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const fetchPart: LoadPart = async (url, signal) => {
  const response = await fetch(url, { signal })
  if (!response.ok) throw Error(`Colony data ${response.status}: ${url}`)
  return response.arrayBuffer()
}

type ReadOptions = {
  load?: LoadPart; signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void
}

export async function readColonyDocument(document: unknown, options: ReadOptions = {}): Promise<unknown> {
  try {
    return await assembleColonyDocument(document, options)
  } catch (error) {
    if (options.signal?.aborted) throw error
    throw new ColonyDataError(error instanceof Error ? error.message : String(error), { cause: error })
  }
}

async function assembleColonyDocument(document: unknown, options: ReadOptions): Promise<unknown> {
  if (!object(document) || document.storage !== COLONY_DOCUMENT_FORMAT) return document
  if (!object(document.data) || !Number.isInteger(document.parts) || Number(document.parts) < 0 ||
    Number(document.parts) > 4096 || !/^[a-f0-9]{64}$/.test(String(document.sourceSha256))) throw Error('Invalid colony data document')
  const parts = new Map<string, Part>()
  const collect = (value: unknown, depth = 0) => {
    if (depth > 32) throw Error('Colony data document is too deeply nested')
    if (Array.isArray(value)) { for (const item of value) collect(item, depth + 1); return }
    if (!object(value)) return
    if ('$part' in value) {
      if (Object.keys(value).length !== 2 || typeof value.$part !== 'string' || !partURL.test(value.$part) ||
        !Number.isInteger(value.bytes) || Number(value.bytes) < 3 || Number(value.bytes) > COLONY_DOCUMENT_PART_BYTES) throw Error('Invalid colony part reference')
      const part = value as Part, previous = parts.get(part.$part)
      if (previous && previous.bytes !== part.bytes) throw Error('Conflicting colony part reference')
      parts.set(part.$part, part); return
    }
    if ('$concat' in value && (Object.keys(value).length !== 1 || !Array.isArray(value.$concat))) throw Error('Invalid colony array slices')
    for (const item of Object.values(value)) collect(item, depth + 1)
  }
  collect(document.data)
  if (parts.size !== document.parts || [...parts.values()].reduce((sum, p) => sum + p.bytes, 0) !== document.partBytes) throw Error('Incomplete colony data index')

  const controller = new AbortController(), loaded = new Map<string, unknown>()
  const abort = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  const requests = [...parts.values()], load = options.load ?? fetchPart
  let next = 0
  const worker = async () => {
    while (next < requests.length) {
      controller.signal.throwIfAborted()
      const part = requests[next++]
      const buffer = await load(part.$part, controller.signal)
      controller.signal.throwIfAborted()
      if (buffer.byteLength !== part.bytes) throw Error('Truncated colony data: ' + part.$part)
      const digest = await crypto.subtle.digest('SHA-256', buffer)
      const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
      if (hash !== partURL.exec(part.$part)![1]) throw Error('Corrupt colony data: ' + part.$part)
      loaded.set(part.$part, JSON.parse(new TextDecoder().decode(buffer)))
      options.onProgress?.(loaded.size, requests.length)
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(COLONY_DOCUMENT_CONCURRENCY, requests.length) }, worker))
    controller.signal.throwIfAborted()
    const expand = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(expand)
      if (!object(value)) return value
      if ('$part' in value) return loaded.get(value.$part as string)
      if ('$concat' in value) {
        const result: unknown[] = []
        for (const part of value.$concat as unknown[]) {
          const values = expand(part)
          if (!Array.isArray(values)) throw Error('Colony data slice is not an array')
          // Large numeric slices exceed the argument limit of push(...values).
          for (const entry of values) result.push(entry)
        }
        return result
      }
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item)]))
    }
    return expand(document.data)
  } catch (error) {
    controller.abort(error)
    throw error
  } finally {
    options.signal?.removeEventListener('abort', abort)
  }
}
