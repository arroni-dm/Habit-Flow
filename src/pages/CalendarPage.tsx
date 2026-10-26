import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Grid,
  Pencil,
  Plus,
  Table as TableIcon,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { translateCategory, tx } from '../lib/i18n.ts';
import { buildLogsLookup, classifyOccurrence } from '../shared/calculations.ts';
import {
  getDayOfWeek,
  getLocalDateInTimezone,
  getMonthDateRange,
  parseIsoDate,
} from '../shared/dates.ts';
import type {
  DaySummaryMetrics,
  HabitLogRecord,
  HabitRecord,
  WeekGroupSummary,
} from '../shared/types.ts';

interface RangeResponse {
  startDate: string;
  endDate: string;
  userToday: string;
  habits: HabitRecord[];
  logs: HabitLogRecord[];
  metrics: {
    totalScheduled: number;
    eligibleToDate: number;
    completedCount: number;
    pendingCount: number;
    missedCount: number;
    completionRate: number;
    dailySummaries: DaySummaryMetrics[];
  };
  weekGroups: WeekGroupSummary[];
}

interface CalendarPageProps {
  refreshSignal: number;
  onCreateHabitForDate: (date: string) => void;
  onEditHabit: (habit: HabitRecord) => void;
}

export function CalendarPage({
  refreshSignal,
  onCreateHabitForDate,
  onEditHabit,
}: CalendarPageProps) {
  const { user, language, pushToast } = useAuth();
  const initialToday = user ? getLocalDateInTimezone(new Date(), user.timezone) : '2026-10-25';
  const parsedInit = parseIsoDate(initialToday);

  const [year, setYear] = useState(parsedInit.year);
  const [month, setMonth] = useState(parsedInit.month);
  const [viewMode, setViewMode] = useState<'matrix' | 'heatmap'>('matrix');
  const [data, setData] = useState<RangeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDayDetail, setSelectedDayDetail] = useState<string | null>(null);

  const monthRange = useMemo(() => getMonthDateRange(year, month), [year, month]);

  const loadMonth = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<RangeResponse>(
        `/api/tracking/range?start=${monthRange.startDate}&end=${monthRange.endDate}&year=${year}&month=${month}`
      );
      setData(res);
    } catch (err: any) {
      pushToast({
        message: err?.message || tx(language, 'Failed to load calendar.', 'ক্যালেন্ডার লোড করা যায়নি।'),
        tone: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [monthRange.startDate, monthRange.endDate, year, month, pushToast, language]);

  useEffect(() => {
    void loadMonth();
  }, [loadMonth, refreshSignal]);

  const shiftMonth = (delta: number) => {
    const d = new Date(Date.UTC(year, month - 1 + delta, 1));
    setYear(d.getUTCFullYear());
    setMonth(d.getUTCMonth() + 1);
    setSelectedDayDetail(null);
  };

  const jumpToCurrentMonth = () => {
    if (!data) return;
    const p = parseIsoDate(data.userToday);
    setYear(p.year);
    setMonth(p.month);
    setSelectedDayDetail(data.userToday);
  };

  const logsLookup = useMemo(() => buildLogsLookup(data?.logs ?? []), [data]);

  const handleToggleCell = async (habit: HabitRecord, date: string, currentlyCompleted: boolean) => {
    if (!data || date > data.userToday) return;
    try {
      const body =
        habit.habitType === 'boolean'
          ? { completed: !currentlyCompleted }
          : {
              numericValue: currentlyCompleted ? 0 : habit.targetValue,
              durationSeconds:
                habit.habitType === 'duration'
                  ? Math.round(
                      (currentlyCompleted ? 0 : habit.targetValue) *
                        (habit.targetUnit === 'hours' ? 3600 : 60)
                    )
                  : null,
            };

      await apiFetch(`/api/habits/${habit.id}/logs/${date}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      await loadMonth();
    } catch (err: any) {
      pushToast({
        message: err?.message || tx(language, 'Failed to update entry.', 'এন্ট্রি আপডেট করা যায়নি।'),
        tone: 'error',
      });
    }
  };

  const monthTitle = new Intl.DateTimeFormat(language === 'bn' ? 'bn-BD' : 'en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));

  const weekStart = user?.weekStartPreference ?? 1;
  const orderedWeekdayHeaders = useMemo(() => {
    const names =
      language === 'bn'
        ? ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র', 'শনি']
        : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return Array.from({ length: 7 }, (_, i) => names[(weekStart + i) % 7]);
  }, [weekStart, language]);

  const leadingBlankCount = useMemo(() => {
    const firstDow = getDayOfWeek(monthRange.startDate);
    return (firstDow - weekStart + 7) % 7;
  }, [monthRange.startDate, weekStart]);

  const heatmapBgClass = (summary: DaySummaryMetrics, userToday: string) => {
    if (summary.date > userToday) {
      return summary.eligibleCount > 0
        ? 'bg-[var(--bg-surface-hover)] text-[var(--text-primary)]'
        : 'bg-[var(--bg-surface)] text-[var(--text-muted)]';
    }
    if (!summary.hasEligibleHabits) {
      return 'bg-[var(--bg-surface)] text-[var(--text-muted)]';
    }
    if (summary.overallCompletionRate >= 90) {
      return 'bg-[#C6FF00] text-[#0B0D0B] font-semibold';
    }
    if (summary.overallCompletionRate >= 60) {
      return 'bg-[#6F8F00] text-[#F5F7F2]';
    }
    if (summary.overallCompletionRate > 0) {
      return 'bg-[#36440A] text-[#F5F7F2]';
    }
    return 'bg-[var(--bg-surface)] text-[var(--text-secondary)]';
  };

  const selectedDateScheduledEntries = useMemo(() => {
    if (!selectedDayDetail || !data) return [];
    return data.habits
      .map((habit) => ({
        habit,
        occ: classifyOccurrence(
          habit,
          selectedDayDetail,
          logsLookup.get(`${habit.id}:${selectedDayDetail}`),
          data.userToday
        ),
      }))
      .filter((entry) => entry.occ.isScheduled);
  }, [selectedDayDetail, data, logsLookup]);

  const canAddHabitOnSelectedDate = Boolean(
    selectedDayDetail && data && selectedDayDetail >= data.userToday
  );

  return (
    <div className="space-y-6">
      {/* Month Navigation & View Switcher */}
      <section className="p-4 sm:p-5 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            aria-label="Previous month"
            className="p-2 rounded-lg bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <h2 className="text-base sm:text-lg font-semibold font-display text-[var(--text-primary)] min-w-40 text-center">
            {monthTitle}
          </h2>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            aria-label="Next month"
            className="p-2 rounded-lg bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={jumpToCurrentMonth}
            className="ml-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--bg-surface)] text-[var(--accent-lime)] hover:bg-[var(--bg-surface-hover)] whitespace-nowrap shrink-0"
          >
            {tx(language, 'Current Month', 'চলতি মাস')}
          </button>
        </div>

        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setViewMode('matrix')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 ${
              viewMode === 'matrix'
                ? 'bg-[var(--bg-panel)] text-[var(--text-primary)] font-semibold'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <TableIcon className="w-3.5 h-3.5" />
            <span>{tx(language, 'Spreadsheet Matrix', 'স্প্রেডশিট ম্যাট্রিক্স')}</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('heatmap')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 ${
              viewMode === 'heatmap'
                ? 'bg-[var(--bg-panel)] text-[var(--text-primary)] font-semibold'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Grid className="w-3.5 h-3.5" />
            <span>{tx(language, 'Monthly Heatmap', 'মাসিক হিটম্যাপ')}</span>
          </button>
        </div>
      </section>

      {/* Week #1 through Week #5 Breakdown Strip */}
      {data && (
        <section
          aria-label="Monthly weekly groupings"
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3"
        >
          {data.weekGroups.map((wg) => (
            <div
              key={wg.weekNumber}
              className="p-4 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] flex flex-col justify-between"
            >
              <div>
                <p className="text-xs font-semibold text-[var(--text-primary)]">
                  {language === 'bn' ? `সপ্তাহ #${wg.weekNumber}` : wg.label}
                </p>
                <p className="text-[11px] font-mono-num text-[var(--text-secondary)] mt-0.5">
                  {wg.startDate.slice(5)} – {wg.endDate.slice(5)}
                </p>
              </div>
              <div className="mt-3 flex items-baseline justify-between">
                <span className="text-lg font-bold font-mono-num text-[var(--accent-lime)]">
                  {wg.eligibleCount > 0 ? `${wg.completionRate}%` : '—'}
                </span>
                <span className="text-xs font-mono-num text-[var(--text-secondary)]">
                  {wg.completedCount}/{wg.eligibleCount}
                </span>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Main Calendar View */}
      {loading || !data ? (
        <div className="h-80 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] animate-pulse" />
      ) : viewMode === 'matrix' ? (
        <section className="rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <p className="text-xs text-[var(--text-secondary)]">
              {tx(
                language,
                'Click any date column number to inspect entries or schedule a new habit on today or a future date.',
                'যেকোনো তারিখের সংখ্যার উপর ক্লিক করে এন্ট্রি দেখুন অথবা আজ ও ভবিষ্যতের তারিখে নতুন হ্যাবিট যোগ করুন।'
              )}
            </p>
            {canAddHabitOnSelectedDate && selectedDayDetail && (
              <button
                type="button"
                onClick={() => onCreateHabitForDate(selectedDayDetail)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--accent-lime)] text-[var(--accent-ink)] hover:bg-[var(--accent-lime-hover)] transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
              >
                <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>
                  {tx(
                    language,
                    `Add Habit on ${selectedDayDetail}`,
                    `${selectedDayDetail} তারিখে হ্যাবিট যোগ করুন`
                  )}
                </span>
              </button>
            )}
          </div>

          {data.habits.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <p className="text-sm text-[var(--text-secondary)]">
                {tx(
                  language,
                  'No habits exist yet. Select today or any future date to schedule your first habit.',
                  'এখনো কোনো হ্যাবিট তৈরি করা হয়নি। আজ বা ভবিষ্যতের যেকোনো তারিখ নির্বাচন করে প্রথম হ্যাবিট যোগ করুন।'
                )}
              </p>
              <button
                type="button"
                onClick={() =>
                  onCreateHabitForDate(
                    selectedDayDetail && selectedDayDetail >= data.userToday
                      ? selectedDayDetail
                      : data.userToday
                  )
                }
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[var(--accent-lime)] text-[var(--accent-ink)] hover:bg-[var(--accent-lime-hover)] transition-colors whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>
                  {tx(
                    language,
                    `Add Habit on ${
                      selectedDayDetail && selectedDayDetail >= data.userToday
                        ? selectedDayDetail
                        : data.userToday
                    }`,
                    `${
                      selectedDayDetail && selectedDayDetail >= data.userToday
                        ? selectedDayDetail
                        : data.userToday
                    } তারিখে হ্যাবিট যোগ করুন`
                  )}
                </span>
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] text-xs text-[var(--text-secondary)]">
                    <th className="sticky left-0 z-10 bg-[var(--bg-surface)] py-3 px-4 font-semibold min-w-52 border-r border-[var(--border-subtle)]">
                      {tx(
                        language,
                        `Habit (${monthRange.dates.length} days)`,
                        `হ্যাবিট (${monthRange.dates.length} দিন)`
                      )}
                    </th>
                    {monthRange.dates.map((d) => {
                      const dayNum = d.slice(8);
                      const isToday = d === data.userToday;
                      const isSelected = selectedDayDetail === d;
                      return (
                        <th
                          key={d}
                          className={`py-2 px-1 text-center font-mono-num min-w-8 ${
                            isToday ? 'text-[var(--accent-lime)] font-bold' : ''
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedDayDetail(d)}
                            title={
                              d >= data.userToday
                                ? `Inspect or add habit on ${d}`
                                : `Inspect ${d}`
                            }
                            className={`w-6 h-6 rounded inline-flex items-center justify-center transition-colors ${
                              isSelected
                                ? 'bg-[var(--text-primary)] text-[var(--bg-panel)] font-semibold'
                                : 'hover:bg-[var(--bg-surface-hover)] hover:underline'
                            }`}
                          >
                            {dayNum}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)] text-xs">
                  {data.habits.map((habit) => (
                    <tr key={habit.id} className="hover:bg-[var(--bg-surface)]/40">
                      <td className="sticky left-0 z-10 bg-[var(--bg-panel)] py-2.5 px-4 font-medium text-[var(--text-primary)] border-r border-[var(--border-subtle)] truncate max-w-60">
                        <span>{habit.name}</span>
                        {habit.status === 'archived' && (
                          <span className="ml-1.5 text-[11px] text-[var(--text-muted)]">
                            {tx(language, '(Archived)', '(আর্কাইভ)')}
                          </span>
                        )}
                      </td>
                      {monthRange.dates.map((d) => {
                        const occ = classifyOccurrence(
                          habit,
                          d,
                          logsLookup.get(`${habit.id}:${d}`),
                          data.userToday
                        );
                        const canEdit = occ.isScheduled && d <= data.userToday;

                        return (
                          <td key={d} className="p-1 text-center">
                            {occ.isScheduled ? (
                              <button
                                type="button"
                                disabled={!canEdit}
                                onClick={() => void handleToggleCell(habit, d, occ.isCompleted)}
                                aria-label={`${habit.name} on ${d}: ${occ.state}`}
                                className={`w-6 h-6 rounded flex items-center justify-center mx-auto transition-colors ${
                                  occ.isCompleted
                                    ? 'bg-[var(--accent-lime)] text-[var(--accent-ink)]'
                                    : occ.state === 'missed'
                                    ? 'bg-red-500/15 border border-red-500/40 text-[var(--status-danger)] hover:border-[var(--accent-lime)]'
                                    : occ.state === 'pending'
                                    ? 'bg-[var(--bg-surface)] border border-[var(--border-strong)] hover:border-[var(--accent-lime)]'
                                    : 'bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] opacity-45 cursor-not-allowed'
                                }`}
                              >
                                {occ.isCompleted && <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
                              </button>
                            ) : (
                              <span
                                aria-label="Unscheduled"
                                className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--border-subtle)]"
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        /* Monthly Heatmap Grid */
        <section className="p-5 sm:p-6 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[var(--border-subtle)]">
            <p className="text-xs text-[var(--text-secondary)]">
              {tx(
                language,
                'Select today or any future date (or click +) to add a habit starting on that date.',
                'আজ বা ভবিষ্যতের যেকোনো তারিখে ক্লিক করে (অথবা + বাটনে চাপ দিয়ে) ঐ দিনের জন্য নতুন হ্যাবিট যোগ করুন।'
              )}
            </p>
            {canAddHabitOnSelectedDate && selectedDayDetail && (
              <button
                type="button"
                onClick={() => onCreateHabitForDate(selectedDayDetail)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-[var(--accent-lime)] text-[var(--accent-ink)] hover:bg-[var(--accent-lime-hover)] transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
              >
                <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>
                  {tx(
                    language,
                    `Add Habit on ${selectedDayDetail}`,
                    `${selectedDayDetail} তারিখে হ্যাবিট যোগ করুন`
                  )}
                </span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-7 gap-2 text-center text-xs font-medium text-[var(--text-secondary)]">
            {orderedWeekdayHeaders.map((dayName) => (
              <div key={dayName}>{dayName}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: leadingBlankCount }).map((_, idx) => (
              <div key={`blank-${idx}`} className="h-16 sm:h-20 rounded-lg bg-transparent" />
            ))}
            {data.metrics.dailySummaries.map((daySum) => {
              const isSelected = selectedDayDetail === daySum.date;
              const isToday = daySum.date === data.userToday;
              const isTodayOrFuture = daySum.date >= data.userToday;

              return (
                <div key={daySum.date} className="relative group h-16 sm:h-20">
                  <button
                    type="button"
                    onClick={() => setSelectedDayDetail(daySum.date)}
                    aria-pressed={isSelected}
                    className={`w-full h-full p-2 rounded-lg border text-left flex flex-col justify-between transition-transform hover:scale-[1.01] ${heatmapBgClass(
                      daySum,
                      data.userToday
                    )} ${
                      isSelected
                        ? 'border-[var(--text-primary)] ring-1 ring-[var(--text-primary)]'
                        : isToday
                        ? 'border-[var(--accent-lime)]'
                        : 'border-[var(--border-subtle)]'
                    }`}
                  >
                    <div className="flex items-center gap-1 pr-6">
                      <span className="text-xs font-mono-num">{daySum.date.slice(8)}</span>
                      {isToday && (
                        <span className="hidden sm:inline text-[10px] font-medium opacity-80">
                          · {tx(language, 'Today', 'আজ')}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] font-mono-num truncate">
                      {daySum.date > data.userToday
                        ? daySum.eligibleCount > 0
                          ? tx(
                              language,
                              `${daySum.eligibleCount} scheduled`,
                              `${daySum.eligibleCount}টি নির্ধারিত`
                            )
                          : tx(language, 'Future', 'ভবিষ্যৎ')
                        : daySum.hasEligibleHabits
                        ? `${Math.round(daySum.overallCompletionRate)}%`
                        : tx(language, 'Rest', 'বিরতি')}
                    </span>
                  </button>

                  {isTodayOrFuture && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDayDetail(daySum.date);
                        onCreateHabitForDate(daySum.date);
                      }}
                      title={`Add habit on ${daySum.date}`}
                      aria-label={`Add habit on ${daySum.date}`}
                      className={`absolute top-1.5 right-1.5 z-10 w-6 h-6 rounded-md flex items-center justify-center transition-opacity ${
                        isSelected
                          ? 'opacity-100 bg-[var(--accent-lime)] text-[var(--accent-ink)]'
                          : 'opacity-80 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 bg-[var(--bg-panel)]/90 text-[var(--text-primary)] border border-[var(--border-subtle)] hover:bg-[var(--accent-lime)] hover:text-[var(--accent-ink)] hover:border-transparent'
                      }`}
                    >
                      <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Selected Date Inspector & Habit Scheduler */}
      {selectedDayDetail && data && (
        <section className="p-5 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
              <h3 className="text-sm font-semibold font-mono-num text-[var(--text-primary)]">
                {tx(language, `Entries for ${selectedDayDetail}`, `${selectedDayDetail} তারিখের এন্ট্রি`)}
              </h3>
              <span aria-hidden="true">·</span>
              <span>
                {selectedDayDetail === data.userToday
                  ? tx(language, 'Today', 'আজ')
                  : selectedDayDetail > data.userToday
                  ? tx(language, 'Upcoming date', 'ভবিষ্যতের তারিখ')
                  : tx(language, 'Historical date', 'পূর্ববর্তী তারিখ')}
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              {canAddHabitOnSelectedDate && (
                <button
                  type="button"
                  onClick={() => onCreateHabitForDate(selectedDayDetail)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-[var(--accent-lime)] text-[var(--accent-ink)] hover:bg-[var(--accent-lime-hover)] transition-colors whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>{tx(language, 'Add Habit', 'হ্যাবিট যোগ করুন')}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedDayDetail(null)}
                className="px-2.5 py-1.5 rounded-lg text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors whitespace-nowrap shrink-0"
              >
                {tx(language, 'Close', 'বন্ধ করুন')}
              </button>
            </div>
          </div>

          {selectedDateScheduledEntries.length === 0 ? (
            <div className="py-6 text-center space-y-3 border-t border-[var(--border-subtle)]">
              <p className="text-xs text-[var(--text-secondary)]">
                {canAddHabitOnSelectedDate
                  ? tx(
                      language,
                      `No habits are scheduled for ${selectedDayDetail} yet.`,
                      `${selectedDayDetail} তারিখের জন্য এখনো কোনো হ্যাবিট নির্ধারিত নেই।`
                    )
                  : tx(
                      language,
                      `No habits were scheduled on ${selectedDayDetail}.`,
                      `${selectedDayDetail} তারিখে কোনো হ্যাবিট নির্ধারিত ছিল না।`
                    )}
              </p>
              {canAddHabitOnSelectedDate && (
                <button
                  type="button"
                  onClick={() => onCreateHabitForDate(selectedDayDetail)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[var(--accent-lime)] text-[var(--accent-ink)] hover:bg-[var(--accent-lime-hover)] transition-colors whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>
                    {tx(
                      language,
                      `Create Habit for ${selectedDayDetail}`,
                      `${selectedDayDetail} তারিখের জন্য হ্যাবিট তৈরি করুন`
                    )}
                  </span>
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)] text-xs border-t border-[var(--border-subtle)]">
              {selectedDateScheduledEntries.map(({ habit, occ }) => {
                const isFutureDate = selectedDayDetail > data.userToday;
                return (
                  <div key={habit.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-[var(--text-primary)] truncate">
                          {habit.name}
                        </span>
                        <span aria-hidden="true" className="text-[var(--text-muted)]">
                          ·
                        </span>
                        <span className="text-[var(--text-secondary)]">
                          {translateCategory(habit.category, language)}
                        </span>
                      </div>
                      {occ.log?.notes && (
                        <p className="text-[var(--text-secondary)] mt-0.5">
                          {tx(language, 'Note:', 'নোট:')} {occ.log.notes}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isFutureDate ? (
                        <>
                          <span className="text-[var(--text-secondary)] whitespace-nowrap">
                            {tx(language, 'Scheduled', 'নির্ধারিত')}
                          </span>
                          <button
                            type="button"
                            onClick={() => onEditHabit(habit)}
                            aria-label={`Edit ${habit.name}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors whitespace-nowrap"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>{tx(language, 'Edit', 'সম্পাদনা')}</span>
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            void handleToggleCell(habit, selectedDayDetail, occ.isCompleted)
                          }
                          className={`px-3 py-1.5 rounded-md font-semibold whitespace-nowrap transition-colors ${
                            occ.isCompleted
                              ? 'bg-[var(--accent-lime)] text-[var(--accent-ink)]'
                              : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          {occ.isCompleted
                            ? tx(language, 'Completed (Undo)', 'সম্পন্ন (বাতিল)')
                            : tx(language, 'Mark Complete', 'সম্পন্ন করুন')}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
