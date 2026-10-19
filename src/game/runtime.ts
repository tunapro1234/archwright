// The live level: game state, the entities that show it, and the browser hook. Systems read and
// drive it through world.globals.arch; the rules themselves stay in arch-state.ts.
import {
  Color, DirectionalLight, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Object3D, Quaternion, Vector3,
  type Entity, type Material, type World,
} from '@iwsdk/core';
import {
  createLevel, placeStone, takeBack, whyNot, type GameState, type LevelDef, type Load, type Side, type Step, type StoneDef,
} from './arch-state.js';
import type { SolveResult } from '../statics/index.js';
import type { FailureKind } from '../statics/failure-view.js';
import { LEVELS } from '../levels/index.js';
import { dailyDate, dailyLevel, localDateISO } from './daily.js';
import type { A11ySettings } from './a11y.js';
import {
  abutments, ABUTMENT_HEIGHT, ashlarBlocks, BOARD, centeringTop, PIER_EXTRA, PLAQUE, facePose, loadRest, shapeKey, stoneOutline, trayPoses, type Pose2,
} from '../scene/layout.js';
import {
  abutmentMaterial, ashlarMaterial, ashlarMesh, blobShadow, boardMesh, centeringMesh, flatMaterial, ghostColor, ghostMesh, loadMaterials, loadMesh, plaqueMesh, prism, stoneMaterial,
  woodMaterial,
} from '../scene/models.js';
import { freeObjects } from '../scene/free.js';
import { MATERIAL_COLOR } from '../scene/meshes.js';
import { COLORS, onRepaint } from '../scene/palette.js';
import type { SurfaceKind } from '../scene/surface-chain.js';
import type { HandplayHook } from '../systems/handplay.js';
import type { EmulatorHook } from '../emulator/emulator.js';
import type { GazeLook } from '../systems/grab-snap.js';
import type { XRButton } from './xr-entry.js';
import type { CollapseRest, DeskTop } from './rest.js';
import { playCue, playReject, playStone } from '../audio/synth.js';
import { homeCue, stoneNote } from '../audio/music.js';
import { monumentOf, plaqueText } from '../levels/monuments.js';

