// The desk museum in the scene (src/game/museum.ts): a stone plinth behind the board for every
// finished world, with a small copy of that world's last arch on it. Each plinth is one mesh (one
// draw call: block, piers and stones welded, colours per vertex), placed by plinthLayout in the
// site frame, so it moves with the board.
//
// In an XR session that granted 'anchors' (optional, never required), each plinth is also tied to
// a persistent anchor, so the museum stays where it stood in the room from one session to the
// next: a plinth without a saved handle gets an anchor at its place once the board is placed, and
// its handle is saved under MUSEUM_KEY. At the next session start the saved handles are restored;
// a plinth whose anchor is back within RESTORE_WAIT follows it, and one whose anchor is not back
// in time returns to plinthLayout, its old handle deleted, and is anchored afresh. Without anchors,
// and on the desktop, plinthLayout alone. __archwright.museum reports what is shown.
import { BoxGeometry, createSystem, Group, Matrix4, Mesh, Quaternion, Vector3, type MeshStandardMaterial } from '@iwsdk/core';
import type { ArchRuntime } from '../game/runtime.js';
import type { LoopPicker } from './loop.js';
import type { Progress } from '../game/progress.js';
import { browserStorage, type ProgressStorage } from '../game/progress.js';
import {
  loadHandles, miniature, museumPieces, PLINTH, plinthLayout, saveHandles, type AnchorHandles, type Piece,
} from '../game/museum.js';
import { LEVELS } from '../levels/index.js';
import { stoneOutline } from '../scene/layout.js';
import { museumMaterial, museumPiece, prism, recolorMuseumPiece } from '../scene/models.js';
import { onRepaint } from '../scene/palette.js';

export const RESTORE_WAIT = 3; // s a saved anchor has to come back at session start

// The parts of WebXR anchors used here (not in every lib.dom). All optional: feature-detected.
interface Anchor { anchorSpace: XRSpace; requestPersistentHandle?(): Promise<string>; delete?(): void }
interface AnchorSession {
  restorePersistentAnchor?(handle: string): Promise<Anchor>;
  deletePersistentAnchor?(handle: string): Promise<void>;
}
interface AnchorFrame { createAnchor?(pose: XRRigidTransform, space: XRSpace): Promise<Anchor> | undefined }

interface Plinth {
  piece: Piece;
  mesh: Mesh;
  /** 'layout': on the board's frame; 'pending': an anchor is being made or restored; 'anchored'. */
  mode: 'layout' | 'pending' | 'anchored';
  anchor?: Anchor;
}

export class MuseumSystem extends createSystem({}) {
  private storage: ProgressStorage | null = null;
  private root = new Group();
  private material: MeshStandardMaterial | undefined;
  private seen: Progress | undefined;
  private plinths: Plinth[] = [];
  private session: XRSession | null = null;
  private handles: AnchorHandles = {};
  private refused = new Set<string>(); // pieces this session would not anchor: not asked again
  private restoring = 0; // s since the session started, while restores are outstanding
  private recolor = false;
  private m = new Matrix4();
  private inv = new Matrix4();
  private q = new Quaternion();
  private v = new Vector3();
  private s = new Vector3();

  init(): void {
    this.storage = browserStorage();
    this.handles = loadHandles(this.storage);
    this.root.name = 'museum';
    this.root.userData.keep = true; // survives ArchRuntime.load
    onRepaint(() => { this.recolor = true; });
  }

