import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch, clearAuthTokens, setCsrfToken, setSessionToken } from '../lib/api.ts';
import {
  type AppLanguage,
  localeFromLanguage,
  normalizeLanguage,
  readStoredLanguage,
  writeStoredLanguage,
} from '../lib/i18n.ts';
import type { UserProfile, UserSettingsData } from '../shared/types.ts';

export interface ToastMessage {
  id: string;
  message: string;
  tone?: 'default' | 'success' | 'error';
  undoLabel?: string;
  onUndo?: () => Promise<void> | void;
}

interface AuthContextValue {
  user: UserProfile | null;
  settings: UserSettingsData | null;
  language: AppLanguage;
  setLanguage: (lang: AppLanguage) => Promise<void>;
  loading: boolean;
  unreadNotifications: number;
  toasts: ToastMessage[];
  pushToast: (toast: Omit<ToastMessage, 'id'>) => void;
  dismissToast: (id: string) => void;
  refreshAuth: () => Promise<void>;
  refreshUnreadCount: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: {
    name: string;
    email: string;
    password: string;
    timezone: string;
    weekStartPreference: number;
  }) => Promise<void>;
  logout: () => Promise<void>;
  updateProfileState: (user: UserProfile) => void;
  updateSettingsState: (settings: UserSettingsData) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [settings, setSettings] = useState<UserSettingsData | null>(null);
  const [language, setLanguageState] = useState<AppLanguage>(() => readStoredLanguage() ?? 'en');
  const [loading, setLoading] = useState(true);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const applyTheme = useCallback((theme: 'dark' | 'light' | undefined) => {
    if (typeof document === 'undefined') return;
    if (theme === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
  }, []);

  const applyLanguageDom = useCallback((lang: AppLanguage) => {
    setLanguageState(lang);
    writeStoredLanguage(lang);
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
    }
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (toast: Omit<ToastMessage, 'id'>) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
      setTimeout(() => {
        dismissToast(id);
      }, 6000);
    },
    [dismissToast]
  );

  const refreshUnreadCount = useCallback(async () => {
    try {
      const data = await apiFetch<{ unreadCount: number }>('/api/notifications?limit=5');
      setUnreadNotifications(data.unreadCount);
    } catch {
      // Ignore when unauthenticated
    }
  }, []);

  const refreshAuth = useCallback(async () => {
    try {
      const data = await apiFetch<{
        user: UserProfile;
        settings: UserSettingsData;
        csrfToken: string;
      }>('/api/auth/me');
      setUser(data.user);
      setSettings(data.settings);
      applyTheme(data.settings.theme);
      applyLanguageDom(normalizeLanguage(data.settings.locale));
      setCsrfToken(data.csrfToken);
    } catch {
      setUser(null);
      setSettings(null);
      clearAuthTokens();
      applyTheme('dark');
    } finally {
      setLoading(false);
    }
  }, [applyTheme, applyLanguageDom]);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    if (user) {
      void refreshUnreadCount();
    } else {
      setUnreadNotifications(0);
    }
  }, [user, refreshUnreadCount]);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await apiFetch<{
        user: UserProfile;
        settings: UserSettingsData;
        csrfToken: string;
        sessionToken?: string;
      }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (data.sessionToken) setSessionToken(data.sessionToken);
      setCsrfToken(data.csrfToken);
      setUser(data.user);
      setSettings(data.settings);
      applyTheme(data.settings.theme);
      applyLanguageDom(normalizeLanguage(data.settings.locale));
    },
    [applyTheme, applyLanguageDom]
  );

  const register = useCallback(
    async (payload: {
      name: string;
      email: string;
      password: string;
      timezone: string;
      weekStartPreference: number;
    }) => {
      const data = await apiFetch<{
        user: UserProfile;
        settings: UserSettingsData;
        csrfToken: string;
        sessionToken?: string;
      }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (data.sessionToken) setSessionToken(data.sessionToken);
      setCsrfToken(data.csrfToken);
      setUser(data.user);
      setSettings(data.settings);
      applyTheme(data.settings.theme);
      applyLanguageDom(normalizeLanguage(data.settings.locale));
    },
    [applyTheme, applyLanguageDom]
  );

  const logout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Proceed with local clear even if session already expired
    }
    clearAuthTokens();
    setUser(null);
    setSettings(null);
    setUnreadNotifications(0);
    applyTheme('dark');
  }, [applyTheme]);

  const updateProfileState = useCallback((updatedUser: UserProfile) => {
    setUser(updatedUser);
  }, []);

  const updateSettingsState = useCallback(
    (updatedSettings: UserSettingsData) => {
      setSettings(updatedSettings);
      applyTheme(updatedSettings.theme);
      applyLanguageDom(normalizeLanguage(updatedSettings.locale));
    },
    [applyTheme, applyLanguageDom]
  );

  const setLanguage = useCallback(
    async (nextLang: AppLanguage) => {
      applyLanguageDom(nextLang);
      const nextLocale = localeFromLanguage(nextLang);
      setSettings((prev) => (prev ? { ...prev, locale: nextLocale } : prev));

      if (user) {
        try {
          const res = await apiFetch<{ settings: UserSettingsData }>('/api/settings', {
            method: 'PATCH',
            body: JSON.stringify({ locale: nextLocale }),
          });
          setSettings(res.settings);
        } catch {
          // Keep responsive client language even if network request fails transiently
        }
      }

      pushToast({
        message:
          nextLang === 'bn'
            ? 'ভাষা বাংলায় পরিবর্তন করা হয়েছে।'
            : 'Language switched to English.',
      });
    },
    [applyLanguageDom, pushToast, user]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        settings,
        language,
        setLanguage,
        loading,
        unreadNotifications,
        toasts,
        pushToast,
        dismissToast,
        refreshAuth,
        refreshUnreadCount,
        login,
        register,
        logout,
        updateProfileState,
        updateSettingsState,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
