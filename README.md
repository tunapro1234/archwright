# Archwright

Archwright is a hands-first mixed reality puzzle for Meta Quest, played seated at a real desk. A half-built stone arch stands on
your table. You pinch wedge stones from a tray and seat them on its two open ends until the keystone closes the gap. Then you pull
the wooden centering out from under it by hand. Nothing is animated: a small rigid-block statics solver decides whether the arch
carries itself or collapses across your desk. No controllers are needed at any point.

> Status: early work in progress. The current build shows a single procedural stone at desk height.

## How to run

Requirements: Node.js 22.12+ (see `.nvmrc`).

```bash
npm install
npm run dev        # IWSDK dev server + managed browser with the IWER XR emulator
npm test           # unit tests (Vitest)
npm run typecheck  # TypeScript strict
npm run build      # static site in dist/, built for the /archwright/ sub-path
npm run preview    # serve dist/ at http://127.0.0.1:4173/archwright/
```

On a Quest, open the hosted page in the Quest Browser and press **Enter AR**. Hand tracking, plane detection, anchors, hit-test
and mesh detection are all requested as optional features, so the session starts on any setup.

## How the solver works

The verdict comes from `src/statics/`, a dependency-free TypeScript solver, not from the physics engine. It follows
Jacques Heyman's masonry model: stones are rigid, joints can push but never pull, and the stone never crushes. An arch stands
if at least one line of thrust (the path the compressive force takes from one support to the other) can be drawn in
equilibrium with the weights and still pass through every joint, without the joint slipping under friction. Three numbers
fix such a line, and every joint condition is linear in them, so the question becomes a tiny linear program that runs in
about a millisecond. The solver also picks the line farthest from the joint edges and reports which joints are closest to
opening; when the arch fails, those are the joints where the collapse hinges. As a check it reproduces Heyman's
classic result that a semicircular arch needs a ring at least about 0.107 of its radius thick.

Source: J. Heyman, *The Stone Skeleton: Structural Engineering of Masonry Architecture*, Cambridge University Press, 1995.

## Built with

[Immersive Web SDK](https://iwsdk.dev) (MIT), three.js (MIT), Havok physics via IWSDK (MIT). Third-party assets are listed in
[ASSETS.md](ASSETS.md).

## License

MIT. See [LICENSE](LICENSE).
