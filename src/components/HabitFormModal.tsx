import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { translateCategory, tx } from '../lib/i18n.ts';
import {
  HABIT_ACCENT_COLORS,
  HABIT_CATEGORIES,
  HABIT_ICONS,
} from '../shared/config.ts';
import type { HabitPriority, HabitRecord, HabitType, ScheduleType } from '../shared/types.ts';
import { HabitIcon } from './HabitIcon.tsx';

const COLOR_SWATCH_CLASSES: Record<string, string> = {
  '#C6FF00': 'bg-[#C6FF00]',
  '#34D399': 'bg-[#34D399]',
  '#38BDF8': 'bg-[#38BDF8]',
  '#FBBF24': 'bg-[#FBBF24]',
  '#FB7185': 'bg-[#FB7185]',
  '#2DD4BF': 'bg-[#2DD4BF]',
  '#818CF8': 'bg-[#818CF8]',
  '#FB923C': 'bg-[#FB923C]',
};

export function getAccentBgClass(hex: string): string {
  return COLOR_SWATCH_CLASSES[hex] || 'bg-[#C6FF00]';
}

interface HabitFormModalProps {
  open: boolean;
  defaultStartDate: string;
  editingHabit?: HabitRecord | null;
  onClose: () => void;
  onSaved: (habit: HabitRecord) => void;
}

const WEEKDAY_OPTIONS = [
  { value: 1, en: 'Mon', bn: 'সোম' },
  { value: 2, en: 'Tue', bn: 'মঙ্গল' },
  { value: 3, en: 'Wed', bn: 'বুধ' },
  { value: 4, en: 'Thu', bn: 'বৃহঃ' },
  { value: 5, en: 'Fri', bn: 'শুক্র' },
  { value: 6, en: 'Sat', bn: 'শনি' },
  { value: 0, en: 'Sun', bn: 'রবি' },
];

type ScheduleChoice = ScheduleType | 'single_day';

