import * as React from 'react';
import { signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth';
import { auth, googleAuthProvider, testFirestoreConnection } from '../lib/firebase.ts';
import type { UiLocale } from '../lib/i18n.ts';
import type { NotificationRecord, UserProfile } from '../types/domain.ts';

interface AuthContextValue {
  user: UserProfile | null;
  token: string | null;
  loading: boolean;
  locale: UiLocale;
  setLocale: (loc: UiLocale) => void;
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
  notifications: NotificationRecord[];
  unreadCount: number;
  latestAlert: NotificationRecord | null;
  complaintUpdateVersion: number;
  refreshNotifications: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  dismissLatestAlert: () => void;
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
  const [notifications, setNotifications] = React.useState<NotificationRecord[]>([]);
  const [latestAlert, setLatestAlert] = React.useState<NotificationRecord | null>(null);
  const [complaintUpdateVersion, setComplaintUpdateVersion] = React.useState(0);
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

  const refreshNotifications = React.useCallback(async () => {
    try {
      const res = await apiFetch('/api/notifications');
      if (!res.ok) return;
      const data = (await res.json()) as { notifications?: NotificationRecord[] };
      if (Array.isArray(data.notifications)) {
        setNotifications(data.notifications);
      }
    } catch {
      // ignore transient network errors
    }
  }, [apiFetch]);

  const markNotificationRead = React.useCallback(
    async (id: string) => {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
      setLatestAlert((prev) => (prev?.id === id ? null : prev));
      try {
        await apiFetch(`/api/notifications/${encodeURIComponent(id)}/read`, {
          method: 'PATCH',
        });
      } catch {
        // ignore
      }
    },
    [apiFetch]
  );

  const markAllNotificationsRead = React.useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setLatestAlert(null);
    try {
      await apiFetch('/api/notifications/read-all', { method: 'PATCH' });
    } catch {
      // ignore
    }
  }, [apiFetch]);

  const dismissLatestAlert = React.useCallback(() => {
    setLatestAlert(null);
  }, []);

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

  // Initial notifications load + real-time SSE stream subscription
  React.useEffect(() => {
    if (!user) {
      setNotifications([]);
      setLatestAlert(null);
      return;
    }

    refreshNotifications();

    let cancelled = false;
    let controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connectStream = async () => {
      if (cancelled) return;
      controller = new AbortController();
      try {
        const headers: Record<string, string> = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch('/api/notifications/stream', {
          headers,
          credentials: 'include',
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error('SSE unavailable');
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() || '';

          for (const frame of frames) {
            if (!frame.trim() || frame.startsWith(':')) continue;
            let eventName = 'message';
            const dataLines: string[] = [];
            for (const line of frame.split('\n')) {
              if (line.startsWith('event:')) {
                eventName = line.slice(6).trim();
              } else if (line.startsWith('data:')) {
                dataLines.push(line.slice(5).trim());
              }
            }
            if (dataLines.length === 0) continue;
            try {
              const payload = JSON.parse(dataLines.join('\n'));
              if (eventName === 'notification' && payload.notification) {
                const incoming = payload.notification as NotificationRecord;
                if (incoming.userId === user.id) {
                  setNotifications((prev) =>
                    prev.some((p) => p.id === incoming.id) ? prev : [incoming, ...prev]
                  );
                  setLatestAlert(incoming);
                }
              } else if (eventName === 'complaint_update') {
                setComplaintUpdateVersion((v) => v + 1);
              }
            } catch {
              // ignore malformed SSE chunk
            }
          }
        }
      } catch {
        // retry on drop if not cancelled
      }
      if (!cancelled) {
        retryTimer = setTimeout(connectStream, 4000);
      }
    };

    connectStream();

    return () => {
      cancelled = true;
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [user, token, refreshNotifications]);

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

  const unreadCount = React.useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        locale,
        setLocale,
        apiFetch,
        notifications,
        unreadCount,
        latestAlert,
        complaintUpdateVersion,
        refreshNotifications,
        markNotificationRead,
        markAllNotificationsRead,
        dismissLatestAlert,
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
