import React, { useEffect, useRef, useState } from 'react';
import { Camera, Shield, Trash2, Upload } from 'lucide-react';
import { UserAvatar } from '../components/UserAvatar.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { tx } from '../lib/i18n.ts';
import type { OverallStreakSummary, UserProfile } from '../shared/types.ts';

const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_SOURCE_BYTES = 8 * 1024 * 1024; // 8 MB source file before client-side square optimization

async function resizeImageToSquareDataUrl(file: File, targetSize: number = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected image file.'));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (typeof document === 'undefined') {
        resolve(dataUrl);
        return;
      }

      const img = new Image();
      img.onerror = () => reject(new Error('Invalid or corrupted image file.'));
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = targetSize;
          canvas.height = targetSize;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(dataUrl);
            return;
          }

          // Center-crop square from original image
          const minSide = Math.min(img.width, img.height);
          const sx = Math.max(0, (img.width - minSide) / 2);
          const sy = Math.max(0, (img.height - minSide) / 2);
          ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, targetSize, targetSize);

          const optimized = canvas.toDataURL('image/webp', 0.88);
          if (optimized.startsWith('data:image/webp;base64,')) {
            resolve(optimized);
          } else {
            resolve(canvas.toDataURL('image/jpeg', 0.88));
          }
        } catch {
          resolve(dataUrl);
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export function ProfilePage() {
  const { user, language, updateProfileState, pushToast } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const [streaks, setStreaks] = useState<OverallStreakSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setEmail(user.email);
    }
  }, [user]);

  useEffect(() => {
    void apiFetch<{ overall: OverallStreakSummary }>('/api/analytics/streaks')
      .then((res) => setStreaks(res.overall))
      .catch(() => {});
  }, []);

  if (!user) return null;

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      pushToast({
        message: 'Please select a JPG, PNG, WebP, or GIF image.',
        tone: 'error',
      });
      return;
    }

    if (file.size > MAX_SOURCE_BYTES) {
      pushToast({
        message: 'Selected image must be 8 MB or smaller.',
        tone: 'error',
      });
      return;
    }

    setUploadingAvatar(true);
    try {
      const optimizedDataUrl = await resizeImageToSquareDataUrl(file, 256);
      const res = await apiFetch<{ user: UserProfile }>('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({ avatarUrl: optimizedDataUrl }),
      });
      updateProfileState(res.user);
      pushToast({ message: 'Profile photo updated.' });
    } catch (err: any) {
      pushToast({
        message: err?.message || 'Failed to upload profile photo.',
        tone: 'error',
      });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleRemoveAvatar = async () => {
    setUploadingAvatar(true);
    try {
      const res = await apiFetch<{ user: UserProfile }>('/api/profile/avatar', {
        method: 'DELETE',
      });
      updateProfileState(res.user);
      pushToast({ message: 'Profile photo removed.' });
    } catch (err: any) {
      pushToast({
        message: err?.message || 'Failed to remove profile photo.',
        tone: 'error',
      });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSaveIdentity = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const res = await apiFetch<{ user: UserProfile }>('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
        }),
      });
      updateProfileState(res.user);
      pushToast({ message: 'Updated profile details.' });
    } catch (err: any) {
      pushToast({ message: err?.message || 'Failed to update profile.', tone: 'error' });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPassword(true);
    try {
      await apiFetch('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });
      setCurrentPassword('');
      setNewPassword('');
      pushToast({ message: 'Password updated.' });
    } catch (err: any) {
      pushToast({ message: err?.message || 'Password update failed.', tone: 'error' });
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header Summary & Profile Photo Upload */}
      <section className="p-6 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] flex flex-col gap-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
              aria-label="Change profile photo"
              className="relative group rounded-xl focus:outline-none disabled:opacity-60"
            >
              <UserAvatar
                name={user.name}
                avatarUrl={user.avatarUrl}
                sizeClass="w-16 h-16 rounded-xl"
                textClass="text-lg"
              />
              <span className="absolute inset-0 rounded-xl bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                <Camera className="w-5 h-5" />
              </span>
            </button>

            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-[var(--text-primary)] truncate">
                {user.name}
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                {user.email} · {user.timezone} · {tx(language, 'Joined', 'যোগদান')}{' '}
                {new Date(user.createdAt).toLocaleDateString()}
              </p>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  id="profile-avatar-upload"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={handleAvatarChange}
                  className="sr-only"
                />
                <button
                  type="button"
                  disabled={uploadingAvatar}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  <Upload className="w-3.5 h-3.5 text-[var(--accent-lime)]" />
                  <span>
                    {uploadingAvatar
                      ? tx(language, 'Uploading...', 'আপলোড হচ্ছে...')
                      : user.avatarUrl
                      ? tx(language, 'Change Photo', 'ছবি পরিবর্তন করুন')
                      : tx(language, 'Upload Photo', 'ছবি আপলোড করুন')}
                  </span>
                </button>

                {user.avatarUrl && (
                  <button
                    type="button"
                    disabled={uploadingAvatar}
                    onClick={() => void handleRemoveAvatar()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--text-secondary)] hover:text-[#F87171] hover:bg-[var(--bg-surface)] border border-[var(--border-subtle)] transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{tx(language, 'Remove', 'মুছে ফেলুন')}</span>
                  </button>
                )}

                <span className="text-xs text-[var(--text-muted)]">
                  {tx(
                    language,
                    'JPG, PNG, WebP or GIF (auto-cropped square)',
                    'JPG, PNG, WebP বা GIF (স্বয়ংক্রিয় বর্গাকার ক্রপ)'
                  )}
                </span>
              </div>
            </div>
          </div>

          {streaks && (
            <div className="flex items-center gap-5 sm:text-right font-mono-num shrink-0">
              <div>
                <p className="text-xs text-[var(--text-secondary)]">
                  {tx(language, 'Consistency Streak', 'ধারাবাহিকতা ধারা')}
                </p>
                <p className="text-lg font-bold text-[var(--accent-lime)]">
                  {streaks.currentStreak}d
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--text-secondary)]">
                  {tx(language, 'All-Time Best', 'সর্বকালের সেরা')}
                </p>
                <p className="text-lg font-bold text-[var(--text-primary)]">
                  {streaks.longestStreak}d
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Account Identity Form */}
      <form
        onSubmit={handleSaveIdentity}
        className="p-6 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4"
      >
        <h3 className="text-base font-semibold text-[var(--text-primary)]">
          {tx(language, 'Profile Information', 'প্রোফাইল তথ্য')}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="profile-name" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              {tx(language, 'Display name', 'প্রদর্শিত নাম')}
            </label>
            <input
              id="profile-name"
              type="text"
              required
              minLength={2}
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)]"
            />
          </div>

          <div>
            <label htmlFor="profile-email" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              {tx(language, 'Email address', 'ইমেইল ঠিকানা')}
            </label>
            <input
              id="profile-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)]"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={savingProfile}
            className="px-5 py-2 rounded-lg text-sm font-semibold bg-[var(--accent-lime)] text-[var(--accent-ink)] hover:bg-[var(--accent-lime-hover)] disabled:opacity-50"
          >
            {savingProfile
              ? tx(language, 'Saving...', 'সংরক্ষণ হচ্ছে...')
              : tx(language, 'Update Profile', 'প্রোফাইল আপডেট করুন')}
          </button>
        </div>
      </form>

      {/* Password Change Form */}
      <form
        onSubmit={handleChangePassword}
        className="p-6 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4"
      >
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-[var(--accent-lime)]" />
          <h3 className="text-base font-semibold text-[var(--text-primary)]">
            {tx(language, 'Change Password', 'পাসওয়ার্ড পরিবর্তন করুন')}
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="profile-cur-pw" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              {tx(language, 'Current password', 'বর্তমান পাসওয়ার্ড')}
            </label>
            <input
              id="profile-cur-pw"
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)]"
            />
          </div>

          <div>
            <label htmlFor="profile-new-pw" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              {tx(
                language,
                'New password (8+ chars, upper, lower, digit)',
                'নতুন পাসওয়ার্ড (কমপক্ষে ৮ অক্ষর, বড়/ছোট হাতের ও সংখ্যা)'
              )}
            </label>
            <input
              id="profile-new-pw"
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)]"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={savingPassword}
            className="px-5 py-2 rounded-lg text-sm font-semibold bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] disabled:opacity-50"
          >
            {savingPassword
              ? tx(language, 'Updating...', 'আপডেট হচ্ছে...')
              : tx(language, 'Update Password', 'পাসওয়ার্ড আপডেট করুন')}
          </button>
        </div>
      </form>
    </div>
  );
}
