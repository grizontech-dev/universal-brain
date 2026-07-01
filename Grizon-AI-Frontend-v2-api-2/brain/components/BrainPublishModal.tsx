'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Github, Globe, Loader2, CheckCircle2, XCircle, ArrowLeft, ExternalLink, Lock, Unlock, Key, RefreshCw,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

const BRAIN_URL = process.env.NEXT_PUBLIC_BRAIN_API_URL || 'http://localhost:8001';

interface RepoInfo {
  name: string;
  full_name: string;
  html_url: string;
  clone_url: string;
  default_branch: string;
}

interface BrainPublishModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileCount: number;
  onPublish: (repoName: string, description: string, isPrivate: boolean, githubToken?: string) => Promise<{
    success: boolean;
    repository?: { html_url: string; full_name: string };
    error?: string;
  }>;
  onPushChanges: (files: { path: string; content: string }[]) => Promise<{
    success: boolean;
    files_pushed?: number;
    error?: string;
  }>;
}

type PublishStep = 'checking' | 'connect' | 'token' | 'checking-diff' | 'connected' | 'create' | 'pushing' | 'done' | 'error';

export default function BrainPublishModal({ isOpen, onClose, fileCount, onPublish, onPushChanges }: BrainPublishModalProps) {
  const { getAccessToken } = useAuth();
  const [step, setStep] = useState<PublishStep>('checking');
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);
  const [repoName, setRepoName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [patInput, setPatInput] = useState('');
  const [pushResult, setPushResult] = useState<{ files_pushed?: number } | null>(null);
  const [hasChanges, setHasChanges] = useState(true);
  const [changeCount, setChangeCount] = useState(0);

  async function checkConnection() {
    try {
      const token = getAccessToken?.() ?? '';
      const res = await fetch(`${BRAIN_URL}/connect-github/status${token ? `?token=${encodeURIComponent(token)}` : ''}`);
      if (res.ok) {
        const data = await res.json();
        if (!data.connected) {
          setStep('connect');
        } else if (!data.has_token) {
          setStep('token');
        } else if (data.repo) {
          setRepoInfo(data.repo);
          setStep('checking-diff');
          checkDiff(data.repo);
        } else {
          setStep('create');
        }
      } else {
        setStep('connect');
      }
    } catch {
      setStep('connect');
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    setStep('checking');
    setRepoName('');
    setDescription('');
    setIsPrivate(true);
    setErrorMsg('');
    setPatInput('');
    setPushResult(null);
    checkConnection();
  }, [isOpen]);

  const checkDiff = async (repo: RepoInfo) => {
    try {
      const wid = (window as any).__brainJobId || '';
      const token = getAccessToken?.() ?? '';

      const listRes = await fetch(`${BRAIN_URL}/brain/sandbox/list-files?workspace_id=${wid}&sandbox_id=${wid}${token ? `&token=${encodeURIComponent(token)}` : ''}`);
      const listData = await listRes.json();
      const allPaths: string[] = [];
      const walk = (items: any[]) => {
        for (const item of items) {
          if (item.type === 'file' && item.path) allPaths.push(item.path);
          if (item.children) walk(item.children);
        }
      };
      walk(listData.files || []);

      const fetchOne = async (path: string): Promise<{ path: string; content: string } | null> => {
        try {
          const res = await fetch(`${BRAIN_URL}/brain/sandbox/read-file?workspace_id=${wid}&path=${encodeURIComponent(path)}${token ? `&token=${encodeURIComponent(token)}` : ''}`);
          if (res.ok) {
            const data = await res.json();
            return data.content != null ? { path, content: data.content } : null;
          }
        } catch {}
        return null;
      };

      const results = await Promise.all(allPaths.map(fetchOne));
      const localFiles = results.filter(Boolean) as { path: string; content: string }[];

      let diffCount = 0;
      for (const file of localFiles) {
        try {
          const ghRes = await fetch(
            `${BRAIN_URL}/connect-github/github-file?full_name=${encodeURIComponent(repo.full_name)}&path=${encodeURIComponent(file.path)}`,
            {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            }
          );
          if (!ghRes.ok) { diffCount++; continue; }
          const ghData = await ghRes.json();
          if (!ghData.exists || ghData.content !== file.content) diffCount++;
        } catch {
          diffCount++;
        }
      }

      setChangeCount(diffCount);
      setHasChanges(diffCount > 0);
      setStep('connected');
    } catch {
      setChangeCount(fileCount);
      setHasChanges(true);
      setStep('connected');
    }
  };

  const handleConnect = useCallback(() => {
    const token = getAccessToken?.() ?? '';
    const url = `${BRAIN_URL}/connect-github/login${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    const popup = window.open(url, 'github-oauth', 'width=600,height=700');
    const timer = setInterval(() => {
      if (!popup || popup.closed) {
        clearInterval(timer);
        setTimeout(checkConnection, 500);
      }
    }, 1000);
  }, [getAccessToken]);

  const handleSaveToken = async () => {
    if (!patInput.trim()) return;
    try {
      const token = getAccessToken?.() ?? '';
      const res = await fetch(`${BRAIN_URL}/connect-github/save-pat${token ? `?token=${encodeURIComponent(token)}` : ''}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ token: patInput.trim() }),
      });
      if (res.ok) {
        setStep('create');
      } else {
        setErrorMsg('Failed to save token');
      }
    } catch {
      setErrorMsg('Network error');
    }
  };

  const handleCreateRepo = async () => {
    if (!repoName.trim()) return;
    setStep('pushing');
    setErrorMsg('');
    try {
      const res = await onPublish(repoName.trim(), description.trim(), isPrivate);
      if (res.success && res.repository) {
        setRepoInfo(res.repository as RepoInfo);
        setStep('done');
      } else {
        setErrorMsg(res.error || 'Failed to create repository');
        setStep('error');
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Something went wrong');
      setStep('error');
    }
  };

  const handlePushChanges = async () => {
    setStep('pushing');
    setPushResult(null);
    setErrorMsg('');
    try {
      const token = getAccessToken?.() ?? '';
      const wid = (window as any).__brainJobId || '';
      const filesRes = await fetch(`${BRAIN_URL}/brain/sandbox/list-files?workspace_id=${wid}&sandbox_id=${wid}${token ? `&token=${encodeURIComponent(token)}` : ''}`);
      const filesData = await filesRes.json();
      const allPaths: string[] = [];
      const walk = (items: any[]) => {
        for (const item of items) {
          if (item.type === 'file' && item.path) allPaths.push(item.path);
          if (item.children) walk(item.children);
        }
      };
      walk(filesData.files || []);

      const fetchOne = async (path: string): Promise<{ path: string; content: string } | null> => {
        try {
          const res = await fetch(`${BRAIN_URL}/brain/sandbox/read-file?workspace_id=${wid}&path=${encodeURIComponent(path)}${token ? `&token=${encodeURIComponent(token)}` : ''}`);
          if (res.ok) {
            const data = await res.json();
            return data.content != null ? { path, content: data.content } : null;
          }
        } catch {}
        return null;
      };

      const results = await Promise.all(allPaths.map(fetchOne));
      const localFiles = results.filter(Boolean) as { path: string; content: string }[];

      const changedFiles: { path: string; content: string }[] = [];
      for (const file of localFiles) {
        try {
          const ghRes = await fetch(
            `${BRAIN_URL}/connect-github/github-file?full_name=${encodeURIComponent(repoInfo!.full_name)}&path=${encodeURIComponent(file.path)}`,
            {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            }
          );
          if (!ghRes.ok) { changedFiles.push(file); continue; }
          const ghData = await ghRes.json();
          if (!ghData.exists || ghData.content !== file.content) changedFiles.push(file);
        } catch {
          changedFiles.push(file);
        }
      }

      if (!changedFiles.length) {
        setErrorMsg('No changes detected');
        setStep('connected');
        return;
      }

      const pushRes = await onPushChanges(changedFiles);
      if (pushRes.success) {
        setPushResult({ files_pushed: pushRes.files_pushed });
        setStep('done');
      } else {
        setErrorMsg(pushRes.error || 'Push failed');
        setStep('error');
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Something went wrong');
      setStep('error');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#121212] p-6 text-white shadow-2xl relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-white/40 hover:text-white/80 transition-colors"
        >
          <XCircle size={20} />
        </button>

        {step === 'checking' && (
          <div className="flex flex-col items-center py-8">
            <Loader2 size={32} className="text-[#976df8] animate-spin mb-4" />
            <p className="text-sm text-white/60">Checking GitHub connection...</p>
          </div>
        )}

        {step === 'connect' && (
          <div className="flex flex-col items-center py-6">
            <div className="w-14 h-14 rounded-full bg-[#976df8]/10 border border-[#976df8]/20 flex items-center justify-center mb-4">
              <Github size={28} className="text-[#976df8]" />
            </div>
            <h2 className="text-lg font-bold mb-2">Connect GitHub</h2>
            <p className="text-sm text-white/50 text-center mb-6 max-w-sm">
              Connect your GitHub account to publish this project directly to a new repository.
            </p>
            <button
              type="button"
              onClick={handleConnect}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-white text-gray-950 text-sm font-medium hover:bg-gray-100 transition-all"
            >
              <Github size={16} /> Connect to GitHub
            </button>
          </div>
        )}

        {step === 'token' && (
          <div className="flex flex-col py-6">
            <div className="flex items-center gap-2 mb-4">
              <Key size={18} className="text-[#976df8]" />
              <h2 className="text-lg font-bold">GitHub Token</h2>
            </div>
            <p className="text-sm text-white/50 mb-3">
              Enter a Personal Access Token to create repositories on your account.
            </p>
            <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 mb-3">
              <p className="text-xs text-white/40">
                1. Go to <a href="https://github.com/settings/tokens/new" target="_blank" rel="noopener noreferrer" className="text-[#976df8] hover:underline">github.com/settings/tokens/new</a>
              </p>
              <p className="text-xs text-white/40">2. Give it a name, select <strong className="text-white/60">repo</strong> scope</p>
              <p className="text-xs text-white/40">3. Generate and paste below</p>
            </div>
            <input
              type="password"
              value={patInput}
              onChange={(e) => setPatInput(e.target.value)}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-[#976df8]/50 transition-all mb-4"
            />
            {errorMsg && <p className="text-sm text-red-400 mb-3">{errorMsg}</p>}
            <button
              type="button"
              onClick={handleSaveToken}
              disabled={!patInput.trim()}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white text-gray-950 text-sm font-medium hover:bg-gray-100 transition-all disabled:opacity-40"
            >
              Save & Continue
            </button>
          </div>
        )}

        {step === 'checking-diff' && (
          <div className="flex flex-col items-center py-8">
            <Loader2 size={32} className="text-[#976df8] animate-spin mb-4" />
            <p className="text-sm text-white/60">Checking for changes...</p>
          </div>
        )}

        {step === 'connected' && repoInfo && (
          <div className="py-4">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle2 size={18} className="text-emerald-400" />
              <h2 className="text-lg font-bold">Connected</h2>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-5">
              <p className="text-xs text-white/40 mb-1">Repository</p>
              <a
                href={repoInfo.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm text-[#976df8] hover:underline font-medium"
              >
                {repoInfo.full_name} <ExternalLink size={12} />
              </a>
            </div>
            {hasChanges ? (
              <>
                <p className="text-sm text-white/50 mb-5">
                  {changeCount} file{changeCount !== 1 ? 's' : ''} changed.
                </p>
                <button
                  type="button"
                  onClick={handlePushChanges}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white text-gray-950 text-sm font-medium hover:bg-gray-100 transition-all"
                >
                  <RefreshCw size={14} /> Push Changes
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 mb-4">
                <CheckCircle2 size={16} className="text-emerald-400" />
                <p className="text-sm text-emerald-300">No changes — everything is up to date.</p>
              </div>
            )}
            <button
              type="button"
              onClick={() => setStep('create')}
              className="w-full mt-3 flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white/60 text-sm font-medium hover:bg-white/10 hover:text-white transition-all"
            >
              <Github size={14} /> Create New Repository
            </button>
          </div>
        )}

        {step === 'create' && (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Globe size={18} className="text-[#976df8]" />
              <h2 className="text-lg font-bold">Publish to GitHub</h2>
            </div>
            <p className="text-sm text-white/50 mb-6">Create a new repository and push your code.</p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-white/40 mb-1 font-medium">Repository Name *</label>
                <input
                  type="text"
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  placeholder="my-awesome-project"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-[#976df8]/50 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1 font-medium">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description of your project"
                  rows={2}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-[#976df8]/50 transition-all resize-none"
                />
              </div>
              <button
                type="button"
                onClick={() => setIsPrivate(!isPrivate)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white/70 hover:bg-white/10 transition-all"
              >
                {isPrivate ? <Lock size={14} /> : <Unlock size={14} />}
                {isPrivate ? 'Private repository' : 'Public repository'}
              </button>
            </div>

            {errorMsg && <p className="text-sm text-red-400 mt-3">{errorMsg}</p>}

            <button
              type="button"
              onClick={handleCreateRepo}
              disabled={!repoName.trim()}
              className="w-full mt-6 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white text-gray-950 text-sm font-medium hover:bg-gray-100 transition-all disabled:opacity-40"
            >
              <Github size={16} /> Create Repository & Push
            </button>
            <button
              type="button"
              onClick={() => { setStep('checking'); checkConnection(); }}
              className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white/50 text-sm hover:bg-white/10 hover:text-white transition-all"
            >
              <ArrowLeft size={14} /> Use Existing Repository
            </button>
          </div>
        )}

        {step === 'pushing' && (
          <div className="flex flex-col items-center py-8">
            <Loader2 size={32} className="text-[#976df8] animate-spin mb-4" />
            <p className="text-sm font-medium">Pushing code to GitHub...</p>
            <p className="text-xs text-white/40 mt-2">This may take a moment.</p>
          </div>
        )}

        {step === 'done' && (
          <div className="flex flex-col items-center py-6">
            <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4">
              <CheckCircle2 size={28} className="text-emerald-400" />
            </div>
            <h2 className="text-lg font-bold mb-1">
              {pushResult ? 'Changes Pushed!' : 'Published!'}
            </h2>
            {pushResult && (
              <p className="text-sm text-white/50 mb-2">
                {pushResult.files_pushed} file{pushResult.files_pushed !== 1 ? 's' : ''} updated on GitHub.
              </p>
            )}
            {repoInfo && (
              <a
                href={repoInfo.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm text-[#976df8] hover:underline mb-6"
              >
                <ExternalLink size={14} /> Open on GitHub
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 rounded-xl bg-white text-gray-950 text-sm font-medium hover:bg-gray-100 transition-all"
            >
              Done
            </button>
          </div>
        )}

        {step === 'error' && (
          <div className="flex flex-col items-center py-6">
            <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
              <XCircle size={28} className="text-red-400" />
            </div>
            <h2 className="text-lg font-bold mb-1">Failed</h2>
            <p className="text-sm text-red-400/80 text-center mb-6 max-w-sm">{errorMsg || 'Something went wrong.'}</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep(repoInfo ? 'connected' : 'create')}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/10 text-white text-sm font-medium hover:bg-white/20 transition-all"
              >
                <ArrowLeft size={14} /> Try Again
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-white text-gray-950 text-sm font-medium hover:bg-gray-100 transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