  update(delta: number): void {
    const arch = this.globals.arch as ArchRuntime | undefined;
    const loop = this.globals.loop as LoopPicker | undefined;
    if (!arch?.state || !loop) return;
    if (!this.root.parent) arch.site.add(this.root);
    const progress = loop.progress();
    if (progress !== this.seen) {
      this.seen = progress;
      this.rebuild(arch, museumPieces(progress));
    }
    if (this.recolor) {
      this.recolor = false;
      for (const p of this.plinths) recolorMuseumPiece(p.mesh);
    }
    this.root.visible = arch.shown;

    const session = this.renderer.xr.isPresenting ? this.renderer.xr.getSession() : null;
    if (session !== this.session) this.startSession(session);
    if (session && this.anchors(session)) this.trackAnchors(arch, session, delta);
    let anchored = 0;
    for (const p of this.plinths) if (p.mode === 'anchored') anchored++;
    const hook = arch.hook.museum;
    if (!hook || hook.anchored !== anchored || hook.plinths.length !== this.plinths.length) {
      arch.hook.museum = { plinths: this.plinths.map(p => p.piece.id), anchored };
    }
  }

  /**
   * One mesh per piece. A plinth already shown stays, anchor and all; only its copy is rebuilt when
   * the arch on it changed (a better arrangement), and a new world only adds a plinth.
   */
  private rebuild(arch: ArchRuntime, pieces: Piece[]): void {
    this.material ??= museumMaterial(arch.stoneMat);
    for (const p of this.plinths) {
      if (pieces.some(q => q.id === p.piece.id)) continue;
      this.root.remove(p.mesh);
      p.mesh.geometry.dispose();
    }
    const layout = plinthLayout(pieces.length);
    this.plinths = pieces.map(piece => {
      let p = this.plinths.find(o => o.piece.id === piece.id);
      if (p && (p.piece.levelId !== piece.levelId || p.piece.arch !== piece.arch)) {
        const mesh = this.pieceMesh(piece);
        mesh.position.copy(p.mesh.position);
        mesh.quaternion.copy(p.mesh.quaternion);
        this.root.remove(p.mesh);
        p.mesh.geometry.dispose();
        this.root.add(mesh);
        p.mesh = mesh;
      }
      if (!p) {
        p = { piece, mesh: this.pieceMesh(piece), mode: 'layout' };
        this.root.add(p.mesh);
      }
      p.piece = piece;
      if (p.mode !== 'anchored') this.toLayout(p, layout);
      return p;
    });
  }

  private toLayout(p: Plinth, layout = plinthLayout(this.plinths.length)): void {
    const at = layout[p.piece.slot];
    p.mesh.position.set(at.x, 0, at.z);
    p.mesh.quaternion.identity();
  }

  /** Plinth block, then the copy standing on it: piers and the level's solution, scaled down. */
  private pieceMesh(piece: Piece): Mesh {
    const def = LEVELS.find(l => l.id === piece.levelId)!;
    const mini = miniature(def, piece.arch);
    const k = mini.scale, H = PLINTH.height;
    const shape = { span: def.span, rise: def.rise, units: def.stones, depth: def.depth };
    const parts = [{ geo: new BoxGeometry(PLINTH.size, H, PLINTH.size).translate(0, H / 2, 0), key: 'abutment' as const }];
    for (const a of mini.piers) {
      parts.push({ geo: new BoxGeometry(a.width * k, a.height * k, (def.depth + 0.012) * k).translate(a.x * k, H + (a.height * k) / 2, 0), key: 'abutment' });
    }
    const stones = mini.stones.map(({ stone, pose }) => ({
      geo: prism(stoneOutline(shape, stone), def.depth).rotateZ(pose.angle).translate(pose.x, pose.y, pose.z).scale(k, k, k).translate(0, H, 0),
      key: stone.material,
    }));
    const mesh = museumPiece([...parts, ...stones], this.material!);
    mesh.name = `museum-${piece.id}`;
    return mesh;
  }

  // --- XR anchors -----------------------------------------------------------------------------

  private anchors(session: XRSession): boolean {
    return !!session.enabledFeatures?.includes('anchors');
  }

