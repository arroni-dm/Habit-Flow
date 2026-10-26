// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App.tsx';
import { ProgressRing } from '../components/ProgressRing.tsx';
import { AuthProvider } from '../context/AuthContext.tsx';
import { ensureWritableWindowFetch } from '../lib/browserGuard.ts';
import { AuthPage } from '../pages/AuthPage.tsx';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('Frontend UI & Accessibility Verification', () => {
  it('prevents TypeError when third-party extensions assign to a getter-only window.fetch', () => {
    const fakeWin = {} as Window & typeof globalThis;
    const baseFetch = vi.fn();
    Object.defineProperty(fakeWin, 'fetch', {
      configurable: true,
      get: () => baseFetch,
    });

    // Without guard, strict-mode assignment throws: Cannot set property fetch which has only a getter
    expect(() => {
      (fakeWin as any).fetch = vi.fn();
    }).toThrow(TypeError);

    ensureWritableWindowFetch(fakeWin);

    const extWrappedFetch = vi.fn();
    expect(() => {
      (fakeWin as any).fetch = extWrappedFetch;
    }).not.toThrow();
    expect(fakeWin.fetch).toBe(extWrappedFetch);
  });

  it('renders ProgressRing with accessible progressbar attributes and clamped values', () => {
    render(<ProgressRing percentage={84.6} subtitle="5 of 6 done" />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '85');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getByText('85%')).toBeInTheDocument();
    expect(screen.getByText('5 of 6 done')).toBeInTheDocument();
  });

  it('switches AuthPage between Login and Create Account modes and displays live password criteria', async () => {
    const user = userEvent.setup();

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify({ error: 'Authentication required.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/auth/login')) {
        return new Response(JSON.stringify({ error: 'Invalid email address or password.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    render(
      <AuthProvider>
        <AuthPage />
      </AuthProvider>
    );

    expect(screen.getByRole('heading', { name: /sign in to your workspace/i })).toBeInTheDocument();

    // Attempt login and verify server error banner renders cleanly
    await user.type(screen.getByLabelText(/email address/i), 'wrong@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'WrongPass123');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/invalid email address or password/i);
    });

    // Switch to Create account tab
    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(screen.getByRole('heading', { name: /create your private account/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/timezone/i)).toBeInTheDocument();
    expect(screen.getByText(/8\+ characters/i)).toBeInTheDocument();
  });

  it('renders authenticated workspace navigation and dashboard KPIs for a signed-in user', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) {
        return new Response(
          JSON.stringify({
            user: {
              id: 7,
              name: 'Maya Chen',
              email: 'maya@example.com',
              avatarUrl: null,
              timezone: 'UTC',
              weekStartPreference: 1,
              onboardingCompleted: true,
              createdAt: '2026-10-01T00:00:00.000Z',
              updatedAt: '2026-10-01T00:00:00.000Z',
            },
            settings: {
              theme: 'dark',
              locale: 'en-US',
              defaultDateRange: '30d',
              notificationPreferences: {
                inAppReminders: true,
                streakMilestones: true,
                weeklyDigest: true,
              },
              reminderPreferences: {
                quietHoursStart: '22:00',
                quietHoursEnd: '07:00',
                defaultReminderTime: '08:00',
              },
            },
            csrfToken: 'test-csrf-token',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/api/notifications')) {
        return new Response(JSON.stringify({ notifications: [], unreadCount: 2 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/analytics/overview')) {
        return new Response(
          JSON.stringify({
            userToday: '2026-10-20',
            selectedDate: '2026-10-20',
            range: { startDate: '2026-09-21', endDate: '2026-10-20', label: 'Last 30 days' },
            hasAnyHabits: true,
            hasHistory: true,
            todaySummary: {
              date: '2026-10-20',
              hasEligibleHabits: true,
              eligibleCount: 4,
              completedCount: 3,
              pendingCount: 1,
              missedCount: 0,
              upcomingCount: 0,
              overallCompletionRate: 75,
              booleanEligibleCount: 4,
              booleanCompletedCount: 3,
              booleanCompletionRate: 75,
              measurableEligibleCount: 0,
              measurableAverageAttainment: 0,
            },
            sevenDayOverview: [],
            weekly: {
              totalScheduled: 20,
              eligibleToDate: 8,
              completedCount: 7,
              pendingCount: 1,
              missedCount: 0,
              upcomingCount: 12,
              completionRate: 87.5,
              dailySummaries: [],
              previousRate: 80,
              delta: 7.5,
            },
            monthly: {
              totalScheduled: 80,
              eligibleToDate: 60,
              completedCount: 51,
              pendingCount: 1,
              missedCount: 8,
              upcomingCount: 20,
              completionRate: 85,
              dailySummaries: [],
              previousRate: 78,
              delta: 7,
            },
            selectedPeriod: {
              totalScheduled: 80,
              eligibleToDate: 60,
              completedCount: 51,
              pendingCount: 1,
              missedCount: 8,
              upcomingCount: 20,
              completionRate: 85,
              dailySummaries: [],
              previousRate: 78,
              delta: 7,
            },
            streaks: {
              currentStreak: 9,
              longestStreak: 14,
              perfectDayCurrentStreak: 3,
              perfectDayLongestStreak: 6,
              consistencyThresholdPct: 80,
            },
            topHabits: [],
            categoryPerformance: [],
            insights: {
              bestHabit: null,
              attentionHabit: null,
              weeklyDelta: 7.5,
              monthlyDelta: 7,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/api/tracking/day')) {
        return new Response(
          JSON.stringify({
            date: '2026-10-20',
            userToday: '2026-10-20',
            summary: {
              date: '2026-10-20',
              hasEligibleHabits: true,
              eligibleCount: 4,
              completedCount: 3,
              pendingCount: 1,
              missedCount: 0,
              upcomingCount: 0,
              overallCompletionRate: 75,
              booleanEligibleCount: 4,
              booleanCompletedCount: 3,
              booleanCompletionRate: 75,
              measurableEligibleCount: 0,
              measurableAverageAttainment: 0,
            },
            occurrences: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Maya Chen')).toBeInTheDocument();
    });

    expect(screen.getAllByText(/daily habits/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^calendar$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/weekly review/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/reports & export/i).length).toBeGreaterThan(0);
  });

  it('walks through the 3-step password reset flow (Email -> 6-Digit Code -> Set New Password)', async () => {
    const user = userEvent.setup();

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify({ error: 'Authentication required.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/auth/forgot-password')) {
        return new Response(
          JSON.stringify({
            ok: true,
            step: 'verify_code',
            emailDeliveryConfigured: true,
            message: 'We sent a 6-digit verification code to your email.',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/auth/verify-reset-code')) {
        return new Response(
          JSON.stringify({
            ok: true,
            resetToken: 'verified-session-reset-token-1234567890',
            message: 'Verification code confirmed.',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/auth/reset-password')) {
        return new Response(
          JSON.stringify({
            ok: true,
            message: 'Password updated. You can now sign in with your new password.',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    render(
      <AuthProvider>
        <AuthPage />
      </AuthProvider>
    );

    // Click "Forgot password?"
    await user.click(screen.getByRole('button', { name: /forgot password\?/i }));
    expect(screen.getByRole('heading', { name: /reset your password/i })).toBeInTheDocument();

    // Step 1: Submit email
    await user.type(screen.getByLabelText(/email address/i), 'arroni@example.com');
    await user.click(screen.getByRole('button', { name: /send verification code/i }));

    // Step 2: Enter 6-digit code
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /enter verification code/i })).toBeInTheDocument();
    });

    const digits = ['4', '8', '2', '9', '1', '5'];
    for (let i = 0; i < 6; i++) {
      await user.type(screen.getByLabelText(`Verification digit ${i + 1}`), digits[i]);
    }
    await user.click(screen.getByRole('button', { name: /^verify code$/i }));

    // Step 3: Set new password right in place
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /set new password/i })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/^new password$/i), 'StrongPass123');
    await user.type(screen.getByLabelText(/confirm new password/i), 'StrongPass123');
    await user.click(screen.getByRole('button', { name: /set new password/i }));

    // Returns to login screen with confirmation message
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in to your workspace/i })).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent(/password updated/i);
    });
  });

  it('allows creating a habit starting on today or any future date clicked on the Calendar', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/calendar');

    const capturedPayloads: Record<string, any>[] = [];

    const dailySummaries = Array.from({ length: 31 }, (_, idx) => {
      const day = String(idx + 1).padStart(2, '0');
      const date = `2026-10-${day}`;
      return {
        date,
        hasEligibleHabits: false,
        eligibleCount: 0,
        completedCount: 0,
        pendingCount: 0,
        missedCount: 0,
        upcomingCount: 0,
        overallCompletionRate: 0,
        booleanEligibleCount: 0,
        booleanCompletedCount: 0,
        booleanCompletionRate: 0,
        measurableEligibleCount: 0,
        measurableAverageAttainment: 0,
      };
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) {
        return new Response(
          JSON.stringify({
            user: {
              id: 7,
              name: 'Maya Chen',
              email: 'maya@example.com',
              avatarUrl: null,
              timezone: 'UTC',
              weekStartPreference: 1,
              onboardingCompleted: true,
              createdAt: '2026-10-01T00:00:00.000Z',
              updatedAt: '2026-10-01T00:00:00.000Z',
            },
            settings: {
              theme: 'light',
              locale: 'en-US',
              defaultDateRange: '30d',
              notificationPreferences: {
                inAppReminders: true,
                streakMilestones: true,
                weeklyDigest: true,
              },
              reminderPreferences: {
                quietHoursStart: '22:00',
                quietHoursEnd: '07:00',
                defaultReminderTime: '08:00',
              },
            },
            csrfToken: 'test-csrf-token',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/api/notifications')) {
        return new Response(JSON.stringify({ notifications: [], unreadCount: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/tracking/range')) {
        return new Response(
          JSON.stringify({
            startDate: '2026-10-01',
            endDate: '2026-10-31',
            userToday: '2026-10-26',
            habits: [],
            logs: [],
            metrics: {
              totalScheduled: 0,
              eligibleToDate: 0,
              completedCount: 0,
              pendingCount: 0,
              missedCount: 0,
              completionRate: 0,
              dailySummaries,
            },
            weekGroups: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/api/habits') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        capturedPayloads.push(body);
        return new Response(
          JSON.stringify({
            habit: {
              id: 101,
              userId: 7,
              name: body.name,
              description: null,
              category: 'Health & Fitness',
              icon: 'CheckCircle2',
              color: '#C6FF00',
              habitType: 'boolean',
              scheduleType: 'daily',
              scheduleConfig: {},
              targetValue: 1,
              targetUnit: null,
              startDate: body.startDate,
              endDate: body.endDate,
              reminderTime: null,
              completionDeadline: null,
              priority: 'medium',
              status: 'active',
              archivedAt: null,
              archivedLocalDate: null,
              displayOrder: 0,
              createdAt: '2026-10-26T00:00:00.000Z',
              updatedAt: '2026-10-26T00:00:00.000Z',
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /monthly heatmap/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /monthly heatmap/i }));

    // Click future date cell 31 (2026-10-31)
    const day31Cell = screen.getByRole('button', { name: /^31\s+Future$/i });
    await user.click(day31Cell);

    // Selected date action button appears for 2026-10-31
    const addOnDateButtons = screen.getAllByRole('button', {
      name: /add habit on 2026-10-31/i,
    });
    expect(addOnDateButtons.length).toBeGreaterThan(0);

    await user.click(addOnDateButtons[0]);

    // Verify Create Habit modal opens with Start date pre-filled to 2026-10-31
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /create habit/i })).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/start date/i)).toHaveValue('2026-10-31');

    // Choose one-time schedule on that date and submit
    await user.selectOptions(screen.getByLabelText(/schedule/i), 'single_day');
    expect(screen.getByLabelText(/end date/i)).toHaveValue('2026-10-31');

    await user.type(screen.getByLabelText(/habit name/i), 'Halloween 5K Run');
    await user.click(screen.getByRole('button', { name: /^create habit$/i }));

    await waitFor(() => {
      expect(capturedPayloads.length).toBe(1);
    });
    expect(capturedPayloads[0].name).toBe('Halloween 5K Run');
    expect(capturedPayloads[0].startDate).toBe('2026-10-31');
    expect(capturedPayloads[0].endDate).toBe('2026-10-31');

    window.history.pushState({}, '', '/');
  });

  it('switches the workspace language between English and Bangla from the header button next to New Habit', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/');

    const settingsUpdates: Record<string, any>[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) {
        return new Response(
          JSON.stringify({
            user: {
              id: 7,
              name: 'Maya Chen',
              email: 'maya@example.com',
              avatarUrl: null,
              timezone: 'Asia/Dhaka',
              weekStartPreference: 1,
              onboardingCompleted: true,
              createdAt: '2026-10-01T00:00:00.000Z',
              updatedAt: '2026-10-01T00:00:00.000Z',
            },
            settings: {
              theme: 'light',
              locale: 'en-US',
              defaultDateRange: '30d',
              notificationPreferences: {
                inAppEnabled: true,
                browserPushEnabled: false,
                streakMilestonesEnabled: true,
                dailySummaryEnabled: false,
              },
              reminderPreferences: {
                remindersEnabled: true,
                quietHoursStart: '22:00',
                quietHoursEnd: '07:00',
                defaultReminderTime: '08:00',
              },
            },
            csrfToken: 'test-csrf-token',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/api/settings') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        settingsUpdates.push(body);
        return new Response(
          JSON.stringify({
            user: {
              id: 7,
              name: 'Maya Chen',
              email: 'maya@example.com',
              avatarUrl: null,
              timezone: 'Asia/Dhaka',
              weekStartPreference: 1,
              onboardingCompleted: true,
              createdAt: '2026-10-01T00:00:00.000Z',
              updatedAt: '2026-10-01T00:00:00.000Z',
            },
            settings: {
              theme: 'light',
              locale: body.locale || 'bn-BD',
              defaultDateRange: '30d',
              notificationPreferences: {
                inAppEnabled: true,
                browserPushEnabled: false,
                streakMilestonesEnabled: true,
                dailySummaryEnabled: false,
              },
              reminderPreferences: {
                remindersEnabled: true,
                quietHoursStart: '22:00',
                quietHoursEnd: '07:00',
                defaultReminderTime: '08:00',
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/api/notifications')) {
        return new Response(JSON.stringify({ notifications: [], unreadCount: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/analytics/overview')) {
        return new Response(
          JSON.stringify({
            userToday: '2026-10-26',
            selectedDate: '2026-10-26',
            range: { startDate: '2026-09-27', endDate: '2026-10-26', label: 'Last 30 days' },
            hasAnyHabits: false,
            hasHistory: false,
            todaySummary: {
              date: '2026-10-26',
              hasEligibleHabits: false,
              eligibleCount: 0,
              completedCount: 0,
              pendingCount: 0,
              missedCount: 0,
              upcomingCount: 0,
              overallCompletionRate: 0,
              booleanEligibleCount: 0,
              booleanCompletedCount: 0,
              booleanCompletionRate: 0,
              measurableEligibleCount: 0,
              measurableAverageAttainment: 0,
            },
            sevenDayOverview: [],
            weekly: {
              totalScheduled: 0,
              eligibleToDate: 0,
              completedCount: 0,
              pendingCount: 0,
              missedCount: 0,
              upcomingCount: 0,
              completionRate: 0,
              dailySummaries: [],
              previousRate: 0,
              delta: null,
            },
            monthly: {
              totalScheduled: 0,
              eligibleToDate: 0,
              completedCount: 0,
              pendingCount: 0,
              missedCount: 0,
              upcomingCount: 0,
              completionRate: 0,
              dailySummaries: [],
              previousRate: 0,
              delta: null,
            },
            selectedPeriod: {
              totalScheduled: 0,
              eligibleToDate: 0,
              completedCount: 0,
              pendingCount: 0,
              missedCount: 0,
              upcomingCount: 0,
              completionRate: 0,
              dailySummaries: [],
              previousRate: 0,
              delta: null,
            },
            streaks: {
              currentStreak: 0,
              longestStreak: 0,
              perfectDayCurrentStreak: 0,
              perfectDayLongestStreak: 0,
              consistencyThresholdPct: 80,
            },
            topHabits: [],
            categoryPerformance: [],
            insights: {
              bestHabit: null,
              attentionHabit: null,
              weeklyDelta: null,
              monthlyDelta: null,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/api/tracking/day')) {
        return new Response(
          JSON.stringify({
            date: '2026-10-26',
            userToday: '2026-10-26',
            summary: {
              date: '2026-10-26',
              hasEligibleHabits: false,
              eligibleCount: 0,
              completedCount: 0,
              pendingCount: 0,
              missedCount: 0,
              upcomingCount: 0,
              overallCompletionRate: 0,
              booleanEligibleCount: 0,
              booleanCompletedCount: 0,
              booleanCompletionRate: 0,
              measurableEligibleCount: 0,
              measurableAverageAttainment: 0,
            },
            occurrences: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new habit/i })).toBeInTheDocument();
    });

    // Verify language switcher button sits in header showing English initially
    const langBtn = screen.getByRole('button', { name: /change language/i });
    expect(langBtn).toHaveTextContent('English');

    // Open dropdown and select বাংলা
    await user.click(langBtn);
    const banglaOption = screen.getByRole('option', { name: 'বাংলা' });
    await user.click(banglaOption);

    // Header button, New Habit button, and navigation switch immediately to Bangla
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /change language/i })).toHaveTextContent('বাংলা');
      expect(screen.getByRole('button', { name: /নতুন হ্যাবিট/ })).toBeInTheDocument();
      expect(screen.getAllByText('ড্যাশবোর্ড').length).toBeGreaterThan(0);
    });

    expect(document.documentElement.lang).toBe('bn');
    expect(settingsUpdates).toEqual([{ locale: 'bn-BD' }]);

    // Switch back to English
    await user.click(screen.getByRole('button', { name: /change language/i }));
    await user.click(screen.getByRole('option', { name: 'English' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /change language/i })).toHaveTextContent('English');
      expect(screen.getByRole('button', { name: /new habit/i })).toBeInTheDocument();
    });

    expect(document.documentElement.lang).toBe('en');
    expect(settingsUpdates).toEqual([{ locale: 'bn-BD' }, { locale: 'en-US' }]);
  });
});
