// The accessibility settings (src/game/a11y.ts) in the scene: read from the save and ?a11y= at start,
// shown on a small stone panel beside the board (three icons, no text: gaze, one hand, contrast),
// switched by a pinch on an icon (src/systems/spot-hover.ts takes it, as it rings it), a click (desktop mode) or a look
// and a pinch (gaze mode). Every
// change is saved and applied at once: high contrast repaints the scene with HIGH_CONTRAST; gaze
// and one-hand are read by GazeSystem and CenteringSystem. __archwright.a11y reports the settings.
import { createSystem, Vector3 } from '@iwsdk/core';
import type { ArchRuntime } from '../game/runtime.js';
import { activePalette, loadA11y, parseA11yParam, saveA11y, type A11ySettings } from '../game/a11y.js';
import { browserStorage, type ProgressStorage } from '../game/progress.js';
import { A11Y_ICONS, A11Y_PANEL, a11yIconSpot } from '../scene/layout.js';
import { a11yPanel } from '../scene/models.js';
import { usePalette } from '../scene/palette.js';
import { playTick } from '../audio/synth.js';

export type A11yKey = (typeof A11Y_ICONS)[number];
/** Target names of the icons (gaze mode, __archwright.project), in A11Y_ICONS order. */
export const A11Y_TARGETS: Record<A11yKey, string> = { gaze: 'a11y:gaze', oneHand: 'a11y:onehand', highContrast: 'a11y:contrast' };
/** A pinch this close to an icon's centre switches it (half the icon pitch). */
export const ICON_PICK = A11Y_PANEL.pitch / 2;
const PROUD = 0.0018; // m an icon that is on stands above the face

/** What other systems need: the settings, a switch, and where each icon is. */
export interface A11yPanel {
  readonly settings: Readonly<A11ySettings>;
  toggle(key: A11yKey): void;
  /** World centre of an icon while the panel is on view, else null. */
  iconAt(key: A11yKey, out: Vector3): Vector3 | null;
}

export class A11ySystem extends createSystem({}) {
  private storage: ProgressStorage | null = null;
  private settings!: A11ySettings;
  private panel!: ReturnType<typeof a11yPanel>;
  private placed = false;

  init(): void {
    this.storage = browserStorage();
    // The save, plus whatever ?a11y= turns on (the address cannot turn a saved setting off).
    this.settings = { ...loadA11y(this.storage), ...parseA11yParam(new URLSearchParams(location.search).get('a11y')) };
    const api: A11yPanel = {
      settings: this.settings,
      toggle: key => this.toggle(key),
      iconAt: (key, out) => this.iconAt(key, out),
    };
    this.globals.a11y = api;
    this.apply();
  }

  update(): void {
    const arch = this.globals.arch as ArchRuntime | undefined;
    if (!arch?.state) return;
    if (!this.placed) {
      this.placed = true;
      this.panel = a11yPanel(arch.abutmentMat);
      this.panel.group.position.set(A11Y_PANEL.x, 0, A11Y_PANEL.z);
      this.panel.group.userData.keep = true; // survives ArchRuntime.load
      arch.site.add(this.panel.group);
      this.showIcons();
    }
  }

  private toggle(key: A11yKey): void {
    this.settings[key] = !this.settings[key];
    saveA11y(this.storage, this.settings);
    playTick();
    this.apply();
  }

  private apply(): void {
    usePalette(activePalette(this.settings));
    const arch = this.globals.arch as ArchRuntime | undefined;
    if (arch) arch.hook.a11y = { ...this.settings };
    if (this.placed) this.showIcons();
  }

  private showIcons(): void {
    A11Y_ICONS.forEach((k, i) => {
      const m = this.panel.icons[k];
      m.material = this.settings[k] ? this.panel.on : this.panel.off;
      m.position.y = a11yIconSpot(i).y + (this.settings[k] ? PROUD : 0.0007);
    });
  }

  private iconAt(key: A11yKey, out: Vector3): Vector3 | null {
    const arch = this.globals.arch as ArchRuntime | undefined;
    if (!this.placed || !arch?.shown) return null;
    return this.panel.icons[key].getWorldPosition(out);
  }
}
