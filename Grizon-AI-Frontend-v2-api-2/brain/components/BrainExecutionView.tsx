'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Activity, CheckCircle, XCircle, Clock, RefreshCw,
  ChevronDown, ChevronUp, AlertTriangle, FileText,
} from 'lucide-react';
import {
  getExecutionSummary,
  getFailedTasks,
  type ExecutionSummary,
  type ExecutionLog,
} from '../lib/executionMemory';

interface BrainExecutionViewProps {
  projectId: string | null;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  completed: <CheckCircle size={12} className="text-emerald-400" />,
  failed: <XCircle size={12} className="text-red-400" />,
  in_progress: <Activity size={12} className="text-blue-400 animate-pulse" />,
  pending: <Clock size={12} className="text-white/30" />,
};

const STATUS_COLORS: Record<string, string> = {
  completed: 'text-emerald-400',
  failed: 'text-red-400',
  in_progress: 'text-blue-400',
  pending: 'text-white/30',
};

export default function BrainExecutionView({ projectId }: BrainExecutionViewProps) {
  const [summary, setSummary] = useState<ExecutionSummary | null>(null);
  const [failedTasks, setFailedTasks] = useState<ExecutionLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const [s, f] = await Promise.all([
        getExecutionSummary(projectId),
        getFailedTasks(projectId),
      ]);
      setSummary(s);
      setFailedTasks(f);
    } catch {
      setError('Could not load execution data');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalTasks = summary?.summary?.reduce((acc, s) => acc + Number(s.count), 0) ?? 0;
  const completedCount = Number(summary?.summary?.find((s) => s.status === 'completed')?.count ?? 0);
  const failedCount = Number(summary?.summary?.find((s) => s.status === 'failed')?.count ?? 0);

  if (!projectId) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-[#0d0d14] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-white/70 hover:text-white transition-colors"
      >
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-blue-400" />
          <span className="text-[11px] font-black uppercase tracking-widest text-white/50">
            Execution Log
          </span>
          {totalTasks > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/50 font-bold">
              {totalTasks}
            </span>
          )}
        </div>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs py-2">
              <RefreshCw size={12} className="animate-spin" />
              Loading execution data...
            </div>
          )}

          {error && (
            <div className="text-[11px] text-amber-400/80 py-1">{error}</div>
          )}

          {!loading && !error && totalTasks === 0 && (
            <div className="text-[11px] text-white/30 py-2 italic">
              No tasks executed yet.
            </div>
          )}

          {!loading && !error && totalTasks > 0 && (
            <>
              {/* Summary stats */}
              <div className="grid grid-cols-3 gap-2">
                <div className="px-3 py-2 rounded-lg bg-white/[0.02] border border-white/5 text-center">
                  <div className="text-[18px] font-bold text-white/80">{totalTasks}</div>
                  <div className="text-[9px] text-white/30 uppercase tracking-wider font-medium">Total</div>
                </div>
                <div className="px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10 text-center">
                  <div className="text-[18px] font-bold text-emerald-400">{completedCount}</div>
                  <div className="text-[9px] text-emerald-400/50 uppercase tracking-wider font-medium">Done</div>
                </div>
                <div className="px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/10 text-center">
                  <div className="text-[18px] font-bold text-red-400">{failedCount}</div>
                  <div className="text-[9px] text-red-400/50 uppercase tracking-wider font-medium">Failed</div>
                </div>
              </div>

              {/* Failed tasks */}
              {failedTasks.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[10px] text-red-400/70 font-bold uppercase tracking-wider">
                    <AlertTriangle size={10} />
                    Failed Tasks
                  </div>
                  {failedTasks.map((task) => (
                    <div
                      key={task.id}
                      className="px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/10"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[12px] text-white/70 font-medium truncate">
                          {task.task_name}
                        </span>
                        <span className="text-[10px] text-white/30 font-mono">
                          {task.retry_count > 0 && `retry #${task.retry_count}`}
                        </span>
                      </div>
                      {task.error_message && (
                        <div className="text-[10px] text-red-300/70 font-mono truncate">
                          {task.error_message}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={fetchData}
                className="w-full flex items-center justify-center gap-1.5 mt-1 text-[10px] text-white/20 hover:text-white/40 transition-colors"
              >
                <RefreshCw size={10} />
                Refresh
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
