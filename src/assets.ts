import { defineAssets } from '@iwsdk/core';
import { stoneBlock } from './scene-assets/stone-block.scene-asset.js';

// Every asset is procedural or served from this origin. No CDN, no third-party URLs.
export default defineAssets({
  'stone-block': stoneBlock,
});
