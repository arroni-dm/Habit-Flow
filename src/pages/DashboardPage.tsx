import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit3,
  Flame,
  MessageSquare,
  Minus,
  Plus,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { formatScheduleSummary, HabitIcon } from '../components/HabitIcon.tsx';
import type { NavRoute } from '../components/Layout.tsx';
import { ProgressRing } from '../components/ProgressRing.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { translateCategory, translatePriority, tx } from '../lib/i18n.ts';
import { addDays } from '../shared/dates.ts';
import type {
  DaySummaryMetrics,
  EvaluatedHabitOccurrence,
  HabitRecord,
  HabitStreakSummary,
  OverallStreakSummary,
} from '../shared/types.ts';

interface OverviewResponse {
  userToday: string;
  selectedDate: string;
  hasAnyHabits: boolean;
  hasHistory: boolean;
  todaySummary: DaySummaryMetrics;
  sevenDayOverview: DaySummaryMetrics[];
  weekly: {
    completionRate: number;
    completedCount: number;
    eligibleToDate: number;
    previousRate: number;
    delta: number | null;
  };
  monthly: {
    completionRate: number;
    completedCount: number;
    eligibleToDate: number;
    previousRate: number;
    delta: number | null;
  };
  streaks: OverallStreakSummary;
  topHabits: HabitStreakSummary[];
  insights: {
    bestHabit: HabitStreakSummary | null;
    attentionHabit: HabitStreakSummary | null;
    weeklyDelta: number | null;
    monthlyDelta: number | null;
  };
}

interface DayTrackingResponse {
  date: string;
  userToday: string;
  summary: DaySummaryMetrics;
  occurrences: EvaluatedHabitOccurrence[];
}

interface AiInsightData {
  summary: string;
  consistencyObservations: string[];
  suggestedAdjustments: string[];
  weeklyReflection: string;
  disclaimer: string;
}

interface DashboardPageProps {
  refreshSignal: number;
  onEditHabit: (habit: HabitRecord) => void;
  onCreateHabit: () => void;
  onNavigate: (route: NavRoute) => void;
}

