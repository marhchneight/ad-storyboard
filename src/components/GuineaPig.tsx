import { memo, useEffect, useState } from 'react';
import { useGuineaPigMotion, type Edge } from '../hooks/useGuineaPigMotion';

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

// edge: 0 bottom, 1 right, 2 top, 3 left. Position is relative to the inset
// "track" box (see .guinea-pig-track), so 0%/100% already sit just inside
// the viewport edge rather than flush against it.
function edgePosition(edge: Edge, along: number): { left: number; top: number } {
  switch (edge) {
    case 0: return { left: along * 100, top: 100 };
    case 1: return { left: 100, top: (1 - along) * 100 };
    case 2: return { left: (1 - along) * 100, top: 0 };
    case 3: return { left: 0, top: along * 100 };
  }
}

// Base facing angle per edge assuming clockwise travel (direction 1), chosen
// so the legs always point outward toward the nearest viewport edge and the
// head points along the direction of travel — like something walking around
// the inside rim of a picture frame, not upside-down relative to gravity.
const EDGE_ROTATION: Record<Edge, number> = { 0: 0, 1: -90, 2: 180, 3: 90 };

// A quiet studio mascot: a small pixel-inspired guinea pig that ambles around
// the inner rim of the login page — a few seconds of walking, a pause, maybe
// a sniff or a tiny poop, then onward. Position/phase/poop history live in
// useGuineaPigMotion and are entirely independent of theme; this component
// takes no color props at all, so a theme toggle never touches animation
// state, only CSS custom properties resolved from [data-theme] repaint the
// existing DOM in place.
function GuineaPigImpl() {
  const reducedMotion = useReducedMotion();
  const { perimeterT, direction, phase, earTwitch, poops } = useGuineaPigMotion(reducedMotion);

  const edge = Math.floor(perimeterT) as Edge;
  const along = perimeterT - edge;
  const { left, top } = edgePosition(edge, along);
  const rotation = EDGE_ROTATION[edge];

  const rootClassName = [
    'guinea-pig',
    `gp-${phase}`,
    earTwitch ? 'gp-ear-twitch' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="guinea-pig-stage" aria-hidden="true">
      <div className="guinea-pig-track">
        {poops.map((poop) => {
          const pos = edgePosition(poop.edge, poop.along);
          return (
            <svg
              key={poop.id}
              className="gp-poop"
              viewBox="0 0 12 8"
              width="12"
              height="8"
              style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
            >
              <circle cx="3" cy="4.5" r="1.3" />
              <circle cx="6.5" cy="2.6" r="1.5" />
              <circle cx="9.5" cy="4.8" r="1.2" />
            </svg>
          );
        })}
        <div
          className={rootClassName}
          style={{
            left: `${left}%`,
            top: `${top}%`,
            transform: `translate(-50%, -50%) rotate(${rotation}deg) scaleX(${direction})`,
          }}
        >
          <svg viewBox="0 0 64 40" width="64" height="40" className="gp-svg">
            <ellipse className="gp-ground-shadow" cx="30" cy="35" rx="20" ry="3" />
            <g className="gp-leg-back">
              <rect x="33" y="28" width="6" height="8" rx="2.5" />
            </g>
            <g className="gp-leg-front">
              <rect x="15" y="28" width="6" height="8" rx="2.5" />
            </g>
            <g className="gp-body-group">
              <rect className="gp-body" x="8" y="12" width="36" height="20" rx="10" />
              <rect className="gp-body-shade" x="8" y="24" width="36" height="8" rx="6" />
            </g>
            <g className="gp-head-group">
              <rect className="gp-ear gp-ear-left" x="39" y="5" width="6" height="7" rx="2.5" />
              <rect className="gp-ear gp-ear-right" x="47" y="4" width="6" height="7" rx="2.5" />
              <rect className="gp-head" x="37" y="9" width="19" height="17" rx="8.5" />
              <circle className="gp-eye" cx="47" cy="14" r="1.6" />
              <circle className="gp-nose" cx="54" cy="18.5" r="1.8" />
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}

const GuineaPig = memo(GuineaPigImpl);
export default GuineaPig;
