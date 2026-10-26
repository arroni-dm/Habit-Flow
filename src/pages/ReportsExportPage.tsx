import React, { useEffect, useState } from 'react';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch, downloadAuthenticatedCsv } from '../lib/api.ts';
import { translateCategory, tx } from '../lib/i18n.ts';
import { addDays, getLocalDateInTimezone } from '../shared/dates.ts';
import type { HabitStreakSummary } from '../shared/types.ts';

interface ReportsExportPageProps {
  refreshSignal: number;
  onOpenImportModal: () => void;
}

export function ReportsExportPage({
  refreshSignal,
  onOpenImportModal,
}: ReportsExportPageProps) {
  const { user, language, pushToast } = useAuth();
  const initialToday = user ? getLocalDateInTimezone(new Date(), user.timezone) : '2026-10-25';

  const [startDate, setStartDate] = useState(addDays(initialToday, -29));
  const [endDate, setEndDate] = useState(initialToday);
  const [reportRows, setReportRows] = useState<HabitStreakSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportingType, setExportingType] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const loadPreviewReport = async () => {
      setLoading(true);
      try {
        const res = await apiFetch<{ habits: HabitStreakSummary[] }>(
          `/api/analytics/habits?preset=custom&start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`
        );
        if (active) setReportRows(res.habits);
      } catch (err: any) {
        if (active) {
          pushToast({ message: err?.message || 'Failed to load report preview.', tone: 'error' });
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadPreviewReport();
    return () => {
      active = false;
    };
  }, [startDate, endDate, refreshSignal, pushToast]);

  const handleExport = async (kind: 'habits' | 'logs' | 'report') => {
    setExportingType(kind);
    try {
      if (kind === 'habits') {
        await downloadAuthenticatedCsv('/api/exports/habits.csv', 'habitflow-habits.csv');
      } else if (kind === 'logs') {
        await downloadAuthenticatedCsv(
          `/api/exports/logs.csv?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`,
          `habitflow-logs-${startDate}-to-${endDate}.csv`
        );
      } else {
        await downloadAuthenticatedCsv(
          `/api/exports/report.csv?preset=custom&start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`,
          `habitflow-report-${startDate}-to-${endDate}.csv`
        );
      }
      pushToast({ message: `Downloaded ${kind}.csv export.` });
    } catch (err: any) {
      pushToast({ message: err?.message || 'CSV export failed.', tone: 'error' });
    } finally {
      setExportingType(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Export Date Range & Spreadsheet Import Header */}
      <section className="p-6 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {tx(
              language,
              'CSV Data Exports & Spreadsheet Compatibility',
              'CSV ডেটা এক্সপোর্ট ও স্প্রেডশিট সাপোর্ট'
            )}
          </h2>
          <p className="text-xs text-[var(--text-secondary)]">
            {tx(
              language,
              'All exports include only your private workspace records with RFC 4180 escaping suitable for Excel or Google Sheets.',
              'সকল এক্সপোর্টে শুধুমাত্র আপনার ব্যক্তিগত ওয়ার্কস্পেসের ডেটা থাকে যা Excel ও Google Sheets-এ সরাসরি ব্যবহারযোগ্য।'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="date"
            aria-label="Export start date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-mono-num text-[var(--text-primary)]"
          />
          <span className="text-xs text-[var(--text-secondary)]">
            {tx(language, 'to', 'থেকে')}
          </span>
          <input
            type="date"
            aria-label="Export end date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-mono-num text-[var(--text-primary)]"
          />

          <button
            type="button"
            onClick={onOpenImportModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5 text-[var(--accent-lime)]" />
            <span>{tx(language, 'Import .xlsx / .csv', '.xlsx / .csv ইমপোর্ট')}</span>
          </button>
        </div>
      </section>

      {/* Three CSV Export Cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="p-5 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] flex flex-col justify-between space-y-4">
          <div className="space-y-1.5">
            <FileSpreadsheet className="w-5 h-5 text-[var(--accent-lime)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {tx(language, 'Habit Definitions (habits.csv)', 'হ্যাবিট তালিকা (habits.csv)')}
            </h3>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              {tx(
                language,
                'Full configuration of your active and archived habits, schedules, targets, units, priorities, and reminder times.',
                'আপনার সক্রিয় ও আর্কাইভ করা হ্যাবিট, সময়সূচি, লক্ষ্যমাত্রা, অগ্রাধিকার ও রিমাইন্ডার সময়ের সম্পূর্ণ তথ্য।'
              )}
            </p>
          </div>
          <button
            type="button"
            disabled={exportingType === 'habits'}
            onClick={() => void handleExport('habits')}
            className="w-full inline-flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-xs font-semibold bg-[var(--accent-lime)] text-[var(--accent-ink)] hover:bg-[var(--accent-lime-hover)] disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{tx(language, 'Download habits.csv', 'habits.csv ডাউনলোড করুন')}</span>
          </button>
        </div>

        <div className="p-5 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] flex flex-col justify-between space-y-4">
          <div className="space-y-1.5">
            <FileSpreadsheet className="w-5 h-5 text-[var(--accent-lime)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {tx(language, 'Daily Logs History (logs.csv)', 'দৈনিক লগের ইতিহাস (logs.csv)')}
            </h3>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              {tx(
                language,
                `Chronological daily log entries (${startDate} to ${endDate}) including completion status, numeric counts, durations, and notes.`,
                `নির্ধারিত সময়সীমার (${startDate} থেকে ${endDate}) দৈনিক সম্পন্ন স্ট্যাটাস, সংখ্যা, সময় ও নোট।`
              )}
            </p>
          </div>
          <button
            type="button"
            disabled={exportingType === 'logs'}
            onClick={() => void handleExport('logs')}
            className="w-full inline-flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-xs font-semibold bg-[var(--accent-lime)] text-[var(--accent-ink)] hover:bg-[var(--accent-lime-hover)] disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{tx(language, 'Download logs.csv', 'logs.csv ডাউনলোড করুন')}</span>
          </button>
        </div>

        <div className="p-5 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] flex flex-col justify-between space-y-4">
          <div className="space-y-1.5">
            <FileSpreadsheet className="w-5 h-5 text-[var(--accent-lime)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {tx(
                language,
                'Summary Consistency Report (report.csv)',
                'ধারাবাহিকতার সারাংশ রিপোর্ট (report.csv)'
              )}
            </h3>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              {tx(
                language,
                `Aggregated performance per habit (${startDate} to ${endDate}) with scheduled, completed, missed counts, completion %, and streaks.`,
                `প্রতিটি হ্যাবিটের সামগ্রিক পারফরম্যান্স (${startDate} থেকে ${endDate}) — নির্ধারিত, সম্পন্ন, মিস, হার % ও ধারা।`
              )}
            </p>
          </div>
          <button
            type="button"
            disabled={exportingType === 'report'}
            onClick={() => void handleExport('report')}
            className="w-full inline-flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-xs font-semibold bg-[var(--accent-lime)] text-[var(--accent-ink)] hover:bg-[var(--accent-lime-hover)] disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{tx(language, 'Download report.csv', 'report.csv ডাউনলোড করুন')}</span>
          </button>
        </div>
      </section>

      {/* Live Report Preview Table */}
      <section className="rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] overflow-hidden">
        <div className="p-5 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {tx(
              language,
              `Report Preview (${startDate} to ${endDate})`,
              `রিপোর্ট প্রিভিউ (${startDate} থেকে ${endDate})`
            )}
          </h2>
          <span className="text-xs font-mono-num text-[var(--text-secondary)]">
            {reportRows.length} {tx(language, 'habit(s)', 'টি হ্যাবিট')}
          </span>
        </div>

        {loading ? (
          <div className="p-8 h-40 animate-pulse" />
        ) : reportRows.length === 0 ? (
          <div className="p-10 text-center text-sm text-[var(--text-secondary)]">
            {tx(
              language,
              'No habits recorded yet to preview in this report window.',
              'এই সময়সীমায় প্রিভিউ দেখানোর মতো কোনো হ্যাবিট পাওয়া যায়নি।'
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-[var(--bg-surface)] text-[var(--text-secondary)] border-b border-[var(--border-subtle)]">
                <tr>
                  <th className="py-3 px-4 font-medium">{tx(language, 'Habit Name', 'হ্যাবিটের নাম')}</th>
                  <th className="py-3 px-4 font-medium">{tx(language, 'Category', 'ক্যাটাগরি')}</th>
                  <th className="py-3 px-4 font-medium text-right">
                    {tx(language, 'Scheduled', 'নির্ধারিত')}
                  </th>
                  <th className="py-3 px-4 font-medium text-right">
                    {tx(language, 'Completed', 'সম্পন্ন')}
                  </th>
                  <th className="py-3 px-4 font-medium text-right">
                    {tx(language, 'Missed', 'মিস')}
                  </th>
                  <th className="py-3 px-4 font-medium text-right">
                    {tx(language, 'Completion %', 'সম্পন্ন %')}
                  </th>
                  <th className="py-3 px-4 font-medium text-right">
                    {tx(language, 'Current / Longest Streak', 'বর্তমান / সর্বোচ্চ ধারা')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {reportRows.map((r) => (
                  <tr key={r.habitId}>
                    <td className="py-3 px-4 font-medium text-[var(--text-primary)]">
                      {r.habitName}
                    </td>
                    <td className="py-3 px-4 text-[var(--text-secondary)]">
                      {translateCategory(r.category, language)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num text-[var(--text-secondary)]">
                      {r.eligibleOccurrences}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num text-[var(--text-primary)]">
                      {r.completedOccurrences}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num text-[var(--text-secondary)]">
                      {r.missedOccurrences}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num font-semibold text-[var(--accent-lime)]">
                      {r.eligibleOccurrences > 0 ? `${r.completionRate}%` : '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num text-[var(--text-primary)]">
                      {r.currentStreak}d / {r.longestStreak}d
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
