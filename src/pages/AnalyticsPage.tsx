import React, { useCallback, useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { translateCategory, tx } from '../lib/i18n.ts';
import type {
  DaySummaryMetrics,
  HabitStreakSummary,
  OverallStreakSummary,
} from '../shared/types.ts';

type RangePreset =
  | '7d'
  | '30d'
  | 'current_week'
  | 'previous_week'
  | 'current_month'
  | 'previous_month'
  | 'custom';

interface TrendsResponse {
  range: { startDate: string; endDate: string; label: string };
  dailySeries: DaySummaryMetrics[];
  weeklySeries: {
    weekStart: string;
    weekEnd: string;
    label: string;
    completionRate: number;
    completedCount: number;
    eligibleCount: number;
  }[];
  monthlySeries: {
    month: string;
    label: string;
    completionRate: number;
    completedCount: number;
    eligibleCount: number;
  }[];
  heatmap: DaySummaryMetrics[];
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="px-3 py-2 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-strong)] text-xs space-y-1 shadow-md">
      <p className="font-mono-num text-[var(--text-secondary)]">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} className="font-mono-num font-semibold text-[var(--text-primary)]">
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
}

export function AnalyticsPage({ refreshSignal }: { refreshSignal: number }) {
  const { language } = useAuth();
  const [preset, setPreset] = useState<RangePreset>('30d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const [trends, setTrends] = useState<TrendsResponse | null>(null);
  const [habitStats, setHabitStats] = useState<{
    habits: HabitStreakSummary[];
    mostConsistent: HabitStreakSummary[];
    mostMissed: HabitStreakSummary[];
  } | null>(null);
  const [categoryStats, setCategoryStats] = useState<
    { category: string; completed: number; eligible: number; completionRate: number }[]
  >([]);
  const [streaks, setStreaks] = useState<OverallStreakSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ preset });
      if (preset === 'custom' && customStart && customEnd) {
        qs.set('start', customStart);
        qs.set('end', customEnd);
      }
      const query = qs.toString();

      const [overviewRes, trendsRes, habitsRes] = await Promise.all([
        apiFetch<{
          categoryPerformance: {
            category: string;
            completed: number;
            eligible: number;
            completionRate: number;
          }[];
          streaks: OverallStreakSummary;
        }>(`/api/analytics/overview?${query}`),
        apiFetch<TrendsResponse>(`/api/analytics/trends?${query}`),
        apiFetch<{
          habits: HabitStreakSummary[];
          mostConsistent: HabitStreakSummary[];
          mostMissed: HabitStreakSummary[];
        }>(`/api/analytics/habits?${query}`),
      ]);

      setCategoryStats(overviewRes.categoryPerformance);
      setStreaks(overviewRes.streaks);
      setTrends(trendsRes);
      setHabitStats(habitsRes);
    } finally {
      setLoading(false);
    }
  }, [preset, customStart, customEnd]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics, refreshSignal]);

  const PRESET_OPTIONS: { id: RangePreset; label: string }[] = [
    { id: '7d', label: tx(language, 'Last 7 days', 'গত ৭ দিন') },
    { id: '30d', label: tx(language, 'Last 30 days', 'গত ৩০ দিন') },
    { id: 'current_week', label: tx(language, 'Current week', 'চলতি সপ্তাহ') },
    { id: 'previous_week', label: tx(language, 'Previous week', 'পূর্ববর্তী সপ্তাহ') },
    { id: 'current_month', label: tx(language, 'Current month', 'চলতি মাস') },
    { id: 'previous_month', label: tx(language, 'Previous month', 'পূর্ববর্তী মাস') },
    { id: 'custom', label: tx(language, 'Custom range', 'কাস্টম সীমা') },
  ];

  return (
    <div className="space-y-6">
      {/* Period Selector */}
      <section className="p-4 sm:p-5 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {PRESET_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setPreset(opt.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  preset === opt.id
                    ? 'bg-[var(--accent-lime)] text-[var(--accent-ink)] font-semibold'
                    : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {trends && (
            <span className="text-xs font-mono-num text-[var(--text-secondary)]">
              {trends.range.startDate} {tx(language, 'to', 'থেকে')} {trends.range.endDate}
            </span>
          )}
        </div>

        {preset === 'custom' && (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <input
              type="date"
              aria-label="Custom start date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-mono-num text-[var(--text-primary)]"
            />
            <span className="text-xs text-[var(--text-secondary)]">
              {tx(language, 'to', 'থেকে')}
            </span>
            <input
              type="date"
              aria-label="Custom end date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-mono-num text-[var(--text-primary)]"
            />
          </div>
        )}
      </section>

      {loading || !trends || !habitStats ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-72 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] animate-pulse" />
          <div className="h-72 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] animate-pulse" />
        </div>
      ) : habitStats.habits.length === 0 ? (
        <section className="p-12 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-center">
          <p className="text-sm text-[var(--text-secondary)]">
            {tx(
              language,
              'No habits or tracking history available yet. Create habits and complete daily logs to populate charts and consistency tables.',
              'এখনও কোনো হ্যাবিট বা ট্র্যাকিং ইতিহাস নেই। চার্ট ও ধারাবাহিকতার টেবিল দেখতে হ্যাবিট তৈরি করে প্রতিদিনের লগ সম্পন্ন করুন।'
            )}
          </p>
        </section>
      ) : (
        <>
          {/* Charts Grid: Daily Line + Weekly Bar */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="p-6 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4">
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">
                  {tx(language, 'Daily Completion Rate (%)', 'দৈনিক সম্পন্ন করার হার (%)')}
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  {tx(
                    language,
                    `Completed ÷ scheduled occurrences per local day (${trends.range.label})`,
                    `প্রতিদিনের নির্ধারিত হ্যাবিটের বিপরীতে সম্পন্ন হার (${trends.range.label})`
                  )}
                </p>
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={trends.dailySeries.map((d) => ({
                      date: d.date.slice(5),
                      rate: d.overallCompletionRate,
                      completed: d.completedCount,
                      eligible: d.eligibleCount,
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#232922" />
                    <XAxis dataKey="date" stroke="#9BA397" fontSize={11} />
                    <YAxis domain={[0, 100]} stroke="#9BA397" fontSize={11} unit="%" />
                    <Tooltip content={<ChartTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="rate"
                      name={tx(language, 'Completion %', 'সম্পন্ন %')}
                      stroke="#C6FF00"
                      strokeWidth={2.2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="p-6 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4">
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">
                  {tx(language, 'Weekly Consistency Comparison', 'সাপ্তাহিক ধারাবাহিকতার তুলনা')}
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  {tx(
                    language,
                    'Last 8 calendar weeks aligned to your week-start setting',
                    'আপনার সপ্তাহ শুরুর সেটিং অনুযায়ী গত ৮ সপ্তাহের তুলনা'
                  )}
                </p>
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trends.weeklySeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#232922" />
                    <XAxis dataKey="label" stroke="#9BA397" fontSize={11} />
                    <YAxis domain={[0, 100]} stroke="#9BA397" fontSize={11} unit="%" />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar
                      dataKey="completionRate"
                      name={tx(language, 'Weekly Rate %', 'সাপ্তাহিক হার %')}
                      fill="#C6FF00"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>

          {/* Monthly Trend + Streak Comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="p-6 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4">
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">
                  {tx(language, '6-Month Completion Trend', '৬ মাসের সম্পন্নতার ট্রেন্ড')}
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  {tx(
                    language,
                    'Monthly scheduled attainment over the past 6 months',
                    'গত ৬ মাসের মাসিক নির্ধারিত অর্জনের চিত্র'
                  )}
                </p>
              </div>
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trends.monthlySeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#232922" />
                    <XAxis dataKey="label" stroke="#9BA397" fontSize={11} />
                    <YAxis domain={[0, 100]} stroke="#9BA397" fontSize={11} unit="%" />
                    <Tooltip content={<ChartTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="completionRate"
                      name={tx(language, 'Monthly %', 'মাসিক %')}
                      stroke="#C6FF00"
                      fill="#C6FF00"
                      fillOpacity={0.18}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="p-6 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4">
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">
                  {tx(
                    language,
                    'Current vs Longest Streak Comparison',
                    'বর্তমান বনাম সর্বোচ্চ ধারাবাহিকতার তুলনা'
                  )}
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  {tx(
                    language,
                    `Overall consistency streak: ${streaks?.currentStreak ?? 0}d current · ${streaks?.longestStreak ?? 0}d longest`,
                    `সামগ্রিক ধারাবাহিকতা: বর্তমান ${streaks?.currentStreak ?? 0} দিন · সর্বোচ্চ ${streaks?.longestStreak ?? 0} দিন`
                  )}
                </p>
              </div>
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={habitStats.habits.slice(0, 8).map((h) => ({
                      name: h.habitName.length > 16 ? `${h.habitName.slice(0, 16)}…` : h.habitName,
                      current: h.currentStreak,
                      longest: h.longestStreak,
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#232922" />
                    <XAxis dataKey="name" stroke="#9BA397" fontSize={10} />
                    <YAxis stroke="#9BA397" fontSize={11} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar
                      dataKey="current"
                      name={tx(language, 'Current Streak (d)', 'বর্তমান ধারা (দিন)')}
                      fill="#C6FF00"
                      radius={[3, 3, 0, 0]}
                    />
                    <Bar
                      dataKey="longest"
                      name={tx(language, 'Longest Streak (d)', 'সর্বোচ্চ ধারা (দিন)')}
                      fill="#38BDF8"
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>

          {/* 90-Day Consistency Heatmap */}
          <section className="p-6 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">
                  {tx(language, '90-Day Consistency Heatmap', '৯০ দিনের ধারাবাহিকতা হিটম্যাপ')}
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  {tx(
                    language,
                    'Each cell reflects daily scheduled completion over the trailing 90 days',
                    'গত ৯০ দিনের প্রতিদিনের নির্ধারিত হ্যাবিট সম্পন্নতার ঘনত্ব'
                  )}
                </p>
              </div>
              <span className="text-xs text-[var(--text-secondary)]">
                {tx(language, '0% → 100% scheduled completion', '০% → ১০০% নির্ধারিত সম্পন্নতা')}
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {trends.heatmap.map((d) => {
                const cellClass = !d.hasEligibleHabits
                  ? 'bg-[var(--bg-surface)]'
                  : d.overallCompletionRate >= 90
                  ? 'bg-[#C6FF00]'
                  : d.overallCompletionRate >= 60
                  ? 'bg-[#7DA300]'
                  : d.overallCompletionRate > 0
                  ? 'bg-[#3C4D08]'
                  : 'bg-[#1D221C]';

                return (
                  <div
                    key={d.date}
                    title={`${d.date}: ${
                      d.hasEligibleHabits
                        ? `${d.overallCompletionRate}% (${d.completedCount}/${d.eligibleCount})`
                        : tx(language, 'No scheduled habits', 'কোনো নির্ধারিত হ্যাবিট নেই')
                    }`}
                    className={`w-3.5 h-3.5 rounded-xs border border-[var(--border-subtle)] ${cellClass}`}
                  />
                );
              })}
            </div>
          </section>

          {/* Category Performance + Most Consistent & Most Missed */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <section className="p-6 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-3">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                {tx(language, 'Category Performance', 'ক্যাটাগরিভিত্তিক পারফরম্যান্স')}
              </h2>
              <div className="divide-y divide-[var(--border-subtle)] text-xs">
                {categoryStats.map((cat) => (
                  <div key={cat.category} className="py-2.5 flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-[var(--text-primary)]">
                        {translateCategory(cat.category, language)}
                      </p>
                      <p className="font-mono-num text-[var(--text-secondary)]">
                        {cat.completed}/{cat.eligible} {tx(language, 'scheduled', 'নির্ধারিত')}
                      </p>
                    </div>
                    <span className="font-semibold font-mono-num text-[var(--accent-lime)]">
                      {cat.completionRate}%
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="p-6 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-3">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                {tx(language, 'Most Consistent Habits', 'সবচেয়ে ধারাবাহিক হ্যাবিটসমূহ')}
              </h2>
              {habitStats.mostConsistent.length === 0 ? (
                <p className="text-xs text-[var(--text-secondary)]">
                  {tx(language, 'No eligible occurrences in range.', 'এই সীমায় কোনো নির্ধারিত হ্যাবিট নেই।')}
                </p>
              ) : (
                <div className="divide-y divide-[var(--border-subtle)] text-xs">
                  {habitStats.mostConsistent.map((h) => (
                    <div key={h.habitId} className="py-2.5 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-[var(--text-primary)] truncate">{h.habitName}</p>
                        <p className="font-mono-num text-[var(--text-secondary)]">
                          {h.completedOccurrences}/{h.eligibleOccurrences} {tx(language, 'done', 'সম্পন্ন')}
                        </p>
                      </div>
                      <span className="font-semibold font-mono-num text-[var(--accent-lime)]">
                        {h.completionRate}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="p-6 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-3">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                {tx(language, 'Most Missed Scheduled Occurrences', 'সবচেয়ে বেশি মিস হওয়া হ্যাবিট')}
              </h2>
              {habitStats.mostMissed.length === 0 ? (
                <p className="text-xs text-[var(--text-secondary)]">
                  {tx(
                    language,
                    'Zero missed scheduled occurrences in this period.',
                    'এই সময়ে কোনো নির্ধারিত হ্যাবিট মিস হয়নি।'
                  )}
                </p>
              ) : (
                <div className="divide-y divide-[var(--border-subtle)] text-xs">
                  {habitStats.mostMissed.map((h) => (
                    <div key={h.habitId} className="py-2.5 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-[var(--text-primary)] truncate">{h.habitName}</p>
                        <p className="font-mono-num text-[var(--text-secondary)]">
                          {h.completionRate}% {tx(language, 'completion rate', 'সম্পন্ন হার')}
                        </p>
                      </div>
                      <span className="font-semibold font-mono-num text-[#F87171]">
                        {h.missedOccurrences} {tx(language, 'missed', 'মিস')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Habit-by-Habit Completion Table */}
          <section className="rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] overflow-hidden">
            <div className="p-5 border-b border-[var(--border-subtle)]">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                {tx(
                  language,
                  'Habit-by-Habit Performance Breakdown',
                  'প্রতিটি হ্যাবিটের বিস্তারিত পারফরম্যান্স'
                )}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="bg-[var(--bg-surface)] text-[var(--text-secondary)] border-b border-[var(--border-subtle)]">
                  <tr>
                    <th className="py-3 px-4 font-medium">{tx(language, 'Habit', 'হ্যাবিট')}</th>
                    <th className="py-3 px-4 font-medium">{tx(language, 'Category', 'ক্যাটাগরি')}</th>
                    <th className="py-3 px-4 font-medium text-right">
                      {tx(language, 'Completed', 'সম্পন্ন')}
                    </th>
                    <th className="py-3 px-4 font-medium text-right">
                      {tx(language, 'Scheduled', 'নির্ধারিত')}
                    </th>
                    <th className="py-3 px-4 font-medium text-right">
                      {tx(language, 'Missed', 'মিস')}
                    </th>
                    <th className="py-3 px-4 font-medium text-right">
                      {tx(language, 'Rate', 'হার')}
                    </th>
                    <th className="py-3 px-4 font-medium text-right">
                      {tx(language, 'Streak (Best)', 'ধারা (সেরা)')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {habitStats.habits.map((h) => (
                    <tr key={h.habitId} className="hover:bg-[var(--bg-surface)]/40">
                      <td className="py-3 px-4 font-medium text-[var(--text-primary)]">
                        {h.habitName}
                        {h.lowSampleSize && (
                          <span className="ml-2 text-xs text-[var(--text-muted)]">
                            · {tx(language, 'Low sample', 'কম ডেটা')}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-[var(--text-secondary)]">
                        {translateCategory(h.category, language)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num text-[var(--text-primary)]">
                        {h.completedOccurrences}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num text-[var(--text-secondary)]">
                        {h.eligibleOccurrences}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num text-[var(--text-secondary)]">
                        {h.missedOccurrences}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num font-semibold text-[var(--accent-lime)]">
                        {h.eligibleOccurrences > 0 ? `${h.completionRate}%` : '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num text-[var(--text-primary)]">
                        {h.currentStreak}d ({h.longestStreak}d)
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
