'use client';

import { useState, useEffect, useCallback } from 'react';
import { Layers, RefreshCw, ChevronDown, ChevronUp, FileText, FileCode, Globe, Database, Box } from 'lucide-react';
import { getAllArtifacts, type ArtifactItem } from '../lib/artifactMemory';

interface BrainArtifactViewProps {
  projectId: string | null;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  component: <FileCode size={12} />,
  page: <Globe size={12} />,
  api: <Box size={12} />,
  schema: <Database size={12} />,
  file: <FileText size={12} />,
};

const TYPE_COLORS: Record<string, string> = {
  component: 'text-blue-400 bg-blue-500/10',
  page: 'text-emerald-400 bg-emerald-500/10',
  api: 'text-purple-400 bg-purple-500/10',
  schema: 'text-amber-400 bg-amber-500/10',
  file: 'text-white/40 bg-white/5',
};

export default function BrainArtifactView({ projectId }: BrainArtifactViewProps) {
  const [data, setData] = useState<ArtifactItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchArtifacts = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getAllArtifacts(projectId);
      setData(result);
    } catch {
      setError('Could not load artifacts');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchArtifacts();
  }, [fetchArtifacts]);

  if (!projectId) return null;

  const typeCounts: Record<string, number> = {};
  if (data) {
    for (const a of data) {
      typeCounts[a.artifact_type] = (typeCounts[a.artifact_type] || 0) + 1;
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-[#0d0d14] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-white/70 hover:text-white transition-colors"
      >
        <div className="flex items-center gap-2">
          <Layers size={14} className="text-cyan-400" />
          <span className="text-[11px] font-black uppercase tracking-widest text-white/50">
            Artifact Registry
          </span>
          {data && data.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 font-bold">
              {data.length}
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
              Loading artifacts...
            </div>
          )}

          {error && (
            <div className="text-[11px] text-amber-400/80 py-1">{error}</div>
          )}

          {!loading && !error && data && data.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pb-2">
              {Object.entries(typeCounts).map(([type, count]) => (
                <span
                  key={type}
                  className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${TYPE_COLORS[type] || 'text-white/40 bg-white/5'}`}
                >
                  {type} × {count}
                </span>
              ))}
            </div>
          )}

          {!loading && !error && (!data || data.length === 0) && (
            <div className="text-[11px] text-white/30 py-2 italic">
              No artifacts registered yet. Generated files will appear here.
            </div>
          )}

          {data?.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors group"
            >
              <span className="shrink-0 opacity-60">
                {TYPE_ICONS[item.artifact_type] || <FileText size={12} />}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-white/80 font-semibold truncate">
                    {item.name}
                  </span>
                  <span className="text-[10px] text-white/30 font-mono truncate">
                    {item.file_path}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-[9px] px-1 py-0.5 rounded font-medium uppercase ${TYPE_COLORS[item.artifact_type] || 'text-white/40 bg-white/5'}`}>
                    {item.artifact_type}
                  </span>
                  {item.language && (
                    <span className="text-[9px] text-white/30">
                      {item.language}
                    </span>
                  )}
                  <span className="text-[9px] text-white/20">
                    v{item.version}
                  </span>
                </div>
              </div>
              {item.size_bytes && (
                <span className="text-[9px] text-white/20 shrink-0">
                  {item.size_bytes < 1024
                    ? `${item.size_bytes}B`
                    : `${(item.size_bytes / 1024).toFixed(1)}KB`}
                </span>
              )}
            </div>
          ))}

          {!loading && !error && data && data.length > 0 && (
            <button
              onClick={fetchArtifacts}
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
