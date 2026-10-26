import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch, downloadAuthenticatedCsv } from '../lib/api.ts';
import { type AppLanguage, localeFromLanguage, tx } from '../lib/i18n.ts';
import { COMMON_TIMEZONES } from '../shared/config.ts';
import type { UserProfile, UserSettingsData } from '../shared/types.ts';

export function SettingsPage() {
  const {
    user,
    settings,
    language,
    setLanguage,
    updateProfileState,
    updateSettingsState,
    pushToast,
    refreshAuth,
  } = useAuth();

  const [timezone, setTimezone] = useState(user?.timezone || 'UTC');
  const [weekStart, setWeekStart] = useState<number>(user?.weekStartPreference ?? 1);
  const [theme, setTheme] = useState<'dark' | 'light'>(settings?.theme || 'dark');
  const [selectedLang, setSelectedLang] = useState<AppLanguage>(language);
  const [defaultRange, setDefaultRange] = useState<UserSettingsData['defaultDateRange']>(
    settings?.defaultDateRange || '30d'
  );
  const [quietStart, setQuietStart] = useState(
    settings?.reminderPreferences.quietHoursStart || '22:30'
  );
  const [quietEnd, setQuietEnd] = useState(
    settings?.reminderPreferences.quietHoursEnd || '06:30'
  );

  const [saving, setSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setSelectedLang(language);
  }, [language]);

  const tzList = useMemo(() => {
    const s = new Set<string>([user?.timezone || 'UTC', ...COMMON_TIMEZONES]);
    return Array.from(s);
  }, [user?.timezone]);

  if (!user || !settings) return null;

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const [profRes, setRes] = await Promise.all([
        apiFetch<{ user: UserProfile }>('/api/profile', {
          method: 'PATCH',
          body: JSON.stringify({
            timezone,
            weekStartPreference: weekStart,
          }),
        }),
        apiFetch<{ settings: UserSettingsData }>('/api/settings', {
          method: 'PATCH',
          body: JSON.stringify({
            theme,
            locale: localeFromLanguage(selectedLang),
            defaultDateRange: defaultRange,
            reminderPreferences: {
              ...settings.reminderPreferences,
              quietHoursStart: quietStart || null,
              quietHoursEnd: quietEnd || null,
            },
          }),
        }),
      ]);
      updateProfileState(profRes.user);
      updateSettingsState(setRes.settings);
      pushToast({
        message: tx(
          selectedLang,
          'Saved workspace settings.',
          'ওয়ার্কস্পেস সেটিংস সংরক্ষিত হয়েছে।'
        ),
      });
    } catch (err: any) {
      pushToast({
        message: err?.message || tx(language, 'Failed to save settings.', 'সেটিংস সংরক্ষণ করা যায়নি।'),
        tone: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeleting(true);
    try {
      await apiFetch('/api/account', {
        method: 'DELETE',
        body: JSON.stringify({
          confirmation: deleteConfirmText,
          password: deletePassword,
        }),
      });
      await refreshAuth();
    } catch (err: any) {
      pushToast({
        message: err?.message || tx(language, 'Account deletion failed.', 'অ্যাকাউন্ট মুছে ফেলা যায়নি।'),
        tone: 'error',
      });
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <form
        onSubmit={handleSaveSettings}
        className="p-6 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-5"
      >
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {tx(
              language,
              'Regional, Language, Calendar & Appearance Preferences',
              'অঞ্চল, ভাষা, ক্যালেন্ডার ও থিম পছন্দসমূহ'
            )}
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            {tx(
              language,
              'Daily tracking boundaries, interface language, reminders, and Week #1–#5 groupings follow these settings.',
              'দৈনিক ট্র্যাকিং সময়সীমা, ইন্টারফেসের ভাষা, রিমাইন্ডার এবং সপ্তাহের গ্রুপিং এই সেটিংস অনুযায়ী কাজ করবে।'
            )}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="settings-language" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              {tx(language, 'Interface language', 'ইন্টারফেসের ভাষা')}
            </label>
            <select
              id="settings-language"
              value={selectedLang}
              onChange={(e) => {
                const next = e.target.value as AppLanguage;
                setSelectedLang(next);
                void setLanguage(next);
              }}
              className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)]"
            >
              <option value="en">English</option>
              <option value="bn">বাংলা (Bangla)</option>
            </select>
          </div>

          <div>
            <label htmlFor="settings-theme" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              {tx(language, 'Theme preference', 'থিম পছন্দ')}
            </label>
            <select
              id="settings-theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value as 'dark' | 'light')}
              className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)]"
            >
              <option value="dark">{tx(language, 'Dark Luxury (Default)', 'ডার্ক মোড (ডিফল্ট)')}</option>
              <option value="light">{tx(language, 'Crisp Light', 'লাইট মোড')}</option>
            </select>
          </div>

          <div>
            <label htmlFor="settings-timezone" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              {tx(language, 'IANA Timezone', 'টাইমজোন (IANA)')}
            </label>
            <select
              id="settings-timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)]"
            >
              {tzList.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="settings-week-start" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              {tx(language, 'Week-start preference', 'সপ্তাহ শুরুর দিন')}
            </label>
            <select
              id="settings-week-start"
              value={weekStart}
              onChange={(e) => setWeekStart(Number(e.target.value))}
              className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)]"
            >
              <option value={1}>{tx(language, 'Monday', 'সোমবার')}</option>
              <option value={0}>{tx(language, 'Sunday', 'রবিবার')}</option>
              <option value={6}>{tx(language, 'Saturday', 'শনিবার')}</option>
            </select>
          </div>

          <div>
            <label htmlFor="settings-default-range" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              {tx(language, 'Default analytics date range', 'ডিফল্ট অ্যানালিটিক্স সময়সীমা')}
            </label>
            <select
              id="settings-default-range"
              value={defaultRange}
              onChange={(e) =>
                setDefaultRange(e.target.value as UserSettingsData['defaultDateRange'])
              }
              className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)]"
            >
              <option value="7d">{tx(language, 'Last 7 days', 'গত ৭ দিন')}</option>
              <option value="30d">{tx(language, 'Last 30 days', 'গত ৩০ দিন')}</option>
              <option value="this_week">{tx(language, 'Current week', 'চলতি সপ্তাহ')}</option>
              <option value="this_month">{tx(language, 'Current month', 'চলতি মাস')}</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="settings-quiet-start" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                {tx(language, 'Quiet hours start', 'নীরব সময় শুরু')}
              </label>
              <input
                id="settings-quiet-start"
                type="time"
                value={quietStart}
                onChange={(e) => setQuietStart(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm font-mono-num text-[var(--text-primary)]"
              />
            </div>

            <div>
              <label htmlFor="settings-quiet-end" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                {tx(language, 'Quiet hours end', 'নীরব সময় শেষ')}
              </label>
              <input
                id="settings-quiet-end"
                type="time"
                value={quietEnd}
                onChange={(e) => setQuietEnd(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm font-mono-num text-[var(--text-primary)]"
              />
            </div>
          </div>
        </div>

        <div className="pt-3 border-t border-[var(--border-subtle)] flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 rounded-lg text-sm font-semibold bg-[var(--accent-lime)] text-[var(--accent-ink)] hover:bg-[var(--accent-lime-hover)] disabled:opacity-50"
          >
            {saving
              ? tx(language, 'Saving...', 'সংরক্ষণ হচ্ছে...')
              : tx(language, 'Save Preferences', 'পছন্দসমূহ সংরক্ষণ করুন')}
          </button>
        </div>
      </form>

      {/* Personal Data Export */}
      <section className="p-6 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {tx(language, 'Export Personal Data', 'ব্যক্তিগত ডেটা এক্সপোর্ট')}
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            {tx(
              language,
              'Download a portable CSV archive of your habit definitions and historical logs.',
              'আপনার সকল হ্যাবিট এবং পূর্ববর্তী লগের CSV ফাইল ডাউনলোড করুন।'
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void downloadAuthenticatedCsv('/api/exports/habits.csv', 'habits.csv')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-strong)]"
          >
            <Download className="w-3.5 h-3.5 text-[var(--accent-lime)]" />
            <span>Habits CSV</span>
          </button>
          <button
            type="button"
            onClick={() => void downloadAuthenticatedCsv('/api/exports/logs.csv', 'logs.csv')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-strong)]"
          >
            <Download className="w-3.5 h-3.5 text-[var(--accent-lime)]" />
            <span>Logs CSV</span>
          </button>
        </div>
      </section>

      {/* Account Deletion & Data Retention Policy */}
      <section className="p-6 rounded-xl bg-[var(--bg-panel)] border border-red-500/30 space-y-3">
        <div className="flex items-center gap-2 text-[var(--status-danger)]">
          <AlertTriangle className="w-4 h-4" />
          <h2 className="text-base font-semibold">
            {tx(
              language,
              'Delete Account & Erase Workspace',
              'অ্যাকাউন্ট ও ওয়ার্কস্পেস স্থায়ীভাবে মুছুন'
            )}
          </h2>
        </div>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          {tx(
            language,
            'Data-retention policy: Deleting your account immediately and permanently cascades across PostgreSQL to remove your user record, active sessions, habits, historical daily logs, goals, and notifications. This operation cannot be undone.',
            'ডেটা নীতি: অ্যাকাউন্ট মুছে ফেললে আপনার প্রোফাইল, সেশন, সকল হ্যাবিট, দৈনিক লগ, লক্ষ্যসমূহ এবং নোটিফিকেশন স্থায়ীভাবে মুছে যাবে। এটি আর ফিরিয়ে আনা যাবে না।'
          )}
        </p>
        <button
          type="button"
          onClick={() => setShowDeleteModal(true)}
          className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#DC2626] text-white hover:bg-[#B91C1C]"
        >
          {tx(language, 'Delete Account...', 'অ্যাকাউন্ট মুছুন...')}
        </button>
      </section>

      {showDeleteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-account-delete-title"
        >
          <form
            onSubmit={handleDeleteAccount}
            className="w-full max-w-md bg-[var(--bg-panel)] border border-red-500/40 rounded-xl p-6 space-y-4"
          >
            <h2 id="confirm-account-delete-title" className="text-base font-semibold text-[var(--status-danger)]">
              {tx(
                language,
                'Confirm Permanent Account Deletion',
                'স্থায়ীভাবে অ্যাকাউন্ট মুছে ফেলা নিশ্চিত করুন'
              )}
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              {tx(
                language,
                'Type DELETE MY ACCOUNT and enter your current password to permanently erase all data.',
                'সকল ডেটা স্থায়ীভাবে মুছে ফেলতে নিচে DELETE MY ACCOUNT লিখুন এবং আপনার বর্তমান পাসওয়ার্ড দিন।'
              )}
            </p>
            <div>
              <label htmlFor="delete-confirm-phrase" className="block text-xs text-[var(--text-secondary)] mb-1">
                {tx(language, 'Confirmation phrase', 'নিশ্চিতকরণ বাক্য')}
              </label>
              <input
                id="delete-confirm-phrase"
                type="text"
                required
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE MY ACCOUNT"
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-mono-num text-[var(--text-primary)]"
              />
            </div>
            <div>
              <label htmlFor="delete-confirm-password" className="block text-xs text-[var(--text-secondary)] mb-1">
                {tx(language, 'Current password', 'বর্তমান পাসওয়ার্ড')}
              </label>
              <input
                id="delete-confirm-password"
                type="password"
                required
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                {tx(language, 'Cancel', 'বাতিল')}
              </button>
              <button
                type="submit"
                disabled={deleting || deleteConfirmText !== 'DELETE MY ACCOUNT'}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#DC2626] text-white disabled:opacity-40"
              >
                {deleting
                  ? tx(language, 'Deleting...', 'মুছে ফেলা হচ্ছে...')
                  : tx(language, 'Erase Account', 'অ্যাকাউন্ট মুছে ফেলুন')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
