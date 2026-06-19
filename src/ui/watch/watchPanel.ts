import * as THREE from 'three'

import {
  isWatchActionDisabled,
  type WatchRenderSnapshot
} from './watchBindings'
import {
  WATCH_CANVAS_SIZE,
  createAllWatchLayouts,
  getWatchButtonAtUv,
  navTargetForAction,
  type WatchActionId,
  type WatchScreen
} from './watchLayout'
import { renderWatch } from './watchRenderer'

// Matches the canvas aspect so wrist text is not squashed.
const EXPANDED_SCALE = new THREE.Vector3(
  0.18,
  (0.18 * WATCH_CANVAS_SIZE.height) / WATCH_CANVAS_SIZE.width,
  1
)
const WRIST_BACK_MARGIN = 0.10
const WRIST_DORSAL_OFFSET = 0.008
const WRIST_LATERAL_OFFSET = -0.01
const EXPANDED_CENTER = new THREE.Vector3(
  EXPANDED_SCALE.x * 0.5 - EXPANDED_SCALE.x,
  EXPANDED_SCALE.y * 0.5 - EXPANDED_SCALE.y,
  0
)

const anchorPosition = new THREE.Vector3()
const anchorQuaternion = new THREE.Quaternion()
const wristOrigin = new THREE.Vector3()
const controllerRight = new THREE.Vector3()
const controllerUp = new THREE.Vector3()
const controllerBack = new THREE.Vector3()
const panelNormal = new THREE.Vector3()
const panelBasis = new THREE.Matrix4()
const panelQuaternion = new THREE.Quaternion()
const panelFrameRotation = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(Math.PI, 0, Math.PI + Math.PI / 2)
)

const createCanvas = (width: number, height: number) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')

  if (context === null) {
    throw new Error('2D canvas context is required for the wrist UI')
  }

  return { canvas, context }
}

const createMaterial = (texture: THREE.CanvasTexture) =>
  new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    side: THREE.DoubleSide
  })

export class WatchPanel {
  readonly group = new THREE.Group()

  private readonly expandedCanvas = createCanvas(
    WATCH_CANVAS_SIZE.width,
    WATCH_CANVAS_SIZE.height
  )
  private readonly expandedTexture = new THREE.CanvasTexture(this.expandedCanvas.canvas)
  private readonly expandedMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    createMaterial(this.expandedTexture)
  )
  private readonly layouts = createAllWatchLayouts()
  private screen: WatchScreen = 'home'
  private hoveredAction: WatchActionId | null = null
  private snapshot: WatchRenderSnapshot | null = null

  private get layout() {
    return this.layouts[this.screen]
  }

  constructor(private readonly onAction: (action: WatchActionId) => boolean | void) {
    this.expandedTexture.colorSpace = THREE.SRGBColorSpace
    this.expandedMesh.scale.copy(EXPANDED_SCALE)
    this.expandedMesh.position.copy(EXPANDED_CENTER)
    this.expandedMesh.rotation.z = Math.PI
    this.group.renderOrder = 30
    this.group.add(this.expandedMesh)
    this.group.visible = false
  }

  get interactiveObject() {
    return this.expandedMesh
  }

  get hasHover() {
    return this.hoveredAction !== null
  }

  update(
    snapshot: WatchRenderSnapshot,
    xrActive: boolean,
    leftGrip: THREE.Object3D | null,
    leftController: THREE.Object3D | null
  ) {
    this.snapshot = snapshot

    if (!xrActive || leftGrip === null || leftController === null) {
      this.group.visible = false
      return
    }

    leftGrip.updateWorldMatrix(true, false)
    leftGrip.getWorldPosition(anchorPosition)
    leftController.updateWorldMatrix(true, false)
    leftController.getWorldQuaternion(anchorQuaternion)

    controllerRight.set(1, 0, 0).applyQuaternion(anchorQuaternion)
    controllerUp.set(0, 1, 0).applyQuaternion(anchorQuaternion)
    controllerBack.set(0, 0, 1).applyQuaternion(anchorQuaternion)
    panelNormal.crossVectors(controllerRight, controllerBack).normalize()

    wristOrigin
      .copy(anchorPosition)
      .addScaledVector(controllerBack, WRIST_BACK_MARGIN)
      .addScaledVector(controllerUp, WRIST_DORSAL_OFFSET)
      .addScaledVector(controllerRight, WRIST_LATERAL_OFFSET)

    panelBasis.makeBasis(controllerRight, controllerBack, panelNormal)
    this.group.position.copy(wristOrigin)
    panelQuaternion.setFromRotationMatrix(panelBasis).multiply(panelFrameRotation)
    this.group.quaternion.copy(panelQuaternion)
    this.group.visible = true

    renderWatch(
      this.expandedCanvas.context,
      this.layout,
      snapshot,
      this.hoveredAction
    )
    this.expandedTexture.needsUpdate = true
  }

  updateHover(uv: THREE.Vector2 | null) {
    if (uv === null || this.snapshot === null) {
      this.hoveredAction = null
      return
    }

    const hoveredButton = getWatchButtonAtUv(this.layout, uv)
    this.hoveredAction =
      hoveredButton !== null && !isWatchActionDisabled(this.snapshot, hoveredButton.id)
        ? hoveredButton.id
        : null
  }

  clickHovered() {
    if (this.hoveredAction === null) {
      return false
    }

    // nav-* buttons drill between screens inside the panel; everything else is
    // a runtime action.
    const target = navTargetForAction(this.hoveredAction)
    if (target !== null) {
      this.screen = target
      this.hoveredAction = null
      return true
    }

    return this.onAction(this.hoveredAction) ?? true
  }
}
