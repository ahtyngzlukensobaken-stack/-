import type { Instance } from './api.js';



export type ThemeId = 'cosmos' | 'quiet' | 'light' | 'game' | 'power';

export interface Theme {
  id: ThemeId;
  name: string;
  note: string;
  
  accent: string;
  
  background: string;
  
  layout: 'side' | 'top' | 'rail';
}

export const THEMES: Theme[] = [
  { id: 'power', name: 'Power', note: 'Обложки из твоих скриншотов, друзья и 3D-скин', accent: '#8b6cff', background: '#0b0a10', layout: 'rail' },
  { id: 'cosmos', name: 'Космос', note: 'Стекло, звёзды и неон. Как было раньше', accent: '#b18cff', background: '#06050d', layout: 'side' },
  { id: 'quiet', name: 'Тихая', note: 'Тёмная и спокойная, ничего лишнего', accent: '#8f7bff', background: '#0d0d12', layout: 'side' },
  { id: 'light', name: 'Светлая', note: 'Светлая и дружелюбная, крупные карточки', accent: '#6d5cf6', background: '#f4f2fa', layout: 'top' },
  { id: 'game', name: 'Игровая', note: 'Ночной пиксельный пейзаж и большая кнопка', accent: '#3ccf7a', background: '#120d26', layout: 'top' },
];

export function themeOf(id: string | undefined): Theme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0]!;
}


export function applyTheme(id: string): void {
  const theme = themeOf(id);
  if (document.body.dataset.theme === theme.id) return;
  document.body.dataset.theme = theme.id;
  
  document.body.classList.toggle('flat', theme.id !== 'cosmos');
  if (theme.id === 'game') mountScene();
  else document.querySelector('.scene')?.remove();
}




function seeded(seed: number): () => number {
  let s = seed % 233280;
  return () => (s = (s * 9301 + 49297) % 233280) / 233280;
}

function hash(text: string): number {
  let h = 7;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 1_000_003;
  return h;
}

interface Palette {
  sky: [string, string, string];
  sun: string; far: string; grass: string; dirt: string; stone: string; leaf: string; wood: string; cloud: string;
  stars?: boolean;
}

const PALETTES: Record<string, Palette> = {
  day: { sky: ['#6fb8ff', '#a8d8ff', '#d6efff'], sun: '#fff6c8', far: '#7fb6a0', grass: '#5fb24a', dirt: '#7a5230', stone: '#8c8c8c', leaf: '#3e8f3a', wood: '#6b4626', cloud: '#ffffff' },
  mint: { sky: ['#7fe0d0', '#b8f0e2', '#e4fbf3'], sun: '#ffffff', far: '#6cc2a6', grass: '#4fae6a', dirt: '#6d5a3c', stone: '#9aa39f', leaf: '#2f8a58', wood: '#5d4630', cloud: '#ffffff' },
  sunset: { sky: ['#ff8a6b', '#ffb36b', '#ffd98a'], sun: '#fff1b8', far: '#b0577a', grass: '#7a3f74', dirt: '#4b2a4e', stone: '#6b4a6e', leaf: '#5a2d5c', wood: '#3a2140', cloud: '#ffd2c2' },
  dusk: { sky: ['#2b1d5e', '#6a3f97', '#d0709e'], sun: '#f3eefc', far: '#4a2f7a', grass: '#36245e', dirt: '#24183f', stone: '#2f2152', leaf: '#2a1b4d', wood: '#1d1338', cloud: '#e9dcff', stars: true },
  night: { sky: ['#0d1430', '#1c2a5c', '#34508a'], sun: '#e8f0ff', far: '#22325e', grass: '#1f3a4a', dirt: '#16243a', stone: '#24304a', leaf: '#15283a', wood: '#101a2a', cloud: '#9fb4e0', stars: true },
};


const MOODS: Record<string, string[]> = {
  cosmic: ['dusk', 'night'],
  kawaii: ['sunset', 'dusk'],
  aurora: ['day', 'mint'],
};

