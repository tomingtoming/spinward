import * as THREE from 'three'

import { computeDeviceOrientationQuaternion } from '../pc/deviceOrientation'
import { bandLocalFromLonLat, bandLocalNorth, nearestMetroPlace, type GeoBand, type GeoPlace } from '../worlds/geo/jgd2011'

// Hold the phone up in Tokyo or Saitama and see the colony's far field over
// the real street (`?ar=1`). The near field needs no segmentation: the Tokyo
// bands are PLATEAU, so the buildings around the visitor are the same shapes
// in both worlds. The camera feed is drawn as a billboard at NEAR metres with
// a greater-than depth test, so it only covers Spinward fragments closer than
// NEAR — the real street stays real, and beyond it the floor curves up into
// the opposite bands. The sky is replaced outright: it is where the two
// worlds differ.
//
// Pose: GPS lands the visitor on their own coordinates (v1 snapped to the
// nearest published arrival; at Akihabara that was the palace 1.6 km away and
// the near field could not match — toming, 2026-10-26). The compass sets yaw
// relative to geographic north on the band, the gyro supplies pitch and roll,
// and two buttons trim the heading by eye because phone compasses wander by
// 10–20°. `?arfov=` matches the view to the phone camera's vertical angle.

const DEFAULT_NEAR_METERS = 400
// Stay off the band's retaining wall when the fix lands on the very edge.
const EDGE_MARGIN_METERS = 25
const YAW_TRIM_STEP_DEG = 2
const YAW_TRIM_KEY = 'spinward.ar.yawTrimDeg'

export type ArModeOptions = {
  camera: THREE.PerspectiveCamera
  viewRig: THREE.Object3D
  playerRig: THREE.Object3D
  bands: readonly GeoBand[]
  places: readonly GeoPlace[]
  bandWidth: number
  span: number
  radius: number
  nearMeters?: number
  fovDeg?: number
  mount: HTMLElement
  // Band id and band-local metres, already clamped inside the band.
  onArrive: (bandId: string, x: number, y: number) => void
}

type PermissionRequester = { requestPermission?: () => Promise<'granted' | 'denied'> }

export class ArMode {
  readonly panel: HTMLElement
  private readonly status: HTMLElement
  private readonly button: HTMLButtonElement
  private readonly video: HTMLVideoElement
  private readonly plane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private readonly texture: THREE.VideoTexture
  private readonly nearMeters: number
  private stream: MediaStream | null = null
  private active = false
  private headingRad: number | null = null
  private betaRad = Math.PI / 2
  private gammaRad = 0
  private readonly deviceQuaternion = new THREE.Quaternion()
  private readonly rigInverse = new THREE.Quaternion()
  private readonly northWorld = new THREE.Vector3()
  private readonly northLocal: [number, number]
  private readonly yawQuaternion = new THREE.Quaternion()
  private readonly position = new THREE.Vector3()
  private readonly options: ArModeOptions
  private readonly forwardWorld = new THREE.Vector3()
  private lastYawNorth = 0
  private yawTrimRad = 0
  private savedFov: number | null = null
  private readonly trim: HTMLElement
  private landed: { bandId: string; x: number; y: number; inside: boolean; edge: number } | null = null
  private readonly where: HTMLElement
  private readonly whereButton: HTMLButtonElement
  private readonly restand: HTMLButtonElement
  private watchId: number | null = null
  private lastFix: { lon: number; lat: number } | null = null

