// Clean pause (src/game/pause.ts): while the system menu is up, the headset is off or the tab is hidden, game time
// stops. Every system that runs game time (hands, autotest, surface pick, grabbing, the centering, the verdict, the
// collapse, the passer-by and level changes, the first-minute cues, the museum's anchor wait, the loads) and Havok
// skip their update, so nothing moves and no timer runs; the AudioContext is suspended, so a sound already scheduled
// waits too. Drawing and the performance numbers go on. Back in view, the first frame steps at most RESUME_DT.
// __archwright.paused says whether the game is paused now, __archwright.pauses how often it has paused.
import { PhysicsSystem, type World } from '@iwsdk/core';
import type { ArchRuntime } from '../game/runtime.js';
import { frameDelta, isPaused } from '../game/pause.js';
import { audioState, holdAudio } from '../audio/synth.js';

/** Pause `game` (system classes, registered or not yet) and Havok with the player's view; wraps world.update. */
export function installPause(world: World, arch: ArchRuntime, game: readonly unknown[]): void {
  const hold = new Set<unknown>([...game, PhysicsSystem]);
  const hook = arch.hook;
  hook.paused = false;
  hook.pauses = 0;
  hook.audio = audioState;
  let paused = false, back = false;
  const check = () => {
    const now = isPaused({
      xrVisibility: world.renderer.xr.getSession()?.visibilityState ?? null,
      documentHidden: document.visibilityState === 'hidden',
    });
    if (now === paused) return;
    paused = now;
    hook.paused = now;
    if (now) hook.pauses = (hook.pauses ?? 0) + 1;
    else back = true;
    for (const s of world.getSystems()) {
      if (!hold.has(s.constructor)) continue;
      if (now) s.stop(); else s.play();
    }
    holdAudio(now);
  };
  // A hidden page or session may get no frames at all: the events pause it at once.
  document.addEventListener('visibilitychange', check);
  world.renderer.xr.addEventListener('sessionstart', () => world.renderer.xr.getSession()?.addEventListener('visibilitychange', check));
  world.renderer.xr.addEventListener('sessionend', check);
  const update = world.update.bind(world);
  world.update = (delta: number, time: number) => {
    check();
    const d = frameDelta(delta, back);
    back = false;
    update(d, time);
  };
}
