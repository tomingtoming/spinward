import * as THREE from 'three'

// Boundary-layer haze (docs/far-field-lod.md follow-up, 2026-09-02).
//
// The interior air of a spinning cylinder is not a uniform fog: aerosol is
// held against the shell by the spin and by HVAC filtering, so the haze that
// gives a 16km horizontal visibility at street level thins out toward the
// axis. A uniform fog washes the far side of the cylinder to sky colour from
// the ground (overhead contrast ≈ 21%); an Earth-like boundary layer with a
// 500m scale height keeps the horizontal 10km look identical and lets the
// opposite land strip read overhead (≈ 74%). See
// https://toming.app/tech/2026/08/oneill-cylinder-sky/ for the derivation.
//
// Extinction is Beer–Lambert (τ = ∫ρ ds, transmittance e^-τ), which is what
// the Koschmieder visibility conversion in airVisibility.ts assumes. Three's
// stock FogExp2 chunk is Gaussian (e^-(ρd)²): near-clear under ~1km, then
// collapsing — at the "16km" setting its 2%-contrast range was really ~8km.
// The uniform fallback (`?bl=0`, profile.z = 0) keeps that legacy Gaussian
// bit-for-bit so an on-device A/B has the old look as its control.

export const DEFAULT_HAZE_SCALE_HEIGHT_METERS = 500
export const MIN_HAZE_SCALE_HEIGHT_METERS = 50
export const MAX_HAZE_SCALE_HEIGHT_METERS = 20_000

// Midpoint samples per fragment along camera→surface. Eight keeps the
// ground→far-wall (2R) optical depth within ~10% of the closed form
// 2·ρ0·H·(1 − e^(−R/H)) at Izma scale while staying cheap on mobile GPUs.
export const LAYERED_HAZE_SAMPLES = 8

// One plain object shared by reference into every material's uniforms.
// Deliberately NOT a THREE.Vector4: three's cloneUniforms deep-copies
// anything flagged isVector4, which would give every material a private
// snapshot; a plain {x,y,z,w} is copied by reference and uploaded by the same
// vec4 setter, so mutating this object retunes every fogged material at once.
//   x = habitat radius (m)      y = 1 / scale height (1/m)
//   z = 1 layered, 0 uniform    w = unused
export type HazeProfileUniform = { x: number; y: number; z: number; w: number }

export const createHazeProfile = (): HazeProfileUniform => ({
  x: 3200,
  y: 1 / DEFAULT_HAZE_SCALE_HEIGHT_METERS,
  z: 1,
  w: 0
})

export const setHazeProfile = (
  profile: HazeProfileUniform,
  radiusMeters: number,
  scaleHeightMeters: number | null
) => {
  profile.x = radiusMeters
  if (scaleHeightMeters === null || scaleHeightMeters <= 0) {
    profile.y = 0
    profile.z = 0
  } else {
    profile.y = 1 / scaleHeightMeters
    profile.z = 1
  }
}

// `?bl=<metres>` overrides the scale height for on-device A/B; `?bl=0` (or any
// non-positive value) falls back to the old uniform fog. Unparsable → default.
export const resolveHazeScaleHeight = (
  urlValue: string | null,
  defaultMeters: number = DEFAULT_HAZE_SCALE_HEIGHT_METERS
): number | null => {
  if (urlValue === null || urlValue.trim() === '') {
    return defaultMeters
  }
  const parsed = Number(urlValue)
  if (!Number.isFinite(parsed)) {
    return defaultMeters
  }
  if (parsed <= 0) {
    return null
  }
  return Math.min(MAX_HAZE_SCALE_HEIGHT_METERS, Math.max(MIN_HAZE_SCALE_HEIGHT_METERS, parsed))
}

// Relative aerosol density at a height above the shell floor. Outside the
// shell (negative height) the profile is held at the floor value so the
// Exterior vantage keeps its current look instead of snapping to vacuum.
export const layeredDensityAtHeight = (heightMeters: number, invScaleHeight: number) =>
  Math.exp(-Math.max(heightMeters, 0) * invScaleHeight)

type Vec3Like = { x: number; y: number; z: number }

