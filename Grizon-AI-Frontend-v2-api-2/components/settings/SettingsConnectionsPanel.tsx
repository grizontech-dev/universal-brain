'use client';

import { useCallback, useEffect, useState } from 'react';
import { Github, Database, CheckCircle, XCircle, Loader2, ExternalLink } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

const BRAIN_URL = process.env.NEXT_PUBLIC_BRAIN_URL || 'http://localhost:8001';

type ConnectorStatus = 'loading' | 'connected' | 'disconnected' | 'error';

interface ConnectorState {
  status: ConnectorStatus;
  detail?: string;
}

const initialConnectors = {
  github: { status: 'loading' as ConnectorStatus },
  supabase: { status: 'loading' as ConnectorStatus },
};

export default function SettingsConnectionsPanel() {
  const { getAccessToken } = useAuth();
  const [connectors, setConnectors] = useState<Record<string, ConnectorState>>(initialConnectors);
  const [githubRepos, setGithubRepos] = useState<any[]>([]);

  const token = getAccessToken?.() ?? null;

  async function checkConnector(name: string, statusUrl: string) {
    try {
      const url = `${BRAIN_URL}${statusUrl}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        if (data.connected) {
          setConnectors((prev) => ({ ...prev, [name]: { status: 'connected' } }));
          if (name === 'github') {
            const reposRes = await fetch(
              `${BRAIN_URL}/connect-github/repositories${token ? `?token=${encodeURIComponent(token)}` : ''}`,
              { headers: token ? { Authorization: `Bearer ${token}` } : {} },
            );
            if (reposRes.ok) {
              const reposData = await reposRes.json();
              setGithubRepos(Array.isArray(reposData) ? reposData : []);
            }
          }
        } else {
          setConnectors((prev) => ({ ...prev, [name]: { status: 'disconnected' } }));
        }
      } else {
        setConnectors((prev) => ({ ...prev, [name]: { status: 'disconnected' } }));
      }
    } catch {
      setConnectors((prev) => ({ ...prev, [name]: { status: 'disconnected' } }));
    }
  }

  useEffect(() => {
    if (!token) return;
    setConnectors({
      github: { status: 'loading' },
      supabase: { status: 'loading' },
    });
    void checkConnector('github', '/connect-github/status');
    void checkConnector('supabase', '/connect-supabase/status');
  }, [token]);

  const connectGitHub = () => {
    const url = `${BRAIN_URL}/connect-github/login${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    window.location.href = url;
  };

  const connectSupabase = () => {
    const url = `${BRAIN_URL}/connect-supabase/login${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    window.location.href = url;
  };

  return (
    <div className='animate-in fade-in slide-in-from-bottom-2 duration-300'>
      <div className='mb-8'>
        <h1 className='text-2xl font-bold text-text-primary mb-2'>Connections</h1>
        <p className='text-[14px] text-text-muted'>
          Connect with third-party services to extend what the AI can do.
        </p>
      </div>

      <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
        {/* GitHub */}
        <div className='bg-card border border-border-subtle rounded-2xl p-6 hover:border-accent/30 transition-all group'>
          <div className='flex items-start justify-between mb-4'>
            <div className='flex items-center gap-3'>
              <div className='w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent border border-accent/20'>
                <Github size={20} />
              </div>
              <div>
                <h3 className='text-[15px] font-bold text-text-primary group-hover:text-accent transition-colors'>
                  GitHub
                </h3>
                <span className='text-[10px] font-bold text-text-faint uppercase tracking-widest'>
                  Source Control
                </span>
              </div>
            </div>
            <StatusBadge status={connectors.github.status} />
          </div>
          <p className='text-[12px] text-text-muted leading-relaxed mb-4'>
            Connect your GitHub repositories. The AI can read, search, and write code to your repos.
          </p>
          {connectors.github.status === 'connected' ? (
            <div className='space-y-3'>
              {githubRepos.length > 0 && (
                <div className='space-y-1.5'>
                  <p className='text-[11px] font-bold text-text-faint uppercase tracking-wider'>
                    Connected Repositories
                  </p>
                  <div className='max-h-32 overflow-y-auto space-y-1 custom-scrollbar'>
                    {githubRepos.map((repo: any) => (
                      <div
                        key={repo.id || repo.full_name}
                        className='flex items-center gap-2 px-3 py-1.5 bg-surface-2 rounded-lg text-[12px] text-text-secondary'
                      >
                        <Github size={12} className='shrink-0 text-text-faint' />
                        <span className='truncate'>{repo.full_name || repo.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <button
                type='button'
                onClick={connectGitHub}
                className='w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-accent/10 border border-accent/20 text-accent rounded-xl text-[13px] font-medium hover:bg-accent/20 transition-all'
              >
                <ExternalLink size={14} /> Manage
              </button>
            </div>
          ) : (
            <button
              type='button'
              onClick={connectGitHub}
              disabled={connectors.github.status === 'loading'}
              className='w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white text-gray-950 rounded-xl text-[13px] font-medium hover:bg-gray-100 transition-all disabled:opacity-50'
            >
              {connectors.github.status === 'loading' ? (
                <Loader2 size={14} className='animate-spin' />
              ) : (
                <Github size={14} />
              )}
              Connect GitHub
            </button>
          )}
        </div>

        {/* Supabase */}
        <div className='bg-card border border-border-subtle rounded-2xl p-6 hover:border-accent/30 transition-all group'>
          <div className='flex items-start justify-between mb-4'>
            <div className='flex items-center gap-3'>
              <div className='w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent border border-accent/20'>
                <Database size={20} />
              </div>
              <div>
                <h3 className='text-[15px] font-bold text-text-primary group-hover:text-accent transition-colors'>
                  Supabase
                </h3>
                <span className='text-[10px] font-bold text-text-faint uppercase tracking-widest'>
                  Database & Auth
                </span>
              </div>
            </div>
            <StatusBadge status={connectors.supabase.status} />
          </div>
          <p className='text-[12px] text-text-muted leading-relaxed mb-4'>
            Connect your Supabase project. The AI can query your database, manage auth, and inspect your schema.
          </p>
          <button
            type='button'
            onClick={connectSupabase}
            disabled={connectors.supabase.status === 'loading'}
            className='w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white text-gray-950 rounded-xl text-[13px] font-medium hover:bg-gray-100 transition-all disabled:opacity-50'
          >
            {connectors.supabase.status === 'loading' ? (
              <Loader2 size={14} className='animate-spin' />
            ) : connectors.supabase.status === 'connected' ? (
              <>
                <ExternalLink size={14} /> Reconnect
              </>
            ) : (
              <>
                <Database size={14} /> Connect Supabase
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ConnectorStatus }) {
  if (status === 'loading') {
    return (
      <div className='flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-2 border border-border-default'>
        <Loader2 size={10} className='animate-spin text-text-faint' />
        <span className='text-[10px] font-bold text-text-faint uppercase tracking-wider'>Checking</span>
      </div>
    );
  }
  if (status === 'connected') {
    return (
      <div className='flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20'>
        <CheckCircle size={10} className='text-emerald-400' />
        <span className='text-[10px] font-bold text-emerald-400 uppercase tracking-wider'>Connected</span>
      </div>
    );
  }
  return (
    <div className='flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-2 border border-border-default'>
      <XCircle size={10} className='text-text-faint' />
      <span className='text-[10px] font-bold text-text-faint uppercase tracking-wider'>Disconnected</span>
    </div>
  );
}
