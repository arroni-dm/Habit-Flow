export const DEFAULT_APP_NAME = 'HabitFlow';

export function getAppName(): string {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_APP_NAME) {
    return String(import.meta.env.VITE_APP_NAME);
  }
  if (typeof process !== 'undefined' && process.env?.VITE_APP_NAME) {
    return String(process.env.VITE_APP_NAME);
  }
  return DEFAULT_APP_NAME;
}

export const HABIT_CATEGORIES = [
  'Morning Routine',
  'Health & Fitness',
  'Work & Productivity',
  'Learning',
  'Personal Development',
  'Family & Relationships',
  'Sleep & Recovery',
  'Finance',
  'Custom',
] as const;

export const HABIT_ICONS = [
  'Sun',
  'Footprints',
  'Briefcase',
  'ListTodo',
  'CheckCircle2',
  'Home',
  'Dumbbell',
  'Trophy',
  'HeartHandshake',
  'Moon',
  'Droplets',
  'BookOpen',
  'Brain',
  'Wallet',
  'Flame',
  'Timer',
  'Target',
  'Activity',
] as const;

export const HABIT_ACCENT_COLORS = [
  { name: 'Neon Lime', value: '#C6FF00' },
  { name: 'Emerald', value: '#34D399' },
  { name: 'Sky', value: '#38BDF8' },
  { name: 'Amber', value: '#FBBF24' },
  { name: 'Coral', value: '#FB7185' },
  { name: 'Teal', value: '#2DD4BF' },
  { name: 'Indigo', value: '#818CF8' },
  { name: 'Orange', value: '#FB923C' },
] as const;

export const COMMON_TIMEZONES = [
  'Asia/Dhaka',
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Istanbul',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const;

export interface StarterHabitTemplate {
  name: string;
  description: string;
  category: string;
  icon: string;
  color: string;
  habitType: 'boolean' | 'count' | 'duration';
  scheduleType: 'daily' | 'weekdays' | 'weekends' | 'custom_days';
  targetValue: number;
  targetUnit: string | null;
  reminderTime: string | null;
  completionDeadline: string | null;
  priority: 'low' | 'medium' | 'high';
}

export const SPREADSHEET_STARTER_HABITS: StarterHabitTemplate[] = [
  {
    name: 'Wake Up at 5:00 AM',
    description: 'Start the day energized at 5:00 AM.',
    category: 'Morning Routine',
    icon: 'Sun',
    color: '#C6FF00',
    habitType: 'boolean',
    scheduleType: 'daily',
    targetValue: 1,
    targetUnit: null,
    reminderTime: '05:00',
    completionDeadline: '06:00',
    priority: 'high',
  },
  {
    name: 'Morning Walk From 5:30 AM to 6:30 AM',
    description: 'Outdoor brisk morning walk for 60 minutes.',
    category: 'Health & Fitness',
    icon: 'Footprints',
    color: '#34D399',
    habitType: 'duration',
    scheduleType: 'daily',
    targetValue: 60,
    targetUnit: 'minutes',
    reminderTime: '05:30',
    completionDeadline: '07:00',
    priority: 'high',
  },
  {
    name: 'Reach the office by 8:00 AM',
    description: 'Arrive at the workspace on time for deep morning work.',
    category: 'Work & Productivity',
    icon: 'Briefcase',
    color: '#38BDF8',
    habitType: 'boolean',
    scheduleType: 'weekdays',
    targetValue: 1,
    targetUnit: null,
    reminderTime: '07:45',
    completionDeadline: '08:15',
    priority: 'high',
  },
  {
    name: 'Maintain a To-Do List at the Office',
    description: 'Plan and review daily action items.',
    category: 'Work & Productivity',
    icon: 'ListTodo',
    color: '#FBBF24',
    habitType: 'boolean',
    scheduleType: 'weekdays',
    targetValue: 1,
    targetUnit: null,
    reminderTime: '08:30',
    completionDeadline: '18:00',
    priority: 'medium',
  },
  {
    name: 'Finish Office Work by 6:00 PM',
    description: 'Wrap up tasks cleanly to protect evening balance.',
    category: 'Work & Productivity',
    icon: 'CheckCircle2',
    color: '#2DD4BF',
    habitType: 'boolean',
    scheduleType: 'weekdays',
    targetValue: 1,
    targetUnit: null,
    reminderTime: '17:45',
    completionDeadline: '18:30',
    priority: 'medium',
  },
  {
    name: 'Return Home by 6:30 PM',
    description: 'Commute home promptly after office hours.',
    category: 'Personal Development',
    icon: 'Home',
    color: '#818CF8',
    habitType: 'boolean',
    scheduleType: 'weekdays',
    targetValue: 1,
    targetUnit: null,
    reminderTime: '18:15',
    completionDeadline: '19:00',
    priority: 'medium',
  },
  {
    name: 'Get Fresh and Go To Gym by 7:00 PM',
    description: 'Transition from work and head to the gym session.',
    category: 'Health & Fitness',
    icon: 'Dumbbell',
    color: '#C6FF00',
    habitType: 'boolean',
    scheduleType: 'daily',
    targetValue: 1,
    targetUnit: null,
    reminderTime: '18:50',
    completionDeadline: '19:30',
    priority: 'high',
  },
  {
    name: 'Finish Gym by 8:00 PM to 8:30 PM',
    description: 'Complete evening strength and conditioning workout.',
    category: 'Health & Fitness',
    icon: 'Trophy',
    color: '#FB923C',
    habitType: 'duration',
    scheduleType: 'daily',
    targetValue: 60,
    targetUnit: 'minutes',
    reminderTime: '20:00',
    completionDeadline: '21:00',
    priority: 'medium',
  },
  {
    name: 'Family Time From 9:00 PM to 10:00 PM',
    description: 'Dedicated screen-free quality time with family.',
    category: 'Family & Relationships',
    icon: 'HeartHandshake',
    color: '#FB7185',
    habitType: 'duration',
    scheduleType: 'daily',
    targetValue: 60,
    targetUnit: 'minutes',
    reminderTime: '21:00',
    completionDeadline: '22:15',
    priority: 'high',
  },
  {
    name: 'Go to Sleep by 10:30 PM',
    description: 'Lights out by 10:30 PM for full sleep recovery.',
    category: 'Sleep & Recovery',
    icon: 'Moon',
    color: '#818CF8',
    habitType: 'boolean',
    scheduleType: 'daily',
    targetValue: 1,
    targetUnit: null,
    reminderTime: '22:15',
    completionDeadline: '23:00',
    priority: 'high',
  },
];
