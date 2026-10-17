// ?emulator=1: IWER (Meta's WebXR emulator) stands in for a headset, so a desktop browser offers an XR session.
// Imported on demand from src/index.ts, so neither this nor IWER ships in the normal first load.
//   &room=<name>   Meta's synthetic room module gives the emulated headset a room to see through to, with its planes
//                  and meshes (a table among them) for the surface chain; the room file comes from this site
//                  (public/emulator/rooms/), never from the module's own loader.
//   &head=<yaw>[,<eye height>]   the emulated headset starts turned by yaw degrees (positive = left) at that eye height.
// __archwright.emulator (EmulatorHook) lets a test drive the device: the session's visibility, where a controller or a
// hand points, and its pinch (a controller's trigger).
import { XRDevice, metaQuest3 } from 'iwer';
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
}

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

export function emulatorHook(device: XRDevice): EmulatorHook {
  const input = (hand: Hand) => (device.primaryInputMode === 'hand' ? device.hands[hand] : device.controllers[hand]);
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
  };
}