export function HabitFormModal({
  open,
  defaultStartDate,
  editingHabit,
  onClose,
  onSaved,
}: HabitFormModalProps) {
  const { language } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string>(HABIT_CATEGORIES[0]);
  const [customCategory, setCustomCategory] = useState('');
  const [icon, setIcon] = useState<string>('CheckCircle2');
  const [color, setColor] = useState<string>('#C6FF00');
  const [habitType, setHabitType] = useState<HabitType>('boolean');
  const [scheduleChoice, setScheduleChoice] = useState<ScheduleChoice>('daily');
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 3, 5]);
  const [allowPartial, setAllowPartial] = useState(false);
  const [targetValue, setTargetValue] = useState('1');
  const [targetUnit, setTargetUnit] = useState('');
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState('');
  const [reminderTime, setReminderTime] = useState('');
  const [completionDeadline, setCompletionDeadline] = useState('');
  const [priority, setPriority] = useState<HabitPriority>('medium');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editingHabit) {
      setName(editingHabit.name);
      setDescription(editingHabit.description || '');
      const knownCat = (HABIT_CATEGORIES as readonly string[]).includes(editingHabit.category);
      setCategory(knownCat ? editingHabit.category : 'Custom');
      setCustomCategory(knownCat ? '' : editingHabit.category);
      setIcon(editingHabit.icon || 'CheckCircle2');
      setColor(editingHabit.color || '#C6FF00');
      setHabitType(editingHabit.habitType);
      const isSingleDay =
        editingHabit.scheduleType === 'daily' &&
        Boolean(editingHabit.endDate) &&
        editingHabit.endDate === editingHabit.startDate;
      setScheduleChoice(isSingleDay ? 'single_day' : editingHabit.scheduleType);
      setDaysOfWeek(editingHabit.scheduleConfig?.daysOfWeek || [1, 3, 5]);
      setAllowPartial(Boolean(editingHabit.scheduleConfig?.allowPartialCompletion));
      setTargetValue(String(editingHabit.targetValue ?? 1));
      setTargetUnit(editingHabit.targetUnit || '');
      setStartDate(editingHabit.startDate || defaultStartDate);
      setEndDate(editingHabit.endDate || '');
      setReminderTime(editingHabit.reminderTime || '');
      setCompletionDeadline(editingHabit.completionDeadline || '');
      setPriority(editingHabit.priority);
    } else {
      setName('');
      setDescription('');
      setCategory(HABIT_CATEGORIES[0]);
      setCustomCategory('');
      setIcon('CheckCircle2');
      setColor('#C6FF00');
      setHabitType('boolean');
      setScheduleChoice('daily');
      setDaysOfWeek([1, 3, 5]);
      setAllowPartial(false);
      setTargetValue('1');
      setTargetUnit('');
      setStartDate(defaultStartDate);
      setEndDate('');
      setReminderTime('');
      setCompletionDeadline('');
      setPriority('medium');
    }
  }, [open, editingHabit, defaultStartDate]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const toggleWeekday = (day: number) => {
    setDaysOfWeek((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const resolvedCategory =
      category === 'Custom' && customCategory.trim()
        ? customCategory.trim()
        : category;

    const parsedTarget = habitType === 'boolean' ? 1 : Number(targetValue);
    if (!Number.isFinite(parsedTarget) || parsedTarget <= 0) {
      setError(
        tx(
          language,
          'Enter a target value greater than zero.',
          'শূন্যের চেয়ে বড় একটি লক্ষ্য মান লিখুন।'
        )
      );
      return;
    }

    if (scheduleChoice === 'custom_days' && daysOfWeek.length === 0) {
      setError(
        tx(
          language,
          'Select at least one weekday for a custom schedule.',
          'কাস্টম সময়সূচির জন্য অন্তত একটি বার নির্বাচন করুন।'
        )
      );
      return;
    }

    const resolvedScheduleType: ScheduleType =
      scheduleChoice === 'single_day' ? 'daily' : scheduleChoice;
    const resolvedEndDate =
      scheduleChoice === 'single_day' ? startDate : endDate || null;

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        category: resolvedCategory,
        icon,
        color,
        habitType,
        scheduleType: resolvedScheduleType,
        scheduleConfig: {
          daysOfWeek: resolvedScheduleType === 'custom_days' ? daysOfWeek : undefined,
          allowPartialCompletion: habitType !== 'boolean' ? allowPartial : undefined,
        },
        targetValue: parsedTarget,
        targetUnit:
          habitType === 'boolean'
            ? null
            : targetUnit.trim() || (habitType === 'duration' ? 'minutes' : 'units'),
        startDate,
        endDate: resolvedEndDate,
        reminderTime: reminderTime || null,
        completionDeadline: completionDeadline || null,
        priority,
      };

      const res = editingHabit
        ? await apiFetch<{ habit: HabitRecord }>(`/api/habits/${editingHabit.id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        : await apiFetch<{ habit: HabitRecord }>('/api/habits', {
            method: 'POST',
            body: JSON.stringify(payload),
          });

      onSaved(res.habit);
      onClose();
    } catch (err: any) {
      setError(err?.message || tx(language, 'Failed to save habit.', 'হ্যাবিট সংরক্ষণ করা যায়নি।'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="habit-modal-title"
    >
      <div className="w-full max-w-2xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-xl p-6 my-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-[var(--border-subtle)]">
          <div>
            <h2 id="habit-modal-title" className="text-lg font-semibold text-[var(--text-primary)]">
              {editingHabit
                ? tx(language, 'Edit Habit', 'হ্যাবিট সম্পাদনা করুন')
                : tx(language, 'Create Habit', 'নতুন হ্যাবিট তৈরি করুন')}
            </h2>
            {!editingHabit && startDate && (
              <p className="text-xs font-mono-num text-[var(--text-secondary)] mt-0.5">
                {scheduleChoice === 'single_day'
                  ? tx(language, `Scheduled on ${startDate}`, `নির্ধারিত তারিখ: ${startDate}`)
                  : tx(language, `Starting from ${startDate}`, `শুরুর তারিখ: ${startDate}`)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-5">
          {error && (
            <div role="alert" className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-[var(--status-danger)] text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label htmlFor="habit-name-input" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                {tx(language, 'Habit name', 'হ্যাবিটের নাম')}
              </label>
              <input
                id="habit-name-input"
                type="text"
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={tx(
                  language,
                  'e.g., Morning Walk From 5:30 AM to 6:30 AM',
                  'যেমন: সকাল ৬টায় ৩০ মিনিট হাঁটা'
                )}
                className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="habit-desc-input" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                {tx(language, 'Description (optional)', 'বিবরণ (ঐচ্ছিক)')}
              </label>
              <input
                id="habit-desc-input"
                type="text"
                maxLength={500}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={tx(
                  language,
                  'Context, cue, or implementation intention',
                  'কখন বা কীভাবে করবেন তার সংক্ষিপ্ত নোট'
                )}
                className="w-full px-3.5 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
            </div>

            <div>
              <label htmlFor="habit-category-select" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                {tx(language, 'Category', 'ক্যাটাগরি')}
              </label>
              <select
                id="habit-category-select"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)]"
              >
                {HABIT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {translateCategory(c, language)}
                  </option>
                ))}
              </select>
              {category === 'Custom' && (
                <input
                  type="text"
                  maxLength={60}
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  placeholder={tx(language, 'Enter custom category', 'কাস্টম ক্যাটাগরির নাম লিখুন')}
                  className="mt-2 w-full px-3.5 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)]"
                />
              )}
            </div>

            <div>
              <label htmlFor="habit-priority-select" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                {tx(language, 'Priority', 'অগ্রাধিকার')}
              </label>
              <select
                id="habit-priority-select"
                value={priority}
                onChange={(e) => setPriority(e.target.value as HabitPriority)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)]"
              >
                <option value="high">{tx(language, 'High priority', 'উচ্চ অগ্রাধিকার')}</option>
                <option value="medium">{tx(language, 'Medium priority', 'মাঝারি অগ্রাধিকার')}</option>
                <option value="low">{tx(language, 'Low priority', 'নিম্ন অগ্রাধিকার')}</option>
              </select>
            </div>
          </div>

          {/* Habit Type */}
          <div>
            <span className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              {tx(language, 'Tracking mode', 'ট্র্যাকিং ধরন')}
            </span>
            <div className="grid grid-cols-3 gap-2 p-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              {(
                [
                  { id: 'boolean', en: 'Checkmark', bn: 'চেকমার্ক' },
                  { id: 'count', en: 'Numeric Count', bn: 'সংখ্যা গণনা' },
                  { id: 'duration', en: 'Duration', bn: 'সময়কাল' },
                ] as const
              ).map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => {
                    setHabitType(mode.id);
                    if (mode.id === 'duration' && (!targetUnit || targetUnit === 'glasses')) {
                      setTargetUnit('minutes');
                      setTargetValue('30');
                    } else if (mode.id === 'count' && (!targetUnit || targetUnit === 'minutes')) {
                      setTargetUnit('glasses');
                      setTargetValue('8');
                    }
                  }}
                  className={`py-2 px-3 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    habitType === mode.id
                      ? 'bg-[var(--accent-lime)] text-[var(--accent-ink)] font-semibold'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {tx(language, mode.en, mode.bn)}
                </button>
              ))}
            </div>
          </div>

          {habitType !== 'boolean' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="habit-target-value" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  {tx(language, 'Daily target', 'দৈনিক লক্ষ্য')}
                </label>
                <input
                  id="habit-target-value"
                  type="number"
                  step="any"
                  min="0.1"
                  required
                  value={targetValue}
                  onChange={(e) => setTargetValue(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm font-mono-num text-[var(--text-primary)]"
                />
              </div>

              <div>
                <label htmlFor="habit-target-unit" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  {tx(language, 'Unit', 'একক')}
                </label>
                {habitType === 'duration' ? (
                  <select
                    id="habit-target-unit"
                    value={targetUnit || 'minutes'}
                    onChange={(e) => setTargetUnit(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)]"
                  >
                    <option value="minutes">{tx(language, 'Minutes', 'মিনিট')}</option>
                    <option value="hours">{tx(language, 'Hours', 'ঘণ্টা')}</option>
                  </select>
                ) : (
                  <input
                    id="habit-target-unit"
                    type="text"
                    maxLength={32}
                    value={targetUnit}
                    onChange={(e) => setTargetUnit(e.target.value)}
                    placeholder={tx(language, 'glasses, pages, reps', 'গ্লাস, পৃষ্ঠা, বার')}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)]"
                  />
                )}
              </div>

              <label className="sm:col-span-2 flex items-center gap-2.5 text-xs text-[var(--text-secondary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowPartial}
                  onChange={(e) => setAllowPartial(e.target.checked)}
                  className="w-4 h-4 rounded accent-[#C6FF00]"
                />
                <span>
                  {tx(
                    language,
                    'Allow manually marking partial progress as completed for the day',
                    'আংশিক অগ্রগতি হলেও দিনের জন্য সম্পন্ন হিসেবে চিহ্নিত করার অনুমতি দিন'
                  )}
                </span>
              </label>
            </div>
          )}

          {/* Schedule */}
          <div className="space-y-3">
            <label htmlFor="habit-schedule-select" className="block text-xs font-medium text-[var(--text-secondary)]">
              {tx(language, 'Schedule', 'সময়সূচি')}
            </label>
            <select
              id="habit-schedule-select"
              value={scheduleChoice}
              onChange={(e) => {
                const nextChoice = e.target.value as ScheduleChoice;
                setScheduleChoice(nextChoice);
                if (nextChoice === 'single_day') {
                  setEndDate(startDate);
                } else if (scheduleChoice === 'single_day' && endDate === startDate) {
                  setEndDate('');
                }
              }}
              className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)]"
            >
              <option value="daily">{tx(language, 'Every day', 'প্রতিদিন')}</option>
              <option value="single_day">
                {tx(language, 'Only on start date (one-time)', 'শুধুমাত্র শুরুর তারিখে (একবার)')}
              </option>
              <option value="weekdays">
                {tx(language, 'Weekdays (Mon–Fri)', 'সপ্তাহের কার্যদিবস (সোম–শুক্র)')}
              </option>
              <option value="weekends">
                {tx(language, 'Weekends (Sat–Sun)', 'সপ্তাহান্তে (শনি–রবি)')}
              </option>
              <option value="custom_days">
                {tx(language, 'Selected weekdays', 'নির্বাচিত বারসমূহ')}
              </option>
            </select>

            {scheduleChoice === 'custom_days' && (
              <div className="flex flex-wrap gap-2">
                {WEEKDAY_OPTIONS.map((d) => {
                  const selected = daysOfWeek.includes(d.value);
                  return (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => toggleWeekday(d.value)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        selected
                          ? 'bg-[var(--accent-lime)] text-[var(--accent-ink)] border-transparent font-semibold'
                          : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {tx(language, d.en, d.bn)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Dates & Times */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="habit-start-date" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                {tx(language, 'Start date', 'শুরুর তারিখ')}
              </label>
              <input
                id="habit-start-date"
                type="date"
                required
                value={startDate}
                onChange={(e) => {
                  const nextStart = e.target.value;
                  setStartDate(nextStart);
                  if (scheduleChoice === 'single_day') {
                    setEndDate(nextStart);
                  }
                }}
                className="w-full px-3.5 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm font-mono-num text-[var(--text-primary)]"
              />
            </div>
            <div>
              <label htmlFor="habit-end-date" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                {tx(language, 'End date (optional)', 'শেষের তারিখ (ঐচ্ছিক)')}
              </label>
              <input
                id="habit-end-date"
                type="date"
                disabled={scheduleChoice === 'single_day'}
                value={scheduleChoice === 'single_day' ? startDate : endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3.5 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm font-mono-num text-[var(--text-primary)] disabled:opacity-60"
              />
            </div>

            <div>
              <label htmlFor="habit-reminder-time" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                {tx(language, 'Reminder time (optional)', 'রিমাইন্ডার সময় (ঐচ্ছিক)')}
              </label>
              <input
                id="habit-reminder-time"
                type="time"
                value={reminderTime}
                onChange={(e) => setReminderTime(e.target.value)}
                className="w-full px-3.5 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm font-mono-num text-[var(--text-primary)]"
              />
            </div>
            <div>
              <label htmlFor="habit-deadline-time" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                {tx(language, 'Completion deadline (optional)', 'সম্পন্নের শেষ সময় (ঐচ্ছিক)')}
              </label>
              <input
                id="habit-deadline-time"
                type="time"
                value={completionDeadline}
                onChange={(e) => setCompletionDeadline(e.target.value)}
                className="w-full px-3.5 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm font-mono-num text-[var(--text-primary)]"
              />
            </div>
          </div>

          {/* Icon & Accent Color */}
          <div className="space-y-3">
            <span className="block text-xs font-medium text-[var(--text-secondary)]">
              {tx(language, 'Icon', 'আইকন')}
            </span>
            <div className="flex flex-wrap gap-2">
              {HABIT_ICONS.map((ic) => (
                <button
                  key={ic}
                  type="button"
                  onClick={() => setIcon(ic)}
                  aria-label={`Select ${ic} icon`}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center border transition-colors ${
                    icon === ic
                      ? 'bg-[var(--accent-lime)] text-[var(--accent-ink)] border-transparent'
                      : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <HabitIcon name={ic} className="w-4 h-4" />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <span className="block text-xs font-medium text-[var(--text-secondary)]">
              {tx(language, 'Accent color', 'রঙ নির্বাচন')}
            </span>
            <div className="flex flex-wrap gap-2.5">
              {HABIT_ACCENT_COLORS.map((swatch) => (
                <button
                  key={swatch.value}
                  type="button"
                  onClick={() => setColor(swatch.value)}
                  aria-label={`Select ${swatch.name} color`}
                  className={`w-8 h-8 rounded-full ${getAccentBgClass(swatch.value)} transition-transform ${
                    color === swatch.value
                      ? 'ring-2 ring-[var(--text-primary)] ring-offset-2 ring-offset-[var(--bg-panel)] scale-110'
                      : 'opacity-80 hover:opacity-100'
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors whitespace-nowrap"
            >
              {tx(language, 'Cancel', 'বাতিল')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-lg text-sm font-semibold bg-[var(--accent-lime)] text-[var(--accent-ink)] hover:bg-[var(--accent-lime-hover)] transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {saving
                ? tx(language, 'Saving...', 'সংরক্ষণ হচ্ছে...')
                : editingHabit
                ? tx(language, 'Save Changes', 'পরিবর্তন সংরক্ষণ করুন')
                : tx(language, 'Create Habit', 'হ্যাবিট তৈরি করুন')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
