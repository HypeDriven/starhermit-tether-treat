// post.js — three.js r160 addons used by the renderer (post-processing chain
// and the room environment for image-based lighting). Loaded lazily by
// render.js so the Low preset never fetches them, and so a failure here only
// disables the enhancements instead of the whole renderer.

export { EffectComposer } from '../vendor/addons/postprocessing/EffectComposer.js';
export { RenderPass } from '../vendor/addons/postprocessing/RenderPass.js';
export { ShaderPass } from '../vendor/addons/postprocessing/ShaderPass.js';
export { OutputPass } from '../vendor/addons/postprocessing/OutputPass.js';
export { GTAOPass } from '../vendor/addons/postprocessing/GTAOPass.js';
export { UnrealBloomPass } from '../vendor/addons/postprocessing/UnrealBloomPass.js';
export { SMAAPass } from '../vendor/addons/postprocessing/SMAAPass.js';
export { FXAAShader } from '../vendor/addons/shaders/FXAAShader.js';
export { RoomEnvironment } from '../vendor/addons/environments/RoomEnvironment.js';
