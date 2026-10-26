import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Languages } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import type { AppLanguage } from '../lib/i18n.ts';

const LANGUAGE_OPTIONS: { id: AppLanguage; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'bn', label: 'বাংলা' },
];

export function LanguageSwitcher() {
  const { language, setLanguage } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const activeLabel = language === 'bn' ? 'বাংলা' : 'English';

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Change language"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] transition-colors whitespace-nowrap shrink-0"
      >
        <Languages className="w-4 h-4 text-[var(--accent-lime)] shrink-0" />
        <span>{activeLabel}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-[var(--text-secondary)] transition-transform duration-150 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Select language"
          className="absolute right-0 mt-1.5 w-36 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-strong)] shadow-lg py-1 z-50"
        >
          {LANGUAGE_OPTIONS.map((opt) => {
            const isSelected = language === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  setOpen(false);
                  if (opt.id !== language) {
                    void setLanguage(opt.id);
                  }
                }}
                className={`w-full px-3 py-2 text-xs sm:text-sm flex items-center justify-between gap-2 transition-colors whitespace-nowrap ${
                  isSelected
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] font-semibold'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]/70'
                }`}
              >
                <span>{opt.label}</span>
                {isSelected && <Check className="w-3.5 h-3.5 text-[var(--accent-lime)] shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
