import * as THREE from 'three'

import { SUN_DIRECTION } from './sun'

// Island Three daylighting optics. The colony spins about +Y and the sun is
// parked on +Y (see sun.ts), so sunlight travels in -Y, parallel to the axis.
// Each window strip is served by an exterior planar mirror hinged at the -Y rim
// and tilted 45° between the axis and the outward radial. A flat mirror reflects
// the collimated sun into a collimated beam, so the physically correct light is
// a DirectionalLight whose direction and intensity are *derived from the mirror*
// — these helpers are that derivation, kept pure so the geometry is testable.

// The mirror's rest frame at a window center azimuth.
//  · tangent  — the hinge axis (azimuthal, in the floor plane)
//  · outward  — the radial-out direction at the window
//  · along0   — the petal's "up the panel" axis in the fully-open (45°) pose
//  · normal0  — the reflective face normal in the open pose
export type MirrorFrame = {
  tangent: THREE.Vector3
  outward: THREE.Vector3
  along0: THREE.Vector3
  normal0: THREE.Vector3
}

// Incident sun ray direction of travel (toward -Y, since the sun sits on +Y).
const sunIncident = SUN_DIRECTION.clone().multiplyScalar(-1)

// The open-pose catch factor normal0·SUN = cos(45°) = 1/√2; the day beam is
// normalized against this so a fully-open mirror reads as full intensity.
const OPEN_CATCH = Math.SQRT1_2

// Fully-folded swing: at φ = 45° the petal stands along +Y, its normal goes
// radial, and it catches zero sun — i.e. colony midnight.
export const MAX_FOLD = Math.PI / 4

export const computeMirrorFrame = (centerAzimuth: number): MirrorFrame => {
  const cos = Math.cos(centerAzimuth)
  const sin = Math.sin(centerAzimuth)
  const outward = new THREE.Vector3(cos, 0, sin)
  const tangent = new THREE.Vector3(-sin, 0, cos)
  // 45° between the spin axis (+Y) and the outward radial: the open petal.
  const along0 = new THREE.Vector3(0, 1, 0).add(outward).multiplyScalar(Math.SQRT1_2)
  const normal0 = new THREE.Vector3().crossVectors(tangent, along0)
  return { tangent, outward, along0, normal0 }
}

// The petal swung about its hinge by `phi` from the open pose. Because
// {tangent, along0, normal0} is orthonormal and the hinge is `tangent`, the
// swing is a plain rotation in the along/normal plane; positive phi folds the
// mirror toward edge-on so it catches less sun.
export type MirrorPose = {
  along: THREE.Vector3
  normal: THREE.Vector3
}

export const swingPetal = (frame: MirrorFrame, phi: number): MirrorPose => {
  const c = Math.cos(phi)
  const s = Math.sin(phi)
  const along = frame.along0
    .clone()
    .multiplyScalar(c)
    .addScaledVector(frame.normal0, s)
  const normal = frame.normal0
    .clone()
    .multiplyScalar(c)
    .addScaledVector(frame.along0, -s)
  return { along, normal }
}

// The reflected sun beam's direction of travel for a given face normal:
// r = i - 2(i·n)n with i the incident sun ray. In the open pose this is exactly
// -outward (a purely radial beam raking across the bore).
export const reflectSun = (normal: THREE.Vector3): THREE.Vector3 => {
  const dot = sunIncident.dot(normal)
  return sunIncident.clone().addScaledVector(normal, -2 * dot)
}

// How much of the open-pose beam survives at this normal: the front face's
// sun catch, normalized to the open pose and clamped to [0,1]. Drives the
// DirectionalLight intensity so day/night falls out of the mirror angle.
export const mirrorThroughput = (normal: THREE.Vector3): number =>
  THREE.MathUtils.clamp(normal.dot(SUN_DIRECTION) / OPEN_CATCH, 0, 1)

// Map a daylight factor (0 midnight, 1 noon) to the petal swing angle. Noon is
// the open pose (phi 0): the 45° mirror reflects the axial sun radially into the
// bore. Midnight swings the OTHER way, to -MAX_FOLD: the petal lies flat-radial
// and its face turns to point straight back at the sun. So at night the panel
// faces the sun (it catches the glint from outside) while sending the beam back
// out along +Y instead of into the colony — the interior goes dark.
export const openFactorToPhi = (daylight: number): number =>
  -(1 - THREE.MathUtils.clamp(daylight, 0, 1)) * MAX_FOLD
