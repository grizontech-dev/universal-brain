'use client';

import { useCallback } from 'react';
import { parseColor, toColorValue, RGBA_VARS } from './utils';

interface Props {
  varName: string;
  value: string;
  onChange: (varName: string, value: string) => void;
}

export default function ColorInput({ varName, value, onChange }: Props) {
  const isRgba = RGBA_VARS.has(varName);
  const { hex, alpha } = parseColor(value);

  const handleHex = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newHex = e.target.value;
      onChange(varName, toColorValue(newHex, alpha, isRgba));
    },
    [varName, alpha, isRgba, onChange],
  );

  const handleAlpha = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newAlpha = parseFloat(e.target.value);
      onChange(varName, toColorValue(hex, newAlpha, true));
    },
    [varName, hex, onChange],
  );

  return (
    <div className='flex items-center gap-2'>
      {/* Swatch + native color picker */}
      <label className='relative cursor-pointer shrink-0'>
        <div
          className='w-7 h-7 rounded-md border border-border-default cursor-pointer'
          style={{ background: hex }}
        />
        <input
          type='color'
          value={hex}
          onChange={handleHex}
          className='absolute inset-0 opacity-0 cursor-pointer w-full h-full'
        />
      </label>

      {/* Hex value display */}
      <span className='text-[10px] font-mono text-text-muted w-16 shrink-0'>{hex}</span>

      {/* Opacity slider — only for rgba vars */}
      {isRgba && (
        <div className='flex items-center gap-1.5 flex-1 min-w-0'>
          <input
            type='range'
            min={0}
            max={1}
            step={0.01}
            value={alpha}
            onChange={handleAlpha}
            className='flex-1 h-1 accent-accent min-w-0'
          />
          <span className='text-[10px] font-mono text-text-muted w-8 text-right shrink-0'>
            {Math.round(alpha * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}
