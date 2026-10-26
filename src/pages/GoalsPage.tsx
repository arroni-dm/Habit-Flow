import React, { useCallback, useEffect, useState } from 'react';
import { Check, Plus, Target, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { tx } from '../lib/i18n.ts';
import { addDays } from '../shared/dates.ts';
import type { GoalType, GoalWithProgress, HabitRecord } from '../shared/types.ts';

function ProgressBarSvg({ percentage }: { percentage: number }) {
  const safe = Math.max(0, Math.min(100, Number.isFinite(percentage) ? percentage : 0));
  return (
    <svg
      className="w-full h-2 rounded-full overflow-hidden block"
      role="progressbar"
      aria-valuenow={Math.round(safe)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <rect width="100%" height="100%" fill="var(--bg-surface)" />
      <rect width={`${safe}%`} height="100%" fill="var(--accent-lime)" />
    </svg>
  );
}

export function GoalsPage({ refreshSignal }: { refreshSignal: number }) {
  const { language, pushToast } = useAuth();
  const [goalsList, setGoalsList] = useState<GoalWithProgress[]>([]);
  const [habitsList, setHabitsList] = useState<HabitRecord[]>([]);
  const [userToday, setUserToday] = useState('');
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState<'active' | 'completed' | 'all'>('active');

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [title, setTitle] = useState('');
  const [goalType, setGoalType] = useState<GoalType>('weekly_consistency');
  const [habitId, setHabitId] = useState<string>('');
  const [targetValue, setTargetValue] = useState('85');
  const [targetUnit, setTargetUnit] = useState('%');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [saving, setSaving] = useState(false);

  const loadGoals = useCallback(async () => {
    setLoading(true);
    try {
      const [goalsRes, habitsRes] = await Promise.all([
        apiFetch<{ goals: GoalWithProgress[]; userToday: string }>('/api/goals'),
        apiFetch<{ habits: HabitRecord[] }>('/api/habits?status=active'),
      ]);
      setGoalsList(goalsRes.goals);
      setUserToday(goalsRes.userToday);
      setHabitsList(habitsRes.habits);
      if (!startDate && goalsRes.userToday) {
        setStartDate(goalsRes.userToday);
        setEndDate(addDays(goalsRes.userToday, 29));
      }
    } catch (err: any) {
      pushToast({ message: err?.message || 'Failed to load goals.', tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, [pushToast, startDate]);

  useEffect(() => {
    void loadGoals();
  }, [loadGoals, refreshSignal]);

  const handleCreateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/goals', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          goalType,
          habitId: goalType === 'habit_target' && habitId ? Number(habitId) : null,
          targetValue: Number(targetValue),
          targetUnit: goalType === 'habit_target' ? targetUnit.trim() || 'completions' : '%',
          startDate,
          endDate,
          status: 'active',
        }),
      });
      setTitle('');
      setShowCreateForm(false);
      await loadGoals();
      pushToast({ message: 'Goal created.' });
    } catch (err: any) {
      pushToast({ message: err?.message || 'Could not create goal.', tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleCompletedStatus = async (goal: GoalWithProgress) => {
    const nextStatus = goal.status === 'completed' ? 'active' : 'completed';
    try {
      await apiFetch(`/api/goals/${goal.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      await loadGoals();
      pushToast({
        message: nextStatus === 'completed' ? 'Marked goal complete.' : 'Reopened goal.',
      });
    } catch (err: any) {
      pushToast({ message: err?.message || 'Could not update goal.', tone: 'error' });
    }
  };

  const handleDeleteGoal = async (goalId: number) => {
    try {
      await apiFetch(`/api/goals/${goalId}`, { method: 'DELETE' });
      await loadGoals();
      pushToast({ message: 'Deleted goal.' });
    } catch (err: any) {
      pushToast({ message: err?.message || 'Could not delete goal.', tone: 'error' });
    }
  };

  const displayedGoals = goalsList.filter((g) => {
    if (filterTab === 'active') return g.status === 'active';
    if (filterTab === 'completed') return g.status === 'completed' || g.isTargetReached;
    return true;
  });

  const GOAL_TYPE_LABELS: Record<GoalType, string> = {
    daily_completion: tx(language, 'Daily Completion Goal', 'দৈনিক সম্পন্ন লক্ষ্য'),
    weekly_consistency: tx(language, 'Weekly Consistency Goal', 'সাপ্তাহিক ধারাবাহিকতার লক্ষ্য'),
    monthly_completion: tx(language, 'Monthly Habit Goal', 'মাসিক হ্যাবিট লক্ষ্য'),
    habit_target: tx(language, 'Per-Habit Target', 'নির্দিষ্ট হ্যাবিট লক্ষ্য'),
  };

  return (
    <div className="space-y-6">
      <section className="p-5 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
          {(
            [
              { id: 'active', label: tx(language, 'Active Goals', 'সক্রিয় লক্ষ্য') },
              { id: 'completed', label: tx(language, 'Completed / Reached', 'সম্পন্ন / অর্জিত') },
              { id: 'all', label: tx(language, 'All Goals', 'সকল লক্ষ্য') },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterTab(tab.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap ${
                filterTab === tab.id
                  ? 'bg-[var(--bg-panel)] text-[var(--text-primary)] font-semibold'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setShowCreateForm((s) => !s)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold bg-[var(--accent-lime)] text-[var(--accent-ink)] hover:bg-[var(--accent-lime-hover)] whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          <span>
            {showCreateForm
              ? tx(language, 'Close Form', 'ফর্ম বন্ধ করুন')
              : tx(language, 'New Goal', 'নতুন লক্ষ্য')}
          </span>
        </button>
      </section>

      {showCreateForm && (
        <form
          onSubmit={handleCreateGoal}
          className="p-6 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4"
        >
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {tx(language, 'Configure Goal', 'লক্ষ্য নির্ধারণ করুন')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label htmlFor="goal-title" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                {tx(language, 'Goal title', 'লক্ষ্যের শিরোনাম')}
              </label>
              <input
                id="goal-title"
                type="text"
                required
                maxLength={140}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={tx(
                  language,
                  'e.g., Maintain 85% weekly consistency this month',
                  'যেমন: এই মাসে ৮৫% সাপ্তাহিক ধারাবাহিকতা বজায় রাখা'
                )}
                className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)]"
              />
            </div>

            <div>
              <label htmlFor="goal-type" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                {tx(language, 'Goal type', 'লক্ষ্যের ধরন')}
              </label>
              <select
                id="goal-type"
                value={goalType}
                onChange={(e) => {
                  const next = e.target.value as GoalType;
                  setGoalType(next);
                  if (next === 'habit_target') {
                    setTargetValue('20');
                    setTargetUnit('completions');
                  } else {
                    setTargetValue('85');
                    setTargetUnit('%');
                  }
                }}
                className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)]"
              >
                <option value="daily_completion">
                  {tx(language, 'Daily completion goal (%)', 'দৈনিক সম্পন্ন লক্ষ্য (%)')}
                </option>
                <option value="weekly_consistency">
                  {tx(language, 'Weekly consistency goal (%)', 'সাপ্তাহিক ধারাবাহিকতার লক্ষ্য (%)')}
                </option>
                <option value="monthly_completion">
                  {tx(language, 'Monthly habit goal (%)', 'মাসিক হ্যাবিট লক্ষ্য (%)')}
                </option>
                <option value="habit_target">
                  {tx(language, 'Per-habit target', 'নির্দিষ্ট হ্যাবিট লক্ষ্য')}
                </option>
              </select>
            </div>

            {goalType === 'habit_target' ? (
              <div>
                <label htmlFor="goal-habit" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  {tx(language, 'Linked habit', 'সংযুক্ত হ্যাবিট')}
                </label>
                <select
                  id="goal-habit"
                  required
                  value={habitId}
                  onChange={(e) => setHabitId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)]"
                >
                  <option value="">{tx(language, 'Select a habit...', 'হ্যাবিট নির্বাচন করুন...')}</option>
                  {habitsList.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label htmlFor="goal-target" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  {tx(language, 'Target completion rate (%)', 'লক্ষ্যমাত্রা সম্পন্ন হার (%)')}
                </label>
                <input
                  id="goal-target"
                  type="number"
                  min={1}
                  max={100}
                  required
                  value={targetValue}
                  onChange={(e) => setTargetValue(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm font-mono-num text-[var(--text-primary)]"
                />
              </div>
            )}

            {goalType === 'habit_target' && (
              <>
                <div>
                  <label htmlFor="goal-habit-val" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                    {tx(language, 'Target value', 'লক্ষ্যমাত্রার মান')}
                  </label>
                  <input
                    id="goal-habit-val"
                    type="number"
                    min={1}
                    step="any"
                    required
                    value={targetValue}
                    onChange={(e) => setTargetValue(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm font-mono-num text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <label htmlFor="goal-habit-unit" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                    {tx(language, 'Target metric', 'লক্ষ্যমাত্রার একক')}
                  </label>
                  <select
                    id="goal-habit-unit"
                    value={targetUnit}
                    onChange={(e) => setTargetUnit(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)]"
                  >
                    <option value="completions">
                      {tx(language, 'Scheduled completions', 'নির্ধারিত সম্পন্ন সংখ্যা')}
                    </option>
                    <option value="minutes">{tx(language, 'Total minutes', 'মোট মিনিট')}</option>
                    <option value="units">{tx(language, 'Total numeric count', 'মোট সংখ্যা')}</option>
                  </select>
                </div>
              </>
            )}

            <div>
              <label htmlFor="goal-start" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                {tx(language, 'Start date', 'শুরুর তারিখ')}
              </label>
              <input
                id="goal-start"
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3.5 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm font-mono-num text-[var(--text-primary)]"
              />
            </div>

            <div>
              <label htmlFor="goal-end" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                {tx(language, 'End date', 'শেষ তারিখ')}
              </label>
              <input
                id="goal-end"
                type="date"
                required
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3.5 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm font-mono-num text-[var(--text-primary)]"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="px-4 py-2 rounded-lg text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              {tx(language, 'Cancel', 'বাতিল')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-[var(--accent-lime)] text-[var(--accent-ink)] disabled:opacity-50"
            >
              {saving
                ? tx(language, 'Saving...', 'সংরক্ষণ হচ্ছে...')
                : tx(language, 'Save Goal', 'লক্ষ্য সংরক্ষণ করুন')}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="h-40 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] animate-pulse" />
          <div className="h-40 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] animate-pulse" />
        </div>
      ) : displayedGoals.length === 0 ? (
        <section className="p-12 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-center space-y-3">
          <Target className="w-7 h-7 text-[var(--accent-lime)] mx-auto" />
          <p className="text-sm text-[var(--text-secondary)]">
            {tx(
              language,
              `No ${filterTab === 'all' ? '' : `${filterTab} `}goals configured yet. Set a daily, weekly, monthly, or per-habit target to measure progress over a defined date window.`,
              'এখনও কোনো লক্ষ্য নির্ধারণ করা হয়নি। নির্দিষ্ট সময়ের অগ্রগতি মাপতে দৈনিক, সাপ্তাহিক, মাসিক বা হ্যাবিটভিত্তিক লক্ষ্য সেট করুন।'
            )}
          </p>
        </section>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {displayedGoals.map((goal) => {
            const isPastEnd = Boolean(userToday && goal.endDate < userToday);
            return (
              <section
                key={goal.id}
                className="p-5 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4 flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-[var(--text-primary)]">
                        {goal.title}
                      </h3>
                      <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                        {GOAL_TYPE_LABELS[goal.goalType]}
                        {goal.habitName ? ` · ${goal.habitName}` : ''}
                        {' · '}
                        <span className="font-mono-num">
                          {goal.startDate} {tx(language, 'to', 'থেকে')} {goal.endDate}
                        </span>
                      </p>
                    </div>
                    <span className="text-sm font-bold font-mono-num text-[var(--accent-lime)] shrink-0">
                      {goal.progressPct}%
                    </span>
                  </div>

                  <ProgressBarSvg percentage={goal.progressPct} />

                  <p className="text-xs text-[var(--text-secondary)] font-mono-num">
                    {goal.summaryText}
                  </p>
                </div>

                <div className="pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between gap-2 text-xs">
                  <span className="text-[var(--text-secondary)]">
                    {goal.isTargetReached
                      ? tx(language, 'Target reached based on verified logs', 'লগ অনুযায়ী লক্ষ্য অর্জিত হয়েছে')
                      : isPastEnd
                      ? tx(language, 'Window concluded — adjust target anytime', 'সময়সীমা শেষ — যেকোনো সময় আপডেট করুন')
                      : tx(language, 'In progress', 'চলমান')}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleToggleCompletedStatus(goal)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] whitespace-nowrap"
                    >
                      <Check className="w-3.5 h-3.5 text-[var(--accent-lime)]" />
                      <span>
                        {goal.status === 'completed'
                          ? tx(language, 'Reopen', 'পুনরায় খুলুন')
                          : tx(language, 'Archive Complete', 'সম্পন্ন হিসেবে রাখুন')}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteGoal(goal.id)}
                      aria-label={`Delete goal ${goal.title}`}
                      className="p-1.5 rounded-md text-[var(--text-secondary)] hover:text-[#F87171]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
