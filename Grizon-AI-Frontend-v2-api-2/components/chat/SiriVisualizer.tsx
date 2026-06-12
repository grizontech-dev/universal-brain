'use client';

import React, { useEffect, useRef, useState } from 'react';

export interface SiriVisualizerProps {
  onClose?: () => void;
  statusText?: string;
  isThinking?: boolean;
}

export default function SiriVisualizer({ onClose, statusText = "Thinking", isThinking = true }: SiriVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const defaultPhrases = [
    'Analyzing your request...',
    'Searching for the best answer...',
    'Processing information...',
    'Generating response...'
  ];
  
  const [currentPhrase, setCurrentPhrase] = useState(defaultPhrases[0]);
  const [fade, setFade] = useState(true);

  // Subtitle cycling
  useEffect(() => {
    if (!isThinking) {
      setCurrentPhrase(statusText === "Speaking" ? "Responding..." : "Listening...");
      setFade(true);
      return;
    }
    
    let pi = 0;
    setCurrentPhrase(defaultPhrases[0]);
    
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        pi = (pi + 1) % defaultPhrases.length;
        setCurrentPhrase(defaultPhrases[pi]);
        setFade(true);
      }, 500);
    }, 3000);
    return () => clearInterval(interval);
  }, [isThinking, statusText]);

  // Canvas Particles
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    let ps: any[] = [];
    let mX = window.innerWidth / 2;
    let mY = window.innerHeight / 2;

    function resize() {
      if (!canvas) return;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
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
      angle: number = 0;

      constructor() {
        this.reset();
      }

      reset() {
        if (!canvas) return;
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.s = Math.random() * 1.8 + 0.3;
        this.vx = (Math.random() - 0.5) * 0.3;
        this.vy = (Math.random() - 0.5) * 0.3;
        this.o = Math.random() * 0.25 + 0.04;
        this.hue = [210, 230, 260][Math.floor(Math.random() * 3)];
        this.angle = Math.random() * Math.PI * 2;
      }

      update() {
        if (!canvas) return;
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        const dx = cx - this.x;
        const dy = cy - this.y;
        const d = Math.hypot(dx, dy);
        const md = Math.hypot(this.x - mX, this.y - mY);
        
        if (md < 140) {
          const f = (140 - md) / 140;
          this.vx += ((this.x - mX) / md) * f * 0.08;
          this.vy += ((this.y - mY) / md) * f * 0.08;
        }
        
        // Orbit
        if (d > 50) {
          const a = Math.atan2(dy, dx);
          this.vx += Math.sin(a) * 0.015;
          this.vy -= Math.cos(a) * 0.015;
          this.vx += (dx / d) * 0.002;
          this.vy += (dy / d) * 0.002;
        }
        
        this.vx *= 0.975;
        this.vy *= 0.975;
        this.x += this.vx;
        this.y += this.vy;
        
        if (this.x < 0) this.x = canvas.width;
        if (this.x > canvas.width) this.x = 0;
        if (this.y < 0) this.y = canvas.height;
        if (this.y > canvas.height) this.y = 0;
      }

      draw() {
        if (!ctx) return;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.s, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${this.hue},55%,68%,${Math.min(this.o, 0.45)})`;
        ctx.fill();
      }
    }

    for (let i = 0; i < 180; i++) ps.push(new Particle());

    function drawLines() {
      if (!ctx) return;
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const d = Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y);
          if (d < 80) {
            ctx.beginPath();
            ctx.moveTo(ps[i].x, ps[i].y);
            ctx.lineTo(ps[j].x, ps[j].y);
            ctx.strokeStyle = `rgba(99,179,255,${(1 - d / 80) * 0.05})`;
            ctx.lineWidth = 0.4;
            ctx.stroke();
          }
        }
      }
    }

    let animationId: number;
    function loop() {
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ps.forEach(p => {
        p.update();
        p.draw();
      });
      drawLines();
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
    <div className="siri-wrapper text-[#e4e4e7] font-['Inter',sans-serif] overflow-hidden antialiased fixed inset-0 z-[200]">
      <style>{`
        .siri-wrapper {
          background: rgba(9, 9, 11, 0.85);
          backdrop-filter: blur(20px);
        }
        .siri-ambient { position:fixed; border-radius:50%; filter:blur(130px); pointer-events:none; }
        .siri-a1 { width:500px; height:500px; top:5%; left:25%; background:rgba(99,179,255,0.08); animation:af1 14s ease-in-out infinite; }
        .siri-a2 { width:400px; height:400px; bottom:5%; right:15%; background:rgba(151,109,248,0.06); animation:af2 18s ease-in-out infinite; }
        .siri-a3 { width:350px; height:350px; top:45%; left:-5%; background:rgba(56,189,248,0.04); animation:af3 22s ease-in-out infinite; }
        @keyframes af1 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(35px,25px) scale(1.1)} }
        @keyframes af2 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-45px,-20px)} }
        @keyframes af3 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(25px,-35px)} }

        .siri-grid-bg { position:fixed; inset:0; background-image:linear-gradient(rgba(99,179,255,0.015) 1px,transparent 1px),linear-gradient(90deg,rgba(99,179,255,0.015) 1px,transparent 1px); background-size:50px 50px; mask-image:radial-gradient(ellipse 50% 45% at 50% 50%,black,transparent); -webkit-mask-image:radial-gradient(ellipse 50% 45% at 50% 50%,black,transparent); pointer-events:none; }
        .siri-vignette { position:fixed; inset:0; background:radial-gradient(ellipse at center,transparent 28%,rgba(9,9,11,0.8) 100%); pointer-events:none; }

        .siri-scan { position:fixed; left:0; right:0; height:1px; z-index:2; background:linear-gradient(90deg,transparent 10%,rgba(99,179,255,0.1) 40%,rgba(99,179,255,0.15) 50%,rgba(99,179,255,0.1) 60%,transparent 90%); animation:scanMove 5s linear infinite; pointer-events:none; }
        @keyframes scanMove { 0%{top:10%;opacity:0} 10%{opacity:1} 90%{opacity:1} 100%{top:90%;opacity:0} }

        .siri-bg-ring { position:fixed; border-radius:50%; pointer-events:none; top:50%; left:50%; transform:translate(-50%,-50%); }
        .siri-bgr-1 { width:550px; height:550px; border:1px solid rgba(99,179,255,0.025); animation:rr 10s linear infinite; }
        .siri-bgr-2 { width:700px; height:700px; border:1px dashed rgba(151,109,248,0.02); animation:rr 18s linear infinite reverse; }
        .siri-bgr-3 { width:850px; height:850px; border:1px solid rgba(99,179,255,0.012); animation:rr 24s linear infinite; }
        @keyframes rr { to{transform:translate(-50%,-50%) rotate(360deg)} }

        .siri-data-stream { position:fixed; width:1px; opacity:0.04; z-index:1; background:linear-gradient(to bottom,transparent,rgba(99,179,255,0.4) 40%,rgba(99,179,255,0.4) 60%,transparent); pointer-events:none; }
        .siri-ds1 { left:15%; height:30%; animation:dsFall 6s linear infinite; }
        .siri-ds2 { left:35%; height:25%; animation:dsFall 8s linear infinite 2s; }
        .siri-ds3 { right:20%; height:35%; animation:dsFall 7s linear infinite 1s; }
        .siri-ds4 { right:35%; height:20%; animation:dsFall 9s linear infinite 3s; }
        .siri-ds5 { left:50%; height:28%; animation:dsFall 5s linear infinite 0.5s; }
        @keyframes dsFall { 0%{top:-35%;opacity:0} 10%{opacity:0.06} 90%{opacity:0.06} 100%{top:105%;opacity:0} }

        .siri-orb-wrap { position:relative; width:220px; height:220px; }
        .siri-orb-glow { position:absolute; inset:-65px; border-radius:50%; background:radial-gradient(circle,rgba(99,179,255,0.16),transparent 70%); animation:gPulse 2.5s ease-in-out infinite; }
        @keyframes gPulse { 0%,100%{opacity:0.5;transform:scale(1)} 50%{opacity:0.85;transform:scale(1.08)} }

        .siri-orb-ring { position:absolute; border-radius:50%; pointer-events:none; }
        .siri-or1 { inset:-10px; border:1.5px solid rgba(99,179,255,0.12); animation:orSpin 5s linear infinite; }
        .siri-or2 { inset:-28px; border:1px solid rgba(99,179,255,0.06); animation:orSpin 8s linear infinite reverse; }
        .siri-or3 { inset:-48px; border:1px dashed rgba(151,109,248,0.04); animation:orSpin 12s linear infinite; }
        .siri-or4 { inset:-70px; border:1px solid rgba(99,179,255,0.02); animation:orSpin 16s linear infinite reverse; }
        @keyframes orSpin { to{transform:rotate(360deg)} }

        .siri-orbit-dot { position:absolute; border-radius:50%; background:rgba(99,179,255,0.6); box-shadow:0 0 12px rgba(99,179,255,0.4); }
        .siri-od1 { width:5px; height:5px; top:-3px; left:50%; }
        .siri-od2 { width:4px; height:4px; bottom:20%; right:-2px; background:rgba(151,109,248,0.5); box-shadow:0 0 10px rgba(151,109,248,0.3); }
        .siri-od3 { width:3px; height:3px; top:30%; left:-2px; background:rgba(56,189,248,0.4); box-shadow:0 0 8px rgba(56,189,248,0.2); }

        .siri-orb { width:100%; height:100%; position:relative; border-radius:50%; background:radial-gradient(circle at 35% 35%,rgba(99,179,255,0.4),transparent 50%), radial-gradient(circle at 60% 60%,rgba(151,109,248,0.2),transparent 50%), radial-gradient(circle,rgba(56,189,248,0.06),transparent 70%); box-shadow:0 0 80px rgba(99,179,255,0.25),0 0 180px rgba(99,179,255,0.08),inset 0 0 70px rgba(99,179,255,0.08); animation:orbMorph 2.5s ease-in-out infinite; }
        @keyframes orbMorph {
          0%,100% {border-radius:50%;transform:scale(1) rotate(0deg)}
          25% {border-radius:48% 52% 50% 50%;transform:scale(1.04) rotate(2deg)}
          50% {border-radius:50% 48% 52% 48%;transform:scale(0.96) rotate(-1.5deg)}
          75% {border-radius:52% 50% 48% 52%;transform:scale(1.03) rotate(1deg)}
        }

        .siri-orb::before { content:''; position:absolute; inset:-3px; border-radius:50%; background:conic-gradient(from 180deg,transparent,rgba(99,179,255,0.3),transparent 50%,rgba(151,109,248,0.2),transparent); animation:spin 3s linear infinite; }
        .siri-orb::after { content:''; position:absolute; inset:5px; border-radius:50%; background:radial-gradient(circle at 40% 35%,rgba(99,179,255,0.1),#09090b 60%); }
        @keyframes spin { to{transform:rotate(360deg)} }

        .siri-think-dots { position:absolute; inset:0; z-index:2; display:flex; align-items:center; justify-content:center; gap:14px; pointer-events:none; }
        .siri-td { width:11px; height:11px; border-radius:50%; animation:tdBounce 1.4s ease-in-out infinite; }
        .siri-td1 { background:rgba(99,179,255,0.7); box-shadow:0 0 14px rgba(99,179,255,0.4); animation-delay:0s; }
        .siri-td2 { background:rgba(151,109,248,0.7); box-shadow:0 0 14px rgba(151,109,248,0.4); animation-delay:0.2s; }
        .siri-td3 { background:rgba(56,189,248,0.6); box-shadow:0 0 14px rgba(56,189,248,0.3); animation-delay:0.4s; }
        @keyframes tdBounce { 0%,80%,100%{transform:scale(0.5);opacity:0.35} 40%{transform:scale(1.3);opacity:1} }

        .siri-glow-floor { position:absolute; bottom:-55px; left:50%; transform:translateX(-50%); width:370px; height:130px; background:radial-gradient(ellipse,rgba(99,179,255,0.12),transparent 70%); filter:blur(30px); animation:gfBreath 2.5s ease-in-out infinite; pointer-events:none; }
        @keyframes gfBreath { 0%,100%{opacity:0.5;transform:translateX(-50%) scaleX(1)} 50%{opacity:0.85;transform:translateX(-50%) scaleX(1.08)} }

        .siri-status-label { letter-spacing:0.22em; text-transform:uppercase; font-weight:600; font-size:14px; color:#63b3ff; text-shadow:0 0 25px rgba(99,179,255,0.4); animation:stPulse 2.5s ease-in-out infinite; }
        @keyframes stPulse { 0%,100%{opacity:1} 50%{opacity:0.55} }

        .siri-subtitle { font-size:15px; color:rgba(228,228,231,0.28); max-width:420px; text-align:center; line-height:1.6; font-weight:300; transition: all 0.5s ease; }
        .siri-sub-breathe { animation:subBreathe 3s ease-in-out infinite; }
        @keyframes subBreathe { 0%,100%{opacity:0.28} 50%{opacity:0.55} }

        .siri-sub-dots { display:flex; gap:4px; align-items:center; justify-content:center; margin-top:6px; }
        .siri-sd { width:4px; height:4px; border-radius:50%; background:rgba(99,179,255,0.4); animation:sdPulse 1.2s ease-in-out infinite; }
        .siri-sd:nth-child(2) { animation-delay:0.15s; }
        .siri-sd:nth-child(3) { animation-delay:0.3s; }
        @keyframes sdPulse { 0%,100%{opacity:0.3} 50%{opacity:0.8} }

        .siri-close-btn { width:44px; height:44px; border-radius:50%; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.06); display:flex; align-items:center; justify-content:center; cursor:pointer; transition:all 0.2s; color:rgba(255,255,255,0.3); z-index: 100; position:relative; }
        .siri-close-btn:hover { background:rgba(255,255,255,0.08); color:rgba(255,255,255,0.7); }

        .siri-fade-in { animation:fadeIn 0.8s ease-out; }
        @keyframes fadeIn { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      <div className="siri-ambient siri-a1"></div>
      <div className="siri-ambient siri-a2"></div>
      <div className="siri-ambient siri-a3"></div>
      <div className="siri-grid-bg"></div>
      <div className="siri-scan"></div>
      <div className="siri-bg-ring siri-bgr-1"></div>
      <div className="siri-bg-ring siri-bgr-2"></div>
      <div className="siri-bg-ring siri-bgr-3"></div>
      <div className="siri-data-stream siri-ds1"></div>
      <div className="siri-data-stream siri-ds2"></div>
      <div className="siri-data-stream siri-ds3"></div>
      <div className="siri-data-stream siri-ds4"></div>
      <div className="siri-data-stream siri-ds5"></div>
      <div className="siri-vignette"></div>
      <canvas ref={canvasRef} className="fixed inset-0 z-0 pointer-events-none"></canvas>

      <div className="relative z-10 h-full flex flex-col items-center justify-between py-10 px-6 siri-fade-in pointer-events-none">
        <div className="w-full flex justify-end pointer-events-auto">
          {onClose && (
            <button className="siri-close-btn" onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className="flex flex-col items-center gap-14 -mt-6">
          <div className="siri-orb-wrap">
            <div className="siri-orb-ring siri-or4"></div>
            <div className="siri-orb-ring siri-or3"><div className="siri-orbit-dot siri-od3"></div></div>
            <div className="siri-orb-ring siri-or2"><div className="siri-orbit-dot siri-od2"></div></div>
            <div className="siri-orb-ring siri-or1"><div className="siri-orbit-dot siri-od1"></div></div>
            <div className="siri-orb-glow"></div>
            <div className="siri-orb">
              <div className="siri-think-dots">
                <div className="siri-td siri-td1"></div>
                <div className="siri-td siri-td2"></div>
                <div className="siri-td siri-td3"></div>
              </div>
            </div>
            <div className="siri-glow-floor"></div>
          </div>

          <div className="flex flex-col items-center gap-4">
            <span className="siri-status-label">{statusText}</span>
            <p className="siri-subtitle siri-sub-breathe" style={{ opacity: fade ? '' : '0' }}>
              {currentPhrase}
            </p>
            <div className="siri-sub-dots">
              <div className="siri-sd"></div>
              <div className="siri-sd"></div>
              <div className="siri-sd"></div>
            </div>
          </div>
        </div>

        <div className="h-12"></div>
      </div>
    </div>
  );
}