export type HookState = 'loading' | 'ready' | 'building' | 'held' | 'collapsed';
export interface Hook {
  state: HookState;
  level: string;
  /** Each frame (src/systems/render.ts): smoothed fps, JS ms, the last frame's draw calls, triangles and bodies, and over
   *  the last frames (src/game/frame-stats.ts, refreshed every 0.25 s) the fps of the median frame time (p50) and of the
   *  slowest 5 % (p5); 0 until measured. */
  perf: { fps: number; frameMs: number; drawCalls: number; triangles: number; bodies: number; p50: number; p5: number };
  /** The commit this page was built from (vite define __BUILD__, `git rev-parse --short HEAD`), or 'dev'. */
  build: string;
  /** Where the board stands: the kind SurfaceSystem last chose (src/scene/surface-chain.ts). */
  surface?: SurfaceKind;
  /** ?autotest with &shots=1 only: name of the key frame the autotest is holding for; clear it to go on. */
  shot?: string;
  /** Desktop mouse mode (src/systems/desktop.ts): stones seated so far. */
  placed?: number;
  /** Where a target sits on the page, in CSS px: a stone id, 'face:left', 'face:right', 'lever',
   *  'crown' (the top of the arch's back), 'abutment:left', 'abutment:right' (an abutment's top),
   *  'tablet' (the share card, once shown), 'marker:today' (the daily level's marker), 'rebuild' (the rebuild
   *  stone, while offered), 'marker:<level id>' (an open level's marker) or an icon of the accessibility panel
   *  ('a11y:gaze', 'a11y:onehand', 'a11y:contrast'): every name __archwright.gaze.target can hold. */
  project?: (target: string) => { x: number; y: number } | null;
  /** The same targets in the world (m, the point project() puts on the page), in or out of XR; null when there is none now. */
  where?: (target: string) => { x: number; y: number; z: number } | null;
  debug?: { solution: Step[] };
  /** Today's Span: the day's number while a daily level is on the board, and its share card once struck. */
  daily?: { number: number; card: string | null } | null;
  /** Accessibility settings in force (src/game/a11y.ts). */
  a11y?: A11ySettings;
  /** The XR session: the mode it was requested in (null outside XR), its enabled features, each input source's
   *  profile, the emulator's synthetic room (?emulator=1&room=, null without one) and the head: where the eyes are
   *  (world m) and the way they face, as a yaw in degrees (0 = -z, positive turns left), every frame in XR. */
  xr?: {
    mode: 'immersive-ar' | 'immersive-vr' | null; features: string[]; inputs: string[]; room: string | null;
    head?: { x: number; y: number; z: number; yaw: number } | null;
  };
  /** What the XR session reports of the room (SurfaceSystem): the semantic label of each detected plane and mesh. */
  detected?: { planes: string[]; meshes: string[] };
  /** Where the board went last (SurfaceSystem): the surface kind, the board's top in world space, how far below the eyes
   *  (null outside XR), the board's centre (world x, z) and, on a detected desk (mesh, plane), that desk's top (null
   *  otherwise): its own rectangle (centre cx, cz, width, depth, turned by yaw radians as rotationY) and the world
   *  x/z box round it. */
  board?: {
    kind: SurfaceKind; at: { x: number; y: number; z: number }; belowEyes: number | null;
    centre: { x: number; z: number } | null;
    desk: {
      minX: number; maxX: number; minZ: number; maxZ: number; y: number;
      cx: number; cz: number; width: number; depth: number; yaw: number;
    } | null;
  };
  /** ?emulator=1 only: drive the emulated headset (src/emulator/emulator.ts). */
  emulator?: EmulatorHook;
  /** The last collapse (src/systems/collapse.ts): where its stones came to rest (src/game/rest.ts), counted once, when
   *  every falling stone has been slower than 2 cm/s for half a second or 6 s after the strike, whichever comes first
   *  (null until then), and simTime, the game seconds it has run since it began (still while the game is paused). */
  collapse?: { rest: CollapseRest | null; simTime: number };
  /** Clean pause (src/systems/pause.ts): the game is paused now (system menu, headset off, hidden tab), and how often
   *  it has paused since the page loaded. */
  paused?: boolean;
  pauses?: number;
  /** The sound (src/audio/synth.ts): the AudioContext's state ('none' before it exists) and whether the limiter is in. */
  audio?: { state: AudioContextState | 'none'; limiter: boolean };
  /** The desk museum (src/systems/museum.ts): plinth ids shown, how many follow an XR anchor, and this session's
   *  anchors: new ones asked for, created by the runtime, given a persistent handle, refused or failed; saved ones
   *  that came back, and saved ones that did not. */
  museum?: {
    plinths: string[]; anchored: number;
    anchors: { requested: number; created: number; persisted: number; failed: number; restored: number; lost: number };
  };
  /** The wordless first minute (src/systems/onboard.ts): the cue in force and how often the ghost hand has played. */
  onboard?: { cue: 'ghost-grab' | 'glow-centering' | 'none'; ghostShown: number };
  /** ?emulator=1&handplay= only: how far the emulated hand got (src/systems/handplay.ts). */
  handplay?: HandplayHook;
  /** The stone a pinch would take now (a hand's pinch point in XR, the mouse outside it), marked lifted and lighter; null when none. */
  hover: string | null;
  /** Gaze mode this frame (src/systems/gaze.ts): `on` while the eyes are on a target, `target` its name (a stone id,
   *  'face:left', 'lever', 'a11y:gaze', ... as for project()) and `stone` that stone's id when it is a stone a pinch
   *  would take; all off outside gaze mode. */
  gaze: { on: boolean; target: string | null; stone: string | null };
  /** The spot a hand is over in an XR session (src/systems/spot-hover.ts), marked with a ring: a level marker, the rebuild
   *  stone, the share tablet or an icon, by its project() name; null outside XR, in gaze mode, or when no spot is near. */
  handHover: string | null;
  /** The last strike on this level (src/statics/failure-view.ts): why it fell, the joints its line of thrust leaves and
   *  the joints where it breaks (kind 'none' when it held); null until the first strike after a level load. */
  failure: { kind: FailureKind; outside: number[]; joints: number[] } | null;
  /** The failure marks' opacity now (src/systems/statics.ts): up after a failed strike, FAIL_REST once the stones have
   *  fallen; null when there are none (no failed strike, an open arch, or after the level is cleared). */
  marks: number | null;
  /** Havok (src/systems/collapse.ts): when physics was registered and when its WASM was ready (performance.now ms);
   *  null until then. Registered once the board has been shown and the page is idle, or at the first stone. */
  physics: { registered: number | null; ready: number | null };
  /** Each hand as HandSystem sees it this frame (src/systems/hands.ts): tracked, pinching (a game pinch: never one
   *  started palm up, Quest's system gesture), palm up (src/game/palm.ts). A controller is never palm up. */
  hands: Record<Side, { tracked: boolean; pinching: boolean; palmUp: boolean }>;
  /** The page's own XR buttons (src/systems/xr-entry.ts): whether the browser supports an AR and a VR session (null
   *  until it has answered), the buttons shown now ('ar' before 'vr'; none in a session) and the last session request
   *  or offer the browser turned down, as 'Name: message' (null when none). */
  xrEntry: { ar: boolean | null; vr: boolean | null; shown: XRButton[]; error: string | null };
}

