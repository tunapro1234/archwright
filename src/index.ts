import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';

// The XR session, its optional features and the scene all come from iwsdk.config.json.
// Only `local-floor` (falling back to `local`) is used as the reference space; every
// other WebXR feature is optional so the experience starts on any Quest setup.
World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
);