function drawLandscape(width: number, height: number, palette: Palette, seed: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  if (!g) return '';
  const r = seeded(seed);
  const fill = (color: string, x: number, y: number, w = 1, h = 1): void => { g.fillStyle = color; g.fillRect(x, y, w, h); };

  
  for (let y = 0; y < height; y++) fill(palette.sky[Math.min(2, Math.floor((y / height) * 3.2))]!, 0, y, width, 1);
  if (palette.stars) {
    for (let i = 0; i < (width * height) / 110; i++) {
      fill(`rgba(255,255,255,${(.35 + r() * .55).toFixed(2)})`, Math.floor(r() * width), Math.floor(r() * height * .3));
    }
  }
  const sun = Math.max(2, Math.round(height * .16));
  fill(palette.sun, Math.round(width * (.6 + r() * .25)), Math.round(height * .12), sun, sun);
  for (let i = 0; i < 2; i++) {
    const w = Math.round(width * (.12 + r() * .1));
    const x = Math.floor(r() * width);
    const y = Math.round(height * (.15 + r() * .2));
    g.globalAlpha = palette.stars ? .25 : .85;
    fill(palette.cloud, x, y, w, 1);
    fill(palette.cloud, x + 1, y - 1, Math.max(1, w - 3), 1);
    g.globalAlpha = 1;
  }

  // Дальние холмы ступеньками.
  let far = height * .5;
  for (let x = 0; x < width; x += 3) {
    far = Math.min(height * .62, Math.max(height * .36, far + (r() - .5) * 4));
    fill(palette.far, x, Math.round(far), 3, height);
  }

  // Ближняя земля: трава сверху, под ней земля с камешками. Высоту запоминаем, чтобы
  // деревья встали точно на траву, а не висели над ней.
  let ground = Math.round(height * .7);
  const tops: [number, number][] = [];
  for (let x = 0; x < width; x += 2) {
    if (r() < .3) ground = Math.min(height - 3, Math.max(Math.round(height * .6), ground + (r() < .5 ? -1 : 1)));
    fill(palette.dirt, x, ground, 2, height);
    fill(palette.grass, x, ground, 2, 1);
    tops.push([x, ground]);
    if (r() < .25) fill(palette.stone, x, ground + 2 + Math.floor(r() * (height - ground)), 1, 1);
  }
  for (let i = 0; i < Math.max(1, Math.round(width / 22)); i++) {
    const [x, y] = tops[Math.floor(r() * tops.length)]!;
    const trunk = 2 + Math.floor(r() * 2);
    fill(palette.wood, x, y - trunk, 1, trunk);
    fill(palette.leaf, x - 2, y - trunk - 3, 5, 3);
    fill(palette.leaf, x - 1, y - trunk - 4, 3, 1);
  }
  return canvas.toDataURL();
}

/** Готовые картинки по сборке и размеру: экраны перерисовываются часто, а рисовать заново незачем. */
const arts = new Map<string, string>();

/**
 * Пиксельный пейзаж сборки как адрес картинки. small - для значков (меньше клеток, пиксели крупнее).
 * У сборки с обложкой - её обложка.
 */
export function instanceArt(instance: Pick<Instance, 'id' | 'accent' | 'coverUrl'>, small = false): string {
  if (instance.coverUrl) return instance.coverUrl;
  const key = `${instance.id}:${instance.accent}:${small ? 's' : 'b'}`;
  let url = arts.get(key);
  if (!url) {
    const seed = hash(instance.id);
    const moods = MOODS[instance.accent] ?? MOODS.cosmic!;
    const palette = PALETTES[moods[seed % moods.length]!]!;
    url = small ? drawLandscape(16, 16, palette, seed) : drawLandscape(64, 36, palette, seed);
    arts.set(key, url);
  }
  return url;
}

// ---------------------------------------------------------------- пейзаж «Игровой»

const SVG = 'REDACTED_ENDPOINT';
const W = 1400;
const H = 800;

interface Step { x: number; w: number; y: number }