/** A load of world 3 in the scene; LoadSystem moves it (src/systems/loads.ts). */
export interface LoadView {
  def: Load;
  mesh: Mesh;                       // top-level entity, world transform
  rest: { x: number; y: number; z: number }; // site frame: where it waits on the board
  on: number;                       // 0 waiting on the board .. 1 standing on its stone
  stone?: string;                   // id of the stone it stands on (or is coming down onto)
  top: Vector3;                     // world point on that stone's back, kept while the load goes back
  ride?: Matrix4;                   // once that stone falls: the load's transform in the stone's frame
}

export type StoneMode = 'tray' | 'held' | 'tween' | 'placed' | 'dynamic';

export interface Tween {
  from: Pose2; to: Pose2; t: number; dur: number; lift: number; then: StoneMode;
}

export interface StoneView {
  def: StoneDef;
  entity: Entity;
  mesh: Mesh;             // invisible proxy: carries the transform and the collision geometry
  batch: number;          // index into runtime.batches
  slot: number;           // instance index within that batch
  mode: StoneMode;
  home: Pose2;            // tray pose (site frame)
  pose: Pose2;            // current pose (site frame), unused once dynamic
  tween?: Tween;
  heldBy?: Side;
}

export interface Batch { mesh: InstancedMesh; count: number }

/** The hover stone (a pinch would take it) is drawn this much higher (m) and its colour this much lighter (linear). */
export const HOVER_LIFT = 0.004;
export const HOVER_LIGHTEN = 1.12;

const tmpV = new Vector3();
const tmpQ = new Quaternion();
const tmpC = new Color();
const tmpQ2 = new Quaternion();
const xAxis = new Vector3(1, 0, 0);
const zAxis = new Vector3(0, 0, 1);

