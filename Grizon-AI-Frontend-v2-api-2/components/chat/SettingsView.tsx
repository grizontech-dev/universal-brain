'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Settings,
  User,
  BarChart3,
  CreditCard,
  Lock,
  Plug,
  LogOut,
  Zap,
  Brain,
  ArrowLeft,
  Laptop,
  Wallet,
  Palette,
} from 'lucide-react';
import type { SettingsSectionId } from '@/lib/settings-sections';
import { useAuth } from '../../context/AuthContext';
import { useModels } from '../../context/ModelContext';
import { useCredits } from '../../context/CreditContext';
import { useTheme } from '../../context/ThemeContext';
import type { ThemeMeta } from '@/lib/themes';
import SettingsSessionsPanel from '../settings/SettingsSessionsPanel';
import SettingsUsagePanel from '../settings/SettingsUsagePanel';
import SettingsWalletPanel from '../settings/SettingsWalletPanel';
import SettingsBillingPanel from '../settings/SettingsBillingPanel';
import ThemeStudio from '../settings/ThemeStudio';
import { ApiError } from '@/lib/auth-api';
import SettingsConnectionsPanel from '../settings/SettingsConnectionsPanel';
interface SettingsTab {
  id: string;
  label: string;
  icon: any;
  headerDesc: string;
  placeholderTitle?: string;
  placeholderDesc?: string;
}

const settingsTabs: SettingsTab[] = [
  {
    id: 'general',
    label: 'General',
    icon: Settings,
    headerDesc: 'Manage your profile information and account preferences.',
  },
  {
    id: 'account',
    label: 'Account',
    icon: User,
    headerDesc: 'Manage your account details and preferences.',
  },
  {
    id: 'sessions',
    label: 'Sessions',
    icon: Laptop,
    headerDesc:
      'See where you are signed in and revoke devices you do not recognize.',
  },
  {
    id: 'usage',
    label: 'Usage',
    icon: BarChart3,
    headerDesc: 'View your AI usage and statistics.',
  },
  {
    id: 'billing',
    label: 'Billing',
    icon: CreditCard,
    headerDesc: 'Manage your subscription plan, payments, and billing history.',
  },
  {
    id: 'wallet',
    label: 'Wallet',
    icon: Wallet,
    headerDesc: 'Manage your AI credits, top-up balance, and transaction history.',
  },
  {
    id: 'privacy',
    label: 'Privacy',
    icon: Lock,
    headerDesc: 'Manage your privacy settings and data controls.',
    placeholderTitle: 'Privacy Controls',
    placeholderDesc:
      'Control your data sharing preferences, export functionality, and security settings. This section is coming soon.',
  },
  {
    id: 'models',
    label: 'AI Models',
    icon: BarChart3,
    headerDesc: 'View and manage available AI models and their capabilities.',
  },
  {
    id: 'connections',
    label: 'Connections',
    icon: Plug,
    headerDesc: 'Manage your external integrations and API keys.',
    placeholderTitle: 'Integrations',
    placeholderDesc:
      'Connect with third-party services and manage your API access tokens. This section is coming soon.',
  },
  {
    id: 'theme-studio',
    label: 'Theme Studio',
    icon: Palette,
    headerDesc: 'Create, preview, and export custom themes.',
  },
];

function isStrongPassword(p: string): boolean {
  return p.length >= 10 && /[A-Za-z]/.test(p) && /\d/.test(p);
}

