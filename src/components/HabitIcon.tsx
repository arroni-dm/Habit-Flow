import React from 'react';
import {
  Activity,
  BookOpen,
  Brain,
  Briefcase,
  CheckCircle2,
  Droplets,
  Dumbbell,
  Flame,
  Footprints,
  HeartHandshake,
  Home,
  ListTodo,
  Moon,
  Sun,
  Target,
  Timer,
  Trophy,
  Wallet,
} from 'lucide-react';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Sun,
  Footprints,
  Briefcase,
  ListTodo,
  CheckCircle2,
  Home,
  Dumbbell,
  Trophy,
  HeartHandshake,
  Moon,
  Droplets,
  BookOpen,
  Brain,
  Wallet,
  Flame,
  Timer,
  Target,
  Activity,
};

export function HabitIcon({
  name,
  className = 'w-4 h-4',
}: {
  name: string;
  className?: string;
}) {
  const IconComp = ICON_MAP[name] || CheckCircle2;
  return <IconComp className={className} />;
}

export function formatScheduleSummary(
  scheduleType: string,
  daysOfWeek?: number[],
  lang: 'en' | 'bn' = 'en'
): string {
  const dayNames =
    lang === 'bn'
      ? ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র', 'শনি']
      : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  switch (scheduleType) {
    case 'daily':
      return lang === 'bn' ? 'প্রতিদিন' : 'Daily';
    case 'weekdays':
      return lang === 'bn' ? 'সোম–শুক্র' : 'Mon–Fri';
    case 'weekends':
      return lang === 'bn' ? 'সপ্তাহান্তে' : 'Weekends';
    case 'custom_days':
      if (!daysOfWeek || daysOfWeek.length === 0) {
        return lang === 'bn' ? 'নির্বাচিত দিন' : 'Custom days';
      }
      return daysOfWeek
        .slice()
        .sort((a, b) => a - b)
        .map((d) => dayNames[d] ?? '')
        .filter(Boolean)
        .join(', ');
    default:
      return lang === 'bn' ? 'প্রতিদিন' : 'Daily';
  }
}
