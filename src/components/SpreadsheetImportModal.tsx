import React, { useState } from 'react';
import { FileSpreadsheet, Upload, X, AlertTriangle, Check } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import type { ImportPreviewPayload } from '../shared/types.ts';

interface SpreadsheetImportModalProps {
  open: boolean;
  onClose: () => void;
  onImported: (summary: { createdHabits: number; importedLogs: number }) => void;
}

export function SpreadsheetImportModal({
  open,
  onClose,
  onImported,
}: SpreadsheetImportModalProps) {
  const [preview, setPreview] = useState<ImportPreviewPayload | null>(null);
  const [uploading, setUploading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiFetch<{ preview: ImportPreviewPayload }>('/api/import/preview', {
        method: 'POST',
        body: formData,
      });
      setPreview(res.preview);
    } catch (err: any) {
      setError(err?.message || 'Unable to parse spreadsheet.');
    } finally {
      setUploading(false);
    }
  };

  const handleCommit = async () => {
    if (!preview) return;
    setCommitting(true);
    setError(null);
    try {
      const newHabits = preview.habits.filter((h) => !h.alreadyExists);
      const res = await apiFetch<{ createdHabits: number; importedLogs: number }>(
        '/api/import/commit',
        {
          method: 'POST',
          body: JSON.stringify({
            habits: newHabits,
            logs: preview.logs,
          }),
        }
      );
      onImported(res);
      setPreview(null);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to save imported records.');
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-modal-title"
    >
      <div className="w-full max-w-2xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-xl p-6 my-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2.5">
            <FileSpreadsheet className="w-5 h-5 text-[var(--accent-lime)]" />
            <h2 id="import-modal-title" className="text-lg font-semibold text-[var(--text-primary)]">
              Import Spreadsheet (.xlsx / .csv)
            </h2>
          </div>
          <button
            type="button"
            onClick={() => {
              setPreview(null);
              onClose();
            }}
            aria-label="Close import dialog"
            className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-5 space-y-5">
          {error && (
            <div role="alert" className="p-3 rounded-lg bg-[#2A1515] border border-[#5C2424] text-[#F87171] text-sm">
              {error}
            </div>
          )}

          {!preview ? (
            <div className="space-y-4">
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                Upload an Excel workbook (<code>.xlsx</code>) or CSV file containing a{' '}
                <strong className="text-[var(--text-primary)]">Habit Name</strong> column. Optional columns such as{' '}
                <code>Category</code>, <code>Target Value</code>, <code>Schedule Type</code>, or ISO date columns (
                <code>YYYY-MM-DD</code>) will be previewed before saving. Macros and formulas are never executed.
              </p>

              <label className="flex flex-col items-center justify-center gap-3 p-8 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] cursor-pointer transition-colors">
                <Upload className="w-7 h-7 text-[var(--accent-lime)]" />
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  {uploading ? 'Parsing workbook on server...' : 'Choose .xlsx or .csv file (max 5 MB)'}
                </span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  disabled={uploading}
                  onChange={handleFileChange}
                  className="sr-only"
                />
              </label>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
                <span>
                  File: <strong className="text-[var(--text-primary)]">{preview.fileName}</strong>
                </span>
                <span className="font-mono-num">
                  {preview.habits.filter((h) => !h.alreadyExists).length} new habits ·{' '}
                  {preview.habits.filter((h) => h.alreadyExists).length} existing · {preview.logs.length} log entries
                </span>
              </div>

              {preview.warnings.length > 0 && (
                <div className="p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-1">
                  {preview.warnings.map((w, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-xs text-[#FBBF24]">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              {preview.unrecognizedColumns.length > 0 && (
                <div className="text-xs text-[var(--text-secondary)]">
                  Unmapped columns noted: {preview.unrecognizedColumns.slice(0, 8).join(', ')}
                </div>
              )}

              {preview.errors.length > 0 && (
                <div className="p-3 rounded-lg bg-[#2A1515] border border-[#5C2424] space-y-1 max-h-32 overflow-y-auto">
                  {preview.errors.map((errItem, idx) => (
                    <p key={idx} className="text-xs text-[#F87171]">
                      {errItem.message}
                    </p>
                  ))}
                </div>
              )}

              {preview.habits.length > 0 && (
                <div className="border border-[var(--border-subtle)] rounded-lg overflow-x-auto max-h-60">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[var(--bg-surface)] text-[var(--text-secondary)] border-b border-[var(--border-subtle)]">
                      <tr>
                        <th className="py-2.5 px-3 font-medium">Row</th>
                        <th className="py-2.5 px-3 font-medium">Habit Name</th>
                        <th className="py-2.5 px-3 font-medium">Category</th>
                        <th className="py-2.5 px-3 font-medium">Schedule</th>
                        <th className="py-2.5 px-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]">
                      {preview.habits.map((h) => (
                        <tr key={`${h.rowNumber}-${h.name}`}>
                          <td className="py-2 px-3 font-mono-num text-[var(--text-secondary)]">{h.rowNumber}</td>
                          <td className="py-2 px-3 font-medium text-[var(--text-primary)]">{h.name}</td>
                          <td className="py-2 px-3 text-[var(--text-secondary)]">{h.category}</td>
                          <td className="py-2 px-3 text-[var(--text-secondary)]">{h.scheduleType}</td>
                          <td className="py-2 px-3 text-[var(--text-secondary)]">
                            {h.alreadyExists ? 'Existing (skip duplicate)' : 'Ready to import'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 pt-4 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
                >
                  Choose Different File
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={committing || (preview.habits.length === 0 && preview.logs.length === 0)}
                    onClick={handleCommit}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-[var(--accent-lime)] text-[var(--accent-ink)] hover:bg-[var(--accent-lime-hover)] disabled:opacity-50"
                  >
                    <Check className="w-4 h-4" />
                    <span>{committing ? 'Importing...' : 'Confirm Import'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
