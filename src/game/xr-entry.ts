// Entering XR from the page, as a pure rule (no DOM, no WebXR). IWSDK offers the session to the browser
// (iwsdk.config.json offer 'always'); if the browser does not show that offer, or the player closes it, the page
// still has its own buttons. src/systems/xr-entry.ts asks the browser what it supports and draws them.

export type XRButton = 'ar' | 'vr';

export interface XREntryInput {
  /** isSessionSupported('immersive-ar') said yes. */
  ar: boolean;
  /** isSessionSupported('immersive-vr') said yes. */
  vr: boolean;
  /** An XR session is running now. */
  presenting: boolean;
}

/** The buttons to show, in order: none in a session; else each supported mode, AR first (the game is made for the
 *  real table; VR is the atelier). */
export function xrButtons(s: XREntryInput): XRButton[] {
  if (s.presenting) return [];
  const out: XRButton[] = [];
  if (s.ar) out.push('ar');
  if (s.vr) out.push('vr');
  return out;
}

/** One XR session as the device report sees it when it ends: the XR frames it drew and its report (src/game/debug.ts). */
export interface EndedSession { frames: number; body: string }

/** The report the page offers after a session ends: that session's if it drew at least one XR frame, else the one it
 *  offered before (null: none yet). A session that never showed a frame has nothing to report. */
export function reportAfter(prev: string | null, ended: EndedSession): string | null {
  return ended.frames > 0 ? ended.body : prev;
}

/** Whether the "Send device report" link shows: there is a report and no session is running. */
export function reportShown(s: { presenting: boolean; report: string | null }): boolean {
  return !s.presenting && s.report !== null;
}
