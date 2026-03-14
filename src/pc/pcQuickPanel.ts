import * as THREE from 'three'

import {
  isWatchActionDisabled,
  type WatchRenderSnapshot
} from '../ui/watch/watchBindings'
import {
  WATCH_EXPANDED_SIZE,
  createWatchExpandedLayout,
  getWatchButtonAtUv,
  type WatchActionId
} from '../ui/watch/watchLayout'
import { renderWatchExpanded } from '../ui/watch/watchRenderer'

const PANEL_OFFSET = new THREE.Vector3(-0.48, -0.28, -0.92)
const PANEL_SCALE = new THREE.Vector3(0.44, 0.52, 1)
const panelWorldPosition = new THREE.Vector3()
const panelWorldQuaternion = new THREE.Quaternion()
const cameraPosition = new THREE.Vector3()
const cameraQuaternion = new THREE.Quaternion()
const panelFacingCorrection = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  Math.PI
)
const pointerNdc = new THREE.Vector2()

const createCanvas = () => {
  const canvas = document.createElement('canvas')
  canvas.width = WATCH_EXPANDED_SIZE.width
  canvas.height = WATCH_EXPANDED_SIZE.height
  const context = canvas.getContext('2d')

  if (context === null) {
    throw new Error('2D canvas context is required for the desktop quick panel')
  }

  return { canvas, context }
}

export class PcQuickPanel {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>

  private readonly canvas = createCanvas()
  private readonly texture = new THREE.CanvasTexture(this.canvas.canvas)
  private readonly raycaster = new THREE.Raycaster()
  private readonly layout = createWatchExpandedLayout()
  private snapshot: WatchRenderSnapshot | null = null
  private visible = false
  private hoveredAction: WatchActionId | null = null

  constructor(private readonly onAction: (action: WatchActionId) => boolean | void) {
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
    this.mesh.renderOrder = 25
    this.mesh.visible = false
  }

  get isVisible() {
    return this.visible
  }

  toggle() {
    this.setVisible(!this.visible)
  }

  setVisible(visible: boolean) {
    this.visible = visible
    this.mesh.visible = visible

    if (!visible) {
      this.hoveredAction = null
    }
  }

  update(camera: THREE.PerspectiveCamera, snapshot: WatchRenderSnapshot, active: boolean) {
    this.snapshot = snapshot

    if (!active || !this.visible) {
      this.mesh.visible = false
      return
    }

    camera.updateWorldMatrix(true, false)
    camera.getWorldPosition(cameraPosition)
    camera.getWorldQuaternion(cameraQuaternion)
    panelWorldPosition.copy(PANEL_OFFSET).applyQuaternion(cameraQuaternion).add(cameraPosition)
    panelWorldQuaternion.copy(cameraQuaternion).multiply(panelFacingCorrection)
    this.mesh.position.copy(panelWorldPosition)
    this.mesh.quaternion.copy(panelWorldQuaternion)
    this.mesh.visible = true

    renderWatchExpanded(this.canvas.context, this.layout, snapshot, this.hoveredAction)
    this.texture.needsUpdate = true
  }

  handlePointerMove(
    event: PointerEvent,
    camera: THREE.PerspectiveCamera,
    element: HTMLElement
  ) {
    if (!this.visible || !this.mesh.visible) {
      this.hoveredAction = null
      return false
    }

    const hit = this.raycast(event.clientX, event.clientY, camera, element)
    this.hoveredAction = hit?.id ?? null
    return hit !== null
  }

  handlePointerDown(
    event: PointerEvent,
    camera: THREE.PerspectiveCamera,
    element: HTMLElement
  ) {
    if (!this.visible || !this.mesh.visible || event.button !== 0) {
      return false
    }

    const hit = this.raycast(event.clientX, event.clientY, camera, element)

    if (hit === null) {
      return false
    }

    this.hoveredAction = hit.id
    return this.applyHoveredAction()
  }

  applyHoveredAction() {
    if (this.hoveredAction === null) {
      return false
    }

    return this.onAction(this.hoveredAction) ?? true
  }

  private raycast(
    clientX: number,
    clientY: number,
    camera: THREE.PerspectiveCamera,
    element: HTMLElement
  ) {
    const rect = element.getBoundingClientRect()
    pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    )
    this.raycaster.setFromCamera(pointerNdc, camera)
    const hit = this.raycaster.intersectObject(this.mesh, false)[0]

    if (hit === undefined || hit.uv === undefined) {
      return null
    }

    const button = getWatchButtonAtUv(this.layout, hit.uv)

    if (button === null || this.snapshot === null) {
      return button
    }

    return isWatchActionDisabled(this.snapshot, button.id) ? null : button
  }
}