export class ArchRuntime {
  readonly hook: Hook;
  def!: LevelDef;
  state!: GameState;
  /** Board root: placed on the desk (or lap tray) by SurfaceSystem. */
  readonly site: Group;
  siteEntity!: Entity;
  stones: StoneView[] = [];
  batches: Batch[] = [];
  loads: LoadView[] = [];
  centering!: { mesh: Mesh; handle: Object3D; pull: number; struck: boolean; auto: boolean };
  thrustLine?: Mesh;
  /** Why a struck arch falls, drawn over it from the strike until the collapse is under way (StaticsSystem). */
  failureMarks?: Mesh;
  result?: SolveResult;
  /** Set by CenteringSystem (or autotest) when the centering clears the stones. */
  strikeRequested = false;
  /** Set by StaticsSystem when the verdict is "collapse"; CollapseSystem hands the stones to physics. */
  collapseRequested = false;
  /** Bumped on every load, so systems can drop per-level bookkeeping. */
  generation = 0;
  physicsRegistered = false;
  /** False while SurfaceSystem is still looking for a surface: the board is hidden and nothing can be grabbed. */
  shown = true;
  /** The desk under the board (a detected one, or the atelier's): a collapse lands on it. Null on the lap tray, a picked
   *  spot and the page's own desk. Set by SurfaceSystem. */
  desk: DeskTop | null = null;
  bodies = 0;
  /** The stone a pinch (or a click) would take now: GrabSnapSystem sets it in XR, DesktopSystem outside it, and
   *  StoneRenderSystem draws it HOVER_LIFT higher. */
  hover: StoneView | undefined;
  /** What gaze mode looked at this frame (GazeSystem writes it before GrabSnapSystem reads it): `on` while it looks at
   *  a target, whose pinch confirms that target, and `stone` when that target is a stone it may take. */
  readonly gaze: GazeLook<StoneView> = { on: false, stone: undefined };
  /** The stone each hand's pinch would take this frame (GrabSnapSystem, in XR): the spot mark leaves such a hand to it. */
  readonly handStone: Record<Side, StoneView | undefined> = { left: undefined, right: undefined };
  private armed = false;
  private levelEntities: Entity[] = [];
  /** Plain objects this level built (board, shadow, piers, centering, plaque): not entities, so clear() frees them. */
  private levelObjects: Object3D[] = [];
  readonly stoneMat = stoneMaterial();
  readonly abutmentMat = abutmentMaterial(this.stoneMat);
  private readonly ashlarMat = ashlarMaterial(this.stoneMat);
  private readonly woodMat = woodMaterial();
  private readonly loadMats = loadMaterials();
  private readonly boardMat = flatMaterial('board');
  /** Snap ghosts, one per hand: where the stone that hand holds would seat (desktop mode: one per face). */
  readonly ghosts: Record<Side, Mesh>;
  private readonly proxyMat = new MeshBasicMaterial({ visible: false });

  constructor(readonly world: World) {
    this.hook = {
      state: 'loading',
      level: '',
      perf: { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, bodies: 0, p50: 0, p5: 0 },
      build: typeof __BUILD__ === 'string' ? __BUILD__ : 'dev',
      hover: null,
      gaze: { on: false, target: null, stone: null },
      handHover: null,
      failure: null,
      marks: null,
      physics: { registered: null, ready: null },
      hands: {
        left: { tracked: false, pinching: false, palmUp: false },
        right: { tracked: false, pinching: false, palmUp: false },
      },
      xrEntry: { ar: null, vr: null, shown: [], error: null },
    };
    (window as unknown as { __archwright: Hook }).__archwright = this.hook;
    this.site = new Group();
    this.site.name = 'site';
    this.site.position.set(0, 0.75, -0.5);
    this.siteEntity = world.createTransformEntity(this.site, { persistent: true });
    // One warm key light from high on the right, a little in front, so the chamfers and chisel
    // marks catch it; the soft fill is the scene's gradient environment. No real-time shadows:
    // a blob under the arch does that.
    const sun = new DirectionalLight(0xffe7c8, 1.45);
    sun.position.set(0.55, 1.0, 0.5);
    this.site.add(sun);
    // Aimed at the board wherever it stands (the default target is the world origin, under the player).
    sun.target.userData.keep = true;
    this.site.add(sun.target);
    this.ghosts = { left: ghostMesh('ghost-left'), right: ghostMesh('ghost-right') };
    for (const g of Object.values(this.ghosts)) world.createTransformEntity(g, { persistent: true });
    onRepaint(() => this.repaint());
  }

