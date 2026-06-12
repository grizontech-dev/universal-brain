'use client';

import { useCallback, useState } from 'react';
import {
  Download,
  Eye,
  Loader2,
  Sparkles,
} from 'lucide-react';
import type { ApiMessageArtifact } from '@/lib/chat-contracts';
import { saveMessageArtifactToDisk } from '@/lib/chat-rest-api';
import { visualForArtifact } from '@/lib/file-visual';

function MessageArtifactRow({
  artifact,
  onError,
  onView,
}: {
  artifact: ApiMessageArtifact;
  onError?: (message: string) => void;
  onView?: (artifact: ApiMessageArtifact) => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const visual = visualForArtifact(artifact.type, artifact.filename || artifact.title);
  const VIcon = visual.Icon;
  const displayName = artifact.filename?.trim() || artifact.title?.trim() || 'Generated file';

  const handleDownload = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await saveMessageArtifactToDisk(artifact);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not download file';
      onError?.(msg);
    } finally {
      setDownloading(false);
    }
  }, [artifact, downloading, onError]);

  const handleView = useCallback(() => {
    onView?.(artifact);
  }, [artifact, onView]);

  return (
    <div
      className="w-full flex items-center gap-4 rounded-2xl border border-accent/20 bg-card px-4 py-3.5 shadow-[0_4px_24px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.04)]"
      role="group"
      aria-label={`Generated file: ${displayName}`}
    >
      <div
        className={`shrink-0 w-12 h-12 rounded-xl border flex items-center justify-center bg-gradient-to-br from-purple-500/25 to-violet-600/15 border-purple-400/20`}
      >
        <VIcon size={22} className={visual.colorClass} aria-hidden />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[14px] sm:text-[15px] font-semibold text-text-primary truncate leading-snug">
          {displayName}
        </p>
        <p className="mt-0.5 text-[11px] text-text-muted flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-accent">
            <Sparkles size={10} className="shrink-0" aria-hidden />
            Generated
          </span>
          <span className="text-text-faint">·</span>
          <span className={visual.colorClass}>{visual.label}</span>
          {artifact.versionNumber > 1 ? (
            <>
              <span className="text-text-faint">·</span>
              <span className="tabular-nums">v{artifact.versionNumber}</span>
            </>
          ) : null}
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => void handleDownload()}
          disabled={downloading}
          title={`Download ${displayName}`}
          aria-label={`Download ${displayName}`}
          className="w-10 h-10 rounded-xl border border-border-default bg-surface-2 text-text-secondary hover:text-text-primary hover:bg-surface-3 hover:border-border-strong flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {downloading ? (
            <Loader2 size={18} className="animate-spin" aria-hidden />
          ) : (
            <Download size={18} aria-hidden />
          )}
        </button>
        <button
          type="button"
          onClick={handleView}
          disabled={!onView}
          title={`View ${displayName}`}
          aria-label={`View ${displayName}`}
          className="h-10 px-3.5 rounded-xl border border-border-default bg-surface-1 text-[12px] font-semibold text-text-secondary hover:text-text-primary hover:bg-surface-2 hover:border-border-strong flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Eye size={16} aria-hidden />
          View
        </button>
      </div>
    </div>
  );
}

export default function MessageArtifactRows({
  artifacts,
  onError,
  onView,
}: {
  artifacts: ApiMessageArtifact[];
  onError?: (message: string) => void;
  onView?: (artifact: ApiMessageArtifact) => void;
}) {
  if (!artifacts.length) return null;

  return (
    <div className="w-full flex flex-col gap-2.5 mt-2.5">
      {artifacts.map((artifact) => (
        <MessageArtifactRow
          key={artifact.id}
          artifact={artifact}
          onError={onError}
          onView={onView}
        />
      ))}
    </div>
  );
}
