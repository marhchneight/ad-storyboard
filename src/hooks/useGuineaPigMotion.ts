import { useEffect, useRef, useState } from 'react';

export type GuineaPigPhase = 'walking' | 'pausing' | 'sniffing' | 'looking';

export interface GuineaPigState {
  xPercent: number;
  direction: 1 | -1;
  phase: GuineaPigPhase;
  earTwitch: boolean;
}

const MIN_X = 8;
const MAX_X = 92;
const START_X = 22;

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function pickNext(prev: GuineaPigState, stepsLeftRef: { current: number }): { state: GuineaPigState; delay: number } {
  switch (prev.phase) {
    case 'walking': {
      let direction = prev.direction;
      let xPercent = prev.xPercent + direction * rand(5, 9);
      if (xPercent <= MIN_X) {
        xPercent = MIN_X;
        direction = 1;
      } else if (xPercent >= MAX_X) {
        xPercent = MAX_X;
        direction = -1;
      }
      stepsLeftRef.current -= 1;
      if (stepsLeftRef.current > 0) {
        return {
          state: { ...prev, xPercent, direction },
          delay: rand(650, 950),
        };
      }
      return {
        state: { xPercent, direction, phase: 'pausing', earTwitch: false },
        delay: rand(900, 1700),
      };
    }
    case 'pausing': {
      const roll = Math.random();
      if (roll < 0.35) {
        return { state: { ...prev, phase: 'sniffing' }, delay: rand(550, 900) };
      }
      if (roll < 0.65) {
        return { state: { ...prev, phase: 'looking' }, delay: rand(650, 1000) };
      }
      let direction = prev.direction;
      // Occasionally turn around even mid-field, otherwise keep ambling the same way.
      if (Math.random() < 0.25) direction = direction === 1 ? -1 : 1;
      if (prev.xPercent <= MIN_X + 3) direction = 1;
      if (prev.xPercent >= MAX_X - 3) direction = -1;
      stepsLeftRef.current = 2 + Math.floor(Math.random() * 2);
      return { state: { ...prev, phase: 'walking', direction }, delay: rand(700, 1000) };
    }
    case 'sniffing':
    case 'looking': {
      stepsLeftRef.current = 2 + Math.floor(Math.random() * 2);
      return { state: { ...prev, phase: 'walking' }, delay: rand(700, 1000) };
    }
  }
}

export function useGuineaPigMotion(reducedMotion: boolean): GuineaPigState {
  const [state, setState] = useState<GuineaPigState>({
    xPercent: START_X,
    direction: 1,
    phase: 'pausing',
    earTwitch: false,
  });
  const stepsLeftRef = useRef(0);

  useEffect(() => {
    if (reducedMotion) return;

    let timeoutId = 0;
    let earTimeoutId = 0;
    let cancelled = false;

    function scheduleTick(delay: number) {
      timeoutId = window.setTimeout(tick, delay);
    }

    function tick() {
      if (cancelled) return;
      setState((prev) => {
        const { state: next, delay } = pickNext(prev, stepsLeftRef);
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

  return state;
}
