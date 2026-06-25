import * as THREE from 'three'

type FxKind = 'sphere' | 'ring' | 'spark'

type ActiveExplosion = {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  kind: FxKind
  age: number
  duration: number
  maxRadius: number
  // Opacity falloff exponent; < 1 holds the brightness longer, > 1 snaps it off.
  fade: number
  // Sparks only: fixed origin, outward unit direction, travel distance and needle
  // thickness. Zeroed for spheres/rings.
  ox: number
  oy: number
  oz: number
  dx: number
  dy: number
  dz: number
  travel: number
  thickness: number
}

// One-shot impact bursts for the beam / firework projectiles. A burst layers an
// over-bright flash, a white-hot core, a colored fireball shell, a fast shock
// ring, and a radial spray of tracer sparks — all additive so they stack into a
// hot, bloom-catching flash that still reads bright with NO bloom (VR). Meshes
// are pooled per kind; nothing is allocated per frame. Bursts live in the same
// (rotating, colony-fixed) layer as the balls.
export class Explosions {
  private readonly active: ActiveExplosion[] = []
  // Separate pools per geometry kind so a sphere mesh is never reused as a ring.
  private readonly spherePool: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] = []
  private readonly ringPool: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[] = []
  private readonly sparkPool: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>[] = []

  private readonly sphereGeometry = new THREE.SphereGeometry(1, 16, 12)
  // Thin flat ring in the XY plane; inner 0.82 keeps it a crisp expanding edge.
  private readonly ringGeometry = new THREE.RingGeometry(0.82, 1, 40, 1)
  // Unit cube scaled per spark into a thin +Z needle (a tracer streak).
  private readonly sparkGeometry = new THREE.BoxGeometry(1, 1, 1)

  // Reused scratch so the radial-spark math allocates nothing per spawn.
  private readonly tmp = new THREE.Vector3()
  private readonly tmpAxis = new THREE.Vector3()
  private readonly tmpQuat = new THREE.Quaternion()

  constructor(private readonly parent: THREE.Object3D) {}

  spawn(position: THREE.Vector3, color: number, maxRadius: number) {
    // 1) Over-bright flash frame: big, white, gone almost instantly.
    this.addSphere(position, 0xffffff, maxRadius * 1.4, 0.08, 0.3)
    // 2) White-hot core: small, intense — this is what blooms hardest (non-VR).
    this.addSphere(position, 0xffffff, maxRadius * 0.6, 0.24, 0.45)
    // 3) Colored fireball shell: expands wider and lingers.
    this.addSphere(position, color, maxRadius, 0.5, 0.7)
    // 4) Shock ring: snaps out fast, thin, sharp falloff. Colored to the bolt.
    this.addRing(position, color, maxRadius * 1.8, 0.34, 1.6)
    // 5) Radial tracer sparks: count + spread scale with the burst size, bounded.
    const sparkCount = Math.min(10, Math.max(4, Math.round(maxRadius * 3)))
    for (let i = 0; i < sparkCount; i += 1) {
      this.addSpark(position, color, maxRadius)
    }
  }

  private addSphere(
    position: THREE.Vector3,
    color: number,
    maxRadius: number,
    duration: number,
    fade: number
  ) {
    const mesh = this.spherePool.pop() ?? this.createSphere()
    mesh.material.color.set(color)
    mesh.material.opacity = 1
    mesh.position.copy(position)
    mesh.quaternion.identity()
    mesh.scale.setScalar(0.001)
    mesh.visible = true
    this.parent.add(mesh)
    this.active.push({
      mesh, kind: 'sphere', age: 0, duration, maxRadius, fade,
      ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0, travel: 0, thickness: 0
    })
  }

  private addRing(
    position: THREE.Vector3,
    color: number,
    maxRadius: number,
    duration: number,
    fade: number
  ) {
    const mesh = this.ringPool.pop() ?? this.createRing()
    mesh.material.color.set(color)
    mesh.material.opacity = 1
    mesh.position.copy(position)
    // Fixed slant so the flat ring never goes fully edge-on for the viewer
    // regardless of where they stand; cheap constant orientation.
    mesh.rotation.set(Math.PI * 0.5, 0, 0)
    mesh.scale.setScalar(0.001)
    mesh.visible = true
    this.parent.add(mesh)
    this.active.push({
      mesh, kind: 'ring', age: 0, duration, maxRadius, fade,
      ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0, travel: 0, thickness: 0
    })
  }

  private addSpark(position: THREE.Vector3, color: number, maxRadius: number) {
    const mesh = this.sparkPool.pop() ?? this.createSpark()
    mesh.material.color.set(color)
    mesh.material.opacity = 1

    // Uniform-ish random outward direction, no allocations.
    const u = Math.random() * 2 - 1
    const phi = Math.random() * Math.PI * 2
    const s = Math.sqrt(Math.max(0, 1 - u * u))
    const dx = s * Math.cos(phi)
    const dy = s * Math.sin(phi)
    const dz = u
    this.tmp.set(dx, dy, dz)
    // Orient the +Z needle along the flight direction.
    this.tmpQuat.setFromUnitVectors(this.tmpAxis.set(0, 0, 1), this.tmp)
    mesh.quaternion.copy(this.tmpQuat)

    const travel = maxRadius * (1.2 + Math.random() * 0.9)
    const thickness = maxRadius * 0.05
    mesh.position.copy(position)
    mesh.scale.set(thickness, thickness, 0.001)
    mesh.visible = true
    this.parent.add(mesh)
    this.active.push({
      mesh, kind: 'spark', age: 0,
      duration: 0.4 + Math.random() * 0.25,
      maxRadius, fade: 1.0,
      ox: position.x, oy: position.y, oz: position.z,
      dx, dy, dz, travel, thickness
    })
  }

  step(deltaSeconds: number) {
    for (let index = this.active.length - 1; index >= 0; index -= 1) {
      const fx = this.active[index]
      fx.age += deltaSeconds
      const t = fx.age / fx.duration

      if (t >= 1) {
        this.parent.remove(fx.mesh)
        fx.mesh.visible = false
        this.recycle(fx)
        this.active.splice(index, 1)
        continue
      }

      const opacity = Math.pow(1 - t, fx.fade)
      const grow = 1 - (1 - t) * (1 - t) // ease-out

      if (fx.kind === 'spark') {
        // Fly outward (decelerating), stretch the needle along its path, fade.
        const dist = grow * fx.travel
        const len = Math.max(0.001, fx.thickness * 6 + dist * 0.6 * (1 - t))
        fx.mesh.position.set(
          fx.ox + fx.dx * dist,
          fx.oy + fx.dy * dist,
          fx.oz + fx.dz * dist
        )
        const taper = Math.max(0.001, fx.thickness * (1 - t))
        fx.mesh.scale.set(taper, taper, len)
        fx.mesh.material.opacity = opacity
      } else if (fx.kind === 'ring') {
        // Flat disc edge: scale equally in the ring's own XY plane, stay razor-flat.
        const r = Math.max(0.001, grow * fx.maxRadius)
        fx.mesh.scale.set(r, r, 1)
        fx.mesh.material.opacity = opacity
      } else {
        fx.mesh.scale.setScalar(Math.max(0.001, grow * fx.maxRadius))
        fx.mesh.material.opacity = opacity
      }
    }
  }

  private recycle(fx: ActiveExplosion) {
    if (fx.kind === 'ring') {
      this.ringPool.push(fx.mesh as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>)
    } else if (fx.kind === 'spark') {
      this.sparkPool.push(fx.mesh as THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>)
    } else {
      this.spherePool.push(fx.mesh as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>)
    }
  }

  private makeMaterial(): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      // Required so the flat ring shows from both sides; harmless for additive
      // spheres/needles.
      side: THREE.DoubleSide
    })
  }

  private createSphere() {
    const mesh = new THREE.Mesh(this.sphereGeometry, this.makeMaterial())
    mesh.frustumCulled = false
    return mesh
  }

  private createRing() {
    const mesh = new THREE.Mesh(this.ringGeometry, this.makeMaterial())
    mesh.frustumCulled = false
    return mesh
  }

  private createSpark() {
    const mesh = new THREE.Mesh(this.sparkGeometry, this.makeMaterial())
    mesh.frustumCulled = false
    return mesh
  }

  dispose() {
    for (const fx of this.active) {
      this.parent.remove(fx.mesh)
      fx.mesh.material.dispose()
    }
    this.active.length = 0
    for (const mesh of this.spherePool) mesh.material.dispose()
    for (const mesh of this.ringPool) mesh.material.dispose()
    for (const mesh of this.sparkPool) mesh.material.dispose()
    this.spherePool.length = 0
    this.ringPool.length = 0
    this.sparkPool.length = 0
    this.sphereGeometry.dispose()
    this.ringGeometry.dispose()
    this.sparkGeometry.dispose()
  }
}
