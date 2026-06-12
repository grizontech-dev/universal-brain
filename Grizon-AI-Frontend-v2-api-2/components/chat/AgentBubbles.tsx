"use client";

import { useState } from "react";

export type Agent = {
  id: number;
  name: string;
  role: string;
  description: string;
  bubbleTop: string;
  bubbleBot: string;
  skinTop: string;
  skinBot: string;
  image?: string;
  acc: "orange-hair" | "yellow-hair" | "grey-hat" | "none" | "dark-scarf" | "blue-hood" | "green-none" | "purple-beanie";
};

export const AGENTS: Agent[] = [
  { 
    id: 1, name: "Code Architect", role: "Coding", 
    description: "App building, scripts, automation, full projects",
    bubbleTop: "#FFBA7A", bubbleBot: "#F07830", skinTop: "#FFDAAA", skinBot: "#F5B878", acc: "orange-hair", image: "/agents_images/1.png"   
  },
  { 
    id: 2, name: "Research Analyst", role: "Research", 
    description: "Reports, summaries, market study, background checks",
    bubbleTop: "#FFF0A0", bubbleBot: "#E8CC50", skinTop: "#FFF8D0", skinBot: "#F5E080", acc: "yellow-hair", image: "/agents_images/2.png"   
  },
  { 
    id: 3, name: "Market Intelligence", role: "Insights", 
    description: "Trading ideas, investment research, business insights",
    bubbleTop: "#EAE0D0", bubbleBot: "#C8B898", skinTop: "#F5EEE0", skinBot: "#DDD0B8", acc: "grey-hat",      image: "/agents_images/3.png"   
  },
  { 
    id: 4, name: "Content Creator", role: "Content", 
    description: "Marketing, SEO content, copywriting, LinkedIn posts",
    bubbleTop: "#FFCCE0", bubbleBot: "#F090B8", skinTop: "#FFE0EE", skinBot: "#F8B8D4", acc: "none",           image: "/agents_images/4.png"   
  },
  { 
    id: 5, name: "Data Scientist", role: "Analytics", 
    description: "Excel files, data insights, statistics, visualizations",
    bubbleTop: "#E0DCFF", bubbleBot: "#A898E8", skinTop: "#EEEEFF", skinBot: "#D0C8F8", acc: "dark-scarf",    image: "/agents_images/5.png"   
  },
  { 
    id: 6, name: "Voice Assistant", role: "Voice", 
    description: "Voice chats, dictation, audio responses, accessibility",
    bubbleTop: "#B0DCFF", bubbleBot: "#58A8E8", skinTop: "#D0EEFF", skinBot: "#90C8F0", acc: "blue-hood",     image: "/agents_images/6.png"   
  },
  { 
    id: 7, name: "Strategy Consultant", role: "Planning", 
    description: "Planning, brainstorming, startup ideas, project setup",
    bubbleTop: "#B0F0D8", bubbleBot: "#50C898", skinTop: "#D0FAE8", skinBot: "#90E0C0", acc: "green-none",    image: "/agents_images/7.png"   
  },
  { 
    id: 8, name: "Debugger & Healer", role: "Debugging", 
    description: "Finds bugs and suggests fixes from logs (UI preview — no remote execution)",
    bubbleTop: "#D8AAFF", bubbleBot: "#9040D0", skinTop: "#EAC8FF", skinBot: "#C080F0", acc: "purple-beanie", image: "/agents_images/8.png"   
  },
];

