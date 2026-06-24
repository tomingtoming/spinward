import * as THREE from 'three'

type ActiveExplosion = {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  age: number
  duration: number
  maxRadius: number
  // Opacity falloff exponent; < 1 holds the brightness longer (reads brighter).
  fade: number
}

// One-shot impact bursts for the beam / firework projectiles. Each burst is a
// bright white-hot core flash plus a wider colored shell, both additive so they
// stack into a hot, bloom-catching flash at the impact point. Meshes are pooled.
// Bursts live in the same (rotating, colony-fixed) layer as the balls.
export class Explosions {
  private readonly active: ActiveExplosion[] = []
  private readonly pool: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] = []
  private readonly unitGeometry = new THREE.SphereGeometry(1, 16, 12)

  constructor(private readonly parent: THREE.Object3D) {}

  spawn(position: THREE.Vector3, color: number, maxRadius: number) {
    // White-hot core: small, intense, quick — this is what blooms and "shines".
    this.add(position, 0xffffff, maxRadius * 0.6, 0.24, 0.45)
    // Colored shell: expands wider and lingers a touch longer.
    this.add(position, color, maxRadius, 0.5, 0.7)
  }

  private add(
    position: THREE.Vector3,
    color: number,
    maxRadius: number,
    duration: number,
    fade: number
  ) {
    const mesh = this.pool.pop() ?? this.createMesh()
    mesh.material.color.set(color)
    mesh.material.opacity = 1
    mesh.position.copy(position)
    mesh.scale.setScalar(0.001)
    mesh.visible = true
    this.parent.add(mesh)
    this.active.push({ mesh, age: 0, duration, maxRadius, fade })
  }

  step(deltaSeconds: number) {
    for (let index = this.active.length - 1; index >= 0; index -= 1) {
      const fx = this.active[index]
      fx.age += deltaSeconds
      const t = fx.age / fx.duration

      if (t >= 1) {
        this.parent.remove(fx.mesh)
        fx.mesh.visible = false
        this.pool.push(fx.mesh)
        this.active.splice(index, 1)
        continue
      }

      // Snap open fast (ease-out); hold the glow, then fade.
      const grow = 1 - (1 - t) * (1 - t)
      fx.mesh.scale.setScalar(Math.max(0.001, grow * fx.maxRadius))
      fx.mesh.material.opacity = Math.pow(1 - t, fx.fade)
    }
  }

  private createMesh() {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false
    })
    const mesh = new THREE.Mesh(this.unitGeometry, material)
    mesh.frustumCulled = false
    return mesh
  }

  dispose() {
    for (const fx of this.active) {
      this.parent.remove(fx.mesh)
      fx.mesh.material.dispose()
    }
    this.active.length = 0
    for (const mesh of this.pool) {
      mesh.material.dispose()
    }
    this.pool.length = 0
    this.unitGeometry.dispose()
  }
}
