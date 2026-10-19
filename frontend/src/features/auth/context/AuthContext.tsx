import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { authApi, clearPersistedCsrfToken, persistCsrfToken, setUnauthorizedHandler } from '../../../services/api';
import type { AuthUser } from '../../../services/api';
import type { Session } from '../../../types/document.types';

const SESSION_STORAGE_KEY = 'docsync.session';
const ADMIN_SESSION_KEY = 'docsync.adminSession';
const UI_AUTH_STATE_KEY = 'docsync.uiAuthState';

interface AuthContextValue {
  session: Session | null;
  adminSession: Session | null;
  authReady: boolean;
  applySession: (auth: Session | null) => void;
  applyAdminSession: (auth: Session | null) => void;
  refreshSession: () => Promise<Session>;
  handleAuthSuccess: (auth: Session) => Promise<void>;
  handleUserUpdate: (user: AuthUser) => void;
  handleLogout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const startupRefreshPromiseRef = useRef<Promise<Session> | null>(null);

  const readPersistedAdminSession = useCallback((): Session | null => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(ADMIN_SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Session;
      if (!parsed?.accessToken || !parsed.accessTokenExpiresAt || !parsed.user) {
        window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
        return null;
      }
      if (new Date(parsed.accessTokenExpiresAt).getTime() <= Date.now()) {
        window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }, []);

  const [adminSession, setAdminSession] = useState<Session | null>(() => readPersistedAdminSession());

  const readUiAuthState = useCallback((): boolean | null => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(UI_AUTH_STATE_KEY);
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      if (raw) window.sessionStorage.removeItem(UI_AUTH_STATE_KEY);
      return null;
    } catch {
      return null;
    }
  }, []);

  const writeUiAuthState = useCallback((state: boolean | null) => {
    if (typeof window === 'undefined') return;
    try {
      if (state === null) {
        window.sessionStorage.removeItem(UI_AUTH_STATE_KEY);
      } else {
        window.sessionStorage.setItem(UI_AUTH_STATE_KEY, state ? 'true' : 'false');
      }
    } catch {
      // Ignore storage failures in restricted environments.
    }
  }, []);

  const applyAdminSession = useCallback((auth: Session | null) => {
    setAdminSession(auth);
    if (typeof window !== 'undefined') {
      try {
        if (auth) window.sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(auth));
        else window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
      } catch { /* ignore */ }
    }
  }, []);

  const readPersistedSession = useCallback((): Session | null => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Session;
      if (!parsed?.accessToken || !parsed.accessTokenExpiresAt || !parsed.user) {
        window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
        return null;
      }
      if (new Date(parsed.accessTokenExpiresAt).getTime() <= Date.now()) {
        window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }, []);

  const applySession = useCallback((auth: Session | null) => {
    setSession(auth);
    if (typeof window !== 'undefined') {
      try {
        if (auth) {
          window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(auth));
        } else {
          window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
        }
      } catch {
        // Ignore storage failures in restricted environments.
      }
    }
    if (auth?.csrfToken) {
      persistCsrfToken(auth.csrfToken);
      writeUiAuthState(true);
    } else {
      clearPersistedCsrfToken();
      writeUiAuthState(false);
    }
  }, [writeUiAuthState]);

  useEffect(() => {
    let cancelled = false;
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
    const isAdminPath = pathname.startsWith('/admin');
    const isPublicPath =
      pathname === '/' ||
      pathname === '/home' ||
      pathname.startsWith('/auth') ||
      pathname.startsWith('/verify-email') ||
      pathname.startsWith('/reset-password');
    const uiAuthState = readUiAuthState();
    if (uiAuthState !== true) {
      setSession(null);
      setAuthReady(true);
      startupRefreshPromiseRef.current = null;
      return () => {
        cancelled = true;
      };
    }
    const restoredSession = readPersistedSession();
    const isRestoredSessionUsable =
      Boolean(restoredSession) &&
      new Date(restoredSession?.accessTokenExpiresAt || 0).getTime() > Date.now() + 15_000;

    if (restoredSession) {
      applySession(restoredSession);
    }

    const refreshWithRetry = async () => {
      try {
        return await authApi.refresh(restoredSession?.accessToken);
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : '';
        if (message.includes('csrf')) {
          return authApi.refresh(restoredSession?.accessToken);
        }
        throw error;
      }
    };

    if (!startupRefreshPromiseRef.current) {
      startupRefreshPromiseRef.current = refreshWithRetry();
    }

    startupRefreshPromiseRef.current
      .then((auth) => {
        if (cancelled) return;
        applySession(auth);
      })
      .catch(() => {
        if (cancelled) return;
        if (isRestoredSessionUsable && restoredSession) {
          applySession(restoredSession);
          return;
        }
        applySession(null);
        if (!isAdminPath && !isPublicPath) {
          navigate('/auth', { replace: true });
        }
      })
      .finally(() => {
        if (!cancelled) setAuthReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [applySession, navigate, readPersistedSession, readUiAuthState]);

  const refreshSession = useCallback(async (token?: string) => {
    const auth = await authApi.refresh(token);
    applySession(auth);
    return auth;
  }, [applySession]);

  useEffect(() => {
    if (!session) return;
    const refreshAt = new Date(session.accessTokenExpiresAt).getTime() - Date.now() - 60_000;
    const timeout = window.setTimeout(() => {
      void refreshSession(session.accessToken).catch(() => {
        applySession(null);
        const isAdminPath =
          typeof window !== 'undefined' && window.location.pathname.startsWith('/admin');
        if (!isAdminPath) {
          navigate('/auth', { replace: true });
        }
      });
    }, Math.max(refreshAt, 5_000));

    return () => window.clearTimeout(timeout);
  }, [navigate, refreshSession, session]);

  const handleAuthSuccess = useCallback(
    async (auth: Session) => {
      applySession(auth);
      if (auth.mfaSetupRequired) {
        navigate('/security?setupMfa=1', { replace: true });
        return;
      }
      navigate('/workspace', { replace: true });
    },
    [applySession, navigate],
  );

  const handleUserUpdate = useCallback((user: AuthUser) => {
    setSession((current) => {
      if (!current) return current;
      const next = { ...current, user };
      try {
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage failures in restricted environments.
      }
      return next;
    });
  }, []);

  const handleLogout = useCallback(async () => {
    writeUiAuthState(false);
    startupRefreshPromiseRef.current = null;
    try {
      if (session) await authApi.logout(session.accessToken);
    } catch {
      // Logout still clears local auth state.
    } finally {
      setSession(null);
      navigate('/auth', { replace: true });
    }
  }, [navigate, session, writeUiAuthState]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      const path = typeof window !== 'undefined' ? window.location.pathname : '';
      if (path.startsWith('/admin')) {
        applyAdminSession(null);
        navigate('/admin', { replace: true });
        return;
      }
      applySession(null);
      navigate('/auth', { replace: true });
    });

    return () => {
      setUnauthorizedHandler(null);
    };
  }, [applyAdminSession, applySession, navigate]);

  const value: AuthContextValue = {
    session,
    adminSession,
    authReady,
    applySession,
    applyAdminSession,
    refreshSession,
    handleAuthSuccess,
    handleUserUpdate,
    handleLogout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
