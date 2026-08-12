import { memo, useEffect, useRef } from 'react';

interface DitheringSwirlBackgroundProps {
  colorBack: string;
  colorFront: string;
  speed?: number;
  pxSize?: number;
  opacity?: number;
  className?: string;
}

type Rgb = [number, number, number];

// 4x4 ordered (Bayer) dither matrix, normalized to 0..1.
const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => v / 16));

const COLOR_TRANSITION_MS = 280;

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
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

  // Latest requested palette + an in-flight lerp toward it, read by the draw
  // loop each frame. Updating these never touches animation start time or
  // recreates the canvas — only the initialization effect (mount-only) does.
  const colorStateRef = useRef({
    fromBack: hexToRgb(colorBack),
    fromFront: hexToRgb(colorFront),
    toBack: hexToRgb(colorBack),
    toFront: hexToRgb(colorFront),
    transitionStart: 0,
  });
  // Set by the animation-loop effect so this effect can force one repaint —
  // needed under prefers-reduced-motion, where no rAF loop is running to
  // otherwise pick up the new palette.
  const requestDrawRef = useRef<(() => void) | null>(null);

  // Color-only update: reruns whenever the theme (or any palette prop)
  // changes, but does NOT touch the canvas/rAF/observer effect below.
  useEffect(() => {
    const state = colorStateRef.current;
    const currentBack = lerpElapsed(state, 'back');
    const currentFront = lerpElapsed(state, 'front');
    state.fromBack = currentBack;
    state.fromFront = currentFront;
    state.toBack = hexToRgb(colorBack);
    state.toFront = hexToRgb(colorFront);
    state.transitionStart = performance.now();
    requestDrawRef.current?.();
  }, [colorBack, colorFront]);

  function lerpElapsed(state: typeof colorStateRef.current, which: 'back' | 'front'): Rgb {
    const now = performance.now();
    const t = Math.min(1, (now - state.transitionStart) / COLOR_TRANSITION_MS);
    return which === 'back' ? lerpRgb(state.fromBack, state.toBack, t) : lerpRgb(state.fromFront, state.toFront, t);
  }

  // One-time setup: canvas, offscreen buffer, animation loop, resize
  // observer. Intentionally excludes colorBack/colorFront so theme changes
  // never recreate the canvas or reset the animation clock.
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

      const state = colorStateRef.current;
      const colorT = Math.min(1, (time - state.transitionStart) / COLOR_TRANSITION_MS);
      const back = lerpRgb(state.fromBack, state.toBack, colorT);
      const front = lerpRgb(state.fromFront, state.toFront, colorT);

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

    const recolor = (time: number) => {
      draw(time);
      const state = colorStateRef.current;
      if (time - state.transitionStart < COLOR_TRANSITION_MS) {
        rafId = requestAnimationFrame(recolor);
      }
    };

    if (!reducedMotion) {
      const loop = (time: number) => {
        rafId = requestAnimationFrame(loop);
        if (document.hidden) return;
        if (time - lastDraw < frameInterval) return;
        lastDraw = time;
        draw(time);
      };
      rafId = requestAnimationFrame(loop);
      requestDrawRef.current = () => draw(performance.now());
    } else {
      // Reduced motion: no continuous loop, but still let an in-flight
      // color transition (theme switch) play out as a few static redraws.
      requestDrawRef.current = () => {
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(recolor);
      };
    }

    const observer = new ResizeObserver(() => {
      resize();
      draw(performance.now());
    });
    observer.observe(container);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      observer.disconnect();
      requestDrawRef.current = null;
    };
  }, [speed, pxSize]);

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