export function Face({ a, size = 96 }: { a: Agent; size?: number }) {
  const S = size;
  const R = S / 2;
  const cx = R, cy = R;

  if (a.image) {
    return (
      <div 
        style={{ 
          width: "100%", 
          height: "100%", 
          borderRadius: "50%", 
          overflow: "hidden", 
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `linear-gradient(135deg, ${a.bubbleTop}, ${a.bubbleBot})`,
          border: `var(--bubble-border) solid white`, 
          boxShadow: `0 4px 12px rgba(0,0,0,0.15)`,
          position: "relative",
          zIndex: 1,
          boxSizing: "border-box"
        }}
      >
        <img 
          src={a.image} 
          alt={a.name} 
          style={{ 
            width: "100%", 
            height: "100%", 
            objectFit: "cover", 
            objectPosition: "center",
            display: "block",
            transform: "scale(1.35)", // Heavily zoomed to fill the circle and remove background space
            filter: "contrast(1.05)"
          }} 
        />
      </div>
    );
  }

  const faceRx = R * 0.56;
  const faceRy = R * 0.54;
  const faceCy = cy + R * 0.10;
  const eyeY   = cy - R * 0.02;
  const eyeOff = R * 0.20;
  const mouthY1 = cy + R * 0.22;
  const mouthY2 = cy + R * 0.38;
  const mouthX  = R * 0.22;

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${S} ${S}`} xmlns="http://www.w3.org/2000/svg" style={{ display:"block" }}>
      <defs>
        <radialGradient id={`bg${a.id}s${S}`} cx="42%" cy="35%" r="62%">
          <stop offset="0%"   stopColor={a.bubbleTop}/>
          <stop offset="100%" stopColor={a.bubbleBot}/>
        </radialGradient>
        <radialGradient id={`sk${a.id}s${S}`} cx="50%" cy="38%" r="60%">
          <stop offset="0%"   stopColor={a.skinTop}/>
          <stop offset="100%" stopColor={a.skinBot}/>
        </radialGradient>
        <clipPath id={`cp${a.id}s${S}`}>
          <circle cx={cx} cy={cy} r={R - 0.5}/>
        </clipPath>
      </defs>


      {/* bubble */}
      <circle cx={cx} cy={cy} r={R - 0.5} fill={`url(#bg${a.id}s${S})`}/>
      {/* sheen */}
      <ellipse cx={cx-R*0.22} cy={cy-R*0.30} rx={R*0.30} ry={R*0.21} fill="white" opacity={0.40} clipPath={`url(#cp${a.id}s${S})`}/>

      {/* ── ACCESSORIES (behind face) ── */}

      {a.acc === "orange-hair" && (<>
        <ellipse cx={cx-R*0.40} cy={cy-R*0.76} rx={R*0.26} ry={R*0.22} fill="#C05A18" clipPath={`url(#cp${a.id}s${S})`}/>
        <ellipse cx={cx-R*0.16} cy={cy-R*0.90} rx={R*0.22} ry={R*0.20} fill="#C05A18" clipPath={`url(#cp${a.id}s${S})`}/>
        <ellipse cx={cx+R*0.40} cy={cy-R*0.76} rx={R*0.26} ry={R*0.22} fill="#C05A18" clipPath={`url(#cp${a.id}s${S})`}/>
        <ellipse cx={cx+R*0.16} cy={cy-R*0.90} rx={R*0.22} ry={R*0.20} fill="#C05A18" clipPath={`url(#cp${a.id}s${S})`}/>
        {/* bow-tie */}
        <polygon points={`${cx-R*0.20},${cy+R*0.70} ${cx},${cy+R*0.58} ${cx+R*0.20},${cy+R*0.70} ${cx},${cy+R*0.82}`} fill="#E06020" clipPath={`url(#cp${a.id}s${S})`}/>
        <circle cx={cx} cy={cy+R*0.70} r={R*0.07} fill="#B04010" clipPath={`url(#cp${a.id}s${S})`}/>
      </>)}

      {a.acc === "yellow-hair" && (<>
        <ellipse cx={cx-R*0.54} cy={cy-R*0.52} rx={R*0.30} ry={R*0.38} fill="#B88A08" clipPath={`url(#cp${a.id}s${S})`}/>
        <ellipse cx={cx}        cy={cy-R*0.88} rx={R*0.48} ry={R*0.24} fill="#B88A08" clipPath={`url(#cp${a.id}s${S})`}/>
        <ellipse cx={cx+R*0.54} cy={cy-R*0.52} rx={R*0.30} ry={R*0.38} fill="#B88A08" clipPath={`url(#cp${a.id}s${S})`}/>
        <ellipse cx={cx-R*0.54} cy={cy-R*0.46} rx={R*0.22} ry={R*0.28} fill="#DAAA18" opacity={0.65} clipPath={`url(#cp${a.id}s${S})`}/>
        <ellipse cx={cx+R*0.54} cy={cy-R*0.46} rx={R*0.22} ry={R*0.28} fill="#DAAA18" opacity={0.65} clipPath={`url(#cp${a.id}s${S})`}/>
      </>)}

      {a.acc === "grey-hat" && (<>
        <rect   x={cx-R*0.38} y={cy-R*1.02} width={R*0.76} height={R*0.50} rx={R*0.12} fill="#9A9088" clipPath={`url(#cp${a.id}s${S})`}/>
        <ellipse cx={cx} cy={cy-R*0.54} rx={R*0.64} ry={R*0.11} fill="#7A7068" clipPath={`url(#cp${a.id}s${S})`}/>
        <rect   x={cx-R*0.38} y={cy-R*0.62} width={R*0.76} height={R*0.10} rx={0} fill="#5A5048" clipPath={`url(#cp${a.id}s${S})`}/>
      </>)}

      {a.acc === "dark-scarf" && (<>
        <rect x={cx-R*0.72} y={cy+R*0.50} width={R*1.44} height={R*0.35} rx={R*0.10} fill="#282840" clipPath={`url(#cp${a.id}s${S})`}/>
        <ellipse cx={cx} cy={cy+R*0.62} rx={R*0.20} ry={R*0.15} fill="#404060" clipPath={`url(#cp${a.id}s${S})`}/>
      </>)}

      {a.acc === "blue-hood" && (<>
        <path
          d={`M ${cx-R*0.95} ${cy+R*0.28} Q ${cx-R*1.02} ${cy-R*0.62} ${cx} ${cy-R*0.94} Q ${cx+R*1.02} ${cy-R*0.62} ${cx+R*0.95} ${cy+R*0.28} Z`}
          fill="#2A68B8" opacity={0.52} clipPath={`url(#cp${a.id}s${S})`}
        />
      </>)}

      {a.acc === "purple-beanie" && (<>
        <path
          d={`M ${cx-R*0.74} ${cy-R*0.06} Q ${cx-R*0.80} ${cy-R*0.96} ${cx} ${cy-R*1.02} Q ${cx+R*0.80} ${cy-R*0.96} ${cx+R*0.74} ${cy-R*0.06} Z`}
          fill="#5818A0" clipPath={`url(#cp${a.id}s${S})`}
        />
        <rect x={cx-R*0.74} y={cy-R*0.18} width={R*1.48} height={R*0.22} rx={R*0.06} fill="#3C1078" clipPath={`url(#cp${a.id}s${S})`}/>
        <circle cx={cx} cy={cy-R*0.96} r={R*0.15} fill="white" opacity={0.82} clipPath={`url(#cp${a.id}s${S})`}/>
      </>)}

      {/* ── face oval ── */}
      <ellipse cx={cx} cy={faceCy} rx={faceRx} ry={faceRy} fill={`url(#sk${a.id}s${S})`}/>

      {/* ── eyes ── */}
      <ellipse cx={cx-eyeOff} cy={eyeY} rx={3.2} ry={4.2} fill="#231510"/>
      <ellipse cx={cx+eyeOff} cy={eyeY} rx={3.2} ry={4.2} fill="#231510"/>
      <circle  cx={cx-eyeOff+1.4} cy={eyeY-1.8} r={1.3} fill="white"/>
      <circle  cx={cx+eyeOff+1.4} cy={eyeY-1.8} r={1.3} fill="white"/>

      {/* ── smile ── */}
      <path d={`M ${cx-mouthX} ${mouthY1} Q ${cx} ${mouthY2} ${cx+mouthX} ${mouthY1}`}
        stroke="#231510" strokeWidth={2} strokeLinecap="round" fill="none"/>

      {/* ── blush ── */}
      <ellipse cx={cx-R*0.35} cy={cy+R*0.18} rx={R*0.16} ry={R*0.10} fill="#FF7080" opacity={0.30}/>
      <ellipse cx={cx+R*0.35} cy={cy+R*0.18} rx={R*0.16} ry={R*0.10} fill="#FF7080" opacity={0.30}/>

      {/* rim */}
      <circle cx={cx} cy={cy} r={R - 0.5} fill="none" stroke={a.bubbleBot} strokeWidth={1.5} opacity={0.35}/>
    </svg>
  );
}

