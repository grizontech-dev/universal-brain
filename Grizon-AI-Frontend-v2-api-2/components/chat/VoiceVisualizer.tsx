'use client';

import React, { useEffect, useRef, useState } from 'react';

/**
 * VoiceVisualizerProps defines the interface for the interactive Siri Mode.
 */
export interface VoiceVisualizerProps {
  isActive: boolean;    // Is the user currently speaking/mic active?
  isSpeaking?: boolean; // Is the AI currently responding via TTS?
  isThinking?: boolean; // Is the LLM processing the request?
  onClose?: () => void; // Callback to exit Siri Mode
}

export default function VoiceVisualizer({ 
  isActive, 
  isSpeaking = false, 
  isThinking = false, 
  onClose 
}: VoiceVisualizerProps) {
  const [volume, setVolume] = useState(0);
  const audioContextRef = useRef<AudioContext>(null);
  const analyserRef = useRef<AnalyserNode>(null);
  const streamRef = useRef<MediaStream>(null);
  const animationRef = useRef<number>(null);

  // Microphone Volume Sampling
  useEffect(() => {
    if (isActive && !isSpeaking && !isThinking) {
      const startMic = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          streamRef.current = stream;
          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
          const analyser = audioContext.createAnalyser();
          const source = audioContext.createMediaStreamSource(stream);
          analyser.fftSize = 256;
          source.connect(analyser);
          audioContextRef.current = audioContext;
          analyserRef.current = analyser;
        } catch (err) {
          console.error('Mic access error:', err);
        }
      };
      startMic();
    } else {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    }
    return () => streamRef.current?.getTracks().forEach(t => t.stop());
  }, [isActive, isSpeaking, isThinking]);

  // Smoothed Volume Control loop
  useEffect(() => {
    const updateVolume = () => {
      let currentVol = 0;
      if (analyserRef.current && isActive) {
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);
        const range = dataArray.slice(4, 32); 
        currentVol = range.reduce((a, b) => a + b) / (range.length * 140);
      } else if (isSpeaking) {
        const t = Date.now() / 1000;
        currentVol = 0.3 + Math.abs(Math.sin(t * 12)) * 0.4 + (Math.random() * 0.2);
      } else if (isThinking) {
        currentVol = 0.05 + Math.sin(Date.now() / 400) * 0.03;
      }

      setVolume(v => v * 0.7 + Math.min(1.0, currentVol) * 0.3);
      animationRef.current = requestAnimationFrame(updateVolume);
    };
    updateVolume();
    return () => {
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
    }
  }, [isActive, isSpeaking, isThinking]);

  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-[#050507] overflow-hidden animate-nebula">
      
      {/* Dynamic Background Atmosphere */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Deep atmospheric glows */}
        <div className={`absolute top-[-20%] left-[-10%] w-[80%] h-[80%] rounded-full blur-[140px] transition-all duration-[2000ms] ${isSpeaking ? 'bg-[#976df8]/20 opacity-100' : 'bg-[#976df8]/5 opacity-40'}`} />
        <div className={`absolute bottom-[-20%] right-[-10%] w-[80%] h-[80%] rounded-full blur-[140px] transition-all duration-[2000ms] ${isThinking ? 'bg-blue-600/20 opacity-100' : 'bg-purple-600/5 opacity-40'}`} />
        
        {/* Animated Particles System */}
        <div className="absolute inset-0">
            {[...Array(20)].map((_, i) => (
                <div 
                    key={i}
                    className="absolute w-1 h-1 bg-white/10 rounded-full animate-float"
                    style={{
                        top: `${Math.random() * 100}%`,
                        left: `${Math.random() * 100}%`,
                        animationDuration: `${10 + Math.random() * 20}s`,
                        animationDelay: `${-Math.random() * 20}s`,
                        opacity: 0.1 + Math.random() * 0.3
                    }}
                />
            ))}
        </div>

        {/* Cinematic Scanlines */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.1)_50%),linear-gradient(90deg,rgba(255,0,0,0.01),rgba(0,255,0,0.005),rgba(0,0,255,0.01))] bg-[length:100%_4px,3px_100%] pointer-events-none opacity-20" />
      </div>

      {/* Hero Exit Button */}
      <button
        onClick={onClose}
        className="absolute top-10 right-10 z-[300] group"
      >
        <div className="relative w-12 h-12 flex items-center justify-center rounded-full bg-white/5 border border-white/10 hover:border-[#976df8]/50 transition-all duration-500 overflow-hidden">
            <div className="absolute inset-0 bg-white/0 group-hover:bg-white/5 transition-colors" />
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-white/40 group-hover:text-white group-hover:rotate-90 transition-all duration-500">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
        </div>
      </button>

      {/* Central Interactive Core */}
      <div className="relative w-full max-w-[min(400px,80vw,50vh)] aspect-square flex items-center justify-center">
        
        {/* Halo Effect */}
        <div className={`absolute inset-[-15%] rounded-full blur-[100px] transition-all duration-1000 ${isSpeaking ? 'bg-[#976df8]/30 scale-110' : isThinking ? 'bg-blue-600/20 scale-105' : 'bg-[#976df8]/10 scale-100'}`} />

        {/* Orbiting Tech Rings */}
        <div className="absolute inset-0 pointer-events-none opacity-40">
            <div className="absolute inset-[-20%] border border-white/5 rounded-full animate-[spin_30s_linear_infinite]" />
            <div className="absolute inset-[-30%] border border-white/[0.02] rounded-full animate-[spin_45s_linear_infinite_reverse]" />
        </div>

        {/* The Main Container (Orb) */}
        <div className="relative z-[200] w-full aspect-square rounded-full p-[2px] bg-gradient-to-tr from-white/20 via-white/5 to-transparent border border-white/10 shadow-[0_30px_100px_rgba(0,0,0,0.8)] overflow-hidden">
            <div className="w-full h-full rounded-full overflow-hidden bg-[#0c0c0f] relative">
                
                {/* AI Entity Visualization */}
                <img 
                  src="/images/avatar.gif" 
                  alt="AI Core Active" 
                  className={`absolute inset-0 w-full h-full object-cover transition-all duration-1000 select-none ${isSpeaking ? 'opacity-100 scale-100' : 'opacity-0 scale-110'} brightness-[110%]`}
                />

                <img 
                  src="/images/image.png" 
                  alt="AI Core Standby" 
                  className={`absolute inset-0 w-full h-full object-cover transition-all duration-1000 select-none ${isSpeaking ? 'opacity-0 scale-90' : 'opacity-100 scale-100'}`}
                />
                
                {/* Volumetric Light Rays */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 pointer-events-none" />
                <div className={`absolute inset-0 bg-[#976df8]/10 transition-opacity duration-1000 ${isSpeaking ? 'opacity-100' : 'opacity-0'} mix-blend-overlay`} />
            </div>
            
            {/* Real-time Voice Halo */}
            {(isSpeaking || (isActive && volume > 0.02)) && (
               <div 
                 className="absolute inset-0 rounded-full border-[6px] border-[#976df8]/20 animate-pulse" 
                 style={{ transform: `scale(${1 + volume * 0.1})` }}
               />
            )}
        </div>

        {/* Fluid Frequency Waveform */}
        <div className="absolute bottom-[-15%] w-[130%] h-32 flex items-center justify-center gap-[4px] pointer-events-none">
           {[...Array(40)].map((_, i) => (
             <div 
               key={i} 
               className="w-[3px] bg-gradient-to-t from-[#976df8] via-purple-400 to-white/40 rounded-full transition-all duration-100" 
               style={{ 
                 height: `${Math.max(6, volume * 100 * (1 - Math.abs(i - 20)/24) * (0.7 + Math.random() * 0.6))}%`,
                 opacity: 0.1 + (volume * 0.9),
                 transform: `translateY(${Math.sin(i * 0.3 + Date.now() * 0.01) * 8}px)`,
                 boxShadow: volume > 0.3 ? `0 0 15px rgba(151, 109, 248, ${volume * 0.4})` : 'none'
               }} 
             />
           ))}
        </div>
      </div>

      {/* HUD & Metadata */}
      <div className="mt-24 text-center px-10 max-w-xl z-[210]">
        <div className="flex flex-col items-center gap-4">
            <div className="flex items-center gap-3 py-1.5 px-3 rounded-full bg-white/5 border border-white/10">
                <div className={`w-1.5 h-1.5 rounded-full ${isThinking ? 'bg-blue-400 animate-pulse' : (isSpeaking || volume > 0.02) ? 'bg-[#976df8]' : 'bg-white/20'}`} />
                <span className="text-[10px] font-bold text-white/40 tracking-[0.2em] uppercase">
                    {isThinking ? 'Processing Intelligence' : (isSpeaking || (isActive && volume > 0.02)) ? 'Real-time Interaction' : 'Neural Link Standby'}
                </span>
            </div>

            <h2 className="text-5xl font-black text-white tracking-tighter italic uppercase leading-none">
              {isThinking ? 'Thinking' : (isSpeaking || (isActive && volume > 0.02)) ? 'Active' : 'Offline'}
            </h2>
            
            <p className="text-[13px] text-white/30 font-medium tracking-wide max-w-xs">
                 The Grizon engine is listening for your next prompt.
            </p>
        </div>
      </div>

      {/* Visual Tech Brackets */}
      <div className="absolute inset-20 border border-white/[0.03] rounded-[4rem] pointer-events-none" />

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes nebula {
          0% { filter: hue-rotate(0deg) brightness(1); }
          50% { filter: hue-rotate(45deg) brightness(1.2); }
          100% { filter: hue-rotate(0deg) brightness(1); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0) translateX(0); }
          25% { transform: translateY(-30px) translateX(15px); }
          50% { transform: translateY(-15px) translateX(-30px); }
          75% { transform: translateY(15px) translateX(15px); }
        }
        .animate-nebula {
          animation: nebula 15s ease-in-out infinite;
        }
        .animate-float {
          animation: float linear infinite;
        }
      ` }} />
    </div>
  );
}
