'use client';

import { useCallback, useEffect, useState } from 'react';
import { Github, CheckCircle, XCircle, Loader2, ExternalLink, Unplug, Database } from 'lucide-react';
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
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  // Manual Supabase Connection States
  const [showManualSupabase, setShowManualSupabase] = useState(false);
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState('');
  const [supabaseServiceRoleKey, setSupabaseServiceRoleKey] = useState('');
  const [savingSupabase, setSavingSupabase] = useState(false);

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
          const detail = name === 'supabase' && data.config?.url ? data.config.url : undefined;
          setConnectors((prev) => ({ ...prev, [name]: { status: 'connected', detail } }));
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

  const saveManualSupabase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabaseUrl || !supabaseAnonKey) {
      setNotification({ type: 'error', message: 'URL and Anon Key are required.' });
      return;
    }
    setSavingSupabase(true);
    try {
      const url = `${BRAIN_URL}/connect-supabase/save-credentials${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          url: supabaseUrl,
          anon_key: supabaseAnonKey,
          service_role_key: supabaseServiceRoleKey || undefined,
        }),
      });
      if (res.ok) {
        setConnectors((prev) => ({
          ...prev,
          supabase: { status: 'connected', detail: supabaseUrl },
        }));
        setNotification({ type: 'success', message: 'Supabase credentials saved successfully!' });
        setShowManualSupabase(false);
        setSupabaseUrl('');
        setSupabaseAnonKey('');
        setSupabaseServiceRoleKey('');
      } else {
        const errData = await res.json().catch(() => ({}));
        setNotification({
          type: 'error',
          message: errData.detail || 'Failed to save Supabase credentials.',
        });
      }
    } catch {
      setNotification({ type: 'error', message: 'Failed to connect to the backend.' });
    } finally {
      setSavingSupabase(false);
    }
  };

  const disconnectConnector = async (name: string) => {
    setDisconnecting(name);
    try {
      const url = `${BRAIN_URL}/connect-${name}/disconnect${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        setConnectors((prev) => ({ ...prev, [name]: { status: 'disconnected' } }));
        if (name === 'github') setGithubRepos([]);
        const displayName = name;
        setNotification({ type: 'success', message: `Disconnected from ${displayName}.` });
      } else {
        setNotification({ type: 'error', message: `Failed to disconnect.` });
      }
    } catch {
      setNotification({ type: 'error', message: `Failed to disconnect.` });
    } finally {
      setDisconnecting(null);
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const provider = params.get('provider');
      const status = params.get('status');
      const errorMsg = params.get('error');

      if (status === 'success') {
        const name = provider === 'github' ? 'GitHub' : provider;
        setNotification({
          type: 'success',
          message: `Successfully connected to ${name}!`,
        });
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (status === 'error' || errorMsg) {
        setNotification({
          type: 'error',
          message: errorMsg || `Failed to connect integration.`,
        });
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
  }, []);

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

      {notification && (
        <div className={`mb-6 p-4 rounded-xl flex items-center justify-between border ${
          notification.type === 'success'
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-200'
            : 'bg-red-500/10 border-red-500/20 text-red-200'
        }`}>
          <div className='flex items-center gap-2.5'>
            {notification.type === 'success' ? (
              <CheckCircle className='w-5 h-5 text-emerald-400 shrink-0' />
            ) : (
              <XCircle className='w-5 h-5 text-red-400 shrink-0' />
            )}
            <span className='text-[13px] font-medium'>{notification.message}</span>
          </div>
          <button
            type='button'
            onClick={() => setNotification(null)}
            className='text-text-faint hover:text-text-primary transition-colors text-xs font-bold uppercase tracking-wider'
          >
            Dismiss
          </button>
        </div>
      )}

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
              <div className='flex gap-2'>
                <button
                  type='button'
                  onClick={connectGitHub}
                  className='flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-accent/10 border border-accent/20 text-accent rounded-xl text-[13px] font-medium hover:bg-accent/20 transition-all'
                >
                  <ExternalLink size={14} /> Manage
                </button>
                <button
                  type='button'
                  onClick={() => disconnectConnector('github')}
                  disabled={disconnecting === 'github'}
                  className='flex items-center justify-center gap-2 px-4 py-2.5 bg-white/5 border border-white/10 text-white/50 rounded-xl text-[13px] font-medium hover:bg-red-500/10 hover:border-red-500/20 hover:text-red-400 transition-all disabled:opacity-50'
                >
                  {disconnecting === 'github' ? (
                    <Loader2 size={14} className='animate-spin' />
                  ) : (
                    <Unplug size={14} />
                  )}
                  Disconnect
                </button>
              </div>
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
          {connectors.supabase.status === 'connected' ? (
            <div className='space-y-4 animate-in fade-in duration-200'>
              {connectors.supabase.detail && (
                <div className='space-y-1.5'>
                  <p className='text-[10px] font-bold text-text-faint uppercase tracking-wider'>
                    Project URL
                  </p>
                  <div className='flex items-center gap-2 px-3 py-2 bg-surface-2 rounded-lg text-[12px] text-text-secondary font-mono truncate'>
                    {connectors.supabase.detail}
                  </div>
                </div>
              )}
              <div className='flex gap-2'>
                <button
                  type='button'
                  onClick={connectSupabase}
                  className='flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-accent/10 border border-accent/20 text-accent rounded-xl text-[13px] font-medium hover:bg-accent/20 transition-all'
                >
                  <ExternalLink size={14} /> Reconnect (OAuth)
                </button>
                <button
                  type='button'
                  onClick={() => disconnectConnector('supabase')}
                  disabled={disconnecting === 'supabase'}
                  className='flex items-center justify-center gap-2 px-4 py-2.5 bg-white/5 border border-white/10 text-white/50 rounded-xl text-[13px] font-medium hover:bg-red-500/10 hover:border-red-500/20 hover:text-red-400 transition-all disabled:opacity-50'
                >
                  {disconnecting === 'supabase' ? (
                    <Loader2 size={14} className='animate-spin' />
                  ) : (
                    <Unplug size={14} />
                  )}
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <div className='space-y-4'>
              {!showManualSupabase ? (
                <div className='space-y-2.5'>
                  <button
                    type='button'
                    onClick={connectSupabase}
                    disabled={connectors.supabase.status === 'loading'}
                    className='w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white text-gray-950 rounded-xl text-[13px] font-medium hover:bg-gray-100 transition-all disabled:opacity-50'
                  >
                    {connectors.supabase.status === 'loading' ? (
                      <Loader2 size={14} className='animate-spin' />
                    ) : (
                      <Database size={14} />
                    )}
                    Connect Supabase (OAuth)
                  </button>
                  <button
                    type='button'
                    onClick={() => setShowManualSupabase(true)}
                    disabled={connectors.supabase.status === 'loading'}
                    className='w-full text-center text-text-muted hover:text-text-primary transition-colors text-[12px] font-semibold underline'
                  >
                    Configure manually
                  </button>
                </div>
              ) : (
                <form onSubmit={saveManualSupabase} className='space-y-3 p-4 bg-surface-2 border border-border-default rounded-xl animate-in slide-in-from-bottom-2 duration-300'>
                  <div className='flex items-center justify-between pb-1'>
                    <span className='text-[12px] font-bold text-text-primary'>Manual Credentials</span>
                    <button
                      type='button'
                      onClick={() => setShowManualSupabase(false)}
                      className='text-[10px] text-text-faint hover:text-text-primary uppercase tracking-wider font-bold transition-colors'
                    >
                      Cancel
                    </button>
                  </div>
                  <div className='space-y-1'>
                    <label className='text-[11px] font-medium text-text-secondary'>Supabase Project URL</label>
                    <input
                      type='url'
                      required
                      placeholder='https://your-project.supabase.co'
                      value={supabaseUrl}
                      onChange={(e) => setSupabaseUrl(e.target.value)}
                      disabled={savingSupabase}
                      className='w-full bg-input border border-border-default rounded-lg px-3 py-2 text-[12px] text-text-primary focus:outline-none placeholder:text-text-faint'
                    />
                  </div>
                  <div className='space-y-1'>
                    <label className='text-[11px] font-medium text-text-secondary'>Anon / Public Key</label>
                    <input
                      type='password'
                      required
                      placeholder='Public Anon Key'
                      value={supabaseAnonKey}
                      onChange={(e) => setSupabaseAnonKey(e.target.value)}
                      disabled={savingSupabase}
                      className='w-full bg-input border border-border-default rounded-lg px-3 py-2 text-[12px] text-text-primary focus:outline-none placeholder:text-text-faint'
                    />
                  </div>
                  <div className='space-y-1'>
                    <label className='text-[11px] font-medium text-text-secondary'>Service Role Key (Optional)</label>
                    <input
                      type='password'
                      placeholder='Service Role Key (for admin tasks)'
                      value={supabaseServiceRoleKey}
                      onChange={(e) => setSupabaseServiceRoleKey(e.target.value)}
                      disabled={savingSupabase}
                      className='w-full bg-input border border-border-default rounded-lg px-3 py-2 text-[12px] text-text-primary focus:outline-none placeholder:text-text-faint'
                    />
                  </div>
                  <button
                    type='submit'
                    disabled={savingSupabase}
                    className='w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-white text-gray-950 rounded-lg text-[12px] font-bold hover:bg-gray-100 transition-all disabled:opacity-50 mt-2'
                  >
                    {savingSupabase ? (
                      <>
                        <Loader2 size={12} className='animate-spin' /> Saving...
                      </>
                    ) : (
                      'Save Connection'
                    )}
                  </button>
                </form>
              )}
            </div>
          )}
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