/** Холмы ступеньками: список площадок с x, шириной и высотой. Все размеры кратны клетке 20. */
function hills(r: () => number, top: number, bottom: number): Step[] {
  const steps: Step[] = [];
  for (let x = -60; x < W + 60;) {
    const w = 60 + Math.floor(r() * 5) * 20;
    steps.push({ x, w, y: top + Math.floor(r() * ((bottom - top) / 20 + 1)) * 20 });
    x += w;
  }
  return steps;
}

function hillPath(steps: Step[]): string {
  return `M-60 ${H + 40}` + steps.map((s) => `L${s.x} ${s.y}L${s.x + s.w} ${s.y}`).join('') + `L${W + 60} ${H + 40}Z`;
}

function svgLayer(depth: number, align: 'YMax' | 'YMin', body: string): HTMLElement {
  const layer = document.createElement('div');
  layer.className = 'scene-layer';
  layer.dataset.depth = String(depth);
  layer.innerHTML = `<svg xmlns="${SVG}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMid${align} slice" shape-rendering="crispEdges">${body}</svg>`;
  return layer;
}

function tree(x: number, ground: number, size: number, color: string): string {
  const trunk = 4 * size;
  const crown = 14 * size;
  return `<rect x="${x - size}" y="${ground - 16 * size}" width="${trunk / 2}" height="${16 * size}" fill="${color}"/>`
    + `<rect x="${x - crown / 2}" y="${ground - 16 * size - 12 * size}" width="${crown}" height="${12 * size}" fill="${color}"/>`
    + `<rect x="${x - crown / 4}" y="${ground - 16 * size - 17 * size}" width="${crown / 2}" height="${5 * size}" fill="${color}"/>`;
}

/**
 * Ночной пиксельный пейзаж за окном «Игровой». Слои - отдельные элементы: двигаются они через
 * transform, и это делает видеокарта, не перерисовывая сам рисунок. Деревья и домик ставятся
 * на высоту земли под ними, поэтому не висят в воздухе.
 */
