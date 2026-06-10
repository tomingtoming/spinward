import * as THREE from 'three'

import type { TourCard } from '../app/tourGuide'

const CANVAS_WIDTH = 1024
const CANVAS_HEIGHT = 300
// Head-locked, low and centered: readable on desktop and unobtrusive in VR.
const PANEL_POSITION = new THREE.Vector3(0, -0.36, -1.05)
const PANEL_SCALE = new THREE.Vector3(0.78, 0.78 * (CANVAS_HEIGHT / CANVAS_WIDTH), 1)

export class TourCardPanel {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>

  private readonly canvas = document.createElement('canvas')
  private readonly context: CanvasRenderingContext2D
  private readonly texture: THREE.CanvasTexture
  private renderedCard: TourCard | null = null

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
    this.mesh.position.copy(PANEL_POSITION)
    this.mesh.scale.copy(PANEL_SCALE)
    this.mesh.renderOrder = 30
    this.mesh.visible = false
  }

  update(card: TourCard | null) {
    if (card === null) {
      this.mesh.visible = false
      this.renderedCard = null
      return
    }

    this.mesh.visible = true

    if (card === this.renderedCard) {
      return
    }

    this.renderedCard = card
    this.draw(card)
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
