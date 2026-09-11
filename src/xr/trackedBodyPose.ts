import * as THREE from 'three'

export type BodyGripPose = { position: [number, number, number]; orientation: [number, number, number, number] }
export type TrackedBodyPose = {
  azimuth: number; axial: number; eyeHeight: number; heading: number
  hands: [BodyGripPose | null, BodyGripPose | null]
}

const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion()
const direction = new THREE.Vector3(), scale = new THREE.Vector3()

/** Project this frame's local-floor tracking into the rotating colony. This
 * never writes the camera, controller, locomotion rig or physical player. */
export function projectTrackedBodyPose(head: THREE.Matrix4, hands: [THREE.Matrix4 | null, THREE.Matrix4 | null],
  referenceToColony: THREE.Matrix4, radius: number, previousHeading: number): TrackedBodyPose | null {
  matrix.multiplyMatrices(referenceToColony, head).decompose(position, rotation, scale)
  if (!position.toArray().every(Number.isFinite) || !rotation.toArray().every(Number.isFinite)) return null
  const azimuth = Math.atan2(position.z, position.x), axial = position.y
  const eyeHeight = radius - Math.hypot(position.x, position.z)
  direction.set(0, 0, -1).applyQuaternion(rotation)
  const tangent = -Math.sin(azimuth) * direction.x + Math.cos(azimuth) * direction.z
  const heading = Math.hypot(tangent, direction.y) > .02 ? Math.atan2(tangent, direction.y) : previousHeading
  return { azimuth, axial, eyeHeight, heading, hands: hands.map(hand => {
    if (!hand) return null
    matrix.multiplyMatrices(referenceToColony, hand).decompose(position, rotation, scale)
    if (!position.toArray().every(Number.isFinite) || !rotation.toArray().every(Number.isFinite)) return null
    return { position: position.toArray(), orientation: rotation.toArray() }
  }) as TrackedBodyPose['hands'] }
}

const head = new THREE.Matrix4(), grips: [THREE.Matrix4, THREE.Matrix4] = [new THREE.Matrix4(), new THREE.Matrix4()]
const relative = new THREE.Matrix4()

export function sampleTrackedBodyPose(renderer: THREE.WebGLRenderer, viewRig: THREE.Object3D,
  colony: THREE.Object3D, radius: number, previousHeading: number) {
  const frame = renderer.xr.getFrame(), reference = renderer.xr.getReferenceSpace(), session = renderer.xr.getSession()
  if (!frame || !reference || !session) return null
  const viewer = frame.getViewerPose(reference)
  if (!viewer || viewer.emulatedPosition) return null
  viewRig.updateWorldMatrix(true, false); colony.updateWorldMatrix(true, false)
  relative.copy(colony.matrixWorld).invert().multiply(viewRig.matrixWorld)
  head.fromArray(viewer.transform.matrix)
  const hands: [THREE.Matrix4 | null, THREE.Matrix4 | null] = [null, null]
  // gripSpace is the curled-finger centre, distinct from the targeting ray:
  // https://www.w3.org/TR/webxr/#dom-xrinputsource-gripspace
  for (const source of session.inputSources) {
    if (!source.gripSpace || source.handedness === 'none') continue
    const pose = frame.getPose(source.gripSpace, reference)
    if (!pose || pose.emulatedPosition) continue
    const index = source.handedness === 'left' ? 0 : 1
    hands[index] = grips[index].fromArray(pose.transform.matrix)
  }
  return projectTrackedBodyPose(head, hands, relative, radius, previousHeading)
}
