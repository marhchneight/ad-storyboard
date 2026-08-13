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

// A quiet studio mascot: a small pixel-inspired guinea pig that roams the
// login page freely — never crossing the login card — pausing, sniffing,
// and occasionally leaving a poop behind when clicked. Position is driven
// imperatively by useGuineaPigMotion (via guineaPigRef, updated every
// animation frame) rather than React state, so 60fps movement never
// re-renders this component. Phase/poop history are the only pieces of
// state React actually owns, and neither depends on theme — a theme toggle
// only repaints existing DOM via CSS custom properties.
function GuineaPigImpl() {
  const reducedMotion = useReducedMotion();
  const { guineaPigRef, phase, earTwitch, poops, triggerPoop } = useGuineaPigMotion(reducedMotion);

  const rootClassName = [
    'guinea-pig',
    `gp-${phase}`,
    earTwitch ? 'gp-ear-twitch' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="guinea-pig-stage" aria-hidden="true">
      <div className="guinea-pig-track">
        {poops.map((poop) => (
          <svg
            key={poop.id}
            className="gp-poop"
            viewBox="0 0 5 4"
            width="5"
            height="4"
            style={{ left: `${poop.x}px`, top: `${poop.y}px` }}
          >
            <rect x="0.4" y="0.5" width="4.2" height="3" rx="1.5" ry="1.3" />
          </svg>
        ))}
        <div ref={guineaPigRef} className={rootClassName} onClick={triggerPoop}>
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
