'use client';

import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, RefreshCw, ChevronDown, ChevronUp, Edit3 } from 'lucide-react';
import { getActiveDecisions, overrideDecision, type ActiveDecisionsResponse } from '../lib/decisionMemory';

interface BrainDecisionViewProps {
  projectId: string | null;
  onDecisionOverride?: (key: string, newVal: string) => void;
}

const DECISION_LABELS: Record<string, string> = {
  frontend: 'Frontend Framework',
  backend: 'Backend Framework',
  database: 'Database',
  theme: 'Theme',
  auth: 'Authentication',
  css: 'CSS Framework',
  api_style: 'API Style',
};

const DECISION_ICONS: Record<string, string> = {
  frontend: '⚛️',
  backend: '⚙️',
  database: '🗄️',
  theme: '🎨',
  auth: '🔐',
  css: '💅',
  api_style: '🔗',
};

export default function BrainDecisionView({ projectId, onDecisionOverride }: BrainDecisionViewProps) {
  const [data, setData] = useState<ActiveDecisionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const fetchDecisions = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getActiveDecisions(projectId);
      setData(result);
    } catch {
      setError('Could not load decisions');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchDecisions();
  }, [fetchDecisions]);

  const handleOverride = async (key: string) => {
    if (!projectId || !editValue.trim()) return;
    try {
      await overrideDecision(projectId, key, editValue.trim());
      setEditingKey(null);
      setEditValue('');
      onDecisionOverride?.(key, editValue.trim());
      await fetchDecisions();
    } catch {
      setError('Failed to override decision');
    }
  };

  const entries = data?.items?.filter((d) => d.is_active) ?? [];

  if (!projectId) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-[#0d0d14] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-white/70 hover:text-white transition-colors"
      >
        <div className="flex items-center gap-2">
          <CheckCircle size={14} className="text-emerald-400" />
          <span className="text-[11px] font-black uppercase tracking-widest text-white/50">
            Approved Decisions
          </span>
          {entries.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold">
              {entries.length}
            </span>
          )}
        </div>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-2">
          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs py-2">
              <RefreshCw size={12} className="animate-spin" />
              Loading decisions...
            </div>
          )}

          {error && (
            <div className="text-[11px] text-amber-400/80 py-1">{error}</div>
          )}

          {!loading && !error && entries.length === 0 && (
            <div className="text-[11px] text-white/30 py-2 italic">
              No decisions recorded yet. Approve a plan to store decisions.
            </div>
          )}

          {entries.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between group px-3 py-1.5 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs shrink-0">
                  {DECISION_ICONS[item.decision_key] ?? '•'}
                </span>
                <span className="text-[11px] text-white/50 font-medium uppercase tracking-wider shrink-0">
                  {DECISION_LABELS[item.decision_key] ?? item.decision_key}
                </span>
                {editingKey === item.decision_key ? (
                  <div className="flex items-center gap-1 ml-2">
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleOverride(item.decision_key);
                        if (e.key === 'Escape') setEditingKey(null);
                      }}
                      className="w-20 bg-white/10 border border-white/20 rounded px-1.5 py-0.5 text-[11px] text-white outline-none focus:border-white/40"
                      autoFocus
                    />
                    <button
                      onClick={() => handleOverride(item.decision_key)}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold hover:bg-emerald-500/30"
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <span className="text-[12px] text-white/80 font-semibold truncate ml-2">
                    {item.decision_val}
                  </span>
                )}
              </div>
              <button
                onClick={() => {
                  setEditingKey(item.decision_key);
                  setEditValue(item.decision_val);
                }}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-white/10 text-white/30 hover:text-white/60"
              >
                <Edit3 size={11} />
              </button>
            </div>
          ))}

          {!loading && !error && entries.length > 0 && (
            <button
              onClick={fetchDecisions}
              className="w-full flex items-center justify-center gap-1.5 mt-2 text-[10px] text-white/20 hover:text-white/40 transition-colors"
            >
              <RefreshCw size={10} />
              Refresh
            </button>
          )}
        </div>
      )}
    </div>
  );
}
