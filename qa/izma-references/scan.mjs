// Read-only inventory. It never marks unseen content as reviewed or edits originals.
import { readdir, readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'))
const source = resolve(process.argv[2] ?? manifest.sourceDirectory)
const known = new Map(manifest.images.map(i => [i.sha256, i]))
const current = [], unstable = []
async function walk(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue
    const path = join(dir, item.name)
    if (item.isDirectory()) { await walk(path); continue }
    if (!item.isFile() || !/\.(png|jpe?g|webp|avif|heic|tiff?|bmp)$/i.test(item.name)) continue
    try {
      const before = await stat(path), bytes = await readFile(path), after = await stat(path)
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino || Date.now() - after.mtimeMs < 5000) {
        unstable.push(path); continue // The user may still be copying this image.
      }
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      current.push({ file: path.slice(source.length + 1), sha256, size: after.size,
        review: known.get(sha256)?.review ?? 'unseen', reference: known.get(sha256)?.id ?? null })
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      unstable.push(path) // Moved or removed during this scan; do not mark it reviewed.
    }
  }
}
await walk(source) // Missing/unreadable source is an error, not an empty successful scan.
current.sort((a, b) => a.file.localeCompare(b.file))
const groups = new Map()
for (const i of current) groups.set(i.sha256, [...(groups.get(i.sha256) ?? []), i.file])
console.log(JSON.stringify({ source, count: current.length, unique: groups.size,
  newImages: current.filter(i => !known.has(i.sha256)),
  duplicates: [...groups].filter(([, files]) => files.length > 1).map(([sha256, files]) => ({ sha256, files })),
  absentReviewedContent: manifest.images.filter(i => !groups.has(i.sha256)).map(i => i.id), unstable, current }, null, 2))
