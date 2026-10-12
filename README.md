# Archwright

Archwright is a hands-first mixed reality puzzle for Meta Quest, played seated at a real desk. A half-built stone arch stands on
your table. You pinch wedge stones from a tray and seat them on its two open ends until the keystone closes the gap. Then you pull
the wooden centering out from under it by hand. The verdict is not scripted: a small rigid-block statics solver decides whether
the arch carries itself or collapses across your desk. No controllers are needed at any point.

> Status: work in progress. The first vertical slice is playable end to end in the emulator: ten levels, stones snap to the
> arch, the centering is pulled, the solver judges, and a failed arch falls apart under Havok physics. Hand interaction has not
> yet been tested on a headset.

## How to play

- **Pinch** a stone in the tray (thumb and index finger together, close to the stone) and carry it to one of the two open ends
  of the arch. As it nears an end, a see-through ghost of the stone shows where it will sit; let go there and it seats with a
  click. Stones turn to the right angle by themselves.
- Stones go on from both springings towards the crown; the last gap takes only the keystone. Pinch the outermost stone of either
  side to take it back off.
- When the arch is closed, pinch the handle of the wooden centering and **pull it towards you**, with one hand or both. Once it
  clears the stones the arch is on its own.
- From world 3 on, a small tower, bell or cart waits on the board behind the arch. When a stone covers its course, it comes down
  onto that stone's back, and the arch has to carry it as well as itself. A heavier load is drawn a little bigger.
- If the arch stands, its line of thrust (the path the load takes through the stones) lights up as a cyan thread. If it does
  not, it opens at the joints the solver named and falls.

The tray groups stones by kind. The three stones differ in colour and in lightness, so they also tell apart in greyscale or
with colour blindness: ochre sandstone (mid), pale tuff (light), dark basalt (dark). Every stone has chamfered edges and chisel
marks; the centering is red-brown planked timber with grain. All colours come from `src/scene/palette.ts`.

