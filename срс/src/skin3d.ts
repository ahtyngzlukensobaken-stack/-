import { IdleAnimation, SkinViewer } from 'skinview3d';
import { api } from './api.js';
import { el } from './ui.js';



let viewer: SkinViewer | null = null;
let canvas: HTMLCanvasElement | null = null;
let shownAccount = '';
let watch = 0;

function setup(width: number, height: number): SkinViewer {
  canvas = el('canvas', { class: 'pw-skin', title: 'Покрути мышкой' });
  const next = new SkinViewer({ canvas, width, height });
  next.fov = 30;
  next.zoom = 0.78;
  next.controls.enableZoom = false;
  next.controls.enablePan = false;
  
  next.playerObject.rotation.y = 0.6;
  const distance = next.camera.position.length();
  next.camera.position.set(0.22, 0.2, 1).normalize().multiplyScalar(distance);
  next.controls.update();
  next.globalLight.intensity = 2.4;
  next.cameraLight.intensity = 1.3;
  next.animation = new IdleAnimation();
  
  watch = window.setInterval(() => { next.renderPaused = !canvas?.isConnected; }, 1000);
  return next;
}


export function skin3d(accountId: string | undefined, width = 116, height = 196): HTMLElement {
  if (!viewer) viewer = setup(width, height);
  viewer.renderPaused = false;
  if (accountId && accountId !== shownAccount) {
    shownAccount = accountId;
    const target = viewer;
    void api.currentSkin(accountId)
      .then((skin) => (skin && shownAccount === accountId
        ? target.loadSkin(skin.dataUrl, { model: skin.model === 'slim' ? 'slim' : 'default' })
        : undefined))
      .catch(() => undefined);
  }
  return canvas!;
}


export function forgetSkin3d(): void {
  shownAccount = '';
}


window.addEventListener('beforeunload', () => {
  window.clearInterval(watch);
  viewer?.dispose();
});
