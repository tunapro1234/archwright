// Puts the board on a real surface. The decision is chooseSurface (src/scene/surface-chain.ts):
// outside XR the page's virtual desk; in opaque VR the atelier (a virtual room and desk); in
// passthrough a detected desk in front of the player (scene mesh first, then plane; placeOnDesk puts the board
// on it), else a spot the player pinches through hit-test, else a lap tray. This system only gathers the inputs
// and carries the choice out. ?surface=mesh|plane|pick|lap|atelier forces a kind; __archwright.surface reports
// the last one, __archwright.board where it went, and __archwright.xr.head the head every XR frame.
import {
  Box3, BoxGeometry, Color, createSystem, Matrix4, Mesh, Vector3, XRMesh, XRPlane, type Group,
} from '@iwsdk/core';
import type { Side } from '../game/arch-state.js';
import type { ArchRuntime } from '../game/runtime.js';
import type { HandState } from './hands.js';
import { atelier, flatMaterial, pickRing } from '../scene/models.js';
import { paint } from '../scene/palette.js';
import {
  chooseSurface, DESK_BELOW_EYES, placeOnDesk, type SurfaceCandidate, type SurfaceChoice, type SurfaceInput, type SurfaceKind,
} from '../scene/surface-chain.js';
import { playReject, playTick, unlockAudio } from '../audio/synth.js';
import { BOARD } from '../scene/layout.js';

export const DESK_HEIGHT = 0.75;
/** Atelier: the virtual desk top sits this far below the eyes, the arch this far ahead. */
const ATELIER_BELOW_EYES = 0.45;
const ATELIER_FORWARD = 0.5;
const MAX_CANDIDATES = 24;
const FORCE = new Set<SurfaceInput['force']>(['mesh', 'plane', 'pick', 'lap', 'atelier']);
/** Scene-mesh labels that are worth building on (Quest semantic labels). */
const DESK_LABELS = new Set(['table', 'desk']);

const SIDES = ['left', 'right'] as const;