export default function AgentBubbles({ onAgentSelect }: { onAgentSelect?: (agent: Agent) => void }) {
  const [active, setActive] = useState<Agent | null>(null);

  const handleSelect = (agent: Agent) => {
    setActive(p => p?.id === agent.id ? null : agent);
    if (onAgentSelect) {
      onAgentSelect(agent);
    }
  };

  return (
    <div className="w-full flex flex-col items-center gap-6 py-4 overflow-hidden">
      <style>{`
        :root {
          --bubble-size: 80px;
          --bubble-overlap: 20px;
          --bubble-border: 4px;
        }

        @media (max-width: 768px) {
          :root {
            --bubble-size: 60px;
            --bubble-overlap: 15px;
            --bubble-border: 3px;
          }
        }

        @media (max-width: 480px) {
          :root {
            --bubble-size: 42px;
            --bubble-overlap: 10px;
            --bubble-border: 2px;
          }
        }

        .ab-container {
          width: 100%;
          display: flex;
          justify-content: center;
          padding: 10px 0 20px 0;
        }

        .ab-row {
          display: flex;
          align-items: center;
          padding-left: var(--bubble-overlap);
          max-width: 100%;
          overflow-x: auto;
          overflow-y: visible;
          padding-bottom: 10px;
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .ab-row::-webkit-scrollbar {
          display: none;
        }

        .ab-btn {
          cursor: pointer;
          border: none;
          background: none;
          padding: 0;
          border-radius: 50%;
          display: block;
          margin-left: calc(var(--bubble-overlap) * -1);
          transition: transform .22s cubic-bezier(.34,1.56,.64,1);
          position: relative;
          z-index: 1;
          outline: none;
          flex-shrink: 0;
        }
        .ab-btn:first-child { margin-left: 0; }

        .ab-tooltip {
          position: absolute;
          bottom: calc(100% + 12px);
          left: 50%;
          transform: translateX(-50%) translateY(10px);
          background: var(--c-surface-2);
          border: 1px solid var(--c-border-default);
          padding: 6px 10px;
          border-radius: 10px;
          white-space: nowrap;
          pointer-events: none;
          opacity: 0;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          z-index: 50;
          box-shadow: 0 10px 25px rgba(0,0,0,0.3);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }

        .ab-btn:hover .ab-tooltip {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }

        .ab-tooltip b {
          color: var(--c-text-primary);
          font-size: 11px;
          font-family: Inter, sans-serif;
        }
        .ab-tooltip span {
          color: var(--c-accent);
          font-size: 9px;
          font-family: Inter, sans-serif;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .ab-btn:hover,
        .ab-btn:focus-visible {
          transform: translateY(-8px) scale(1.1);
          z-index: 30 !important;
        }
        .ab-btn.is-active {
          transform: translateY(-8px) scale(1.1);
          z-index: 30 !important;
        }

        .ab-card {
          background: var(--c-card);
          border-radius: 20px;
          padding: 12px 18px;
          display: flex;
          align-items: center;
          gap: 14px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px var(--c-border-subtle);
          animation: ab-in .28s cubic-bezier(.34,1.56,.64,1) both;
          width: 90%;
          max-width: 400px;
          border: 1px solid var(--c-accent-soft);
          margin: 0 auto;
        }
        @keyframes ab-in {
          from { opacity:0; transform:translateY(14px) scale(.93); }
          to   { opacity:1; transform:none; }
        }
        .ab-info {
          min-width: 0;
          flex: 1;
        }
        .ab-info h3 {
          margin: 0 0 2px;
          font-size: 0.95rem;
          font-weight: 700;
          color: var(--c-text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ab-info p {
          margin: 0;
          font-size: .72rem;
          color: var(--c-text-muted);
          line-height: 1.3;
        }
        .ab-pill {
          margin-top: 5px;
          display: inline-block;
          padding: 2px 10px;
          border-radius: 99px;
          font-size: .6rem;
          font-weight: 700;
          letter-spacing: .05em;
          color: white;
          background: linear-gradient(135deg,var(--c-accent),var(--c-accent-hover));
          text-transform: uppercase;
        }
        .ab-x {
          margin-left: auto;
          flex-shrink: 0;
          align-self: flex-start;
          width: 20px; height: 20px;
          border-radius: 50%;
          border: none;
          background: var(--c-surface-2);
          color: var(--c-text-muted);
          font-size: 9px;
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: all .15s;
        }
        .ab-x:hover { background: var(--c-surface-3); color: var(--c-text-primary); }

        .bubble-inner {
            width: var(--bubble-size);
            height: var(--bubble-size);
            transition: all 0.2s ease;
        }
      `}</style>

      <div className="ab-container">
        <div className="ab-row">
          {AGENTS.map((agent, i) => (
            <button
              key={agent.id}
              className={`ab-btn${active?.id === agent.id ? " is-active" : ""}`}
              style={{ zIndex: active?.id === agent.id ? 100 : i + 1 }}
              onClick={() => handleSelect(agent)}
              aria-label={`${agent.name} – ${agent.role}`}
            >
              <div className="ab-tooltip">
                  <b>{agent.name}</b>
                  <span>{agent.role}</span>
              </div>
              <div className="bubble-inner">
                <Face a={agent} size={100} />
              </div>
            </button>
          ))}
        </div>
      </div>

      {active && (
        <div className="ab-card">
          <div className="shrink-0 scale-75 sm:scale-100 origin-left">
            <Face a={active} size={64} />
          </div>
          <div className="ab-info">
            <h3>{active.name}</h3>
            <p className="line-clamp-2">{active.description}</p>
            <span className="ab-pill">{active.role}</span>
          </div>
          <button className="ab-x" onClick={() => setActive(null)} aria-label="Close">✕</button>
        </div>
      )}

    </div>
  );
}

