import { api } from './api.js';
import { openBugfix } from './bugfix.js';
import { waveApplies } from './waves.js';
import { el } from './ui.js';



type Kind = 'soft' | 'crystal' | 'leaf' | 'oval' | 'bat' | 'heart' | 'petal' | 'sparkle' | 'balloon' | 'emoji' | 'confetti' | 'digit';
type Overlay = 'garland' | 'fog' | 'lightning' | 'shooting' | 'cannons';


interface Part { kind: Kind; weight: number; colors?: string[]; chars?: string[] }

interface Fx {
  parts: Part[];
  
  density: number;
  
  up?: boolean;
  overlays?: Overlay[];
}

interface Season {
  id: string;
  name: string;
  on: (date: Date) => boolean;
  fx?: Fx;
}



const between = (date: Date, from: [number, number], to: [number, number]): boolean => {
  const value = (date.getMonth() + 1) * 100 + date.getDate();
  const a = from[0] * 100 + from[1];
  const b = to[0] * 100 + to[1];
  return a <= b ? value >= a && value <= b : value >= a || value <= b;
};
const nearDay = (date: Date, target: Date, before: number, after: number): boolean => {
  const day = 86_400_000;
  const t = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const x = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return x >= t - before * day && x <= t + after * day;
};


function orthodoxEaster(year: number): Date {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  return new Date(year, month - 1, day + 13);
}


function thanksgiving(year: number): Date {
  const first = new Date(year, 10, 1).getDay();
  return new Date(year, 10, 1 + ((4 - first + 7) % 7) + 21);
}

const AUTUMN = ['#ff8c1a', '#e8541c', '#c43a1a', '#f2b01e', '#a8461c', '#d9781e'];
const PINKS = ['#ff9ec7', '#ffc2db', '#ffe3ef', '#ff7aae'];
const PARTY = ['#ff5f8f', '#9f86ff', '#50e7ad', '#ffd84d', '#58b8ff', '#ff9a3c'];

const SNOW: Part[] = [{ kind: 'soft', weight: 7 }, { kind: 'crystal', weight: 3 }];


export const SEASONS: Season[] = [
  {
    id: 'newyear', name: 'Новый год', on: (d) => between(d, [12, 28], [1, 6]),
    fx: { parts: [...SNOW, { kind: 'sparkle', weight: 1, colors: ['#ffe9a8', '#bfe3ff'] }], density: 110, overlays: ['garland'] },
  },
  {
    id: 'xmas-orthodox', name: 'Рождество (7 января)', on: (d) => between(d, [1, 7], [1, 7]),
    fx: { parts: [...SNOW, { kind: 'sparkle', weight: 2, colors: ['#ffe9a8'] }], density: 80, overlays: ['garland'] },
  },
  {
    id: 'xmas', name: 'Рождество (25 декабря)', on: (d) => between(d, [12, 22], [12, 27]),
    fx: { parts: [...SNOW, { kind: 'sparkle', weight: 2, colors: ['#ffe9a8', '#ffffff'] }], density: 90, overlays: ['garland'] },
  },
  {
    id: 'old-newyear', name: 'Старый Новый год', on: (d) => between(d, [1, 13], [1, 14]),
    fx: { parts: SNOW, density: 90, overlays: ['garland'] },
  },
  {
    id: 'winter', name: 'Зима', on: (d) => between(d, [12, 1], [12, 21]) || between(d, [1, 8], [1, 31]),
    fx: { parts: SNOW, density: 55 },
  },
  {
    id: 'valentine', name: '14 февраля', on: (d) => between(d, [2, 12], [2, 15]),
    fx: { parts: [{ kind: 'heart', weight: 5, colors: ['#ff4f7e', '#ff7aa8', '#e8336a'] }, { kind: 'petal', weight: 3, colors: PINKS }], density: 34, up: true },
  },
  {
    id: 'feb23', name: '23 февраля', on: (d) => between(d, [2, 22], [2, 23]),
    fx: { parts: [{ kind: 'sparkle', weight: 3, colors: ['#ffd84d', '#ffb347'] }, { kind: 'emoji', weight: 1, chars: ['⭐', '🛡️'] }], density: 26 },
  },
  {
    id: 'march8', name: '8 марта', on: (d) => between(d, [3, 7], [3, 8]),
    fx: { parts: [{ kind: 'petal', weight: 6, colors: PINKS }, { kind: 'emoji', weight: 1, chars: ['🌷', '🌸'] }], density: 40 },
  },
  {
    id: 'maslenitsa', name: 'Масленица', on: (d) => {
      const easter = orthodoxEaster(d.getFullYear());
      return nearDay(d, new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() - 55), 0, 6);
    },
    fx: { parts: [{ kind: 'emoji', weight: 2, chars: ['🥞'] }, { kind: 'sparkle', weight: 3, colors: ['#ffd27a', '#ffb347'] }, ...SNOW.map((p) => ({ ...p, weight: p.weight / 3 }))], density: 30 },
  },
  {
    id: 'aprilfools', name: '1 апреля', on: (d) => between(d, [4, 1], [4, 1]),
    fx: { parts: [{ kind: 'emoji', weight: 1, chars: ['🤡', '🙃', '😜'] }, { kind: 'confetti', weight: 3, colors: PARTY }], density: 26 },
  },
  {
    id: 'cosmonautics', name: 'День космонавтики', on: (d) => between(d, [4, 12], [4, 12]),
    fx: { parts: [{ kind: 'sparkle', weight: 6, colors: ['#ffffff', '#bfe3ff', '#d9ccff'] }, { kind: 'emoji', weight: 1, chars: ['🚀', '🪐'] }], density: 40, up: true, overlays: ['shooting'] },
  },
  {
    id: 'easter', name: 'Пасха', on: (d) => nearDay(d, orthodoxEaster(d.getFullYear()), 1, 1),
    fx: { parts: [{ kind: 'petal', weight: 4, colors: ['#fff6d8', '#ffe3ef', '#ffffff'] }, { kind: 'emoji', weight: 1, chars: ['🥚', '🐣'] }], density: 34 },
  },
  {
    id: 'may1', name: '1 мая', on: (d) => between(d, [5, 1], [5, 1]),
    fx: { parts: [{ kind: 'petal', weight: 5, colors: ['#ffd1e6', '#ffffff', '#fff0f6'] }, { kind: 'oval', weight: 2, colors: ['#7fd36a', '#a6e36b'] }], density: 38 },
  },
  {
    
    id: 'victory', name: 'День Победы', on: (d) => between(d, [5, 9], [5, 9]),
  },
  {
    id: 'mcbirthday', name: 'День рождения Minecraft', on: (d) => between(d, [5, 16], [5, 18]),
    fx: { parts: [{ kind: 'confetti', weight: 1, colors: PARTY }], density: 60, overlays: ['cannons'] },
  },
  {
    id: 'children', name: 'День защиты детей', on: (d) => between(d, [6, 1], [6, 1]),
    fx: { parts: [{ kind: 'balloon', weight: 2, colors: PARTY }, { kind: 'confetti', weight: 3, colors: PARTY }], density: 30, up: true },
  },
  {
    id: 'knowledge', name: '1 сентября', on: (d) => between(d, [9, 1], [9, 1]),
    fx: { parts: [{ kind: 'leaf', weight: 3, colors: AUTUMN }, { kind: 'oval', weight: 2, colors: ['#f2c41e', '#e89a1e', '#c9a227'] }], density: 30 },
  },
  {
    id: 'programmer', name: 'День программиста', on: (d) => {
      const start = new Date(d.getFullYear(), 0, 1);
      return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - start.getTime()) / 86_400_000) === 255;
    },
    fx: { parts: [{ kind: 'digit', weight: 1, colors: ['#50e7ad'] }], density: 45 },
  },
  {
    id: 'halloween', name: 'Хэллоуин', on: (d) => between(d, [10, 24], [11, 1]),
    fx: {
      parts: [{ kind: 'leaf', weight: 6, colors: AUTUMN }, { kind: 'oval', weight: 2, colors: AUTUMN }, { kind: 'bat', weight: 1 }, { kind: 'emoji', weight: .5, chars: ['🎃'] }],
      density: 34, overlays: ['fog', 'lightning'],
    },
  },
  {
    id: 'thanksgiving', name: 'День благодарения', on: (d) => nearDay(d, thanksgiving(d.getFullYear()), 0, 1),
    fx: { parts: [{ kind: 'leaf', weight: 6, colors: AUTUMN }, { kind: 'oval', weight: 2, colors: AUTUMN }, { kind: 'emoji', weight: .6, chars: ['🦃', '🥧'] }], density: 30 },
  },
];



