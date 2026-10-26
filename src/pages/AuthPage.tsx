import React, { useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Eye, EyeOff, KeyRound, Lock, Mail, RefreshCw, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { COMMON_TIMEZONES, getAppName } from '../shared/config.ts';

type AuthMode = 'login' | 'register' | 'forgot-email' | 'forgot-code' | 'forgot-new-password';

export function AuthPage({ initialMode = 'login' }: { initialMode?: AuthMode }) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<AuthMode>(initialMode);

  const detectedTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }, []);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [timezone, setTimezone] = useState(detectedTz);
  const [weekStart, setWeekStart] = useState(1);

  // 3-step OTP password reset states
  const [codeDigits, setCodeDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [verifiedResetToken, setVerifiedResetToken] = useState('');
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  const digitRefs = useRef<Array<HTMLInputElement | null>>([]);

  const [submitting, setSubmitting] = useState(false);
  const [resendingCode, setResendingCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const appName = getAppName();

  const tzOptions = useMemo(() => {
    const list = new Set<string>([detectedTz, ...COMMON_TIMEZONES]);
    return Array.from(list);
  }, [detectedTz]);

  const pwChecks = {
    len: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    num: /[0-9]/.test(password),
  };

  const fullCode = codeDigits.join('');

  const handleDigitChange = (index: number, rawVal: string) => {
    const digitsOnly = rawVal.replace(/\D/g, '');
    if (!digitsOnly) {
      setCodeDigits((prev) => {
        const next = [...prev];
        next[index] = '';
        return next;
      });
      return;
    }

    // Handle multi-digit paste or autofill into a single box
    if (digitsOnly.length > 1) {
      const sliced = digitsOnly.slice(0, 6).split('');
      setCodeDigits((prev) => {
        const next = [...prev];
        for (let i = 0; i < 6; i++) {
          next[i] = sliced[i] ?? '';
        }
        return next;
      });
      const focusIdx = Math.min(sliced.length, 5);
      digitRefs.current[focusIdx]?.focus();
      return;
    }

    setCodeDigits((prev) => {
      const next = [...prev];
      next[index] = digitsOnly;
      return next;
    });

    if (index < 5) {
      digitRefs.current[index + 1]?.focus();
    }
  };

  const handleDigitKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !codeDigits[index] && index > 0) {
      digitRefs.current[index - 1]?.focus();
    }
  };

  const handleDigitPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    const chars = pasted.split('');
    setCodeDigits(['', '', '', '', '', ''].map((_, idx) => chars[idx] ?? ''));
    const focusIdx = Math.min(chars.length, 5);
    digitRefs.current[focusIdx]?.focus();
  };

  const requestResetCode = async (targetEmail: string) => {
    const res = await apiFetch<{
      message: string;
      emailDeliveryConfigured: boolean;
      previewCode?: string;
    }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: targetEmail }),
    });
    setCodeDigits(['', '', '', '', '', '']);
    setPreviewCode(res.previewCode ?? null);
    setInfoMessage(res.message);
    setMode('forgot-code');
    setTimeout(() => {
      digitRefs.current[0]?.focus();
    }, 50);
  };

  const handleResendCode = async () => {
    if (!email.trim() || resendingCode) return;
    setError(null);
    setInfoMessage(null);
    setResendingCode(true);
    try {
      await requestResetCode(email.trim());
    } catch (err: any) {
      setError(err?.message || 'Could not resend verification code.');
    } finally {
      setResendingCode(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);
    setSubmitting(true);

    try {
      if (mode === 'login') {
        await login(email.trim(), password);
      } else if (mode === 'register') {
        await register({
          name: name.trim(),
          email: email.trim(),
          password,
          timezone,
          weekStartPreference: weekStart,
        });
      } else if (mode === 'forgot-email') {
        await requestResetCode(email.trim());
      } else if (mode === 'forgot-code') {
        if (fullCode.length !== 6) {
          setError('Please enter all 6 digits of your verification code.');
          return;
        }
        const res = await apiFetch<{ resetToken: string; message: string }>(
          '/api/auth/verify-reset-code',
          {
            method: 'POST',
            body: JSON.stringify({
              email: email.trim(),
              code: fullCode,
            }),
          }
        );
        setVerifiedResetToken(res.resetToken);
        setPassword('');
        setConfirmPassword('');
        setPreviewCode(null);
        setInfoMessage('Verification code confirmed. Enter your new password below.');
        setMode('forgot-new-password');
      } else if (mode === 'forgot-new-password') {
        if (password !== confirmPassword) {
          setError('New password and confirmation password do not match.');
          return;
        }
        const res = await apiFetch<{ message: string }>('/api/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({
            token: verifiedResetToken,
            password,
          }),
        });
        setVerifiedResetToken('');
        setCodeDigits(['', '', '', '', '', '']);
        setPassword('');
        setConfirmPassword('');
        setInfoMessage(res.message);
        setMode('login');
      }
    } catch (err: any) {
      setError(err?.message || 'Authentication request failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const isForgotFlow =
    mode === 'forgot-email' || mode === 'forgot-code' || mode === 'forgot-new-password';

  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] grid grid-cols-1 lg:grid-cols-12">
      {/* Left Brand & Product Architecture Column */}
      <div className="hidden lg:flex lg:col-span-6 xl:col-span-7 flex-col justify-between p-12 bg-[var(--bg-panel)] border-r border-[var(--border-subtle)]">
        <div>
          <span className="text-xl font-bold font-display tracking-tight text-[var(--text-primary)]">
            {appName}
          </span>
        </div>

        <div className="max-w-xl space-y-6">
          <h1 className="text-4xl font-bold font-display leading-tight text-[var(--text-primary)]">
            Structured daily discipline with schedule-accurate consistency analytics.
          </h1>
          <p className="text-base text-[var(--text-secondary)] leading-relaxed">
            Track boolean, numeric, and duration-based routines in your local timezone. Review
            Week #1 through Week #5 calendar matrices, monitor schedule-aware streaks, and export
            clean spreadsheet-ready CSV reports from your isolated private workspace.
          </p>

          <div className="grid grid-cols-2 gap-6 pt-6 border-t border-[var(--border-subtle)]">
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Private Multi-User Isolation</p>
              <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                Every habit, log, goal, and CSV export is strictly scoped to your verified server session.
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Timezone & Schedule Aware</p>
              <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                Unscheduled rest days never break your streak, and pending habits stay distinct from missed deadlines.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <ShieldCheck className="w-4 h-4 text-[var(--accent-lime)]" />
          <span>HttpOnly PostgreSQL session security · Encrypted password storage</span>
        </div>
      </div>

      {/* Right Authentication Form Column */}
      <div className="lg:col-span-6 xl:col-span-5 flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md space-y-6">
          <div className="lg:hidden mb-4">
            <span className="text-xl font-bold font-display text-[var(--text-primary)]">
              {appName}
            </span>
          </div>

          <div>
            <h2 className="text-2xl font-bold font-display text-[var(--text-primary)]">
              {mode === 'login' && 'Sign in to your workspace'}
              {mode === 'register' && 'Create your private account'}
              {mode === 'forgot-email' && 'Reset your password'}
              {mode === 'forgot-code' && 'Enter verification code'}
              {mode === 'forgot-new-password' && 'Set new password'}
            </h2>
            <p className="text-sm text-[var(--text-secondary)] mt-1.5">
              {mode === 'login' && 'Enter your account credentials to continue tracking.'}
              {mode === 'register' && 'Set up an isolated workspace calibrated to your local timezone.'}
              {mode === 'forgot-email' &&
                'Enter your registered email address to receive a 6-digit verification code.'}
              {mode === 'forgot-code' && (
                <>
                  Enter the 6-digit verification code for{' '}
                  <strong className="text-[var(--text-primary)]">{email}</strong>.
                </>
              )}
              {mode === 'forgot-new-password' && (
                <>
                  Choose a strong new password for{' '}
                  <strong className="text-[var(--text-primary)]">{email}</strong>.
                </>
              )}
            </p>
          </div>

          {isForgotFlow && (
            <div className="grid grid-cols-3 gap-2 text-xs font-mono-num">
              <div
                className={`py-1.5 px-2.5 rounded-md border text-center ${
                  mode === 'forgot-email'
                    ? 'border-[var(--accent-lime)] text-[var(--accent-lime)] bg-[var(--bg-panel)]'
                    : 'border-[var(--border-subtle)] text-[var(--text-secondary)] bg-[var(--bg-panel)]'
                }`}
              >
                1. Email
              </div>
              <div
                className={`py-1.5 px-2.5 rounded-md border text-center ${
                  mode === 'forgot-code'
                    ? 'border-[var(--accent-lime)] text-[var(--accent-lime)] bg-[var(--bg-panel)]'
                    : 'border-[var(--border-subtle)] text-[var(--text-secondary)] bg-[var(--bg-panel)]'
                }`}
              >
                2. Code
              </div>
              <div
                className={`py-1.5 px-2.5 rounded-md border text-center ${
                  mode === 'forgot-new-password'
                    ? 'border-[var(--accent-lime)] text-[var(--accent-lime)] bg-[var(--bg-panel)]'
                    : 'border-[var(--border-subtle)] text-[var(--text-secondary)] bg-[var(--bg-panel)]'
                }`}
              >
                3. Password
              </div>
            </div>
          )}

          {(mode === 'login' || mode === 'register') && (
            <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                  setInfoMessage(null);
                }}
                className={`py-2 text-xs font-semibold rounded-md transition-colors ${
                  mode === 'login'
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Log in
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                  setInfoMessage(null);
                }}
                className={`py-2 text-xs font-semibold rounded-md transition-colors ${
                  mode === 'register'
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Create account
              </button>
            </div>
          )}

          {error && (
            <div role="alert" className="p-3.5 rounded-lg bg-[#2A1515] border border-[#5C2424] text-[#F87171] text-sm">
              {error}
            </div>
          )}

          {infoMessage && (
            <div role="status" className="p-3.5 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-strong)] text-sm text-[var(--text-primary)]">
              {infoMessage}
            </div>
          )}

          {mode === 'forgot-code' && previewCode && (
            <div className="p-3.5 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-strong)] space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[var(--text-secondary)]">
                  Preview Verification Code (SMTP not configured yet)
                </span>
                <button
                  type="button"
                  onClick={() => setCodeDigits(previewCode.split(''))}
                  className="text-xs font-semibold text-[var(--accent-lime)] hover:underline"
                >
                  Auto-fill code
                </button>
              </div>
              <div className="font-mono-num text-xl font-bold tracking-[0.3em] text-[var(--accent-lime)]">
                {previewCode}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label htmlFor="auth-name" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  Full name
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="auth-name"
                    type="text"
                    required
                    minLength={2}
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Alex Morgan"
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                  />
                </div>
              </div>
            )}

            {(mode === 'login' || mode === 'register' || mode === 'forgot-email') && (
              <div>
                <label htmlFor="auth-email" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  Email address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="auth-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                  />
                </div>
              </div>
            )}

            {mode === 'forgot-code' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label htmlFor="otp-digit-0" className="block text-xs font-medium text-[var(--text-secondary)]">
                    6-digit verification code
                  </label>
                  <button
                    type="button"
                    disabled={resendingCode}
                    onClick={() => void handleResendCode()}
                    className="inline-flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--accent-lime)] transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>{resendingCode ? 'Sending...' : 'Resend code'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-6 gap-2">
                  {codeDigits.map((digit, idx) => (
                    <input
                      key={idx}
                      id={`otp-digit-${idx}`}
                      ref={(el) => {
                        digitRefs.current[idx] = el;
                      }}
                      type="text"
                      inputMode="numeric"
                      autoComplete={idx === 0 ? 'one-time-code' : 'off'}
                      maxLength={6}
                      aria-label={`Verification digit ${idx + 1}`}
                      value={digit}
                      onChange={(e) => handleDigitChange(idx, e.target.value)}
                      onKeyDown={(e) => handleDigitKeyDown(idx, e)}
                      onPaste={handleDigitPaste}
                      className="w-full h-12 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-strong)] text-center text-lg font-bold font-mono-num text-[var(--text-primary)] focus:border-[var(--accent-lime)] focus:outline-none"
                    />
                  ))}
                </div>
              </div>
            )}

            {(mode === 'login' || mode === 'register' || mode === 'forgot-new-password') && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="auth-password" className="block text-xs font-medium text-[var(--text-secondary)]">
                    {mode === 'forgot-new-password' ? 'New password' : 'Password'}
                  </label>
                  {mode === 'login' && (
                    <button
                      type="button"
                      onClick={() => {
                        setMode('forgot-email');
                        setError(null);
                        setInfoMessage(null);
                      }}
                      className="text-xs text-[var(--text-secondary)] hover:text-[var(--accent-lime)] transition-colors"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-10 py-2.5 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            {mode === 'forgot-new-password' && (
              <div>
                <label
                  htmlFor="auth-confirm-password"
                  className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5"
                >
                  Confirm new password
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="auth-confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)]"
                  />
                </div>
              </div>
            )}

            {(mode === 'register' || mode === 'forgot-new-password') && (
              <div className="grid grid-cols-2 gap-1.5 text-xs text-[var(--text-secondary)] pt-1">
                {[
                  { ok: pwChecks.len, label: '8+ characters' },
                  { ok: pwChecks.upper, label: 'Uppercase letter' },
                  { ok: pwChecks.lower, label: 'Lowercase letter' },
                  { ok: pwChecks.num, label: 'At least 1 number' },
                ].map((rule) => (
                  <div key={rule.label} className="flex items-center gap-1.5">
                    <Check
                      className={`w-3.5 h-3.5 ${
                        rule.ok ? 'text-[var(--accent-lime)]' : 'text-[var(--text-muted)]'
                      }`}
                    />
                    <span className={rule.ok ? 'text-[var(--text-primary)]' : ''}>
                      {rule.label}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {mode === 'register' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label htmlFor="auth-timezone" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                    Timezone (IANA)
                  </label>
                  <select
                    id="auth-timezone"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                  >
                    {tzOptions.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="auth-week-start" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                    Week starts on
                  </label>
                  <select
                    id="auth-week-start"
                    value={weekStart}
                    onChange={(e) => setWeekStart(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                  >
                    <option value={1}>Monday</option>
                    <option value={0}>Sunday</option>
                    <option value={6}>Saturday</option>
                  </select>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || (mode === 'forgot-code' && fullCode.length !== 6)}
              className="w-full py-2.5 px-4 rounded-lg text-sm font-semibold bg-[var(--accent-lime)] text-[var(--accent-ink)] hover:bg-[var(--accent-lime-hover)] transition-colors disabled:opacity-50"
            >
              {submitting
                ? 'Please wait...'
                : mode === 'login'
                ? 'Sign in'
                : mode === 'register'
                ? 'Create Account'
                : mode === 'forgot-email'
                ? 'Send Verification Code'
                : mode === 'forgot-code'
                ? 'Verify Code'
                : 'Set New Password'}
            </button>

            {isForgotFlow && (
              <div className="flex items-center justify-between pt-2 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError(null);
                    setInfoMessage(null);
                    setPreviewCode(null);
                  }}
                  className="inline-flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to sign in</span>
                </button>

                {mode === 'forgot-code' && (
                  <button
                    type="button"
                    onClick={() => {
                      setMode('forgot-email');
                      setError(null);
                      setInfoMessage(null);
                    }}
                    className="text-[var(--accent-lime)] hover:underline"
                  >
                    Change email
                  </button>
                )}
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
