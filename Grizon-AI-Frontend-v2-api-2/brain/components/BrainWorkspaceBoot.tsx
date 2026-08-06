import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const BOOT_STEPS = [
  'Initializing workspace…',
  'Spinning up sandbox…',
  'Loading project templates…',
  'Preparing build environment…',
  'Generating build tasks…',
];

export default function BrainWorkspaceBoot() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % BOOT_STEPS.length), 2200);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-10 bg-[#0d0d0d] relative overflow-hidden">
      {/* faint grid backdrop */}
      <div
        className="absolute inset-0 opacity-[0.12] pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(ellipse at center, black 25%, transparent 75%)',
        }}
      />

      {/* rotating conic ring + glowing core */}
      <div className="relative w-28 h-28">
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              'conic-gradient(from 0deg, transparent 0%, #a855f7 20%, #6366f1 45%, #22d3ee 65%, transparent 90%)',
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
        />
        <div className="absolute inset-[5px] rounded-full bg-[#0d0d0d]" />
        <motion.div
          className="absolute inset-[5px] rounded-full bg-gradient-to-br from-purple-500/40 to-cyan-400/40 blur-xl"
          animate={{ opacity: [0.35, 0.85, 0.35], scale: [1, 1.12, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute inset-0 flex items-center justify-center"
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        >
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-500 to-cyan-400 opacity-80" />
        </motion.div>
      </div>

      {/* cycling status line */}
      <div className="relative flex flex-col items-center gap-5 min-h-[84px]">
        <AnimatePresence mode="wait">
          <motion.p
            key={step}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="text-white/70 text-sm tracking-wide font-medium"
          >
            {BOOT_STEPS[step]}
          </motion.p>
        </AnimatePresence>

        {/* step dots */}
        <div className="flex items-center gap-2">
          {BOOT_STEPS.map((_, i) => (
            <motion.span
              key={i}
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: i === step ? '#a855f7' : 'rgba(255,255,255,0.22)' }}
              animate={{ scale: i === step ? 1.4 : 1, opacity: i === step ? 1 : 0.6 }}
              transition={{ duration: 0.3 }}
            />
          ))}
        </div>

        {/* shimmer progress bar */}
        <div className="w-56 h-[3px] rounded-full bg-white/[0.07] overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-purple-500 via-indigo-400 to-cyan-400"
            animate={{ x: ['-100%', '100%'] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            style={{ width: '60%' }}
          />
        </div>
      </div>
    </div>
  );
}
