import * as THREE from 'three'

import type { TourCard } from '../app/tourGuide'

const CANVAS_WIDTH = 1024
const CANVAS_HEIGHT = 300
// Low and centered relative to the view: readable on desktop, and in VR the
// panel lazily follows the head instead of hard-locking to it.
const PANEL_POSITION = new THREE.Vector3(0, -0.36, -1.05)
const PANEL_SCALE = new THREE.Vector3(0.78, 0.78 * (CANVAS_HEIGHT / CANVAS_WIDTH), 1)
const PANEL_VIEWPORT_MARGIN = 0.56
const FOLLOW_RATE = 4

// Phones get their own layout. On a 390px-wide screen the wide card renders
// at 56% of the viewport with its 30px body text scaled down to about 6 CSS
// pixels — present, but not readable. The narrow layout takes 92% of the
// width on a smaller canvas and wraps, which lands the same text near 17 CSS
// pixels. Desktop and VR keep the wide numbers exactly.
export const NARROW_CARD_MAX_VIEWPORT_WIDTH = 720

type CardLayout = {
  canvasWidth: number
  titleFont: string
  bodyFont: string
  bodyFontPx: number
  titleTop: number
  bodyTop: number
  lineHeight: number
  bottomPad: number
  sidePad: number
  viewportMargin: number
}

const WIDE_LAYOUT: CardLayout = {
  canvasWidth: CANVAS_WIDTH,
  titleFont: '700 44px "Avenir Next", sans-serif',
  bodyFont: '500 30px "Avenir Next", sans-serif',
  bodyFontPx: 30,
  titleTop: 36,
  bodyTop: 116,
  lineHeight: 44,
  // Chosen so a four-line card measures exactly the historic 300px canvas:
  // 116 + 3*44 + 30 + 22 = 300. The card only grows when a line wraps.
  bottomPad: 22,
  // Just inside the rounded rect (inset 8) plus breathing room. Wider padding
  // wrapped lines that had always fitted, which would have been a regression
  // dressed up as a fix.
  sidePad: 30,
  viewportMargin: PANEL_VIEWPORT_MARGIN
}

const NARROW_LAYOUT: CardLayout = {
  canvasWidth: 720,
  titleFont: '700 44px "Avenir Next", sans-serif',
  bodyFont: '500 34px "Avenir Next", sans-serif',
  bodyFontPx: 34,
  titleTop: 30,
  bodyTop: 104,
  lineHeight: 46,
  bottomPad: 26,
  sidePad: 34,
  viewportMargin: 0.92
}

// Canvas height for a drawn card: the last line needs its own text height, not
// a whole line's leading, which is what makes the wide four-line case land on
// the historic 300px exactly.
export const cardCanvasHeight = (
  lineCount: number,
  layout: { bodyTop: number; lineHeight: number; bodyFontPx: number; bottomPad: number }
): number =>
  Math.round(
    layout.bodyTop + Math.max(0, lineCount - 1) * layout.lineHeight + layout.bodyFontPx + layout.bottomPad
  )

export const resolveCardLayoutId = (viewportWidth: number): 'wide' | 'narrow' =>
  viewportWidth > 0 && viewportWidth <= NARROW_CARD_MAX_VIEWPORT_WIDTH ? 'narrow' : 'wide'

// Greedy word wrap. `measure` is the canvas context's textWidth so the wrap
// matches what actually gets drawn; passing a fake makes this testable without
// a DOM. A single word longer than the line is left to overflow rather than
// broken mid-word — the card's vocabulary is short.
export const wrapCardLines = (
  lines: readonly string[],
  measure: (text: string) => number,
  maxWidth: number
): string[] => {
  const out: string[] = []

  for (const line of lines) {
    const words = line.split(' ').filter((word) => word.length > 0)

    if (words.length === 0) {
      continue
    }

    let current = words[0]

    for (const word of words.slice(1)) {
      const candidate = `${current} ${word}`

      if (measure(candidate) <= maxWidth) {
        current = candidate
      } else {
        out.push(current)
        current = word
      }
    }

    out.push(current)
  }

  return out
}

type TourCardView = {
  camera: THREE.Camera
  deltaSeconds: number
  xrActive: boolean
  // Screen-space height (px) reserved by the on-screen touch controls at the
  // bottom of the viewport. The panel is nudged up by the equivalent
  // world-space offset so it never renders behind the Jump/Drive/Gyro row
  // (see main.ts, which sources this from MobileControls.getReservedBottomHeight).
  bottomClearancePx?: number
}

// The world-space height spanned by the camera's view at the panel's fixed
// distance — shared by the width scale and the touch-clearance offset below
// so both read the same frustum.
const visibleHeightAt = (camera: THREE.PerspectiveCamera) =>
  2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * Math.abs(PANEL_POSITION.z)

export class TourCardPanel {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>

  private readonly canvas = document.createElement('canvas')
  private readonly context: CanvasRenderingContext2D
  private texture: THREE.CanvasTexture
  private readonly targetPosition = new THREE.Vector3()
  private readonly targetQuaternion = new THREE.Quaternion()
  private readonly cameraPosition = new THREE.Vector3()
  private readonly cameraQuaternion = new THREE.Quaternion()
  private renderedCard: TourCard | null = null
  private wasVisible = false
  private layout: CardLayout = WIDE_LAYOUT