// CPU twin of the GLSL below (same midpoint rule, same sample count) so the
// shader's numbers can be unit-tested against closed forms. The habitat axis
// is world +Y through the origin; height = radius − hypot(x, z).
export const layeredOpticalDepth = (
  from: Vec3Like,
  to: Vec3Like,
  groundDensity: number,
  profile: HazeProfileUniform,
  samples: number = LAYERED_HAZE_SAMPLES
): number => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z
  const length = Math.hypot(dx, dy, dz)
  if (profile.z < 0.5) {
    // Legacy three.js FogExp2: Gaussian in distance.
    return groundDensity * groundDensity * length * length
  }
  let sum = 0
  for (let i = 0; i < samples; i++) {
    const t = (i + 0.5) / samples
    const px = from.x + dx * t
    const pz = from.z + dz * t
    sum += layeredDensityAtHeight(profile.x - Math.hypot(px, pz), profile.y)
  }
  return (groundDensity * length * sum) / samples
}

export const layeredTransmittance = (
  from: Vec3Like,
  to: Vec3Like,
  groundDensity: number,
  profile: HazeProfileUniform,
  samples?: number
) => Math.exp(-layeredOpticalDepth(from, to, groundDensity, profile, samples))

// Closed form of the optical depth straight up from the floor to the axis and
// on to the far wall (the diameter): 2·ρ0·H·(1 − e^(−R/H)). Used by tests and
// by the debug readout.
export const diameterOpticalDepth = (
  radiusMeters: number,
  scaleHeightMeters: number,
  groundDensity: number
) =>
  2 * groundDensity * scaleHeightMeters * (1 - Math.exp(-radiusMeters / scaleHeightMeters))

export const GLSL_LAYERED_HAZE = /* glsl */ `
// Boundary-layer haze optical depth along origin → origin + seg (world space,
// habitat axis = +Y through the origin). profile: x = radius, y = 1/scale
// height, z = 1 layered / 0 uniform. Midpoint rule, LAYERED_HAZE_SAMPLES taps.
float layeredHazeOpticalDepth(vec3 origin, vec3 seg, float groundDensity, vec4 profile) {
  float len = length(seg);
  if (profile.z < 0.5) {
    // Legacy three.js FogExp2 (Gaussian) — the A/B control look.
    return groundDensity * groundDensity * len * len;
  }
  float sum = 0.0;
  for (int i = 0; i < LAYERED_HAZE_SAMPLES; i++) {
    float t = (float(i) + 0.5) / float(LAYERED_HAZE_SAMPLES);
    vec3 p = origin + seg * t;
    float h = profile.x - length(p.xz);
    sum += exp(-max(h, 0.0) * profile.y);
  }
  return groundDensity * len * sum / float(LAYERED_HAZE_SAMPLES);
}
`

const FOG_PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorldOffset;
#endif
`

// mvPosition is view space; the camera's world matrix is rigid (no scale on
// the rig chain), so the transpose of the view rotation carries the view
// vector back to world. World offset from the camera, not absolute world
// position, so the fragment adds the cameraPosition uniform itself.
const FOG_VERTEX = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorldOffset = transpose(mat3(viewMatrix)) * mvPosition.xyz;
#endif
`

const FOG_PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform vec4 fogHabitat;
  varying float vFogDepth;
  varying vec3 vFogWorldOffset;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  #define LAYERED_HAZE_SAMPLES ${LAYERED_HAZE_SAMPLES}
  ${GLSL_LAYERED_HAZE}
#endif
`

const FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - layeredHazeOpticalDepth( cameraPosition, vFogWorldOffset, fogDensity, fogHabitat ) );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`

// Swap three's fog chunks for the layered Beer–Lambert version and thread the
// shared profile uniform into every built-in shader that carries fog. Must run
// before the first render: programs bake the chunk text at compile time and
// materials clone their uniform set from ShaderLib on first use.
export const installLayeredFog = (profile: HazeProfileUniform) => {
  THREE.ShaderChunk.fog_pars_vertex = FOG_PARS_VERTEX
  THREE.ShaderChunk.fog_vertex = FOG_VERTEX
  THREE.ShaderChunk.fog_pars_fragment = FOG_PARS_FRAGMENT
  THREE.ShaderChunk.fog_fragment = FOG_FRAGMENT

  for (const shader of Object.values(THREE.ShaderLib)) {
    const uniforms = shader.uniforms as Record<string, THREE.IUniform>
    if (uniforms.fogColor !== undefined) {
      uniforms.fogHabitat = { value: profile }
    }
  }
}
