import { z } from 'zod';
import { isValidIanaTimezone, isValidIsoDate, isValidTimeString } from './dates.ts';

export const passwordPolicySchema = z
  .string()
  .min(8, 'Password must be at least 8 characters long.')
  .max(128, 'Password must not exceed 128 characters.')
  .regex(/[A-Z]/, 'Password must include at least one uppercase letter.')
  .regex(/[a-z]/, 'Password must include at least one lowercase letter.')
  .regex(/[0-9]/, 'Password must include at least one number.');

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(80, 'Name is too long.'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(160),
  password: passwordPolicySchema,
  timezone: z
    .string()
    .trim()
    .refine(isValidIanaTimezone, 'Invalid IANA timezone.')
    .optional()
    .default('UTC'),
  weekStartPreference: z
    .number()
    .int()
    .refine((v) => [0, 1, 6].includes(v), 'Week start must be Sunday (0), Monday (1), or Saturday (6).')
    .optional()
    .default(1),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.').max(128),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
});

export const verifyResetCodeSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit verification code.'),
});

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(16, 'Invalid or expired reset session.').max(256),
  password: passwordPolicySchema,
});

export const scheduleConfigSchema = z.object({
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  allowPartialCompletion: z.boolean().optional(),
  weeklyTargetDays: z.number().int().min(1).max(7).optional(),
});

const nullableTimeField = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((val) => (val === '' || val === undefined ? null : val))
  .refine((val) => val === null || isValidTimeString(val), 'Time must be in HH:mm 24-hour format.');

const nullableDateField = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((val) => (val === '' || val === undefined ? null : val))
  .refine((val) => val === null || isValidIsoDate(val), 'Date must be YYYY-MM-DD.');

export const createHabitSchema = z
  .object({
    name: z.string().trim().min(1, 'Habit name is required.').max(120, 'Habit name must be 120 characters or fewer.'),
    description: z
      .string()
      .trim()
      .max(500, 'Description must be 500 characters or fewer.')
      .nullable()
      .optional()
      .transform((val) => (val === '' || val === undefined ? null : val)),
    category: z.string().trim().min(1).max(60).default('Personal Development'),
    icon: z.string().trim().min(1).max(40).default('CheckCircle2'),
    color: z
      .string()
      .trim()
      .regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a 6-digit hex code.')
      .default('#C6FF00'),
    habitType: z.enum(['boolean', 'count', 'duration']).default('boolean'),
    scheduleType: z.enum(['daily', 'weekdays', 'weekends', 'custom_days']).default('daily'),
    scheduleConfig: scheduleConfigSchema.optional().default({}),
    targetValue: z.number().positive('Target value must be greater than zero.').max(100000).default(1),
    targetUnit: z
      .string()
      .trim()
      .max(32)
      .nullable()
      .optional()
      .transform((val) => (val === '' || val === undefined ? null : val)),
    startDate: z.string().trim().refine(isValidIsoDate, 'Start date must be YYYY-MM-DD.'),
    endDate: nullableDateField,
    reminderTime: nullableTimeField,
    completionDeadline: nullableTimeField,
    priority: z.enum(['low', 'medium', 'high']).default('medium'),
    displayOrder: z.number().int().min(0).max(10000).optional(),
  })
  .refine(
    (data) => {
      if (data.scheduleType === 'custom_days') {
        return Array.isArray(data.scheduleConfig?.daysOfWeek) && data.scheduleConfig.daysOfWeek.length > 0;
      }
      return true;
    },
    { message: 'Select at least one weekday for a custom schedule.', path: ['scheduleConfig'] }
  )
  .refine(
    (data) => {
      if (data.endDate && data.endDate < data.startDate) {
        return false;
      }
      return true;
    },
    { message: 'End date cannot be earlier than start date.', path: ['endDate'] }
  );