  constructor(options: ArModeOptions) {
    this.options = options
    this.nearMeters = options.nearMeters ?? DEFAULT_NEAR_METERS
    this.northLocal = bandLocalNorth(options.bands[0].frame)

    this.video = document.createElement('video')
    this.video.setAttribute('playsinline', '')
    this.video.muted = true
    this.video.autoplay = true
    this.video.style.display = 'none'
    document.body.append(this.video)

    this.texture = new THREE.VideoTexture(this.video)
    this.texture.colorSpace = THREE.SRGBColorSpace
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      depthTest: true,
      depthWrite: false,
      depthFunc: THREE.GreaterDepth,
      toneMapped: false,
      fog: false
    })
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
    this.plane.renderOrder = 10_000
    this.plane.frustumCulled = false
    this.plane.visible = false
    this.plane.position.set(0, 0, -this.nearMeters)
    options.camera.add(this.plane)

    this.panel = document.createElement('div')
    this.panel.className = 'ar-panel'
    const title = document.createElement('strong')
    title.textContent = 'AR · 掲げて見る'
    this.status = document.createElement('span')
    this.status.className = 'ar-panel__status'
    this.status.textContent = '東京・埼玉で空に掲げると、コロニーの対岸が見えます'
    this.button = document.createElement('button')
    this.button.type = 'button'
    this.button.className = 'beat-btn'
    this.button.textContent = 'カメラと位置を使って始める'
    this.button.addEventListener('click', () => { void this.start() })
    this.trim = document.createElement('div')
    this.trim.className = 'ar-panel__trim'
    this.trim.hidden = true
    const trimLabel = document.createElement('span')
    const left = document.createElement('button'), right = document.createElement('button')
    left.type = 'button'; right.type = 'button'
    left.className = right.className = 'beat-btn'
    left.textContent = '◀ 向き'; right.textContent = '向き ▶'
    left.setAttribute('aria-label', '向きを左へ'); right.setAttribute('aria-label', '向きを右へ')
    const stored = Number(readStorage(YAW_TRIM_KEY))
    this.yawTrimRad = Number.isFinite(stored) ? THREE.MathUtils.degToRad(stored) : 0
    const showTrim = () => { trimLabel.textContent = `補正 ${Math.round(THREE.MathUtils.radToDeg(this.yawTrimRad))}°` }
    const nudge = (sign: number) => {
      this.yawTrimRad += sign * THREE.MathUtils.degToRad(YAW_TRIM_STEP_DEG)
      writeStorage(YAW_TRIM_KEY, String(THREE.MathUtils.radToDeg(this.yawTrimRad)))
      showTrim()
    }
    left.addEventListener('click', () => nudge(1))
    right.addEventListener('click', () => nudge(-1))
    showTrim()
    this.trim.append(left, trimLabel, right)
    // Live band check, usable before AR starts (geolocation only).
    this.where = document.createElement('span')
    this.where.className = 'ar-panel__status'
    this.where.hidden = true
    this.whereButton = document.createElement('button')
    this.whereButton.type = 'button'
    this.whereButton.className = 'beat-btn'
    this.whereButton.textContent = '帯の中か確認'
    this.whereButton.addEventListener('click', () => this.watchWhere())
    this.restand = document.createElement('button')
    this.restand.type = 'button'
    this.restand.className = 'beat-btn'
    this.restand.textContent = '現在地に立ち直す'
    this.restand.hidden = true
    this.restand.addEventListener('click', () => { if (this.lastFix) this.landAt(this.lastFix.lon, this.lastFix.lat) })
    this.panel.append(title, this.status, this.where, this.whereButton, this.button, this.trim, this.restand)
    options.mount.append(this.panel)
  }

  // Keep a position watch and say which band the visitor is on and how far
  // the edge is. The colony's east edge runs through Akihabara, so a few
  // hundred metres decide whether the near field can match at all.
  private watchWhere() {
    if (this.watchId !== null) return
    this.whereButton.disabled = true
    this.where.hidden = false
    this.where.textContent = '現在地を取得中…'
    this.watchId = navigator.geolocation.watchPosition(fix => {
      this.lastFix = { lon: fix.coords.longitude, lat: fix.coords.latitude }
      const l = resolveLanding(this.options.bands, fix.coords.longitude, fix.coords.latitude, this.options.bandWidth, this.options.span)
      const band = { east: '東帯', central: '中央帯', west: '西帯' }[l.bandId] ?? l.bandId
      const acc = Number.isFinite(fix.coords.accuracy) ? `・GPS±${Math.round(fix.coords.accuracy)}m` : ''
      this.where.textContent = l.inside
        ? `${band}の中（端まで${Math.round(l.edge)}m${acc}）`
        : `帯の外（${band}の端から${Math.round(l.edge)}m${acc}）。近景は一致しません`
      if (this.landed && this.active) {
        const moved = l.bandId === this.landed.bandId ? Math.hypot(l.x - this.landed.x, l.y - this.landed.y) : Infinity
        this.restand.hidden = !(moved > 30)
        if (moved > 30) this.restand.textContent = Number.isFinite(moved) ? `現在地に立ち直す（${Math.round(moved)}m移動）` : '現在地に立ち直す（別の帯）'
      }
    }, error => {
      // A watch keeps running after a timeout (no new fix yet); only a denial
      // or an unavailable sensor ends it.
      if (error.code === error.TIMEOUT) return
      this.where.textContent = error.code === error.PERMISSION_DENIED ? '位置情報の許可が必要です' : '現在地を取得できません'
      this.whereButton.disabled = false
      this.watchId = null
    }, { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 })
  }

  private landAt(lon: number, lat: number) {
    const landing = resolveLanding(this.options.bands, lon, lat, this.options.bandWidth, this.options.span)
    const near = nearestMetroPlace(this.options.bands, this.options.places, lon, lat, this.options.bandWidth, this.options.span)
    this.landed = landing
    this.options.onArrive(landing.bandId, landing.x, landing.y)
    this.restand.hidden = true
    const place = near ? `${near.place.label}から${near.distance >= 1000 ? `${(near.distance / 1000).toFixed(1)}km` : `${Math.round(near.distance)}m`}` : ''
    this.status.textContent = landing.inside
      ? `現在地に立ちました（${place}・帯の端まで${Math.round(landing.edge)}m）。空へ掲げ、◀▶で向きを合わせてください`
      : `現在地は帯の${Math.round(landing.edge)}m外。帯の端に立ちます（${place}）。近景は一致しません`
  }

  get running() { return this.active }

  // Everything that needs a user gesture happens inside this one click:
  // iOS motion permission, the rear camera, and geolocation.
  private async start() {
    this.button.disabled = true
    this.status.textContent = '許可を待っています…'
    try {
      const requester = (typeof DeviceOrientationEvent === 'undefined' ? {} : DeviceOrientationEvent) as PermissionRequester
      if (typeof requester.requestPermission === 'function') {
        if ((await requester.requestPermission()) !== 'granted') throw Error('方位センサーの許可が必要です')
      }
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      this.video.srcObject = this.stream
      await this.video.play()
      window.addEventListener('deviceorientationabsolute', this.handleOrientation as EventListener)
      window.addEventListener('deviceorientation', this.handleOrientation as EventListener)
      this.status.textContent = '現在地を取得中…'
      const fix = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 }))
      this.lastFix = { lon: fix.coords.longitude, lat: fix.coords.latitude }
      this.landAt(fix.coords.longitude, fix.coords.latitude)
      this.watchWhere()
      this.active = true
      this.plane.visible = true
      this.trim.hidden = false
      if (this.options.fovDeg) {
        this.savedFov = this.options.camera.fov
        this.options.camera.fov = this.options.fovDeg
        this.options.camera.updateProjectionMatrix()
      }
      this.button.textContent = '止める'
      this.button.disabled = false
      this.button.onclick = () => this.stop()
    } catch (error) {
      this.status.textContent = error instanceof Error ? error.message : String(error)
      this.button.disabled = false
      this.stop(false)
    }
  }

  private stop(reset = true) {
    this.active = false
    this.plane.visible = false
    this.trim.hidden = true
    if (this.savedFov !== null) {
      this.options.camera.fov = this.savedFov
      this.options.camera.updateProjectionMatrix()
      this.savedFov = null
    }
    window.removeEventListener('deviceorientationabsolute', this.handleOrientation as EventListener)
    window.removeEventListener('deviceorientation', this.handleOrientation as EventListener)
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.stream = null
    this.video.srcObject = null
    if (reset) {
      this.button.textContent = 'カメラと位置を使って始める'
      this.button.onclick = null
      this.button.addEventListener('click', () => { void this.start() }, { once: true })
    }
  }

  // Android reports absolute alpha on `deviceorientationabsolute`; iOS reports a
  // clockwise compass heading on the plain event. Either way keep a heading
  // measured clockwise from north, and the raw tilt angles for pitch/roll.
  private readonly handleOrientation = (event: DeviceOrientationEvent & { webkitCompassHeading?: number }) => {
    if (event.beta === null || event.gamma === null) return
    this.betaRad = THREE.MathUtils.degToRad(event.beta)
    this.gammaRad = THREE.MathUtils.degToRad(event.gamma)
    if (typeof event.webkitCompassHeading === 'number' && Number.isFinite(event.webkitCompassHeading)) {
      this.headingRad = THREE.MathUtils.degToRad(event.webkitCompassHeading)
    } else if (event.type === 'deviceorientationabsolute' || event.absolute) {
      if (event.alpha !== null) this.headingRad = THREE.MathUtils.degToRad((360 - event.alpha) % 360)
    }
  }

  update(renderer: THREE.WebGLRenderer, xrPresenting: boolean) {
    if (!this.active || xrPresenting) return
    const { camera, viewRig, playerRig } = this.options

    // Geographic north on the floor at the visitor's position: band +x runs
    // against azimuth, band +y runs along -Y of the cylinder (metroPlacement).
    playerRig.getWorldPosition(this.position)
    const theta = Math.atan2(this.position.z, this.position.x)
    const tangentX = -Math.sin(theta), tangentZ = Math.cos(theta)
    const [nx, ny] = this.northLocal
    this.northWorld.set(-nx * tangentX, -ny, -nx * tangentZ)
    viewRig.getWorldQuaternion(this.rigInverse).invert()
    this.northWorld.applyQuaternion(this.rigInverse)
    const yawNorth = Math.atan2(-this.northWorld.x, -this.northWorld.z)
    this.lastYawNorth = yawNorth

    // Device quaternion with alpha = counter-clockwise angle from north, which
    // is 360° minus the compass heading. Without a compass fix keep yaw at 0.
    const alpha = this.headingRad === null ? 0 : (Math.PI * 2 - this.headingRad) % (Math.PI * 2)
    const screen = (screen => THREE.MathUtils.degToRad(typeof screen?.angle === 'number' ? screen.angle : 0))(window.screen?.orientation)
    computeDeviceOrientationQuaternion(alpha, this.betaRad, this.gammaRad, screen, this.deviceQuaternion)
    this.yawQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawNorth + this.yawTrimRad)
    camera.quaternion.copy(this.yawQuaternion).multiply(this.deviceQuaternion)

    // Fit the feed to the view frustum at NEAR with cover scaling.
    const size = renderer.getSize(new THREE.Vector2())
    const viewAspect = size.x / Math.max(1, size.y)
    const height = 2 * this.nearMeters * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    this.plane.scale.set(height * viewAspect, height, 1)
    const vw = this.video.videoWidth, vh = this.video.videoHeight
    if (vw > 0 && vh > 0) {
      const videoAspect = vw / vh
      if (videoAspect > viewAspect) {
        this.texture.repeat.set(viewAspect / videoAspect, 1)
        this.texture.offset.set((1 - this.texture.repeat.x) / 2, 0)
      } else {
        this.texture.repeat.set(1, videoAspect / viewAspect)
        this.texture.offset.set(0, (1 - this.texture.repeat.y) / 2)
      }
    }
  }

  // Field diagnostics (window.__spinward.ar): compass heading, the yaw that
  // turns the rig's -Z onto north, and the camera's world forward.
  diagnostics() {
    const { camera } = this.options
    camera.getWorldQuaternion(this.deviceQuaternion)
    this.forwardWorld.set(0, 0, -1).applyQuaternion(this.deviceQuaternion)
    return {
      active: this.active,
      headingDeg: this.headingRad === null ? null : THREE.MathUtils.radToDeg(this.headingRad),
      yawNorthDeg: THREE.MathUtils.radToDeg(this.lastYawNorth),
      yawTrimDeg: THREE.MathUtils.radToDeg(this.yawTrimRad),
      landed: this.landed,
      rig: (() => { const p = this.options.playerRig.getWorldPosition(this.position); return { axial: p.y, height: this.options.radius - Math.hypot(p.x, p.z) } })(),
      forward: [this.forwardWorld.x, this.forwardWorld.y, this.forwardWorld.z],
      status: this.status.textContent
    }
  }

  dispose() {
    this.stop(false)
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId)
    this.plane.removeFromParent()
    this.plane.geometry.dispose()
    this.plane.material.dispose()
    this.texture.dispose()
    this.video.remove()
    this.panel.remove()
  }
}