function ThemePreviewCard({
  theme,
  selected,
  onSelect,
}: {
  theme: ThemeMeta;
  selected: boolean;
  onSelect: () => void;
}) {
  const p = theme.preview;
  return (
    <button
      type='button'
      onClick={onSelect}
      aria-pressed={selected}
      title={theme.description}
      className={`group text-left rounded-xl border p-2 transition-all ${
        selected
          ? 'border-accent ring-2 ring-accent/40'
          : 'border-border-default hover:border-border-strong'
      }`}
    >
      {/* Mini app mock */}
      <div
        className='h-20 w-full rounded-lg overflow-hidden flex'
        style={{ backgroundColor: p.app, border: `1px solid ${p.chat}` }}
      >
        {/* sidebar */}
        <div className='h-full w-3 flex flex-col items-center gap-1 pt-1.5' style={{ backgroundColor: p.sidebar }}>
          <span className='block h-1 w-1 rounded-full' style={{ backgroundColor: p.accent }} />
          <span className='block h-1 w-1 rounded-full' style={{ backgroundColor: p.text, opacity: 0.4 }} />
        </div>
        {/* chat area */}
        <div className='flex-1 p-1.5 flex flex-col gap-1' style={{ backgroundColor: p.chat }}>
          <span className='block h-2 w-3/5 rounded-sm' style={{ backgroundColor: p.text, opacity: 0.18 }} />
          <span className='block h-2 w-2/5 self-end rounded-sm' style={{ backgroundColor: p.accent, opacity: 0.55 }} />
          <span className='block h-2 w-1/2 rounded-sm' style={{ backgroundColor: p.text, opacity: 0.12 }} />
        </div>
      </div>
      <div className='mt-2 px-0.5 flex items-center justify-between gap-1.5'>
        <span className='text-[12px] font-semibold text-text-primary truncate min-w-0'>{theme.name}</span>
        {selected ? (
          <span className='text-[10px] font-bold text-accent uppercase tracking-wide shrink-0'>Active</span>
        ) : null}
      </div>
    </button>
  );
}

