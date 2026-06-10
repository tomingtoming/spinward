import * as THREE from 'three'

import type { TourCard } from '../app/tourGuide'

const CANVAS_WIDTH = 1024
const CANVAS_HEIGHT = 300
// Low and centered relative to the view: readable on desktop, and in VR the
// panel lazily follows the head instead of hard-locking to it.
const PANEL_POSITION = new THREE.Vector3(0, -0.36, -1.05)
const PANEL_SCALE = new THREE.Vector3(0.78, 0.78 * (CANVAS_HEIGHT / CANVAS_WIDTH), 1)
const FOLLOW_RATE = 4

type TourCardView = {
  camera: THREE.Camera
  deltaSeconds: number
  xrActive: boolean
}

export class TourCardPanel {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>

  private readonly canvas = document.createElement('canvas')
  private readonly context: CanvasRenderingContext2D
  private readonly texture: THREE.CanvasTexture
  private readonly targetPosition = new THREE.Vector3()
  private readonly targetQuaternion = new THREE.Quaternion()
  private readonly cameraPosition = new THREE.Vector3()
  private readonly cameraQuaternion = new THREE.Quaternion()
  private renderedCard: TourCard | null = null
  private wasVisible = false

  constructor() {
    this.canvas.width = CANVAS_WIDTH
    this.canvas.height = CANVAS_HEIGHT
    const context = this.canvas.getContext('2d')

    if (context === null) {
      throw new Error('2D canvas context is required for the tour card panel')
    }

    this.context = context
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
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

    if (card !== this.renderedCard) {
      this.renderedCard = card
      this.draw(card)
    }

    view.camera.getWorldPosition(this.cameraPosition)
    view.camera.getWorldQuaternion(this.cameraQuaternion)
    this.targetPosition
      .copy(PANEL_POSITION)
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
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

    ctx.fillStyle = 'rgba(4, 12, 20, 0.82)'
    ctx.beginPath()
    ctx.roundRect(8, 8, CANVAS_WIDTH - 16, CANVAS_HEIGHT - 16, 18)
    ctx.fill()
    ctx.strokeStyle = 'rgba(103, 232, 249, 0.45)'
    ctx.lineWidth = 2
    ctx.stroke()

    ctx.fillStyle = '#67e8f9'
    ctx.font = '700 44px "Avenir Next", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(card.title, CANVAS_WIDTH * 0.5, 36)

    ctx.fillStyle = '#e8f4fa'
    ctx.font = '500 30px "Avenir Next", sans-serif'
    const lineHeight = 44
    const bodyTop = 116

    card.body.forEach((line, index) => {
      ctx.fillText(line, CANVAS_WIDTH * 0.5, bodyTop + index * lineHeight)
    })

    this.texture.needsUpdate = true
  }
}
