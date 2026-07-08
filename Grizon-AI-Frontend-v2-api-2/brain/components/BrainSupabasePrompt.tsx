'use client';

import { useState, useEffect, useRef } from 'react';
import { Database, Key, ExternalLink, Download, CheckCircle2, Loader2, ArrowRight, AlertCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

const BRAIN_URL = process.env.NEXT_PUBLIC_BRAIN_API_URL || 'http://localhost:8001';

interface BrainSupabasePromptProps {
  workspaceId?: string;
  onConnected?: () => void;
  onSkip?: () => void;
}

export default function BrainSupabasePrompt({ workspaceId, onConnected, onSkip }: BrainSupabasePromptProps) {
  const { getAccessToken } = useAuth();
  const [mode, setMode] = useState<'choose' | 'paste' | 'connecting' | 'setting-up' | 'done' | 'error'>('choose');
  const [url, setUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [serviceRoleKey, setServiceRoleKey] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [setupStatus, setSetupStatus] = useState('');
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (mode !== 'connecting') {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    const token = getAccessToken?.() ?? '';
    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${BRAIN_URL}/connect-supabase/status${token ? `?token=${encodeURIComponent(token)}` : ''}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          if (data.connected && data.has_credentials) {
            if (pollingRef.current) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
            // OAuth connected — now auto-create schema
            setMode('setting-up');
            setSetupStatus('Creating database tables...');
            try {
              const schemaRes = await fetch(`${BRAIN_URL}/connect-supabase/auto-schema`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                body: JSON.stringify({
                  workspace_id: workspaceId || '',
                  url: data.config?.url || '',
                  anon_key: data.config?.anon_key || '',
                }),
              });
              const schemaData = await schemaRes.json();
              if (schemaData.tables_created?.length > 0) {
                setSetupStatus(`Created ${schemaData.tables_created.length} tables`);
              } else if (schemaData.errors?.length > 0) {
                setSetupStatus(`Connected — tables need manual setup`);
              }
            } catch {
              setSetupStatus('Connected — tables need manual setup');
            }
            setMode('done');
            onConnected?.();
          }
        }
      } catch {
        // Silently retry
      }
    }, 2000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [mode, getAccessToken, onConnected, workspaceId]);

  const handleOAuth = () => {
    const token = getAccessToken?.() ?? '';
    const params = new URLSearchParams({ token: encodeURIComponent(token) });
    if (workspaceId) params.set('workspace_id', workspaceId);
    params.set('return_url', `${window.location.origin}/brain/${workspaceId || ''}`);
    window.open(`${BRAIN_URL}/connect-supabase/login?${params.toString()}`, '_blank');
    setMode('connecting');
  };

  const handleSaveCredentials = async () => {
    if (!url.trim() || !anonKey.trim()) return;
    setSaving(true);
    setErrorMsg('');
    try {
      const token = getAccessToken?.() ?? '';
      const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };

      // Save credentials to connector
      const saveRes = await fetch(`${BRAIN_URL}/connect-supabase/save-credentials`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: url.trim(), anon_key: anonKey.trim() }),
      });
      if (!saveRes.ok) throw new Error('Failed to save credentials');

      // Auto-create schema + write .env
      setMode('setting-up');
      setSetupStatus('Creating database tables...');

      const schemaRes = await fetch(`${BRAIN_URL}/connect-supabase/auto-schema`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          workspace_id: workspaceId || '',
          url: url.trim(),
          anon_key: anonKey.trim(),
          service_role_key: serviceRoleKey.trim(),
        }),
      });
      const schemaData = await schemaRes.json();

      if (schemaData.tables_created?.length > 0) {
        setSetupStatus(`Created ${schemaData.tables_created.length} tables — writing .env...`);
      } else if (schemaData.errors?.length > 0) {
        setSetupStatus('Connected — .env written, tables need manual setup');
      }

      setMode('done');
      onConnected?.();
    } catch (e: any) {
      setErrorMsg(e.message || 'Something went wrong');
      setMode('paste');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadZip = async () => {
    onSkip?.();
  };

  if (mode === 'done') {
    return (
      <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle2 size={16} className="text-emerald-400" />
          <span className="text-sm font-bold text-emerald-300">Supabase Connected</span>
        </div>
        <p className="text-xs text-emerald-300/60">
          {setupStatus || 'Your Supabase credentials have been saved and applied to the project.'}
        </p>
      </div>
    );
  }

  if (mode === 'setting-up') {
    return (
      <div className="p-4 rounded-xl bg-[#976df8]/10 border border-[#976df8]/20">
        <div className="flex items-center gap-2 mb-2">
          <Loader2 size={16} className="text-[#976df8] animate-spin" />
          <span className="text-sm font-bold text-white/80">Setting up Supabase...</span>
        </div>
        <p className="text-xs text-white/40">{setupStatus}</p>
      </div>
    );
  }

  if (mode === 'connecting') {
    return (
      <div className="p-4 rounded-xl bg-white/5 border border-white/10">
        <div className="flex items-center gap-2 mb-2">
          <Loader2 size={16} className="text-[#976df8] animate-spin" />
          <span className="text-sm font-bold text-white/80">Waiting for Supabase connection...</span>
        </div>
        <p className="text-xs text-white/40 mb-3">Complete the login in the popup window, then come back here.</p>
        <button onClick={() => setMode('choose')} className="text-xs text-white/40 hover:text-white/70 transition-colors">
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 rounded-xl bg-white/5 border border-white/10">
      <div className="flex items-center gap-2 mb-3">
        <Database size={16} className="text-[#976df8]" />
        <span className="text-sm font-bold text-white/90">Connect Supabase</span>
      </div>
      <p className="text-xs text-white/40 mb-4 leading-relaxed">
        Your project uses Supabase for database and auth. Connect now to auto-create tables and enable live features.
      </p>

      {mode === 'choose' && (
        <div className="space-y-2">
          <button
            onClick={handleOAuth}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white text-gray-950 text-sm font-medium hover:bg-gray-100 transition-all"
          >
            <Database size={14} /> Connect Supabase Account
          </button>
          <button
            onClick={() => setMode('paste')}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/70 text-sm font-medium hover:bg-white/10 transition-all"
          >
            <Key size={14} /> Paste Credentials Manually
          </button>
          <button
            onClick={handleDownloadZip}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-white/30 text-xs hover:text-white/50 transition-all"
          >
            <Download size={12} /> Skip — Download Project & Set Up Locally
          </button>
        </div>
      )}

      {mode === 'paste' && (
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] text-white/40 mb-1 font-medium">Supabase Project URL</label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://xyzproject.supabase.co"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[#976df8]/50 transition-all"
            />
          </div>
          <div>
            <label className="block text-[11px] text-white/40 mb-1 font-medium">Anon Key</label>
            <input
              type="password"
              value={anonKey}
              onChange={(e) => setAnonKey(e.target.value)}
              placeholder="eyJhbGciOiJIUzI1NiIs..."
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[#976df8]/50 transition-all"
            />
          </div>
          <div>
            <label className="block text-[11px] text-white/40 mb-1 font-medium">
              Service Role Key <span className="text-white/20">(optional — enables auto table creation)</span>
            </label>
            <input
              type="password"
              value={serviceRoleKey}
              onChange={(e) => setServiceRoleKey(e.target.value)}
              placeholder="eyJhbGciOiJIUzI1NiIs..."
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[#976df8]/50 transition-all"
            />
          </div>
          {errorMsg && (
            <div className="flex items-start gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertCircle size={14} className="text-red-400 mt-0.5 shrink-0" />
              <p className="text-xs text-red-400">{errorMsg}</p>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleSaveCredentials}
              disabled={!url.trim() || !anonKey.trim() || saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white text-gray-950 text-sm font-medium hover:bg-gray-100 transition-all disabled:opacity-40"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
              Save, Create Tables & Connect
            </button>
            <button
              onClick={() => setMode('choose')}
              className="px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/50 text-sm hover:bg-white/10 transition-all"
            >
              Back
            </button>
          </div>
          <p className="text-[10px] text-white/20">
            Find these in your Supabase dashboard under Settings → API. Paste the service_role key to auto-create tables.
          </p>
        </div>
      )}
    </div>
  );
}
