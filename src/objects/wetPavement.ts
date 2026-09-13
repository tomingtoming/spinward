import * as THREE from 'three'
import { MAX_RAIN_ARCS, MAX_RAIN_ROOFS, rainRoofNearBox, type RainArcRoof, type RainRoof } from './rainShelter'

/** Saturation follows weather, not the observer's altitude or shelter. */
export function stepPavementWetness(wet: number, rain: number, dt: number) {
  const target = THREE.MathUtils.clamp(rain, 0, 1)
  return THREE.MathUtils.clamp(wet + THREE.MathUtils.clamp(target - wet,
    -Math.max(0, dt) / 120, Math.max(0, dt) / 12), 0, 1)
}

// These materials belong to static surfaces baked into colony coordinates.
// Keep existing maps, fog hooks and lighting; no mirrored scene or extra pass.
export class WetPavement {
  private roofSource: readonly RainRoof[] | null = null
  private arcSource: readonly RainArcRoof[] | null = null
  private maskFocus = new THREE.Vector3(Infinity, Infinity, Infinity)
  readonly uniforms = {
    pavingWetness: { value: 0 },
    pavingFocus: { value: new THREE.Vector3() },
    pavingRoofCount: { value: 0 },
    pavingRoofFrames: { value: Array.from({ length: MAX_RAIN_ROOFS }, () => new THREE.Vector4()) },
    pavingRoofBounds: { value: Array.from({ length: MAX_RAIN_ROOFS }, () => new THREE.Vector4()) },
    pavingArcCount: { value: 0 },
    pavingArcFrames: { value: Array.from({ length: MAX_RAIN_ARCS }, () => new THREE.Vector4()) },
    pavingArcRadii: { value: Array.from({ length: MAX_RAIN_ARCS }, () => new THREE.Vector2()) }
  }
  constructor(materials: readonly THREE.MeshStandardMaterial[], initiallyRaining = false) {
    this.uniforms.pavingWetness.value = initiallyRaining ? 1 : 0
    for (const material of new Set(materials)) {
      const previous = material.onBeforeCompile, cache = material.customProgramCacheKey()
      material.onBeforeCompile = (shader, renderer) => {
        previous.call(material, shader, renderer)
        Object.assign(shader.uniforms, this.uniforms)
        shader.vertexShader = 'varying vec3 pavingPoint; varying float pavingUp;\n' + shader.vertexShader
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          pavingPoint = transformed;
          pavingUp = dot(normalize(normal), -normalize(vec3(position.x, 0., position.z)));
          #ifdef FLIP_SIDED
            pavingUp = -pavingUp;
          #endif`)
        shader.fragmentShader = pavementFragment + shader.fragmentShader
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          float wetPaving = pavementAmount();
          diffuseColor.rgb *= mix(1., .82, wetPaving);`)
        shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, min(roughnessFactor, .38), wetPaving);`)
      }
      material.customProgramCacheKey = () => cache + '|wet-paving-v1'
      material.needsUpdate = true
    }
  }
  update(rain: number, dt: number, focus: THREE.Vector3, roofs: readonly RainRoof[], arcs: readonly RainArcRoof[]) {
    const u = this.uniforms
    u.pavingWetness.value = stepPavementWetness(u.pavingWetness.value, rain, dt)
    u.pavingFocus.value.copy(focus)
    if (u.pavingWetness.value <= .001) return
    if (roofs === this.roofSource && arcs === this.arcSource && this.maskFocus.distanceToSquared(focus) < 100) return
    this.roofSource = roofs; this.arcSource = arcs; this.maskFocus.copy(focus)
    const nearby = roofs.filter(r => rainRoofNearBox(r, focus, 420))
    const distance = (r: RainRoof) => Math.hypot(-focus.x * r.sin + focus.z * r.cos, focus.y - r.axial)
    if (nearby.length > MAX_RAIN_ROOFS) nearby.sort((a, b) => distance(a) - distance(b))
    u.pavingRoofCount.value = Math.min(MAX_RAIN_ROOFS, nearby.length)
    for (let i = 0; i < u.pavingRoofCount.value; i++) {
      const r = nearby[i]
      u.pavingRoofFrames.value[i].set(r.cos, r.sin, r.axial, r.radial)
      u.pavingRoofBounds.value[i].set(r.halfWidth, r.halfDepth, Math.cos(r.yaw ?? 0), Math.sin(r.yaw ?? 0))
    }
    u.pavingArcCount.value = Math.min(MAX_RAIN_ARCS, arcs.length)
    for (let i = 0; i < u.pavingArcCount.value; i++) {
      const r = arcs[i]
      u.pavingArcFrames.value[i].set(r.start, r.span, r.axial, r.halfDepth)
      u.pavingArcRadii.value[i].set(r.radiusStart, r.radiusEnd)
    }
  }
}

const pavementFragment = /* glsl */ `
varying vec3 pavingPoint;
varying float pavingUp;
uniform float pavingWetness;
uniform vec3 pavingFocus;
uniform int pavingRoofCount;
uniform vec4 pavingRoofFrames[${MAX_RAIN_ROOFS}];
uniform vec4 pavingRoofBounds[${MAX_RAIN_ROOFS}];
uniform int pavingArcCount;
uniform vec4 pavingArcFrames[${MAX_RAIN_ARCS}];
uniform vec2 pavingArcRadii[${MAX_RAIN_ARCS}];
float pavementAmount() {
  // Match Three's face orientation: cylinder roads use BackSide, while
  // authored footways can have either winding under a DoubleSide material.
  // Taking abs(normal) here would also wet bridge ceilings and slab bottoms.
  float upward = pavingUp;
  #ifdef DOUBLE_SIDED
    upward *= gl_FrontFacing ? 1. : -1.;
  #endif
  float amount = pavingWetness * smoothstep(.65, .9, upward) * (1. - smoothstep(200., 400., distance(pavingPoint, pavingFocus)));
  if (amount < .001) return 0.;
  for (int i = 0; i < ${MAX_RAIN_ROOFS}; i++) {
    if (i >= pavingRoofCount) break;
    vec4 f = pavingRoofFrames[i], b = pavingRoofBounds[i];
    vec2 d = vec2(dot(pavingPoint.xz, vec2(-f.y, f.x)), pavingPoint.y - f.z);
    vec2 p = vec2(dot(d, b.zw), dot(d, vec2(-b.w, b.z)));
    if (dot(pavingPoint.xz, f.xy) >= f.w + .03 && abs(p.x) <= b.x && abs(p.y) <= b.y) return 0.;
  }
  if (pavingArcCount > 0) {
    vec3 polar = vec3(atan(pavingPoint.z, pavingPoint.x), pavingPoint.y, length(pavingPoint.xz));
    for (int i = 0; i < ${MAX_RAIN_ARCS}; i++) {
      if (i >= pavingArcCount) break;
      vec4 f = pavingArcFrames[i]; vec2 r = pavingArcRadii[i];
      float along = mod(polar.x - f.x, 6.28318530718);
      if (along <= f.y && abs(polar.y - f.z) <= f.w && polar.z >= mix(r.x, r.y, along / f.y) + .03) return 0.;
    }
  }
  return amount;
}
`
