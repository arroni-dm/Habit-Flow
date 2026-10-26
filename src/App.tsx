/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { HabitFormModal } from './components/HabitFormModal.tsx';
import { Layout, type NavRoute } from './components/Layout.tsx';
import { OnboardingModal } from './components/OnboardingModal.tsx';
import { SpreadsheetImportModal } from './components/SpreadsheetImportModal.tsx';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { AnalyticsPage } from './pages/AnalyticsPage.tsx';
import { AuthPage } from './pages/AuthPage.tsx';
import { CalendarPage } from './pages/CalendarPage.tsx';
import { DailyHabitsPage } from './pages/DailyHabitsPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { GoalsPage } from './pages/GoalsPage.tsx';
import { NotificationsPage } from './pages/NotificationsPage.tsx';
import { ProfilePage } from './pages/ProfilePage.tsx';
import { ReportsExportPage } from './pages/ReportsExportPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { WeeklyReviewPage } from './pages/WeeklyReviewPage.tsx';
import { getLocalDateInTimezone } from './shared/dates.ts';
import type { HabitRecord } from './shared/types.ts';

const VALID_ROUTES = new Set<NavRoute>([
  '/',
  '/habits',
  '/calendar',
  '/analytics',
  '/goals',
  '/weekly-review',
  '/reports',
  '/notifications',
  '/settings',
  '/profile',
]);

function readRouteFromLocation(): NavRoute {
  if (typeof window === 'undefined') return '/';
  const raw = window.location.pathname as NavRoute;
  return VALID_ROUTES.has(raw) ? raw : '/';
}

function AuthenticatedWorkspace() {
  const { user, loading, pushToast } = useAuth();
  const [route, setRoute] = useState<NavRoute>(readRouteFromLocation);
  const [refreshSignal, setRefreshSignal] = useState(0);

  const [habitModalOpen, setHabitModalOpen] = useState(false);
  const [habitModalStartDate, setHabitModalStartDate] = useState<string | null>(null);
  const [editingHabit, setEditingHabit] = useState<HabitRecord | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);

  useEffect(() => {
    const onPopState = () => {
      setRoute(readRouteFromLocation());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (next: NavRoute) => {
    if (window.location.pathname !== next) {
      window.history.pushState({}, '', next);
    }
    setRoute(next);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-canvas)] flex items-center justify-center">
        <div className="text-sm text-[var(--text-secondary)] font-mono-num">
          Loading workspace...
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  const userToday = getLocalDateInTimezone(new Date(), user.timezone);
  const bumpRefresh = () => setRefreshSignal((s) => s + 1);

  const openCreateHabitForDate = (targetDate?: string) => {
    setEditingHabit(null);
    setHabitModalStartDate(targetDate ?? null);
    setHabitModalOpen(true);
  };

  const openEditHabit = (habit: HabitRecord) => {
    setHabitModalStartDate(null);
    setEditingHabit(habit);
    setHabitModalOpen(true);
  };

  return (
    <>
      <Layout
        currentRoute={route}
        onNavigate={navigate}
        onQuickCreateHabit={() => openCreateHabitForDate()}
      >
        {route === '/' && (
          <DashboardPage
            refreshSignal={refreshSignal}
            onNavigate={navigate}
            onCreateHabit={() => openCreateHabitForDate()}
            onEditHabit={openEditHabit}
          />
        )}

        {route === '/habits' && (
          <DailyHabitsPage
            refreshSignal={refreshSignal}
            onCreateHabit={() => openCreateHabitForDate()}
            onEditHabit={openEditHabit}
          />
        )}

        {route === '/calendar' && (
          <CalendarPage
            refreshSignal={refreshSignal}
            onCreateHabitForDate={(date) => openCreateHabitForDate(date)}
            onEditHabit={openEditHabit}
          />
        )}
        {route === '/analytics' && <AnalyticsPage refreshSignal={refreshSignal} />}
        {route === '/goals' && <GoalsPage refreshSignal={refreshSignal} />}
        {route === '/weekly-review' && <WeeklyReviewPage refreshSignal={refreshSignal} />}
        {route === '/reports' && (
          <ReportsExportPage
            refreshSignal={refreshSignal}
            onOpenImportModal={() => setImportModalOpen(true)}
          />
        )}
        {route === '/notifications' && <NotificationsPage refreshSignal={refreshSignal} />}
        {route === '/settings' && <SettingsPage />}
        {route === '/profile' && <ProfilePage />}
      </Layout>

      <OnboardingModal
        onComplete={bumpRefresh}
        onOpenSpreadsheetImport={() => setImportModalOpen(true)}
      />

      <HabitFormModal
        open={habitModalOpen}
        defaultStartDate={habitModalStartDate ?? userToday}
        editingHabit={editingHabit}
        onClose={() => {
          setHabitModalOpen(false);
          setEditingHabit(null);
          setHabitModalStartDate(null);
        }}
        onSaved={(saved) => {
          bumpRefresh();
          pushToast({
            message: editingHabit ? `Updated "${saved.name}"` : `Created "${saved.name}"`,
          });
        }}
      />

      <SpreadsheetImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImported={(res) => {
          bumpRefresh();
          pushToast({
            message: `Imported ${res.createdHabits} habit(s) and ${res.importedLogs} log(s).`,
          });
        }}
      />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AuthenticatedWorkspace />
    </AuthProvider>
  );
}
