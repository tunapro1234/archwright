# Archwright

Archwright is a hands-first mixed reality puzzle for Meta Quest, played seated at a real desk. A half-built stone arch stands on
your table. You pinch wedge stones from a tray and seat them on its two open ends until the keystone closes the gap. Then you pull
the wooden centering out from under it by hand. The verdict is not scripted: a small rigid-block statics solver decides whether
the arch carries itself or collapses across your desk. No controllers are needed at any point.

> Status: work in progress, playable end to end in a desktop browser and in IWER, Meta's WebXR emulator: three worlds of five
> levels, two monument levels, Today's Span and the museum. **Archwright has not been tried on a real headset.** Everything
> described here was tested with the emulator or with a desktop browser; hand tracking, passthrough, plane detection and
> anchors on an actual Quest are untested.

## How to play

- **Pinch** a stone in the tray (thumb and index finger together, close to the stone) and carry it to one of the two open ends
  of the arch. As it nears an end, a see-through ghost of the stone shows where it will sit; let go there and it seats with a
  click. Stones turn to the right angle by themselves. Before you pinch, the stone your fingers would take rises 4 mm and turns
  a little lighter (in high contrast it also gets an outline), so among close stones you know which one you will get; the
  pinch takes that same stone. In desktop mode the stone under the mouse that a click would take does the same.
- Stones go on from both springings towards the crown; the last gap takes only the keystone. Pinch the outermost stone of either
  side to take it back off.
- When the arch is closed, pinch the handle of the wooden centering and **pull it towards you**, with one hand or both. Once it
  clears the stones the arch is on its own.
- From world 3 on, a small tower, bell or cart waits on the board behind the arch. When a stone covers its course, it comes down
  onto that stone's back, and the arch has to carry it as well as itself. A heavier load is drawn a little bigger.
- If the arch stands, its line of thrust (the path the load takes through the stones) lights up as a cyan thread. If it does
  not, it opens at the joints the solver named and falls.
- A held arch is then crossed by a small passenger, walking over its back from one pier to the other; after that, unless it
  was the last level, its stones fade and the next level is set up. After a collapse a rebuild stone appears above the board,
  in front of the arch: pinch it and the same level starts again with the same tray. Small stones beside the board open any
  level you have reached (solid: solved, hollow: open, lifted and lit: the one on the board). Progress is saved in this
  browser (`archwright.progress.v1`), and the game reopens on the level where you left off.

**The first minute has no text.** On the first level a pale ghost hand pinches the first stone of the solution out of the
tray and seats a see-through copy of it on its open end, with a soft touch sound as the fingers meet (the real stones do not
move). If your hands are in view and you have not picked anything up 12 s later, it shows the move again, three times at most;
your first grab ends it for good, and hands resting out of view do not count as waiting. Once an arch is closed, bringing a hand
near the centering's handle makes the centering glow warm, until you strike your first arch. The desktop mode shows the same
hand, and the glow follows the mouse. The lesson's progress is kept in this browser (`archwright.onboard.v1`); the rules are
pure functions in `src/game/onboarding.ts`.