  /** The palette changed (high-contrast mode): stone tints and the line of thrust follow it. */
  private repaint(): void {
    for (const v of this.stones) this.tint(v);
    if (this.thrustLine) ((this.thrustLine as Mesh).material as MeshBasicMaterial).color.setHex(COLORS.thrust);
    if (this.failureMarks) (this.failureMarks.material as MeshBasicMaterial).color.setHex(COLORS.thrustFail);
  }

  /** A stone's colour from the palette, HOVER_LIGHTEN lighter while it is the hover stone. */
  private tint(v: StoneView): void {
    const b = this.batches[v.batch].mesh;
    b.setColorAt(v.slot, tmpC.setHex(MATERIAL_COLOR[v.def.material]).multiplyScalar(v === this.hover ? HOVER_LIGHTEN : 1));
    b.instanceColor!.needsUpdate = true;
  }

  /** Mark the stone a pinch would take (undefined: none). Only the colours of the stone that stops and the one that starts change. */
  setHover(v: StoneView | undefined): void {
    if (v === this.hover) return;
    const old = this.hover;
    this.hover = v;
    this.hook.hover = v?.def.id ?? null;
    if (old) this.tint(old);
    if (v) this.tint(v);
  }

  /** A world level by id, 'today' or a daily id (daily-YYYY-MM-DD) for Today's Span; else the first level. */
  static levelById(id: string | null): LevelDef {
    if (id === 'today') return dailyLevel(localDateISO());
    const date = id ? dailyDate(id) : null;
    if (date) return dailyLevel(date);
    return LEVELS.find(l => l.id === id) ?? LEVELS[0];
  }

  /** Build the level on the board. Safe to call again to restart or switch level. */
  load(def: LevelDef): void {
    this.clear();
    this.def = def;
    this.state = createLevel(def);
    this.result = undefined;
    this.strikeRequested = false;
    this.collapseRequested = false;
    this.bodies = 0;
    this.generation++;
    this.hook.level = def.id;
    this.hook.failure = null;

    const add = (o: Object3D) => { this.site.add(o); this.levelObjects.push(o); return o; };
    add(boardMesh(this.boardMat));
    add(blobShadow(def.span + 0.16, def.depth + 0.14)).position.set(0, 0.0006, 0);
    // Two piers of cut stone, two courses each, in one mesh.
    add(ashlarMesh(abutments(def).flatMap(a => ashlarBlocks(a, def.depth + PIER_EXTRA)), this.ashlarMat));
    this.woodMat.transparent = false;
    this.woodMat.depthWrite = true;
    this.woodMat.opacity = 1;
    this.setFade(1);
    const cm = centeringMesh(centeringTop(this.state.geometry, 32), def.depth, this.woodMat);
    cm.position.set(0, ABUTMENT_HEIGHT, 0);
    add(cm);
    this.centering = { mesh: cm, handle: cm.getObjectByName('centering-handle')!, pull: 0, struck: false, auto: false };
    // A monument level: its plaque on the desk in front of the board (src/levels/monuments.ts).
    const monument = monumentOf(def.id);
    if (monument) add(plaqueMesh(plaqueText(monument), this.abutmentMat)).position.set(PLAQUE.x, 0, PLAQUE.z);

    // One InstancedMesh per stone shape, all sharing the stone material; colour per instance.
    const homes = trayPoses(def);
    const shapes = new Map<string, number>();
    const counts: number[] = [];
    const geos: Mesh['geometry'][] = [];
    const geo = this.state.geometry;
    def.tray.forEach(s => {
      const key = shapeKey(s);
      if (!shapes.has(key)) {
        shapes.set(key, geos.length);
        geos.push(prism(stoneOutline(geo, s), def.depth));
        counts.push(0);
      }
      counts[shapes.get(key)!]++;
    });
    this.batches = geos.map((g, i) => {
      const mesh = new InstancedMesh(g, this.stoneMat, counts[i]);
      mesh.name = `stones-${i}`;
      mesh.frustumCulled = false; // instances move all over the desk when the arch falls
      mesh.visible = this.shown;
      this.levelEntities.push(this.world.createTransformEntity(mesh));
      return { mesh, count: 0 };
    });
    def.tray.forEach((s, i) => {
      const b = shapes.get(shapeKey(s))!;
      const batch = this.batches[b];
      const mesh = new Mesh(batch.mesh.geometry, this.proxyMat);
      mesh.name = `stone-${s.id}`;
      const entity = this.world.createTransformEntity(mesh);
      this.levelEntities.push(entity);
      const slot = batch.count++;
      batch.mesh.setColorAt(slot, new Color(MATERIAL_COLOR[s.material]));
      this.stones.push({ def: s, entity, mesh, batch: b, slot, mode: 'tray', home: homes[i], pose: { ...homes[i] } });
    });
    for (const b of this.batches) if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
    // World 3: the loads wait on the board behind the arch, each below its course.
    for (const l of this.state.geometry.loads) {
      const mesh = loadMesh(l.kind, l.kg, this.loadMats);
      mesh.visible = this.shown;
      this.levelEntities.push(this.world.createTransformEntity(mesh));
      this.loads.push({ def: l, mesh, rest: loadRest(geo, l.course), on: 0, top: new Vector3() });
    }
    this.setFade(1); // the load materials too, after the last level's fade
    // The first level waits for arm(): until a few frames have run, the page cannot take a click yet.
    this.hook.state = this.armed ? 'ready' : 'loading';
  }