export default function SettingsView({ section }: { section: SettingsSectionId }) {
  const router = useRouter();
  const {
    user,
    logout,
    logoutAll,
    updateUser,
    changePassword,
    requestEmailVerification,
  } = useAuth();
  const { availableModels } = useModels();
  const { themeId, themes, setTheme } = useTheme();
  const { refreshBalance, refreshUsageSummary, balance, usageSummary } =
    useCredits();
  const syncCreditsAfterWalletLoad = useCallback(() => {
    void refreshBalance();
  }, [refreshBalance]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Local state for edits
  const [formData, setFormData] = useState({
    name: user?.name || '',
    email: user?.email || '',
    bio: user?.bio || '',
    locale: user?.locale ?? '',
    timezone: user?.timezone ?? '',
    avatar_url: user?.avatar_url ?? '',
  });
  const [profileMessage, setProfileMessage] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);

  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  });
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');
    if (!user?.has_password) {
      setPasswordError(
        'This account has no password (e.g. Google-only). Use your provider to manage access.',
      );
      return;
    }
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }
    if (!isStrongPassword(passwordData.newPassword)) {
      setPasswordError(
        'New password must be at least 10 characters with a letter and a number',
      );
      return;
    }
    setPasswordLoading(true);
    try {
      await changePassword(
        passwordData.currentPassword,
        passwordData.newPassword,
      );
      setPasswordSuccess(
        'Password updated. You remain signed in on this device; other sessions were revoked.',
      );
      setPasswordData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
      void refreshBalance();
      void refreshUsageSummary();
    } catch (err) {
      setPasswordError(
        err instanceof ApiError ? err.message : 'Password change failed',
      );
    } finally {
      setPasswordLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      setFormData((prev) => ({
        ...prev,
        name: user.name || '',
        email: user.email || '',
        bio: user.bio || '',
        locale: user.locale ?? '',
        timezone: user.timezone ?? '',
        avatar_url: user.avatar_url ?? '',
      }));
    }
  }, [user]);

  return (
    <div className='flex flex-col lg:flex-row w-full h-full bg-sidebar text-text-primary font-sans overflow-hidden relative'>
      {/* Mobile Header */}
      <div className='lg:hidden flex items-center justify-between px-4 h-[56px] border-b border-border-subtle bg-sidebar shrink-0 z-50'>
        <div className='flex items-center gap-2'>
          <button
            onClick={() => router.push('/chat')}
            title='Back to chat'
            aria-label='Back to chat'
            className='w-9 h-9 flex items-center justify-center rounded-xl hover:bg-surface-2 transition-all active:scale-95 shrink-0'
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src='/Logo.svg' alt='Grizon' className='w-7 h-7 object-contain' />
          </button>
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className='flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface-2 border border-border-default text-text-secondary transition-all active:scale-95'
          >
            <div className='flex flex-col gap-1 w-4'>
              <span
                className={`h-0.5 bg-accent transition-all duration-300 ${isMobileMenuOpen ? 'w-4 rotate-45 translate-y-1.5' : 'w-4'}`}
              />
              <span
                className={`h-0.5 bg-accent transition-all duration-300 ${isMobileMenuOpen ? 'opacity-0' : 'w-3'}`}
              />
              <span
                className={`h-0.5 bg-accent transition-all duration-300 ${isMobileMenuOpen ? 'w-4 -rotate-45 -translate-y-1.5' : 'w-2'}`}
              />
            </div>
            <span className='font-bold text-[13px] uppercase tracking-wider'>
              {settingsTabs.find((t) => t.id === section)?.label || 'Menu'}
            </span>
          </button>
        </div>
      </div>

      {/* Mobile Menu Dropdown */}
      {isMobileMenuOpen && (
        <div className='lg:hidden fixed inset-0 top-[56px] z-[100] bg-sidebar/95 backdrop-blur-3xl animate-in fade-in slide-in-from-top-4 duration-300'>
          <div className='p-4 space-y-2'>
            <p className='px-4 py-2 text-[10px] font-black text-text-faint uppercase tracking-[0.2em]'>
              Select Category
            </p>
            {settingsTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = section === tab.id;
              return (
                <Link
                  key={tab.id}
                  href={`/settings/${tab.id}`}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all ${
                    isActive
                      ? 'bg-accent/10 border border-accent/20 text-accent shadow-[0_0_20px_rgba(168,85,247,0.1)]'
                      : 'text-text-muted hover:bg-surface-2 hover:text-text-primary'
                  }`}
                >
                  <Icon
                    size={18}
                    className={isActive ? 'text-accent' : 'text-text-faint'}
                  />
                  <span className='font-bold text-[14px]'>{tab.label}</span>
                  {isActive && (
                    <div className='ml-auto w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(168,85,247,0.6)]' />
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <aside className='hidden lg:flex w-full lg:w-64 bg-surface-1 border-b lg:border-r border-border-subtle flex-col pt-4 lg:pt-6 pb-2 lg:pb-4 shrink-0'>
        <div className='px-6 mb-8'>
          <div className='flex items-center gap-2'>
            <div className='w-6 h-6 rounded bg-accent flex items-center justify-center text-[10px] font-bold'>
              {user?.name ? user.name.charAt(0).toUpperCase() : 'G'}
            </div>
            <span className='text-[15px] font-semibold text-text-primary tracking-tight'>
              {user?.name || 'Grizon User'}
            </span>
          </div>
        </div>

        <div className='px-6 mb-2'>
          <h2 className='text-[12px] font-semibold text-text-muted uppercase tracking-wider mb-2'>
            Settings
          </h2>
        </div>

        <nav className='flex lg:flex-col overflow-x-auto lg:overflow-y-auto px-3 space-x-1 lg:space-x-0 lg:space-y-0.5 custom-scrollbar'>
          {settingsTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = section === tab.id;
            return (
              <Link
                key={tab.id}
                href={`/settings/${tab.id}`}
                className={`flex items-center gap-2.5 lg:gap-3 px-3.5 lg:px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-200 whitespace-nowrap lg:whitespace-normal ${
                  isActive
                    ? 'bg-surface-3 text-accent border lg:border-none border-accent/20'
                    : 'text-text-muted hover:text-text-secondary hover:bg-surface-2'
                }`}
              >
                <Icon
                  size={16}
                  className={isActive ? 'text-accent' : 'text-text-muted'}
                />
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <main className='flex-1 overflow-y-auto bg-sidebar custom-scrollbar flex flex-col'>
        {section === 'theme-studio' ? (
          <div className='flex-1 min-h-0 flex flex-col overflow-hidden'>
            <ThemeStudio />
          </div>
        ) : null}
        <div className={`w-full min-w-0 max-w-4xl mx-auto px-5 sm:px-10 py-6 lg:py-10 ${section === 'theme-studio' ? 'hidden' : ''}`}>
          {section === 'sessions' ? (
            <SettingsSessionsPanel
              onRevokedCurrentSession={() => {
                void logout();
                router.push('/');
              }}
            />
          ) : section === 'usage' ? (
            <SettingsUsagePanel />
          ) : section === 'models' ? (
            <div className='animate-in fade-in slide-in-from-bottom-2 duration-300'>
              <Link
                href='/settings/general'
                className='flex items-center gap-1.5 text-[10px] font-black text-text-faint hover:text-text-primary transition-all mb-4 group uppercase tracking-[0.2em]'
              >
                <ArrowLeft
                  size={14}
                  className='transition-transform group-hover:-translate-x-1'
                  strokeWidth={3}
                />
                Back to General
              </Link>
              <div className='mb-8'>
                <h1 className='text-2xl font-bold text-text-primary mb-2'>
                  AI Models
                </h1>
                <p className='text-[14px] text-text-muted'>
                  View and manage available AI models and their capabilities.
                </p>
              </div>

              <div className='grid grid-cols-1 md:grid-cols-2 gap-4 mb-10'>
                {availableModels.map((model) => (
                  <div
                    key={model.id}
                    className='bg-card border border-border-subtle rounded-2xl p-6 hover:border-accent/30 transition-all group'
                  >
                    <div className='flex items-start justify-between mb-4'>
                      <div className='flex items-center gap-3'>
                        <div className='w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent border border-accent/20'>
                          {model.isAuto ? (
                            <Zap size={20} />
                          ) : (
                            <Brain size={20} />
                          )}
                        </div>
                        <div>
                          <h3 className='text-[15px] font-bold text-text-primary group-hover:text-accent transition-colors'>
                            {model.name}
                          </h3>
                          <span className='text-[10px] font-bold text-text-faint uppercase tracking-widest'>
                            {model.provider}
                          </span>
                        </div>
                      </div>
                    </div>
                    <p className='text-[12px] text-text-muted line-clamp-2 min-h-[36px] mb-4 leading-relaxed'>
                      {model.description ||
                        'Advanced AI model optimized for reasoning tasks.'}
                    </p>
                    <div className='flex items-center gap-4 pt-4 border-t border-border-subtle'>
                      <div className='flex flex-col'>
                        <span className='text-[9px] font-bold text-text-faint uppercase tracking-wider'>
                          Context
                        </span>
                        <span className='text-[12px] font-semibold text-text-secondary'>
                          {model.maxContextWindow
                            ? `${(model.maxContextWindow / 1000).toFixed(0)}k`
                            : '128k'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : section === 'general' ? (
            <div className='animate-in fade-in slide-in-from-bottom-2 duration-300'>
              <div className='mb-8'>
                <h1 className='text-2xl font-bold text-text-primary mb-2'>General</h1>
                <p className='text-[14px] text-text-muted'>
                  Manage your profile information and account preferences.
                </p>
              </div>

              {!user?.email_verified_at ? (
                <div className='mb-6 rounded-xl border border-amber-500/20 bg-amber-500/5 p-5'>
                  <p className='text-sm text-amber-200/90 font-medium mb-3'>
                    Your email is not verified yet.
                  </p>
                  <div className='flex flex-wrap gap-2'>
                    <button
                      type='button'
                      disabled={verifyBusy}
                      onClick={async () => {
                        setVerifyBusy(true);
                        try {
                          await requestEmailVerification();
                          setProfileMessage({
                            type: 'ok',
                            text: 'If eligible, a verification email was sent.',
                          });
                        } catch (e) {
                          setProfileMessage({
                            type: 'err',
                            text:
                              e instanceof ApiError
                                ? e.message
                                : 'Could not send verification email',
                          });
                        } finally {
                          setVerifyBusy(false);
                        }
                      }}
                      className='px-4 py-2 rounded-lg bg-amber-500/20 text-amber-100 text-xs font-bold hover:bg-amber-500/30 disabled:opacity-50'
                    >
                      {verifyBusy ? 'Sending…' : 'Resend verification email'}
                    </button>
                    <Link
                      href='/verify-email-request'
                      className='px-4 py-2 rounded-lg border border-border-default text-text-secondary text-xs font-bold hover:bg-surface-2'
                    >
                      Open verification page
                    </Link>
                  </div>
                </div>
              ) : null}

              {profileMessage ? (
                <p
                  className={`mb-4 text-sm ${profileMessage.type === 'ok' ? 'text-emerald-400/90' : 'text-red-400'}`}
                >
                  {profileMessage.text}
                </p>
              ) : null}

              <div className='bg-card border border-border-subtle rounded-xl p-8 mb-6'>
                <div className='text-[11px] font-bold text-text-faint uppercase tracking-wider mb-2'>
                  Appearance
                </div>
                <p className='text-[13px] text-text-muted mb-6'>
                  Choose how Grizon looks. Changes apply instantly and are saved to this device.
                </p>

                <div className='space-y-2 mb-6 max-w-xs'>
                  <label className='text-[13px] font-medium text-text-secondary'>Theme</label>
                  <select
                    value={themeId}
                    onChange={(e) => setTheme(e.target.value)}
                    className='w-full bg-input border border-border-default rounded-lg px-3 py-2.5 text-[14px] text-text-primary focus:outline-none focus:border-accent'
                  >
                    {themes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className='grid grid-cols-2 sm:grid-cols-4 gap-3'>
                  {themes.map((t) => (
                    <ThemePreviewCard
                      key={t.id}
                      theme={t}
                      selected={t.id === themeId}
                      onSelect={() => setTheme(t.id)}
                    />
                  ))}
                </div>
              </div>

              <div className='bg-card border border-border-subtle rounded-xl p-8 mb-6'>
                <div className='text-[11px] font-bold text-text-faint uppercase tracking-wider mb-6'>
                  Profile
                </div>
                <div className='flex items-start gap-6 mb-8'>
                  {formData.avatar_url?.trim() ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={formData.avatar_url.trim()}
                      alt=''
                      className='w-20 h-20 rounded-2xl object-cover shrink-0 border border-border-default'
                    />
                  ) : (
                    <div className='w-20 h-20 rounded-2xl bg-surface-3 flex items-center justify-center text-3xl font-semibold text-text-secondary shrink-0 border border-border-subtle'>
                      {user?.name ? user.name.charAt(0).toUpperCase() : 'U'}
                    </div>
                  )}
                  <div className='pt-1 min-w-0'>
                    <h3 className='text-[16px] font-medium text-text-primary mb-1'>
                      {user?.name || 'User'}
                    </h3>
                    <p className='text-[13px] text-text-faint mb-4 max-w-md leading-relaxed'>
                      Your profile is visible to the Grizon AI team.
                    </p>
                  </div>
                </div>

                <div className='mb-6 space-y-4'>
                  <div className='space-y-2'>
                    <label className='text-[13px] font-medium text-text-secondary'>
                      Email
                    </label>
                    <input
                      type='email'
                      value={formData.email}
                      readOnly
                      className='w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2.5 text-[14px] text-text-muted cursor-not-allowed'
                    />
                  </div>
                  <div className='space-y-2'>
                    <label className='text-[13px] font-medium text-text-secondary'>
                      Full Name
                    </label>
                    <input
                      type='text'
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      className='w-full bg-input border border-border-default rounded-lg px-3 py-2.5 text-[14px] text-text-primary focus:outline-none placeholder:text-text-faint'
                    />
                  </div>
                  <div className='space-y-2'>
                    <label className='text-[13px] font-medium text-text-secondary'>
                      Avatar URL
                    </label>
                    <input
                      type='url'
                      value={formData.avatar_url}
                      onChange={(e) =>
                        setFormData({ ...formData, avatar_url: e.target.value })
                      }
                      placeholder='https://…'
                      className='w-full bg-input border border-border-default rounded-lg px-3 py-2.5 text-[14px] text-text-primary focus:outline-none placeholder:text-text-faint'
                    />
                  </div>
                  <div className='space-y-2'>
                    <label className='text-[13px] font-medium text-text-secondary'>
                      About Me
                    </label>
                    <textarea
                      value={formData.bio}
                      onChange={(e) =>
                        setFormData({ ...formData, bio: e.target.value })
                      }
                      className='w-full bg-input border border-border-default rounded-lg px-3 py-3 text-[14px] text-text-primary focus:outline-none min-h-[100px] resize-none'
                    />
                  </div>
                  <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
                    <div className='space-y-2'>
                      <label className='text-[13px] font-medium text-text-secondary'>
                        Locale
                      </label>
                      <input
                        type='text'
                        value={formData.locale}
                        onChange={(e) =>
                          setFormData({ ...formData, locale: e.target.value })
                        }
                        placeholder='e.g. en-US'
                        className='w-full bg-input border border-border-default rounded-lg px-3 py-2.5 text-[14px] text-text-primary focus:outline-none'
                      />
                    </div>
                    <div className='space-y-2'>
                      <label className='text-[13px] font-medium text-text-secondary'>
                        Timezone
                      </label>
                      <input
                        type='text'
                        value={formData.timezone}
                        onChange={(e) =>
                          setFormData({ ...formData, timezone: e.target.value })
                        }
                        placeholder='e.g. Asia/Kolkata'
                        className='w-full bg-input border border-border-default rounded-lg px-3 py-2.5 text-[14px] text-text-primary focus:outline-none'
                      />
                    </div>
                  </div>
                </div>
                <button
                  type='button'
                  onClick={async () => {
                    setProfileMessage(null);
                    try {
                      const avatar = formData.avatar_url.trim();
                      await updateUser({
                        name: formData.name,
                        bio: formData.bio,
                        avatar_url: avatar === '' ? null : avatar,
                        locale:
                          formData.locale.trim() === ''
                            ? null
                            : formData.locale.trim(),
                        timezone:
                          formData.timezone.trim() === ''
                            ? null
                            : formData.timezone.trim(),
                      });
                      setProfileMessage({
                        type: 'ok',
                        text: 'Profile updated.',
                      });
                    } catch (e) {
                      setProfileMessage({
                        type: 'err',
                        text:
                          e instanceof ApiError ? e.message : 'Update failed',
                      });
                    }
                  }}
                  className='px-5 py-2.5 bg-accent hover:bg-accent-hover text-text-primary rounded-lg text-[13px] font-medium transition-all'
                >
                  Save Changes
                </button>
              </div>

              <div className='bg-card border border-border-subtle rounded-xl p-8 mb-6'>
                <div className='text-[11px] font-bold text-text-faint uppercase tracking-wider mb-6'>
                  Security
                </div>
                <form onSubmit={handleChangePassword} className='space-y-4'>
                  <div>
                    <label className='text-[12px] text-text-secondary block mb-1'>
                      Update Password
                    </label>
                    <input
                      type='password'
                      autoComplete='current-password'
                      placeholder='Current Password'
                      value={passwordData.currentPassword}
                      onChange={(e) =>
                        setPasswordData({
                          ...passwordData,
                          currentPassword: e.target.value,
                        })
                      }
                      className='w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-sm text-text-primary mb-2'
                    />
                    <input
                      type='password'
                      autoComplete='new-password'
                      placeholder='New Password'
                      value={passwordData.newPassword}
                      onChange={(e) =>
                        setPasswordData({
                          ...passwordData,
                          newPassword: e.target.value,
                        })
                      }
                      className='w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-sm text-text-primary mb-2'
                    />
                    <input
                      type='password'
                      autoComplete='new-password'
                      placeholder='Confirm New Password'
                      value={passwordData.confirmPassword}
                      onChange={(e) =>
                        setPasswordData({
                          ...passwordData,
                          confirmPassword: e.target.value,
                        })
                      }
                      className='w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-sm text-text-primary'
                    />
                  </div>
                  <button
                    type='submit'
                    disabled={passwordLoading || !user?.has_password}
                    className='px-4 py-2 bg-surface-2 border border-border-default rounded-lg text-xs font-bold hover:bg-surface-3 disabled:opacity-40'
                  >
                    {passwordLoading ? 'Updating…' : 'Change Password'}
                  </button>
                  {passwordError ? (
                    <p className='text-xs text-red-400'>{passwordError}</p>
                  ) : null}
                  {passwordSuccess ? (
                    <p className='text-xs text-emerald-400'>
                      {passwordSuccess}
                    </p>
                  ) : null}
                </form>
              </div>

              <div className='bg-card border border-border-subtle rounded-xl p-8 mb-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4'>
                <div>
                  <h4 className='text-[14px] font-medium text-text-primary mb-1'>
                    Sign out
                  </h4>
                  <p className='text-[13px] text-text-faint text-xs'>
                    End this session or all sessions on every device.
                  </p>
                </div>
                <div className='flex flex-col sm:flex-row gap-2 shrink-0'>
                  <button
                    type='button'
                    onClick={() => {
                      void logout();
                      router.push('/chat');
                    }}
                    className='flex items-center justify-center gap-2 px-4 py-2 bg-surface-2 border border-border-default text-text-primary rounded-lg text-xs font-bold hover:bg-red-500/10 hover:text-red-400'
                  >
                    <LogOut size={14} /> This device
                  </button>
                  <button
                    type='button'
                    onClick={() => {
                      if (
                        !window.confirm(
                          'Sign out everywhere? You will need to sign in again on all devices.',
                        )
                      )
                        return;
                      void logoutAll();
                      router.push('/chat');
                    }}
                    className='flex items-center justify-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg text-xs font-bold hover:bg-red-500/20'
                  >
                    All devices
                  </button>
                </div>
              </div>
            </div>
          ) : section === 'billing' ? (
            <SettingsBillingPanel />
          ) : section === 'wallet' ? (
            <SettingsWalletPanel onBalanceRefresh={syncCreditsAfterWalletLoad} />
          ) : section === 'account' ? (
            <div className='animate-in fade-in slide-in-from-bottom-2 duration-500'>
              <div className='mb-6'>
                <h1 className='text-2xl font-black text-text-primary tracking-tight mb-1'>Account</h1>
                <p className='text-[14px] text-text-muted font-medium'>Manage your account details and preferences.</p>
              </div>
              <div className='bg-card border border-border-subtle rounded-[28px] p-6 lg:p-8 relative overflow-hidden shadow-2xl'>
                <div className='absolute top-0 right-0 p-8 opacity-[0.02]'>
                  <Zap className='w-24 h-24 text-accent' fill='currentColor' />
                </div>
                <div className='relative z-10 space-y-4'>
                  <div>
                    <p className='text-[10px] font-black text-text-faint uppercase tracking-widest mb-1'>Current Plan</p>
                    <p className='text-2xl font-black text-text-primary capitalize'>{user?.subscription || 'Free'}</p>
                    <p className='text-[12px] text-text-muted mt-1'>
                      Status: <span className='text-text-secondary'>{user?.subscriptionStatus || 'N/A'}</span>
                    </p>
                  </div>
                  <div className='flex gap-2 pt-2'>
                    <Link href='/settings/billing' className='px-5 py-2.5 bg-white text-gray-950 rounded-xl font-black text-[13px] hover:bg-gray-200 transition-all'>
                      Manage Billing
                    </Link>
                    <Link href='/settings/wallet' className='px-5 py-2.5 bg-white/5 text-white/60 rounded-xl font-black text-[13px] hover:bg-white/10 hover:text-white transition-all border border-white/10'>
                      View Wallet
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          ) : section === 'connections' ? (
            <SettingsConnectionsPanel />
          ) : (
            <div className='animate-in fade-in slide-in-from-bottom-2 duration-300'>
              <div className='flex flex-col items-center justify-center h-[50vh] text-center'>
                <Settings size={40} className='text-text-faint mb-4' />
                <h2 className='text-lg font-bold text-text-primary mb-2'>
                  Section Coming Soon
                </h2>
                <p className='text-sm text-text-faint max-w-xs'>
                  {settingsTabs.find((t) => t.id === section)?.label} features
                  are currently under development.
                </p>
                <Link
                  href='/settings/general'
                  className='mt-8 px-6 py-2 bg-surface-2 border border-border-default rounded-xl text-xs font-bold hover:bg-surface-3 transition-all flex items-center gap-2'
                >
                  <ArrowLeft size={12} /> Back to Settings
                </Link>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
