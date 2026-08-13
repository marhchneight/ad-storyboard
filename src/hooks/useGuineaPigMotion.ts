import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export type GuineaPigPhase = 'walking' | 'pausing' | 'sniffing';
export type Facing = 1 | -1;

export interface Poop {
  id: number;
  // Fixed viewport-pixel coordinates, computed once at click time from the
  // guinea pig's actual bounding box + facing — never touched again, even
  // as the guinea pig keeps roaming.
  x: number;
  y: number;
}

export interface GuineaPigMotion {
  guineaPigRef: RefObject<HTMLDivElement | null>;
  phase: GuineaPigPhase;
  earTwitch: boolean;
  poops: Poop[];
  triggerPoop: () => void;
}

interface Size {
  w: number;
  h: number;
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const DESKTOP_SIZE: Size = { w: 64, h: 40 };
const MOBILE_SIZE: Size = { w: 44, h: 28 };
const MOBILE_BREAKPOINT = 640;
const PADDING = 24;
const MOBILE_PADDING = 16;
const CARD_MARGIN = 32;
const TOGGLE_MARGIN = 16;
const ARRIVE_THRESHOLD = 6;
const BASE_SPEED = 46; // px/s
const EASE_DISTANCE = 140; // px — movement eases down as it nears the target
const REACTION_MS = 450; // brief movement pause after a poop click

// Local sprite anchors as a fraction of (width, height), already expressed
// in on-screen terms per facing (the sprite mirrors via scaleX, and these
// two fractions are already mirror images of each other) — the butt sits
// low and toward the side opposite the head/nose.
const BUTT_ANCHOR: Record<Facing, { x: number; y: number }> = {
  1: { x: 0.08, y: 0.75 }, // facing right: head right, butt left
  [-1]: { x: 0.92, y: 0.75 }, // facing left: head left, butt right
};

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function getSize(): Size {
  return window.innerWidth <= MOBILE_BREAKPOINT ? MOBILE_SIZE : DESKTOP_SIZE;
}

function getPadding(): number {
  return window.innerWidth <= MOBILE_BREAKPOINT ? MOBILE_PADDING : PADDING;
}

function getBounds(size: Size): Bounds {
  const padding = getPadding();
  return {
    minX: padding,
    maxX: Math.max(padding, window.innerWidth - size.w - padding),
    minY: padding,
    maxY: Math.max(padding, window.innerHeight - size.h - padding),
  };
}

function expandRect(rect: DOMRect, margin: number): Rect {
  return {
    left: rect.left - margin,
    top: rect.top - margin,
    right: rect.right + margin,
    bottom: rect.bottom + margin,
  };
}

// The guinea pig's own position is tracked as its top-left corner (matches
// how forbidden-rect collision is checked), even though the DOM element
// itself is centered via translate(-50%, -50%) for rendering convenience.
function getForbiddenRects(): Rect[] {
  const rects: Rect[] = [];
  const card = document.querySelector('.auth-card');
  if (card) rects.push(expandRect(card.getBoundingClientRect(), CARD_MARGIN));
  const toggle = document.querySelector('.theme-toggle');
  if (toggle) rects.push(expandRect(toggle.getBoundingClientRect(), TOGGLE_MARGIN));
  return rects;
}

function overlapsAny(x: number, y: number, size: Size, rects: Rect[]): boolean {
  return rects.some(
    (r) => x < r.right && x + size.w > r.left && y < r.bottom && y + size.h > r.top
  );
}

function pickTarget(bounds: Bounds, size: Size, forbidden: Rect[]): { x: number; y: number } {
  for (let i = 0; i < 40; i++) {
    const x = rand(bounds.minX, bounds.maxX);
    const y = rand(bounds.minY, bounds.maxY);
    if (!overlapsAny(x, y, size, forbidden)) return { x, y };
  }
  // Fallback: top-left corner of the safe area is never inside a
  // reasonably-sized card/toggle exclusion zone.
  return { x: bounds.minX, y: bounds.minY };
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export function useGuineaPigMotion(reducedMotion: boolean): GuineaPigMotion {
  const guineaPigRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<GuineaPigPhase>('pausing');
  const [earTwitch, setEarTwitch] = useState(false);
  const [poops, setPoops] = useState<Poop[]>([]);
  const poopIdCounter = useRef(0);

  // Top-left corner, in viewport px. Mutated every frame by the rAF loop and
  // written straight to the DOM — never routed through React state, so
  // there's no stale-frame risk when a click reads it mid-motion.
  const positionRef = useRef({ x: 0, y: 0 });
  const targetRef = useRef({ x: 0, y: 0 });
  const facingRef = useRef<Facing>(1);
  const movingRef = useRef(false);
  const reactionUntilRef = useRef(0);
  const sizeRef = useRef<Size>(DESKTOP_SIZE);

  function applyTransform() {
    const el = guineaPigRef.current;
    if (!el) return;
    el.style.left = `${positionRef.current.x}px`;
    el.style.top = `${positionRef.current.y}px`;
    el.style.transform = `scaleX(${facingRef.current})`;
  }

  const triggerPoop = useCallback(() => {
    const size = sizeRef.current;
    const facing = facingRef.current;
    const anchor = BUTT_ANCHOR[facing];
    const worldX = positionRef.current.x + anchor.x * size.w;
    const worldY = positionRef.current.y + anchor.y * size.h;
    poopIdCounter.current += 1;
    setPoops((prev) => [...prev, { id: poopIdCounter.current, x: worldX, y: worldY }]);

    // Brief pause, then resume toward whatever target was already set —
    // no new target is chosen because of a click.
    reactionUntilRef.current = performance.now() + REACTION_MS;
  }, []);

  useLayoutEffect(() => {
    const size = getSize();
    sizeRef.current = size;
    const bounds = getBounds(size);
    // Start somewhere already inside the safe area, away from the card by
    // construction (top-left-ish corner), then pick a first real target
    // shortly after mount.
    positionRef.current = { x: bounds.minX, y: bounds.minY };
    targetRef.current = { ...positionRef.current };
    applyTransform();

    if (reducedMotion) {
      return;
    }

    let rafId = 0;
    let sniffTimeoutId = 0;
    let pauseTimeoutId = 0;
    let earTimeoutId = 0;
    let cancelled = false;
    let lastTime = performance.now();

    function scheduleNextTarget(delay: number) {
      pauseTimeoutId = window.setTimeout(() => {
        if (cancelled) return;
        const s = sizeRef.current;
        targetRef.current = pickTarget(getBounds(s), s, getForbiddenRects());
        movingRef.current = true;
        setPhase('walking');
      }, delay);
    }

    function arrive() {
      movingRef.current = false;
      setPhase('pausing');
      const willSniff = Math.random() < 0.5;
      if (willSniff) {
        sniffTimeoutId = window.setTimeout(() => {
          if (cancelled) return;
          setPhase('sniffing');
        }, rand(150, 400));
      }
      scheduleNextTarget(rand(1200, 3000));
    }

    function loop(now: number) {
      rafId = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      if (now < reactionUntilRef.current) {
        applyTransform();
        return;
      }

      if (movingRef.current) {
        const dx = targetRef.current.x - positionRef.current.x;
        const dy = targetRef.current.y - positionRef.current.y;
        const dist = Math.hypot(dx, dy);
        if (dist < ARRIVE_THRESHOLD) {
          positionRef.current = { ...targetRef.current };
          arrive();
        } else {
          const ease = Math.min(1, dist / EASE_DISTANCE);
          const speed = BASE_SPEED * (0.35 + 0.65 * ease);
          const moveDist = Math.min(dist, speed * dt);
          const t = moveDist / dist;
          positionRef.current = {
            x: positionRef.current.x + dx * t,
            y: positionRef.current.y + dy * t,
          };
          if (Math.abs(dx) > 0.5) facingRef.current = dx > 0 ? 1 : -1;
        }
      }
      applyTransform();
    }

    function scheduleEarTwitch() {
      earTimeoutId = window.setTimeout(() => {
        if (cancelled) return;
        setEarTwitch(true);
        window.setTimeout(() => {
          if (cancelled) return;
          setEarTwitch(false);
        }, 420);
        scheduleEarTwitch();
      }, rand(2500, 5500));
    }

    function onResize() {
      const s = getSize();
      sizeRef.current = s;
      const b = getBounds(s);
      positionRef.current = {
        x: clamp(positionRef.current.x, b.minX, b.maxX),
        y: clamp(positionRef.current.y, b.minY, b.maxY),
      };
      targetRef.current = {
        x: clamp(targetRef.current.x, b.minX, b.maxX),
        y: clamp(targetRef.current.y, b.minY, b.maxY),
      };
      applyTransform();
    }

    rafId = requestAnimationFrame(loop);
    scheduleNextTarget(rand(600, 1400));
    scheduleEarTwitch();
    window.addEventListener('resize', onResize);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      window.clearTimeout(sniffTimeoutId);
      window.clearTimeout(pauseTimeoutId);
      window.clearTimeout(earTimeoutId);
      window.removeEventListener('resize', onResize);
    };
  }, [reducedMotion]);

  return { guineaPigRef, phase, earTwitch, poops, triggerPoop };
}