The tray groups stones by kind. The three stones differ in colour and in lightness, so they also tell apart in greyscale or
with colour blindness: muted ochre sandstone (mid), pale tuff (light), dark basalt (dark). Every stone has chamfered edges and chisel
marks; the centering is red-brown planked timber with grain. The arch springs from two piers of cut limestone, two courses
of blocks with staggered joints. One warm key light from high on the right and a soft ambient fill light the scene; there are
no real-time shadows, only a soft blob under the arch. All colours come from `src/scene/palette.ts`, which also
holds a high-contrast palette (see [Accessibility](#accessibility)).

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
down the page (120 px) to strike. The rebuild stone, the level markers beside the board and the share tablet take a click too. The camera looks
down from 35° and frames each level: as close as it can be with the arch, its tray, the centering's handle and the markers in
view, so a tall pointed arch pulls it back (`frameView`, src/game/desktop.ts).

Where the board goes (`src/scene/surface-chain.ts`, pure functions with their own tests): if the headset's scene data has a
table mesh or a horizontal plane at desk height within reach (25 to 85 cm below the eyes, centre at most 75 cm away, at least
30 × 20 cm) and not behind you (its centre within 100° of the way you face, or under your head), the board goes on it, scene
meshes first. On that desk the board stands 50 cm ahead of your eyes, facing the way you face, as long as its centre is then at
least 10 cm in from every edge of the desk (on its middle line, if the desk is only 20 cm deep). If not, the centre moves to the
nearest point that is, and the board turns to face you from there: a desk off to one side gets the board on it, square to you,
rather than in the air in front of you. A real table is rarely square to the headset's floor axes, so the desk's top is the
smallest rectangle round its mesh vertices or plane outline seen from above, turned the way the table stands; the size test, the
10 cm margin and the move onto the desk all work in that rectangle (unit tests: a 1.2 × 0.6 m desk turned 30° or 45° keeps the
board's centre inside its margin for every way you face, and a 0.6 × 0.15 m shelf turned 45° is still too narrow to count).
The table in the emulator's synthetic office stands half a degree off square to the room's axes, so the turned case is covered
by those tests alone. If no desk turns up within 1.5 s and hit-test is available, a ring follows
your hand's ray over real surfaces and you pinch to pick a spot on your desk; a spot at floor or shelf height is refused. After
9.5 s with no pick, or without hit-test, the board sits on a lap tray 40 cm in front of you, 42 cm below the eyes. A lap tray or
a picked spot gives way if a real desk is detected before the first stone goes down; after that the board stays put. In an
opaque VR session (no passthrough) you sit in the atelier, a plain virtual room with a walnut desk, a shelf and a window.

The chain has run on room data in the emulator, not yet on a headset. With Meta's synthetic office room loaded into IWER
(`?emulator=1&room=office_small`, the emulated headset at a seated eye height of 1.15 m), the session reported ten planes
(walls, floor, ceiling, door, window, wall art and a table) and four meshes (table, screen, plant and the room's overall mesh).
The table mesh passed the desk test and the board went onto it, 40 cm below the eyes; `?autotest=w1-1:hold` then built the
arch there and it held, with no console error and no request to another origin (headless Chromium, 15 October 2026).
Turning the emulated head in the same room (`&head=<yaw>`, eyes at 1.15 m, 17 October 2026): facing the table (0°), the board
went onto the table mesh with its centre 10 cm in from the table's near edge; turned 90° left or right, with the table's centre
85° to 95° off to one side, the board went onto the table there, turned to face the player; turned round (180°), the table
behind was skipped and, with no pick, the board went to the lap tray. `?autotest=w1-1:hold` held in all four, with no console
error and no request to another origin.

When an arch falls on a detected desk, the stones land on that desk: the collapse gets one static box the size of the desk's
top, turned as the desk stands, besides the board, the piers and the floor (the atelier's walnut desk gets the same; the lap
tray and the browser's desk do not). Once every falling stone has been slower than 2 cm/s for half a second, or 6 s after the
strike, `__archwright.collapse.rest` counts where they lie: on the board, on the desk, or below. In IWER with the synthetic
office room (17 October 2026), the trap of w1-1 and of w3-1 each brought 5 stones down, all 5 coming to rest on the board
(after 2.4 and 2.9 s); the trap of w3-5 brought 7 down, 6 on the board and 1 on the table beside it. None went below the table.
The table there was read as a 1.60 × 0.75 m top turned half a degree from the room's axes. In the emulated VR atelier, w3-1's
5 stones all stayed on the board; in the browser, with no desk collider, 4 of 5 stayed on the board and 1 fell to the floor.

## The desk museum

Finish every level of a world and a stone plinth appears behind the board, with a small copy of that world's last arch on it.
The copy is your own arch: the save keeps, with your best stone count on each level, the arrangement that did it (each
stone's place in the tray and its side, a few bytes). A save from before that was kept, or one that no longer fits the
level, shows the level's reference solution instead. Plinths stand in a row 7 cm behind the board, from its back corners outwards, left
and right in turn, 10 cm apart; a new one never moves the others. Each plinth is one mesh (block, piers and stones welded
together, colours per vertex), so a full museum of eight costs eight draw calls. A solved monument level (below) gets its own
plinth, in level order right after its world's, with its plaque cut into the block's front (one more draw call).

In a mixed reality session where the headset grants anchors (an optional WebXR feature; Archwright never requires it), each
plinth is also tied to a persistent anchor once the board is in place and the first stone is down, and the anchor's handle
is saved (`archwright.museum.v1`). Next time, the saved anchors are restored and the plinths stand where they stood in your
room, wherever the board goes. An anchor that is not back within 3 s is deleted and its plinth returns to the row beside the
board (a slow frame, such as the one that enters XR, counts as at most 0.1 s of that wait). Without anchors, and in the browser,
the plinths simply follow the board. In IWER with the synthetic office room, the world 1 plinth got an anchor and a
persistent handle once the first stone was down, and after a page reload in the same browser the next session restored it.
The anchor path has not been run on a headset yet.

## Monuments

Worlds 1 and 2 each end with a level shaped after a real bridge. A small stone plaque lies on the desk in front of the board,
and the monument's museum plinth carries the same two lines:

| Level | Plaque | Arch in the game | Sources |
|---|---|---|---|
| after w1-5 | Ponte di Tiberio · Rimini · AD 14–21<br>semicircular arches · longest span ≈ 10.6 m | semicircle, 9 courses | [Wikipedia: Ponte di Tiberio (Rimini)](https://en.wikipedia.org/wiki/Ponte_di_Tiberio_(Rimini)) |
| after w2-5 | Malabadi Bridge · Silvan, Diyarbakır · c. 1147–1154<br>pointed arch · span ≈ 38.6 m | pointed, rise/span 0.67, 11 courses | [TDV İslâm Ansiklopedisi: Köprü](https://islamansiklopedisi.org.tr/kopru), [Wikipedia: Malabadi Bridge](https://en.wikipedia.org/wiki/Malabadi_Bridge) |

The spans are approx. values taken from the sources above (the Tiberio figure is its longest of five arches). Nothing else
about either bridge is claimed: no height, and the game scale is not the real scale. Each level keeps the board's size, about
a third of a metre across, and only the arch's shape follows the bridge. Malabadi's rise-to-span ratio in the game is a design
choice, not the bridge's real proportion. Both levels are solver-checked like the others: the reference solution holds, the
trap closes the arch and falls. The data and plaque text live in `src/levels/monuments.ts`.

## Accessibility

Three settings, each switched by an icon on a small stone panel off the board's front left corner (no text: an eye, a hand, a
half-filled disc). A lit, raised icon is on. Pinch it, click it in desktop mode, or look at it and pinch in gaze mode. The
choice is saved on the device (`archwright.a11y.v1` in localStorage); `?a11y=gaze,onehand,contrast` turns settings on from
the address.

- **Gaze.** For players who cannot reach or carry a stone. The head's ray picks the target, and a pinch of either hand (or a
  controller trigger) confirms it, wherever the hand is. A thin ring sits on whatever is looked at: a stone that can be taken,
  an open end for the stone already picked up, the centering's handle, the rebuild stone, a level marker, the share tablet or a
  panel icon. Stones follow the same two steps as the desktop mouse mode (the code is shared, `src/systems/select.ts`): the
  picked stone rises off the tray with a ghost at each open end, and looking at an end and pinching seats it there. To strike,
  look at the centering's handle and keep the pinch for 0.8 s; the centering slides out while you hold. This is head gaze
  (where the head points), not eye tracking. A pinch made while looking at nothing still works as a normal hand pinch.
- **One hand.** Nothing in Archwright needs two hands, with or without this setting. Each of these takes one pinch of one
  hand: taking a stone from the tray, carrying it and letting go at an open end, taking the outermost stone back off,
  pulling the centering, the rebuild stone, the level markers, the share tablet, the panel icons, and picking a spot on the
  desk when no table is detected. The setting adds one thing: pinch the centering's handle and hold it for 0.8 s and it pulls
  itself out, so the strike does not need a 10 cm pull towards you. There is no time limit anywhere in the game.
- **High contrast.** The scene is repainted at once with a second palette (`HIGH_CONTRAST` in `src/scene/palette.ts`):
  near-white tuff, orange sandstone and near-black basalt, violet timber, a navy desk and a sky-blue line of thrust. It looks
  unnatural on purpose. Stones keep their chisel marks and chamfered edges, the centering its planks, so colour is never the
  only cue.

What we measured, and what we did not. The two palettes are checked by a test (`tests/palette.test.ts`) with CIE ΔE76 colour
differences, the same differences under a simulation of protanopia, deuteranopia and tritanopia
(Machado, Oliveira and Fernandes 2009, full severity), and the WCAG luminance contrast ratio between the three stones:

| | stone / stone ΔE | stone / timber ΔE | worst pair, colour-blind simulation | stone contrast ratio |
|---|---|---|---|---|
| normal palette | 35.5 | 38.0 | 25.4 | 2.32 |
| high contrast | 80.7 | 120.1 | 51.9 | 3.97 |

The gaze pick (a ray against a sphere round each target, nearest hit within 1.5 m) and the hold-to-strike timing have unit
tests. The gaze and one-hand modes have not been tried on a headset yet, nor with players who need them; we have no
user-study numbers to report.

## Clean pause

When the headset's system menu comes up (the XR session turns `visible-blurred`), the headset comes off (`hidden`) or the tab
is hidden, the game stops: every system that runs game time (the surface pick, grabbing, the centering, the verdict, the
collapse, the passer-by, level changes, the first-minute cues, the museum's anchor wait, the autotest) and Havok skip their
update, and the sound is suspended, a collapse's score included. Drawing goes on. Back in view, the first frame steps at most
0.1 s, so nothing jumps by the time spent away. In IWER (17 October 2026), w3-1's trap was collapsing in the VR atelier when
the emulated session was set to `visible-blurred`: the game paused, the collapse's clock stayed at 1.398 s over 1.5 s of
waiting and the sound was suspended; set back to `visible`, it went on (3.19 s 1.5 s later) and the 5 stones came to rest on
the board, with no console error.

## Sound

The arch is a lithophone, a set of tuned stones. Each stone rings one note when it lands, picked by where it sits in the ring:
the stones at the feet are low, each course nearer the crown is higher, and the keystone is the highest, C6. The two sides are
mirrors, so the same course on the left and on the right is the same note. The notes come from a C major pentatonic scale
(C3 to C6, equal temperament, A4 = 440 Hz). A pentatonic scale has no semitone and no tritone, so whichever stones you place,
in whatever order, they never clash. When the centering comes out, its timber creaks and the creak rises as the stones take the
load. A held arch rings every one of its stones, low to high, as one chord. A failing one cracks first, then the stones grind on
their joints, each one thuds as it lands, and pebbles skitter after them; this score lasts at most 3.5 s and never has more
than 16 sounds at once. The same arch always falls with the same sound: the score is drawn from a seed (the level's id) and the number of stones.

What to play is plain data (`src/audio/music.ts`, with unit tests); `src/audio/synth.ts` only plays it with the Web Audio API.
Every sound is synthesised in code: a stone is a sine with the two overtones of a struck bar (2.76 and 5.40 times the
fundamental), the rest is filtered noise and short tones. There are no recordings, of stone, wood or anything else. Sound only
starts after a click, a key, a pinch or the start of an XR session, and it waits while the game is paused (see Clean pause).
Every sound goes through one master gain and a limiter before the speakers (a compressor at −6 dB, hard knee, 20:1, 3 ms
attack, 100 ms release), so a pile of collapse voices cannot clip.

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
npm run build && npm run browser-check   # headless Chromium + IWER checks of the built site
```

`npm run browser-check` runs the scripts in `scripts/browser/` one after another in headless Chromium with software WebGL:
autotest and real mouse play on the desktop, emulated AR and VR sessions, the synthetic office room, the emulated hand, the
first-minute lesson and the performance budget, each also failing on any console error. Reports and screenshots land in
`browser-reports/`; the numbers are from the emulator, not from a headset (details in `scripts/browser/README.md`).

On a Quest, open the hosted page in the Quest Browser and accept its offer to enter AR. Hand tracking, plane detection, anchors, hit-test
and mesh detection are all requested as optional features, so the session starts on any setup.

URL parameters, for development and tests:

| Parameter | Effect |
|---|---|
| `?level=w1-2` | start on another level (`w1-1` to `w1-5`, pointed arches `w2-1` to `w2-5`, loads `w3-1` to `w3-5`) |
| `?level=today` | Today's Span for the local date; `?level=daily-2026-11-05` opens another day's (also `?autotest=today:hold`) |
| `?emulator=1` | install IWER, Meta's WebXR emulator, so a desktop browser can run an XR session |
| `?emulator=1&autoxr=ar` | with the emulator only: the page requests the XR session itself (`ar` or `vr`), no click; ignored on a real headset |
| `?emulator=1&room=office_small` | with the emulator only: load Meta's synthetic office room (`@iwer/sem`), so an AR session sees walls, floor and a table as planes and meshes; the room file comes from this site |
| `?emulator=1&head=90,1.6` | with the emulator only: the emulated headset starts turned by that many degrees (positive turns left) with its eyes that many metres above the floor (default 0°, 1.15 m) |
| `?surface=lap` | force a surface in an XR session: `mesh`, `plane`, `pick`, `lap` or `atelier` |
| `?a11y=gaze,contrast` | turn accessibility settings on: `gaze`, `onehand`, `contrast` (saved ones stay on) |
| `?debug=1` | show the performance numbers: a text box in the page corner, or a small slate on the desk in an XR session (see Performance) |
| `?autotest=w1-1:hold` | place the level's solution (`hold`) or its trap (`collapse`) by program and pull the centering; runs can be chained with `;` |

`window.__archwright` exposes the state (`loading`, `ready`, `building`, `held`, `collapsed`), the level, the surface the board
stands on (`surface`: `desk` outside XR, else `mesh`, `plane`, `pick`, `lap` or `atelier`) and frame numbers
(fps, JS ms per frame, draw calls, triangles, physics bodies). The `?autotest` mode goes through the same placement and strike
code as a hand, but it is not a hand simulation. For desktop-mode tests the hook also has `placed` (stones seated),
`debug.solution` (the level's solution as steps) and `project(target)`, which gives a stone id, `'face:left'`, `'face:right'`,
`'lever'`, `'crown'` (the top of the arch's back), `'abutment:left'`, `'abutment:right'` (an abutment's top face), `'tablet'`,
`'marker:today'` or a panel icon (`'a11y:gaze'`, `'a11y:onehand'`, `'a11y:contrast'`) as a point on the
page in CSS pixels, so a test can click it with real mouse events. `a11y` holds the accessibility settings in force.
On a daily level `daily` holds the day's number and, once the arch is struck, its share card.
`xr` gives the session mode (`immersive-ar`, `immersive-vr`, or null outside XR), its enabled WebXR features, its input
profiles, the emulator room (`room`) and the head (`head`: where the eyes are and the yaw they face, in degrees, every XR frame).
`detected` lists the semantic label of every plane and mesh the session reports, `board` where the board went (surface kind, its
top, how far below the eyes, the board's centre and, on a detected desk, that desk's top: its own rectangle as `cx`, `cz`,
`width`, `depth` and `yaw`, and the world box round it as `minX` to `maxZ`), and `museum` the
plinths, how many follow an anchor and this session's anchor counts (requested, created, persisted, failed, restored, lost).
`collapse` holds the last collapse's `rest` and `simTime` (the game seconds it has run), `paused` whether the game is paused
now and `pauses` how often it has paused, and `audio` the sound's state (`none` before it starts, then the AudioContext's) and
whether the limiter is in. `hover` is the id of the stone a pinch (or, outside XR, a click) would take now, or null.
With `?emulator=1` the hook also has `emulator`, whose `setVisibility(state)`, `aim(hand, point)` and `pinch(hand, value)` set
the emulated session's visibility, turn a hand's or controller's ray to a point, and pinch (a controller's trigger). The XR smoke
test opens `?emulator=1&autoxr=ar&autotest=w1-1:hold` and `?emulator=1&autoxr=vr`: a real (emulated) session, the surface
chain inside it, and in AR the autotest, which waits for the board to find its surface before the first stone goes down.

`node scripts/key-frames.mjs <dir>` opens the emulator page with `&shots=1`, which makes the autotest hold at seven moments
(tray, keystone held over its gap with the snap ghost, keystone seated, centering pulled, arch held, collapse half way, collapse at rest) and saves a screenshot of each.

## Performance

The budget, for a Quest 3/3S at 72 Hz: at most 60 draw calls per frame (100 while an arch collapses), 100k visible triangles,
40 physics bodies, no real-time shadows. The scene is built to stay well inside it: one instanced mesh per stone shape with one
shared material, the two piers in one mesh and each museum plinth in one mesh, level markers as two instanced meshes,
a blob shadow instead of a shadow map, and the collapse capped at 40 bodies (the static board, piers, desk and floor colliders count
towards it too). Stones are low-poly prisms of a few dozen triangles.

`?debug=1` shows the numbers while you play: frames per second, JS time per frame (the game's systems and the solver, not the
GPU), draw calls and triangles of the last frame (from three.js `renderer.info`), physics bodies, the XR session's enabled
features, detected planes and their labels, museum anchors and page visibility. A number over the budget turns red. On the
desktop it is a text box in the page corner; in an XR session, where a page cannot be seen, the same lines are on a small slate
standing on the desk behind the board's right corner (part of the room, not fixed to your head; it adds one draw call). The same
numbers are in `window.__archwright.perf` every frame, in XR as well.

What has been checked, and where: draw calls, triangles and bodies do not depend on the device, so they are counted in headless
Chromium with the XR emulator for four desktop cases (w1-1 ready, w3-5 standing, w3-5 collapsing, a full museum) and one
emulated VR collapse. The same run was done twice, with software WebGL on a server and on a desktop RTX 3060. Neither is a
headset: no Quest frame rate is claimed here, and none has been measured.

First load: `npm run build` prints the size of everything a visit can download before the first stone goes down and writes it to
`dist/first-load.json` (`scripts/first-load.mjs`). It counts every chunk and worker of the build (an upper bound) except what only
loads on demand: Havok's physics (about 2 MB, fetched when the first stone is placed), the emulator (`?emulator=1` only), its
synthetic room module and room file (`?emulator=1&room=` only), code that only those import, and the controller and hand
profiles (XR input only). Budget 8 MB. The build of 15 October 2026: 7.50 MB (7,496,504 bytes; 2.01 MB gzip) in 9 files,
of which the main chunk is 6.75 MB.

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
- `src/scene/`, `src/audio/`: procedural meshes and synthesised sounds (`music.ts` decides the notes and the collapse score,
  `synth.ts` plays them). There are no model, texture or sound files.
- `src/systems/`: ECS systems (an ECS, entity-component system, keeps data in components and behaviour in systems that run every
  frame): hand tracking and pinch, grab and snap, the centering, the strike, the collapse, the surface finder, the desktop mouse
  mode, the accessibility panel and gaze mode, the desk museum, rendering. The mouse mode picks through IWSDK's canvas pointer events on `RayInteractable` entities, not a raycaster of
  its own.

Every stone is drawn by one instanced mesh per stone shape with a single material, and shadows are a soft blob under the board,
not real-time shadow maps. Havok's physics WASM is not part of the first load: it is fetched when the first stone is placed.
Nothing is fetched from another origin. Four defaults in the libraries would do it, and each is redirected
(`src/net/local-assets.ts`):

- Controller and hand models (the input layer would take them from jsDelivr): the WebXR input profiles of the Quest controllers
  and of tracked hands are copied into `public/input-profiles/` and served from this site, each model found through its own
  `profile.json`. A controller has its model in both modes; a hand only in opaque VR, since passthrough shows the real hand.
- Draco and KTX2 decoders (the glTF loader would take them from unpkg): not used, no model here is compressed that way, so no
  decoder is shipped and the decoder path points into this site.
- The UI kit's Avatar picture (from DiceBear): no avatar is ever drawn, and the default is blanked.
- The emulator's synthetic rooms (development only, `?emulator=1&room=`; the room module would take them from unpkg or bundle
  all five, 4.5 MB): the one room used is copied into `public/emulator/rooms/` and handed to the module; the build empties the
  module's table of built-in rooms and points its own loader's address into this site.

The build rewrites those four library defaults and fails if the output still names any of those hosts.

## Built with

[Immersive Web SDK](https://iwsdk.dev) (MIT), three.js (MIT), Havok physics via IWSDK (MIT), WebXR input profiles (MIT,
controller and hand models). Third-party assets are listed in
[ASSETS.md](ASSETS.md).

## License

MIT. See [LICENSE](LICENSE).
