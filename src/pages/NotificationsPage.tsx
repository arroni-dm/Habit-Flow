import React, { useCallback, useEffect, useState } from 'react';
import { Bell, Check, CheckCheck, Clock } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { tx } from '../lib/i18n.ts';
import type { HabitRecord, NotificationRecord, UserSettingsData } from '../shared/types.ts';

export function NotificationsPage({ refreshSignal }: { refreshSignal: number }) {
  const { language, settings, updateSettingsState, refreshUnreadCount, pushToast } = useAuth();
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [scheduledHabits, setScheduledHabits] = useState<HabitRecord[]>([]);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [loading, setLoading] = useState(true);
  const [browserPerm, setBrowserPerm] = useState<string>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const [notifRes, habitsRes] = await Promise.all([
        apiFetch<{ notifications: NotificationRecord[]; unreadCount: number }>('/api/notifications'),
        apiFetch<{ habits: HabitRecord[] }>('/api/habits?status=active'),
      ]);
      setItems(notifRes.notifications);
      setScheduledHabits(habitsRes.habits.filter((h) => Boolean(h.reminderTime)));
      await refreshUnreadCount();
    } catch (err: any) {
      pushToast({ message: err?.message || 'Failed to load notifications.', tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, [pushToast, refreshUnreadCount]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications, refreshSignal]);

  const handleMarkRead = async (id: number) => {
    try {
      await apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
      await loadNotifications();
    } catch {
      pushToast({ message: 'Failed to mark notification read.', tone: 'error' });
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await apiFetch('/api/notifications/read-all', { method: 'POST' });
      await loadNotifications();
      pushToast({ message: 'Marked all notifications as read.' });
    } catch {
      pushToast({ message: 'Failed to mark all read.', tone: 'error' });
    }
  };

  const handleTogglePreference = async (
    key: 'inAppEnabled' | 'streakMilestonesEnabled' | 'remindersEnabled',
    nextVal: boolean
  ) => {
    if (!settings) return;
    try {
      const payload =
        key === 'remindersEnabled'
          ? {
              reminderPreferences: {
                ...settings.reminderPreferences,
                remindersEnabled: nextVal,
              },
            }
          : {
              notificationPreferences: {
                ...settings.notificationPreferences,
                [key]: nextVal,
              },
            };

      const res = await apiFetch<{ settings: UserSettingsData }>(
        '/api/notifications/preferences',
        {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }
      );
      updateSettingsState(res.settings);
      pushToast({ message: 'Updated notification preferences.' });
    } catch (err: any) {
      pushToast({ message: err?.message || 'Failed to update preferences.', tone: 'error' });
    }
  };

  const handleRequestBrowserPermission = async () => {
    if (typeof Notification === 'undefined') return;
    try {
      const result = await Notification.requestPermission();
      setBrowserPerm(result);
      if (result === 'granted' && settings) {
        const res = await apiFetch<{ settings: UserSettingsData }>(
          '/api/notifications/preferences',
          {
            method: 'PATCH',
            body: JSON.stringify({
              notificationPreferences: {
                ...settings.notificationPreferences,
                browserPushEnabled: true,
              },
            }),
          }
        );
        updateSettingsState(res.settings);
      }
    } catch {
      pushToast({
        message: 'Browser notification permission is restricted in embedded preview frames.',
        tone: 'error',
      });
    }
  };

  const visible = items.filter((n) => (filter === 'unread' ? n.status === 'unread' : true));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left: Notification Inbox */}
      <section className="lg:col-span-8 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)]">
        <div className="p-5 border-b border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap ${
                filter === 'all'
                  ? 'bg-[var(--bg-panel)] text-[var(--text-primary)] font-semibold'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {tx(language, 'All History', 'সকল ইতিহাস')}
            </button>
            <button
              type="button"
              onClick={() => setFilter('unread')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap ${
                filter === 'unread'
                  ? 'bg-[var(--bg-panel)] text-[var(--text-primary)] font-semibold'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {tx(language, 'Unread', 'অপঠিত')}
            </button>
          </div>

          <button
            type="button"
            disabled={!items.some((i) => i.status === 'unread')}
            onClick={() => void handleMarkAllRead()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-40 whitespace-nowrap"
          >
            <CheckCheck className="w-3.5 h-3.5 text-[var(--accent-lime)]" />
            <span>{tx(language, 'Mark all read', 'সব পঠিত করুন')}</span>
          </button>
        </div>

        {loading ? (
          <div className="p-8 h-48 animate-pulse" />
        ) : visible.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <Bell className="w-6 h-6 text-[var(--text-muted)] mx-auto" />
            <p className="text-sm text-[var(--text-secondary)]">
              {filter === 'unread'
                ? tx(language, 'You have no unread notifications.', 'আপনার কোনো অপঠিত নোটিফিকেশন নেই।')
                : tx(
                    language,
                    'No reminders or streak milestones have triggered yet.',
                    'এখনও কোনো রিমাইন্ডার বা ধারাবাহিকতার মাইলফলক নোটিফিকেশন আসেনি।'
                  )}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-subtle)]">
            {visible.map((notif) => (
              <div
                key={notif.id}
                className="p-4 sm:px-5 flex items-start justify-between gap-4"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p
                      className={`text-sm font-medium ${
                        notif.status === 'unread'
                          ? 'text-[var(--text-primary)] font-semibold'
                          : 'text-[var(--text-secondary)]'
                      }`}
                    >
                      {notif.title}
                    </p>
                    {notif.status === 'unread' && (
                      <span className="text-xs text-[var(--accent-lime)]">
                        · {tx(language, 'Unread', 'অপঠিত')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-secondary)]">{notif.message}</p>
                  <p className="text-[11px] font-mono-num text-[var(--text-muted)]">
                    {new Date(notif.createdAt).toLocaleString()}
                  </p>
                </div>

                {notif.status === 'unread' && (
                  <button
                    type="button"
                    onClick={() => void handleMarkRead(notif.id)}
                    aria-label={`Mark ${notif.title} read`}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] shrink-0"
                  >
                    <Check className="w-3.5 h-3.5 text-[var(--accent-lime)]" />
                    <span>{tx(language, 'Read', 'পঠিত')}</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Right: Reminder Controls & Per-Habit Schedule */}
      <div className="lg:col-span-4 space-y-6">
        <section className="p-5 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {tx(language, 'Reminder Controls', 'রিমাইন্ডার নিয়ন্ত্রণ')}
          </h2>

          {settings && (
            <div className="space-y-3 text-xs">
              <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer">
                <span className="text-[var(--text-primary)]">
                  {tx(language, 'In-app notifications', 'অ্যাপের ভেতরের নোটিফিকেশন')}
                </span>
                <input
                  type="checkbox"
                  checked={settings.notificationPreferences.inAppEnabled}
                  onChange={(e) => void handleTogglePreference('inAppEnabled', e.target.checked)}
                  className="w-4 h-4 accent-[#C6FF00]"
                />
              </label>

              <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer">
                <span className="text-[var(--text-primary)]">
                  {tx(language, 'Scheduled habit reminders', 'নির্ধারিত হ্যাবিট রিমাইন্ডার')}
                </span>
                <input
                  type="checkbox"
                  checked={settings.reminderPreferences.remindersEnabled}
                  onChange={(e) =>
                    void handleTogglePreference('remindersEnabled', e.target.checked)
                  }
                  className="w-4 h-4 accent-[#C6FF00]"
                />
              </label>

              <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer">
                <span className="text-[var(--text-primary)]">
                  {tx(language, 'Streak milestone alerts', 'ধারাবাহিকতা মাইলফলক অ্যালার্ট')}
                </span>
                <input
                  type="checkbox"
                  checked={settings.notificationPreferences.streakMilestonesEnabled}
                  onChange={(e) =>
                    void handleTogglePreference('streakMilestonesEnabled', e.target.checked)
                  }
                  className="w-4 h-4 accent-[#C6FF00]"
                />
              </label>

              <div className="pt-2 border-t border-[var(--border-subtle)] space-y-2">
                <p className="text-[var(--text-secondary)]">
                  {tx(language, 'Browser push status:', 'ব্রাউজার পুশ স্ট্যাটাস:')}{' '}
                  <strong className="capitalize">{browserPerm}</strong>
                </p>
                {browserPerm === 'default' && (
                  <button
                    type="button"
                    onClick={() => void handleRequestBrowserPermission()}
                    className="w-full py-2 px-3 rounded-lg text-xs font-semibold bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-strong)]"
                  >
                    {tx(language, 'Enable Browser Notifications', 'ব্রাউজার নোটিফিকেশন চালু করুন')}
                  </button>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="p-5 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-3">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {tx(language, 'Active Habit Reminders', 'সক্রিয় হ্যাবিট রিমাইন্ডার')}
          </h2>
          {scheduledHabits.length === 0 ? (
            <p className="text-xs text-[var(--text-secondary)]">
              {tx(
                language,
                'No active habits have a reminder time configured. Edit any habit to set a daily reminder time in your local timezone.',
                'কোনো সক্রিয় হ্যাবিটে রিমাইন্ডার সময় সেট করা নেই। যেকোনো হ্যাবিট এডিট করে আপনার টাইমজোন অনুযায়ী রিমাইন্ডার সময় যোগ করুন।'
              )}
            </p>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)] text-xs">
              {scheduledHabits.map((h) => (
                <div key={h.id} className="py-2 flex items-center justify-between gap-2">
                  <span className="text-[var(--text-primary)] truncate">{h.name}</span>
                  <span className="inline-flex items-center gap-1 font-mono-num text-[var(--accent-lime)] shrink-0">
                    <Clock className="w-3.5 h-3.5" />
                    {h.reminderTime}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