const KEY = 'pv-seasons';
export const seasonsSetting = {
  get on(): boolean { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } },
  set on(value: boolean) {
    try { localStorage.setItem(KEY, value ? '1' : '0'); } catch {  }
    refresh();
  },
};


let preview: { id: string; until: number } | null = null;


let remote: { season: string; scare: string; bugfix: string } = { season: '', scare: '', bugfix: '' };

export function applyRemote(strings: Record<string, string>): void {
  const next = { season: strings['event.season'] ?? '', scare: strings['event.scare'] ?? '', bugfix: strings['event.bugfix'] ?? '' };
  const changed = next.season !== remote.season;
  remote = next;
  if (changed) refresh();
}


const FIRST_SEEN_KEY = 'pv-first-seen';
function firstSeen(): number {
  try {
    const stored = Number(localStorage.getItem(FIRST_SEEN_KEY));
    if (stored > 0) return stored;
    
    const now = localStorage.getItem('pv-bugfix-intro') === '1' ? 1 : Date.now();
    localStorage.setItem(FIRST_SEEN_KEY, String(now));
    return now;
  } catch {
    return Date.now();
  }
}
firstSeen();


const newcomer = (): boolean => Date.now() - firstSeen() < 24 * 3600_000;


function waveOn(kind: 'scare' | 'bugfix'): boolean {
  try {
    return waveApplies(remote[kind], firstSeen(), Date.now(), localStorage.getItem(`pv-${kind}-wave`));
  } catch {
    return false;
  }
}

/** Новая волна с сайта, которую этот компьютер ещё не видел. Отмечает её увиденной. */
function freshWave(kind: 'scare' | 'bugfix'): boolean {
  if (!waveOn(kind)) return false;
  try { localStorage.setItem(`pv-${kind}-wave`, remote[kind]); } catch { return false; }
  return true;
}

/*
 * Отмена волны на экране «Дев» доходит до лаунчеров при обновлении текстов (раз в 10 минут).
 * Чтобы отмена срабатывала почти сразу, тексты освежаются, когда человек возвращается в окно
 * (не чаще раза в минуту), и перед «Срочным фиксом» (см. bugfixOnPlay).
 */
