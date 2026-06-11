'use client';

import { useRef, useCallback } from 'react';

interface NeonHeadlineProps {
  line1: string;
  line2: string;
  /** CSS color value for the neon glow, defaults to the primary color */
  glowColor?: string;
}

export function NeonHeadline({
  line1,
  line2,
  glowColor = 'var(--color-neon-glow)',
}: NeonHeadlineProps) {
  const containerRef = useRef<HTMLHeadingElement>(null);
  const rafRef = useRef<number>(0);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLHeadingElement>) => {
    const x = e.clientX;
    const y = e.clientY;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const chars = containerRef.current?.querySelectorAll<HTMLSpanElement>('.neon-char');
      if (!chars) return;
      chars.forEach((char) => {
        const rect = char.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        const maxDist = 120;
        const intensity = Math.max(0, 1 - dist / maxDist);
        const neonValue = intensity > 0.01
          ? `color-mix(in srgb, ${glowColor} ${Math.round(intensity * 100)}%, transparent)`
          : 'transparent';
        char.style.setProperty('--neon-color', neonValue);
      });
    });
  }, [glowColor]);

  const handleMouseLeave = useCallback(() => {
    const chars = containerRef.current?.querySelectorAll<HTMLSpanElement>('.neon-char');
    chars?.forEach((char) => char.style.setProperty('--neon-color', 'transparent'));
  }, []);

  const renderWord = (word: string, keyPrefix: string) =>
    word.split('').map((char, i) => (
      <span
        key={`${keyPrefix}-${i}`}
        className="neon-char"
        style={{ '--neon-color': 'transparent' } as React.CSSProperties}
      >
        {char === ' ' ? '\u00a0' : char}
      </span>
    ));

  const renderLine = (text: string, lineKey: string) =>
    text.split(' ').map((word, wi) => (
      <span key={`${lineKey}-w${wi}`} className="neon-word">
        {renderWord(word, `${lineKey}-w${wi}`)}
        {wi < text.split(' ').length - 1 ? '\u00a0' : ''}
      </span>
    ));

  return (
    <>
      <style>{`
        .neon-char {
          display: inline-block;
          text-shadow:
            0 0 5px  var(--neon-color),
            0 0 10px var(--neon-color),
            0 0 20px var(--neon-color),
            0 0 40px var(--neon-color),
            0 0 80px var(--neon-color);
        }
        .neon-word {
          display: inline-block;
          white-space: nowrap;
        }
      `}</style>
      <h1
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="text-5xl sm:text-6xl md:text-8xl font-black tracking-[-0.04em] leading-[0.95] mb-8 max-w-5xl cursor-default select-none text-fd-foreground"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        <span>{renderLine(line1, 'l1')}</span>
        <br />
        <span style={{ color: 'var(--color-fd-primary)' }}>
          {renderLine(line2, 'l2')}
        </span>
      </h1>
    </>
  );
}
