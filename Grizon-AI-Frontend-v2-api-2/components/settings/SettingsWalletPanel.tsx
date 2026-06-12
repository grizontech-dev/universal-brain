'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  X,
  Plus,
  Wallet,
  CheckCircle2,
  Zap,
} from 'lucide-react';
import {
  fetchWallet,
  fetchWalletTransactionById,
  fetchWalletTransactions,
  fetchSubscription,
  initiateTopup,
} from '@/lib/chat-rest-api';
import { ApiError } from '@/lib/auth-api';
import type { WalletResponse, TopupPackage } from '@/lib/chat-contracts';
import type { WalletTransactionDto } from '@/types/settings-api';

const PAGE_SIZE = 15;

function TopupModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const [packages, setPackages] = useState<TopupPackage[]>([]);
  const [topupEnabled, setTopupEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [initiating, setInitiating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSubscription()
      .then((res) => {
        const credits = res.subscription?.planSnapshot?.credits;
        setTopupEnabled(credits?.topupEnabled ?? false);
        setPackages(credits?.topupPackages ?? []);
      })
      .catch(() => {
        setTopupEnabled(false);
        setPackages([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleBuy = async () => {
    if (!selected) return;
    setInitiating(true);
    setError(null);
    try {
      const res = await initiateTopup(selected);
      window.location.href = res.redirectUrl;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to initiate top-up. Please try again.');
      setInitiating(false);
    }
  };

  const bestIdx = packages.length > 1
    ? packages.reduce((bi, p, i) => (p.credits / p.price > packages[bi].credits / packages[bi].price ? i : bi), 0)
    : -1;

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#111115] shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-300">
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
              <Wallet size={15} className="text-indigo-400" />
            </div>
            <h3 className="text-[15px] font-black text-white">Add Credits</h3>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-white/30 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-white/40 text-sm py-6 justify-center">
              <Loader2 size={16} className="animate-spin" /> Loading packages…
            </div>
          ) : !topupEnabled ? (
            <div className="py-6 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center mx-auto">
                <Zap size={20} className="text-white/20" />
              </div>
              <p className="text-[13px] text-white/40">Top-up is not available on your current plan.</p>
              <a
                href="/pricing"
                className="inline-flex items-center gap-1.5 text-[12px] font-black text-indigo-400 hover:text-indigo-300 uppercase tracking-wider"
              >
                Upgrade to enable →
              </a>
            </div>
          ) : packages.length === 0 ? (
            <p className="text-[13px] text-white/40 py-4 text-center">No top-up packages available.</p>
          ) : (
            <>
              <p className="text-[12px] text-white/40 font-medium">Select a credit package:</p>
              <div className="grid grid-cols-1 gap-2">
                {packages.map((pkg, i) => {
                  const pkgId = pkg.id ?? `${pkg.credits}_${pkg.price}`;
                  const isBest = i === bestIdx;
                  const isSelected = selected === pkgId;
                  return (
                    <button
                      key={pkgId}
                      type="button"
                      onClick={() => setSelected(pkgId)}
                      className={`relative flex items-center justify-between px-4 py-3.5 rounded-xl border transition-all text-left ${
                        isSelected
                          ? 'border-indigo-500/50 bg-indigo-500/10'
                          : 'border-white/8 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
                      }`}
                    >
                      {isBest && (
                        <span className="absolute -top-2 right-3 px-2 py-0.5 bg-emerald-500 text-white text-[8px] font-black uppercase tracking-widest rounded-full">
                          Best Value
                        </span>
                      )}
                      <div className="flex items-center gap-3">
                        {isSelected ? (
                          <CheckCircle2 size={16} className="text-indigo-400 shrink-0" />
                        ) : (
                          <div className="w-4 h-4 rounded-full border border-white/20 shrink-0" />
                        )}
                        <div>
                          <p className="text-white font-black text-[15px] leading-none">{pkg.credits.toLocaleString()} Credits</p>
                          <p className="text-[11px] text-white/30 mt-0.5">≈ {(pkg.credits / pkg.price).toFixed(0)} credits per ₹</p>
                        </div>
                      </div>
                      <span className="text-white font-black text-[16px]">₹{pkg.price.toLocaleString()}</span>
                    </button>
                  );
                })}
              </div>

              {error && (
                <p className="text-[12px] text-red-400 flex items-center gap-1.5">
                  <X size={12} /> {error}
                </p>
              )}

              <button
                type="button"
                disabled={!selected || initiating}
                onClick={handleBuy}
                className="w-full py-3.5 bg-indigo-500 text-white rounded-xl font-black text-[14px] hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {initiating ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Redirecting to PhonePe…
                  </>
                ) : (
                  'Buy Credits'
                )}
              </button>
              <p className="text-[10px] text-white/20 text-center">
                Secure payment via PhonePe. No card details stored.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SettingsWalletPanel({ onBalanceRefresh }: { onBalanceRefresh?: () => void }) {
  const onBalanceRefreshRef = useRef(onBalanceRefresh);
  onBalanceRefreshRef.current = onBalanceRefresh;

  const [wallet, setWallet] = useState<WalletResponse | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<WalletTransactionDto[]>([]);
  const [bootLoading, setBootLoading] = useState(true);
  const [txLoading, setTxLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<WalletTransactionDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showTopup, setShowTopup] = useState(false);

  const loadPage = useCallback(async (p: number) => {
    setTxLoading(true);
    setError(null);
    try {
      const res = await fetchWalletTransactions({ page: p, page_size: PAGE_SIZE });
      setRows(res.transactions ?? []);
      setTotal(res.pagination?.total ?? 0);
      setPage(res.pagination?.page ?? p);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load transactions');
      setRows([]);
    } finally {
      setTxLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBootLoading(true);
      setError(null);
      try {
        const w = await fetchWallet();
        if (!cancelled) setWallet(w);
        onBalanceRefreshRef.current?.();
        const res = await fetchWalletTransactions({ page: 1, page_size: PAGE_SIZE });
        if (!cancelled) {
          setRows(res.transactions ?? []);
          setTotal(res.pagination?.total ?? 0);
          setPage(1);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.message : 'Could not load wallet');
        }
      } finally {
        if (!cancelled) setBootLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await fetchWalletTransactionById(id);
      setDetail(res.transaction);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load transaction');
    } finally {
      setDetailLoading(false);
    }
  };

  if (bootLoading && !wallet) {
    return (
      <div className="flex items-center justify-center py-16 text-text-muted gap-2">
        <Loader2 className="animate-spin" size={20} />
        Loading wallet…
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {showTopup && <TopupModal onClose={() => setShowTopup(false)} />}

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-2">Wallet</h1>
        <p className="text-[14px] text-white/40">Your AI credits, balance, and transaction history.</p>
      </div>

      {/* Balance Cards */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[11px] font-bold text-text-faint uppercase tracking-wider">Balance</h2>
          <button
            type="button"
            onClick={() => setShowTopup(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-500 text-white rounded-lg font-black text-[12px] hover:bg-indigo-400 transition-all active:scale-95 shadow-lg shadow-indigo-500/20"
          >
            <Plus size={13} strokeWidth={3} />
            Add Credits
          </button>
        </div>
        {wallet ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Balance', value: wallet.balance, highlight: true },
              { label: 'Pending', value: wallet.pending, highlight: false },
              { label: 'Spendable', value: wallet.spendable, highlight: false },
              { label: 'Lifetime Spent', value: wallet.lifetimeSpent, highlight: false },
            ].map((c) => (
              <div
                key={c.label}
                className={`rounded-xl border p-4 ${
                  c.highlight
                    ? 'border-indigo-500/20 bg-indigo-500/[0.06]'
                    : 'border-border-subtle bg-card'
                }`}
              >
                <p className="text-[10px] font-black text-text-faint uppercase tracking-wider mb-1">{c.label}</p>
                <p className={`text-lg font-bold ${c.highlight ? 'text-indigo-300' : 'text-text-primary'}`}>
                  {Number(c.value).toLocaleString()}
                </p>
                <p className="text-[10px] text-text-faint mt-1">{wallet.currency}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Transactions */}
      <div>
        <h2 className="text-[11px] font-bold text-text-faint uppercase tracking-wider mb-4">Transactions</h2>
        {error ? <p className="text-sm text-red-400 mb-3">{error}</p> : null}

        <div className="rounded-xl border border-border-subtle bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px] min-w-[640px]">
              <thead className="border-b border-border-subtle text-[10px] uppercase tracking-wider text-text-muted">
                <tr>
                  <th className="px-4 py-3 font-bold">When</th>
                  <th className="px-3 py-3 font-bold">Type</th>
                  <th className="px-3 py-3 font-bold text-right">Credits</th>
                  <th className="px-4 py-3 font-bold">Description</th>
                </tr>
              </thead>
              <tbody>
                {txLoading && rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-text-muted">
                      <Loader2 className="inline animate-spin mr-2" size={16} />
                      Loading…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-text-muted text-sm">
                      No transactions yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((t) => (
                    <tr
                      key={t.id}
                      className="border-b border-border-subtle hover:bg-surface-1 cursor-pointer"
                      onClick={() => void openDetail(t.id)}
                    >
                      <td className="px-4 py-3 text-text-secondary whitespace-nowrap text-[12px]">
                        {new Date(t.createdAt).toLocaleString('en-IN')}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${
                          t.type === 'deduct'
                            ? 'bg-red-400/10 text-red-400'
                            : t.type === 'topup'
                            ? 'bg-blue-400/10 text-blue-400'
                            : 'bg-purple-400/10 text-purple-400'
                        }`}>
                          {t.type}
                        </span>
                      </td>
                      <td className={`px-3 py-3 text-right font-mono font-bold ${t.type === 'deduct' ? 'text-red-400' : 'text-emerald-400'}`}>
                        {t.type === 'deduct' ? '-' : '+'}{Math.abs(t.amount).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-text-muted truncate max-w-[200px]">{t.description}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 ? (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border-subtle">
              <button
                type="button"
                disabled={page <= 1 || txLoading}
                onClick={() => void loadPage(page - 1)}
                className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-primary disabled:opacity-30"
              >
                <ChevronLeft size={16} />
                Prev
              </button>
              <span className="text-[11px] text-text-muted">Page {page} / {totalPages}</span>
              <button
                type="button"
                disabled={page >= totalPages || txLoading}
                onClick={() => void loadPage(page + 1)}
                className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-primary disabled:opacity-30"
              >
                Next
                <ChevronRight size={16} />
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Transaction Detail Modal */}
      {(detail || detailLoading) && (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-border-default bg-input p-6 shadow-2xl max-h-[85vh] overflow-y-auto animate-in fade-in slide-in-from-bottom-4 duration-200">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-bold text-text-primary">Transaction Detail</h3>
              <button type="button" onClick={() => setDetail(null)} className="p-2 text-text-muted hover:text-text-primary">
                <X size={18} />
              </button>
            </div>
            {detailLoading ? (
              <p className="text-text-muted text-sm flex items-center gap-2">
                <Loader2 className="animate-spin" size={16} /> Loading…
              </p>
            ) : detail ? (
              <dl className="space-y-3 text-sm">
                {(
                  [
                    ['ID', detail.id],
                    ['Type', detail.type],
                    ['Credits', String(detail.amount)],
                    ['Balance After', String(detail.balanceAfter)],
                    ['Description', detail.description],
                    ['Created', new Date(detail.createdAt).toLocaleString('en-IN')],
                    ['Job', detail.jobId ?? '—'],
                    ['Message', detail.messageId ?? '—'],
                    ['Agent', detail.agentSlug ?? '—'],
                    ['Model', detail.modelId ?? '—'],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b border-border-subtle pb-2">
                    <dt className="text-text-muted shrink-0">{k}</dt>
                    <dd className="text-text-secondary text-right break-all">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
