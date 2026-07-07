import * as THREE from 'three'

// GPU rain streaks. One LineSegments draw call: every drop is two vertices
// whose positions the vertex shader derives from a per-drop seed, a shared
// fall offset and a camera-following wrap box — the CPU never touches a drop.
// Drops are stationary in the colony frame apart from the shared velocity, so
// walking/driving/flying through the shower parallaxes correctly, and the
// streak vector uses the camera-RELATIVE velocity so speed leans the rain.

const STREAK_SECONDS = 0.035
// Streaks and per-frame wrap arithmetic break down past this fraction of the
// wrap box; clamp the apparent velocity instead of drawing box-length rods.
const MAX_STREAK_BOX_FRACTION = 0.35

const rainVertexShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 aSeed;
  attribute float aTip;
  uniform vec3 uCenter;
  uniform vec3 uBox;
  uniform vec3 uOffset;
  uniform vec3 uStreak;
  uniform float uIntensity;
  varying float vAlpha;

  void main() {
    // The drop's wrapped position inside the camera-centred box. GLSL mod is
    // floor-based, so the result is always in [0, uBox) regardless of sign.
    vec3 rel = mod(aSeed * uBox + uOffset - uCenter, uBox) - 0.5 * uBox;
    vec3 pos = uCenter + rel + aTip * uStreak;

    // Density: each drop owns a stable hash; the shower thins by dropping the
    // drops whose hash exceeds the current intensity.
    float hash = fract(sin(dot(aSeed, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    vAlpha = step(hash, uIntensity);

    // Soft ellipsoidal fade toward the box edge, brighter head than tail.
    float edge = length(rel / (0.5 * uBox));
    vAlpha *= clamp(1.6 - 1.6 * edge, 0.0, 1.0);
    vAlpha *= mix(0.9, 0.3, aTip);

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
  }
`

const rainFragmentShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;

  void main() {
    #include <logdepthbuf_fragment>
    gl_FragColor = vec4(uColor, vAlpha * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export type RainUpdate = {
  // Camera position in the rain layer's (colony-fixed) local space.
  cameraPosition: THREE.Vector3
  // Colony-fixed rain velocity at the camera (m/s) — moves the drops.
  rainVelocity: THREE.Vector3
  // Colony-fixed camera velocity (m/s) — leans the streaks, not the drops.
  cameraVelocity: THREE.Vector3
  deltaSeconds: number
  // 0..1 shower strength (weather ramp × cloud-deck fade).
  intensity: number
}

export class RainStreaks {
  readonly lines: THREE.LineSegments

  private readonly geometry: THREE.BufferGeometry
  private readonly material: THREE.ShaderMaterial
  private readonly uniforms: {
    uCenter: { value: THREE.Vector3 }
    uBox: { value: THREE.Vector3 }
    uOffset: { value: THREE.Vector3 }
    uStreak: { value: THREE.Vector3 }
    uIntensity: { value: number }
    uColor: { value: THREE.Color }
    uOpacity: { value: number }
  }
  private readonly apparentVelocity = new THREE.Vector3()

  constructor(dropCount: number) {
    const positions = new Float32Array(dropCount * 2 * 3)
    const seeds = new Float32Array(dropCount * 2 * 3)
    const tips = new Float32Array(dropCount * 2)

    for (let drop = 0; drop < dropCount; drop += 1) {
      const seedX = Math.random()
      const seedY = Math.random()
      const seedZ = Math.random()

      for (let end = 0; end < 2; end += 1) {
        const vertex = drop * 2 + end
        seeds[vertex * 3] = seedX
        seeds[vertex * 3 + 1] = seedY
        seeds[vertex * 3 + 2] = seedZ
        tips[vertex] = end
      }
    }

    this.geometry = new THREE.BufferGeometry()
    // The position attribute is required by three even though the shader
    // derives everything from the seed; leave it zeroed.
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3))
    this.geometry.setAttribute('aTip', new THREE.BufferAttribute(tips, 1))

    this.uniforms = {
      uCenter: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(40, 40, 40) },
      uOffset: { value: new THREE.Vector3() },
      uStreak: { value: new THREE.Vector3() },
      uIntensity: { value: 0 },
      uColor: { value: new THREE.Color(0xa8c4d8) },
      uOpacity: { value: 0.5 }
    }

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: rainVertexShader,
      fragmentShader: rainFragmentShader,
      transparent: true,
      depthWrite: false
    })

    this.lines = new THREE.LineSegments(this.geometry, this.material)
    // The box follows the camera in the shader; a static bounding volume
    // would cull the whole shower the moment the player leaves the origin.
    this.lines.frustumCulled = false
    this.lines.visible = false
  }

  // Size the wrap box to the habitat: room-scale on Playground, a generous
  // shell on Izma. Called on preset/dimension changes.
  setBounds(habitatRadius: number) {
    const side = THREE.MathUtils.clamp(habitatRadius * 1.2, 12, 60)
    this.uniforms.uBox.value.setScalar(side)
  }

  update({ cameraPosition, rainVelocity, cameraVelocity, deltaSeconds, intensity }: RainUpdate) {
    this.uniforms.uIntensity.value = intensity
    this.lines.visible = intensity > 0.002

    if (!this.lines.visible) {
      return
    }

    const box = this.uniforms.uBox.value
    const offset = this.uniforms.uOffset.value
    offset.addScaledVector(rainVelocity, Math.max(0, deltaSeconds))
    // Only ever read through mod(·, uBox): wrap to keep float precision.
    offset.set(
      THREE.MathUtils.euclideanModulo(offset.x, box.x),
      THREE.MathUtils.euclideanModulo(offset.y, box.y),
      THREE.MathUtils.euclideanModulo(offset.z, box.z)
    )

    this.uniforms.uCenter.value.copy(cameraPosition)

    // Streak = apparent (camera-relative) motion over the exposure window,
    // clamped so a teleport or a flat-out drive never draws box-length rods.
    this.apparentVelocity.copy(rainVelocity).sub(cameraVelocity)
    const maxLength = box.x * MAX_STREAK_BOX_FRACTION
    this.uniforms.uStreak.value
      .copy(this.apparentVelocity)
      .multiplyScalar(STREAK_SECONDS)
    if (this.uniforms.uStreak.value.length() > maxLength) {
      this.uniforms.uStreak.value.setLength(maxLength)
    }
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
  }
}