  /** The world has run its first frames (PerfEndSystem): the hook may report the level as playable. */
  arm(): void {
    if (this.armed) return;
    this.armed = true;
    if (this.state && this.hook.state === 'loading') this.hook.state = this.state.placed.length ? 'building' : 'ready';
  }

  private clear(): void {
    this.hideGhost('left');
    this.hideGhost('right');
    this.hover = undefined;
    this.hook.hover = null;
    this.gaze.on = false;
    this.gaze.stone = undefined;
    this.handStone.left = this.handStone.right = undefined;
    this.hook.handHover = null;
    this.hook.gaze.on = false;
    this.hook.gaze.target = this.hook.gaze.stone = null;
    const roots = this.levelEntities.flatMap(e => e.object3D ? [e.object3D] : []);
    for (const e of this.levelEntities) e.dispose({ disposeResources: false });
    this.levelEntities = [];
    for (const child of [...this.site.children]) if (!(child instanceof DirectionalLight) && !child.userData.keep) this.site.remove(child);
    // Free the GPU buffers of what this level built (the stone batches' instance buffers too), and their own
    // materials and textures (the shadow's canvas, the line of thrust's and the failure marks' materials), but never
    // the shared materials the next level reuses (src/scene/free.ts).
    roots.push(...this.levelObjects);
    if (this.thrustLine) roots.push(this.thrustLine);
    if (this.failureMarks) roots.push(this.failureMarks);
    freeObjects(roots, new Set<Material>([this.stoneMat, this.abutmentMat, this.ashlarMat, this.woodMat, this.boardMat, this.proxyMat, ...Object.values(this.loadMats)]));
    this.levelObjects = [];
    this.stones = [];
    this.batches = [];
    this.loads = [];
    this.thrustLine = undefined;
    this.failureMarks = undefined;
    this.hook.marks = null;
  }

  /** Track an extra entity that belongs to this level (physics colliders and the like). */
  own(e: Entity): Entity {
    this.levelEntities.push(e);
    return e;
  }

  stoneById(id: string): StoneView | undefined {
    return this.stones.find(v => v.def.id === id);
  }

  /** Open faces this stone may join now, with the pose it would take there. */
  targets(v: StoneView): { side: Side; pose: Pose2 }[] {
    if (this.state.phase !== 'building') return [];
    const out: { side: Side; pose: Pose2 }[] = [];
    for (const side of ['left', 'right'] as const) {
      if (!whyNot(this.state, v.def, side)) out.push({ side, pose: facePose(this.state, v.def, side) });
    }
    return out;
  }