  private startSession(session: XRSession | null): void {
    this.session = session;
    this.restoring = 0;
    this.refused.clear();
    for (const p of this.plinths) { p.mode = 'layout'; p.anchor = undefined; this.toLayout(p); }
    if (!session || !this.anchors(session)) return;
    const s = session as unknown as AnchorSession;
    for (const p of this.plinths) {
      const handle = this.handles[p.piece.id];
      if (!handle || !s.restorePersistentAnchor) continue;
      p.mode = 'pending';
      s.restorePersistentAnchor(handle).then(
        a => {
          if (this.session === session && p.mode === 'pending') { p.anchor = a; p.mode = 'anchored'; }
          else a.delete?.(); // back too late: the plinth was anchored afresh
        },
        () => { if (this.session === session && p.mode === 'pending') this.forget(session, p); },
      );
    }
  }

  /** A saved anchor that did not come back: delete its handle; the plinth goes back to the layout. */
  private forget(session: XRSession, p: Plinth): void {
    const handle = this.handles[p.piece.id];
    if (handle) {
      delete this.handles[p.piece.id];
      saveHandles(this.storage, this.handles);
      (session as unknown as AnchorSession).deletePersistentAnchor?.(handle).catch(() => {});
    }
    p.mode = 'layout';
    p.anchor = undefined;
    this.toLayout(p);
  }

  private trackAnchors(arch: ArchRuntime, session: XRSession, delta: number): void {
    const frame = this.xrFrame as (XRFrame & AnchorFrame) | undefined;
    const ref = this.renderer.xr.getReferenceSpace();
    if (!frame || !ref) return;
    this.restoring += delta;
    // The board only stays put once a stone is down (SurfaceSystem may still move it before that).
    const settled = arch.shown && arch.state.placed.length > 0;
    for (const p of this.plinths) {
      if (p.mode === 'pending' && this.restoring >= RESTORE_WAIT && this.handles[p.piece.id]) this.forget(session, p);
      if (p.mode === 'anchored' && p.anchor) {
        const pose = frame.getPose(p.anchor.anchorSpace, ref);
        if (!pose) continue;
        // Reference space -> world (the player rig) -> the site frame the plinths live in.
        this.m.fromArray(pose.transform.matrix).premultiply(this.player.matrixWorld);
        this.m.premultiply(this.inv.copy(arch.site.matrixWorld).invert());
        this.m.decompose(p.mesh.position, p.mesh.quaternion, this.s);
      } else if (p.mode === 'layout' && settled && !this.handles[p.piece.id] && !this.refused.has(p.piece.id)) {
        this.anchorHere(session, frame, ref, p);
      }
    }
  }

  /** A new persistent anchor where the plinth stands now (its place beside the board). */
  private anchorHere(session: XRSession, frame: XRFrame & AnchorFrame, ref: XRReferenceSpace, p: Plinth): void {
    if (!frame.createAnchor) return;
    p.mesh.updateWorldMatrix(true, false);
    // World -> reference space: undo the player rig.
    this.m.copy(this.player.matrixWorld).invert().multiply(p.mesh.matrixWorld);
    this.m.decompose(this.v, this.q, this.s);
    let made: Promise<Anchor> | undefined;
    try {
      made = frame.createAnchor(
        new XRRigidTransform({ x: this.v.x, y: this.v.y, z: this.v.z }, { x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w }), ref);
    } catch {
      made = undefined;
    }
    if (!made) { this.refused.add(p.piece.id); return; }
    p.mode = 'pending';
    made.then(async a => {
      if (this.session !== session) { a.delete?.(); return; }
      p.anchor = a;
      p.mode = 'anchored';
      const handle = await a.requestPersistentHandle?.();
      if (handle && this.session === session) {
        this.handles[p.piece.id] = handle;
        saveHandles(this.storage, this.handles);
      }
    }).catch(() => {
      // No anchor here (refused, or no persistence): the plinth simply stays on the layout.
      if (this.session === session && p.mode === 'pending') p.mode = 'layout';
      this.refused.add(p.piece.id);
    });
  }
}