**Today's Span.** The round stone beside the level markers opens the day's level: the same arch for everyone on the same date,
numbered from 1 October 2026 (#1). Once the centering is out, a small stone tablet rises on the board with one tile per stone,
coloured like the stones, straight if the arch held and slipped askew if it fell. Pinch it (or click it) and the day's card goes
to the clipboard, ready to paste (the card of 13 October 2026, solved):

```
Archwright · Today's Span #13
⬜⬛⬜🟧⬜⬛⬜
7 stones · par 7 · it held
```

One square per stone from the left springing to the right one (🟧 sandstone, ⬜ tuff, ⬛ basalt), the stones used against par,
and whether it held. No link and no name. Where the browser does not let the page write to the clipboard, the tablet shakes
instead. A daily level is not part of the campaign: it unlocks nothing and is not saved as solved; the round marker
turns solid once today's arch has held on this device.

Controllers work as a fallback (trigger or grip in place of the pinch).

Without a headset the page plays with the mouse or a touch screen (desktop mode, outside any XR session): click a stone and it
rises off the tray, with a ghost at each open end it may join; click a ghost and the stone seats there. Click the stone again or
the bare board to put it back, and click the outermost stone of either half to take it off the arch. Drag the centering's handle
down the page (120 px) to strike. The rebuild stone, the level markers beside the board and the share tablet take a click too. The camera is fixed,
35° above the desk.

Where the board goes (`src/scene/surface-chain.ts`, a pure function with its own tests): if the headset's scene data has a
table mesh or a horizontal plane at desk height within reach (25 to 85 cm below the eyes, at most 75 cm away, at least
30 × 20 cm), the board goes on it, scene meshes first. If none turns up within 1.5 s and hit-test is available, a ring follows
your hand's ray over real surfaces and you pinch to pick a spot on your desk; a spot at floor or shelf height is refused. After
9.5 s with no pick, or without hit-test, the board sits on a lap tray 40 cm in front of you, 42 cm below the eyes. A lap tray or
a picked spot gives way if a real desk is detected before the first stone goes down; after that the board stays put. In an
opaque VR session (no passthrough) you sit in the atelier, a plain virtual room with a wooden desk.

## How to run

Requirements: Node.js 22.12+ (see `.nvmrc`).

```bash
npm install
npm run dev        # IWSDK dev server + managed browser with the IWER XR emulator
npm test           # unit tests (Vitest)
npm run typecheck  # TypeScript strict
npm run level-check  # solve every level: solution, trap and how many arrangements hold
npm run daily-pool   # generate and check the pool of daily levels again (src/levels/daily-pool.ts)
npm run build      # static site in dist/, built for the /archwright/ sub-path
npm run preview    # serve dist/ at http://127.0.0.1:4173/archwright/
```

On a Quest, open the hosted page in the Quest Browser and press **Enter AR**. Hand tracking, plane detection, anchors, hit-test
and mesh detection are all requested as optional features, so the session starts on any setup.

URL parameters, for development and tests:

| Parameter | Effect |
|---|---|
| `?level=w1-2` | start on another level (`w1-1` to `w1-5`, pointed arches `w2-1` to `w2-5`, loads `w3-1` to `w3-5`) |
| `?level=today` | Today's Span for the local date; `?level=daily-2026-11-05` opens another day's (also `?autotest=today:hold`) |
| `?emulator=1` | install IWER, Meta's WebXR emulator, so a desktop browser can run an XR session |
| `?emulator=1&autoxr=ar` | with the emulator only: the page requests the XR session itself (`ar` or `vr`), no click; ignored on a real headset |
| `?surface=lap` | force a surface in an XR session: `mesh`, `plane`, `pick`, `lap` or `atelier` |
| `?autotest=w1-1:hold` | place the level's solution (`hold`) or its trap (`collapse`) by program and pull the centering; runs can be chained with `;` |

`window.__archwright` exposes the state (`loading`, `ready`, `building`, `held`, `collapsed`), the level, the surface the board
stands on (`surface`: `desk` outside XR, else `mesh`, `plane`, `pick`, `lap` or `atelier`) and frame numbers
(fps, JS ms per frame, draw calls, triangles, physics bodies). The `?autotest` mode goes through the same placement and strike
code as a hand, but it is not a hand simulation. For desktop-mode tests the hook also has `placed` (stones seated),
`debug.solution` (the level's solution as steps) and `project(target)`, which gives a stone id, `'face:left'`, `'face:right'`,
`'lever'`, `'tablet'` or `'marker:today'` as a point on the page in CSS pixels, so a test can click it with real mouse events.
On a daily level `daily` holds the day's number and, once the arch is struck, its share card.
`xr` gives the session mode (`immersive-ar`, `immersive-vr`, or null outside XR) and its enabled WebXR features. The XR smoke
test opens `?emulator=1&autoxr=ar&autotest=w1-1:hold` and `?emulator=1&autoxr=vr`: a real (emulated) session, the surface
chain inside it, and in AR the autotest, which waits for the board to find its surface before the first stone goes down.

`node scripts/key-frames.mjs <dir>` opens the emulator page with `&shots=1`, which makes the autotest hold at seven moments
(tray, keystone held over its gap with the snap ghost, keystone seated, centering pulled, arch held, collapse half way, collapse at rest) and saves a screenshot of each.

## How the solver works

The verdict comes from `src/statics/`, a dependency-free TypeScript solver, not from the physics engine. It follows
Jacques Heyman's masonry model: stones are rigid, joints can push but never pull, and the stone never crushes. An arch stands
if at least one line of thrust (the path the compressive force takes from one support to the other) can be drawn in
equilibrium with the weights and still pass through every joint, without the joint slipping under friction. Three numbers
fix such a line, and every joint condition is linear in them, so the question becomes a tiny linear program that runs in
about a millisecond. The solver also picks the line farthest from the joint edges and reports which joints are closest to
opening; when the arch fails, those are the joints where the collapse hinges. As a check it reproduces Heyman's
classic result that a semicircular arch needs a ring at least about 0.107 of its radius thick.

Levels are checked the same way. A level is a centering, a number of courses and a tray of stones (sandstone, light tuff,
heavy basalt; thick, thin or wide). `npm run level-check` closes the arch in every way the tray allows, solves each one, and
confirms that the intended solution holds, that a tempting wrong arrangement falls, and that most arrangements fall.

World 3 adds loads: a tower, a bell or a cart standing on the arch. Each one goes to the solver as a vertical point load
(its mass times g) at the middle of the back of the stone that covers its course, and the scene puts the model on exactly that
point. The masses are game values at the scale of the model (a stone weighs 0.2 to 0.4 kg, a load 0.3 to 0.7 kg). In every
world-3 level the tempting wrong arrangement holds with nothing on it and falls under the load. Three of the five levels put a
load off the crown, towards the quarter span, where a point load strains an arch most; in their solutions most of the heavy
stones go on the far side of the load, not under it.

Today's Span draws on a fixed pool, not on a generator running on the headset. `scripts/daily-pool.ts` draws random levels
from a fixed seed (span, semicircular or pointed centering, 5 to 9 courses, two or three kinds of stone, sometimes one or two
loads), solves every way to close each one, and keeps a level only if it passes the same rules as the world levels: its
fewest-stone solution holds with a margin of at least 0.06, a tempting arrangement falls (with a load, preferably one that would
hold without it), and 2 to 45 % of the closed arrangements hold. It keeps 48 levels, 16 each of semicircular, pointed and
loaded, dealt in turn, and writes them to `src/levels/daily-pool.ts`. Day *N* takes entry (*N* − 1) mod 48, so no level comes
back within 48 days, and the date is the only input: no random numbers and no clock in `src/game/daily.ts`. The tests solve
the whole pool again.

Source: J. Heyman, *The Stone Skeleton: Structural Engineering of Masonry Architecture*, Cambridge University Press, 1995.

## How it is put together

- `src/statics/`: the solver and arch geometry (pure TypeScript, no dependencies, tested in Node).
- `src/game/arch-state.ts`: the rules (which stone may go where, when the arch is closed, the strike). No three.js.
- `src/levels/`: level definitions, each generated from geometry and checked with the solver.
- `src/scene/`, `src/audio/`: procedural meshes and synthesised sounds. There are no model, texture or sound files.
- `src/systems/`: ECS systems (an ECS, entity-component system, keeps data in components and behaviour in systems that run every
  frame): hand tracking and pinch, grab and snap, the centering, the strike, the collapse, the surface finder, the desktop mouse
  mode, rendering. The mouse mode picks through IWSDK's canvas pointer events on `RayInteractable` entities, not a raycaster of
  its own.

Every stone is drawn by one instanced mesh per stone shape with a single material, and shadows are a soft blob under the board,
not real-time shadow maps. Havok's physics WASM is not part of the first load: it is fetched when the first stone is placed.
Nothing is fetched from another origin; the input layer's controller and hand models (which would come from a CDN) are not
loaded, since passthrough shows the player's real hands.

## Built with

[Immersive Web SDK](https://iwsdk.dev) (MIT), three.js (MIT), Havok physics via IWSDK (MIT). Third-party assets are listed in
[ASSETS.md](ASSETS.md).

## License

MIT. See [LICENSE](LICENSE).