export function DashboardPage({
  refreshSignal,
  onEditHabit,
  onCreateHabit,
  onNavigate,
}: DashboardPageProps) {
  const { language, pushToast } = useAuth();
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [dayTracking, setDayTracking] = useState<DayTrackingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [noteOpenHabitId, setNoteOpenHabitId] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  const [aiStatus, setAiStatus] = useState<{ enabled: boolean; message: string } | null>(null);
  const [aiInsights, setAiInsights] = useState<AiInsightData | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const loadDashboard = useCallback(
    async (targetDate?: string) => {
      try {
        setError(null);
        const dateQuery = targetDate ? `?date=${encodeURIComponent(targetDate)}` : '';
        const [overviewData, dayData, aiStat] = await Promise.all([
          apiFetch<OverviewResponse>(`/api/analytics/overview${dateQuery}`),
          apiFetch<DayTrackingResponse>(`/api/tracking/day${dateQuery}`),
          apiFetch<{ enabled: boolean; message: string }>('/api/ai/status'),
        ]);
        setOverview(overviewData);
        setDayTracking(dayData);
        setSelectedDate(dayData.date);
        setAiStatus(aiStat);
      } catch (err: any) {
        setError(err?.message || 'Failed to load dashboard.');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadDashboard(selectedDate || undefined);
  }, [loadDashboard, refreshSignal]);

  const handleDateShift = (delta: number) => {
    if (!selectedDate) return;
    const nextDate = addDays(selectedDate, delta);
    setSelectedDate(nextDate);
    void loadDashboard(nextDate);
  };

  const handleJumpToday = () => {
    if (!overview) return;
    setSelectedDate(overview.userToday);
    void loadDashboard(overview.userToday);
  };

  const handleToggleBoolean = async (occ: EvaluatedHabitOccurrence) => {
    const nextCompleted = !occ.isCompleted;
    try {
      await apiFetch(`/api/habits/${occ.habit.id}/logs/${occ.date}`, {
        method: 'PUT',
        body: JSON.stringify({
          completed: nextCompleted,
          notes: occ.log?.notes ?? null,
        }),
      });
      await loadDashboard(occ.date);
      pushToast({
        message: nextCompleted
          ? `Completed "${occ.habit.name}"`
          : `Marked "${occ.habit.name}" incomplete`,
        undoLabel: 'Undo',
        onUndo: async () => {
          await apiFetch(`/api/habits/${occ.habit.id}/logs/${occ.date}`, {
            method: 'PUT',
            body: JSON.stringify({
              completed: !nextCompleted,
              notes: occ.log?.notes ?? null,
            }),
          });
          await loadDashboard(occ.date);
        },
      });
    } catch (err: any) {
      pushToast({ message: err?.message || 'Could not update habit.', tone: 'error' });
    }
  };

  const handleUpdateMeasurable = async (
    occ: EvaluatedHabitOccurrence,
    nextValue: number
  ) => {
    const safeVal = Math.max(0, nextValue);
    try {
      const body =
        occ.habit.habitType === 'duration'
          ? {
              numericValue: safeVal,
              durationSeconds: Math.round(
                safeVal * (occ.habit.targetUnit === 'hours' ? 3600 : 60)
              ),
              notes: occ.log?.notes ?? null,
            }
          : {
              numericValue: safeVal,
              notes: occ.log?.notes ?? null,
            };

      await apiFetch(`/api/habits/${occ.habit.id}/logs/${occ.date}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      await loadDashboard(occ.date);
    } catch (err: any) {
      pushToast({ message: err?.message || 'Failed to update progress.', tone: 'error' });
    }
  };

  const handleSaveNote = async (occ: EvaluatedHabitOccurrence) => {
    try {
      await apiFetch(`/api/habits/${occ.habit.id}/logs/${occ.date}`, {
        method: 'PUT',
        body: JSON.stringify({
          completed: occ.isCompleted,
          numericValue: occ.log?.numericValue ?? null,
          durationSeconds: occ.log?.durationSeconds ?? null,
          notes: noteDraft.trim() || null,
        }),
      });
      setNoteOpenHabitId(null);
      await loadDashboard(occ.date);
      pushToast({ message: 'Saved daily note.' });
    } catch (err: any) {
      pushToast({ message: err?.message || 'Failed to save note.', tone: 'error' });
    }
  };

  const handleRequestAiInsights = async () => {
    setAiLoading(true);
    try {
      const res = await apiFetch<{ insights: AiInsightData }>('/api/ai/insights', {
        method: 'POST',
        body: JSON.stringify({ preset: '30d' }),
      });
      setAiInsights(res.insights);
    } catch (err: any) {
      pushToast({ message: err?.message || 'Unable to generate AI insights.', tone: 'error' });
    } finally {
      setAiLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div
              key={idx}
              className="h-24 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] animate-pulse"
            />
          ))}
        </div>
        <div className="h-80 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] animate-pulse" />
      </div>
    );
  }

  if (error || !overview || !dayTracking) {
    return (
      <div role="alert" className="p-6 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-3">
        <p className="text-sm text-[#F87171]">{error || 'Unable to load dashboard.'}</p>
        <button
          type="button"
          onClick={() => void loadDashboard()}
          className="px-4 py-2 rounded-lg text-xs font-semibold bg-[var(--accent-lime)] text-[var(--accent-ink)]"
        >
          Retry
        </button>
      </div>
    );
  }

  const { todaySummary, streaks, weekly, monthly } = overview;
  const scheduledOccurrences = dayTracking.occurrences.filter((o) => o.isScheduled);
  const isViewingToday = dayTracking.date === overview.userToday;
  const isFutureDate = dayTracking.date > overview.userToday;

  const progressMessage = !todaySummary.hasEligibleHabits
    ? tx(language, 'No habits are scheduled for this date.', 'এই তারিখে কোনো হ্যাবিট নির্ধারিত নেই।')
    : todaySummary.completedCount === todaySummary.eligibleCount
    ? tx(
        language,
        'All scheduled habits completed for this day.',
        'আজকের নির্ধারিত সকল হ্যাবিট সম্পন্ন হয়েছে।'
      )
    : todaySummary.completedCount === 0
    ? isViewingToday
      ? tx(
          language,
          'Ready to begin today’s scheduled habits.',
          'আজকের নির্ধারিত হ্যাবিট শুরু করার জন্য প্রস্তুত।'
        )
      : tx(language, 'No completions recorded on this date.', 'এই তারিখে কোনো হ্যাবিট সম্পন্ন হয়নি।')
    : tx(
        language,
        `${todaySummary.completedCount} of ${todaySummary.eligibleCount} scheduled habits complete. Steady momentum.`,
        `${todaySummary.eligibleCount}টির মধ্যে ${todaySummary.completedCount}টি নির্ধারিত হ্যাবিট সম্পন্ন হয়েছে।`
      );

  return (
    <div className="space-y-8">
      {/* Empty Workspace Banner */}
      {!overview.hasAnyHabits && (
        <section className="p-6 sm:p-8 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="space-y-1.5 max-w-xl">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              {tx(
                language,
                'Build your daily consistency system',
                'আপনার দৈনিক ধারাবাহিকতার অভ্যাস গড়ে তুলুন'
              )}
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">
              {tx(
                language,
                'Your workspace is currently empty. Add your first habit or import a spreadsheet from Daily Habits or Reports to start tracking streaks and completion trends.',
                'আপনার ওয়ার্কস্পেস বর্তমানে খালি। প্রথম হ্যাবিট যোগ করুন অথবা স্প্রেডশিট ইমপোর্ট করে স্ট্রিক ও অগ্রগতি ট্র্যাক করা শুরু করুন।'
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onCreateHabit}
            className="px-4 py-2.5 rounded-lg text-sm font-semibold bg-[var(--accent-lime)] text-[var(--accent-ink)] hover:bg-[var(--accent-lime-hover)] whitespace-nowrap shrink-0"
          >
            {tx(language, 'Create First Habit', 'প্রথম হ্যাবিট তৈরি করুন')}
          </button>
        </section>
      )}

      {/* 8 Summary Metrics Strip */}
      <section aria-label="Summary metrics" className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        {[
          {
            label: isViewingToday
              ? tx(language, "Today's Rate", 'আজকের হার')
              : tx(language, 'Selected Rate', 'নির্বাচিত হার'),
            value: todaySummary.hasEligibleHabits ? `${todaySummary.overallCompletionRate}%` : '—',
            sub: tx(
              language,
              `${todaySummary.completedCount}/${todaySummary.eligibleCount} scheduled`,
              `${todaySummary.completedCount}/${todaySummary.eligibleCount} নির্ধারিত`
            ),
          },
          {
            label: tx(language, 'Completed', 'সম্পন্ন'),
            value: String(todaySummary.completedCount),
            sub: isViewingToday ? tx(language, 'Done today', 'আজ সম্পন্ন') : dayTracking.date,
          },
          {
            label: tx(language, 'Remaining', 'বাকি আছে'),
            value: String(todaySummary.pendingCount),
            sub: tx(language, 'Pending deadline', 'চলমান হ্যাবিট'),
          },
          {
            label: tx(language, 'Missed', 'মিস হয়েছে'),
            value: String(todaySummary.missedCount),
            sub: isViewingToday
              ? tx(language, 'Past deadline', 'সময়সীমা উত্তীর্ণ')
              : tx(language, 'Uncompleted past', 'অসম্পূর্ণ'),
          },
          {
            label: tx(language, 'Current Streak', 'বর্তমান স্ট্রিক'),
            value: `${streaks.currentStreak}d`,
            sub: tx(
              language,
              `≥${streaks.consistencyThresholdPct}% consistency`,
              `≥${streaks.consistencyThresholdPct}% ধারাবাহিকতা`
            ),
          },
          {
            label: tx(language, 'Longest Streak', 'সর্বোচ্চ স্ট্রিক'),
            value: `${streaks.longestStreak}d`,
            sub: tx(
              language,
              `Perfect: ${streaks.perfectDayLongestStreak}d`,
              `পারফেক্ট: ${streaks.perfectDayLongestStreak} দিন`
            ),
          },
          {
            label: tx(language, 'Weekly Rate', 'সাপ্তাহিক হার'),
            value: weekly.eligibleToDate > 0 ? `${weekly.completionRate}%` : '—',
            sub: `${weekly.completedCount}/${weekly.eligibleToDate}`,
          },
          {
            label: tx(language, 'Monthly Rate', 'মাসিক হার'),
            value: monthly.eligibleToDate > 0 ? `${monthly.completionRate}%` : '—',
            sub: `${monthly.completedCount}/${monthly.eligibleToDate}`,
          },
        ].map((metric) => (
          <div
            key={metric.label}
            className="p-4 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] flex flex-col justify-between"
          >
            <span className="text-xs text-[var(--text-secondary)] truncate">{metric.label}</span>
            <span className="text-xl font-bold font-mono-num text-[var(--text-primary)] mt-2">
              {metric.value}
            </span>
            <span className="text-[11px] text-[var(--text-muted)] font-mono-num mt-1 truncate">
              {metric.sub}
            </span>
          </div>
        ))}
      </section>

      {/* Main Split: Section A (Today's Progress + C. 7-Day Overview) & Section B (Today's Habits) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: A. Today's Progress + C. Daily Overview */}
        <div className="lg:col-span-5 space-y-6">
          {/* A. Today's Progress */}
          <section className="p-6 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">
                  {isViewingToday
                    ? tx(language, "Today's Progress", 'আজকের অগ্রগতি')
                    : tx(language, `Progress · ${dayTracking.date}`, `অগ্রগতি · ${dayTracking.date}`)}
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">{progressMessage}</p>
              </div>
              {!isViewingToday && (
                <button
                  type="button"
                  onClick={handleJumpToday}
                  className="px-2.5 py-1 rounded-md text-xs font-medium bg-[var(--bg-surface)] text-[var(--accent-lime)] hover:bg-[var(--bg-surface-hover)] whitespace-nowrap"
                >
                  {tx(language, 'Today', 'আজ')}
                </button>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-6 py-2">
              <ProgressRing
                percentage={todaySummary.overallCompletionRate}
                subtitle={tx(
                  language,
                  `${todaySummary.completedCount} / ${todaySummary.eligibleCount} done`,
                  `${todaySummary.completedCount} / ${todaySummary.eligibleCount} সম্পন্ন`
                )}
              />
              <div className="flex-1 w-full space-y-3 text-xs">
                <div className="flex items-center justify-between py-1.5 border-b border-[var(--border-subtle)]">
                  <span className="text-[var(--text-secondary)]">
                    {tx(language, 'Boolean habits', 'চেকমার্ক হ্যাবিট')}
                  </span>
                  <span className="font-mono-num text-[var(--text-primary)]">
                    {todaySummary.booleanEligibleCount > 0
                      ? `${todaySummary.booleanCompletedCount}/${todaySummary.booleanEligibleCount} (${todaySummary.booleanCompletionRate}%)`
                      : tx(language, 'None scheduled', 'নির্ধারিত নেই')}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-[var(--border-subtle)]">
                  <span className="text-[var(--text-secondary)]">
                    {tx(language, 'Target attainment', 'লক্ষ্য অর্জনের হার')}
                  </span>
                  <span className="font-mono-num text-[var(--text-primary)]">
                    {todaySummary.measurableEligibleCount > 0
                      ? `${todaySummary.measurableAverageAttainment}%`
                      : tx(language, 'None scheduled', 'নির্ধারিত নেই')}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-[var(--text-secondary)]">
                    {tx(language, 'Pending vs Missed', 'বাকি বনাম মিস')}
                  </span>
                  <span className="font-mono-num text-[var(--text-primary)]">
                    {tx(
                      language,
                      `${todaySummary.pendingCount} pending · ${todaySummary.missedCount} missed`,
                      `${todaySummary.pendingCount} বাকি · ${todaySummary.missedCount} মিস`
                    )}
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* C. Daily Overview (7-Day Summary + Date Navigation) */}
          <section className="p-6 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">
                  {tx(language, 'Daily Overview', 'দৈনিক সংক্ষিপ্তসার')}
                </h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  {tx(language, '7-day completion history', '৭ দিনের সম্পন্নের ইতিহাস')}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleDateShift(-1)}
                  aria-label="Previous day"
                  className="p-1.5 rounded-lg bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-2 text-xs font-mono-num text-[var(--text-primary)]">
                  {dayTracking.date}
                </span>
                <button
                  type="button"
                  onClick={() => handleDateShift(1)}
                  aria-label="Next day"
                  className="p-1.5 rounded-lg bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-2 pt-1">
              {overview.sevenDayOverview.map((d) => {
                const isSelected = d.date === dayTracking.date;
                const dayLabel = d.date.slice(8);
                const weekdayShort = new Intl.DateTimeFormat(
                  language === 'bn' ? 'bn-BD' : 'en-US',
                  {
                    weekday: 'short',
                    timeZone: 'UTC',
                  }
                ).format(new Date(`${d.date}T00:00:00Z`));
                return (
                  <button
                    key={d.date}
                    type="button"
                    onClick={() => {
                      setSelectedDate(d.date);
                      void loadDashboard(d.date);
                    }}
                    className={`p-2 rounded-lg border text-center transition-colors ${
                      isSelected
                        ? 'border-[var(--accent-lime)] bg-[var(--bg-surface)]'
                        : 'border-[var(--border-subtle)] hover:bg-[var(--bg-surface)]'
                    }`}
                  >
                    <span className="block text-[11px] text-[var(--text-secondary)]">
                      {weekdayShort}
                    </span>
                    <span className="block text-xs font-semibold font-mono-num text-[var(--text-primary)] mt-0.5">
                      {dayLabel}
                    </span>
                    <span
                      className={`block text-[11px] font-mono-num mt-1.5 ${
                        !d.hasEligibleHabits
                          ? 'text-[var(--text-muted)]'
                          : d.overallCompletionRate >= 80
                          ? 'text-[var(--accent-lime)]'
                          : 'text-[var(--text-secondary)]'
                      }`}
                    >
                      {d.hasEligibleHabits ? `${Math.round(d.overallCompletionRate)}%` : '—'}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        {/* Right Column: B. Today's Habits */}
        <section className="lg:col-span-7 p-6 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4">
          <div className="flex items-center justify-between gap-4 pb-3 border-b border-[var(--border-subtle)]">
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                {isViewingToday
                  ? tx(language, "Today's Scheduled Habits", 'আজকের নির্ধারিত হ্যাবিট')
                  : tx(
                      language,
                      `Scheduled Habits · ${dayTracking.date}`,
                      `নির্ধারিত হ্যাবিট · ${dayTracking.date}`
                    )}
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                {tx(
                  language,
                  `${scheduledOccurrences.length} scheduled`,
                  `${scheduledOccurrences.length}টি নির্ধারিত`
                )}{' '}
                ·{' '}
                {isFutureDate
                  ? tx(language, 'Upcoming schedule preview', 'ভবিষ্যতের সময়সূচি')
                  : tx(
                      language,
                      'Click to log completion or progress',
                      'সম্পন্ন বা অগ্রগতি রেকর্ড করতে ক্লিক করুন'
                    )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('/habits')}
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--accent-lime)] whitespace-nowrap"
            >
              <span>{tx(language, 'Manage all', 'সব দেখুন')}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {scheduledOccurrences.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <p className="text-sm text-[var(--text-secondary)]">
                {tx(
                  language,
                  `No habits are scheduled for ${dayTracking.date}.`,
                  `${dayTracking.date} তারিখের জন্য কোনো হ্যাবিট নির্ধারিত নেই।`
                )}
              </p>
              <button
                type="button"
                onClick={onCreateHabit}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]"
              >
                {tx(language, 'Add a Habit', 'হ্যাবিট যোগ করুন')}
              </button>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {scheduledOccurrences.map((occ) => {
                const { habit } = occ;
                const isNoteOpen = noteOpenHabitId === habit.id;

                return (
                  <div key={habit.id} className="py-3.5 first:pt-1 last:pb-1 space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3.5 min-w-0">
                        {/* Accessible >=40px Completion Control */}
                        <button
                          type="button"
                          disabled={isFutureDate}
                          onClick={() => {
                            if (habit.habitType === 'boolean') {
                              void handleToggleBoolean(occ);
                            } else {
                              const nextVal = occ.isCompleted ? 0 : habit.targetValue;
                              void handleUpdateMeasurable(occ, nextVal);
                            }
                          }}
                          aria-label={
                            occ.isCompleted
                              ? `Mark ${habit.name} incomplete`
                              : `Mark ${habit.name} complete`
                          }
                          className={`w-10 h-10 rounded-lg flex items-center justify-center border transition-colors shrink-0 ${
                            occ.isCompleted
                              ? 'bg-[var(--accent-lime)] border-transparent text-[var(--accent-ink)]'
                              : 'bg-[var(--bg-surface)] border-[var(--border-strong)] text-[var(--text-secondary)] hover:border-[var(--accent-lime)] disabled:opacity-40'
                          }`}
                        >
                          {occ.isCompleted ? (
                            <Check className="w-5 h-5 stroke-[2.5]" />
                          ) : (
                            <HabitIcon name={habit.icon} className="w-4 h-4" />
                          )}
                        </button>

                        <div className="min-w-0">
                          <p
                            className={`text-sm font-medium truncate ${
                              occ.isCompleted
                                ? 'line-through text-[var(--text-secondary)]'
                                : 'text-[var(--text-primary)]'
                            }`}
                          >
                            {habit.name}
                          </p>
                          {/* Clean unboxed metadata per Zero-Pill discipline */}
                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-secondary)] mt-0.5">
                            <span>{translateCategory(habit.category, language)}</span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {formatScheduleSummary(
                                habit.scheduleType,
                                habit.scheduleConfig?.daysOfWeek,
                                language
                              )}
                            </span>
                            {habit.reminderTime && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono-num">{habit.reminderTime}</span>
                              </>
                            )}
                            <span aria-hidden="true">·</span>
                            <span className="capitalize">
                              {translatePriority(habit.priority, language)}
                            </span>
                            <span aria-hidden="true">·</span>
                            {occ.state === 'completed' && (
                              <span className="text-[var(--status-success)] inline-flex items-center gap-1">
                                <Check className="w-3 h-3" /> {tx(language, 'Completed', 'সম্পন্ন')}
                              </span>
                            )}
                            {occ.state === 'pending' && (
                              <span className="text-[var(--status-warning)] inline-flex items-center gap-1">
                                <Clock className="w-3 h-3" /> {tx(language, 'Pending', 'বাকি')}
                              </span>
                            )}
                            {occ.state === 'missed' && (
                              <span className="text-[var(--status-danger)] inline-flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" /> {tx(language, 'Missed', 'মিস')}
                              </span>
                            )}
                            {occ.state === 'upcoming' && (
                              <span className="text-[var(--text-muted)]">
                                {tx(language, 'Scheduled', 'নির্ধারিত')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right Controls: Count/Duration Stepper + Streak + Quick Actions */}
                      <div className="flex items-center gap-2 shrink-0">
                        {habit.habitType !== 'boolean' && !isFutureDate && (
                          <div className="flex items-center gap-1 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-1.5 py-1">
                            <button
                              type="button"
                              aria-label={`Decrease ${habit.name}`}
                              onClick={() =>
                                void handleUpdateMeasurable(
                                  occ,
                                  occ.currentValue - (habit.habitType === 'duration' ? 5 : 1)
                                )
                              }
                              className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="text-xs font-mono-num text-[var(--text-primary)] px-1">
                              {occ.currentValue}/{occ.targetValue} {habit.targetUnit || ''}
                            </span>
                            <button
                              type="button"
                              aria-label={`Increase ${habit.name}`}
                              onClick={() =>
                                void handleUpdateMeasurable(
                                  occ,
                                  occ.currentValue + (habit.habitType === 'duration' ? 5 : 1)
                                )
                              }
                              className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}

                        <span
                          title="Current habit streak"
                          className="hidden sm:inline-flex items-center gap-1 text-xs font-mono-num text-[var(--text-secondary)] px-2"
                        >
                          <Flame className="w-3.5 h-3.5 text-[var(--accent-lime)]" />
                          {occ.currentStreak}d
                        </span>

                        <button
                          type="button"
                          onClick={() => {
                            if (isNoteOpen) {
                              setNoteOpenHabitId(null);
                            } else {
                              setNoteOpenHabitId(habit.id);
                              setNoteDraft(occ.log?.notes || '');
                            }
                          }}
                          aria-label={`Notes for ${habit.name}`}
                          className={`p-2 rounded-lg transition-colors ${
                            occ.log?.notes
                              ? 'text-[var(--accent-lime)] bg-[var(--bg-surface)]'
                              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'
                          }`}
                        >
                          <MessageSquare className="w-4 h-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => onEditHabit(habit)}
                          aria-label={`Edit ${habit.name}`}
                          className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {isNoteOpen && (
                      <div className="pl-13 flex items-center gap-2">
                        <input
                          type="text"
                          maxLength={1000}
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          placeholder={tx(
                            language,
                            'Add an optional note for this date...',
                            'এই তারিখের জন্য নোট লিখুন...'
                          )}
                          className="flex-1 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                        />
                        <button
                          type="button"
                          onClick={() => void handleSaveNote(occ)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--accent-lime)] text-[var(--accent-ink)]"
                        >
                          {tx(language, 'Save', 'সংরক্ষণ')}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Bottom Grid: D. Top Daily Habits, E. Progress & Streaks, F. Weekly & Monthly Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* D. Top Daily Habits */}
        <section className="p-6 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              {tx(language, 'Top Daily Habits', 'সেরা দৈনিক হ্যাবিট')}
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              {tx(
                language,
                'Ranked by completion rate · Last 30 days',
                'সম্পন্নের হার অনুযায়ী শীর্ষ হ্যাবিট · গত ৩০ দিন'
              )}
            </p>
          </div>

          {overview.topHabits.filter((h) => h.eligibleOccurrences > 0).length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)] py-6">
              {tx(
                language,
                'Track scheduled habits over a few days to see ranked completion rates.',
                'র‍্যাঙ্কিং দেখতে কয়েকদিন নির্ধারিত হ্যাবিট ট্র্যাক করুন।'
              )}
            </p>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {overview.topHabits
                .filter((h) => h.eligibleOccurrences > 0)
                .slice(0, 6)
                .map((h, idx) => (
                  <div key={h.habitId} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                        <span className="font-mono-num text-[var(--text-secondary)] mr-2">
                          0{idx + 1}.
                        </span>
                        {h.habitName}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)] mt-0.5 font-mono-num">
                        {h.completedOccurrences}/{h.eligibleOccurrences}{' '}
                        {tx(language, 'scheduled', 'নির্ধারিত')}
                      </p>
                    </div>
                    <span className="text-sm font-semibold font-mono-num text-[var(--accent-lime)] shrink-0">
                      {h.completionRate}%
                    </span>
                  </div>
                ))}
            </div>
          )}
        </section>

        {/* E. Progress & Streaks */}
        <section className="p-6 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              {tx(language, 'Progress & Streaks', 'অগ্রগতি ও স্ট্রিক')}
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              {tx(
                language,
                'Unscheduled days never break a habit or workspace streak',
                'অনির্ধারিত দিন কখনোই আপনার স্ট্রিক ভাঙে না'
              )}
            </p>
          </div>

          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between py-2 border-b border-[var(--border-subtle)]">
              <span className="text-[var(--text-secondary)]">
                {tx(
                  language,
                  `Consistency streak (≥${streaks.consistencyThresholdPct}% daily)`,
                  `ধারাবাহিক স্ট্রিক (≥${streaks.consistencyThresholdPct}% দৈনিক)`
                )}
              </span>
              <span className="font-semibold font-mono-num text-[var(--text-primary)]">
                {streaks.currentStreak}d ({tx(language, 'Best', 'সেরা')} {streaks.longestStreak}d)
              </span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-[var(--border-subtle)]">
              <span className="text-[var(--text-secondary)]">
                {tx(language, 'Perfect-day streak (100% daily)', 'পারফেক্ট-ডে স্ট্রিক (১০০% দৈনিক)')}
              </span>
              <span className="font-semibold font-mono-num text-[var(--text-primary)]">
                {streaks.perfectDayCurrentStreak}d ({tx(language, 'Best', 'সেরা')}{' '}
                {streaks.perfectDayLongestStreak}d)
              </span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-[var(--border-subtle)]">
              <span className="text-[var(--text-secondary)]">
                {tx(language, 'Current week completion', 'চলতি সপ্তাহের সম্পন্নের হার')}
              </span>
              <span className="font-semibold font-mono-num text-[var(--text-primary)]">
                {weekly.eligibleToDate > 0 ? `${weekly.completionRate}%` : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-[var(--text-secondary)]">
                {tx(language, 'Current month completion', 'চলতি মাসের সম্পন্নের হার')}
              </span>
              <span className="font-semibold font-mono-num text-[var(--text-primary)]">
                {monthly.eligibleToDate > 0 ? `${monthly.completionRate}%` : '—'}
              </span>
            </div>
          </div>
        </section>

        {/* F. Weekly & Monthly Insights + Optional AI Module */}
        <section className="p-6 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                {tx(language, 'Consistency Insights', 'ধারাবাহিকতার বিশ্লেষণ')}
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                {tx(
                  language,
                  'Grounded in verified schedule history',
                  'আপনার যাচাইকৃত লগের উপর ভিত্তি করে'
                )}
              </p>
            </div>
            <TrendingUp className="w-4 h-4 text-[var(--accent-lime)] shrink-0" />
          </div>

          {!overview.hasHistory ? (
            <p className="text-sm text-[var(--text-secondary)] py-4">
              {tx(
                language,
                'Log your first few completions to unlock period-over-period comparisons and habit consistency observations.',
                'সাপ্তাহিক তুলনা ও বিশ্লেষণ দেখতে কয়েকটি হ্যাবিট সম্পন্ন করুন।'
              )}
            </p>
          ) : (
            <div className="space-y-3 text-xs leading-relaxed">
              {overview.insights.bestHabit && (
                <div className="py-2 border-b border-[var(--border-subtle)]">
                  <span className="text-[var(--text-secondary)]">Strongest routine: </span>
                  <strong className="text-[var(--text-primary)]">
                    {overview.insights.bestHabit.habitName}
                  </strong>{' '}
                  <span className="font-mono-num text-[var(--accent-lime)]">
                    ({overview.insights.bestHabit.completionRate}%)
                  </span>
                </div>
              )}

              {overview.insights.attentionHabit && (
                <div className="py-2 border-b border-[var(--border-subtle)]">
                  <span className="text-[var(--text-secondary)]">Needs schedule check: </span>
                  <strong className="text-[var(--text-primary)]">
                    {overview.insights.attentionHabit.habitName}
                  </strong>{' '}
                  <span className="font-mono-num text-[var(--text-secondary)]">
                    ({overview.insights.attentionHabit.missedOccurrences} missed of{' '}
                    {overview.insights.attentionHabit.eligibleOccurrences} scheduled)
                  </span>
                </div>
              )}

              <div className="py-1 text-[var(--text-secondary)]">
                {overview.insights.weeklyDelta !== null ? (
                  <span>
                    Weekly pace is{' '}
                    <strong className="font-mono-num text-[var(--text-primary)]">
                      {overview.insights.weeklyDelta >= 0
                        ? `+${overview.insights.weeklyDelta}%`
                        : `${overview.insights.weeklyDelta}%`}
                    </strong>{' '}
                    compared with last week.
                  </span>
                ) : (
                  <span>Complete a full prior week to compare week-over-week shifts.</span>
                )}
              </div>
            </div>
          )}

          {/* Optional AI Reflection Integration Boundary */}
          <div className="pt-3 border-t border-[var(--border-subtle)] space-y-2.5">
            {aiStatus?.enabled ? (
              <>
                <button
                  type="button"
                  disabled={aiLoading || !overview.hasAnyHabits}
                  onClick={() => void handleRequestAiInsights()}
                  className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] disabled:opacity-50"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[var(--accent-lime)]" />
                  <span>{aiLoading ? 'Analyzing metrics...' : 'Generate AI Reflection'}</span>
                </button>
                {aiInsights && (
                  <div className="space-y-2 text-xs text-[var(--text-secondary)] pt-1">
                    <p className="text-[var(--text-primary)]">{aiInsights.summary}</p>
                    {aiInsights.suggestedAdjustments.map((s, idx) => (
                      <p key={idx}>• {s}</p>
                    ))}
                    <p className="text-[11px] text-[var(--text-muted)]">{aiInsights.disclaimer}</p>
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">
                Optional AI reflections are disabled (server <code>GEMINI_API_KEY</code> not set).
                All core analytics operate locally on PostgreSQL data.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
