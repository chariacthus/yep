'use client';

import { animate, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

/**
 * A number that springs to its new value rather than snapping.
 *
 * Used for the live counters during a sweep, where a jump from 340 to 380 in one
 * frame reads as a glitch but the same change animated reads as progress.
 *
 * When the viewer prefers reduced motion the value is rendered directly, with no
 * state and no effect — there is nothing to animate, so there is nothing to
 * schedule.
 */
export function Counter({ value, className }: { value: number; className?: string }) {
  const reduced = useReducedMotion();

  return reduced ? (
    <span className={`tabular ${className ?? ''}`}>{value.toLocaleString()}</span>
  ) : (
    <AnimatedCounter value={value} className={className} />
  );
}

function AnimatedCounter({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const previous = useRef(value);

  useEffect(() => {
    const controls = animate(previous.current, value, {
      duration: 0.5,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => setShown(Math.round(latest)),
    });
    previous.current = value;
    return () => controls.stop();
  }, [value]);

  return <span className={`tabular ${className ?? ''}`}>{shown.toLocaleString()}</span>;
}
