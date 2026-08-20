import React, { useEffect, useState } from 'react';

interface CountUpProps {
  to?: number;
  duration?: number;
  separator?: string;
  decimals?: number;
}

export const CountUp: React.FC<CountUpProps> = ({
  to = 0,
  duration = 0.8,
  decimals = 0,
}) => {
  const target = typeof to === 'number' && !isNaN(to) ? to : 0;
  const [val, setVal] = useState(0);

  useEffect(() => {
    let startTimestamp: number | null = null;
    let animationFrameId: number;

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / (duration * 1000), 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      setVal(easeOut * target);
      if (progress < 1) {
        animationFrameId = window.requestAnimationFrame(step);
      }
    };
    animationFrameId = window.requestAnimationFrame(step);

    return () => {
      if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
    };
  }, [target, duration]);

  const safeVal = isNaN(val) ? 0 : val;
  const formatted = decimals > 0 ? safeVal.toFixed(decimals) : Math.floor(safeVal).toLocaleString();
  return <span>{formatted}</span>;
};

export default CountUp;
