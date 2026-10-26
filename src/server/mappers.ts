import type {
  GoalRecord,
  HabitLogRecord,
  HabitRecord,
  NotificationRecord,
  UserProfile,
  UserSettingsData,
} from '../shared/types.ts';

function toIsoString(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

export function mapUserToProfile(row: {
  id: number;
  name: string;
  email: string;
  avatarUrl?: string | null;
  timezone: string;
  weekStartPreference: number;
  onboardingCompleted: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}): UserProfile {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatarUrl ?? null,
    timezone: row.timezone,
    weekStartPreference: row.weekStartPreference,
    onboardingCompleted: row.onboardingCompleted,
    createdAt: toIsoString(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updatedAt) ?? new Date().toISOString(),
  };
}

export function mapUserSettings(row: {
  id: number;
  userId: number;
  theme: string;
  locale: string;
  defaultDateRange: string;
  notificationPreferences: any;
  reminderPreferences: any;
}): UserSettingsData {
  return {
    id: row.id,
    userId: row.userId,
    theme: row.theme === 'light' ? 'light' : 'dark',
    locale: row.locale || 'en-US',
    defaultDateRange: (['7d', '30d', 'this_week', 'this_month'].includes(row.defaultDateRange)
      ? row.defaultDateRange
      : '30d') as UserSettingsData['defaultDateRange'],
    notificationPreferences: {
      inAppEnabled: row.notificationPreferences?.inAppEnabled ?? true,
      browserPushEnabled: row.notificationPreferences?.browserPushEnabled ?? false,
      dailyDigestEnabled: row.notificationPreferences?.dailyDigestEnabled ?? true,
      streakMilestonesEnabled: row.notificationPreferences?.streakMilestonesEnabled ?? true,
    },
    reminderPreferences: {
      remindersEnabled: row.reminderPreferences?.remindersEnabled ?? true,
      quietHoursStart: row.reminderPreferences?.quietHoursStart ?? '22:30',
      quietHoursEnd: row.reminderPreferences?.quietHoursEnd ?? '06:30',
      defaultReminderTime: row.reminderPreferences?.defaultReminderTime ?? '08:00',
    },
  };
}

export function mapHabitRow(row: any): HabitRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description ?? null,
    category: row.category,
    icon: row.icon,
    color: row.color,
    habitType: row.habitType,
    scheduleType: row.scheduleType,
    scheduleConfig: row.scheduleConfig ?? {},
    targetValue: Number(row.targetValue ?? 1),
    targetUnit: row.targetUnit ?? null,
    startDate: row.startDate,
    endDate: row.endDate ?? null,
    reminderTime: row.reminderTime ?? null,
    completionDeadline: row.completionDeadline ?? null,
    priority: row.priority,
    displayOrder: Number(row.displayOrder ?? 0),
    status: row.status,
    archivedLocalDate: row.archivedLocalDate ?? null,
    createdAt: toIsoString(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updatedAt) ?? new Date().toISOString(),
    archivedAt: toIsoString(row.archivedAt),
  };
}

export function mapHabitLogRow(row: any): HabitLogRecord {
  return {
    id: row.id,
    userId: row.userId,
    habitId: row.habitId,
    localDate: row.localDate,
    completed: Boolean(row.completed),
    numericValue: row.numericValue != null ? Number(row.numericValue) : null,
    durationSeconds: row.durationSeconds != null ? Number(row.durationSeconds) : null,
    notes: row.notes ?? null,
    completedAt: toIsoString(row.completedAt),
    createdAt: toIsoString(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updatedAt) ?? new Date().toISOString(),
  };
}

export function mapGoalRow(row: any): GoalRecord {
  return {
    id: row.id,
    userId: row.userId,
    habitId: row.habitId ?? null,
    title: row.title,
    goalType: row.goalType,
    targetValue: Number(row.targetValue),
    targetUnit: row.targetUnit ?? null,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status,
    createdAt: toIsoString(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updatedAt) ?? new Date().toISOString(),
  };
}

export function mapNotificationRow(row: any): NotificationRecord {
  return {
    id: row.id,
    userId: row.userId,
    habitId: row.habitId ?? null,
    type: row.type,
    title: row.title,
    message: row.message,
    scheduledAt: toIsoString(row.scheduledAt),
    deliveredAt: toIsoString(row.deliveredAt),
    readAt: toIsoString(row.readAt),
    status: row.status === 'read' ? 'read' : 'unread',
    createdAt: toIsoString(row.createdAt) ?? new Date().toISOString(),
  };
}