let lastFresh = 0;
async function freshContent(timeoutMs: number): Promise<void> {
  lastFresh = Date.now();
  try {
    const content = await Promise.race([
      api.refreshContent(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (content) applyRemote(content.strings);
  } catch { /* нет сети - остаёмся с тем, что знали */ }
}
window.addEventListener('focus', () => { if (Date.now() - lastFresh > 60_000) void freshContent(5_000); });

/** Праздник по календарю, без показа из настроек. */
function realSeason(): Season | null {
  if (!seasonsSetting.on) return null;
  const now = new Date();
  return SEASONS.find((s) => s.on(now)) ?? null;
}

export function seasonNow(): Season | null {
  if (preview && Date.now() < preview.until) return SEASONS.find((s) => s.id === preview!.id) ?? null;
  const forced = seasonsSetting.on && SEASONS.find((s) => s.id === remote.season);
  if (forced) return forced;
  const season = realSeason();
  // Первый Хэллоуин в году: до скримера лаунчер выглядит как обычно (см. scareOnPlay).
  if (season?.id === 'halloween' && !scared()) return null;
  // День программиста так же: сначала мини-игра «Срочный фикс!» (см. bugfixOnPlay).
  if (season?.id === 'programmer' && !bugfixed()) return null;
  return season;
}

/** Показать праздник (экран «Дев» в дев-сборке). */
export function previewSeason(id: string, ms = 15_000): void {
  preview = { id, until: Date.now() + ms };
  refresh(true);
  window.setTimeout(() => { if (preview && Date.now() >= preview.until) { preview = null; refresh(); } }, ms + 100);
}

export function stopPreview(): void {
  preview = null;
  refresh(true);
}

// ---------------------------------------------------------------- картинки частиц

/** Слои глубины: дальний, средний, ближний (размыт, как не в фокусе). */
const LAYERS = [
  { share: .5, scale: .6, alpha: .6, blur: 1, speed: .5, parallax: 6 },
  { share: .38, scale: .85, alpha: .9, blur: 0, speed: .85, parallax: 14 },
  { share: .12, scale: 1.55, alpha: .6, blur: 4, speed: 1.45, parallax: 30 },
];
/** Размер, в котором картинка рисуется один раз. На экране её масштабируют. */
const BASE = 48;

type Sprite = HTMLCanvasElement;

function makeSprite(blur: number, draw: (g: CanvasRenderingContext2D, s: number) => void, glow = ''): Sprite {
  const pad = Math.ceil(blur * 3 + (glow ? BASE * .45 : 2));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = BASE + pad * 2;
  const g = canvas.getContext('2d')!;
  g.translate(canvas.width / 2, canvas.height / 2);
  if (blur) g.filter = `blur(${blur}px)`;
  if (glow) { g.shadowColor = glow; g.shadowBlur = BASE * .35; }
  draw(g, BASE);
  return canvas;
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number): number => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** Кленовый лист: контур по точкам, градиент, прожилки и черешок. */
const MAPLE = [[0, -1], [.18, -.55], [.45, -.72], [.38, -.3], [.86, -.4], [.62, -.06], [.96, .12], [.5, .22], [.56, .5], [.13, .36], [.05, .6],
  [-.05, .6], [-.13, .36], [-.56, .5], [-.5, .22], [-.96, .12], [-.62, -.06], [-.86, -.4], [-.38, -.3], [-.45, -.72], [-.18, -.55]] as const;

function drawKind(kind: Kind, color: string, char: string, frame: number) {
  return (g: CanvasRenderingContext2D, s: number): void => {
    const r = s / 2;
    switch (kind) {
      case 'soft': {
        const grad = g.createRadialGradient(0, 0, 0, 0, 0, r * .55);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(.45, 'rgba(255,255,255,.85)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.beginPath(); g.arc(0, 0, r * .55, 0, Math.PI * 2); g.fill();
        break;
      }
      case 'crystal': {
        g.strokeStyle = 'rgba(255,255,255,.95)';
        g.lineWidth = s * .045;
        g.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
          g.save();
          g.rotate((i * Math.PI) / 3);
          g.beginPath();
          g.moveTo(0, 0); g.lineTo(0, -r * .9);
          for (const at of [.38, .62]) {
            const len = r * (at < .5 ? .3 : .22);
            g.moveTo(0, -r * at); g.lineTo(len * .8, -r * at - len * .7);
            g.moveTo(0, -r * at); g.lineTo(-len * .8, -r * at - len * .7);
          }
          g.stroke();
          g.restore();
        }
        g.fillStyle = 'rgba(255,255,255,.95)';
        g.beginPath(); g.arc(0, 0, s * .06, 0, Math.PI * 2); g.fill();
        break;
      }
      case 'leaf': {
        const grad = g.createLinearGradient(-r, -r, r, r);
        grad.addColorStop(0, shade(color, 1.18));
        grad.addColorStop(1, shade(color, .72));
        g.fillStyle = grad;
        g.beginPath();
        MAPLE.forEach(([x, y], i) => (i ? g.lineTo(x * r * .95, y * r * .95) : g.moveTo(x * r * .95, y * r * .95)));
        g.closePath();
        g.fill();
        g.shadowBlur = 0;
        g.strokeStyle = shade(color, .55);
        g.lineWidth = s * .025;
        g.beginPath();
        g.moveTo(0, r * .9); g.lineTo(0, -r * .8);
        g.moveTo(0, r * .3); g.lineTo(r * .72, -r * .32);
        g.moveTo(0, r * .3); g.lineTo(-r * .72, -r * .32);
        g.moveTo(0, r * .45); g.lineTo(r * .7, r * .16);
        g.moveTo(0, r * .45); g.lineTo(-r * .7, r * .16);
        g.stroke();
        break;
      }
      case 'oval': {
        const grad = g.createLinearGradient(0, -r, 0, r);
        grad.addColorStop(0, shade(color, 1.15));
        grad.addColorStop(1, shade(color, .7));
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(0, -r * .9);
        g.quadraticCurveTo(r * .55, -r * .1, 0, r * .75);
        g.quadraticCurveTo(-r * .55, -r * .1, 0, -r * .9);
        g.fill();
        g.strokeStyle = shade(color, .55);
        g.lineWidth = s * .022;
        g.beginPath(); g.moveTo(0, -r * .8); g.lineTo(0, r * .92); g.stroke();
        break;
      }
      case 'bat': {
        // Два кадра: крылья вверх и вниз. Тёмный силуэт с тёплым отсветом по краю.
        const lift = frame === 0 ? 1 : -.55;
        g.fillStyle = '#07030c';
        // Крыло: верхний край дугой до кончика, нижний - фестонами между «пальцами».
        const edge: [number, number][] = [[.98, -.42], [.76, -.12], [.54, -.06], [.32, .06], [.12, .16]];
        for (const side of [-1, 1]) {
          const X = (x: number): number => side * x * r;
          const Y = (y: number): number => y * lift * r;
          g.beginPath();
          g.moveTo(X(.08), Y(-.08));
          g.quadraticCurveTo(X(.42), Y(-.78), X(edge[0]![0]), Y(edge[0]![1]));
          for (let i = 1; i < edge.length; i++) {
            const [x0, y0] = edge[i - 1]!;
            const [x1, y1] = edge[i]!;
            g.quadraticCurveTo(X((x0 + x1) / 2), Y((y0 + y1) / 2 - .14), X(x1), Y(y1));
          }
          g.closePath();
          g.fill();
        }
        g.beginPath(); g.ellipse(0, r * .04, r * .12, r * .22, 0, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.arc(0, -r * .17, r * .1, 0, Math.PI * 2); g.fill();
        g.beginPath();
        g.moveTo(-r * .09, -r * .2); g.lineTo(-r * .12, -r * .36); g.lineTo(-r * .02, -r * .25);
        g.lineTo(r * .02, -r * .25); g.lineTo(r * .12, -r * .36); g.lineTo(r * .09, -r * .2);
        g.fill();
        g.shadowBlur = 0;
        g.fillStyle = '#ffb347';
        g.beginPath(); g.arc(-r * .04, -r * .18, s * .02, 0, Math.PI * 2); g.arc(r * .04, -r * .18, s * .02, 0, Math.PI * 2); g.fill();
        break;
      }
      case 'heart': {
        const grad = g.createLinearGradient(-r, -r, r, r);
        grad.addColorStop(0, shade(color, 1.25));
        grad.addColorStop(1, shade(color, .75));
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(0, r * .78);
        g.bezierCurveTo(-r * 1.05, r * .05, -r * .62, -r * .85, 0, -r * .32);
        g.bezierCurveTo(r * .62, -r * .85, r * 1.05, r * .05, 0, r * .78);
        g.fill();
        g.shadowBlur = 0;
        g.fillStyle = 'rgba(255,255,255,.45)';
        g.beginPath(); g.ellipse(-r * .38, -r * .3, r * .14, r * .08, -.7, 0, Math.PI * 2); g.fill();
        break;
      }
      case 'petal': {
        const grad = g.createLinearGradient(0, -r, 0, r);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(1, color);
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(0, r * .8);
        g.bezierCurveTo(r * .75, r * .35, r * .55, -r * .7, r * .12, -r * .78);
        g.lineTo(0, -r * .58);
        g.lineTo(-r * .12, -r * .78);
        g.bezierCurveTo(-r * .55, -r * .7, -r * .75, r * .35, 0, r * .8);
        g.fill();
        break;
      }
      case 'sparkle': {
        g.fillStyle = color;
        g.beginPath();
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2;
          const b = a + Math.PI / 4;
          g.lineTo(Math.cos(a) * r * .9, Math.sin(a) * r * .9);
          g.quadraticCurveTo(0, 0, Math.cos(b + Math.PI / 4) * r * .9, Math.sin(b + Math.PI / 4) * r * .9);
        }
        g.closePath();
        g.fill();
        g.fillStyle = '#fff';
        g.beginPath(); g.arc(0, 0, s * .07, 0, Math.PI * 2); g.fill();
        break;
      }
      case 'balloon': {
        g.strokeStyle = 'rgba(255,255,255,.55)';
        g.lineWidth = s * .02;
        g.beginPath(); g.moveTo(0, r * .45); g.quadraticCurveTo(r * .12, r * .7, 0, r * .98); g.stroke();
        const grad = g.createRadialGradient(-r * .15, -r * .35, r * .05, 0, -r * .1, r * .6);
        grad.addColorStop(0, shade(color, 1.45));
        grad.addColorStop(1, shade(color, .8));
        g.fillStyle = grad;
        g.beginPath(); g.ellipse(0, -r * .12, r * .42, r * .55, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = shade(color, .8);
        g.beginPath(); g.moveTo(0, r * .4); g.lineTo(r * .07, r * .5); g.lineTo(-r * .07, r * .5); g.fill();
        break;
      }
      case 'emoji': {
        g.font = `${s * .78}px "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(char, 0, s * .04);
        break;
      }
      default:
        break;
    }
  };
}

const GLOW: Partial<Record<Kind, string>> = {
  crystal: 'rgba(200,230,255,.8)', sparkle: 'rgba(255,240,200,.9)', heart: 'rgba(255,90,140,.55)',
  bat: 'rgba(255,130,40,.95)', emoji: 'rgba(255,255,255,.25)', soft: '',
};

/** Набор картинок праздника: [разновидность][вариант][слой]. */
interface Variant { kind: Kind; sprites: Sprite[][]; color: string }
let variants: { part: Part; list: Variant[] }[] = [];

function buildSprites(fx: Fx): void {
  variants = fx.parts.map((part) => {
    const looks = part.kind === 'emoji' ? (part.chars ?? ['✨']) : (part.colors ?? ['#ffffff']);
    return {
      part,
      list: looks.map((look) => {
        const color = part.kind === 'emoji' ? '#ffffff' : look;
        const char = part.kind === 'emoji' ? look : '';
        const frames = part.kind === 'bat' ? [0, 1] : [0];
        const live = part.kind === 'confetti' || part.kind === 'digit';
        return {
          kind: part.kind, color,
          sprites: live ? [] : frames.map((frame) => LAYERS.map((layer) => makeSprite(layer.blur, drawKind(part.kind, color, char, frame), GLOW[part.kind] ?? ''))),
        };
      }),
    };
  });
}

// ---------------------------------------------------------------- частицы

interface Bit {
  layer: number; v: Variant; x: number; y: number; vx: number; vy: number; size: number;
  angle: number; spin: number; flip: number; phase: number; life?: number;
}

const FRAME_MS = 1000 / 30;
let canvas: HTMLCanvasElement | null = null;
let bits: Bit[] = [];
/** Залп конфетти (день рождения Minecraft): свои частицы с гравитацией. */
let burst: Bit[] = [];
let running = false;
let lastFrame = 0;
let step = 1;
let width = 0;
let height = 0;
let fx: Fx | null = null;
let activeId: string | null = null;
const pointer = { x: .5, y: .5, tx: .5, ty: .5 };
let lightningAt = 0;
let shootingAt = 0;
let shooting: { x: number; y: number; vx: number; vy: number; born: number } | null = null;
let fogSprite: Sprite | null = null;
const fog: { x: number; y: number; r: number; v: number }[] = [];

const resting = (): boolean => document.hidden || document.body.classList.contains('idle') || document.body.classList.contains('lite');
const still = window.matchMedia('(prefers-reduced-motion: reduce)');

function pickVariant(): Variant {
  const total = variants.reduce((sum, v) => sum + v.part.weight, 0);
  let roll = Math.random() * total;
  for (const group of variants) {
    roll -= group.part.weight;
    if (roll <= 0) return group.list[Math.floor(Math.random() * group.list.length)]!;
  }
  return variants[0]!.list[0]!;
}

function pickLayer(): number {
  const roll = Math.random();
  return roll < LAYERS[0]!.share ? 0 : roll < LAYERS[0]!.share + LAYERS[1]!.share ? 1 : 2;
}

function spawn(fresh: boolean, layer = pickLayer()): Bit {
  const v = pickVariant();
  // Мыши только на ближних слоях: вдали они превращаются в точки.
  if (v.kind === 'bat' && layer === 0) layer = 1;
  const L = LAYERS[layer]!;
  const kind = v.kind;
  const base = kind === 'soft' ? 10 + Math.random() * 8 : kind === 'crystal' ? 16 + Math.random() * 10
    : kind === 'confetti' ? 9 + Math.random() * 6 : kind === 'digit' ? 13 + Math.random() * 6
      : kind === 'balloon' ? 58 + Math.random() * 22 : kind === 'bat' ? 58 + Math.random() * 20 : kind === 'leaf' ? 32 + Math.random() * 14 : 24 + Math.random() * 12;
  const fall = (kind === 'soft' || kind === 'crystal' ? .45 + Math.random() * .5 : kind === 'digit' ? 1.6 + Math.random() * 1.6 : .5 + Math.random() * .6) * L.speed;
  const up = fx?.up && kind !== 'confetti' ? -1 : 1;
  const bit: Bit = {
    layer, v,
    x: Math.random() * width,
    y: fresh ? (up > 0 ? -40 : height + 40) : Math.random() * height,
    vx: (Math.random() - .5) * .5 * L.speed,
    vy: fall * up,
    size: base * L.scale,
    angle: Math.random() * Math.PI * 2,
    spin: (Math.random() - .5) * (kind === 'leaf' || kind === 'oval' || kind === 'confetti' ? .05 : kind === 'crystal' ? .012 : .006),
    flip: .6 + Math.random() * 1.4,
    phase: Math.random() * Math.PI * 2,
  };
  if (kind === 'bat') {
    // Мышь летит поперёк окна рывками, а не падает.
    const dir = Math.random() < .5 ? -1 : 1;
    bit.vx = dir * (1.2 + Math.random() * 1.2) * L.speed;
    bit.vy = (Math.random() - .5) * .3;
    bit.x = fresh ? (dir > 0 ? -40 : width + 40) : bit.x;
    bit.y = Math.random() * height * .7;
  }
  return bit;
}

function resize(): void {
  if (!canvas || !fx) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.getContext('2d')!.setTransform(ratio, 0, 0, ratio, 0, 0);
  const area = Math.max(.6, (width * height) / 1_000_000);
  bits = Array.from({ length: Math.round(fx.density * area) }, () => spawn(false));
  fog.length = 0;
  for (let i = 0; i < 7; i++) fog.push({ x: Math.random() * width, y: height - 40 - Math.random() * 120, r: 220 + Math.random() * 180, v: (Math.random() - .5) * .25 });
}

function drawBit(g: CanvasRenderingContext2D, bit: Bit, time: number, wind: number): boolean {
  const L = LAYERS[bit.layer]!;
  const kind = bit.v.kind;
  const sway = Math.sin(time / 1400 + bit.phase);
  if (kind === 'bat') {
    bit.x += bit.vx * step;
    bit.y += (bit.vy + Math.sin(time / 260 + bit.phase) * .9) * step;
  } else {
    bit.x += (bit.vx + (wind + sway * (kind === 'soft' ? .25 : .45)) * L.speed) * step;
    bit.y += bit.vy * step;
  }
  bit.angle += bit.spin * step;
  if (bit.y > height + 60 || bit.y < -60 || bit.x < -80 || bit.x > width + 80) return false;

  const px = bit.x + (pointer.x - .5) * L.parallax * 2;
  const py = bit.y + (pointer.y - .5) * L.parallax * 2;
  g.save();
  g.translate(px, py);
  g.globalAlpha = L.alpha;

  if (kind === 'confetti') {
    g.rotate(bit.angle);
    g.scale(1, Math.cos(time / 260 * bit.flip + bit.phase));
    g.fillStyle = bit.v.color;
    g.fillRect(-bit.size * .5, -bit.size * .22, bit.size, bit.size * .44);
  } else if (kind === 'digit') {
    g.shadowColor = bit.v.color;
    g.shadowBlur = 8;
    g.font = `600 ${bit.size}px "JetBrains Mono", Consolas, monospace`;
    // Как в «Матрице»: яркая голова и гаснущий хвост, символы иногда перещёлкиваются.
    for (let i = 0; i < 5; i++) {
      const flick = Math.floor(time / 180 + bit.phase * 7 + i * 3) % 2;
      g.globalAlpha = L.alpha * (i ? .55 * (1 - i / 5) : 1);
      g.fillStyle = i ? bit.v.color : '#d8fff0';
      g.fillText(flick ? '1' : '0', 0, -i * bit.size * 1.05);
    }
  } else {
    const frames = bit.v.sprites;
    const frame = kind === 'bat' ? frames[Math.floor(time / 110 + bit.phase) % 2]! : frames[0]!;
    const sprite = frame[bit.layer]!;
    if (kind === 'bat') {
      g.scale(bit.vx < 0 ? -1 : 1, 1);
    } else if (kind === 'leaf' || kind === 'oval' || kind === 'petal') {
      // Лист кувыркается: поворот плюс «переворот» по одной оси - выглядит объёмно.
      g.rotate(bit.angle);
      const turn = Math.cos(time / 900 * bit.flip + bit.phase);
      g.scale(Math.sign(turn || 1) * Math.max(.28, Math.abs(turn)), 1);
    } else if (kind === 'balloon' || kind === 'heart' || kind === 'emoji') {
      g.rotate(Math.sin(time / 1600 + bit.phase) * .18);
    } else {
      g.rotate(bit.angle);
    }
    if (kind === 'sparkle') g.globalAlpha = L.alpha * (.45 + .55 * Math.abs(Math.sin(time / 700 + bit.phase)));
    const k = bit.size / BASE;
    g.drawImage(sprite, -sprite.width * k / 2, -sprite.height * k / 2, sprite.width * k, sprite.height * k);
  }
  g.restore();
  return true;
}

/** Гирлянда по верхнему краю: провод провисает между крючками, лампочки мигают волной. */
function drawGarland(g: CanvasRenderingContext2D, time: number): void {
  const COLORS = ['#ff4d5e', '#ffd84d', '#4dd2ff', '#7dff6a', '#ff7ad9'];
  const span = 230;
  const sag = 40;
  const hooks = Math.ceil(width / span) + 1;
  // Точка на провисшем проводе: квадратичная кривая от крючка до крючка.
  const wireY = (t: number): number => -2 + 2 * t * (1 - t) * sag;
  g.save();
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(70,95,80,.95)';
  g.beginPath();
  for (let h = 0; h < hooks; h++) {
    const x0 = h * span;
    g.moveTo(x0, -2);
    g.quadraticCurveTo(x0 + span / 2, -2 + sag, x0 + span, -2);
  }
  g.stroke();
  let n = 0;
  for (let h = 0; h < hooks; h++) {
    for (let i = 1; i < 7; i++) {
      const t = i / 7;
      const x = h * span + t * span;
      const y = wireY(t);
      const color = COLORS[n % COLORS.length]!;
      // Волна бежит по гирлянде, плюс у каждой лампочки свой лёгкий трепет.
      const on = .3 + .7 * Math.max(0, Math.sin(time / 520 - n * .55)) * (.85 + .15 * Math.sin(time / 90 + n * 3));
      const cy = y + 10;
      const glow = g.createRadialGradient(x, cy, 0, x, cy, 26);
      glow.addColorStop(0, color);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = .5 * on;
      g.fillStyle = glow;
      g.beginPath(); g.arc(x, cy, 26, 0, Math.PI * 2); g.fill();
      g.globalAlpha = .45 + .55 * on;
      g.fillStyle = color;
      g.beginPath(); g.ellipse(x, cy, 4.6, 7, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,.75)';
      g.beginPath(); g.ellipse(x - 1.4, cy - 2, 1.3, 2.4, 0, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
      g.fillStyle = '#3a4a40';
      g.fillRect(x - 3, y + 1, 6, 4);
      n++;
    }
  }
  g.restore();
}

function drawFog(g: CanvasRenderingContext2D): void {
  if (!fogSprite) {
    fogSprite = document.createElement('canvas');
    fogSprite.width = fogSprite.height = 256;
    const f = fogSprite.getContext('2d')!;
    const grad = f.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(150,120,170,.22)');
    grad.addColorStop(1, 'rgba(150,120,170,0)');
    f.fillStyle = grad;
    f.fillRect(0, 0, 256, 256);
  }
  for (const blob of fog) {
    blob.x += blob.v * step;
    if (blob.x < -blob.r) blob.x = width + blob.r;
    if (blob.x > width + blob.r) blob.x = -blob.r;
    g.drawImage(fogSprite, blob.x - blob.r, blob.y - blob.r * .5, blob.r * 2, blob.r);
  }
}

function drawLightning(g: CanvasRenderingContext2D, time: number): void {
  if (!lightningAt) lightningAt = time + 9000 + Math.random() * 12000;
  const t = time - lightningAt;
  if (t < 0) return;
  // Две вспышки подряд, как настоящая молния, потом тишина на полминуты-минуту.
  const alpha = t < 70 ? .2 : t < 140 ? 0 : t < 230 ? .12 : 0;
  if (alpha) { g.fillStyle = `rgba(210,220,255,${alpha})`; g.fillRect(0, 0, width, height); }
  if (t > 400) lightningAt = time + 30000 + Math.random() * 35000;
}

function drawShooting(g: CanvasRenderingContext2D, time: number): void {
  if (!shooting && time > shootingAt) {
    shooting = { x: width * (.4 + Math.random() * .6), y: -20, vx: -(9 + Math.random() * 5), vy: 5 + Math.random() * 3, born: time };
    shootingAt = time + 3500 + Math.random() * 6000;
  }
  if (!shooting) return;
  shooting.x += shooting.vx * step;
  shooting.y += shooting.vy * step;
  const tail = 22;
  const grad = g.createLinearGradient(shooting.x, shooting.y, shooting.x - shooting.vx * tail, shooting.y - shooting.vy * tail);
  grad.addColorStop(0, 'rgba(255,255,255,.95)');
  grad.addColorStop(1, 'rgba(160,200,255,0)');
  g.strokeStyle = grad;
  g.lineWidth = 2;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(shooting.x, shooting.y);
  g.lineTo(shooting.x - shooting.vx * tail, shooting.y - shooting.vy * tail);
  g.stroke();
  if (shooting.x < -300 || shooting.y > height + 300) shooting = null;
}

/** Залп из нижних углов окна. */
function fireCannons(): void {
  const confetti = variants.find((v) => v.part.kind === 'confetti');
  if (!confetti) return;
  burst = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 70; i++) {
      const v = confetti.list[Math.floor(Math.random() * confetti.list.length)]!;
      burst.push({
        layer: 1, v,
        x: side < 0 ? 10 : width - 10, y: height - 10,
        vx: -side * (2 + Math.random() * 11), vy: -(15 + Math.random() * 10),
        size: 8 + Math.random() * 7, angle: Math.random() * 6, spin: (Math.random() - .5) * .3,
        flip: .6 + Math.random() * 1.4, phase: Math.random() * 6, life: 1,
      });
    }
  }
}

function frame(time: number): void {
  if (!canvas || !fx) { running = false; return; }
  if (!still.matches && !resting() && time - lastFrame < FRAME_MS) { requestAnimationFrame(frame); return; }
  // Шаг в кадрах по 30 в секунду: если кадр задержался, частицы догоняют, а не тормозят.
  step = lastFrame ? Math.min(8, (time - lastFrame) / FRAME_MS) : 1;
  lastFrame = time;
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, width, height);
  pointer.x += (pointer.tx - pointer.x) * .05;
  pointer.y += (pointer.ty - pointer.y) * .05;
  const wind = Math.sin(time / 9000) * .35 + Math.sin(time / 2300) * .1;
  const overlays = fx.overlays ?? [];
  if (overlays.includes('fog')) drawFog(g);
  // Дальние слои первыми, ближние поверх.
  for (const layer of [0, 1, 2]) {
    for (let i = 0; i < bits.length; i++) {
      const bit = bits[i]!;
      if (bit.layer !== layer) continue;
      if (!drawBit(g, bit, time, wind)) bits[i] = spawn(true, layer);
    }
  }
  if (burst.length) {
    burst = burst.filter((bit) => {
      bit.vy += .22 * step;
      bit.vx *= .99 ** step;
      bit.vy *= .99 ** step;
      // Бумажка не падает камнем: вниз она порхает.
      if (bit.vy > 2.2) bit.vy = 2.2;
      return drawBit(g, bit, time, 0);
    });
  }
  if (overlays.includes('shooting')) drawShooting(g, time);
  if (overlays.includes('garland')) drawGarland(g, time);
  if (overlays.includes('lightning')) drawLightning(g, time);
  if (!still.matches && !resting()) requestAnimationFrame(frame);
  else running = false;
}

function start(): void {
  if (running || !fx || document.hidden) return;
  running = true;
  requestAnimationFrame(frame);
}

/** Праздник сменился (дата, настройка, показ): обновляем слой и класс на body. */
function refresh(force = false): void {
  const season = seasonNow();
  const id = season?.id ?? null;
  for (const s of SEASONS) document.body.classList.toggle(`season-${s.id}`, s.id === id);
  if (id === activeId && !force) return;
  activeId = id;
  fx = season?.fx ?? null;
  if (!fx) {
    canvas?.remove();
    canvas = null;
    return;
  }
  buildSprites(fx);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'season-layer';
    document.body.append(canvas);
  }
  lightningAt = 0;
  burst = [];
  shootingAt = performance.now() + 1500;
  resize();
  if (fx.overlays?.includes('cannons')) fireCannons();
  start();
}

export function mountSeasons(): void {
  refresh();
  window.addEventListener('resize', () => { resize(); start(); });
  window.addEventListener('pointermove', (event) => {
    pointer.tx = event.clientX / Math.max(1, window.innerWidth);
    pointer.ty = event.clientY / Math.max(1, window.innerHeight);
  });
  document.addEventListener('visibilitychange', start);
  new MutationObserver(start).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  still.addEventListener('change', start);
  // Праздник может начаться, пока лаунчер открыт: он живёт в трее неделями.
  window.setInterval(() => { if ((seasonNow()?.id ?? null) !== activeId) refresh(); }, 600_000);
}

// ---------------------------------------------------------------- скример на Хэллоуин

const scareKey = (): string => `pv-scare-${new Date().getFullYear()}`;
function scared(): boolean {
  try { return localStorage.getItem(scareKey()) === '1'; } catch { return true; }
}

/**
 * Кнопка «Играть» в первый раз за этот Хэллоуин: скример на полторы секунды, потом лаунчер
 * становится хэллоуинским. Игра запускается как обычно, скример её не задерживает.
 */
export function scareOnPlay(): void {
  if (freshWave('scare')) { showScreamer(); return; }
  // Новичка в первые сутки не пугаем: первое впечатление от лаунчера не должно быть скримером.
  if (realSeason()?.id !== 'halloween' || scared() || newcomer()) return;
  try { localStorage.setItem(scareKey(), '1'); } catch { /* тогда напугаем ещё раз - не страшно */ }
  showScreamer(() => refresh());
}

// ---------------------------------------------------------------- «Срочный фикс!» в День программиста

const fixKey = (): string => `pv-bugfix-${new Date().getFullYear()}`;
function bugfixed(): boolean {
  try { return localStorage.getItem(fixKey()) === '1'; } catch { return true; }
}

/**
 * Перед запуском игры. Открывает мини-игру (bugfix.ts) и отвечает, запускать ли Minecraft:
 * первый клик в День программиста или волна «Всем чинить баги» с экрана «Дев».
 * В остальных случаях сразу true. Отмечается заранее: не починил - следующий клик запустит
 * игру как обычно.
 *
 * Раньше здесь было ещё «знакомство»: один раз у каждого после обновления 1.11. Но новый игрок
 * тоже «впервые» - и первым делом вместо игры получал задачку на Java. Знакомство убрано.
 */
export async function bugfixOnPlay(): Promise<boolean> {
  const programmer = realSeason()?.id === 'programmer' && !bugfixed() && !newcomer();
  // Волна могла быть отменена минуту назад: перед тем как не пустить в игру, сверяемся с сайтом.
  if (waveOn('bugfix')) await freshContent(2_500);
  const wave = freshWave('bugfix');
  if (!programmer && !wave) return true;
  try {
    if (programmer) localStorage.setItem(fixKey(), '1');
  } catch { /* сыграет ещё раз - не страшно */ }
  const won = await openBugfix();
  refresh();
  return won;
}

/** Запасной крик синтезатором, если mp3 не сыграл. Громкость с потолком, чтобы не оглушить в наушниках. */
function scream(): void {
  try {
    const ctx = new AudioContext();
    const t = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, t);
    master.gain.exponentialRampToValueAtTime(0.32, t + 0.03);
    master.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    master.connect(ctx.destination);
    const noise = ctx.createBuffer(1, ctx.sampleRate * 1.4, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const hiss = ctx.createBufferSource();
    hiss.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(2400, t);
    band.frequency.exponentialRampToValueAtTime(500, t + 1.3);
    band.Q.value = 1.2;
    hiss.connect(band).connect(master);
    for (const [freq, detune] of [[960, 0], [1440, 18], [720, -25]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.detune.value = detune;
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq / 4, t + 1.3);
      const wobble = ctx.createOscillator();
      const depth = ctx.createGain();
      wobble.frequency.value = 9;
      depth.gain.value = freq * 0.06;
      wobble.connect(depth).connect(osc.frequency);
      const level = ctx.createGain();
      level.gain.value = 0.22;
      osc.connect(level).connect(master);
      osc.start(t); wobble.start(t);
      osc.stop(t + 1.4); wobble.stop(t + 1.4);
    }
    hiss.start(t);
    hiss.stop(t + 1.4);
    window.setTimeout(() => void ctx.close(), 1800);
  } catch { /* без звука тоже страшно */ }
}

/** Картинка во весь экран (Pixabay, лицензия разрешает в программах): рвётся на зрителя, экран трясётся и мигает. */
export function showScreamer(done?: () => void): void {
  if (document.querySelector('.screamer')) return;
  const img = new Image();
  img.src = './screamer/face.jpg';
  img.alt = '';
  const audio = new Audio('./screamer/scream.mp3');
  audio.volume = 0.8;
  audio.preload = 'auto';
  const start = (): void => {
    if (document.querySelector('.screamer')) return;
    const node = el('div', { class: 'screamer' });
    node.append(img);
    document.body.append(node);
    audio.play().catch(() => scream());
    window.setTimeout(() => {
      node.classList.add('out');
      window.setTimeout(() => { node.remove(); audio.pause(); done?.(); }, 450);
    }, 1600);
  };
  // Ждём картинку, чтобы не мелькнул пустой чёрный экран; но не дольше секунды.
  let shown = false;
  const go = (): void => { if (!shown) { shown = true; start(); } };
  img.decode().then(go, go);
  window.setTimeout(go, 1000);
}
