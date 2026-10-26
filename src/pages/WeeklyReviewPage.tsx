import React, { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { localeFromLanguage, tx } from '../lib/i18n.ts';
import { addDays } from '../shared/dates.ts';
import type { DaySummaryMetrics, HabitStreakSummary } from '../shared/types.ts';

interface WeeklyReviewResponse {
  weekStart: string;
  weekEnd: string;
  prevWeekStart: string;
  prevWeekEnd: string;
  userToday: string;
  currentWeek: {
    completionRate: number;
    completedCount: number;
    eligibleToDate: number;
    missedCount: number;
    pendingCount: number;
    dailySummaries: DaySummaryMetrics[];
  };
  previousWeek: {
    completionRate: number;
    completedCount: number;
    eligibleToDate: number;
  };
  delta: number | null;
  habitRankings: HabitStreakSummary[];
  weekNotes: {
    id: number;
    localDate: string;
    habitName: string;
    notes: string;
    completed: boolean;
  }[];
}

export function WeeklyReviewPage({ refreshSignal }: { refreshSignal: number }) {
  const { language, pushToast } = useAuth();
  const [anchorDate, setAnchorDate] = useState<string>('');
  const [data, setData] = useState<WeeklyReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiStatus, setAiStatus] = useState<boolean>(false);
  const [aiReflection, setAiReflection] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const loadReview = useCallback(
    async (dateParam?: string) => {
      setLoading(true);
      try {
        const qs = dateParam ? `?date=${encodeURIComponent(dateParam)}` : '';
        const [reviewRes, aiRes] = await Promise.all([
          apiFetch<WeeklyReviewResponse>(`/api/weekly-review${qs}`),
          apiFetch<{ enabled: boolean }>('/api/ai/status'),
        ]);
        setData(reviewRes);
        setAnchorDate(reviewRes.weekStart);
        setAiStatus(aiRes.enabled);
      } catch (err: any) {
        pushToast({ message: err?.message || 'Failed to load weekly review.', tone: 'error' });
      } finally {
        setLoading(false);
      }
    },
    [pushToast]
  );

  useEffect(() => {
    void loadReview(anchorDate || undefined);
  }, [loadReview, refreshSignal]);

  const shiftWeek = (deltaWeeks: number) => {
    if (!anchorDate) return;
    const next = addDays(anchorDate, deltaWeeks * 7);
    setAnchorDate(next);
    setAiReflection(null);
    void loadReview(next);
  };

  const handleGenerateReflection = async () => {
    setAiLoading(true);
    try {
      const res = await apiFetch<{
        insights: { summary: string; weeklyReflection: string };
      }>('/api/ai/insights', {
        method: 'POST',
        body: JSON.stringify({ preset: 'current_week' }),
      });
      setAiReflection(`${res.insights.summary} ${res.insights.weeklyReflection}`);
    } catch (err: any) {
      pushToast({ message: err?.message || 'Could not generate AI reflection.', tone: 'error' });
    } finally {
      setAiLoading(false);
    }
  };

  if (loading || !data) {
    return (
      <div className="h-72 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] animate-pulse" />
    );
  }

  const eligibleHabits = data.habitRankings.filter((h) => h.eligibleOccurrences > 0);

  return (
    <div className="space-y-6">
      {/* Week Selector */}
      <section className="p-5 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => shiftWeek(-1)}
            aria-label="Previous week"
            className="p-2 rounded-lg bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="px-3 text-sm font-semibold font-mono-num text-[var(--text-primary)]">
            {data.weekStart} – {data.weekEnd}
          </span>
          <button
            type="button"
            onClick={() => shiftWeek(1)}
            aria-label="Next week"
            className="p-2 rounded-lg bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono-num text-[var(--text-secondary)]">
          <span>
            {tx(language, 'Week rate:', 'সপ্তাহের হার:')}{' '}
            <strong className="text-[var(--accent-lime)]">
              {data.currentWeek.eligibleToDate > 0 ? `${data.currentWeek.completionRate}%` : '—'}
            </strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {tx(language, 'Prior week:', 'পূর্ববর্তী সপ্তাহ:')}{' '}
            <strong className="text-[var(--text-primary)]">
              {data.previousWeek.eligibleToDate > 0 ? `${data.previousWeek.completionRate}%` : '—'}
            </strong>
          </span>
          {data.delta !== null && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-[var(--text-primary)]">
                {data.delta >= 0 ? `+${data.delta}%` : `${data.delta}%`}{' '}
                {tx(language, 'vs prior week', 'পূর্ববর্তী সপ্তাহের তুলনায়')}
              </span>
            </>
          )}
        </div>
      </section>

      {/* 7-Day Daily Breakdown */}
      <section className="p-6 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          {tx(language, 'Day-by-Day Weekly Consistency', 'প্রতিদিনের সাপ্তাহিক ধারাবাহিকতা')}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {data.currentWeek.dailySummaries.map((d) => {
            const weekdayName = new Intl.DateTimeFormat(localeFromLanguage(language), {
              weekday: 'short',
              timeZone: 'UTC',
            }).format(new Date(`${d.date}T00:00:00Z`));
            const isFuture = d.date > data.userToday;
            return (
              <div
                key={d.date}
                className="p-3.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-2"
              >
                <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                  <span>{weekdayName}</span>
                  <span className="font-mono-num">{d.date.slice(5)}</span>
                </div>
                <p className="text-xl font-bold font-mono-num text-[var(--text-primary)]">
                  {isFuture
                    ? tx(language, 'Upcoming', 'আসন্ন')
                    : d.hasEligibleHabits
                    ? `${Math.round(d.overallCompletionRate)}%`
                    : tx(language, 'Rest', 'বিরতি')}
                </p>
                <p className="text-[11px] font-mono-num text-[var(--text-secondary)]">
                  {d.completedCount}/{d.eligibleCount} {tx(language, 'scheduled', 'নির্ধারিত')}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Wins, Friction Points & Weekly Notes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="p-6 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {tx(language, 'Weekly Habit Breakdown', 'সাপ্তাহিক হ্যাবিট বিশ্লেষণ')}
          </h2>
          {eligibleHabits.length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">
              {tx(
                language,
                'No scheduled habit occurrences in this week window.',
                'এই সপ্তাহে কোনো নির্ধারিত হ্যাবিট নেই।'
              )}
            </p>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)] text-xs sm:text-sm">
              {eligibleHabits.map((h) => (
                <div key={h.habitId} className="py-2.5 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-[var(--text-primary)]">{h.habitName}</p>
                    <p className="text-xs font-mono-num text-[var(--text-secondary)]">
                      {h.completedOccurrences}/{h.eligibleOccurrences}{' '}
                      {tx(language, 'completed', 'সম্পন্ন')} · {h.missedOccurrences}{' '}
                      {tx(language, 'missed', 'মিস')}
                    </p>
                  </div>
                  <span className="font-mono-num font-semibold text-[var(--accent-lime)]">
                    {h.completionRate}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="p-6 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              {tx(language, 'Daily Reflections & Notes', 'দৈনিক নোট ও পর্যালোচনা')}
            </h2>
            {aiStatus && eligibleHabits.length > 0 && (
              <button
                type="button"
                disabled={aiLoading}
                onClick={() => void handleGenerateReflection()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--bg-surface)] text-[var(--accent-lime)] hover:bg-[var(--bg-surface-hover)] whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>
                  {aiLoading
                    ? tx(language, 'Generating...', 'তৈরি হচ্ছে...')
                    : tx(language, 'Weekly Summary', 'সাপ্তাহিক সারাংশ')}
                </span>
              </button>
            )}
          </div>

          {aiReflection && (
            <div className="p-3.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] leading-relaxed">
              {aiReflection}
            </div>
          )}

          {data.weekNotes.length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">
              {tx(
                language,
                'No daily notes were recorded during this week. Add notes on any habit from the Dashboard or Daily Habits checklist to review qualitative context here.',
                'এই সপ্তাহে কোনো দৈনিক নোট সংরক্ষিত হয়নি। ড্যাশবোর্ড বা দৈনিক হ্যাবিট থেকে যেকোনো হ্যাবিটে নোট যোগ করলে তা এখানে দেখা যাবে।'
              )}
            </p>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)] text-xs space-y-2">
              {data.weekNotes.map((note) => (
                <div key={note.id} className="pt-2.5 first:pt-0">
                  <div className="flex items-center justify-between text-[var(--text-secondary)]">
                    <span className="font-medium text-[var(--text-primary)]">{note.habitName}</span>
                    <span className="font-mono-num">{note.localDate}</span>
                  </div>
                  <p className="text-[var(--text-secondary)] mt-1">{note.notes}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
