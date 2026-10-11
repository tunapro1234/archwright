// Puts the board on a real surface. In an XR session: a detected horizontal plane at desk height
// within reach if there is one, otherwise a lap tray 40 cm in front of the player, a little below
// the chest. Outside XR (desktop, emulator page) the board sits on a virtual desk.
import {
  BoxGeometry, Color, createSystem, Mesh, Vector3, XRPlane, type Entity,
} from '@iwsdk/core';
import type { ArchRuntime } from '../game/runtime.js';
import { woodMaterial } from '../scene/meshes.js';
import { unlockAudio } from '../audio/synth.js';

export const DESK_HEIGHT = 0.75;
const PLANE_WAIT = 1.5;         // s to wait for planes before falling back to the lap tray
const LAP_FORWARD = 0.4;
const LAP_BELOW_HEAD = 0.42;    // seated: chest is ~30 cm below the eyes; the tray sits a little lower
const REACH = 0.75;

export class SurfaceSystem extends createSystem({ planes: { required: [XRPlane] } }) {
  private inXR = false;
  private waiting = -1;
  private desk?: Mesh;
  private head = new Vector3();
  private fwd = new Vector3();
  private p = new Vector3();
  private background = new Color(0x2b2e33);

  init(): void {
    const desk = new Mesh(new BoxGeometry(1.3, 0.04, 0.7), woodMaterial(0x8a6a4c));
    desk.name = 'desk';
    desk.position.set(0, DESK_HEIGHT - 0.02, -0.45);
    this.world.createTransformEntity(desk, { persistent: true });
    this.desk = desk;
    this.scene.background = this.background;
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.cleanupFuncs.push(() => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    });
  }

  update(delta: number): void {
    const arch = this.globals.arch as ArchRuntime | undefined;
    if (!arch) return;
    const session = this.renderer.xr.isPresenting ? this.renderer.xr.getSession() : null;
    if (!!session !== this.inXR) {
      this.inXR = !!session;
      if (session) {
        unlockAudio();
        // Passthrough: the real room is the background and the real desk is the desk.
        const passthrough = session.environmentBlendMode !== 'opaque';
        this.scene.background = passthrough ? null : this.background;
        if (this.desk) this.desk.visible = !passthrough;
        this.waiting = PLANE_WAIT;
      } else {
        this.scene.background = this.background;
        if (this.desk) this.desk.visible = true;
        arch.site.position.set(0, DESK_HEIGHT, -0.5);
        arch.site.rotation.set(0, 0, 0);
        this.waiting = -1;
      }
    }
    if (this.waiting < 0) return;
    // Only move the board before the first stone goes down.
    if (arch.state.placed.length > 0) { this.waiting = -1; return; }
    this.player.head.getWorldPosition(this.head);
    if (this.head.lengthSq() === 0) return; // no viewer pose yet
    const plane = this.findDesk();
    this.waiting -= delta;
    if (plane) { this.placeOn(arch, plane); this.waiting = -1; }
    else if (this.waiting < 0) this.placeOnLap(arch);
  }

  private findDesk(): Entity | undefined {
    let best: Entity | undefined;
    let bestD = REACH;
    for (const e of this.queries.planes.entities) {
      const plane = e.getValue(XRPlane, '_plane') as XRPlane | undefined;
      if (!plane || plane.orientation !== 'horizontal') continue;
      e.object3D!.getWorldPosition(this.p);
      const below = this.head.y - this.p.y;
      if (below < 0.25 || below > 0.85) continue;  // floor and shelves are not desks
      const d = Math.hypot(this.p.x - this.head.x, this.p.z - this.head.z);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  private facePlayer(arch: ArchRuntime): void {
    this.player.head.getWorldDirection(this.fwd);
    // three.js cameras look down -z; getWorldDirection on the head returns its +z, so flip it.
    this.fwd.set(-this.fwd.x, 0, -this.fwd.z);
    if (this.fwd.lengthSq() < 1e-6) this.fwd.set(0, 0, -1);
    this.fwd.normalize();
    arch.site.rotation.set(0, Math.atan2(-this.fwd.x, -this.fwd.z), 0);
  }

  private placeOn(arch: ArchRuntime, plane: Entity): void {
    plane.object3D!.getWorldPosition(this.p);
    this.facePlayer(arch);
    // On the desk, about 50 cm ahead of the eyes (the arch, not the board centre, is the target).
    arch.site.position.set(this.head.x + this.fwd.x * 0.5, this.p.y, this.head.z + this.fwd.z * 0.5);
  }

  private placeOnLap(arch: ArchRuntime): void {
    this.facePlayer(arch);
    arch.site.position.set(this.head.x + this.fwd.x * LAP_FORWARD, this.head.y - LAP_BELOW_HEAD, this.head.z + this.fwd.z * LAP_FORWARD);
  }
}