function buildScene(): HTMLElement {
  const r = seeded(20261002);
  const scene = document.createElement('div');
  scene.className = 'scene';

  const sky = document.createElement('div');
  sky.className = 'scene-sky';
  scene.append(sky);

  // Звёзды: неподвижные одним рисунком, а мерцают отдельно только два десятка, чтобы
  // анимация трогала немного элементов.
  let stars = '';
  for (let i = 0; i < 70; i++) {
    const size = r() < .2 ? 3 : 2;
    stars += `<rect x="${Math.round(r() * W)}" y="${Math.round(r() * 330)}" width="${size}" height="${size}" fill="#fff" opacity="${(.35 + r() * .5).toFixed(2)}"/>`;
  }
  const starLayer = svgLayer(4, 'YMin', stars);
  for (let i = 0; i < 18; i++) {
    const star = document.createElement('i');
    star.className = 'scene-star';
    star.style.cssText = `left:${(r() * 100).toFixed(1)}%;top:${(r() * 38).toFixed(1)}%;animation-delay:${(-r() * 4).toFixed(1)}s;animation-duration:${(2.6 + r() * 3).toFixed(1)}s`;
    starLayer.append(star);
  }
  scene.append(starLayer);

  scene.append(svgLayer(7, 'YMin',
    `<defs><radialGradient id="moon-glow"><stop offset="0" stop-color="#f6f0ff" stop-opacity=".42"/><stop offset="1" stop-color="#f6f0ff" stop-opacity="0"/></radialGradient></defs>`
    + `<circle cx="${W * .64}" cy="150" r="100" fill="url(#moon-glow)"/>`
    + `<g transform="translate(${W * .64 - 40} 110)"><rect width="80" height="80" fill="#f3eefc"/><rect x="14" y="16" width="16" height="16" fill="#dcd3f0"/><rect x="48" y="40" width="20" height="20" fill="#dcd3f0"/><rect x="22" y="52" width="10" height="10" fill="#dcd3f0"/></g>`));

  // Облака плывут сами, каждое своим отдельным элементом.
  for (const [top, width, duration, delay] of [[18, 200, 120, -40], [30, 260, 160, -110], [12, 140, 140, -80]] as const) {
    const cloud = document.createElement('i');
    cloud.className = 'scene-cloud';
    cloud.style.cssText = `top:${top}%;width:${width}px;animation-duration:${duration}s;animation-delay:${delay}s`;
    scene.append(cloud);
  }

  const far = hills(r, 380, 460);
  let farTrees = '';
  for (const step of far) {
    if (step.w >= 100 && r() < .45) farTrees += tree(step.x + step.w / 2, step.y, 1.6, '#33215c');
  }
  scene.append(svgLayer(14, 'YMax',
    `<defs><linearGradient id="fog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e48bbd" stop-opacity="0"/><stop offset="1" stop-color="#e48bbd" stop-opacity=".3"/></linearGradient></defs>`
    + `<path d="${hillPath(far)}" fill="#3d2769"/>${farTrees}<rect x="-60" y="360" width="${W + 120}" height="220" fill="url(#fog)"/>`));

  // Средний план: на одной площадке, подходящей по ширине, ровно стоит домик, на других - деревья.
  const mid = hills(r, 480, 540);
  const center = mid.reduce((best, step) =>
    Math.abs(step.x + step.w / 2 - W * .52) < Math.abs(best.x + best.w / 2 - W * .52) ? step : best);
  center.w = Math.max(center.w, 160);
  let next = center.x + center.w;
  for (const step of mid.slice(mid.indexOf(center) + 1)) { step.x = next; next += step.w; }
  let midThings = '';
  const hx = center.x + center.w / 2 - 48;
  const hy = center.y;
  midThings += `<g><rect x="${hx}" y="${hy - 60}" width="96" height="60" fill="#1a1131"/>`
    + `<path d="M${hx - 10} ${hy - 58}l58-38 58 38z" fill="#24183f"/>`
    + `<rect class="scene-lamp" x="${hx + 18}" y="${hy - 42}" width="20" height="18" fill="#ffd27a"/>`
    + `<rect class="scene-lamp scene-lamp-2" x="${hx + 58}" y="${hy - 42}" width="20" height="18" fill="#ffd27a"/>`
    + `<rect x="${hx + 40}" y="${hy - 28}" width="16" height="28" fill="#0f0a1e"/></g>`;
  for (const step of mid) {
    if (step === center || step.w < 80) continue;
    if (r() < .55) midThings += tree(step.x + step.w / 2, step.y, 3, '#1d1338');
  }
  scene.append(svgLayer(22, 'YMax', `<path d="${hillPath(mid)}" fill="#27194a"/>${midThings}`));

  scene.append(svgLayer(32, 'YMax', `<path d="${hillPath(hills(r, 640, 680))}" fill="#150e29"/>`));
  return scene;
}

let parallaxBound = false;

function mountScene(): void {
  if (document.querySelector('.scene')) return;
  const scene = buildScene();
  document.body.prepend(scene);
  if (parallaxBound) return;
  parallaxBound = true;
  // Слои чуть сдвигаются за мышкой, ближние сильнее дальних - получается объём. Не чаще раза
  // за кадр; в «Лёгком режиме» и без фокуса окна (человек в игре) не двигаем вовсе.
  let queued = false;
  let mx = 0;
  let my = 0;
  window.addEventListener('pointermove', (event) => {
    mx = event.clientX / window.innerWidth - .5;
    my = event.clientY / window.innerHeight - .5;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const body = document.body;
      if (body.dataset.theme !== 'game' || body.classList.contains('lite') || body.classList.contains('idle')) return;
      for (const layer of document.querySelectorAll<HTMLElement>('.scene-layer')) {
        const k = Number(layer.dataset.depth);
        layer.style.transform = `translate3d(${(-mx * k).toFixed(1)}px, ${(-my * k * .4).toFixed(1)}px, 0)`;
      }
    });
  });
}
