import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/index.ts';
import { habitLogs, habits, notifications, userSettings, users } from '../db/schema.ts';
import { evaluateHabitCompletion, isHabitScheduledOnDate } from '../shared/calculations.ts';
import { getLocalDateInTimezone, getLocalTimeInTimezone } from '../shared/dates.ts';
import { mapHabitLogRow, mapHabitRow, mapUserSettings } from './mappers.ts';

function isWithinQuietHours(currentTime: string, start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  if (start === end) return false;
  if (start < end) {
    return currentTime >= start && currentTime < end;
  }
  // Overnight quiet hours (e.g. 22:30 -> 06:30)
  return currentTime >= start || currentTime < end;
}

/**
 * Evaluates due habit reminders for a single user in their configured IANA timezone.
 * Deduplicates via `dedupe_key` (`reminder:{userId}:{habitId}:{localDate}`) so repeated checks
 * or server restarts never create duplicate reminder notifications.
 */
export async function syncDueRemindersForUser(
  db: AppDatabase,
  userId: number,
  now: Date = new Date()
): Promise<number> {
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (userRows.length === 0) return 0;
  const user = userRows[0];

  const settingsRows = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);

  const settings = settingsRows.length > 0 ? mapUserSettings(settingsRows[0]) : null;
  if (settings) {
    if (!settings.notificationPreferences.inAppEnabled || !settings.reminderPreferences.remindersEnabled) {
      return 0;
    }
  }

  const localDate = getLocalDateInTimezone(now, user.timezone);
  const localTime = getLocalTimeInTimezone(now, user.timezone);

  if (
    settings &&
    isWithinQuietHours(
      localTime,
      settings.reminderPreferences.quietHoursStart,
      settings.reminderPreferences.quietHoursEnd
    )
  ) {
    return 0;
  }

  const activeHabits = await db
    .select()
    .from(habits)
    .where(and(eq(habits.userId, userId), eq(habits.status, 'active')));

  if (activeHabits.length === 0) return 0;

  const todaysLogs = await db
    .select()
    .from(habitLogs)
    .where(and(eq(habitLogs.userId, userId), eq(habitLogs.localDate, localDate)));

  const logByHabitId = new Map<number, ReturnType<typeof mapHabitLogRow>>();
  for (const l of todaysLogs) {
    logByHabitId.set(l.habitId, mapHabitLogRow(l));
  }

  let createdCount = 0;
  for (const row of activeHabits) {
    const habit = mapHabitRow(row);
    if (!habit.reminderTime) continue;
    if (!isHabitScheduledOnDate(habit, localDate)) continue;
    if (localTime < habit.reminderTime) continue;

    const existingLog = logByHabitId.get(habit.id);
    const { isCompleted } = evaluateHabitCompletion(habit, existingLog);
    if (isCompleted) continue;

    const dedupeKey = `reminder:${userId}:${habit.id}:${localDate}`;
    const inserted = await db
      .insert(notifications)
      .values({
        userId,
        habitId: habit.id,
        dedupeKey,
        type: 'reminder',
        title: `Reminder: ${habit.name}`,
        message: `Scheduled for ${habit.reminderTime} (${localDate} in ${user.timezone}).`,
        scheduledAt: now,
        deliveredAt: now,
        status: 'unread',
      })
      .onConflictDoNothing({ target: notifications.dedupeKey })
      .returning({ id: notifications.id });

    if (inserted.length > 0) {
      createdCount += 1;
    }
  }

  return createdCount;
}

export async function runGlobalReminderSweep(db: AppDatabase, now: Date = new Date()): Promise<void> {
  try {
    const allUsers = await db.select({ id: users.id }).from(users);
    for (const u of allUsers) {
      await syncDueRemindersForUser(db, u.id, now);
    }
  } catch (err) {
    console.error('Background reminder sweep error:', err);
  }
}