export class SurfaceSystem extends createSystem({
  planes: { required: [XRPlane] },
  meshes: { required: [XRMesh] },
}) {
  private session: XRSession | null | undefined = undefined;
  private elapsed = 0;
  /** The kind the board was placed for in this session, null while still looking. */
  private placed: SurfaceKind | null = null;
  private force: SurfaceInput['force'];
  private desk!: Mesh;
  private atelier!: Group;
  private rings!: Record<Side, Mesh>;
  private hitSources: Record<Side, XRHitTestSource | null | 'pending'> = { left: null, right: null };
  private hitValid: Record<Side, boolean> = { left: false, right: false };
  private hitTest = false;
  private picked = new Vector3();
  private hasPicked = false;
  private pool: SurfaceCandidate[] = [];
  private candidates: SurfaceCandidate[] = [];
  private input_: SurfaceInput = {
    inXR: false, passthrough: false, head: { x: 0, y: 0, z: 0 }, fwd: { x: 0, z: -1 }, candidates: [],
    hitTest: false, elapsed: 0,
  };
  private head = new Vector3();
  private fwd = new Vector3();
  private p = new Vector3();
  private box = new Box3();
  private m = new Matrix4();
  private background = paint(new Color(), 'background');
  /** Detected planes and meshes counted when __archwright.detected was last written. */
  private seenPlanes = -1;
  private seenMeshes = -1;

  init(): void {
    const desk = new Mesh(new BoxGeometry(1.3, 0.04, 0.7), flatMaterial('desk'));
    desk.name = 'desk';
    // Its top a board's thickness below the board's top: the board lies on it. Level with it, the
    // two tops fought for the same depth (the stripes across the board in the desktop view).
    desk.position.set(0, DESK_HEIGHT - BOARD.thickness - 0.02, -0.45);
    this.world.createTransformEntity(desk, { persistent: true });
    this.desk = desk;
    this.atelier = atelier();
    this.atelier.visible = false;
    this.world.createTransformEntity(this.atelier, { persistent: true });
    this.rings = { left: pickRing('pick-left'), right: pickRing('pick-right') };
    for (const r of Object.values(this.rings)) this.world.createTransformEntity(r, { persistent: true });
    for (let i = 0; i < MAX_CANDIDATES; i++) this.pool.push({ x: 0, y: 0, z: 0, width: 0, depth: 0, horizontal: false, source: 'plane' });
    const f = new URLSearchParams(location.search).get('surface') as SurfaceInput['force'];
    this.force = FORCE.has(f) ? f : undefined;
    this.scene.background = this.background;
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.cleanupFuncs.push(() => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      this.dropHitSources();
    });
  }

  update(delta: number): void {
    const arch = this.globals.arch as ArchRuntime | undefined;
    if (!arch?.state) return;
    const session = this.renderer.xr.isPresenting ? this.renderer.xr.getSession() : null;
    if (session !== this.session) this.startSession(arch, session);
    if (!session) return;
    this.elapsed += delta;
    this.reportDetected(arch);
    this.player.head.getWorldPosition(this.head);
    if (this.head.lengthSq() === 0) return; // no viewer pose yet
    this.facing();
    this.reportHead(arch);
    // Once placed in this session, the board only moves before the first stone goes down. A level
    // already under way when the session starts still needs a place: it moves with all its stones.
    if (this.placed !== null && arch.state.placed.length > 0) { this.hideRings(); return; }

    const i = this.input_;
    i.passthrough = session.environmentBlendMode !== 'opaque';
    i.head.x = this.head.x; i.head.y = this.head.y; i.head.z = this.head.z;
    i.fwd.x = this.fwd.x; i.fwd.z = this.fwd.z;
    i.candidates = this.gatherCandidates();
    i.elapsed = this.elapsed;
    i.hitTest = this.hitTest;
    i.force = this.force;
    i.picked = this.hasPicked ? this.picked : undefined;

    const picking = this.placed === null && arch.state.placed.length === 0 && (this.force === 'pick' || chooseSurface(i).kind === 'pick');
    if (picking) this.updateHits(session); else this.hideRings();
    if (picking) {
      const hands = this.globals.hands as Record<Side, HandState> | undefined;
      for (const side of SIDES) {
        if (!this.hitValid[side] || !hands?.[side].pinchStarted) continue;
        this.picked.copy(this.rings[side].position);
        this.hasPicked = true;
        i.picked = this.picked;
        if (chooseSurface(i).waiting) playReject(); else playTick();
      }
    }

    const c = chooseSurface(i);
    if (this.placed === null || (upgradable(this.placed) && (c.kind === 'mesh' || c.kind === 'plane'))) {
      if (!c.waiting) this.place(arch, c);
      else arch.setShown(false);
    }
    arch.hook.surface = this.placed ?? c.kind;
  }

  private startSession(arch: ArchRuntime, session: XRSession | null): void {
    this.dropHitSources();
    this.session = session;
    this.elapsed = 0;
    this.placed = null;
    this.hasPicked = false;
    this.hitTest = !!session?.enabledFeatures?.includes('hit-test') && typeof session.requestHitTestSource === 'function';
    this.input_.inXR = !!session;
    this.seenPlanes = this.seenMeshes = -1;
    if (session) {
      unlockAudio();
      // Until a surface is chosen: the real room in passthrough, and no board (nor a stone to grab).
      this.desk.visible = false;
      this.atelier.visible = false;
      arch.setShown(false);
      this.scene.background = session.environmentBlendMode === 'opaque' ? this.background : null;
      return;
    }
    const c = chooseSurface({ ...this.input_, inXR: false });
    this.place(arch, c);
    arch.hook.surface = c.kind;
  }

  /** Carry out a non-waiting choice: background, furniture, and the board on its surface. */
  private place(arch: ArchRuntime, c: SurfaceChoice): void {
    this.placed = c.kind;
    this.hideRings();
    this.desk.visible = c.kind === 'desk';
    this.atelier.visible = c.kind === 'atelier';
    const opaque = c.kind === 'desk' || c.kind === 'atelier' || this.session?.environmentBlendMode === 'opaque';
    this.scene.background = opaque ? this.background : null;
    const site = arch.site;
    if (c.kind === 'desk') {
      site.position.set(0, DESK_HEIGHT, -0.5);
      site.rotation.set(0, 0, 0);
    } else {
      const yaw = Math.atan2(-this.fwd.x, -this.fwd.z);
      site.rotation.set(0, yaw, 0);
      if (c.kind === 'atelier') {
        const y = this.head.y - ATELIER_BELOW_EYES;
        site.position.set(this.head.x + this.fwd.x * ATELIER_FORWARD, y, this.head.z + this.fwd.z * ATELIER_FORWARD);
        // The desk centre a little behind the arch, so the tray in front of it is on the desk too.
        this.atelier.position.set(site.position.x + this.fwd.x * 0.05, y - BOARD.thickness, site.position.z + this.fwd.z * 0.05);
        this.atelier.rotation.set(0, yaw, 0);
      } else if ((c.kind === 'mesh' || c.kind === 'plane') && c.desk) {
        // Ahead of the eyes if the board's centre lands on the desk from there, else on the desk, turned to the player.
        const p = placeOnDesk(this.head, this.fwd, c.desk);
        site.position.set(p.x, c.desk.y, p.z);
        site.rotation.set(0, p.yaw, 0);
      } else {
        site.position.set(c.position!.x, c.position!.y, c.position!.z);
      }
    }
    arch.setShown(true);
    const at = site.position, d = c.desk;
    // The board's centre: half way along its depth, from the site towards the player (site +z).
    const mid = (BOARD.zMin + BOARD.zMax) / 2, yaw = site.rotation.y;
    arch.hook.board = {
      kind: c.kind, at: { x: at.x, y: at.y, z: at.z },
      // Outside XR there is no head pose to measure from: the desk board has no height below the eyes.
      belowEyes: c.kind === 'desk' ? null : this.head.y - at.y,
      centre: { x: at.x + Math.sin(yaw) * mid, z: at.z + Math.cos(yaw) * mid },
      desk: d ? { minX: d.x - d.width / 2, maxX: d.x + d.width / 2, minZ: d.z - d.depth / 2, maxZ: d.z + d.depth / 2, y: d.y } : null,
    };
  }

  /** __archwright.xr.head: where the eyes are and the yaw they face (degrees, 0 = -z, positive = left), every XR frame. */
  private reportHead(arch: ArchRuntime): void {
    const xr = arch.hook.xr;
    if (!xr) return;
    const h = xr.head ?? (xr.head = { x: 0, y: 0, z: 0, yaw: 0 });
    h.x = this.head.x; h.y = this.head.y; h.z = this.head.z;
    h.yaw = (Math.atan2(-this.fwd.x, -this.fwd.z) * 180) / Math.PI;
  }

  /** __archwright.detected: the label of every plane and mesh the session reports, rewritten when their number changes. */
  private reportDetected(arch: ArchRuntime): void {
    const planes = this.queries.planes.entities.size, meshes = this.queries.meshes.entities.size;
    if (planes === this.seenPlanes && meshes === this.seenMeshes) return;
    this.seenPlanes = planes;
    this.seenMeshes = meshes;
    const label = (v: unknown) => String(v ?? '').toLowerCase();
    arch.hook.detected = {
      planes: [...this.queries.planes.entities].map(e => label((e.getValue(XRPlane, '_plane') as { semanticLabel?: string } | undefined)?.semanticLabel)),
      meshes: [...this.queries.meshes.entities].map(e => label(e.getValue(XRMesh, 'semanticLabel'))),
    };
  }

  /** Horizontal unit vector the head faces. */
  private facing(): void {
    this.player.head.getWorldDirection(this.fwd);
    // three.js cameras look down -z; getWorldDirection on the head returns its +z, so flip it.
    this.fwd.set(-this.fwd.x, 0, -this.fwd.z);
    if (this.fwd.lengthSq() < 1e-6) this.fwd.set(0, 0, -1);
    this.fwd.normalize();
  }

  /** Detected planes and desk-labelled scene meshes as candidate tops, world space. */
  private gatherCandidates(): SurfaceCandidate[] {
    let n = 0;
    const out = this.pool;
    for (const e of this.queries.meshes.entities) {
      if (n >= MAX_CANDIDATES) break;
      const obj = e.object3D;
      if (!obj || !DESK_LABELS.has(String(e.getValue(XRMesh, 'semanticLabel')).toLowerCase())) continue;
      this.box.setFromObject(obj);
      if (this.box.isEmpty()) continue;
      const c = out[n++];
      c.x = (this.box.min.x + this.box.max.x) / 2;
      c.z = (this.box.min.z + this.box.max.z) / 2;
      c.y = this.box.max.y;
      c.width = this.box.max.x - this.box.min.x;
      c.depth = this.box.max.z - this.box.min.z;
      c.horizontal = true;
      c.source = 'mesh';
    }
    for (const e of this.queries.planes.entities) {
      if (n >= MAX_CANDIDATES) break;
      const plane = e.getValue(XRPlane, '_plane') as XRPlane | undefined;
      const obj = e.object3D;
      if (!plane || !obj) continue;
      // The polygon lies in the plane's x-z. Its world bounds give the size (as for a mesh, a world x by z
      // rectangle, which is what placeOnDesk keeps the board inside), their middle the centre.
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y = 0;
      for (const q of plane.polygon) {
        obj.localToWorld(this.p.set(q.x, q.y, q.z));
        if (this.p.x < x0) x0 = this.p.x; if (this.p.x > x1) x1 = this.p.x;
        if (this.p.z < z0) z0 = this.p.z; if (this.p.z > z1) z1 = this.p.z;
        y += this.p.y;
      }
      if (!(x1 > x0)) continue;
      const c = out[n++];
      c.x = (x0 + x1) / 2; c.y = y / plane.polygon.length; c.z = (z0 + z1) / 2;
      c.width = x1 - x0;
      c.depth = z1 - z0;
      c.horizontal = plane.orientation === 'horizontal';
      c.source = 'plane';
    }
    // The first n of the pool; chooseSurface only reads them.
    this.candidates.length = 0;
    for (let k = 0; k < n; k++) this.candidates.push(out[k]);
    return this.candidates;
  }

  /** Hit-test from each hand's ray: a ring where it meets a real surface, warm when desk-high. */
  private updateHits(session: XRSession): void {
    const frame = this.xrFrame;
    const ref = this.renderer.xr.getReferenceSpace();
    for (const side of SIDES) {
      const ring = this.rings[side];
      this.hitValid[side] = false;
      ring.visible = false;
      if (!this.hitTest || !frame || !ref) continue;
      const src = this.hitSources[side];
      if (src === null) {
        const input = this.input.xr.getPrimaryInputSource(side);
        if (input) this.requestHitSource(session, side, input.targetRaySpace);
        continue;
      }
      if (src === 'pending') continue;
      const pose = frame.getHitTestResults(src)[0]?.getPose(ref);
      if (!pose) continue;
      const t = pose.transform.position;
      ring.position.set(t.x, t.y, t.z).applyMatrix4(this.m.copy(this.player.matrixWorld));
      const below = this.head.y - ring.position.y;
      const ok = below >= DESK_BELOW_EYES.min && below <= DESK_BELOW_EYES.max;
      (ring.material as { opacity: number }).opacity = ok ? 0.9 : 0.35;
      ring.visible = true;
      this.hitValid[side] = true;
    }
  }

  private requestHitSource(session: XRSession, side: Side, space: XRSpace): void {
    this.hitSources[side] = 'pending';
    const lost = () => { if (this.session === session) this.hitTest = false; }; // no hit-test after all: the chain moves on to lap
    const req = session.requestHitTestSource?.({ space });
    if (!req) { lost(); return; }
    req.then(s => { if (this.session === session) this.hitSources[side] = s; else s.cancel(); }, lost);
  }

  private dropHitSources(): void {
    for (const side of SIDES) {
      const s = this.hitSources[side];
      if (s && s !== 'pending') s.cancel();
      this.hitSources[side] = null;
    }
  }

  private hideRings(): void {
    for (const side of SIDES) { this.rings[side].visible = false; this.hitValid[side] = false; }
  }
}

/** A lap tray or a picked spot gives way when a real desk turns up before the first stone. */
const upgradable = (k: SurfaceKind) => k === 'lap' || k === 'pick';
