import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Flame,
  Layers,
  MessageSquare,
  Minus,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { formatScheduleSummary, HabitIcon } from '../components/HabitIcon.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { translateCategory, translatePriority, tx } from '../lib/i18n.ts';
import { HABIT_CATEGORIES } from '../shared/config.ts';
import { addDays } from '../shared/dates.ts';
import type {
  DaySummaryMetrics,
  EvaluatedHabitOccurrence,
  HabitRecord,
} from '../shared/types.ts';

interface HabitWithStreaks extends HabitRecord {
  currentStreak: number;
  longestStreak: number;
}

interface DailyHabitsPageProps {
  refreshSignal: number;
  onCreateHabit: () => void;
  onEditHabit: (habit: HabitRecord) => void;
}

export function DailyHabitsPage({
  refreshSignal,
  onCreateHabit,
  onEditHabit,
}: DailyHabitsPageProps) {
  const { language, pushToast } = useAuth();

  const [selectedDate, setSelectedDate] = useState<string>('');
  const [userToday, setUserToday] = useState<string>('');
  const [daySummary, setDaySummary] = useState<DaySummaryMetrics | null>(null);
  const [occurrences, setOccurrences] = useState<EvaluatedHabitOccurrence[]>([]);
  const [libraryHabits, setLibraryHabits] = useState<HabitWithStreaks[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [scheduleFilter, setScheduleFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'order' | 'priority' | 'name'>('order');

  const [noteOpenId, setNoteOpenId] = useState<number | null>(null);
  const [noteText, setNoteText] = useState('');
  const [deleteConfirmHabit, setDeleteConfirmHabit] = useState<HabitRecord | null>(null);

  const loadData = useCallback(
    async (dateOverride?: string) => {
      try {
        const dParam = dateOverride ? `?date=${encodeURIComponent(dateOverride)}` : '';
        const [dayRes, habitsRes] = await Promise.all([
          apiFetch<{
            date: string;
            userToday: string;
            summary: DaySummaryMetrics;
            occurrences: EvaluatedHabitOccurrence[];
          }>(`/api/tracking/day${dParam}`),
          apiFetch<{ habits: HabitWithStreaks[] }>('/api/habits?status=all'),
        ]);
        setSelectedDate(dayRes.date);
        setUserToday(dayRes.userToday);
        setDaySummary(dayRes.summary);
        setOccurrences(dayRes.occurrences);
        setLibraryHabits(habitsRes.habits);
      } catch (err: any) {
        pushToast({ message: err?.message || 'Failed to load habits.', tone: 'error' });
      } finally {
        setLoading(false);
      }
    },
    [pushToast]
  );

  useEffect(() => {
    void loadData(selectedDate || undefined);
  }, [loadData, refreshSignal]);

  const occMap = useMemo(() => {
    const m = new Map<number, EvaluatedHabitOccurrence>();
    for (const o of occurrences) {
      m.set(o.habit.id, o);
    }
    return m;
  }, [occurrences]);

  const filteredHabits = useMemo(() => {
    const priorityRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
    const q = searchQuery.trim().toLowerCase();

    return libraryHabits
      .filter((h) => {
        if (statusFilter === 'active' && h.status !== 'active') return false;
        if (statusFilter === 'archived' && h.status !== 'archived') return false;
        if (categoryFilter !== 'all' && h.category !== categoryFilter) return false;
        if (scheduleFilter !== 'all' && h.scheduleType !== scheduleFilter) return false;
        if (q && !h.name.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'priority') {
          const diff = (priorityRank[b.priority] ?? 0) - (priorityRank[a.priority] ?? 0);
          return diff !== 0 ? diff : a.name.localeCompare(b.name);
        }
        if (sortBy === 'name') {
          return a.name.localeCompare(b.name);
        }
        return a.displayOrder !== b.displayOrder ? a.displayOrder - b.displayOrder : a.id - b.id;
      });
  }, [libraryHabits, statusFilter, categoryFilter, scheduleFilter, searchQuery, sortBy]);

  const handleShiftDate = (delta: number) => {
    if (!selectedDate) return;
    const next = addDays(selectedDate, delta);
    setSelectedDate(next);
    void loadData(next);
  };

  const handleToggleCompletion = async (habit: HabitRecord, occ?: EvaluatedHabitOccurrence) => {
    if (!selectedDate || selectedDate > userToday) return;
    const currentlyCompleted = Boolean(occ?.isCompleted);

    try {
      if (habit.habitType === 'boolean') {
        await apiFetch(`/api/habits/${habit.id}/logs/${selectedDate}`, {
          method: 'PUT',
          body: JSON.stringify({
            completed: !currentlyCompleted,
            notes: occ?.log?.notes ?? null,
          }),
        });
      } else {
        const nextVal = currentlyCompleted ? 0 : habit.targetValue;
        await apiFetch(`/api/habits/${habit.id}/logs/${selectedDate}`, {
          method: 'PUT',
          body: JSON.stringify({
            numericValue: nextVal,
            durationSeconds:
              habit.habitType === 'duration'
                ? Math.round(nextVal * (habit.targetUnit === 'hours' ? 3600 : 60))
                : null,
            notes: occ?.log?.notes ?? null,
          }),
        });
      }
      await loadData(selectedDate);
    } catch (err: any) {
      pushToast({ message: err?.message || 'Unable to log habit.', tone: 'error' });
    }
  };

  const handleAdjustValue = async (
    habit: HabitRecord,
    occ: EvaluatedHabitOccurrence | undefined,
    nextVal: number
  ) => {
    if (!selectedDate || selectedDate > userToday) return;
    const clamped = Math.max(0, nextVal);
    try {
      await apiFetch(`/api/habits/${habit.id}/logs/${selectedDate}`, {
        method: 'PUT',
        body: JSON.stringify({
          numericValue: clamped,
          durationSeconds:
            habit.habitType === 'duration'
              ? Math.round(clamped * (habit.targetUnit === 'hours' ? 3600 : 60))
              : null,
          notes: occ?.log?.notes ?? null,
        }),
      });
      await loadData(selectedDate);
    } catch (err: any) {
      pushToast({ message: err?.message || 'Failed to update value.', tone: 'error' });
    }
  };

  const handleSaveNote = async (habit: HabitRecord, occ?: EvaluatedHabitOccurrence) => {
    if (!selectedDate || selectedDate > userToday) return;
    try {
      await apiFetch(`/api/habits/${habit.id}/logs/${selectedDate}`, {
        method: 'PUT',
        body: JSON.stringify({
          completed: Boolean(occ?.isCompleted),
          numericValue: occ?.log?.numericValue ?? null,
          durationSeconds: occ?.log?.durationSeconds ?? null,
          notes: noteText.trim() || null,
        }),
      });
      setNoteOpenId(null);
      await loadData(selectedDate);
      pushToast({ message: 'Saved daily note.' });
    } catch (err: any) {
      pushToast({ message: err?.message || 'Failed to save note.', tone: 'error' });
    }
  };

  const handleArchiveToggle = async (habit: HabitRecord) => {
    const restore = habit.status === 'archived';
    try {
      await apiFetch(`/api/habits/${habit.id}/archive`, {
        method: 'POST',
        body: JSON.stringify({ restore }),
      });
      await loadData(selectedDate);
      pushToast({
        message: restore ? `Restored "${habit.name}"` : `Archived "${habit.name}" (history preserved)`,
        undoLabel: 'Undo',
        onUndo: async () => {
          await apiFetch(`/api/habits/${habit.id}/archive`, {
            method: 'POST',
            body: JSON.stringify({ restore: !restore }),
          });
          await loadData(selectedDate);
        },
      });
    } catch (err: any) {
      pushToast({ message: err?.message || 'Failed to update status.', tone: 'error' });
    }
  };

  const handleReorder = async (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= filteredHabits.length) return;
    const a = filteredHabits[index];
    const b = filteredHabits[targetIdx];
    try {
      await Promise.all([
        apiFetch(`/api/habits/${a.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ displayOrder: targetIdx }),
        }),
        apiFetch(`/api/habits/${b.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ displayOrder: index }),
        }),
      ]);
      await loadData(selectedDate);
    } catch {
      pushToast({ message: 'Could not reorder habits.', tone: 'error' });
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!deleteConfirmHabit) return;
    try {
      await apiFetch(`/api/habits/${deleteConfirmHabit.id}`, {
        method: 'DELETE',
      });
      setDeleteConfirmHabit(null);
      await loadData(selectedDate);
      pushToast({ message: `Deleted "${deleteConfirmHabit.name}".` });
    } catch (err: any) {
      pushToast({ message: err?.message || 'Failed to delete habit.', tone: 'error' });
    }
  };

  const handleAddStarterPack = async () => {
    try {
      const res = await apiFetch<{ createdCount: number }>('/api/habits/starter', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await loadData(selectedDate);
      pushToast({ message: `Added ${res.createdCount} starter routine habits.` });
    } catch (err: any) {
      pushToast({ message: err?.message || 'Failed to add starter routine.', tone: 'error' });
    }
  };

  const isFutureDate = Boolean(selectedDate && userToday && selectedDate > userToday);

  return (
    <div className="space-y-6">
      {/* Date Navigation & Daily Completion Strip */}
      <section className="p-4 sm:p-5 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleShiftDate(-1)}
            aria-label="Previous day"
            className="p-2 rounded-lg bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <input
            type="date"
            aria-label="Selected tracking date"
            value={selectedDate}
            onChange={(e) => {
              if (e.target.value) {
                setSelectedDate(e.target.value);
                void loadData(e.target.value);
              }
            }}
            className="px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm font-mono-num text-[var(--text-primary)]"
          />

          <button
            type="button"
            onClick={() => handleShiftDate(1)}
            aria-label="Next day"
            className="p-2 rounded-lg bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          {selectedDate !== userToday && userToday && (
            <button
              type="button"
              onClick={() => {
                setSelectedDate(userToday);
                void loadData(userToday);
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--bg-surface)] text-[var(--accent-lime)] hover:bg-[var(--bg-surface-hover)]"
            >
              {tx(language, 'Today', 'আজ')}
            </button>
          )}
        </div>

        {daySummary && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)] font-mono-num">
            <span>
              {tx(language, 'Scheduled:', 'নির্ধারিত:')}{' '}
              <strong className="text-[var(--text-primary)]">{daySummary.eligibleCount}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {tx(language, 'Completed:', 'সম্পন্ন:')}{' '}
              <strong className="text-[var(--accent-lime)]">{daySummary.completedCount}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {tx(language, 'Rate:', 'হার:')}{' '}
              <strong className="text-[var(--text-primary)]">
                {daySummary.hasEligibleHabits ? `${daySummary.overallCompletionRate}%` : '—'}
              </strong>
            </span>
          </div>
        )}
      </section>

      {/* Filter, Search & Sort Toolbar */}
      <section className="p-4 sm:p-5 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative lg:col-span-2">
            <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={tx(language, 'Search habits by name...', 'নাম দিয়ে হ্যাবিট খুঁজুন...')}
              aria-label="Search habits"
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
          </div>

          <select
            aria-label="Filter by category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs sm:text-sm text-[var(--text-primary)]"
          >
            <option value="all">{tx(language, 'All categories', 'সব ক্যাটাগরি')}</option>
            {HABIT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {translateCategory(c, language)}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by schedule"
            value={scheduleFilter}
            onChange={(e) => setScheduleFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs sm:text-sm text-[var(--text-primary)]"
          >
            <option value="all">{tx(language, 'All schedules', 'সব সময়সূচি')}</option>
            <option value="daily">{tx(language, 'Daily', 'প্রতিদিন')}</option>
            <option value="weekdays">{tx(language, 'Weekdays', 'সোম–শুক্র')}</option>
            <option value="weekends">{tx(language, 'Weekends', 'সপ্তাহান্তে')}</option>
            <option value="custom_days">{tx(language, 'Custom weekdays', 'নির্বাচিত বার')}</option>
          </select>

          <select
            aria-label="Sort habits"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'order' | 'priority' | 'name')}
            className="px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs sm:text-sm text-[var(--text-primary)]"
          >
            <option value="order">{tx(language, 'Sort: Custom order', 'সাজান: নিজস্ব ক্রম')}</option>
            <option value="priority">{tx(language, 'Sort: Priority', 'সাজান: অগ্রাধিকার')}</option>
            <option value="name">{tx(language, 'Sort: Name (A–Z)', 'সাজান: নাম')}</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {/* Interactive Status Filter Tabs */}
          <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
            {(
              [
                { id: 'active', en: 'Active', bn: 'সক্রিয়' },
                { id: 'archived', en: 'Archived', bn: 'আর্কাইভ' },
                { id: 'all', en: 'All', bn: 'সব' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  statusFilter === tab.id
                    ? 'bg-[var(--bg-panel)] text-[var(--text-primary)] font-semibold'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {tx(language, tab.en, tab.bn)}
              </button>
            ))}
          </div>

          {libraryHabits.length === 0 && (
            <button
              type="button"
              onClick={() => void handleAddStarterPack()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)]"
            >
              <Layers className="w-3.5 h-3.5 text-[var(--accent-lime)]" />
              <span>{tx(language, 'Load 10 Starter Habits', '১০টি স্টার্টার হ্যাবিট যোগ করুন')}</span>
            </button>
          )}
        </div>
      </section>

      {/* Habits List */}
      <section className="rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)]">
        {loading ? (
          <div className="p-8 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 rounded-lg bg-[var(--bg-surface)] animate-pulse" />
            ))}
          </div>
        ) : filteredHabits.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <p className="text-sm text-[var(--text-secondary)]">
              {tx(
                language,
                'No habits match your current filter criteria.',
                'আপনার বর্তমান ফিল্টার অনুযায়ী কোনো হ্যাবিট পাওয়া যায়নি।'
              )}
            </p>
            <button
              type="button"
              onClick={onCreateHabit}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-[var(--accent-lime)] text-[var(--accent-ink)]"
            >
              {tx(language, 'Create Habit', 'হ্যাবিট তৈরি করুন')}
            </button>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-subtle)]">
            {filteredHabits.map((habit, idx) => {
              const occ = occMap.get(habit.id);
              const isScheduledToday = Boolean(occ?.isScheduled);
              const isDone = Boolean(occ?.isCompleted);
              const isNoteEditing = noteOpenId === habit.id;

              return (
                <div key={habit.id} className="p-4 sm:px-6 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                      <button
                        type="button"
                        disabled={!isScheduledToday || isFutureDate || habit.status === 'archived'}
                        onClick={() => void handleToggleCompletion(habit, occ)}
                        aria-label={
                          isDone ? `Undo ${habit.name} on ${selectedDate}` : `Complete ${habit.name} on ${selectedDate}`
                        }
                        className={`w-10 h-10 rounded-lg flex items-center justify-center border transition-colors shrink-0 ${
                          isDone
                            ? 'bg-[var(--accent-lime)] border-transparent text-[var(--accent-ink)]'
                            : isScheduledToday && !isFutureDate
                            ? 'bg-[var(--bg-surface)] border-[var(--border-strong)] text-[var(--text-secondary)] hover:border-[var(--accent-lime)]'
                            : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-muted)] opacity-45 cursor-not-allowed'
                        }`}
                      >
                        {isDone ? (
                          <Check className="w-5 h-5 stroke-[2.5]" />
                        ) : (
                          <HabitIcon name={habit.icon} className="w-4 h-4" />
                        )}
                      </button>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3
                            className={`text-sm font-semibold truncate ${
                              isDone
                                ? 'line-through text-[var(--text-secondary)]'
                                : 'text-[var(--text-primary)]'
                            }`}
                          >
                            {habit.name}
                          </h3>
                        </div>

                        {habit.description && (
                          <p className="text-xs text-[var(--text-secondary)] truncate mt-0.5">
                            {habit.description}
                          </p>
                        )}

                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-secondary)] mt-1">
                          <span>{translateCategory(habit.category, language)}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {formatScheduleSummary(
                              habit.scheduleType,
                              habit.scheduleConfig?.daysOfWeek,
                              language
                            )}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="capitalize">
                            {translatePriority(habit.priority, language)}
                          </span>
                          {habit.habitType !== 'boolean' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono-num">
                                {tx(language, 'Target:', 'লক্ষ্য:')} {habit.targetValue}{' '}
                                {habit.targetUnit || ''}
                              </span>
                            </>
                          )}
                          {habit.status === 'archived' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-[var(--status-warning)]">
                                {tx(language, 'Archived', 'আর্কাইভ')}
                              </span>
                            </>
                          )}
                          {!isScheduledToday && habit.status === 'active' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-[var(--text-muted)]">
                                {tx(
                                  language,
                                  `Not scheduled on ${selectedDate}`,
                                  `${selectedDate} তারিখে নির্ধারিত নয়`
                                )}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Action Controls */}
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end shrink-0">
                      {habit.habitType !== 'boolean' && isScheduledToday && !isFutureDate && (
                        <div className="flex items-center gap-1 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-2 py-1">
                          <button
                            type="button"
                            aria-label={`Decrease ${habit.name}`}
                            onClick={() =>
                              void handleAdjustValue(
                                habit,
                                occ,
                                (occ?.currentValue ?? 0) - (habit.habitType === 'duration' ? 5 : 1)
                              )
                            }
                            className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <input
                            type="number"
                            min={0}
                            step="any"
                            aria-label={`${habit.name} logged value`}
                            value={occ?.currentValue ?? 0}
                            onChange={(e) =>
                              void handleAdjustValue(habit, occ, Number(e.target.value))
                            }
                            className="w-14 text-center bg-transparent text-xs font-mono-num text-[var(--text-primary)]"
                          />
                          <span className="text-xs text-[var(--text-secondary)] font-mono-num">
                            /{habit.targetValue}
                          </span>
                          <button
                            type="button"
                            aria-label={`Increase ${habit.name}`}
                            onClick={() =>
                              void handleAdjustValue(
                                habit,
                                occ,
                                (occ?.currentValue ?? 0) + (habit.habitType === 'duration' ? 5 : 1)
                              )
                            }
                            className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}

                      <span className="inline-flex items-center gap-1 text-xs font-mono-num text-[var(--text-secondary)] px-1.5">
                        <Flame className="w-3.5 h-3.5 text-[var(--accent-lime)]" />
                        {habit.currentStreak}d (Best {habit.longestStreak}d)
                      </span>

                      {sortBy === 'order' && (
                        <div className="hidden md:flex items-center">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => void handleReorder(idx, -1)}
                            aria-label={`Move ${habit.name} up`}
                            className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === filteredHabits.length - 1}
                            onClick={() => void handleReorder(idx, 1)}
                            aria-label={`Move ${habit.name} down`}
                            className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}

                      {!isFutureDate && (
                        <button
                          type="button"
                          onClick={() => {
                            if (isNoteEditing) {
                              setNoteOpenId(null);
                            } else {
                              setNoteOpenId(habit.id);
                              setNoteText(occ?.log?.notes || '');
                            }
                          }}
                          aria-label={`Daily note for ${habit.name}`}
                          className={`p-2 rounded-lg transition-colors ${
                            occ?.log?.notes
                              ? 'text-[var(--accent-lime)] bg-[var(--bg-surface)]'
                              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'
                          }`}
                        >
                          <MessageSquare className="w-4 h-4" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onEditHabit(habit)}
                        aria-label={`Edit ${habit.name}`}
                        className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleArchiveToggle(habit)}
                        aria-label={habit.status === 'archived' ? `Restore ${habit.name}` : `Archive ${habit.name}`}
                        className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
                      >
                        {habit.status === 'archived' ? (
                          <ArchiveRestore className="w-4 h-4" />
                        ) : (
                          <Archive className="w-4 h-4" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => setDeleteConfirmHabit(habit)}
                        aria-label={`Delete ${habit.name}`}
                        className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-[#F87171] hover:bg-[var(--bg-surface)]"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {isNoteEditing && (
                    <div className="sm:pl-13 flex items-center gap-2">
                      <input
                        type="text"
                        maxLength={1000}
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder={tx(
                          language,
                          `Add note for ${selectedDate}...`,
                          `${selectedDate} তারিখের নোট লিখুন...`
                        )}
                        className="flex-1 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                      />
                      <button
                        type="button"
                        onClick={() => void handleSaveNote(habit, occ)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--accent-lime)] text-[var(--accent-ink)]"
                      >
                        {tx(language, 'Save Note', 'নোট সংরক্ষণ')}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Delete Confirmation Modal */}
      {deleteConfirmHabit && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-habit-title"
        >
          <div className="w-full max-w-md bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-xl p-6 space-y-4">
            <h2 id="delete-habit-title" className="text-base font-semibold text-[var(--text-primary)]">
              {tx(
                language,
                `Permanently delete "${deleteConfirmHabit.name}"?`,
                `"${deleteConfirmHabit.name}" হ্যাবিটটি স্থায়ীভাবে মুছবেন?`
              )}
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">
              {tx(
                language,
                'Deleting removes this habit and all of its historical completion logs. To stop scheduling a habit while preserving past history, archive it instead.',
                'মুছে ফেললে এই হ্যাবিট এবং এর পূর্ববর্তী সকল লগ মুছে যাবে। ইতিহাস রেখে বন্ধ করতে চাইলে আর্কাইভ করুন।'
              )}
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmHabit(null)}
                className="px-4 py-2 rounded-lg text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                {tx(language, 'Cancel', 'বাতিল')}
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteConfirmed()}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#DC2626] text-white hover:bg-[#B91C1C]"
              >
                {tx(language, 'Delete Permanently', 'স্থায়ীভাবে মুছুন')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
