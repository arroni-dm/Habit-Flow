export type HabitType = 'boolean' | 'count' | 'duration';
export type ScheduleType = 'daily' | 'weekdays' | 'weekends' | 'custom_days';
export type HabitPriority = 'low' | 'medium' | 'high';
export type HabitStatus = 'active' | 'archived';
export type OccurrenceState = 'completed' | 'pending' | 'missed' | 'upcoming' | 'unscheduled';
export type GoalType = 'daily_completion' | 'weekly_consistency' | 'monthly_completion' | 'habit_target';
export type GoalStatus = 'active' | 'completed' | 'archived';

export interface ScheduleConfig {
  daysOfWeek?: number[]; // 0 (Sunday) .. 6 (Saturday)
  allowPartialCompletion?: boolean;
  weeklyTargetDays?: number;
}

export interface NotificationPreferences {
  inAppEnabled: boolean;
  browserPushEnabled: boolean;
  dailyDigestEnabled: boolean;
  streakMilestonesEnabled: boolean;
}

export interface ReminderPreferences {
  remindersEnabled: boolean;
  quietHoursStart: string | null; // HH:mm
  quietHoursEnd: string | null; // HH:mm
  defaultReminderTime: string | null; // HH:mm
}

export interface UserProfile {
  id: number;
  name: string;
  email: string;
  avatarUrl: string | null;
  timezone: string;
  weekStartPreference: number; // 0 = Sunday, 1 = Monday, 6 = Saturday
  onboardingCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserSettingsData {
  id: number;
  userId: number;
  theme: 'dark' | 'light';
  locale: string;
  defaultDateRange: '7d' | '30d' | 'this_week' | 'this_month';
  notificationPreferences: NotificationPreferences;
  reminderPreferences: ReminderPreferences;
}

export interface HabitRecord {
  id: number;
  userId: number;
  name: string;
  description: string | null;
  category: string;
  icon: string;
  color: string;
  habitType: HabitType;
  scheduleType: ScheduleType;
  scheduleConfig: ScheduleConfig;
  targetValue: number;
  targetUnit: string | null;
  startDate: string; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD
  reminderTime: string | null; // HH:mm
  completionDeadline: string | null; // HH:mm
  priority: HabitPriority;
  displayOrder: number;
  status: HabitStatus;
  archivedLocalDate: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface HabitLogRecord {
  id: number;
  userId: number;
  habitId: number;
  localDate: string; // YYYY-MM-DD
  completed: boolean;
  numericValue: number | null;
  durationSeconds: number | null;
  notes: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EvaluatedHabitOccurrence {
  habit: HabitRecord;
  date: string;
  isScheduled: boolean;
  state: OccurrenceState;
  isCompleted: boolean;
  attainmentPct: number;
  currentValue: number;
  targetValue: number;
  log: HabitLogRecord | null;
  currentStreak: number;
  longestStreak: number;
}

export interface DaySummaryMetrics {
  date: string;
  hasEligibleHabits: boolean;
  eligibleCount: number;
  completedCount: number;
  pendingCount: number;
  missedCount: number;
  upcomingCount: number;
  overallCompletionRate: number;
  booleanEligibleCount: number;
  booleanCompletedCount: number;
  booleanCompletionRate: number;
  measurableEligibleCount: number;
  measurableAverageAttainment: number;
}

export interface HabitStreakSummary {
  habitId: number;
  habitName: string;
  category: string;
  color: string;
  currentStreak: number;
  longestStreak: number;
  completedOccurrences: number;
  eligibleOccurrences: number;
  missedOccurrences: number;
  completionRate: number;
  lowSampleSize: boolean;
}

export interface OverallStreakSummary {
  currentStreak: number; // >= 80% daily completion across scheduled days
  longestStreak: number;
  perfectDayCurrentStreak: number; // 100% daily completion across scheduled days
  perfectDayLongestStreak: number;
  consistencyThresholdPct: number;
}

export interface GoalRecord {
  id: number;
  userId: number;
  habitId: number | null;
  title: string;
  goalType: GoalType;
  targetValue: number;
  targetUnit: string | null;
  startDate: string;
  endDate: string;
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface GoalWithProgress extends GoalRecord {
  habitName: string | null;
  currentValue: number;
  progressPct: number;
  isTargetReached: boolean;
  eligibleDays: number;
  summaryText: string;
}

export interface NotificationRecord {
  id: number;
  userId: number;
  habitId: number | null;
  type: 'reminder' | 'milestone' | 'system';
  title: string;
  message: string;
  scheduledAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  status: 'unread' | 'read';
  createdAt: string;
}

export interface WeekGroupSummary {
  weekNumber: number;
  label: string;
  isPartial: boolean;
  startDate: string;
  endDate: string;
  dates: string[];
  completedCount: number;
  eligibleCount: number;
  completionRate: number;
}

export interface ImportPreviewHabit {
  rowNumber: number;
  name: string;
  category: string;
  habitType: HabitType;
  scheduleType: ScheduleType;
  targetValue: number;
  targetUnit: string | null;
  alreadyExists: boolean;
}

export interface ImportPreviewLog {
  habitName: string;
  localDate: string;
  completed: boolean;
  numericValue: number | null;
}

export interface ImportPreviewPayload {
  fileName: string;
  habits: ImportPreviewHabit[];
  logs: ImportPreviewLog[];
  warnings: string[];
  errors: { row: number; message: string }[];
  unrecognizedColumns: string[];
}
