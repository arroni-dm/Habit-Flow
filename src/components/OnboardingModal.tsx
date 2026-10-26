import React, { useState } from 'react';
import { Check, FileSpreadsheet, Layers, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { ApiError, apiFetch } from '../lib/api.ts';
import { SPREADSHEET_STARTER_HABITS, getAppName } from '../shared/config.ts';
import type { UserProfile } from '../shared/types.ts';
import { HabitIcon } from './HabitIcon.tsx';

interface OnboardingModalProps {
  onComplete: () => void;
  onOpenSpreadsheetImport: () => void;
}

export function OnboardingModal({
  onComplete,
  onOpenSpreadsheetImport,
}: OnboardingModalProps) {
  const { user, updateProfileState, refreshAuth, pushToast } = useAuth();
  const [mode, setMode] = useState<'blank' | 'starter' | 'import'>('blank');
  const [selectedStarterIndices, setSelectedStarterIndices] = useState<number[]>(
    SPREADSHEET_STARTER_HABITS.map((_, idx) => idx)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user || user.onboardingCompleted) return null;

  const toggleIndex = (idx: number) => {
    setSelectedStarterIndices((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
    );
  };

  const handleFinish = async () => {
    setSaving(true);
    setError(null);
    try {
      if (mode === 'starter' && selectedStarterIndices.length > 0) {
        const res = await apiFetch<{ createdCount: number }>('/api/habits/starter', {
          method: 'POST',
          body: JSON.stringify({ indices: selectedStarterIndices }),
        });
        updateProfileState({ ...user, onboardingCompleted: true });
        pushToast({
          message: `Added ${res.createdCount} starter habits to your workspace.`,
        });
        onComplete();
      } else if (mode === 'import') {
        const updated = await apiFetch<{ user: UserProfile }>('/api/profile', {
          method: 'PATCH',
          body: JSON.stringify({ onboardingCompleted: true }),
        });
        updateProfileState(updated.user);
        onOpenSpreadsheetImport();
        onComplete();
      } else {
        const updated = await apiFetch<{ user: UserProfile }>('/api/profile', {
          method: 'PATCH',
          body: JSON.stringify({ onboardingCompleted: true }),
        });
        updateProfileState(updated.user);
        onComplete();
      }
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 401) {
        await refreshAuth();
        return;
      }
      const msg = err?.message || 'Unable to initialize workspace. Please try again.';
      setError(msg);
      pushToast({ message: msg, tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="w-full max-w-2xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-xl p-6 sm:p-8 my-8 max-h-[90vh] overflow-y-auto">
        <div className="space-y-1.5 pb-5 border-b border-[var(--border-subtle)]">
          <h2 id="onboarding-title" className="text-xl font-bold font-display text-[var(--text-primary)]">
            Welcome to {getAppName()}, {user.name}
          </h2>
          <p className="text-sm text-[var(--text-secondary)]">
            Your workspace is configured for <strong>{user.timezone}</strong>. Choose how you want
            to initialize your habit library. No historical completions are ever fabricated.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-4 p-3.5 rounded-lg bg-[#2A1515] border border-[#5C2424] text-[#F87171] text-sm"
          >
            {error}
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => {
              setMode('blank');
              setError(null);
            }}
            className={`p-4 rounded-xl border text-left transition-colors ${
              mode === 'blank'
                ? 'border-[var(--accent-lime)] bg-[var(--bg-surface)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-panel)] hover:bg-[var(--bg-surface)]'
            }`}
          >
            <Sparkles className="w-5 h-5 text-[var(--accent-lime)] mb-2" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">Start Fresh</p>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              Begin with an empty workspace and create your own custom habits.
            </p>
          </button>

          <button
            type="button"
            onClick={() => {
              setMode('starter');
              setError(null);
            }}
            className={`p-4 rounded-xl border text-left transition-colors ${
              mode === 'starter'
                ? 'border-[var(--accent-lime)] bg-[var(--bg-surface)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-panel)] hover:bg-[var(--bg-surface)]'
            }`}
          >
            <Layers className="w-5 h-5 text-[var(--accent-lime)] mb-2" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">Starter Routine (10)</p>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              Optional full-day routine template inspired by the Habit Tracker workbook.
            </p>
          </button>

          <button
            type="button"
            onClick={() => {
              setMode('import');
              setError(null);
            }}
            className={`p-4 rounded-xl border text-left transition-colors ${
              mode === 'import'
                ? 'border-[var(--accent-lime)] bg-[var(--bg-surface)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-panel)] hover:bg-[var(--bg-surface)]'
            }`}
          >
            <FileSpreadsheet className="w-5 h-5 text-[var(--accent-lime)] mb-2" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">Upload Workbook</p>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              Import an existing .xlsx or .csv habit tracker spreadsheet with preview.
            </p>
          </button>
        </div>

        {mode === 'starter' && (
          <div className="mt-5 space-y-2.5">
            <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
              <span>Select which starter habits to include (starting today):</span>
              <button
                type="button"
                onClick={() =>
                  setSelectedStarterIndices(
                    selectedStarterIndices.length === SPREADSHEET_STARTER_HABITS.length
                      ? []
                      : SPREADSHEET_STARTER_HABITS.map((_, i) => i)
                  )
                }
                className="text-[var(--accent-lime)] hover:underline"
              >
                {selectedStarterIndices.length === SPREADSHEET_STARTER_HABITS.length
                  ? 'Clear all'
                  : 'Select all'}
              </button>
            </div>
            <div className="border border-[var(--border-subtle)] rounded-lg divide-y divide-[var(--border-subtle)] max-h-60 overflow-y-auto">
              {SPREADSHEET_STARTER_HABITS.map((tpl, idx) => {
                const checked = selectedStarterIndices.includes(idx);
                return (
                  <button
                    key={tpl.name}
                    type="button"
                    onClick={() => toggleIndex(idx)}
                    className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-[var(--bg-surface)] transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={`w-5 h-5 rounded flex items-center justify-center border shrink-0 ${
                          checked
                            ? 'bg-[var(--accent-lime)] border-transparent text-[var(--accent-ink)]'
                            : 'border-[var(--border-strong)] bg-transparent'
                        }`}
                      >
                        {checked && <Check className="w-3.5 h-3.5" />}
                      </span>
                      <HabitIcon name={tpl.icon} className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs sm:text-sm font-medium text-[var(--text-primary)] truncate">
                          {tpl.name}
                        </p>
                        <p className="text-xs text-[var(--text-secondary)]">
                          {tpl.category} · {tpl.scheduleType === 'weekdays' ? 'Mon–Fri' : 'Daily'}
                          {tpl.habitType !== 'boolean' ? ` · ${tpl.targetValue} ${tpl.targetUnit}` : ''}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-[var(--border-subtle)] flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={saving || (mode === 'starter' && selectedStarterIndices.length === 0)}
            onClick={() => void handleFinish()}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-[var(--accent-lime)] text-[var(--accent-ink)] hover:bg-[var(--accent-lime-hover)] transition-colors disabled:opacity-50"
          >
            {saving
              ? 'Configuring...'
              : mode === 'starter'
              ? `Add ${selectedStarterIndices.length} Starter Habit(s)`
              : mode === 'import'
              ? 'Continue to Workbook Upload'
              : 'Enter Workspace'}
          </button>
        </div>
      </div>
    </div>
  );
}