  constructor() {
    this.canvas.width = CANVAS_WIDTH
    this.canvas.height = CANVAS_HEIGHT
    const context = this.canvas.getContext('2d')

    if (context === null) {
      throw new Error('2D canvas context is required for the tour card panel')
    }

    this.context = context
    this.texture = TourCardPanel.createTexture(this.canvas)
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        toneMapped: false
      })
    )
    this.mesh.scale.copy(PANEL_SCALE)
    this.mesh.renderOrder = 30
    this.mesh.visible = false
  }

  update(card: TourCard | null, view: TourCardView) {
    if (card === null) {
      this.mesh.visible = false
      this.renderedCard = null
      this.wasVisible = false
      return
    }

    this.mesh.visible = true

    // VR always gets the wide card (the headset has room and no CSS viewport);
    // otherwise the window width picks the layout, re-drawing on rotation.
    const layoutId =
      view.xrActive || typeof window === 'undefined' ? 'wide' : resolveCardLayoutId(window.innerWidth)
    const layout = layoutId === 'narrow' ? NARROW_LAYOUT : WIDE_LAYOUT

    if (layout !== this.layout) {
      this.layout = layout
      this.renderedCard = null
    }

    if (card !== this.renderedCard) {
      this.renderedCard = card
      this.draw(card)
    }

    this.applyResponsiveScale(view.camera)
    const liftY = this.clearanceLift(view.camera, view.bottomClearancePx ?? 0)

    view.camera.getWorldPosition(this.cameraPosition)
    view.camera.getWorldQuaternion(this.cameraQuaternion)
    this.targetPosition
      .set(PANEL_POSITION.x, PANEL_POSITION.y + liftY, PANEL_POSITION.z)
      .applyQuaternion(this.cameraQuaternion)
      .add(this.cameraPosition)
    this.targetQuaternion.copy(this.cameraQuaternion)

    if (!view.xrActive || !this.wasVisible) {
      // Desktop: hard-lock. First XR frame: snap so the card doesn't swim in
      // from a stale pose.
      this.mesh.position.copy(this.targetPosition)
      this.mesh.quaternion.copy(this.targetQuaternion)
    } else {
      // VR comfort: ease toward the view instead of head-locking.
      const alpha = 1 - Math.exp(-FOLLOW_RATE * Math.max(0, view.deltaSeconds))
      this.mesh.position.lerp(this.targetPosition, alpha)
      this.mesh.quaternion.slerp(this.targetQuaternion, alpha)
    }

    this.wasVisible = true
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
    this.texture.dispose()
  }

  private draw(card: TourCard) {
    const ctx = this.context
    const layout = this.layout
    const width = layout.canvasWidth

    // Wrapping is measured with the body font, so set it before asking.
    ctx.font = layout.bodyFont
    // Both layouts wrap. Before this, an over-long line (the PC controls
    // summary at 1600px) ran off both sides of the panel and was clipped.
    const lines = wrapCardLines(card.body, (text) => ctx.measureText(text).width, width - layout.sidePad * 2)
    const height = cardCanvasHeight(lines.length, layout)

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
      // On WebGL2 three backs a CanvasTexture with immutable storage sized at
      // its first upload (texStorage2D) and later uploads are texSubImage2D.
      // A resized canvas therefore lands in the old allocation: a shorter
      // card leaves the previous card's top rows showing above it (the
      // "SPINWARD" ghost over every later card), and a taller one fails to
      // upload at all, so the old card stays. A new texture gets new storage.
      this.texture.dispose()
      this.texture = TourCardPanel.createTexture(this.canvas)
      this.mesh.material.map = this.texture
      this.mesh.material.needsUpdate = true
    }

    ctx.clearRect(0, 0, width, height)

    ctx.fillStyle = 'rgba(4, 12, 20, 0.82)'
    ctx.beginPath()
    ctx.roundRect(8, 8, width - 16, height - 16, 18)
    ctx.fill()
    ctx.strokeStyle = 'rgba(103, 232, 249, 0.45)'
    ctx.lineWidth = 2
    ctx.stroke()

    ctx.fillStyle = '#67e8f9'
    ctx.font = layout.titleFont
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(card.title, width * 0.5, layout.titleTop)

    ctx.fillStyle = '#e8f4fa'
    ctx.font = layout.bodyFont

    lines.forEach((line, index) => {
      ctx.fillText(line, width * 0.5, layout.bodyTop + index * layout.lineHeight)
    })

    this.texture.needsUpdate = true
  }

  private static createTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }

  private applyResponsiveScale(camera: THREE.Camera) {
    let panelWidth = PANEL_SCALE.x
    const perspectiveCamera = camera as THREE.PerspectiveCamera & {
      isPerspectiveCamera?: boolean
    }

    if (perspectiveCamera.isPerspectiveCamera === true) {
      const aspect =
        typeof window !== 'undefined' && window.innerHeight > 0
          ? window.innerWidth / window.innerHeight
          : perspectiveCamera.aspect
      const visibleWidth = visibleHeightAt(perspectiveCamera) * aspect
      panelWidth = Math.min(panelWidth, visibleWidth * this.layout.viewportMargin)
    }

    // The canvas height varies with the wrapped line count, so the plane takes
    // its aspect from the live canvas rather than the wide layout's constants.
    this.mesh.scale.set(panelWidth, (panelWidth * this.canvas.height) / this.canvas.width, 1)
  }

  // Converts the touch controls' reserved screen height into a world-space Y
  // offset at the panel's fixed distance, so it clears the on-screen buttons
  // in landscape (where vertical room is short) instead of rendering behind
  // them.
  private clearanceLift(camera: THREE.Camera, clearancePx: number): number {
    const perspectiveCamera = camera as THREE.PerspectiveCamera & {
      isPerspectiveCamera?: boolean
    }

    if (
      clearancePx <= 0 ||
      perspectiveCamera.isPerspectiveCamera !== true ||
      typeof window === 'undefined' ||
      window.innerHeight <= 0
    ) {
      return 0
    }

    return (clearancePx / window.innerHeight) * visibleHeightAt(perspectiveCamera)
  }
}
