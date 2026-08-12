import { memo, useEffect, useRef } from 'react';

interface DitheringSwirlBackgroundProps {
  colorBack: string;
  colorFront: string;
  speed?: number;
  pxSize?: number;
  opacity?: number;
  className?: string;
}

// 4x4 ordered (Bayer) dither matrix, normalized to 0..1.
const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => v / 16));

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function DitheringSwirlBackgroundImpl({
  colorBack,
  colorFront,
  speed = 0.3,
  pxSize = 4,
  opacity = 0.18,
  className,
}: DitheringSwirlBackgroundProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const offscreen = document.createElement('canvas');
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isMobile = window.matchMedia('(max-width: 640px)').matches;
    const effectiveSpeed = isMobile ? speed * 0.7 : speed;
    const effectivePxSize = isMobile ? pxSize + 1 : pxSize;

    const back = hexToRgb(colorBack);
    const front = hexToRgb(colorFront);

    let cols = 0;
    let rows = 0;
    let imageData: ImageData | null = null;
    let rafId = 0;
    const startTime = performance.now();
    let lastDraw = 0;
    const frameInterval = 1000 / 24;

    function resize() {
      if (!container || !canvas) return;
      const w = Math.max(1, Math.round(container.clientWidth));
      const h = Math.max(1, Math.round(container.clientHeight));
      canvas.width = w;
      canvas.height = h;
      cols = Math.max(1, Math.ceil(w / effectivePxSize));
      rows = Math.max(1, Math.ceil(h / effectivePxSize));
      offscreen.width = cols;
      offscreen.height = rows;
      imageData = offCtx!.createImageData(cols, rows);
    }

    function draw(time: number) {
      if (!imageData) return;
      const t = ((time - startTime) / 1000) * effectiveSpeed;
      const data = imageData.data;
      const aspect = cols / rows;

      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const nx = ((cx + 0.5) / cols * 2 - 1) * Math.max(1, aspect);
          const ny = (cy + 0.5) / rows * 2 - 1;
          const r = Math.sqrt(nx * nx + ny * ny);
          const angle = Math.atan2(ny, nx);
          const swirl = angle * 2 + r * 2.2 - t;
          const raw = Math.sin(swirl) * 0.5 + 0.5;
          // Capped amplitude keeps the pattern textured everywhere — even at
          // the swirl's peak it never resolves to a solid fill, only denser dither.
          const value = (raw ** 3) * 0.42;
          const radialGate = smoothstep(0.4, 1.25, r); // quiet center, livelier edges
          const effective = value * radialGate;
          const threshold = BAYER_4X4[cy & 3][cx & 3];
          const lit = effective > 0.05 + threshold * 0.45;

          const idx = (cy * cols + cx) * 4;
          const [cr, cg, cb] = lit ? front : back;
          data[idx] = cr;
          data[idx + 1] = cg;
          data[idx + 2] = cb;
          data[idx + 3] = 255;
        }
      }

      offCtx!.putImageData(imageData, 0, 0);
      ctx!.imageSmoothingEnabled = false;
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      ctx!.drawImage(offscreen, 0, 0, cols, rows, 0, 0, canvas!.width, canvas!.height);
    }

    resize();
    draw(startTime);

    if (!reducedMotion) {
      const loop = (time: number) => {
        rafId = requestAnimationFrame(loop);
        if (document.hidden) return;
        if (time - lastDraw < frameInterval) return;
        lastDraw = time;
        draw(time);
      };
      rafId = requestAnimationFrame(loop);
    }

    const observer = new ResizeObserver(() => {
      resize();
      draw(performance.now());
    });
    observer.observe(container);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [colorBack, colorFront, speed, pxSize, opacity]);

  return (
    <div
      ref={containerRef}
      className={className}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        opacity,
        overflow: 'hidden',
      }}
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}

const DitheringSwirlBackground = memo(DitheringSwirlBackgroundImpl);
export default DitheringSwirlBackground;