export const updateHabitSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional()
    .transform((val) => (val === '' ? null : val)),
  category: z.string().trim().min(1).max(60).optional(),
  icon: z.string().trim().min(1).max(40).optional(),
  color: z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  habitType: z.enum(['boolean', 'count', 'duration']).optional(),
  scheduleType: z.enum(['daily', 'weekdays', 'weekends', 'custom_days']).optional(),
  scheduleConfig: scheduleConfigSchema.optional(),
  targetValue: z.number().positive().max(100000).optional(),
  targetUnit: z
    .string()
    .trim()
    .max(32)
    .nullable()
    .optional()
    .transform((val) => (val === '' ? null : val)),
  startDate: z.string().trim().refine(isValidIsoDate).optional(),
  endDate: nullableDateField,
  reminderTime: nullableTimeField,
  completionDeadline: nullableTimeField,
  priority: z.enum(['low', 'medium', 'high']).optional(),
  displayOrder: z.number().int().min(0).max(10000).optional(),
  status: z.enum(['active', 'archived']).optional(),
});

export const upsertLogSchema = z.object({
  completed: z.boolean().optional(),
  numericValue: z.number().min(0).max(1_000_000).nullable().optional(),
  durationSeconds: z.number().int().min(0).max(86_400).nullable().optional(),
  notes: z
    .string()
    .trim()
    .max(1000, 'Note must be 1000 characters or fewer.')
    .nullable()
    .optional()
    .transform((val) => (val === '' ? null : val)),
});

export const createGoalSchema = z
  .object({
    habitId: z.number().int().positive().nullable().optional().default(null),
    title: z.string().trim().min(2, 'Goal title is required.').max(140),
    goalType: z.enum(['daily_completion', 'weekly_consistency', 'monthly_completion', 'habit_target']),
    targetValue: z.number().positive('Target must be positive.').max(100000),
    targetUnit: z
      .string()
      .trim()
      .max(32)
      .nullable()
      .optional()
      .transform((val) => (val === '' || val === undefined ? null : val)),
    startDate: z.string().trim().refine(isValidIsoDate, 'Start date must be YYYY-MM-DD.'),
    endDate: z.string().trim().refine(isValidIsoDate, 'End date must be YYYY-MM-DD.'),
    status: z.enum(['active', 'completed', 'archived']).optional().default('active'),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: 'End date must be on or after start date.',
    path: ['endDate'],
  });

export const updateGoalSchema = z.object({
  title: z.string().trim().min(2).max(140).optional(),
  goalType: z.enum(['daily_completion', 'weekly_consistency', 'monthly_completion', 'habit_target']).optional(),
  targetValue: z.number().positive().max(100000).optional(),
  targetUnit: z.string().trim().max(32).nullable().optional(),
  startDate: z.string().trim().refine(isValidIsoDate).optional(),
  endDate: z.string().trim().refine(isValidIsoDate).optional(),
  status: z.enum(['active', 'completed', 'archived']).optional(),
});

const SAFE_AVATAR_DATA_URL_RE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().toLowerCase().email().max(160).optional(),
  avatarUrl: z
    .string()
    .trim()
    .max(1_400_000, 'Profile image is too large. Choose an image under 1 MB.')
    .refine(
      (val) => SAFE_AVATAR_DATA_URL_RE.test(val),
      'Profile photo must be a valid PNG, JPG, WebP, or GIF image.'
    )
    .nullable()
    .optional(),
  timezone: z.string().trim().refine(isValidIanaTimezone, 'Invalid IANA timezone.').optional(),
  weekStartPreference: z
    .number()
    .int()
    .refine((v) => [0, 1, 6].includes(v))
    .optional(),
  onboardingCompleted: z.boolean().optional(),
  currentPassword: z.string().max(128).optional(),
  newPassword: passwordPolicySchema.optional(),
});

export const updateSettingsSchema = z.object({
  theme: z.enum(['dark', 'light']).optional(),
  locale: z.string().trim().min(2).max(20).optional(),
  defaultDateRange: z.enum(['7d', '30d', 'this_week', 'this_month']).optional(),
  notificationPreferences: z
    .object({
      inAppEnabled: z.boolean(),
      browserPushEnabled: z.boolean(),
      dailyDigestEnabled: z.boolean(),
      streakMilestonesEnabled: z.boolean(),
    })
    .optional(),
  reminderPreferences: z
    .object({
      remindersEnabled: z.boolean(),
      quietHoursStart: nullableTimeField,
      quietHoursEnd: nullableTimeField,
      defaultReminderTime: nullableTimeField,
    })
    .optional(),
});

export const deleteAccountSchema = z.object({
  confirmation: z.literal('DELETE MY ACCOUNT'),
  password: z.string().min(1, 'Password is required to confirm account deletion.'),
});
