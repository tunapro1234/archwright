// ?emulator=1: IWER (Meta's WebXR emulator) stands in for a headset, so a desktop browser offers an XR session.
// Imported on demand from src/index.ts, so neither this nor IWER ships in the normal first load.
//   &room=<name>   Meta's synthetic room module gives the emulated headset a room to see through to, with its planes
//                  and meshes (a table among them) for the surface chain; the room file comes from this site
//                  (public/emulator/rooms/), never from the module's own loader.
//   &head=<yaw>[,<eye height>]   the emulated headset starts turned by yaw degrees (positive = left) at that eye height.
// __archwright.emulator (EmulatorHook) lets a test drive the device: the session's visibility, where a controller or a
// hand points, and its pinch (a controller's trigger); where the headset looks, and where a hand or a controller is.
import { createSystem, Matrix4, Quaternion, Vector3, type World } from '@iwsdk/core';
import { XRDevice, metaQuest3 } from 'iwer';
import type { HandState } from '../systems/hands.js';
import { emulatorRoom, ROOMS_DIR } from '../net/local-assets.js';
import { aimQuat, HEAD_Z, parseHead, yawOf, yawQuat, type Quat } from './head.js';

type Hand = 'left' | 'right';
type Point = { x: number; y: number; z: number };

export interface EmulatorHook {
  /** The session's visibility as a system menu or the headset coming off would set it. */
  setVisibility(state: XRVisibilityState): void;
  /** Turn that side's input (the hand in hand mode, else the controller) so its ray points at a world point. */
  aim(hand: Hand, at: Point): void;
  /** That side's pinch, 0 to 1: the hand's in hand mode, the controller's trigger otherwise. */
  pinch(hand: Hand, value: number): void;
  /** Turn the headset where it stands so it looks (its -z) at a world point. */
  look(at: Point): void;
  /** Move that side's input so the point the game takes it by is at a world point: the pinch point (between thumb and
   *  index tips) of a hand, the grip of a controller. It stays there, through turns and pinches, until the next reach. */
  reach(hand: Hand, at: Point): void;
}

/** Where reach() put each side, and how far the game's point for that side lies from the input's own position (world m). */
interface Reach { at: Record<Hand, Vector3 | null>; offset: Record<Hand, Vector3 | null> }

/** Install IWER (and the room, when asked for) and place the headset. */
export async function startEmulator(params: URLSearchParams, base: string): Promise<{ device: XRDevice; room: string | null }> {
  const room = emulatorRoom(params.get('room'));
  const device = new XRDevice(metaQuest3);
  // Chromium exposes its own navigator.xr even without a headset; replace it with the emulator.
  device.installRuntime({ forceInstall: true });
  const { yaw, eyeY } = parseHead(params.get('head'));
  device.position.set(0, eyeY, HEAD_Z);
  device.quaternion.set(...yawQuat(yaw));
  if (room) {
    try {
      const [{ SyntheticEnvironmentModule }, json] = await Promise.all([
        import('@iwer/sem'),
        fetch(`${base}${ROOMS_DIR}/${room}.json`).then(r => {
          if (!r.ok) throw new Error(`${r.status} ${r.url}`);
          return r.json() as Promise<unknown>;
        }),
      ]);
      device.installSEM(SyntheticEnvironmentModule);
      device.sem?.loadEnvironment(json);
    } catch (e) {
      console.warn('archwright: no synthetic room', e);
    }
  }
  return { device, room };
}

/** The emulated headset's pose as __archwright.xr.head has it (IWER's space is the world here: the player rig never moves). */
export function headPose(device: XRDevice): { x: number; y: number; z: number; yaw: number } {
  const p = device.position, q = device.quaternion;
  return { x: p.x, y: p.y, z: p.z, yaw: yawOf([q.x, q.y, q.z, q.w]) };
}

export function emulatorHook(device: XRDevice, world: World): EmulatorHook {
  const input = (hand: Hand) => (device.primaryInputMode === 'hand' ? device.hands[hand] : device.controllers[hand]);
  const reached: Reach = { at: { left: null, right: null }, offset: { left: null, right: null } };
  world.globals.reach = reached;
  const m = new Matrix4(), q = new Quaternion(), v = new Vector3(), w = new Vector3();
  return {
    setVisibility: state => device.updateVisibilityState(state),
    aim(hand, at) {
      const i = input(hand);
      const q: Quat | null = i ? aimQuat(i.position, at) : null;
      if (i && q) i.quaternion.set(...q);
    },
    pinch(hand, value) {
      const v = Math.max(0, Math.min(1, value));
      if (device.primaryInputMode === 'hand') device.hands[hand]?.updatePinchValue(v);
      else device.controllers[hand]?.updateButtonValue('trigger', v);
    },
    look(at) {
      // The emulator's space is the player rig's: the eyes in the world, then the way to the point back in the rig.
      const p = device.position;
      m.copy(world.player.matrixWorld);
      v.set(p.x, p.y, p.z).applyMatrix4(m);
      w.set(at.x, at.y, at.z).sub(v).applyQuaternion(q.setFromRotationMatrix(m).invert());
      const a = aimQuat({ x: 0, y: 0, z: 0 }, w);
      if (a) device.quaternion.set(...a);
    },
    reach(hand, at) {
      const to = (reached.at[hand] = new Vector3(at.x, at.y, at.z));
      const i = input(hand), off = reached.offset[hand];
      if (i && off) place(i.position, to, off, world.player.matrixWorld);
    },
  };
}

/** Set an input's position (the emulator's space) so that its point, `offset` away from it in the world, is on `at`. */
function place(position: { set(x: number, y: number, z: number): void }, at: Vector3, offset: Vector3, rig: Matrix4): void {
  const p = tmp.copy(at).sub(offset).applyMatrix4(inv.copy(rig).invert());
  position.set(p.x, p.y, p.z);
}
const tmp = new Vector3(), inv = new Matrix4();

/**
 * Keeps each reached input on its point. Right after HandSystem, each frame: how far the game's point for that side
 * (HandState.point) lies from the input's own position, which moves with an aim() or a pinch, then the input placed so
 * the point is back on target for the next frame. Emulator only (src/index.ts).
 */
export class ReachSystem extends createSystem({}) {
  private v = new Vector3();

  update(): void {
    const device = this.globals.emulator as XRDevice | undefined;
    const hands = this.globals.hands as Record<Hand, HandState> | undefined;
    const reach = this.globals.reach as Reach | undefined;
    if (!device || !hands || !reach) return;
    for (const side of ['left', 'right'] as const) {
      const i = device.primaryInputMode === 'hand' ? device.hands[side] : device.controllers[side];
      if (!i || !hands[side].tracked) continue;
      const p = i.position;
      this.v.set(p.x, p.y, p.z).applyMatrix4(this.player.matrixWorld);
      (reach.offset[side] ??= new Vector3()).subVectors(hands[side].point, this.v);
      const at = reach.at[side];
      if (at) place(p, at, reach.offset[side]!, this.player.matrixWorld);
    }
  }
}
