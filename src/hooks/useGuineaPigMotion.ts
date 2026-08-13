import { useCallback, useEffect, useRef, useState } from 'react';

export type GuineaPigPhase = 'walking' | 'pausing' | 'sniffing';

// 0 = bottom edge, 1 = right edge, 2 = top edge, 3 = left edge.
export type Edge = 0 | 1 | 2 | 3;

export interface Poop {
  id: number;
  edge: Edge;
  along: number;
}

export interface GuineaPigState {
  perimeterT: number; // 0..4 — edge = floor(t), along = t - edge
  direction: 1 | -1;
  phase: GuineaPigPhase;
  earTwitch: boolean;
}

export interface GuineaPigMotion extends GuineaPigState {
  poops: Poop[];
  triggerPoop: () => void;
}

const START_T = 0.15;
// How far "behind" the guinea pig (opposite its direction of travel) a
// click-triggered poop lands, in perimeterT units.
const POOP_BEHIND_OFFSET = 0.035;

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function normalizeT(t: number) {
  const m = t % 4;
  return m < 0 ? m + 4 : m;
}

interface TickRefs {
  walkTicksLeft: { current: number };
}

function newWalkBurstTicks() {
  // 3-8s of ambient walking, ticked at ~750ms each.
  return Math.max(1, Math.round(rand(3000, 8000) / 750));
}

function pickNext(prev: GuineaPigState, refs: TickRefs): { state: GuineaPigState; delay: number } {
  switch (prev.phase) {
    case 'walking': {
      const step = rand(0.016, 0.03) * prev.direction;
      const perimeterT = normalizeT(prev.perimeterT + step);
      refs.walkTicksLeft.current -= 1;
      if (refs.walkTicksLeft.current > 0) {
        return { state: { ...prev, perimeterT }, delay: rand(600, 900) };
      }
      return { state: { ...prev, perimeterT, phase: 'pausing' }, delay: rand(1000, 3000) };
    }
    case 'pausing': {
      const roll = Math.random();
      if (roll < 0.5) {
        return { state: { ...prev, phase: 'sniffing' }, delay: rand(550, 900) };
      }
      let direction = prev.direction;
      if (Math.random() < 0.3) direction = direction === 1 ? -1 : 1;
      refs.walkTicksLeft.current = newWalkBurstTicks();
      return { state: { ...prev, phase: 'walking', direction }, delay: rand(700, 1000) };
    }
    case 'sniffing': {
      refs.walkTicksLeft.current = newWalkBurstTicks();
      return { state: { ...prev, phase: 'walking' }, delay: rand(700, 1000) };
    }
  }
}

export function useGuineaPigMotion(reducedMotion: boolean): GuineaPigMotion {
  const [state, setState] = useState<GuineaPigState>({
    perimeterT: START_T,
    direction: 1,
    phase: 'pausing',
    earTwitch: false,
  });
  const [poops, setPoops] = useState<Poop[]>([]);
  const walkTicksLeft = useRef(0);
  const poopIdCounter = useRef(0);
  // Kept in sync every render so triggerPoop (a click handler, not part of
  // the tick loop) can read the current position without a stale closure.
  const stateRef = useRef(state);
  stateRef.current = state;

  const triggerPoop = useCallback(() => {
    // No cooldown — click as fast as you want, they pile up.
    const { perimeterT, direction } = stateRef.current;
    // Small jitter per click so rapid-fire clicks fan out into a little pile
    // instead of stacking exactly on top of each other.
    const jitter = rand(-0.018, 0.018);
    const behindT = normalizeT(perimeterT - direction * POOP_BEHIND_OFFSET + jitter);
    const edge = Math.floor(behindT) as Edge;
    const along = behindT - edge;
    poopIdCounter.current += 1;

    // Truly unlimited — no FIFO cap, pile up as many as you click.
    setPoops((prev) => [...prev, { id: poopIdCounter.current, edge, along }]);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;

    let timeoutId = 0;
    let earTimeoutId = 0;
    let cancelled = false;

    const refs: TickRefs = { walkTicksLeft };

    function scheduleTick(delay: number) {
      timeoutId = window.setTimeout(tick, delay);
    }

    function tick() {
      if (cancelled) return;
      setState((prev) => {
        const { state: next, delay } = pickNext(prev, refs);
        scheduleTick(delay);
        return next;
      });
    }

    function scheduleEarTwitch() {
      earTimeoutId = window.setTimeout(() => {
        if (cancelled) return;
        setState((prev) => (prev.phase === 'pausing' ? { ...prev, earTwitch: true } : prev));
        window.setTimeout(() => {
          if (cancelled) return;
          setState((prev) => (prev.earTwitch ? { ...prev, earTwitch: false } : prev));
        }, 420);
        scheduleEarTwitch();
      }, rand(2500, 5500));
    }

    scheduleTick(rand(900, 1600));
    scheduleEarTwitch();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      window.clearTimeout(earTimeoutId);
    };
  }, [reducedMotion]);

  return { ...state, poops, triggerPoop };
}
