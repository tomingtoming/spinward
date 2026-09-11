// Export the locally captured operation clips, without their loading screens.
// The recording has no audio. Chapter metadata belongs to the video, not the app.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const out = fileURLToPath(new URL('.', import.meta.url))
const prefix = process.env.PREFIX ?? 'morning-walkthrough'
const source = JSON.parse(fs.readFileSync(out + prefix + '.json', 'utf8'))
if (source.errors.length || source.clips.length !== 5) throw Error('Incomplete browser walkthrough')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'spinward-export-'))
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg'
const labels = ['01  WALK / PLANTED FEET', '02  PARK / SIT AND STAND', '03  CAFE / BREW AND SIP', '04  NIGHT / STREET LIGHTING', '05  EXTERIOR / FREE FLIGHT']
const files = []
const chapters = [';FFMETADATA1', 'title=Spinward - morning walkthrough (silent)']
let elapsed = 0
for (const [i, clip] of source.clips.entries()) {
  const file = path.join(work, `${i}.mp4`)
  execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(clip.start), '-i', clip.file,
    '-t', String(clip.duration), '-an', '-vf', 'fps=30',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file], { stdio: 'inherit' })
  files.push(file)
  const next = elapsed + Math.round(clip.duration * 30) / 30
  chapters.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(elapsed * 1000)}`, `END=${Math.round(next * 1000)}`, `title=${labels[i]}`)
  elapsed = next
}
const list = path.join(work, 'concat.txt')
fs.writeFileSync(list, files.map(file => `file '${file.replaceAll("'", "'\\''")}'`).join('\n') + '\n')
const output = out + prefix + '.mp4'
const metadata = path.join(work, 'chapters.txt')
fs.writeFileSync(metadata, chapters.join('\n') + '\n')
execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-f', 'ffmetadata', '-i', metadata, '-map_metadata', '1', '-map_chapters', '1', '-c', 'copy', '-movflags', '+faststart', output], { stdio: 'inherit' })
console.log(JSON.stringify({ output, bytes: fs.statSync(output).size, audio: false, source: prefix + '.json' }))
