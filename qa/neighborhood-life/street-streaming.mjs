// Continuous real keyboard travel, method timings and resource/state continuity.
// Run alone against a fixed dist tree; this is not a phone/Quest hardware test.
import fs from 'node:fs'
import * as T from 'three'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192', out = fileURLToPath(new URL('.', import.meta.url))
const duration = Number(process.env.LEG_MS ?? 90000), cycles = Number(process.env.CYCLES ?? 2), prefix = process.env.PREFIX ?? 'street-streaming'
const browser = await chromium.launch({ channel: 'chrome', headless: true }), errors = [], reports = []
const save = () => fs.writeFileSync(out+prefix+'.json', JSON.stringify({ duration, cycles, errors, reports }, null, 2))
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error' && /shader|WebGLProgram|context.*lost/i.test(m.text())) errors.push(m.text()) })
  await page.addInitScript(traceGpu => {
    const live = new WeakSet(), counts = window.bufferCounts = { created: 0, deleted: 0, live: 0 }
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      const create = proto.createBuffer, remove = proto.deleteBuffer
      proto.createBuffer = function () { const b = create.call(this); if (b && !live.has(b)) { live.add(b); counts.created++; counts.live++ } return b }
      proto.deleteBuffer = function (b) { if (b && live.delete(b)) { counts.deleted++; counts.live-- } return remove.call(this, b) }
    }
    addEventListener('webglcontextlost', () => { window.lostContext = true }, true)
    if (traceGpu) for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      for (const name of ['compileShader', 'linkProgram', 'getProgramParameter', 'getShaderParameter', 'bufferData', 'bufferSubData', 'texImage2D', 'texSubImage2D', 'drawElementsInstanced', 'drawElements', 'drawArraysInstanced']) {
        const original = proto[name]
        if (!original) continue
        proto[name] = function (...args) {
          if (!window.walkProfile?.active) return original.apply(this, args)
          const start = performance.now(), result = original.apply(this, args), ms = performance.now() - start
          if (ms > 5) window.walkProfile.gpuCalls.push({ name, start, ms, axial: window.__spinward?.axial,
            sizes: args.map(a => a?.byteLength ?? (typeof a === 'number' ? a : null)) })
          return result
        }
      }
    }
  }, !!process.env.GPU_TRACE)
  if (process.env.AUDIO_TRACE || process.env.NO_AUDIO) await page.addInitScript(noAudio => {
    window.audioStartup = []
    const Native = window.AudioContext
    if (noAudio) {
      window.AudioContext = undefined
      window.webkitAudioContext = undefined
      return
    }
    window.AudioContext = class extends Native {
      constructor(...args) {
        const start = performance.now()
        super(...args)
        window.audioStartup.push({ method: 'constructor', start, ms: performance.now() - start })
      }
    }
    for (const method of ['resume', 'createBuffer', 'createGain', 'createBufferSource', 'createOscillator', 'createBiquadFilter']) {
      const original = Native.prototype[method]
      Native.prototype[method] = function (...args) {
        const start = performance.now(), result = original.apply(this, args)
        window.audioStartup.push({ method, start, ms: performance.now() - start })
        return result
      }
    }
  }, !!process.env.NO_AUDIO)
  // Azimuth zero follows the long avenue through the civic plaza, +Y forward.
  const q = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(new T.Vector3(3198.4, -600, 0), new T.Vector3(3198.4, -590, 0), new T.Vector3(-1, 0, 0)))
  await page.goto(`${base}/?debug&stats&lock=0&preset=izma&t=.42&tier=desktop&dpr=1&m=g&a=0&ax=-600&q=${q.toArray()}`, { timeout: 60000 })
  await page.waitForSelector('#splash', { state: 'detached' })
  await page.waitForFunction(() => window.__spinwardCity?.trafficKitBacked && window.__spinwardCity.colonyBuildings.group.userData.asset && window.__spinwardBody.group.userData.ready)
  await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
  await page.waitForTimeout(4000)
  await page.evaluate(() => {
    const c = window.__spinwardCity
    window.walkProfile = { active: false, frames: [], methods: {}, rebuilds: [], seconds: [], gpuCalls: [], longFrames: [], longTasks: [], last: 0, lastSecond: 0 }
    if (PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) new PerformanceObserver(list => {
      if (!window.walkProfile.active) return
      for (const entry of list.getEntries()) window.walkProfile.longTasks.push(entry.toJSON())
    }).observe({ type: 'long-animation-frame' })
    const fingerprint = route => route.id ?? [route.kind, route.laneAzimuth, route.laneAxial, route.surfaceRadius, route.direction, route.speedMetersPerSecond, route.scale, Math.round(route.phaseMeters/route.spanLength*1e7)].join(':')
    const cars = () => {
      const positions = c.getTrafficPositions(), map = new Map()
      c.trafficRoutes.forEach((r, i) => { if (!(c.neighborhoodTurn && i === c.trafficRoutes.length-1)) map.set(fingerprint(r), { ...positions[i], variant: r.variant, kind: r.kind, spanStart: r.spanStart, spanLength: r.spanLength }) })
      return map
    }
    for (const [object, method, label] of [[c, 'setFocusSurface', 'focus'], [c, 'rebuildNearBuildingBatches', 'nearBatches'], [c, 'rebuildRoadTiles', 'roadTiles'], [c, 'rebuildTraffic', 'trafficRebuild'], [c.colonyBuildings, 'update', 'colonyBuildings'], [c.interiorLayer, 'update', 'interiors']]) {
      const original = object[method]
      object[method] = function (...args) {
        const p = window.walkProfile
        if (!p.active) return original.apply(this, args)
        const before = label === 'trafficRebuild' ? cars() : null, started = performance.now()
        const result = original.apply(this, args), elapsed = performance.now()-started
        ;(p.methods[label] ??= []).push(elapsed)
        if (before) {
          let matched = 0, moved = 0, stopped = 0, maximum = 0, movedRetained = 0, variantChanges = 0, disappearedNearby = 0
          const examples = []
          const current = cars()
          for (const [key, old] of before) if (!current.has(key) && Math.hypot(Math.atan2(Math.sin(old.azimuth-c.cityFocusAzimuth), Math.cos(old.azimuth-c.cityFocusAzimuth))*c.radius, old.axial-c.cityFocusAxial) < 150) disappearedNearby++
          for (const [key, after] of current) {
            const old = before.get(key); if (!old) continue
            matched++
            if (old.variant !== after.variant) variantChanges++
            const oldAlong = old.kind === 'avenue' ? old.axial : 0
            const retained = old.kind === 'street' || oldAlong > after.spanStart+.01 && oldAlong < after.spanStart+after.spanLength-.01
            const distance = Math.hypot(Math.atan2(Math.sin(after.azimuth-old.azimuth), Math.cos(after.azimuth-old.azimuth))*c.radius, after.axial-old.axial)
            maximum = Math.max(maximum, distance)
            if (retained && old.speed > 1 && after.speed < .01) stopped++
            if (retained && distance > .001) movedRetained++
            if (distance > 1) { moved++; if (examples.length < 2) examples.push({ distance, old, after }) }
          }
          p.rebuilds.push({ at: performance.now(), axial: window.__spinward.axial, matched, moved, stopped, movedRetained, variantChanges, disappearedNearby, maximum, examples })
        }
        return result
      }
    }
    const frame = now => {
      const p = window.walkProfile
      if (p.active) {
        if (p.last) {
          p.frames.push(now-p.last)
          if (now-p.last > 50) p.longFrames.push({ start: p.last, end: now, duration: now-p.last, axial: window.__spinward.axial })
        }
        p.last = now
        if (now-p.lastSecond > 1000) {
          const s = window.__spinward
          p.seconds.push({ at: now, azimuth: s.azimuth, axial: s.axial, mode: s.mode, height: s.groundHeight, buffers: window.bufferCounts.live, stats: document.querySelector('.stats-overlay')?.textContent })
          p.lastSecond = now
        }
      }
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  const cdp = await page.context().newCDPSession(page)
  for (let cycle = 0; cycle < cycles; cycle++) for (const key of ['w', 's']) {
    if (process.env.FORWARD_ONLY && key === 's') continue
    if (process.env.TIMELINE_TRACE) {
      await cdp.send('Tracing.start', {
        categories: 'devtools.timeline,v8,blink.user_timing,disabled-by-default-devtools.timeline,disabled-by-default-v8.cpu_profiler',
        transferMode: 'ReturnAsStream',
      })
      // Profiling startup itself can pause JS; keep it outside the measured walk.
      await page.waitForTimeout(1000)
    }
    const start = await page.evaluate(() => {
      Object.assign(window.walkProfile, { active: true, frames: [], methods: {}, rebuilds: [], seconds: [], gpuCalls: [], longFrames: [], longTasks: [], last: 0, lastSecond: 0 })
      return { axial: window.__spinward.axial, azimuth: window.__spinward.azimuth }
    })
    await page.keyboard.down('Shift'); await page.keyboard.down(key)
    await page.waitForTimeout(duration)
    await page.keyboard.up(key); await page.keyboard.up('Shift')
    await page.evaluate(() => { window.walkProfile.active = false })
    if (process.env.TIMELINE_TRACE) {
      const complete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve))
      await cdp.send('Tracing.end')
      const { stream } = await complete
      const fd = fs.openSync(out + `${prefix}-${cycle}-${key}.trace.json`, 'w')
      try {
        let eof = false
        while (!eof) { const chunk = await cdp.send('IO.read', { handle: stream }); fs.writeSync(fd, chunk.base64Encoded ? Buffer.from(chunk.data, 'base64') : chunk.data); eof = chunk.eof }
      } finally { fs.closeSync(fd); await cdp.send('IO.close', { handle: stream }) }
    }
    const data = await page.evaluate(() => {
      const p = window.walkProfile; p.active = false
      const summary = samples => { const s = [...samples].sort((a,b) => a-b); return { count: s.length, median: s[Math.floor(s.length*.5)], p95: s[Math.floor(s.length*.95)], max: s.at(-1), over50: s.filter(x => x > 50).length } }
      const gl = document.querySelector('canvas').getContext('webgl2'), ext = gl.getExtension('WEBGL_debug_renderer_info')
      return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown', audioStartup: window.audioStartup, frames: summary(p.frames), methods: Object.fromEntries(Object.entries(p.methods).map(([k,v]) => [k, summary(v)])), gpuCalls: p.gpuCalls, longFrames: p.longFrames, longTasks: p.longTasks, rebuilds: p.rebuilds, seconds: p.seconds, state: window.__spinward, buffers: window.bufferCounts, lost: !!window.lostContext }
    })
    await page.waitForTimeout(500)
    await cdp.send('HeapProfiler.collectGarbage')
    const heap = await cdp.send('Runtime.getHeapUsage')
    const sample = { cycle, key, start, ...data, heap }
    reports.push(sample); save()
    await page.screenshot({ path: out+`${prefix}-${cycle}-${key}.png` })
    console.log(JSON.stringify({ cycle, key, start: start.axial, end: data.state.axial, frames: data.frames, methods: data.methods, buffers: data.buffers.live, heapMiB: heap.usedSize/1048576, rebuilds: data.rebuilds.length, movedCars: data.rebuilds.reduce((n,r) => n+r.moved, 0), stoppedCars: data.rebuilds.reduce((n,r) => n+r.stopped, 0), movedRetained: data.rebuilds.reduce((n,r) => n+r.movedRetained, 0), variantChanges: data.rebuilds.reduce((n,r) => n+r.variantChanges, 0), disappearedNearby: data.rebuilds.reduce((n,r) => n+r.disappearedNearby, 0) }))
    if (process.env.EXPECT_CONTINUOUS && data.rebuilds.some(r => r.stopped || r.movedRetained || r.variantChanges || r.disappearedNearby)) throw Error('Visible traffic state changed during a zero-time rebuild')
    if (errors.length || data.lost || /SwiftShader|llvmpipe/i.test(data.renderer)) throw Error('Invalid streaming run: '+JSON.stringify({ errors, renderer: data.renderer, lost: data.lost }))
    if (Math.abs(data.state.axial-start.axial) < duration/1000*2 || data.state.mode !== 'grounded') throw Error('The intended avenue walking path is blocked')
  }
} catch (error) { errors.push(String(error)); save(); throw error } finally { save(); await browser.close() }
