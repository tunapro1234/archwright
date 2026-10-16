# Browser checks

Headless Chromium (Playwright) runs the built site, with IWER, Meta's WebXR emulator, for the XR cases. These are the
scripts behind the emulator numbers in the repository README. None of them is a headset measurement.

```bash
npm run build            # the checks test dist/
npm run browser-check    # all of them, one summary line each; exit code = number of failed checks
node scripts/browser/xr.mjs   # or one at a time
```

| Script | What it checks | Port | Report |
|---|---|---|---|
| `e2e.mjs` | `?autotest=w1-1:hold` ends `held`, `:collapse` ends `collapsed`, perf numbers present | 4791 | `e2e-*.png` |
| `desktop.mjs` | w1-1 solved with real mouse clicks, the centering dragged down: `held` | 4792 | `desktop-*.png` |
| `first-minute.mjs` | the ghost hand plays on a first visit (desktop and emulated VR), never once the lesson is done | 4799 | `first-minute.json` |
| `xr.mjs` | emulated AR session (board on lap, plane, mesh or pick; autotest `held`) and VR session (atelier) | 4793 | `xr-*.png` |
| `xr-room.mjs` | AR in the synthetic office room: planes and meshes, the surface chosen, the museum anchor saved and restored on reload | 4801 | `xr-room.json` |
| `xr-hand.mjs` | the emulated right hand pinches every stone into place and pulls the centering (AR solution `held`, VR trap `collapsed`) | 4805 | `xr-hand.json` |
| `perf.mjs` | draw calls, triangles and physics bodies against the budget in four desktop cases; one emulated VR collapse recorded | 4798 | `perf.json`, `perf.md` |

Every check also fails on any console error; `xr-room` and `xr-hand` also fail on any request to another origin.

Options, for every script and for `run-all.mjs`:

- `--out <dir>`: where reports, screenshots and (for `run-all`) logs go; default `browser-reports/` at the repo root.
- `--base <url>`: test a build that is already served there instead of starting `vite preview` (e.g. the hosted page).
- `--gpu [<exe>]`: use the real GPU (ANGLE D3D11) instead of SwiftShader software WebGL; optionally the browser binary.
- `--commit <sha>`: commit written into the reports (default: `git rev-parse --short HEAD`).

By default WebGL runs in software (SwiftShader), so the checks also run on a machine without a GPU; frame times from
that renderer say nothing about a Quest. Software rendering is slow: a full run can take tens of minutes.
`BROWSER_CHECK_TIMEOUT_S` (default 1200) limits each check in `run-all`; `BROWSER_CHECK_RENICE=1` keeps the browser's
processes at the lowest CPU priority on a shared machine.