const readStorage = (key: string) => { try { return window.localStorage.getItem(key) } catch { return null } }
const writeStorage = (key: string, value: string) => { try { window.localStorage.setItem(key, value) } catch { /* private mode */ } }

/**
 * Where to stand: the band containing the fix, else the band whose edge is
 * nearest, with the point pulled inside by the edge margin. `edge` is the
 * distance to the nearest band edge (positive inside, the overshoot outside).
 */
export function resolveLanding(bands: readonly GeoBand[], lonDeg: number, latDeg: number, bandWidth: number, span: number) {
  const halfW = bandWidth / 2, halfS = span / 2
  let best: { bandId: string; x: number; y: number; inside: boolean; edge: number; overshoot: number } | null = null
  for (const band of bands) {
    const [x, y] = bandLocalFromLonLat(band.frame, lonDeg, latDeg)
    const overshoot = Math.max(Math.abs(x) - halfW, Math.abs(y) - halfS, 0)
    const inside = overshoot === 0
    const edge = inside ? Math.min(halfW - Math.abs(x), halfS - Math.abs(y)) : overshoot
    const cx = THREE.MathUtils.clamp(x, -halfW + EDGE_MARGIN_METERS, halfW - EDGE_MARGIN_METERS)
    const cy = THREE.MathUtils.clamp(y, -halfS + EDGE_MARGIN_METERS, halfS - EDGE_MARGIN_METERS)
    if (best === null || overshoot < best.overshoot) best = { bandId: band.id, x: cx, y: cy, inside, edge, overshoot }
  }
  if (!best) throw Error('帯の座標系がありません')
  const { overshoot: _o, ...landing } = best
  return landing
}
