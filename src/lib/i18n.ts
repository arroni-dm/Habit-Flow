export type AppLanguage = 'en' | 'bn';

const LANGUAGE_STORAGE_KEY = 'habitflow_language';

export function normalizeLanguage(locale?: string | null): AppLanguage {
  if (locale && locale.trim().toLowerCase().startsWith('bn')) {
    return 'bn';
  }
  return 'en';
}

export function localeFromLanguage(lang: AppLanguage): 'en-US' | 'bn-BD' {
  return lang === 'bn' ? 'bn-BD' : 'en-US';
}

export function readStoredLanguage(): AppLanguage | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (raw === 'bn' || raw === 'en') return raw;
    return null;
  } catch {
    return null;
  }
}

export function writeStoredLanguage(lang: AppLanguage): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // Ignore storage write errors in restricted frames
  }
}

export function tx(lang: AppLanguage, en: string, bn: string): string {
  return lang === 'bn' ? bn : en;
}

const CATEGORY_BN_MAP: Record<string, string> = {
  'Health & Fitness': 'স্বাস্থ্য ও ফিটনেস',
  'Work & Career': 'কাজ ও ক্যারিয়ার',
  'Learning & Study': 'শেখা ও পড়াশোনা',
  'Mindfulness & Sleep': 'মননশীলতা ও ঘুম',
  'Personal Development': 'ব্যক্তিগত উন্নয়ন',
  'Home & Routine': 'ঘর ও রুটিন',
  'Finance': 'আর্থিক ব্যবস্থাপনা',
  'Relationships': 'সম্পর্ক ও পরিবার',
  'Custom': 'কাস্টম',
};

export function translateCategory(category: string, lang: AppLanguage): string {
  if (lang === 'en') return category;
  return CATEGORY_BN_MAP[category] || category;
}

export function translatePriority(priority: string, lang: AppLanguage): string {
  if (lang === 'en') return `${priority} priority`;
  switch (priority) {
    case 'high':
      return 'উচ্চ অগ্রাধিকার';
    case 'medium':
      return 'মাঝারি অগ্রাধিকার';
    case 'low':
      return 'নিম্ন অগ্রাধিকার';
    default:
      return priority;
  }
}
