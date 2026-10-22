


const FRAME_MS = 1000 / 30;


function resting(): boolean {
  const body = document.body;
  return document.hidden || body.classList.contains('idle') || body.classList.contains('lite')
    || (body.dataset.theme ?? 'cosmos') !== 'cosmos';
}

const COLORS = ['255,120,189', '159,134,255', '80,231,173'];

interface Spark { x: number; y: number; r: number; vx: number; vy: number; color: string; phase: number; }

export function mountAmbient(): void {
  if (document.querySelector('canvas.ambient')) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'ambient';
  document.body.prepend(canvas);
  const context = canvas.getContext('2d');
  if (!context) return;

  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  const pointer = { x: .5, y: .5, targetX: .5, targetY: .5 };
  let width = 0;
  let height = 0;
  let sparks: Spark[] = [];
  let running = false;
  let lastFrame = 0;

  function resize(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context!.setTransform(ratio, 0, 0, ratio, 0, 0);
    
    sparks = Array.from({ length: Math.round((width * height) / 20000) }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: .6 + Math.random() * 1.6,
      vx: (Math.random() - .5) * .12,
      vy: -.04 - Math.random() * .16,
      color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
      phase: Math.random() * Math.PI * 2,
    }));
  }

  function draw(time: number): void {
    
    if (running && !still.matches && !resting() && time - lastFrame < FRAME_MS) {
      requestAnimationFrame(draw);
      return;
    }
    lastFrame = time;
    const ctx = context!;
    ctx.clearRect(0, 0, width, height);
    pointer.x += (pointer.targetX - pointer.x) * .04;
    pointer.y += (pointer.targetY - pointer.y) * .04;
    
    const shiftX = (pointer.x - .5) * 26;
    const shiftY = (pointer.y - .5) * 26;

    const centerX = width * .8 - shiftX * .5;
    const centerY = height * .74 - shiftY * .5;
    const radius = Math.max(width, height) * .56;
    ctx.lineWidth = 1.3;
    COLORS.forEach((color, i) => {
      const turn = (time / (70000 + i * 19000)) * Math.PI * 2 * (i % 2 ? -1 : 1);
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(-.32 + i * 1.05 + turn);
      ctx.strokeStyle = `rgba(${color},.075)`;
      ctx.beginPath();
      ctx.ellipse(0, 0, radius, radius * .34, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });

    for (const spark of sparks) {
      if (!still.matches) {
        spark.x += spark.vx;
        spark.y += spark.vy;
        if (spark.y < -10) { spark.y = height + 10; spark.x = Math.random() * width; }
        if (spark.x < -10) spark.x = width + 10;
        else if (spark.x > width + 10) spark.x = -10;
      }
      const depth = spark.r / 2.2;
      const twinkle = .35 + .65 * (.5 + .5 * Math.sin(time / 900 + spark.phase));
      ctx.fillStyle = `rgba(${spark.color},${((.16 + .5 * depth) * twinkle).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(spark.x + shiftX * depth, spark.y + shiftY * depth, spark.r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (!still.matches && !resting()) requestAnimationFrame(draw);
    else running = false;
  }

  function start(): void {
    if (running || document.hidden) return;
    running = true;
    requestAnimationFrame(draw);
  }

  // app.ts меняет .idle/.lite и тему на body - следим за ними, чтобы проснуться, когда фон снова нужен.
  new MutationObserver(start).observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme'] });

  // После resize холст пустой - нужен хотя бы один кадр, даже если фон сейчас стоит.
  window.addEventListener('resize', () => { resize(); start(); });
  window.addEventListener('pointermove', (event) => {
    pointer.targetX = event.clientX / Math.max(1, width);
    pointer.targetY = event.clientY / Math.max(1, height);
  });
  document.addEventListener('visibilitychange', start);
  still.addEventListener('change', start);
  resize();
  start();
}
