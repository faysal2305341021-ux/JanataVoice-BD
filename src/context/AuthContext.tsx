import * as React from 'react';
import { signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth';
import { auth, googleAuthProvider, testFirestoreConnection } from '../lib/firebase.ts';
import type { UiLocale } from '../lib/i18n.ts';
import type { UserProfile } from '../types/domain.ts';

interface AuthContextValue {
  user: UserProfile | null;
  token: string | null;
  loading: boolean;
  locale: UiLocale;
  setLocale: (loc: UiLocale) => void;
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
  loginWithCredentials: (email: string, password: string) => Promise<void>;
  registerWithEkId: (payload: {
    name: string;
    email: string;
    phone: string;
    password: string;
    nidMock: string;
    division: string;
    district: string;
  }) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  verifyEkId: (payload: {
    nidMock: string;
    name?: string;
    phone?: string;
    division?: string;
    district?: string;
  }) => Promise<void>;
  updateProfile: (payload: Partial<UserProfile>) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

const TOKEN_STORAGE_KEY = 'jv_bd_session_token';
const LOCALE_STORAGE_KEY = 'jv_bd_locale';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<UserProfile | null>(null);
  const [token, setToken] = React.useState<string | null>(() => {
    try {
      return sessionStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = React.useState(true);
  const [locale, setLocaleState] = React.useState<UiLocale>(() => {
    try {
      const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
      return saved === 'bn' ? 'bn' : 'en';
    } catch {
      return 'en';
    }
  });

  const setLocale = React.useCallback((loc: UiLocale) => {
    setLocaleState(loc);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, loc);
    } catch {
      // ignore storage errors
    }
  }, []);

  const persistToken = React.useCallback((nextToken: string | null) => {
    setToken(nextToken);
    try {
      if (nextToken) {
        sessionStorage.setItem(TOKEN_STORAGE_KEY, nextToken);
      } else {
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const apiFetch = React.useCallback(
    async (url: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers || {});
      if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      if (init.body && !headers.has('Content-Type') && typeof init.body === 'string') {
        headers.set('Content-Type', 'application/json');
      }
      return fetch(url, {
        ...init,
        headers,
        credentials: 'include',
      });
    },
    [token]
  );

  React.useEffect(() => {
    testFirestoreConnection();
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/auth/me', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: 'include',
        });
        if (res.ok && active) {
          const data = (await res.json()) as { user: UserProfile };
          setUser(data.user);
        } else if (active) {
          setUser(null);
        }
      } catch {
        if (active) setUser(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  const loginWithCredentials = async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Sign in failed.');
    }
    persistToken(data.token);
    setUser(data.user);
  };

  const registerWithEkId = async (payload: {
    name: string;
    email: string;
    phone: string;
    password: string;
    nidMock: string;
    division: string;
    district: string;
  }) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Registration failed.');
    }
    persistToken(data.token);
    setUser(data.user);
  };

  const loginWithGoogle = async () => {
    const cred = await signInWithPopup(auth, googleAuthProvider);
    const idToken = await cred.user.getIdToken();
    const res = await fetch('/api/auth/firebase-google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ idToken }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Google sign-in verification failed.');
    }
    persistToken(data.token);
    setUser(data.user);
  };

  const verifyEkId = async (payload: {
    nidMock: string;
    name?: string;
    phone?: string;
    division?: string;
    district?: string;
  }) => {
    const res = await apiFetch('/api/auth/ekid-verify', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'ekID verification failed.');
    }
    setUser(data.user);
  };

  const updateProfile = async (payload: Partial<UserProfile>) => {
    const res = await apiFetch('/api/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Profile update failed.');
    }
    setUser(data.user);
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    try {
      await firebaseSignOut(auth);
    } catch {
      // ignore if signed in via credentials
    }
    persistToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        locale,
        setLocale,
        apiFetch,
        loginWithCredentials,
        registerWithEkId,
        loginWithGoogle,
        verifyEkId,
        updateProfile,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