  /** Seat a stone on a face. Returns the refusal reason, or undefined when it snapped. */
  place(v: StoneView, side: Side, duration = 0.12, lift = 0): string | undefined {
    const pose = this.state.phase === 'building' && !whyNot(this.state, v.def, side) ? facePose(this.state, v.def, side) : undefined;
    const next = placeStone(this.state, v.def.id, side);
    if (next.error || !pose) {
      playReject(); // the refusal is the sound: the stone goes home quietly
      this.sendHome(v, 0.45, false);
      return next.error ?? 'no face';
    }
    this.state = next;
    v.heldBy = undefined;
    this.tweenTo(v, pose, duration, lift, 'placed');
    playStone(stoneNote(next, next.placed[next.placed.length - 1]), duration);
    if (this.hook.state === 'ready') this.hook.state = 'building';
    return undefined;
  }

  /** Lift the outermost stone of `side` back off the arch (it becomes held or returns to the tray). */
  unplace(v: StoneView): boolean {
    const p = this.state.placed.find(q => q.stone.id === v.def.id);
    if (!p) return false;
    const next = takeBack(this.state, p.side);
    if (next.error || next.tray.every(t => t.id !== v.def.id)) return false;
    this.state = next;
    return true;
  }

  /** The stone glides back to its tray spot, with a soft slide (music.homeCue) unless `sound` is false. */
  sendHome(v: StoneView, duration = 0.45, sound = true): void {
    if (sound) playCue(homeCue());
    v.heldBy = undefined;
    this.tweenTo(v, v.home, duration, 0.04, 'tray');
  }

  tweenTo(v: StoneView, to: Pose2, dur: number, lift: number, then: StoneMode): void {
    v.tween = { from: { ...v.pose }, to: { ...to }, t: 0, dur, lift, then };
    v.mode = 'tween';
  }

  /** Show where `v` would seat (a see-through copy at `pose`); `near` in [0, 1] firms it up. */
  showGhost(side: Side, v: StoneView, pose: Pose2, near: number): void {
    const g = this.ghosts[side];
    const mat = g.material as MeshBasicMaterial;
    g.geometry = this.batches[v.batch].mesh.geometry;
    ghostColor(v.def.material, mat.color);
    mat.opacity = 0.25 + 0.25 * near;
    this.applyPose(g, pose);
    g.visible = true;
  }

  /** Show or hide the whole board (site and stones) while the surface is being chosen. */
  setShown(on: boolean): void {
    if (on === this.shown) return;
    this.shown = on;
    this.site.visible = on;
    for (const b of this.batches) b.mesh.visible = on;
    for (const l of this.loads) l.mesh.visible = on;
  }

  /** Fade the level's stones and its line of thrust (1 = solid), before the next level is set up. */
  setFade(alpha: number): void {
    const see = alpha < 1;
    if (this.stoneMat.transparent !== see) { this.stoneMat.transparent = see; this.stoneMat.needsUpdate = true; }
    this.stoneMat.opacity = alpha;
    for (const m of Object.values(this.loadMats)) {
      if (m.transparent !== see) { m.transparent = see; m.needsUpdate = true; }
      m.opacity = alpha;
    }
    if (this.thrustLine) ((this.thrustLine as Mesh).material as MeshBasicMaterial).opacity = 0.95 * alpha;
  }

  hideGhost(side: Side): void {
    this.ghosts[side].visible = false;
  }

  /** Write a site-frame pose into an object's world transform (stones are top-level entities). */
  applyPose(obj: Object3D, p: Pose2): void {
    tmpV.set(p.x, p.y, p.z);
    this.site.localToWorld(tmpV);
    obj.position.copy(tmpV);
    this.site.getWorldQuaternion(obj.quaternion);
    obj.quaternion.multiply(tmpQ.setFromAxisAngle(xAxis, p.tilt)).multiply(tmpQ2.setFromAxisAngle(zAxis, p.angle));
  }

  /** World position of a site-frame point. */
  siteToWorld(p: Pose2, out: Vector3): Vector3 {
    return this.site.localToWorld(out.set(p.x, p.y, p.z));
  }

  get boardDepth(): number { return BOARD.zMax - BOARD.zMin; }
}
