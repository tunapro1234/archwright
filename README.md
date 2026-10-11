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

## Built with

[Immersive Web SDK](https://iwsdk.dev) (MIT), three.js (MIT), Havok physics via IWSDK (MIT). Third-party assets are listed in
[ASSETS.md](ASSETS.md).

## License

MIT. See [LICENSE](LICENSE).
