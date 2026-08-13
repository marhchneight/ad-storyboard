import { memo, useEffect, useState } from 'react';
import { useGuineaPigMotion } from '../hooks/useGuineaPigMotion';

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

// A quiet studio mascot: a small pixel-inspired guinea pig that ambles along
// the bottom of the login page — move a couple of steps, pause, sniff, look
// around, repeat. Position/phase live in useGuineaPigMotion and are entirely
// independent of theme; this component takes no color props at all, so a
// theme toggle never touches its animation state, only CSS custom properties
// resolved from [data-theme] repaint the existing DOM in place.
function GuineaPigImpl() {
  const reducedMotion = useReducedMotion();
  const { xPercent, direction, phase, earTwitch } = useGuineaPigMotion(reducedMotion);

  const rootClassName = [
    'guinea-pig',
    `gp-${phase}`,
    earTwitch ? 'gp-ear-twitch' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="guinea-pig-stage" aria-hidden="true">
      <div
        className={rootClassName}
        style={{
          left: `${xPercent}%`,
          transform: `translateX(-50%) scaleX(${direction})`,
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
  );
}

const GuineaPig = memo(GuineaPigImpl);
export default GuineaPig;
