// Turns a white logo <img> into a living pixel field: the logo is rebuilt from small square "pixels"
// that twinkle, with a diagonal shine sweeping across it — the same language as the hero film.
// Cheap: a few hundred to a few thousand rects per frame, ~30 fps, paused when hidden or off screen.

export function glitter(img, { cell = 3, fps = 30, still = false } = {}) {
  if (!img) return;
  const start = () => {
    const w = img.clientWidth, h = img.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const canvas = document.createElement('canvas');
    canvas.className = img.className + ' glitter';
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    canvas.setAttribute('aria-hidden', 'true');
    const ctx = canvas.getContext('2d');

    // sample the logo's alpha on a grid of CSS-pixel cells
    const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
    const probe = document.createElement('canvas');
    probe.width = cols; probe.height = rows;
    const pctx = probe.getContext('2d', { willReadFrequently: true });
    pctx.drawImage(img, 0, 0, cols, rows);
    const data = pctx.getImageData(0, 0, cols, rows).data;
    const cells = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const a = data[(y * cols + x) * 4 + 3] / 255;
      if (a > 0.25) cells.push({ x, y, a, ph: Math.random(), sp: 0.6 + Math.random() * 1.8 });
    }
    img.after(canvas);
    img.style.display = 'none';

    const s = cell * dpr, g = Math.max(1, s - Math.max(1, dpr * 0.8));
    let last = 0, raf = 0, visible = true;
    const t0 = performance.now();
    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (now - last < 1000 / fps) return;
      last = now;
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // faint solid logo underneath so it always reads
      ctx.globalAlpha = 0.45;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const sweep = (t * 0.32) % 1.6 - 0.3;          // shine position, travels past the logo every ~5 s
      for (const c of cells) {
        const u = c.x / cols, v = c.y / rows;
        const d = (u * 0.75 + v * 0.45) - sweep;
        const shine = Math.max(0, 1 - Math.abs(d) / 0.12);
        const tw = Math.sin((t * c.sp + c.ph) * Math.PI * 2);
        const spark = tw > 0.995 ? 1 : 0;
        const a = Math.min(1, c.a * (0.5 + 0.45 * (tw * 0.5 + 0.5)) + shine * 0.9 + spark);
        ctx.globalAlpha = a;
        ctx.fillStyle = spark || shine > 0.6 ? '#ffffff' : '#e9e6df';
        const grow = spark ? Math.round(dpr * 0.5) : 0;
        ctx.fillRect(c.x * s - grow, c.y * s - grow, g + grow * 2, g + grow * 2);
      }
      ctx.globalAlpha = 1;
    }
    if (still) {
      // one static pixel render: every cell a square at the logo's own strength, no motion
      ctx.globalAlpha = 0.35;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#f2f0ea';
      for (const c of cells) { ctx.globalAlpha = Math.min(1, c.a * 0.95); ctx.fillRect(c.x * s, c.y * s, g, g); }
      ctx.globalAlpha = 1;
      return;
    }
    const run = () => { cancelAnimationFrame(raf); if (visible && !document.hidden) raf = requestAnimationFrame(frame); };
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; run(); }).observe(canvas);
    document.addEventListener('visibilitychange', run);
    run();
  };
  if (img.complete && img.naturalWidth) requestAnimationFrame(start);
  else img.addEventListener('load', () => requestAnimationFrame(start), { once: true });
}
