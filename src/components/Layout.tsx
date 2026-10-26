import React, { useState } from 'react';
import {
  BarChart3,
  Bell,
  CalendarDays,
  CheckSquare,
  ClipboardCheck,
  FileDown,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Target,
  User,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { tx } from '../lib/i18n.ts';
import { getAppName } from '../shared/config.ts';
import { getLocalDateInTimezone } from '../shared/dates.ts';
import { LanguageSwitcher } from './LanguageSwitcher.tsx';
import { UserAvatar } from './UserAvatar.tsx';

export type NavRoute =
  | '/'
  | '/habits'
  | '/calendar'
  | '/analytics'
  | '/goals'
  | '/weekly-review'
  | '/reports'
  | '/notifications'
  | '/settings'
  | '/profile';

interface NavItem {
  path: NavRoute;
  enLabel: string;
  bnLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/', enLabel: 'Dashboard', bnLabel: 'ড্যাশবোর্ড', icon: LayoutDashboard },
  { path: '/habits', enLabel: 'Daily Habits', bnLabel: 'দৈনিক হ্যাবিট', icon: CheckSquare },
  { path: '/calendar', enLabel: 'Calendar', bnLabel: 'ক্যালেন্ডার', icon: CalendarDays },
  { path: '/analytics', enLabel: 'Analytics', bnLabel: 'অ্যানালিটিক্স', icon: BarChart3 },
  { path: '/goals', enLabel: 'Goals', bnLabel: 'লক্ষ্যসমূহ', icon: Target },
  { path: '/weekly-review', enLabel: 'Weekly Review', bnLabel: 'সাপ্তাহিক রিভিউ', icon: ClipboardCheck },
  { path: '/reports', enLabel: 'Reports & Export', bnLabel: 'রিপোর্ট ও এক্সপোর্ট', icon: FileDown },
  { path: '/notifications', enLabel: 'Notifications', bnLabel: 'নোটিফিকেশন', icon: Bell },
  { path: '/settings', enLabel: 'Settings', bnLabel: 'সেটিংস', icon: Settings },
  { path: '/profile', enLabel: 'Profile', bnLabel: 'প্রোফাইল', icon: User },
];

interface LayoutProps {
  currentRoute: NavRoute;
  onNavigate: (route: NavRoute) => void;
  onQuickCreateHabit: () => void;
  children: React.ReactNode;
}

export function Layout({
  currentRoute,
  onNavigate,
  onQuickCreateHabit,
  children,
}: LayoutProps) {
  const { user, language, unreadNotifications, logout, toasts, dismissToast } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const appName = getAppName();
  const activeNav = NAV_ITEMS.find((i) => i.path === currentRoute) || NAV_ITEMS[0];
  const activeNavLabel = tx(language, activeNav.enLabel, activeNav.bnLabel);
  const userToday = user ? getLocalDateInTimezone(new Date(), user.timezone) : '';

  const handleNavClick = (route: NavRoute) => {
    onNavigate(route);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen flex bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      {/* Desktop Sidebar */}
      <aside
        aria-label="Primary Sidebar"
        className={`hidden lg:flex flex-col shrink-0 bg-[var(--bg-panel)] border-r border-[var(--border-subtle)] transition-[width] duration-200 ${
          sidebarCollapsed ? 'w-18' : 'w-64'
        }`}
      >
        <div className="h-16 px-4 flex items-center justify-between border-b border-[var(--border-subtle)]">
          {!sidebarCollapsed && (
            <button
              type="button"
              onClick={() => handleNavClick('/')}
              className="text-lg font-bold font-display tracking-tight text-[var(--text-primary)] whitespace-nowrap shrink-0"
            >
              {appName}
            </button>
          )}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        </div>

        <nav className="flex-1 py-4 px-2.5 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = currentRoute === item.path;
            const showBadge = item.path === '/notifications' && unreadNotifications > 0;
            const itemLabel = tx(language, item.enLabel, item.bnLabel);
            return (
              <button
                key={item.path}
                type="button"
                onClick={() => handleNavClick(item.path)}
                title={sidebarCollapsed ? itemLabel : undefined}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[var(--bg-surface)] text-[var(--accent-lime)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" />
                  {!sidebarCollapsed && <span className="truncate">{itemLabel}</span>}
                </span>
                {!sidebarCollapsed && showBadge && (
                  <span className="text-xs font-mono-num text-[var(--accent-lime)]">
                    {unreadNotifications}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-[var(--border-subtle)]">
          {user && (
            <button
              type="button"
              onClick={() => handleNavClick('/profile')}
              title={sidebarCollapsed ? user.name : undefined}
              className={`w-full flex items-center gap-2.5 px-2 pb-2.5 mb-2 border-b border-[var(--border-subtle)] text-left hover:opacity-90 transition-opacity ${
                sidebarCollapsed ? 'justify-center' : ''
              }`}
            >
              <UserAvatar
                name={user.name}
                avatarUrl={user.avatarUrl}
                sizeClass="w-8 h-8 rounded-lg"
                textClass="text-xs"
              />
              {!sidebarCollapsed && (
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-[var(--text-primary)] truncate">
                    {user.name}
                  </p>
                  <p className="text-xs text-[var(--text-secondary)] truncate">{user.timezone}</p>
                </div>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => void logout()}
            title={sidebarCollapsed ? tx(language, 'Log out', 'লগ আউট') : undefined}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-[var(--text-secondary)] hover:text-[#F87171] hover:bg-[var(--bg-surface)] transition-colors whitespace-nowrap"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {!sidebarCollapsed && <span>{tx(language, 'Log out', 'লগ আউট')}</span>}
          </button>
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-72 max-w-[85vw] bg-[var(--bg-panel)] border-r border-[var(--border-subtle)] flex flex-col">
            <div className="h-14 px-4 flex items-center justify-between border-b border-[var(--border-subtle)]">
              <span className="text-base font-bold font-display text-[var(--text-primary)]">
                {appName}
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation menu"
                className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <nav className="flex-1 py-3 px-3 space-y-1 overflow-y-auto">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = currentRoute === item.path;
                const itemLabel = tx(language, item.enLabel, item.bnLabel);
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => handleNavClick(item.path)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium ${
                      active
                        ? 'bg-[var(--bg-surface)] text-[var(--accent-lime)]'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <Icon className="w-4 h-4" />
                      <span>{itemLabel}</span>
                    </span>
                    {item.path === '/notifications' && unreadNotifications > 0 && (
                      <span className="text-xs font-mono-num text-[var(--accent-lime)]">
                        {unreadNotifications}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            <div className="p-3 border-t border-[var(--border-subtle)]">
              {user && (
                <button
                  type="button"
                  onClick={() => handleNavClick('/profile')}
                  className="w-full flex items-center gap-2.5 px-3 pb-2.5 mb-2 border-b border-[var(--border-subtle)] text-left"
                >
                  <UserAvatar
                    name={user.name}
                    avatarUrl={user.avatarUrl}
                    sizeClass="w-8 h-8 rounded-lg"
                    textClass="text-xs"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-[var(--text-primary)] truncate">
                      {user.name}
                    </p>
                    <p className="text-xs text-[var(--text-secondary)] truncate">{user.timezone}</p>
                  </div>
                </button>
              )}
              <button
                type="button"
                onClick={() => void logout()}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-[var(--text-secondary)] hover:text-[#F87171]"
              >
                <LogOut className="w-4 h-4" />
                <span>{tx(language, 'Log out', 'লগ আউট')}</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Clean 3-Zone Top Header */}
        <header className="h-14 lg:h-16 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-8 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] sticky top-0 z-30">
          {/* Zone 1: Context / Mobile Trigger */}
          <div className="flex items-center gap-3 min-w-0 shrink-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 -ml-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-base sm:text-lg font-semibold font-display text-[var(--text-primary)] whitespace-nowrap truncate">
              {activeNavLabel}
            </h1>
          </div>

          {/* Zone 2: Clean Inline Date & Timezone Context */}
          <div className="hidden md:flex items-center gap-2 text-xs text-[var(--text-secondary)] whitespace-nowrap shrink-0">
            <span className="font-mono-num">{userToday}</span>
            <span aria-hidden="true">·</span>
            <span>{user?.timezone}</span>
          </div>

          {/* Zone 3: Language Switcher + Primary Action */}
          <div className="flex items-center gap-2.5 shrink-0">
            <LanguageSwitcher />
            <button
              type="button"
              onClick={onQuickCreateHabit}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold bg-[var(--accent-lime)] text-[var(--accent-ink)] hover:bg-[var(--accent-lime-hover)] transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>{tx(language, 'New Habit', 'নতুন হ্যাবিট')}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1380px] w-full mx-auto">
          {children}
        </main>
      </div>

      {/* Reversible Action & Feedback Toasts */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="fixed bottom-4 right-4 z-[70] flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)]"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-strong)] shadow-lg text-sm"
            >
              <span
                className={
                  t.tone === 'error'
                    ? 'text-[#F87171]'
                    : 'text-[var(--text-primary)]'
                }
              >
                {t.message}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                {t.onUndo && (
                  <button
                    type="button"
                    onClick={() => {
                      void t.onUndo?.();
                      dismissToast(t.id);
                    }}
                    className="text-xs font-semibold text-[var(--accent-lime)] hover:underline whitespace-nowrap"
                  >
                    {t.undoLabel || tx(language, 'Undo', 'পূর্বাবস্থায় ফিরুন')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => dismissToast(t.id)}
                  aria-label="Dismiss notification"
                  className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
