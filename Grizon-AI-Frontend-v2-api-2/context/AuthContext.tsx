'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import type { AuthContextType, User, LoginRequest, RegisterRequest, AuthModalScreen } from '../lib/types';
import AuthModal from '../components/auth/AuthModal';
import { REFRESH_TOKEN_STORAGE_KEY, getApiBaseUrl } from '../lib/auth-constants';
import {
  authLogin,
  authRegister,
  authMe,
  authLogout,
  ApiError,
  type AuthTokenBundle,
  type AuthUserProfile,
} from '../lib/auth-api';
import { mapProfileToUser } from '../lib/auth-mappers';
import { registerAuthSessionBridge, refreshAccessToken } from '../lib/auth-session';
import { patchAuthMe, postAuthPasswordChange, postAuthLogoutAll, postAuthEmailVerifyRequest } from '../lib/chat-rest-api';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

async function loadMeWithRefresh(accessRef: React.MutableRefObject<string | null>): Promise<User> {
  const at = accessRef.current;
  if (!at) throw new Error('No access token');
  try {
    const me = await authMe(at);
    return mapProfileToUser(me);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      const refreshedAccess = await refreshAccessToken();
      if (!refreshedAccess) throw e;
      const me = await authMe(refreshedAccess);
      return mapProfileToUser(me);
    }
    throw e;
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [authModalScreen, setAuthModalScreen] = useState<AuthModalScreen>('signin-email');

  const accessRef = useRef<string | null>(null);

  const isAuthenticated = !!user;
  const needsEmailVerification = !!user && !user.email_verified_at;

  const clearError = useCallback(() => setError(null), []);

  const persistBundle = useCallback((bundle: AuthTokenBundle) => {
    accessRef.current = bundle.access_token;
    if (typeof window !== 'undefined') {
      localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, bundle.refresh_token);
    }
  }, []);

  const clearSession = useCallback(() => {
    accessRef.current = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    }
    setUser(null);
  }, []);

  useEffect(() => {
    registerAuthSessionBridge({
      getAccessToken: () => accessRef.current,
      getRefreshToken: () =>
        typeof window !== 'undefined' ? localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY) : null,
      setTokenPair: (access, refresh) => {
        accessRef.current = access;
        if (typeof window !== 'undefined') {
          localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, refresh);
        }
      },
      clearAll: () => {
        accessRef.current = null;
        if (typeof window !== 'undefined') {
          localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
        }
        setUser(null);
      },
      getApiBase: getApiBaseUrl,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const access = await refreshAccessToken();
        if (!access) {
          if (!cancelled) setUser(null);
          return;
        }
        if (cancelled) return;
        const me = await authMe(access);
        if (cancelled) return;
        setUser(mapProfileToUser(me));
      } catch {
        if (!cancelled) {
          clearSession();
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clearSession, persistBundle]);

  const refreshUser = useCallback(async () => {
    try {
      const u = await loadMeWithRefresh(accessRef);
      setUser(u);
    } catch {
      clearSession();
    }
  }, [clearSession]);

  useEffect(() => {
    const handler = () => {
      void refreshUser();
    };
    window.addEventListener('grizon:auth-changed', handler);
    return () => window.removeEventListener('grizon:auth-changed', handler);
  }, [refreshUser]);

  const applySessionFromTokenBundle = useCallback(
    async (bundle: AuthTokenBundle & { user?: unknown }) => {
      persistBundle(bundle);
      const u = bundle.user;
      if (u && typeof u === 'object' && u !== null && 'id' in u && 'email' in u) {
        setUser(mapProfileToUser(u as AuthUserProfile));
      } else {
        const me = await loadMeWithRefresh(accessRef);
        setUser(me);
      }
    },
    [persistBundle],
  );

  const login = useCallback(
    async (credentials: LoginRequest) => {
      setError(null);
      if (!credentials.password) {
        setError('Password is required');
        return;
      }
      try {
        const bundle = await authLogin(credentials.email, credentials.password);
        persistBundle(bundle);
        setUser(mapProfileToUser(bundle.user));
        setIsAuthModalOpen(false);
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : 'Login failed';
        setError(msg);
      }
    },
    [persistBundle],
  );

  const register = useCallback(
    async (credentials: RegisterRequest) => {
      setError(null);
      if (!credentials.password) {
        setError('Password is required');
        return;
      }
      try {
        const bundle = await authRegister({
          email: credentials.email,
          password: credentials.password,
          name: credentials.name,
        });
        persistBundle(bundle);
        setUser(mapProfileToUser(bundle.user));
        setIsAuthModalOpen(false);
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : 'Registration failed';
        setError(msg);
      }
    },
    [persistBundle],
  );

  const loginWithGoogle = useCallback(async (credential: string) => {
    void credential;
    setError('Google sign-in is not wired in this build yet.');
  }, []);

  const logout = useCallback(async () => {
    const at = accessRef.current;
    const rt =
      typeof window !== 'undefined' ? localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY) : null;
    if (at && rt) {
      try {
        await authLogout(at, rt);
      } catch {
        /* still clear locally */
      }
    }
    clearSession();
    setIsAuthModalOpen(false);
  }, [clearSession]);

  const requestEmailVerification = useCallback(async () => {
    await postAuthEmailVerifyRequest();
  }, []);

  const sendOtp = useCallback(async (phone: string) => {
    void phone;
    return {};
  }, []);

  const verifyOtp = useCallback(async (phone: string, otp: string) => {
    void phone;
    void otp;
    /* reserved */
  }, []);

  const updateUser = useCallback(async (data: Partial<User>) => {
    const body: {
      name?: string;
      bio?: string | null;
      avatar_url?: string | null;
      locale?: string | null;
      timezone?: string | null;
    } = {};
    if (data.name !== undefined) body.name = data.name;
    if (data.bio !== undefined) body.bio = data.bio ?? null;
    if (data.avatar_url !== undefined) body.avatar_url = data.avatar_url;
    if (data.locale !== undefined) body.locale = data.locale;
    if (data.timezone !== undefined) body.timezone = data.timezone;
    if (Object.keys(body).length === 0) {
      setUser((prev) => (prev ? { ...prev, ...data } : prev));
      return;
    }
    const profile = await patchAuthMe(body);
    setUser(mapProfileToUser(profile));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('grizon:auth-changed'));
    }
  }, []);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      setError(null);
      try {
        const bundle = await postAuthPasswordChange({
          current_password: currentPassword,
          new_password: newPassword,
        });
        await applySessionFromTokenBundle(bundle);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('grizon:auth-changed'));
        }
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : 'Password change failed';
        setError(msg);
        throw e;
      }
    },
    [applySessionFromTokenBundle],
  );

  const logoutAll = useCallback(async () => {
    try {
      await postAuthLogoutAll();
    } catch {
      /* still clear locally */
    }
    clearSession();
    setIsAuthModalOpen(false);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('grizon:auth-changed'));
    }
  }, [clearSession]);

    const openAuthModal = useCallback((screen: AuthModalScreen = 'signin-email') => {
    setAuthModalScreen(screen);
    setIsAuthModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    if (needsEmailVerification) return;
    setIsAuthModalOpen(false);
  }, [needsEmailVerification]);

  useEffect(() => {
    if (needsEmailVerification) {
      setIsAuthModalOpen(false);
    }
  }, [needsEmailVerification]);

  const value: AuthContextType = {
    user,
    isAuthenticated,
    needsEmailVerification,
    isLoading,
    error,
    login,
    register,
    loginWithGoogle,
    logout,
    logoutAll,
    refreshUser,
    requestEmailVerification,
    sendOtp,
    verifyOtp,
    clearError,
    updateUser,
    changePassword,
    baseUrl: getApiBaseUrl(),
    isAuthModalOpen,
    authModalScreen,
    openAuthModal,
    closeAuthModal,
    applySessionFromTokenBundle,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
      <AuthModal
        isOpen={isAuthModalOpen}
        initialScreen={authModalScreen}
        onClose={closeAuthModal}
        blockClose={needsEmailVerification}
      />
    </AuthContext.Provider>
  );
};
