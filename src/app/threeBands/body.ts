import { Camera, Group, Matrix4, Quaternion, Scene, Vector3, WebGLRenderer } from 'three'
import { PlayerBodyView } from '../../objects/playerBodyView'
import { sampleTrackedBodyPose } from '../../xr/trackedBodyPose'
import type { ThreeBandWalker } from './walker'

// The urban renderer uses a -Z cylinder axis; the simulation/body use +Y.
const canonicalToCity = new Matrix4().makeBasis(new Vector3(0, -1, 0), new Vector3(0, 0, -1), new Vector3(1, 0, 0))
const rotation = new Quaternion().setFromRotationMatrix(canonicalToCity)
export class ThreeBandBody {
  readonly root = new Group()
  readonly view: PlayerBodyView
  readonly frame = new Group()
  constructor(scene: Scene) {
    scene.add(this.root); this.view = new PlayerBodyView(this.root)
    this.frame.quaternion.copy(rotation); scene.add(this.frame)
  }
  update(walker: ThreeBandWalker, dt: number, renderer: WebGLRenderer, rig: Group, camera: Camera, movingSupport = false) {
    const p = walker.state
    this.root.quaternion.identity(); this.root.updateMatrixWorld(true)
    // The same source support surface drives both foot placement and walking.
    this.view.surfaces.sample = (azimuth, axial, fallback) => {
      if (movingSupport) return p.h
      const x = p.x + Math.atan2(Math.sin(azimuth - walker.angle), Math.cos(azimuth - walker.angle)) * walker.radius
      const y = axial - walker.sample.anchor.local[1]
      return walker.world.readyAt(x, y) ? walker.world.ground(x, y) : fallback
    }
    const tracked = renderer.xr.isPresenting ? sampleTrackedBodyPose(renderer, rig, this.frame, walker.radius, -p.yaw) : null
    camera.updateWorldMatrix(true, false)
    const airborneView = !walker.grounded && !renderer.xr.isPresenting
      ? canonicalToCity.clone().invert().multiply(camera.matrixWorld) : undefined
    this.view.update({ radius: walker.radius, azimuth: walker.angle, axial: p.y + walker.sample.anchor.local[1],
      groundHeight: p.h, heading: -p.yaw, grounded: walker.grounded, enabled: true, deltaSeconds: dt,
      seat: null, holding: false, indoors: movingSupport, tracked, airborneView, movingSupport })
    this.root.quaternion.copy(rotation); this.root.updateMatrixWorld(true)
  }
}
