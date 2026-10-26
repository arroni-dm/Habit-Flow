import { relations } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type {
  NotificationPreferences,
  ReminderPreferences,
  ScheduleConfig,
} from '../shared/types.ts';

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    avatarUrl: text('avatar_url'),
    timezone: text('timezone').notNull().default('UTC'),
    weekStartPreference: integer('week_start_preference').notNull().default(1),
    onboardingCompleted: boolean('onboarding_completed').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_unique_idx').on(table.email)]
);

export const userSettings = pgTable(
  'user_settings',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    theme: text('theme').notNull().default('dark'),
    locale: text('locale').notNull().default('en-US'),
    defaultDateRange: text('default_date_range').notNull().default('30d'),
    notificationPreferences: jsonb('notification_preferences')
      .$type<NotificationPreferences>()
      .notNull()
      .default({
        inAppEnabled: true,
        browserPushEnabled: false,
        dailyDigestEnabled: true,
        streakMilestonesEnabled: true,
      }),
    reminderPreferences: jsonb('reminder_preferences')
      .$type<ReminderPreferences>()
      .notNull()
      .default({
        remindersEnabled: true,
        quietHoursStart: '22:30',
        quietHoursEnd: '06:30',
        defaultReminderTime: '08:00',
      }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('user_settings_user_id_unique_idx').on(table.userId)]
);

export const userSessions = pgTable(
  'user_sessions',
  {
    id: text('id').primaryKey(), // SHA-256 hash of session cookie token
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    csrfToken: text('csrf_token').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('user_sessions_user_id_idx').on(table.userId),
    index('user_sessions_expires_at_idx').on(table.expiresAt),
  ]
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('password_reset_tokens_hash_unique_idx').on(table.tokenHash)]
);

export const habits = pgTable(
  'habits',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    category: text('category').notNull().default('Personal Development'),
    icon: text('icon').notNull().default('CheckCircle2'),
    color: text('color').notNull().default('#C6FF00'),
    habitType: text('habit_type').notNull().default('boolean'),
    scheduleType: text('schedule_type').notNull().default('daily'),
    scheduleConfig: jsonb('schedule_config').$type<ScheduleConfig>().notNull().default({}),
    targetValue: doublePrecision('target_value').notNull().default(1),
    targetUnit: text('target_unit'),
    startDate: text('start_date').notNull(), // YYYY-MM-DD
    endDate: text('end_date'), // YYYY-MM-DD
    reminderTime: text('reminder_time'), // HH:mm
    completionDeadline: text('completion_deadline'), // HH:mm
    priority: text('priority').notNull().default('medium'),
    displayOrder: integer('display_order').notNull().default(0),
    status: text('status').notNull().default('active'),
    archivedLocalDate: text('archived_local_date'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    index('habits_user_status_idx').on(table.userId, table.status),
    index('habits_user_order_idx').on(table.userId, table.displayOrder),
  ]
);

export const habitLogs = pgTable(
  'habit_logs',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    habitId: integer('habit_id')
      .notNull()
      .references(() => habits.id, { onDelete: 'cascade' }),
    localDate: text('local_date').notNull(), // YYYY-MM-DD
    completed: boolean('completed').notNull().default(false),
    numericValue: doublePrecision('numeric_value'),
    durationSeconds: integer('duration_seconds'),
    notes: text('notes'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('habit_logs_user_habit_date_unique_idx').on(
      table.userId,
      table.habitId,
      table.localDate
    ),
    index('habit_logs_user_date_idx').on(table.userId, table.localDate),
    index('habit_logs_habit_date_idx').on(table.habitId, table.localDate),
  ]
);

export const goals = pgTable(
  'goals',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    habitId: integer('habit_id').references(() => habits.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    goalType: text('goal_type').notNull(),
    targetValue: doublePrecision('target_value').notNull(),
    targetUnit: text('target_unit'),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('goals_user_status_idx').on(table.userId, table.status)]
);

export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    habitId: integer('habit_id').references(() => habits.id, { onDelete: 'set null' }),
    dedupeKey: text('dedupe_key'),
    type: text('type').notNull().default('reminder'),
    title: text('title').notNull(),
    message: text('message').notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    status: text('status').notNull().default('unread'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('notifications_dedupe_key_unique_idx').on(table.dedupeKey),
    index('notifications_user_created_idx').on(table.userId, table.createdAt),
  ]
);

export const usersRelations = relations(users, ({ one, many }) => ({
  settings: one(userSettings, {
    fields: [users.id],
    references: [userSettings.userId],
  }),
  habits: many(habits),
  habitLogs: many(habitLogs),
  goals: many(goals),
  notifications: many(notifications),
  sessions: many(userSessions),
}));

export const habitsRelations = relations(habits, ({ one, many }) => ({
  user: one(users, {
    fields: [habits.userId],
    references: [users.id],
  }),
  logs: many(habitLogs),
  goals: many(goals),
}));

export const habitLogsRelations = relations(habitLogs, ({ one }) => ({
  user: one(users, {
    fields: [habitLogs.userId],
    references: [users.id],
  }),
  habit: one(habits, {
    fields: [habitLogs.habitId],
    references: [habits.id],
  }),
}));

export const goalsRelations = relations(goals, ({ one }) => ({
  user: one(users, {
    fields: [goals.userId],
    references: [users.id],
  }),
  habit: one(habits, {
    fields: [goals.habitId],
    references: [habits.id],
  }),
}));
