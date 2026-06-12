'use client';

import React, { useEffect, useRef, useState } from 'react';

export interface SiriListeningVisualizerProps {
  onClose?: () => void;
  statusText?: string;
  transcript?: string;
  volume?: number;
}

export default function SiriListeningVisualizer({ onClose, statusText = "Listening", transcript, volume = 0 }: SiriListeningVisualizerProps) {
  const particleCanvasRef = useRef<HTMLCanvasElement>(null);
  const waveCanvasRef = useRef<HTMLCanvasElement>(null);

  const defaultPhrases = [
    '"What is the weather like in San Francisco?"',
    '"Tell me about the latest tech news..."',
    '"How do I make a perfect risotto?"',
    '"What\'s on my calendar for tomorrow?"',
  ];

  const [currentPhrase, setCurrentPhrase] = useState(defaultPhrases[0]);
  const [fade, setFade] = useState(true);
  const [seconds, setSeconds] = useState(0);

  // Timer
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

  // Subtitle cycling (used if no live transcript is provided)
  useEffect(() => {
    if (transcript) return;
    
    let pi = 0;
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        pi = (pi + 1) % defaultPhrases.length;
        setCurrentPhrase(defaultPhrases[pi]);
        setFade(true);
      }, 500);
    }, 3500);
    return () => clearInterval(interval);
  }, [transcript]);

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
        this.s = Math.random() * 2.2 + 0.3;
        this.vx = (Math.random() - 0.5) * 0.4;
        this.vy = (Math.random() - 0.5) * 0.4;
        this.o = Math.random() * 0.3 + 0.05;
        this.hue = [255, 265, 240][Math.floor(Math.random() * 3)];
        this.life = Math.random() * 800 + 400;
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

        if (md < 160) {
          const f = (160 - md) / 160;
          this.vx += ((this.x - mX) / md) * f * 0.12;
          this.vy += ((this.y - mY) / md) * f * 0.12;
        }
        if (d > 70) {
          this.vx += (dx / d) * 0.006;
          this.vy += (dy / d) * 0.006;
        }
        this.vx += (Math.random() - 0.5) * 0.12;
        this.vy += (Math.random() - 0.5) * 0.12;
        this.vx *= 0.96;
        this.vy *= 0.96;
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
        const ageFade = 1 - Math.abs(this.age - this.life / 2) / (this.life / 2);
        pX.beginPath();
        pX.arc(this.x, this.y, this.s, 0, Math.PI * 2);
        pX.fillStyle = `hsla(${this.hue},60%,70%,${Math.min(this.o * ageFade * 2, 0.6)})`;
        pX.fill();
      }
    }

    for (let i = 0; i < 220; i++) ps.push(new Particle());

    function drawLines() {
      if (!pX) return;
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const d = Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y);
          if (d < 85) {
            pX.beginPath();
            pX.moveTo(ps[i].x, ps[i].y);
            pX.lineTo(ps[j].x, ps[j].y);
            pX.strokeStyle = `rgba(151,109,248,${(1 - d / 85) * 0.06})`;
            pX.lineWidth = 0.4;
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
        { amp: 45, freq1: 0.003, freq2: 0.007, speed: 0.08, opacity: 0.14, color: '151,109,248' },
        { amp: 32, freq1: 0.004, freq2: 0.008, speed: 0.06, opacity: 0.09, color: '192,132,252' },
        { amp: 22, freq1: 0.005, freq2: 0.01, speed: 0.1, opacity: 0.06, color: '200,170,255' },
      ];
      configs.forEach(c => {
        wX.beginPath();
        for (let x = 0; x <= wC.width; x += 2) {
          const y = cy + Math.sin(x * c.freq1 + wt * c.speed) * c.amp + Math.sin(x * c.freq2 - wt * c.speed * 0.5) * c.amp * 0.4;
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

  return (
    <div className="listen-wrapper text-[#e4e4e7] font-['Inter',sans-serif] overflow-hidden antialiased fixed inset-0 z-[200]">
      <style>{`
        .listen-wrapper { 
          background: rgba(9, 9, 11, 0.85); 
          backdrop-filter: blur(20px);
        }
        .listen-ambient { position:fixed; border-radius:50%; filter:blur(130px); pointer-events:none; }
        .listen-a1 { width:550px; height:550px; top:-8%; left:15%; background:rgba(151,109,248,0.1); animation:af1 18s ease-in-out infinite; }
        .listen-a2 { width:420px; height:420px; bottom:-5%; right:10%; background:rgba(192,132,252,0.06); animation:af2 22s ease-in-out infinite; }
        .listen-a3 { width:350px; height:350px; top:50%; left:-8%; background:rgba(120,80,220,0.05); animation:af3 20s ease-in-out infinite; }
        @keyframes af1 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(50px,35px) scale(1.12)} }
        @keyframes af2 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-40px,-25px)} }
        @keyframes af3 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(35px,-40px)} }

        .listen-grid-bg { position:fixed; inset:0; background-image:linear-gradient(rgba(151,109,248,0.018) 1px,transparent 1px),linear-gradient(90deg,rgba(151,109,248,0.018) 1px,transparent 1px); background-size:55px 55px; mask-image:radial-gradient(ellipse 55% 50% at 50% 50%,black,transparent); -webkit-mask-image:radial-gradient(ellipse 55% 50% at 50% 50%,black,transparent); pointer-events:none; }
        .listen-vignette { position:fixed; inset:0; background:radial-gradient(ellipse at center,transparent 30%,rgba(9,9,11,0.75) 100%); pointer-events:none; }

        .listen-bg-ring { position:fixed; border-radius:50%; pointer-events:none; top:50%; left:50%; transform:translate(-50%,-50%); }
        .listen-bgr-1 { width:650px; height:650px; border:1px solid rgba(151,109,248,0.025); animation:ringR 14s linear infinite; }
        .listen-bgr-2 { width:500px; height:500px; border:1px dashed rgba(151,109,248,0.03); animation:ringR 20s linear infinite reverse; }
        .listen-bgr-3 { width:800px; height:800px; border:1px solid rgba(151,109,248,0.015); animation:ringR 28s linear infinite; }
        @keyframes ringR { to{transform:translate(-50%,-50%) rotate(360deg)} }

        .listen-orb-wrap { position:relative; width:220px; height:220px; cursor:pointer; }
        .listen-orb-glow { position:absolute; inset:-70px; border-radius:50%; background:radial-gradient(circle,rgba(151,109,248,0.22),transparent 70%); animation:listenGPulse 1.2s ease-in-out infinite; pointer-events:none; }
        @keyframes listenGPulse { 0%,100%{opacity:0.6;transform:scale(1)} 50%{opacity:1;transform:scale(1.12)} }

        .listen-orb-ring { position:absolute; border-radius:50%; pointer-events:none; }
        .listen-or1 { inset:-8px; border:2px solid rgba(151,109,248,0.15); animation:listenRPulse 1.2s ease-in-out infinite; }
        .listen-or2 { inset:-22px; border:1.5px solid rgba(151,109,248,0.08); animation:listenRPulse 1.2s ease-in-out infinite 0.2s; }
        .listen-or3 { inset:-40px; border:1px solid rgba(151,109,248,0.04); animation:listenRPulse 1.2s ease-in-out infinite 0.4s; }
        .listen-or4 { inset:-60px; border:1px solid rgba(151,109,248,0.02); animation:listenRPulse 1.2s ease-in-out infinite 0.6s; }
        @keyframes listenRPulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.08);opacity:0.35} }

        .listen-orbit-dot { position:absolute; width:5px; height:5px; border-radius:50%; background:rgba(151,109,248,0.6); box-shadow:0 0 12px rgba(151,109,248,0.4); pointer-events:none; }
        .listen-od1 { top:-3px; left:50%; animation:dotOrbit 6s linear infinite; }
        .listen-od2 { bottom:10%; right:-3px; animation:dotOrbit 8s linear infinite reverse; }
        @keyframes dotOrbit { 0%{transform:rotate(0deg) translateX(4px)} 100%{transform:rotate(360deg) translateX(4px)} }

        .listen-orb { width:100%; height:100%; border-radius:50%; position:relative; background:radial-gradient(circle at 36% 36%,rgba(151,109,248,0.5),rgba(151,109,248,0.12) 50%,transparent 75%); box-shadow:0 0 100px rgba(151,109,248,0.35),0 0 200px rgba(151,109,248,0.1),inset 0 0 80px rgba(151,109,248,0.12); animation:listenOrbPulse 1s ease-in-out infinite; pointer-events:none; }
        @keyframes listenOrbPulse { 0%,100%{transform:scale(1)} 30%{transform:scale(1.1)} 60%{transform:scale(0.97)} }
        .listen-orb::before { content:''; position:absolute; inset:-3px; border-radius:50%; background:conic-gradient(from 0deg,transparent,rgba(151,109,248,0.25),transparent 40%,rgba(192,132,252,0.15),transparent 80%); animation:spin 3.5s linear infinite; pointer-events:none; }
        .listen-orb::after { content:''; position:absolute; inset:4px; border-radius:50%; background:radial-gradient(circle at 40% 40%,rgba(151,109,248,0.15),#09090b 65%); pointer-events:none; }
        @keyframes spin { to{transform:rotate(360deg)} }

        .listen-wave-bars { position:absolute; inset:0; z-index:2; display:flex; align-items:center; justify-content:center; gap:5px; pointer-events:none; }
        .listen-wb { width:3.5px; border-radius:4px; background:linear-gradient(to top,rgba(151,109,248,0.6),rgba(200,170,255,0.95)); transition: transform 0.1s ease-out, opacity 0.1s ease-out; box-shadow:0 0 8px rgba(151,109,248,0.3); }
        @keyframes waveA { 0%,100%{transform:scaleY(0.25);opacity:0.5} 50%{transform:scaleY(1);opacity:1} }
        .listen-wb:nth-child(1) { height:18px; animation-delay:0s; }
        .listen-wb:nth-child(2) { height:28px; animation-delay:.07s; }
        .listen-wb:nth-child(3) { height:38px; animation-delay:.14s; }
        .listen-wb:nth-child(4) { height:50px; animation-delay:.21s; }
        .listen-wb:nth-child(5) { height:56px; animation-delay:.18s; }
        .listen-wb:nth-child(6) { height:50px; animation-delay:.14s; }
        .listen-wb:nth-child(7) { height:38px; animation-delay:.1s; }
        .listen-wb:nth-child(8) { height:28px; animation-delay:.05s; }
        .listen-wb:nth-child(9) { height:18px; animation-delay:0s; }

        .listen-glow-floor { position:absolute; bottom:-50px; left:50%; transform:translateX(-50%); width:350px; height:120px; background:radial-gradient(ellipse,rgba(151,109,248,0.15),transparent 70%); filter:blur(30px); animation:listenGFPulse 1.2s ease-in-out infinite; pointer-events:none; }
        @keyframes listenGFPulse { 0%,100%{opacity:0.6} 50%{opacity:1} }

        .listen-status-label { letter-spacing:0.22em; text-transform:uppercase; font-weight:600; font-size:14px; color:#976df8; text-shadow:0 0 25px rgba(151,109,248,0.4); animation:listenStPulse 1.5s ease-in-out infinite; }
        @keyframes listenStPulse { 0%,100%{opacity:1} 50%{opacity:0.65} }

        .listen-subtitle { font-size:16px; color:rgba(228,228,231,0.35); max-width:440px; text-align:center; line-height:1.7; font-weight:300; font-style:italic; transition: all 0.5s ease; }
        
        .listen-close-btn { width:44px; height:44px; border-radius:50%; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.06); display:flex; align-items:center; justify-content:center; cursor:pointer; transition:all 0.2s; color:rgba(255,255,255,0.3); z-index: 100; position:relative; }
        .listen-close-btn:hover { background:rgba(255,255,255,0.08); color:rgba(255,255,255,0.7); }

        .listen-timer { font-size:13px; font-variant-numeric:tabular-nums; color:rgba(151,109,248,0.4); letter-spacing:0.05em; }

        .listen-fade-in { animation:listenFadeIn 0.8s ease-out; }
        @keyframes listenFadeIn { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      <div className="listen-ambient listen-a1"></div>
      <div className="listen-ambient listen-a2"></div>
      <div className="listen-ambient listen-a3"></div>
      <div className="listen-grid-bg"></div>
      <div className="listen-bg-ring listen-bgr-1"></div>
      <div className="listen-bg-ring listen-bgr-2"></div>
      <div className="listen-bg-ring listen-bgr-3"></div>
      <div className="listen-vignette"></div>
      <canvas ref={particleCanvasRef} className="fixed inset-0 z-0 pointer-events-none"></canvas>
      <canvas ref={waveCanvasRef} className="fixed inset-0 z-[1] pointer-events-none"></canvas>

      <div className="relative z-10 h-full flex flex-col items-center justify-between py-10 px-6 listen-fade-in pointer-events-none">
        <div className="w-full flex justify-end pointer-events-auto">
          {onClose && (
            <button className="listen-close-btn" onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className="flex flex-col items-center gap-14 -mt-6">
          <div className="listen-orb-wrap">
            <div className="listen-orb-ring listen-or4"></div>
            <div className="listen-orb-ring listen-or3"></div>
            <div className="listen-orb-ring listen-or2"><div className="listen-orbit-dot listen-od2"></div></div>
            <div className="listen-orb-ring listen-or1"><div className="listen-orbit-dot listen-od1"></div></div>
            <div className="listen-orb-glow"></div>
            <div className="listen-orb">
              <div className="listen-wave-bars">
                {[18, 28, 38, 50, 56, 50, 38, 28, 18].map((h, i) => (
                  <div 
                    key={i} 
                    className="listen-wb" 
                    style={{ 
                      height: `${h}px`,
                      transform: `scaleY(${0.3 + volume * (1.5 + Math.random())})`,
                      opacity: 0.4 + volume * 0.6
                    }} 
                  />
                ))}
              </div>
            </div>
            <div className="listen-glow-floor"></div>
          </div>

          <div className="flex flex-col items-center gap-5">
            <span className="listen-status-label">{statusText}</span>
            <p className="listen-subtitle" style={{ 
              opacity: fade ? '1' : '0', 
              transform: fade ? 'translateY(0)' : 'translateY(6px)', 
              filter: fade ? 'blur(0)' : 'blur(4px)' 
            }}>
              {transcript || currentPhrase}
            </p>
          </div>
        </div>

        <span className="listen-timer">{formatTime(seconds)}</span>
      </div>
    </div>
  );
}
