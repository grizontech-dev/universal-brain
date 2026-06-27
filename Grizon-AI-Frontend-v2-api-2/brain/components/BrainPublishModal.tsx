'use client';

import { useState, useEffect } from 'react';
import {
  Github, Globe, Loader2, CheckCircle2, XCircle, ArrowLeft, ExternalLink, Lock, Unlock,
} from 'lucide-react';

const BRAIN_URL = process.env.NEXT_PUBLIC_BRAIN_URL || 'http://localhost:8001';

interface BrainPublishModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPublish: (repoName: string, description: string, isPrivate: boolean) => Promise<{
    success: boolean;
    repository?: { html_url: string; full_name: string };
    error?: string;
  }>;
}

type PublishStep = 'checking' | 'connect' | 'form' | 'publishing' | 'done' | 'error';

export default function BrainPublishModal({ isOpen, onClose, onPublish }: BrainPublishModalProps) {
  const [step, setStep] = useState<PublishStep>('checking');
  const [repoName, setRepoName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [result, setResult] = useState<{ html_url?: string; full_name?: string }>({});
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setStep('checking');
    setRepoName('');
    setDescription('');
    setIsPrivate(true);
    setResult({});
    setErrorMsg('');
    checkConnection();
  }, [isOpen]);

  async function checkConnection() {
    try {
      const res = await fetch(`${BRAIN_URL}/connect-github/status`);
      if (res.ok) {
        const data = await res.json();
        setStep(data.connected ? 'form' : 'connect');
      } else {
        setStep('connect');
      }
    } catch {
      setStep('connect');
    }
  }

  const handleConnect = () => {
    window.location.href = `${BRAIN_URL}/connect-github/login`;
  };

  const handlePublish = async () => {
    if (!repoName.trim()) return;
    setStep('publishing');
    setErrorMsg('');
    try {
      const res = await onPublish(repoName.trim(), description.trim(), isPrivate);
      if (res.success && res.repository) {
        setResult(res.repository);
        setStep('done');
      } else {
        setErrorMsg(res.error || 'Failed to publish repository');
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

        {step === 'form' && (
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

            {errorMsg && (
              <p className="text-sm text-red-400 mt-3">{errorMsg}</p>
            )}

            <button
              type="button"
              onClick={handlePublish}
              disabled={!repoName.trim()}
              className="w-full mt-6 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white text-gray-950 text-sm font-medium hover:bg-gray-100 transition-all disabled:opacity-40"
            >
              <Github size={16} /> Create Repository & Push
            </button>
          </div>
        )}

        {step === 'publishing' && (
          <div className="flex flex-col items-center py-8">
            <Loader2 size={32} className="text-[#976df8] animate-spin mb-4" />
            <p className="text-sm font-medium">Creating repository & pushing code...</p>
            <p className="text-xs text-white/40 mt-2">This may take a moment.</p>
          </div>
        )}

        {step === 'done' && (
          <div className="flex flex-col items-center py-6">
            <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4">
              <CheckCircle2 size={28} className="text-emerald-400" />
            </div>
            <h2 className="text-lg font-bold mb-1">Published!</h2>
            <p className="text-sm text-white/50 mb-2">
              Repository <span className="text-white font-medium">{result.full_name}</span> created.
            </p>
            {result.html_url && (
              <a
                href={result.html_url}
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
            <h2 className="text-lg font-bold mb-1">Publish Failed</h2>
            <p className="text-sm text-red-400/80 text-center mb-6 max-w-sm">{errorMsg || 'Something went wrong.'}</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep('form')}
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
