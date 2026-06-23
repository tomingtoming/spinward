import * as THREE from 'three'

const DURATION_SECONDS = 0.5

type ActiveExplosion = {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  age: number
  maxRadius: number
}

// One-shot impact bursts for the beam / firework projectiles: an additive glow
// sphere that snaps open and fades over ~half a second. Meshes are pooled and
// reused so rapid fire does not churn the GPU. Bursts live in the same
// (rotating, colony-fixed) layer as the balls, placed at the impact point.
export class Explosions {
  private readonly active: ActiveExplosion[] = []
  private readonly pool: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] = []
  private readonly unitGeometry = new THREE.SphereGeometry(1, 16, 12)

  constructor(private readonly parent: THREE.Object3D) {}

  spawn(position: THREE.Vector3, color: number, maxRadius: number) {
    const mesh = this.pool.pop() ?? this.createMesh()
    mesh.material.color.set(color)
    mesh.material.opacity = 1
    mesh.position.copy(position)
    mesh.scale.setScalar(0.001)
    mesh.visible = true
    this.parent.add(mesh)
    this.active.push({ mesh, age: 0, maxRadius })
  }

  step(deltaSeconds: number) {
    for (let index = this.active.length - 1; index >= 0; index -= 1) {
      const fx = this.active[index]
      fx.age += deltaSeconds
      const t = fx.age / DURATION_SECONDS

      if (t >= 1) {
        this.parent.remove(fx.mesh)
        fx.mesh.visible = false
        this.pool.push(fx.mesh)
        this.active.splice(index, 1)
        continue
      }

      // Snap open fast (ease-out), fade linearly.
      const grow = 1 - (1 - t) * (1 - t)
      fx.mesh.scale.setScalar(Math.max(0.001, grow * fx.maxRadius))
      fx.mesh.material.opacity = 1 - t
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
