'use client';

import React, { useEffect, useRef, useState } from 'react';

export interface SiriSpeakingVisualizerProps {
  onClose?: () => void;
  statusText?: string;
  transcription?: string;
  userPrompt?: string;
}

export default function SiriSpeakingVisualizer({ onClose, statusText = "Speaking", transcription = "Processing...", userPrompt }: SiriSpeakingVisualizerProps) {
  const particleCanvasRef = useRef<HTMLCanvasElement>(null);
  const waveCanvasRef = useRef<HTMLCanvasElement>(null);

  // Canvas Particles & Waves
  useEffect(() => {
    const pC = particleCanvasRef.current;
    const wC = waveCanvasRef.current;
    if (!pC || !wC) return;
    const pX = pC.getContext('2d');
    const wX = wC.getContext('2d');
    if (!pX || !wX) return;

    let ps: any[] = [];
    let mX = window.innerWidth / 2;
    let mY = window.innerHeight / 2;

    function resize() {
      if (!pC || !wC) return;
      pC.width = wC.width = window.innerWidth;
      pC.height = wC.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    const handleMouseMove = (e: MouseEvent) => {
      mX = e.clientX;
      mY = e.clientY;
    };
    window.addEventListener('mousemove', handleMouseMove);

    class Particle {
      x: number = 0;
      y: number = 0;
      s: number = 0;
      vx: number = 0;
      vy: number = 0;
      o: number = 0;
      hue: number = 0;
      life: number = 0;
      age: number = 0;

      constructor() {
        this.reset();
      }

      reset() {
        if (!pC) return;
        this.x = Math.random() * pC.width;
        this.y = Math.random() * pC.height;
        this.s = Math.random() * 2.5 + 0.3;
        this.vx = (Math.random() - 0.5) * 0.5;
        this.vy = (Math.random() - 0.5) * 0.5;
        this.o = Math.random() * 0.3 + 0.06;
        this.hue = [260, 270, 245][Math.floor(Math.random() * 3)];
        this.life = Math.random() * 600 + 300;
        this.age = Math.random() * this.life;
      }

      update() {
        if (!pC) return;
        const cx = pC.width / 2;
        const cy = pC.height / 2;
        const dx = cx - this.x;
        const dy = cy - this.y;
        const d = Math.hypot(dx, dy);
        const md = Math.hypot(this.x - mX, this.y - mY);

        if (md < 150) {
          const f = (150 - md) / 150;
          this.vx += ((this.x - mX) / md) * f * 0.1;
          this.vy += ((this.y - mY) / md) * f * 0.1;
        }
        // Radiate outward
        if (d < 400 && d > 50) {
          this.vx -= (dx / d) * 0.018;
          this.vy -= (dy / d) * 0.018;
        }
        this.vx *= 0.97;
        this.vy *= 0.97;
        this.x += this.vx;
        this.y += this.vy;
        this.age++;

        if (this.x < 0) this.x = pC.width;
        if (this.x > pC.width) this.x = 0;
        if (this.y < 0) this.y = pC.height;
        if (this.y > pC.height) this.y = 0;
        if (this.age > this.life) this.reset();
      }

      draw() {
        if (!pX) return;
        const fade = 1 - Math.abs(this.age - this.life / 2) / (this.life / 2);
        pX.beginPath();
        pX.arc(this.x, this.y, this.s, 0, Math.PI * 2);
        pX.fillStyle = `hsla(${this.hue},60%,72%,${Math.min(this.o * fade * 2.5, 0.65)})`;
        pX.fill();
      }
    }

    for (let i = 0; i < 230; i++) ps.push(new Particle());

    function drawLines() {
      if (!pX) return;
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const d = Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y);
          if (d < 90) {
            pX.beginPath();
            pX.moveTo(ps[i].x, ps[i].y);
            pX.lineTo(ps[j].x, ps[j].y);
            pX.strokeStyle = `rgba(151,109,248,${(1 - d / 90) * 0.06})`;
            pX.lineWidth = 0.5;
            pX.stroke();
          }
        }
      }
    }

    let wt = 0;
    function drawWaves() {
      if (!wX || !wC) return;
      wX.clearRect(0, 0, wC.width, wC.height);
      const cy = wC.height / 2;
      const configs = [
        { amp: 50, freq1: 0.003, freq2: 0.007, speed: 0.1, opacity: 0.16, color: '151,109,248' },
        { amp: 38, freq1: 0.004, freq2: 0.009, speed: 0.08, opacity: 0.1, color: '181,154,252' },
        { amp: 25, freq1: 0.005, freq2: 0.011, speed: 0.12, opacity: 0.07, color: '200,170,255' },
        { amp: 18, freq1: 0.006, freq2: 0.013, speed: 0.09, opacity: 0.04, color: '220,200,255' },
      ];
      configs.forEach(c => {
        wX.beginPath();
        for (let x = 0; x <= wC.width; x += 2) {
          const y = cy + Math.sin(x * c.freq1 + wt * c.speed) * c.amp + Math.sin(x * c.freq2 - wt * c.speed * 0.6) * c.amp * 0.45;
          x === 0 ? wX.moveTo(x, y) : wX.lineTo(x, y);
        }
        wX.strokeStyle = `rgba(${c.color},${c.opacity})`;
        wX.lineWidth = 1.5;
        wX.stroke();
      });
      wt++;
    }

    let animationId: number;
    function loop() {
      if (!pC || !pX) return;
      pX.clearRect(0, 0, pC.width, pC.height);
      ps.forEach(p => {
        p.update();
        p.draw();
      });
      drawLines();
      drawWaves();
      animationId = requestAnimationFrame(loop);
    }
    loop();

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouseMove);
      if (animationId) cancelAnimationFrame(animationId);
    };
  }, []);

  // Timer
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setSeconds(s => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Subtitle Typewriter
  const [typedText, setTypedText] = useState("");
  useEffect(() => {
    let charIdx = 0;
    const cleanTranscription = transcription.replace(/```[\\s\\S]*?```/g, "").replace(/<[^>]*>?/gm, "").trim();
    if (!cleanTranscription) {
        setTypedText("...");
        return;
    }

    let timeoutId: any;
    const typeChar = () => {
      if (charIdx <= cleanTranscription.length) {
        setTypedText(cleanTranscription.slice(0, charIdx));
        charIdx++;
        timeoutId = setTimeout(typeChar, 35 + Math.random() * 25);
      }
    };
    typeChar();

    return () => clearTimeout(timeoutId);
  }, [transcription]);

  return (
    <div className="speak-wrapper text-[#e4e4e7] font-['Inter',sans-serif] overflow-hidden antialiased fixed inset-0 z-[200]">
      <style>{`
        .speak-wrapper {
          background: rgba(9, 9, 11, 0.85);
          backdrop-filter: blur(20px);
        }
        .speak-ambient { position:fixed; border-radius:50%; filter:blur(120px); pointer-events:none; }
        .speak-a1 { width:550px; height:550px; top:-5%; left:10%; background:rgba(151,109,248,0.1); animation:af1 16s ease-in-out infinite; }
        .speak-a2 { width:450px; height:450px; bottom:0; right:5%; background:rgba(181,154,252,0.07); animation:af2 20s ease-in-out infinite; }
        .speak-a3 { width:380px; height:380px; top:35%; right:-8%; background:rgba(120,90,220,0.05); animation:af3 18s ease-in-out infinite; }
        .speak-a4 { width:300px; height:300px; bottom:20%; left:-5%; background:rgba(192,132,252,0.04); animation:af1 22s ease-in-out infinite 3s; }
        @keyframes af1 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(45px,30px) scale(1.12)} }
        @keyframes af2 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-35px,-25px)} }
        @keyframes af3 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-25px,40px)} }

        .speak-grid-bg { position:fixed; inset:0; background-image:linear-gradient(rgba(151,109,248,0.02) 1px,transparent 1px),linear-gradient(90deg,rgba(151,109,248,0.02) 1px,transparent 1px); background-size:55px 55px; mask-image:radial-gradient(ellipse 55% 50% at 50% 50%,black,transparent); -webkit-mask-image:radial-gradient(ellipse 55% 50% at 50% 50%,black,transparent); pointer-events:none; }
        .speak-vignette { position:fixed; inset:0; background:radial-gradient(ellipse at center,transparent 32%,rgba(9,9,11,0.72) 100%); pointer-events:none; }

        .speak-bg-ring { position:fixed; border-radius:50%; pointer-events:none; top:50%; left:50%; transform:translate(-50%,-50%); }
        .speak-bgr-1 { width:600px; height:600px; border:1px solid rgba(151,109,248,0.03); animation:rr 12s linear infinite; }
        .speak-bgr-2 { width:480px; height:480px; border:1px solid rgba(181,154,252,0.025); animation:rr 18s linear infinite reverse; }
        .speak-bgr-3 { width:780px; height:780px; border:1px solid rgba(151,109,248,0.015); animation:rr 26s linear infinite; }
        @keyframes rr { to{transform:translate(-50%,-50%) rotate(360deg)} }

        .speak-orb-wrap { position:relative; width:220px; height:220px; }
        .speak-orb-glow { position:absolute; inset:-75px; border-radius:50%; background:radial-gradient(circle,rgba(151,109,248,0.28),transparent 70%); animation:gPulse 0.7s ease-in-out infinite; pointer-events:none; }
        @keyframes gPulse { 0%,100%{opacity:0.6;transform:scale(1)} 50%{opacity:1;transform:scale(1.1)} }

        .speak-orb-ring { position:absolute; border-radius:50%; pointer-events:none; }
        .speak-or1 { inset:-8px; border:2px solid rgba(151,109,248,0.18); animation:rPulse 0.7s ease-in-out infinite; }
        .speak-or2 { inset:-24px; border:1.5px solid rgba(181,154,252,0.1); animation:rPulse 0.7s ease-in-out infinite 0.15s; }
        .speak-or3 { inset:-42px; border:1px solid rgba(151,109,248,0.05); animation:rPulse 0.7s ease-in-out infinite 0.3s; }
        .speak-or4 { inset:-62px; border:1px solid rgba(151,109,248,0.025); animation:rPulse 0.7s ease-in-out infinite 0.45s; }
        @keyframes rPulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.06);opacity:0.3} }

        .speak-emit-ring { position:absolute; border-radius:50%; top:50%; left:50%; width:0; height:0; border:1px solid rgba(151,109,248,0.15); animation:emitExpand 2s ease-out infinite; pointer-events:none; }
        .speak-emit-ring:nth-child(2) { animation-delay:0.6s; }
        .speak-emit-ring:nth-child(3) { animation-delay:1.2s; }
        @keyframes emitExpand {
          0% {width:220px;height:220px;margin-top:-110px;margin-left:-110px;opacity:0.3}
          100% {width:600px;height:600px;margin-top:-300px;margin-left:-300px;opacity:0}
        }

        .speak-orb { width:100%; height:100%; border-radius:50%; position:relative; background:radial-gradient(circle at 36% 36%,rgba(181,154,252,0.5),rgba(151,109,248,0.15) 50%,transparent 75%); box-shadow:0 0 120px rgba(151,109,248,0.4),0 0 240px rgba(151,109,248,0.12),inset 0 0 80px rgba(151,109,248,0.15); animation:orbSpeak 0.65s ease-in-out infinite; }
        @keyframes orbSpeak { 0%,100%{transform:scale(1)} 50%{transform:scale(1.1)} }
        .speak-orb::before { content:''; position:absolute; inset:-3px; border-radius:50%; background:conic-gradient(from 0deg,transparent,rgba(181,154,252,0.3),transparent 30%,rgba(151,109,248,0.2),transparent 60%,rgba(200,170,255,0.15),transparent); animation:spin 2.5s linear infinite; pointer-events:none; }
        .speak-orb::after { content:''; position:absolute; inset:4px; border-radius:50%; background:radial-gradient(circle at 40% 40%,rgba(181,154,252,0.18),#09090b 60%); pointer-events:none; }
        @keyframes spin { to{transform:rotate(360deg)} }

        .speak-wave-bars { position:absolute; inset:0; z-index:2; display:flex; align-items:center; justify-content:center; gap:5px; pointer-events:none; }
        .speak-wb { width:4px; border-radius:4px; background:linear-gradient(to top,rgba(151,109,248,0.7),rgba(220,200,255,1)); animation:waveSpeak 0.4s ease-in-out infinite; box-shadow:0 0 10px rgba(151,109,248,0.4); }
        @keyframes waveSpeak { 0%,100%{transform:scaleY(0.3);opacity:0.5} 50%{transform:scaleY(1);opacity:1} }
        .speak-wb:nth-child(1) { height:18px; animation-delay:0s; }
        .speak-wb:nth-child(2) { height:30px; animation-delay:.05s; }
        .speak-wb:nth-child(3) { height:42px; animation-delay:.1s; }
        .speak-wb:nth-child(4) { height:54px; animation-delay:.15s; }
        .speak-wb:nth-child(5) { height:60px; animation-delay:.12s; }
        .speak-wb:nth-child(6) { height:54px; animation-delay:.09s; }
        .speak-wb:nth-child(7) { height:42px; animation-delay:.06s; }
        .speak-wb:nth-child(8) { height:30px; animation-delay:.03s; }
        .speak-wb:nth-child(9) { height:18px; animation-delay:0s; }

        .speak-glow-floor { position:absolute; bottom:-55px; left:50%; transform:translateX(-50%); width:380px; height:130px; background:radial-gradient(ellipse,rgba(151,109,248,0.18),transparent 70%); filter:blur(30px); animation:gfPulse 0.7s ease-in-out infinite; pointer-events:none; }
        @keyframes gfPulse { 0%,100%{opacity:0.55} 50%{opacity:1} }

        .speak-status-label { letter-spacing:0.22em; text-transform:uppercase; font-weight:600; font-size:14px; color:#b59afc; text-shadow:0 0 25px rgba(181,154,252,0.4); }

        .speak-subtitle-wrap { min-height:72px; max-width:500px; text-align:center; }
        .speak-subtitle { font-size:16px; color:rgba(228,228,231,0.45); line-height:1.7; font-weight:300; font-style:italic; }
        .speak-subtitle-typing { display:inline; padding-right:2px; word-break: break-word; }

        .speak-close-btn { width:44px; height:44px; border-radius:50%; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.06); display:flex; align-items:center; justify-content:center; cursor:pointer; transition:all 0.2s; color:rgba(255,255,255,0.3); z-index: 100; position:relative; }
        .speak-close-btn:hover { background:rgba(255,255,255,0.08); color:rgba(255,255,255,0.7); }

        .speak-timer { font-size:13px; font-variant-numeric:tabular-nums; color:rgba(181,154,252,0.4); letter-spacing:0.05em; }

        .speak-fade-in { animation:fadeIn 0.8s ease-out; }
        @keyframes fadeIn { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      <div className="speak-ambient speak-a1"></div>
      <div className="speak-ambient speak-a2"></div>
      <div className="speak-ambient speak-a3"></div>
      <div className="speak-ambient speak-a4"></div>
      <div className="speak-grid-bg"></div>
      <div className="speak-bg-ring speak-bgr-1"></div>
      <div className="speak-bg-ring speak-bgr-2"></div>
      <div className="speak-bg-ring speak-bgr-3"></div>
      <div className="speak-vignette"></div>
      <canvas ref={particleCanvasRef} className="fixed inset-0 z-0 pointer-events-none"></canvas>
      <canvas ref={waveCanvasRef} className="fixed inset-0 z-[1] pointer-events-none"></canvas>

      <div className="relative z-10 h-full flex flex-col items-center justify-between py-10 px-6 speak-fade-in pointer-events-none">
        <div className="w-full flex justify-end pointer-events-auto">
          {onClose && (
            <button className="speak-close-btn" onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className="flex flex-col items-center gap-14 -mt-6">
          <div className="speak-orb-wrap">
            <div className="speak-emit-ring"></div>
            <div className="speak-emit-ring"></div>
            <div className="speak-emit-ring"></div>
            <div className="speak-orb-ring speak-or4"></div>
            <div className="speak-orb-ring speak-or3"></div>
            <div className="speak-orb-ring speak-or2"></div>
            <div className="speak-orb-ring speak-or1"></div>
            <div className="speak-orb-glow"></div>
            <div className="speak-orb">
              <div className="speak-wave-bars">
                <div className="speak-wb"></div><div className="speak-wb"></div><div className="speak-wb"></div>
                <div className="speak-wb"></div><div className="speak-wb"></div><div className="speak-wb"></div>
                <div className="speak-wb"></div><div className="speak-wb"></div><div className="speak-wb"></div>
              </div>
            </div>
            <div className="speak-glow-floor"></div>
          </div>

          <div className="flex flex-col items-center gap-6 w-full max-w-[600px]">
            <span className="speak-status-label">{statusText}</span>
            
            <div className="w-full flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {userPrompt && (
                <div className="self-end max-w-[80%] bg-purple-500/10 border border-purple-500/20 px-4 py-2.5 rounded-2xl rounded-tr-sm backdrop-blur-md">
                   <p className="text-[13px] text-purple-200/70 font-medium leading-relaxed italic line-clamp-2">
                     "{userPrompt}"
                   </p>
                </div>
              )}
              
              <div className="self-start w-full bg-white/[0.03] border border-white/10 p-5 rounded-3xl backdrop-blur-xl shadow-2xl relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent pointer-events-none" />
                <div className="relative speak-subtitle-wrap !max-w-none !min-h-0 text-left">
                  <p className="speak-subtitle !text-white/90 !text-[15px] !font-medium !text-left !italic leading-relaxed">
                    <span className="speak-subtitle-typing">{typedText}</span>
                  </p>
                </div>
                <div className="mt-3 flex items-center justify-between opacity-40">
                   <div className="flex gap-1">
                      <div className="w-1 h-1 rounded-full bg-purple-400 animate-pulse" />
                      <div className="w-1 h-1 rounded-full bg-purple-400 animate-pulse [animation-delay:0.2s]" />
                      <div className="w-1 h-1 rounded-full bg-purple-400 animate-pulse [animation-delay:0.4s]" />
                   </div>
                   <span className="text-[9px] font-black uppercase tracking-widest text-purple-300">Grizon AI Response</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <span className="speak-timer">{formatTime(seconds)}</span>
      </div>
    </div>
  );
}
