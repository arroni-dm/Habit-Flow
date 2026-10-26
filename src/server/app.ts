import cookieParser from 'cookie-parser';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import express, { type Express, type Response } from 'express';
import multer from 'multer';
import type { AppDatabase } from '../db/index.ts';
import {
  goals,
  habitLogs,
  habits,
  notifications,
  passwordResetTokens,
  userSessions,
  userSettings,
  users,
} from '../db/schema.ts';
import {
  buildLogsLookup,
  calculateDaySummary,
  calculateHabitStreak,
  calculateMonthWeekSummaries,
  calculateOverallConsistencyStreak,
  calculateRangeMetrics,
  classifyOccurrence,
  evaluateGoalsProgress,
  evaluateHabitCompletion,
  rankHabitsInPeriod,
  roundMetric,
} from '../shared/calculations.ts';
import { SPREADSHEET_STARTER_HABITS, getAppName } from '../shared/config.ts';
import {
  addDays,
  daysBetweenInclusive,
  enumerateDates,
  getEndOfWeek,
  getLocalDateInTimezone,
  getLocalTimeInTimezone,
  getMonthDateRange,
  getStartOfWeek,
  isValidIsoDate,
  parseIsoDate,
  resolvePresetDateRange,
} from '../shared/dates.ts';
import crypto from 'node:crypto';
import {
  createGoalSchema,
  createHabitSchema,
  deleteAccountSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateGoalSchema,
  updateHabitSchema,
  updateProfileSchema,
  updateSettingsSchema,
  upsertLogSchema,
  verifyResetCodeSchema,
} from '../shared/validation.ts';
import { generateHabitAiInsights, isAiInsightsEnabled } from './aiInsights.ts';
import { buildCsvDocument } from './csv.ts';
import { isTransactionalEmailConfigured, sendPasswordResetCodeEmail } from './email.ts';
import {
  mapGoalRow,
  mapHabitLogRow,
  mapHabitRow,
  mapNotificationRow,
  mapUserSettings,
  mapUserToProfile,
} from './mappers.ts';
import { syncDueRemindersForUser } from './reminders.ts';
import {
  createRateLimiter,
  createRequireAuth,
  createUserSession,
  destroyUserSession,
  generateRandomToken,
  hashOpaqueToken,
  hashPassword,
  verifyPassword,
  type AuthenticatedRequest,
} from './security.ts';
import { parseSpreadsheetBuffer } from './spreadsheetImport.ts';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max workbook upload
});

async function getOrCreateUserSettings(db: AppDatabase, userId: number) {
  const existing = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    return mapUserSettings(existing[0]);
  }

  const inserted = await db
    .insert(userSettings)
    .values({ userId })
    .onConflictDoNothing({ target: userSettings.userId })
    .returning();

  if (inserted.length > 0) {
    return mapUserSettings(inserted[0]);
  }

  const retry = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  return mapUserSettings(retry[0]);
}

async function fetchUserHabitsAndLogs(
  db: AppDatabase,
  userId: number,
  logRange?: { startDate: string; endDate: string }
) {
  const habitRows = await db
    .select()
    .from(habits)
    .where(eq(habits.userId, userId))
    .orderBy(asc(habits.displayOrder), asc(habits.id));

  const logQuery = logRange
    ? db
        .select()
        .from(habitLogs)
        .where(
          and(
            eq(habitLogs.userId, userId),
            gte(habitLogs.localDate, logRange.startDate),
            lte(habitLogs.localDate, logRange.endDate)
          )
        )
    : db.select().from(habitLogs).where(eq(habitLogs.userId, userId));

  const logRows = await logQuery;

  return {
    habitsList: habitRows.map(mapHabitRow),
    logsList: logRows.map(mapHabitLogRow),
  };
}

export function createApp(getDb: () => Promise<AppDatabase>, nowProvider: () => Date = () => new Date()): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  const requireAuth = createRequireAuth(getDb);
  const authRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 25 });

  // Health endpoint (non-sensitive)
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, appName: getAppName() });
  });

  // ============================================================================
  // AUTHENTICATION ENDPOINTS
  // ============================================================================

  app.post('/api/auth/register', authRateLimiter, async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid registration details.',
        issues: parsed.error.issues,
      });
      return;
    }

    try {
      const db = await getDb();
      const { name, email, password, timezone, weekStartPreference } = parsed.data;

      const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (existing.length > 0) {
        res.status(409).json({ error: 'An account with this email address already exists.' });
        return;
      }

      const passwordHash = await hashPassword(password);

      const created = await db.transaction(async (tx) => {
        const [newUser] = await tx
          .insert(users)
          .values({
            name,
            email,
            passwordHash,
            timezone,
            weekStartPreference,
            onboardingCompleted: false,
          })
          .returning();

        const [newSettings] = await tx
          .insert(userSettings)
          .values({
            userId: newUser.id,
          })
          .returning();

        return { newUser, newSettings };
      });

      const { sessionToken, csrfToken } = await createUserSession(db, created.newUser.id, req, res);

      res.status(201).json({
        user: mapUserToProfile(created.newUser),
        settings: mapUserSettings(created.newSettings),
        csrfToken,
        sessionToken,
      });
    } catch (error: any) {
      if (String(error?.message || '').includes('users_email_unique_idx')) {
        res.status(409).json({ error: 'An account with this email address already exists.' });
        return;
      }
      console.error('Registration error:', error);
      res.status(500).json({ error: 'Unable to complete registration right now.' });
    }
  });

  app.post('/api/auth/login', authRateLimiter, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid credentials.' });
      return;
    }

    try {
      const db = await getDb();
      const { email, password } = parsed.data;

      const found = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (found.length === 0) {
        res.status(401).json({ error: 'Invalid email address or password.' });
        return;
      }

      const userRow = found[0];
      const passwordValid = await verifyPassword(password, userRow.passwordHash);
      if (!passwordValid) {
        res.status(401).json({ error: 'Invalid email address or password.' });
        return;
      }

      const settings = await getOrCreateUserSettings(db, userRow.id);
      const { sessionToken, csrfToken } = await createUserSession(db, userRow.id, req, res);

      res.json({
        user: mapUserToProfile(userRow),
        settings,
        csrfToken,
        sessionToken,
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Unable to sign in right now.' });
    }
  });

  app.post('/api/auth/logout', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = await getDb();
      await destroyUserSession(db, req, res);
      res.json({ ok: true });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({ error: 'Unable to sign out cleanly.' });
    }
  });

  app.get('/api/auth/me', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = await getDb();
      const settings = await getOrCreateUserSettings(db, req.authUser!.id);
      res.json({
        user: req.authUser,
        settings,
        csrfToken: req.csrfToken,
      });
    } catch (error) {
      console.error('Fetch current user error:', error);
      res.status(500).json({ error: 'Failed to load profile.' });
    }
  });

  app.post('/api/auth/forgot-password', authRateLimiter, async (req, res) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Enter a valid email address.' });
      return;
    }

    try {
      const db = await getDb();
      const { email } = parsed.data;
      const found = await db.select().from(users).where(eq(users.email, email)).limit(1);
      const now = nowProvider();

      if (found.length === 0) {
        res.status(404).json({
          error: `No account found for ${email}. Please create an account first or check the email address.`,
        });
        return;
      }

      const emailConfigured = isTransactionalEmailConfigured();
      const userRow = found[0];
      const sixDigitCode = String(crypto.randomInt(100000, 1000000));
      const otpHash = hashOpaqueToken(`otp:${email}:${sixDigitCode}`);
      const expiresAt = new Date(now.getTime() + 15 * 60 * 1000); // 15 minutes

      await db.transaction(async (tx) => {
        await tx
          .delete(passwordResetTokens)
          .where(and(eq(passwordResetTokens.userId, userRow.id), eq(passwordResetTokens.attempts, 0)));
        await tx
          .update(passwordResetTokens)
          .set({ usedAt: now })
          .where(eq(passwordResetTokens.userId, userRow.id));

        await tx.insert(passwordResetTokens).values({
          userId: userRow.id,
          tokenHash: otpHash,
          attempts: 0,
          expiresAt,
        });
      });

      let previewCode: string | undefined;
      let testResetCode: string | undefined;

      if (emailConfigured) {
        const delivery = await sendPasswordResetCodeEmail({
          to: email,
          recipientName: userRow.name,
          code: sixDigitCode,
          expiresInMinutes: 15,
        });

        if (!delivery.delivered) {
          res.status(502).json({
            error: delivery.error || 'Failed to send verification code email. Check your email configuration.',
          });
          return;
        }
      } else if (process.env.DISABLE_DEV_OTP_FALLBACK !== 'true') {
        previewCode = sixDigitCode;
      }

      if (process.env.NODE_ENV === 'test') {
        testResetCode = sixDigitCode;
      }

      res.json({
        ok: true,
        step: 'verify_code',
        emailDeliveryConfigured: emailConfigured,
        message: emailConfigured
          ? `A 6-digit verification code has been sent to ${email}. Check your Inbox and Spam folder.`
          : `Email sender secrets (GMAIL_USER + GMAIL_APP_PASSWORD) are not configured yet in Settings -> Secrets, so inbox email could not be sent externally. Use the generated 6-digit code below to continue.`,
        ...(previewCode ? { previewCode } : {}),
        ...(testResetCode ? { testResetCode } : {}),
      });
    } catch (error) {
      console.error('Forgot password error:', error);
      res.status(500).json({ error: 'Unable to process password reset request.' });
    }
  });

  app.post('/api/auth/verify-reset-code', authRateLimiter, async (req, res) => {
    const parsed = verifyResetCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Enter the 6-digit verification code.' });
      return;
    }

    try {
      const db = await getDb();
      const { email, code } = parsed.data;
      const now = nowProvider();

      const foundUsers = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (foundUsers.length === 0) {
        res.status(400).json({ error: 'Invalid or expired verification code.' });
        return;
      }

      const userRow = foundUsers[0];
      const activeTokens = await db
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.userId, userRow.id))
        .orderBy(desc(passwordResetTokens.id))
        .limit(5);

      const candidate = activeTokens.find((t) => t.usedAt === null && t.expiresAt > now && t.attempts < 5);
      if (!candidate) {
        res.status(400).json({ error: 'Verification code has expired or exceeded maximum attempts. Request a new code.' });
        return;
      }

      const expectedHash = hashOpaqueToken(`otp:${email}:${code}`);
      const candidateBuf = Buffer.from(candidate.tokenHash, 'utf8');
      const expectedBuf = Buffer.from(expectedHash, 'utf8');
      const matches =
        candidateBuf.length === expectedBuf.length &&
        crypto.timingSafeEqual(candidateBuf, expectedBuf);

      if (!matches) {
        const nextAttempts = candidate.attempts + 1;
        await db
          .update(passwordResetTokens)
          .set({
            attempts: nextAttempts,
            ...(nextAttempts >= 5 ? { usedAt: now } : {}),
          })
          .where(eq(passwordResetTokens.id, candidate.id));

        res.status(400).json({
          error:
            nextAttempts >= 5
              ? 'Too many incorrect code attempts. Please request a new 6-digit code.'
              : 'Incorrect verification code. Please check the 6-digit code and try again.',
        });
        return;
      }

      // Exchange verified 6-digit OTP for a single-use 256-bit reset session token valid for 10 minutes
      const verifiedResetToken = generateRandomToken(32);
      const verifiedTokenHash = hashOpaqueToken(verifiedResetToken);
      const resetExpiresAt = new Date(now.getTime() + 10 * 60 * 1000);

      await db
        .update(passwordResetTokens)
        .set({
          tokenHash: verifiedTokenHash,
          attempts: 0,
          expiresAt: resetExpiresAt,
        })
        .where(eq(passwordResetTokens.id, candidate.id));

      res.json({
        ok: true,
        resetToken: verifiedResetToken,
        message: 'Verification code confirmed. Set your new password below.',
      });
    } catch (error) {
      console.error('Verify reset code error:', error);
      res.status(500).json({ error: 'Unable to verify reset code right now.' });
    }
  });

  app.post('/api/auth/reset-password', authRateLimiter, async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid reset input.' });
      return;
    }

    try {
      const db = await getDb();
      const { token, password } = parsed.data;
      const tokenHash = hashOpaqueToken(token);
      const now = nowProvider();

      const foundTokens = await db
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.tokenHash, tokenHash))
        .limit(1);

      if (
        foundTokens.length === 0 ||
        foundTokens[0].usedAt !== null ||
        foundTokens[0].expiresAt <= now
      ) {
        res.status(400).json({ error: 'Your password reset session is invalid or has expired. Please request a new code.' });
        return;
      }

      const tokenRecord = foundTokens[0];
      const newPasswordHash = await hashPassword(password);

      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ passwordHash: newPasswordHash, updatedAt: now })
          .where(eq(users.id, tokenRecord.userId));

        await tx
          .update(passwordResetTokens)
          .set({ usedAt: now })
          .where(eq(passwordResetTokens.id, tokenRecord.id));

        // Revoke all existing sessions upon password reset
        await tx.delete(userSessions).where(eq(userSessions.userId, tokenRecord.userId));
      });

      res.json({ ok: true, message: 'Password updated. You can now sign in with your new password.' });
    } catch (error) {
      console.error('Reset password error:', error);
      res.status(500).json({ error: 'Unable to reset password.' });
    }
  });

  // ============================================================================
  // PROFILE, SETTINGS & ACCOUNT DELETION
  // ============================================================================

  app.patch('/api/profile', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid profile update.' });
      return;
    }

    try {
      const db = await getDb();
      const userId = req.authUser!.id;
      const data = parsed.data;

      const [currentUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!currentUser) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      const updateFields: Record<string, unknown> = { updatedAt: nowProvider() };

      if (data.name !== undefined) updateFields.name = data.name;
      if (data.avatarUrl !== undefined) updateFields.avatarUrl = data.avatarUrl;
      if (data.timezone !== undefined) updateFields.timezone = data.timezone;
      if (data.weekStartPreference !== undefined) updateFields.weekStartPreference = data.weekStartPreference;
      if (data.onboardingCompleted !== undefined) updateFields.onboardingCompleted = data.onboardingCompleted;

      if (data.email !== undefined && data.email !== currentUser.email) {
        const emailConflict = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, data.email))
          .limit(1);
        if (emailConflict.length > 0) {
          res.status(409).json({ error: 'That email address is already in use.' });
          return;
        }
        updateFields.email = data.email;
      }

      if (data.newPassword) {
        if (!data.currentPassword) {
          res.status(400).json({ error: 'Enter your current password to set a new password.' });
          return;
        }
        const ok = await verifyPassword(data.currentPassword, currentUser.passwordHash);
        if (!ok) {
          res.status(403).json({ error: 'Current password is incorrect.' });
          return;
        }
        updateFields.passwordHash = await hashPassword(data.newPassword);
      }

      const [updated] = await db
        .update(users)
        .set(updateFields)
        .where(eq(users.id, userId))
        .returning();

      res.json({ user: mapUserToProfile(updated) });
    } catch (error) {
      console.error('Profile update error:', error);
      res.status(500).json({ error: 'Failed to update profile.' });
    }
  });

  app.post(
    '/api/profile/avatar',
    requireAuth,
    upload.single('avatar'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: 'Please choose an image file to upload.' });
          return;
        }

        const allowedMimes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
        if (!allowedMimes.has(req.file.mimetype)) {
          res.status(400).json({ error: 'Unsupported format. Upload a PNG, JPG, WebP, or GIF image.' });
          return;
        }

        if (req.file.size > 1024 * 1024) {
          res.status(400).json({ error: 'Image must be 1 MB or smaller.' });
          return;
        }

        const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
        const db = await getDb();
        const [updated] = await db
          .update(users)
          .set({ avatarUrl: dataUrl, updatedAt: nowProvider() })
          .where(eq(users.id, req.authUser!.id))
          .returning();

        res.json({ user: mapUserToProfile(updated) });
      } catch (error) {
        console.error('Avatar upload error:', error);
        res.status(500).json({ error: 'Failed to upload profile photo.' });
      }
    }
  );

  app.delete('/api/profile/avatar', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = await getDb();
      const [updated] = await db
        .update(users)
        .set({ avatarUrl: null, updatedAt: nowProvider() })
        .where(eq(users.id, req.authUser!.id))
        .returning();

      res.json({ user: mapUserToProfile(updated) });
    } catch (error) {
      console.error('Avatar delete error:', error);
      res.status(500).json({ error: 'Failed to remove profile photo.' });
    }
  });

  app.patch('/api/settings', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid settings payload.' });
      return;
    }

    try {
      const db = await getDb();
      const userId = req.authUser!.id;
      const current = await getOrCreateUserSettings(db, userId);

      const updateFields: Record<string, unknown> = { updatedAt: nowProvider() };
      if (parsed.data.theme !== undefined) updateFields.theme = parsed.data.theme;
      if (parsed.data.locale !== undefined) updateFields.locale = parsed.data.locale;
      if (parsed.data.defaultDateRange !== undefined) updateFields.defaultDateRange = parsed.data.defaultDateRange;
      if (parsed.data.notificationPreferences !== undefined) {
        updateFields.notificationPreferences = {
          ...current.notificationPreferences,
          ...parsed.data.notificationPreferences,
        };
      }
      if (parsed.data.reminderPreferences !== undefined) {
        updateFields.reminderPreferences = {
          ...current.reminderPreferences,
          ...parsed.data.reminderPreferences,
        };
      }

      const [updated] = await db
        .update(userSettings)
        .set(updateFields)
        .where(eq(userSettings.userId, userId))
        .returning();

      res.json({ settings: mapUserSettings(updated) });
    } catch (error) {
      console.error('Update settings error:', error);
      res.status(500).json({ error: 'Failed to save workspace settings.' });
    }
  });

  app.delete('/api/account', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const parsed = deleteAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Confirmation required.' });
      return;
    }

    try {
      const db = await getDb();
      const userId = req.authUser!.id;
      const [userRow] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!userRow) {
        res.status(404).json({ error: 'Account not found.' });
        return;
      }

      const validPassword = await verifyPassword(parsed.data.password, userRow.passwordHash);
      if (!validPassword) {
        res.status(403).json({ error: 'Incorrect password. Account deletion cancelled.' });
        return;
      }

      await destroyUserSession(db, req, res);
      // Cascading foreign keys permanently remove all habits, logs, goals, settings, sessions, and notifications
      await db.delete(users).where(eq(users.id, userId));

      res.json({ ok: true });
    } catch (error) {
      console.error('Account deletion error:', error);
      res.status(500).json({ error: 'Failed to delete account.' });
    }
  });

  // ============================================================================
  // HABIT MANAGEMENT & ONBOARDING STARTER / SPREADSHEET IMPORT
  // ============================================================================

  app.get('/api/habits', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = await getDb();
      const userId = req.authUser!.id;
      const statusFilter = String(req.query.status || 'all');
      const categoryFilter = req.query.category ? String(req.query.category) : null;
      const scheduleFilter = req.query.schedule ? String(req.query.schedule) : null;
      const searchQ = req.query.q ? String(req.query.q).trim().toLowerCase() : null;
      const sortBy = String(req.query.sort || 'order');

      const { habitsList, logsList } = await fetchUserHabitsAndLogs(db, userId);
      const now = nowProvider();
      const userToday = getLocalDateInTimezone(now, req.authUser!.timezone);
      const userTime = getLocalTimeInTimezone(now, req.authUser!.timezone);

      const logsByHabit = new Map<number, Map<string, ReturnType<typeof mapHabitLogRow>>>();
      for (const l of logsList) {
        let m = logsByHabit.get(l.habitId);
        if (!m) {
          m = new Map();
          logsByHabit.set(l.habitId, m);
        }
        m.set(l.localDate, l);
      }

      let filtered = habitsList.filter((h) => {
        if (statusFilter === 'active' && h.status !== 'active') return false;
        if (statusFilter === 'archived' && h.status !== 'archived') return false;
        if (categoryFilter && categoryFilter !== 'all' && h.category !== categoryFilter) return false;
        if (scheduleFilter && scheduleFilter !== 'all' && h.scheduleType !== scheduleFilter) return false;
        if (searchQ && !h.name.toLowerCase().includes(searchQ)) return false;
        return true;
      });

      const priorityRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
      filtered = [...filtered].sort((a, b) => {
        if (sortBy === 'priority') {
          const diff = (priorityRank[b.priority] ?? 0) - (priorityRank[a.priority] ?? 0);
          return diff !== 0 ? diff : a.name.localeCompare(b.name);
        }
        if (sortBy === 'name') {
          return a.name.localeCompare(b.name);
        }
        return a.displayOrder !== b.displayOrder ? a.displayOrder - b.displayOrder : a.id - b.id;
      });

      const enriched = filtered.map((habit) => {
        const streaks = calculateHabitStreak(
          habit,
          logsByHabit.get(habit.id) ?? new Map(),
          userToday,
          userTime
        );
        return {
          ...habit,
          currentStreak: streaks.currentStreak,
          longestStreak: streaks.longestStreak,
        };
      });

      res.json({ habits: enriched });
    } catch (error) {
      console.error('List habits error:', error);
      res.status(500).json({ error: 'Failed to load habits.' });
    }
  });

  app.post('/api/habits', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const parsed = createHabitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid habit fields.',
        issues: parsed.error.issues,
      });
      return;
    }

    try {
      const db = await getDb();
      const userId = req.authUser!.id;
      const existingHabits = await db
        .select({ id: habits.id, displayOrder: habits.displayOrder })
        .from(habits)
        .where(eq(habits.userId, userId));

      const maxOrder = existingHabits.reduce((max, h) => Math.max(max, h.displayOrder), -1);

      const [inserted] = await db
        .insert(habits)
        .values({
          userId,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          category: parsed.data.category,
          icon: parsed.data.icon,
          color: parsed.data.color,
          habitType: parsed.data.habitType,
          scheduleType: parsed.data.scheduleType,
          scheduleConfig: parsed.data.scheduleConfig ?? {},
          targetValue: parsed.data.targetValue,
          targetUnit: parsed.data.targetUnit ?? null,
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate ?? null,
          reminderTime: parsed.data.reminderTime ?? null,
          completionDeadline: parsed.data.completionDeadline ?? null,
          priority: parsed.data.priority,
          displayOrder: parsed.data.displayOrder ?? maxOrder + 1,
          status: 'active',
        })
        .returning();

      res.status(201).json({ habit: mapHabitRow(inserted) });
    } catch (error) {
      console.error('Create habit error:', error);
      res.status(500).json({ error: 'Failed to create habit.' });
    }
  });

  app.post('/api/habits/starter', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = await getDb();
      const userId = req.authUser!.id;
      const selectedIndices: number[] | null = Array.isArray(req.body?.indices)
        ? req.body.indices.map(Number)
        : null;

      const userToday = getLocalDateInTimezone(nowProvider(), req.authUser!.timezone);
      const existingRows = await db.select().from(habits).where(eq(habits.userId, userId));
      const existingNames = new Set(existingRows.map((r) => r.name.trim().toLowerCase()));
      let nextOrder = existingRows.reduce((max, r) => Math.max(max, r.displayOrder), -1) + 1;

      const templates = selectedIndices
        ? SPREADSHEET_STARTER_HABITS.filter((_, idx) => selectedIndices.includes(idx))
        : SPREADSHEET_STARTER_HABITS;

      const toInsert = templates.filter((tpl) => !existingNames.has(tpl.name.trim().toLowerCase()));
      const created: ReturnType<typeof mapHabitRow>[] = [];

      await db.transaction(async (tx) => {
        for (const tpl of toInsert) {
          const [row] = await tx
            .insert(habits)
            .values({
              userId,
              name: tpl.name,
              description: tpl.description,
              category: tpl.category,
              icon: tpl.icon,
              color: tpl.color,
              habitType: tpl.habitType,
              scheduleType: tpl.scheduleType,
              scheduleConfig: {},
              targetValue: tpl.targetValue,
              targetUnit: tpl.targetUnit,
              startDate: userToday,
              endDate: null,
              reminderTime: tpl.reminderTime,
              completionDeadline: tpl.completionDeadline,
              priority: tpl.priority,
              displayOrder: nextOrder++,
              status: 'active',
            })
            .returning();
          created.push(mapHabitRow(row));
        }

        await tx
          .update(users)
          .set({ onboardingCompleted: true, updatedAt: nowProvider() })
          .where(eq(users.id, userId));
      });

      res.status(201).json({
        createdCount: created.length,
        skippedDuplicates: templates.length - created.length,
        habits: created,
      });
    } catch (error) {
      console.error('Starter habits import error:', error);
      res.status(500).json({ error: 'Failed to add starter habits.' });
    }
  });

  app.get('/api/habits/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const habitId = Number(req.params.id);
    if (!Number.isInteger(habitId) || habitId <= 0) {
      res.status(400).json({ error: 'Invalid habit ID.' });
      return;
    }

    try {
      const db = await getDb();
      const rows = await db
        .select()
        .from(habits)
        .where(and(eq(habits.id, habitId), eq(habits.userId, req.authUser!.id)))
        .limit(1);

      if (rows.length === 0) {
        res.status(404).json({ error: 'Habit not found.' });
        return;
      }

      res.json({ habit: mapHabitRow(rows[0]) });
    } catch (error) {
      console.error('Get habit error:', error);
      res.status(500).json({ error: 'Failed to load habit.' });
    }
  });

  app.patch('/api/habits/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const habitId = Number(req.params.id);
    if (!Number.isInteger(habitId) || habitId <= 0) {
      res.status(400).json({ error: 'Invalid habit ID.' });
      return;
    }

    const parsed = updateHabitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid habit update.',
        issues: parsed.error.issues,
      });
      return;
    }

    try {
      const db = await getDb();
      const userId = req.authUser!.id;
      const existing = await db
        .select()
        .from(habits)
        .where(and(eq(habits.id, habitId), eq(habits.userId, userId)))
        .limit(1);

      if (existing.length === 0) {
        res.status(404).json({ error: 'Habit not found.' });
        return;
      }

      const now = nowProvider();
      const updateFields: Record<string, unknown> = {
        ...parsed.data,
        updatedAt: now,
      };

      if (parsed.data.status === 'archived' && existing[0].status !== 'archived') {
        updateFields.archivedAt = now;
        updateFields.archivedLocalDate = getLocalDateInTimezone(now, req.authUser!.timezone);
      } else if (parsed.data.status === 'active' && existing[0].status === 'archived') {
        updateFields.archivedAt = null;
        updateFields.archivedLocalDate = null;
      }

      const [updated] = await db
        .update(habits)
        .set(updateFields)
        .where(and(eq(habits.id, habitId), eq(habits.userId, userId)))
        .returning();

      res.json({ habit: mapHabitRow(updated) });
    } catch (error) {
      console.error('Update habit error:', error);
      res.status(500).json({ error: 'Failed to update habit.' });
    }
  });

  app.post('/api/habits/:id/archive', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const habitId = Number(req.params.id);
    if (!Number.isInteger(habitId) || habitId <= 0) {
      res.status(400).json({ error: 'Invalid habit ID.' });
      return;
    }

    try {
      const db = await getDb();
      const userId = req.authUser!.id;
      const restore = Boolean(req.body?.restore);
      const now = nowProvider();
      const localDate = getLocalDateInTimezone(now, req.authUser!.timezone);

      const updated = await db
        .update(habits)
        .set({
          status: restore ? 'active' : 'archived',
          archivedAt: restore ? null : now,
          archivedLocalDate: restore ? null : localDate,
          updatedAt: now,
        })
        .where(and(eq(habits.id, habitId), eq(habits.userId, userId)))
        .returning();

      if (updated.length === 0) {
        res.status(404).json({ error: 'Habit not found.' });
        return;
      }

      res.json({ habit: mapHabitRow(updated[0]) });
    } catch (error) {
      console.error('Archive habit error:', error);
      res.status(500).json({ error: 'Failed to update habit archive status.' });
    }
  });

  app.delete('/api/habits/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const habitId = Number(req.params.id);
    if (!Number.isInteger(habitId) || habitId <= 0) {
      res.status(400).json({ error: 'Invalid habit ID.' });
      return;
    }

    try {
      const db = await getDb();
      const deleted = await db
        .delete(habits)
        .where(and(eq(habits.id, habitId), eq(habits.userId, req.authUser!.id)))
        .returning({ id: habits.id });

      if (deleted.length === 0) {
        res.status(404).json({ error: 'Habit not found.' });
        return;
      }

      res.json({ ok: true, deletedId: habitId });
    } catch (error) {
      console.error('Delete habit error:', error);
      res.status(500).json({ error: 'Failed to delete habit.' });
    }
  });

  // Spreadsheet Import (Preview + Commit)
  app.post(
    '/api/import/preview',
    requireAuth,
    upload.single('file'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: 'Upload an .xlsx, .xls, or .csv spreadsheet file.' });
          return;
        }

        const ext = req.file.originalname.toLowerCase();
        if (!ext.endsWith('.xlsx') && !ext.endsWith('.xls') && !ext.endsWith('.csv')) {
          res.status(400).json({ error: 'Unsupported file type. Upload an .xlsx, .xls, or .csv file.' });
          return;
        }

        const db = await getDb();
        const existingHabits = await db
          .select({ name: habits.name })
          .from(habits)
          .where(eq(habits.userId, req.authUser!.id));

        const existingLower = new Set(existingHabits.map((h) => h.name.trim().toLowerCase()));
        const preview = parseSpreadsheetBuffer(req.file.buffer, req.file.originalname, existingLower);

        res.json({ preview });
      } catch (error) {
        console.error('Spreadsheet preview error:', error);
        res.status(400).json({ error: 'Unable to parse spreadsheet workbook. Check file formatting.' });
      }
    }
  );

  app.post('/api/import/commit', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = await getDb();
      const userId = req.authUser!.id;
      const now = nowProvider();
      const userToday = getLocalDateInTimezone(now, req.authUser!.timezone);

      const incomingHabits = Array.isArray(req.body?.habits) ? req.body.habits : [];
      const incomingLogs = Array.isArray(req.body?.logs) ? req.body.logs : [];

      const existingRows = await db.select().from(habits).where(eq(habits.userId, userId));
      const habitByLowerName = new Map<string, ReturnType<typeof mapHabitRow>>();
      for (const r of existingRows) {
        habitByLowerName.set(r.name.trim().toLowerCase(), mapHabitRow(r));
      }
      let nextOrder = existingRows.reduce((max, r) => Math.max(max, r.displayOrder), -1) + 1;

      let createdHabits = 0;
      let importedLogs = 0;

      // Find earliest log date per habit so imported historical entries remain scheduled
      const earliestLogByHabit = new Map<string, string>();
      for (const l of incomingLogs) {
        const key = String(l.habitName || '').trim().toLowerCase();
        const dt = String(l.localDate || '');
        if (key && isValidIsoDate(dt)) {
          const prev = earliestLogByHabit.get(key);
          if (!prev || dt < prev) earliestLogByHabit.set(key, dt);
        }
      }

      await db.transaction(async (tx) => {
        for (const item of incomingHabits) {
          const name = String(item?.name || '').trim().slice(0, 120);
          if (!name) continue;
          const lower = name.toLowerCase();
          if (habitByLowerName.has(lower)) continue;

          const earliestLog = earliestLogByHabit.get(lower);
          const startDate = earliestLog && earliestLog < userToday ? earliestLog : userToday;

          const [created] = await tx
            .insert(habits)
            .values({
              userId,
              name,
              category: String(item.category || 'Personal Development').slice(0, 60),
              icon: 'CheckCircle2',
              color: '#C6FF00',
              habitType: ['boolean', 'count', 'duration'].includes(item.habitType) ? item.habitType : 'boolean',
              scheduleType: ['daily', 'weekdays', 'weekends', 'custom_days'].includes(item.scheduleType)
                ? item.scheduleType
                : 'daily',
              scheduleConfig: {},
              targetValue: Number(item.targetValue) > 0 ? Number(item.targetValue) : 1,
              targetUnit: item.targetUnit ? String(item.targetUnit).slice(0, 32) : null,
              startDate,
              priority: 'medium',
              displayOrder: nextOrder++,
              status: 'active',
            })
            .returning();

          habitByLowerName.set(lower, mapHabitRow(created));
          createdHabits += 1;
        }

        for (const logItem of incomingLogs) {
          const lower = String(logItem?.habitName || '').trim().toLowerCase();
          const localDate = String(logItem?.localDate || '').trim();
          const targetHabit = habitByLowerName.get(lower);
          if (!targetHabit || !isValidIsoDate(localDate) || localDate > userToday) continue;

          const insertedLog = await tx
            .insert(habitLogs)
            .values({
              userId,
              habitId: targetHabit.id,
              localDate,
              completed: Boolean(logItem.completed),
              numericValue:
                logItem.numericValue != null && Number.isFinite(Number(logItem.numericValue))
                  ? Number(logItem.numericValue)
                  : null,
              durationSeconds:
                targetHabit.habitType === 'duration' && logItem.numericValue != null
                  ? Math.round(Number(logItem.numericValue) * 60)
                  : null,
              completedAt: logItem.completed ? now : null,
            })
            .onConflictDoNothing({
              target: [habitLogs.userId, habitLogs.habitId, habitLogs.localDate],
            })
            .returning({ id: habitLogs.id });

          if (insertedLog.length > 0) importedLogs += 1;
        }

        await tx
          .update(users)
          .set({ onboardingCompleted: true, updatedAt: now })
          .where(eq(users.id, userId));
      });

      res.status(201).json({ ok: true, createdHabits, importedLogs });
    } catch (error) {
      console.error('Spreadsheet commit error:', error);
      res.status(500).json({ error: 'Failed to commit imported spreadsheet records.' });
    }
  });

  // ============================================================================
  // DAILY TRACKING & CALENDAR ENDPOINTS
  // ============================================================================

  app.get('/api/tracking/day', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = await getDb();
      const userId = req.authUser!.id;
      const now = nowProvider();
      const userToday = getLocalDateInTimezone(now, req.authUser!.timezone);
      const userTime = getLocalTimeInTimezone(now, req.authUser!.timezone);

      const requestedDate = req.query.date ? String(req.query.date) : userToday;
      if (!isValidIsoDate(requestedDate)) {
        res.status(400).json({ error: 'Invalid date parameter. Expected YYYY-MM-DD.' });
        return;
      }

      const { habitsList, logsList } = await fetchUserHabitsAndLogs(db, userId);
      const logsLookup = buildLogsLookup(logsList);

      const logsByHabit = new Map<number, Map<string, ReturnType<typeof mapHabitLogRow>>>();
      for (const log of logsList) {
        let m = logsByHabit.get(log.habitId);
        if (!m) {
          m = new Map();
          logsByHabit.set(log.habitId, m);
        }
        m.set(log.localDate, log);
      }

      const occurrences = habitsList
        .filter((h) => !(h.status === 'archived' && (!h.archivedLocalDate || requestedDate > h.archivedLocalDate)))
        .map((habit) => {
          const base = classifyOccurrence(
            habit,
            requestedDate,
            logsLookup.get(`${habit.id}:${requestedDate}`),
            userToday,
            userTime
          );
          const streaks = calculateHabitStreak(
            habit,
            logsByHabit.get(habit.id) ?? new Map(),
            userToday,
            userTime
          );
          return {
            ...base,
            currentStreak: streaks.currentStreak,
            longestStreak: streaks.longestStreak,
          };
        });

      const summary = calculateDaySummary(habitsList, logsLookup, requestedDate, userToday, userTime);

      res.json({
        date: requestedDate,
        userToday,
        summary,
        occurrences,
      });
    } catch (error) {
      console.error('Get tracking day error:', error);
      res.status(500).json({ error: 'Failed to load daily tracking data.' });
    }
  });

  app.get('/api/tracking/range', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = await getDb();
      const userId = req.authUser!.id;
      const now = nowProvider();
      const userToday = getLocalDateInTimezone(now, req.authUser!.timezone);
      const userTime = getLocalTimeInTimezone(now, req.authUser!.timezone);

      const start = String(req.query.start || '');
      const end = String(req.query.end || '');
      if (!isValidIsoDate(start) || !isValidIsoDate(end) || start > end) {
        res.status(400).json({ error: 'Provide valid start and end YYYY-MM-DD query parameters.' });
        return;
      }

      if (daysBetweenInclusive(start, end) > 370) {
        res.status(400).json({ error: 'Date range cannot exceed 370 days.' });
        return;
      }

      const { habitsList, logsList } = await fetchUserHabitsAndLogs(db, userId);
      const logsLookup = buildLogsLookup(logsList);
      const rangeMetrics = calculateRangeMetrics(habitsList, logsLookup, start, end, userToday, userTime);

      const { year, month } = parseIsoDate(start);
      const queryYear = req.query.year ? Number(req.query.year) : year;
      const queryMonth = req.query.month ? Number(req.query.month) : month;

      const weekGroups = calculateMonthWeekSummaries(
        queryYear,
        queryMonth,
        req.authUser!.weekStartPreference,
        habitsList,
        logsLookup,
        userToday,
        userTime
      );

      const rangeLogs = logsList.filter((l) => l.localDate >= start && l.localDate <= end);

      res.json({
        startDate: start,
        endDate: end,
        userToday,
        habits: habitsList,
        logs: rangeLogs,
        metrics: rangeMetrics,
        weekGroups,
      });
    } catch (error) {
      console.error('Get tracking range error:', error);
      res.status(500).json({ error: 'Failed to load calendar tracking range.' });
    }
  });

  app.put('/api/habits/:id/logs/:date', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const habitId = Number(req.params.id);
    const localDate = String(req.params.date || '');

    if (!Number.isInteger(habitId) || habitId <= 0 || !isValidIsoDate(localDate)) {
      res.status(400).json({ error: 'Invalid habit ID or local date (YYYY-MM-DD).' });
      return;
    }

    const parsed = upsertLogSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid log entry payload.' });
      return;
    }

    try {
      const db = await getDb();
      const userId = req.authUser!.id;
      const now = nowProvider();
      const userToday = getLocalDateInTimezone(now, req.authUser!.timezone);
      const userTime = getLocalTimeInTimezone(now, req.authUser!.timezone);

      if (localDate > userToday) {
        res.status(400).json({ error: 'Future dates cannot be marked complete in advance.' });
        return;
      }

      const habitRows = await db
        .select()
        .from(habits)
        .where(and(eq(habits.id, habitId), eq(habits.userId, userId)))
        .limit(1);

      if (habitRows.length === 0) {
        res.status(404).json({ error: 'Habit not found.' });
        return;
      }

      const habit = mapHabitRow(habitRows[0]);
      const payload = parsed.data;

      let numericValue: number | null = payload.numericValue ?? null;
      let durationSeconds: number | null = payload.durationSeconds ?? null;
      let completedFlag = payload.completed ?? false;

      if (habit.habitType === 'boolean') {
        completedFlag = Boolean(payload.completed);
        numericValue = completedFlag ? 1 : 0;
      } else if (habit.habitType === 'count') {
        if (numericValue === null && payload.completed === true) {
          numericValue = habit.targetValue;
        }
        const tempEval = evaluateHabitCompletion(habit, {
          id: 0,
          userId,
          habitId,
          localDate,
          completed: Boolean(payload.completed),
          numericValue,
          durationSeconds: null,
          notes: payload.notes ?? null,
          completedAt: null,
          createdAt: '',
          updatedAt: '',
        });
        completedFlag = tempEval.isCompleted;
      } else if (habit.habitType === 'duration') {
        const unitSeconds = habit.targetUnit === 'hours' ? 3600 : 60;
        if (durationSeconds === null && numericValue !== null) {
          durationSeconds = Math.round(numericValue * unitSeconds);
        } else if (durationSeconds === null && payload.completed === true) {
          durationSeconds = Math.round(habit.targetValue * unitSeconds);
        }
        const tempEval = evaluateHabitCompletion(habit, {
          id: 0,
          userId,
          habitId,
          localDate,
          completed: Boolean(payload.completed),
          numericValue,
          durationSeconds,
          notes: payload.notes ?? null,
          completedAt: null,
          createdAt: '',
          updatedAt: '',
        });
        completedFlag = tempEval.isCompleted;
      }

      const [savedRow] = await db
        .insert(habitLogs)
        .values({
          userId,
          habitId,
          localDate,
          completed: completedFlag,
          numericValue,
          durationSeconds,
          notes: payload.notes ?? null,
          completedAt: completedFlag ? now : null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [habitLogs.userId, habitLogs.habitId, habitLogs.localDate],
          set: {
            completed: completedFlag,
            numericValue,
            durationSeconds,
            notes: payload.notes !== undefined ? payload.notes : undefined,
            completedAt: completedFlag ? now : null,
            updatedAt: now,
          },
        })
        .returning();

      // Recompute authoritative streaks and day summary
      const { habitsList, logsList } = await fetchUserHabitsAndLogs(db, userId);
      const logsLookup = buildLogsLookup(logsList);
      const habitSpecificLogs = new Map<string, ReturnType<typeof mapHabitLogRow>>();
      for (const l of logsList) {
        if (l.habitId === habitId) habitSpecificLogs.set(l.localDate, l);
      }

      const habitStreaks = calculateHabitStreak(habit, habitSpecificLogs, userToday, userTime);
      const daySummary = calculateDaySummary(habitsList, logsLookup, localDate, userToday, userTime);

      // Award deduplicated milestone notification on 7, 14, 30, 60, 100 day streaks
      if (completedFlag && [7, 14, 30, 60, 100].includes(habitStreaks.currentStreak)) {
        const milestoneKey = `milestone:${userId}:${habitId}:${habitStreaks.currentStreak}:${localDate}`;
        await db
          .insert(notifications)
          .values({
            userId,
            habitId,
            dedupeKey: milestoneKey,
            type: 'milestone',
            title: `${habitStreaks.currentStreak}-Day Streak on ${habit.name}`,
            message: `You have completed "${habit.name}" across ${habitStreaks.currentStreak} scheduled occurrences in a row.`,
            deliveredAt: now,
            status: 'unread',
          })
          .onConflictDoNothing({ target: notifications.dedupeKey });
      }

      res.json({
        log: mapHabitLogRow(savedRow),
        streaks: habitStreaks,
        daySummary,
      });
    } catch (error) {
      console.error('Upsert habit log error:', error);
      res.status(500).json({ error: 'Failed to save habit entry.' });
    }
  });

  app.delete('/api/habits/:id/logs/:date', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const habitId = Number(req.params.id);
    const localDate = String(req.params.date || '');

    if (!Number.isInteger(habitId) || habitId <= 0 || !isValidIsoDate(localDate)) {
      res.status(400).json({ error: 'Invalid habit ID or local date.' });
      return;
    }

    try {
      const db = await getDb();
      const userId = req.authUser!.id;
      const now = nowProvider();
      const userToday = getLocalDateInTimezone(now, req.authUser!.timezone);
      const userTime = getLocalTimeInTimezone(now, req.authUser!.timezone);

      const habitCheck = await db
        .select()
        .from(habits)
        .where(and(eq(habits.id, habitId), eq(habits.userId, userId)))
        .limit(1);

      if (habitCheck.length === 0) {
        res.status(404).json({ error: 'Habit not found.' });
        return;
      }

      await db
        .delete(habitLogs)
        .where(
          and(
            eq(habitLogs.userId, userId),
            eq(habitLogs.habitId, habitId),
            eq(habitLogs.localDate, localDate)
          )
        );

      const { habitsList, logsList } = await fetchUserHabitsAndLogs(db, userId);
      const logsLookup = buildLogsLookup(logsList);
      const habitSpecificLogs = new Map<string, ReturnType<typeof mapHabitLogRow>>();
      for (const l of logsList) {
        if (l.habitId === habitId) habitSpecificLogs.set(l.localDate, l);
      }

      const habitStreaks = calculateHabitStreak(
        mapHabitRow(habitCheck[0]),
        habitSpecificLogs,
        userToday,
        userTime
      );
      const daySummary = calculateDaySummary(habitsList, logsLookup, localDate, userToday, userTime);

      res.json({ ok: true, streaks: habitStreaks, daySummary });
    } catch (error) {
      console.error('Delete habit log error:', error);
      res.status(500).json({ error: 'Failed to remove habit entry.' });
    }
  });

  // ============================================================================
  // ANALYTICS & WEEKLY REVIEW ENDPOINTS
  // ============================================================================

  app.get('/api/analytics/overview', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = await getDb();
      const userId = req.authUser!.id;
      const now = nowProvider();
      const userToday = getLocalDateInTimezone(now, req.authUser!.timezone);
      const userTime = getLocalTimeInTimezone(now, req.authUser!.timezone);
      const weekStartPref = req.authUser!.weekStartPreference;

      const selectedDate =
        req.query.date && isValidIsoDate(String(req.query.date)) ? String(req.query.date) : userToday;

      const preset = String(req.query.preset || '30d');
      const range = resolvePresetDateRange(
        preset,
        userToday,
        weekStartPref,
        req.query.start ? String(req.query.start) : undefined,
        req.query.end ? String(req.query.end) : undefined
      );

      const { habitsList, logsList } = await fetchUserHabitsAndLogs(db, userId);
      const logsLookup = buildLogsLookup(logsList);

      const todaySummary = calculateDaySummary(habitsList, logsLookup, selectedDate, userToday, userTime);
      const sevenDayOverview = calculateRangeMetrics(
        habitsList,
        logsLookup,
        addDays(selectedDate, -6),
        selectedDate,
        userToday,
        userTime
      );

      const currentWeekStart = getStartOfWeek(userToday, weekStartPref);
      const currentWeekEnd = getEndOfWeek(userToday, weekStartPref);
      const weeklyMetrics = calculateRangeMetrics(
        habitsList,
        logsLookup,
        currentWeekStart,
        currentWeekEnd,
        userToday,
        userTime
      );

      const prevWeekMetrics = calculateRangeMetrics(
        habitsList,
        logsLookup,
        addDays(currentWeekStart, -7),
        addDays(currentWeekStart, -1),
        userToday,
        userTime
      );

      const { year, month } = parseIsoDate(userToday);
      const monthRange = getMonthDateRange(year, month);
      const monthlyMetrics = calculateRangeMetrics(
        habitsList,
        logsLookup,
        monthRange.startDate,
        monthRange.endDate,
        userToday,
        userTime
      );

      const prevMonthYear = month === 1 ? year - 1 : year;
      const prevMonthNum = month === 1 ? 12 : month - 1;
      const prevMonthRange = getMonthDateRange(prevMonthYear, prevMonthNum);
      const prevMonthlyMetrics = calculateRangeMetrics(
        habitsList,
        logsLookup,
        prevMonthRange.startDate,
        prevMonthRange.endDate,
        userToday,
        userTime
      );

      const overallStreaks = calculateOverallConsistencyStreak(habitsList, logsLookup, userToday, userTime);
      const rankedHabits = rankHabitsInPeriod(
        habitsList,
        logsList,
        range.startDate,
        range.endDate,
        userToday,
        userTime
      );

      const selectedPeriodMetrics = calculateRangeMetrics(
        habitsList,
        logsLookup,
        range.startDate,
        range.endDate,
        userToday,
        userTime
      );

      const spanDays = daysBetweenInclusive(range.startDate, range.endDate);
      const priorStart = addDays(range.startDate, -spanDays);
      const priorEnd = addDays(range.startDate, -1);
      const priorPeriodMetrics = calculateRangeMetrics(
        habitsList,
        logsLookup,
        priorStart,
        priorEnd,
        userToday,
        userTime
      );

      // Category-level aggregation
      const categoryMap = new Map<
        string,
        { category: string; completed: number; eligible: number; habitCount: number }
      >();
      for (const h of rankedHabits) {
        const entry = categoryMap.get(h.category) ?? {
          category: h.category,
          completed: 0,
          eligible: 0,
          habitCount: 0,
        };
        entry.completed += h.completedOccurrences;
        entry.eligible += h.eligibleOccurrences;
        entry.habitCount += 1;
        categoryMap.set(h.category, entry);
      }

      const categoryPerformance = Array.from(categoryMap.values())
        .map((c) => ({
          ...c,
          completionRate: c.eligible > 0 ? roundMetric((c.completed / c.eligible) * 100, 1) : 0,
        }))
        .sort((a, b) => b.completionRate - a.completionRate);

      const eligibleRanked = rankedHabits.filter((h) => h.eligibleOccurrences > 0);
      const bestHabit = eligibleRanked.length > 0 ? eligibleRanked[0] : null;
      const attentionHabit =
        eligibleRanked.length > 0
          ? [...eligibleRanked].sort((a, b) => {
              if (b.missedOccurrences !== a.missedOccurrences) return b.missedOccurrences - a.missedOccurrences;
              return a.completionRate - b.completionRate;
            })[0]
          : null;

      const weeklyDelta =
        prevWeekMetrics.eligibleToDate > 0
          ? roundMetric(weeklyMetrics.completionRate - prevWeekMetrics.completionRate, 1)
          : null;
      const monthlyDelta =
        prevMonthlyMetrics.eligibleToDate > 0
          ? roundMetric(monthlyMetrics.completionRate - prevMonthlyMetrics.completionRate, 1)
          : null;
      const periodDelta =
        priorPeriodMetrics.eligibleToDate > 0
          ? roundMetric(selectedPeriodMetrics.completionRate - priorPeriodMetrics.completionRate, 1)
          : null;

      res.json({
        userToday,
        selectedDate,
        range,
        hasAnyHabits: habitsList.length > 0,
        hasHistory: logsList.length > 0,
        todaySummary,
        sevenDayOverview: sevenDayOverview.dailySummaries,
        weekly: {
          ...weeklyMetrics,
          previousRate: prevWeekMetrics.completionRate,
          delta: weeklyDelta,
        },
        monthly: {
          ...monthlyMetrics,
          previousRate: prevMonthlyMetrics.completionRate,
          delta: monthlyDelta,
        },
        selectedPeriod: {
          ...selectedPeriodMetrics,
          previousRate: priorPeriodMetrics.completionRate,
          delta: periodDelta,
        },
        streaks: overallStreaks,
        topHabits: rankedHabits,
        categoryPerformance,
        insights: {
          bestHabit,
          attentionHabit: attentionHabit && attentionHabit.missedOccurrences > 0 ? attentionHabit : null,
          weeklyDelta,
          monthlyDelta,
        },
      });
    } catch (error) {
      console.error('Analytics overview error:', error);
      res.status(500).json({ error: 'Failed to calculate analytics overview.' });
    }
  });

  app.get('/api/analytics/trends', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = await getDb();
      const userId = req.authUser!.id;
      const now = nowProvider();
      const userToday = getLocalDateInTimezone(now, req.authUser!.timezone);
      const userTime = getLocalTimeInTimezone(now, req.authUser!.timezone);
      const weekStartPref = req.authUser!.weekStartPreference;

      const preset = String(req.query.preset || '30d');
      const range = resolvePresetDateRange(
        preset,
        userToday,
        weekStartPref,
        req.query.start ? String(req.query.start) : undefined,
        req.query.end ? String(req.query.end) : undefined
      );

      const { habitsList, logsList } = await fetchUserHabitsAndLogs(db, userId);
      const logsLookup = buildLogsLookup(logsList);

      const effectiveEnd = range.endDate > userToday ? userToday : range.endDate;
      const dailyMetrics =
        range.startDate <= effectiveEnd
          ? calculateRangeMetrics(habitsList, logsLookup, range.startDate, effectiveEnd, userToday, userTime)
          : { dailySummaries: [] };

      // Last 8 weeks comparison
      const currentWeekStart = getStartOfWeek(userToday, weekStartPref);
      const weeklySeries = [];
      for (let i = 7; i >= 0; i--) {
        const wStart = addDays(currentWeekStart, -i * 7);
        const wEnd = addDays(wStart, 6);
        const m = calculateRangeMetrics(habitsList, logsLookup, wStart, wEnd, userToday, userTime);
        weeklySeries.push({
          weekStart: wStart,
          weekEnd: wEnd,
          label: wStart.slice(5),
          completionRate: m.completionRate,
          completedCount: m.completedCount,
          eligibleCount: m.eligibleToDate,
        });
      }

      // Last 6 months trend
      const { year, month } = parseIsoDate(userToday);
      const monthlySeries = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(Date.UTC(year, month - 1 - i, 1));
        const y = d.getUTCFullYear();
        const m = d.getUTCMonth() + 1;
        const mRange = getMonthDateRange(y, m);
        const metrics = calculateRangeMetrics(
          habitsList,
          logsLookup,
          mRange.startDate,
          mRange.endDate,
          userToday,
          userTime
        );
        const monthLabel = new Intl.DateTimeFormat('en-US', {
          month: 'short',
          year: '2-digit',
          timeZone: 'UTC',
        }).format(d);
        monthlySeries.push({
          month: `${y}-${String(m).padStart(2, '0')}`,
          label: monthLabel,
          completionRate: metrics.completionRate,
          completedCount: metrics.completedCount,
          eligibleCount: metrics.eligibleToDate,
        });
      }

      // 90-day heatmap up to userToday
      const heatmapStart = addDays(userToday, -89);
      const heatmapMetrics = calculateRangeMetrics(
        habitsList,
        logsLookup,
        heatmapStart,
        userToday,
        userToday,
        userTime
      );

      res.json({
        range,
        dailySeries: dailyMetrics.dailySummaries,
        weeklySeries,
        monthlySeries,
        heatmap: heatmapMetrics.dailySummaries,
      });
    } catch (error) {
      console.error('Analytics trends error:', error);
      res.status(500).json({ error: 'Failed to load analytics trends.' });
    }
  });

  app.get('/api/analytics/habits', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = await getDb();
      const userId = req.authUser!.id;
      const now = nowProvider();
      const userToday = getLocalDateInTimezone(now, req.authUser!.timezone);
      const userTime = getLocalTimeInTimezone(now, req.authUser!.timezone);

      const preset = String(req.query.preset || '30d');
      const range = resolvePresetDateRange(
        preset,
        userToday,
        req.authUser!.weekStartPreference,
        req.query.start ? String(req.query.start) : undefined,
        req.query.end ? String(req.query.end) : undefined
      );

      const { habitsList, logsList } = await fetchUserHabitsAndLogs(db, userId);
      const ranked = rankHabitsInPeriod(habitsList, logsList, range.startDate, range.endDate, userToday, userTime);

      const mostMissed = [...ranked]
        .filter((h) => h.missedOccurrences > 0)
        .sort((a, b) => b.missedOccurrences - a.missedOccurrences);

      res.json({
        range,
        habits: ranked,
        mostConsistent: ranked.filter((h) => h.eligibleOccurrences > 0).slice(0, 5),
        mostMissed: mostMissed.slice(0, 5),
      });
    } catch (error) {
      console.error('Analytics habits error:', error);
      res.status(500).json({ error: 'Failed to load habit analytics.' });
    }
  });

  app.get('/api/analytics/streaks', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = await getDb();
      const userId = req.authUser!.id;
      const now = nowProvider();
      const userToday = getLocalDateInTimezone(now, req.authUser!.timezone);
      const userTime = getLocalTimeInTimezone(now, req.authUser!.timezone);

      const { habitsList, logsList } = await fetchUserHabitsAndLogs(db, userId);
      const logsLookup = buildLogsLookup(logsList);
      const overall = calculateOverallConsistencyStreak(habitsList, logsLookup, userToday, userTime);
      const perHabit = rankHabitsInPeriod(
        habitsList,
        logsList,
        addDays(userToday, -29),
        userToday,
        userToday,
        userTime
      );

      res.json({
        overall,
        habits: perHabit,
      });
    } catch (error) {
      console.error('Analytics streaks error:', error);
      res.status(500).json({ error: 'Failed to load streak metrics.' });
    }
  });

  app.get('/api/weekly-review', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = await getDb();
      const userId = req.authUser!.id;
      const now = nowProvider();
      const userToday = getLocalDateInTimezone(now, req.authUser!.timezone);
      const userTime = getLocalTimeInTimezone(now, req.authUser!.timezone);
      const weekStartPref = req.authUser!.weekStartPreference;

      const anchorDate =
        req.query.date && isValidIsoDate(String(req.query.date)) ? String(req.query.date) : userToday;
      const weekStart = getStartOfWeek(anchorDate, weekStartPref);
      const weekEnd = getEndOfWeek(anchorDate, weekStartPref);
      const prevWeekStart = addDays(weekStart, -7);
      const prevWeekEnd = addDays(weekStart, -1);

      const { habitsList, logsList } = await fetchUserHabitsAndLogs(db, userId);
      const logsLookup = buildLogsLookup(logsList);

      const currentWeek = calculateRangeMetrics(habitsList, logsLookup, weekStart, weekEnd, userToday, userTime);
      const previousWeek = calculateRangeMetrics(
        habitsList,
        logsLookup,
        prevWeekStart,
        prevWeekEnd,
        userToday,
        userTime
      );

      const habitRankings = rankHabitsInPeriod(habitsList, logsList, weekStart, weekEnd, userToday, userTime);
      const habitMap = new Map(habitsList.map((h) => [h.id, h]));

      const weekNotes = logsList
        .filter((l) => l.localDate >= weekStart && l.localDate <= weekEnd && l.notes && l.notes.trim().length > 0)
        .map((l) => ({
          id: l.id,
          localDate: l.localDate,
          habitName: habitMap.get(l.habitId)?.name || 'Habit',
          notes: l.notes!,
          completed: l.completed,
        }))
        .sort((a, b) => b.localDate.localeCompare(a.localDate));

      res.json({
        weekStart,
        weekEnd,
        prevWeekStart,
        prevWeekEnd,
        userToday,
        currentWeek,
        previousWeek,
        delta:
          previousWeek.eligibleToDate > 0
            ? roundMetric(currentWeek.completionRate - previousWeek.completionRate, 1)
            : null,
        habitRankings,
        weekNotes,
      });
    } catch (error) {
      console.error('Weekly review error:', error);
      res.status(500).json({ error: 'Failed to load weekly review.' });
    }
  });

  // ============================================================================
  // GOALS ENDPOINTS
  // ============================================================================

  app.get('/api/goals', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = await getDb();
      const userId = req.authUser!.id;
      const now = nowProvider();
      const userToday = getLocalDateInTimezone(now, req.authUser!.timezone);
      const userTime = getLocalTimeInTimezone(now, req.authUser!.timezone);

      const goalRows = await db
        .select()
        .from(goals)
        .where(eq(goals.userId, userId))
        .orderBy(desc(goals.createdAt));

      const { habitsList, logsList } = await fetchUserHabitsAndLogs(db, userId);
      const logsLookup = buildLogsLookup(logsList);

      const evaluated = evaluateGoalsProgress(
        goalRows.map(mapGoalRow),
        habitsList,
        logsLookup,
        userToday,
        userTime
      );

      res.json({ goals: evaluated, userToday });
    } catch (error) {
      console.error('Get goals error:', error);
      res.status(500).json({ error: 'Failed to load goals.' });
    }
  });

  app.post('/api/goals', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const parsed = createGoalSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid goal configuration.' });
      return;
    }

    try {
      const db = await getDb();
      const userId = req.authUser!.id;

      if (parsed.data.habitId) {
        const ownedHabit = await db
          .select({ id: habits.id })
          .from(habits)
          .where(and(eq(habits.id, parsed.data.habitId), eq(habits.userId, userId)))
          .limit(1);
        if (ownedHabit.length === 0) {
          res.status(404).json({ error: 'Linked habit not found.' });
          return;
        }
      }

      const [created] = await db
        .insert(goals)
        .values({
          userId,
          habitId: parsed.data.habitId ?? null,
          title: parsed.data.title,
          goalType: parsed.data.goalType,
          targetValue: parsed.data.targetValue,
          targetUnit: parsed.data.targetUnit ?? null,
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate,
          status: parsed.data.status,
        })
        .returning();

      res.status(201).json({ goal: mapGoalRow(created) });
    } catch (error) {
      console.error('Create goal error:', error);
      res.status(500).json({ error: 'Failed to create goal.' });
    }
  });

  app.patch('/api/goals/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const goalId = Number(req.params.id);
    if (!Number.isInteger(goalId) || goalId <= 0) {
      res.status(400).json({ error: 'Invalid goal ID.' });
      return;
    }

    const parsed = updateGoalSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid goal update.' });
      return;
    }

    try {
      const db = await getDb();
      const updated = await db
        .update(goals)
        .set({ ...parsed.data, updatedAt: nowProvider() })
        .where(and(eq(goals.id, goalId), eq(goals.userId, req.authUser!.id)))
        .returning();

      if (updated.length === 0) {
        res.status(404).json({ error: 'Goal not found.' });
        return;
      }

      res.json({ goal: mapGoalRow(updated[0]) });
    } catch (error) {
      console.error('Update goal error:', error);
      res.status(500).json({ error: 'Failed to update goal.' });
    }
  });

  app.delete('/api/goals/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const goalId = Number(req.params.id);
    if (!Number.isInteger(goalId) || goalId <= 0) {
      res.status(400).json({ error: 'Invalid goal ID.' });
      return;
    }

    try {
      const db = await getDb();
      const deleted = await db
        .delete(goals)
        .where(and(eq(goals.id, goalId), eq(goals.userId, req.authUser!.id)))
        .returning({ id: goals.id });

      if (deleted.length === 0) {
        res.status(404).json({ error: 'Goal not found.' });
        return;
      }

      res.json({ ok: true });
    } catch (error) {
      console.error('Delete goal error:', error);
      res.status(500).json({ error: 'Failed to delete goal.' });
    }
  });

  // ============================================================================
  // NOTIFICATIONS ENDPOINTS
  // ============================================================================

  app.get('/api/notifications', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = await getDb();
      const userId = req.authUser!.id;
      await syncDueRemindersForUser(db, userId, nowProvider());

      const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
      const offset = Math.max(0, Number(req.query.offset || 0));

      const rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(limit)
        .offset(offset);

      const allUserNotifs = await db
        .select({ status: notifications.status })
        .from(notifications)
        .where(eq(notifications.userId, userId));

      const unreadCount = allUserNotifs.filter((n) => n.status !== 'read').length;

      res.json({
        notifications: rows.map(mapNotificationRow),
        unreadCount,
      });
    } catch (error) {
      console.error('Get notifications error:', error);
      res.status(500).json({ error: 'Failed to load notifications.' });
    }
  });

  app.patch('/api/notifications/preferences', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid preferences.' });
      return;
    }

    try {
      const db = await getDb();
      const userId = req.authUser!.id;
      const current = await getOrCreateUserSettings(db, userId);

      const [updated] = await db
        .update(userSettings)
        .set({
          notificationPreferences: parsed.data.notificationPreferences
            ? { ...current.notificationPreferences, ...parsed.data.notificationPreferences }
            : current.notificationPreferences,
          reminderPreferences: parsed.data.reminderPreferences
            ? { ...current.reminderPreferences, ...parsed.data.reminderPreferences }
            : current.reminderPreferences,
          updatedAt: nowProvider(),
        })
        .where(eq(userSettings.userId, userId))
        .returning();

      res.json({ settings: mapUserSettings(updated) });
    } catch (error) {
      console.error('Update notification preferences error:', error);
      res.status(500).json({ error: 'Failed to update notification preferences.' });
    }
  });

  app.post('/api/notifications/read-all', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = await getDb();
      const now = nowProvider();
      await db
        .update(notifications)
        .set({ status: 'read', readAt: now })
        .where(eq(notifications.userId, req.authUser!.id));
      res.json({ ok: true });
    } catch (error) {
      console.error('Mark all notifications read error:', error);
      res.status(500).json({ error: 'Failed to mark notifications read.' });
    }
  });

  app.patch('/api/notifications/:id/read', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const notifId = Number(req.params.id);
    if (!Number.isInteger(notifId) || notifId <= 0) {
      res.status(400).json({ error: 'Invalid notification ID.' });
      return;
    }

    try {
      const db = await getDb();
      const updated = await db
        .update(notifications)
        .set({ status: 'read', readAt: nowProvider() })
        .where(and(eq(notifications.id, notifId), eq(notifications.userId, req.authUser!.id)))
        .returning();

      if (updated.length === 0) {
        res.status(404).json({ error: 'Notification not found.' });
        return;
      }

      res.json({ notification: mapNotificationRow(updated[0]) });
    } catch (error) {
      console.error('Mark notification read error:', error);
      res.status(500).json({ error: 'Failed to update notification.' });
    }
  });

  // ============================================================================
  // CSV EXPORTS ENDPOINTS
  // ============================================================================

  app.get('/api/exports/habits.csv', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = await getDb();
      const rows = await db
        .select()
        .from(habits)
        .where(eq(habits.userId, req.authUser!.id))
        .orderBy(asc(habits.displayOrder), asc(habits.id));

      const csv = buildCsvDocument(
        [
          'Habit ID',
          'Habit Name',
          'Description',
          'Category',
          'Habit Type',
          'Schedule Type',
          'Selected Weekdays',
          'Target Value',
          'Target Unit',
          'Start Date',
          'End Date',
          'Reminder Time',
          'Completion Deadline',
          'Priority',
          'Status',
        ],
        rows.map((r) => {
          const mapped = mapHabitRow(r);
          return [
            mapped.id,
            mapped.name,
            mapped.description ?? '',
            mapped.category,
            mapped.habitType,
            mapped.scheduleType,
            mapped.scheduleConfig?.daysOfWeek ? mapped.scheduleConfig.daysOfWeek.join(';') : '',
            mapped.targetValue,
            mapped.targetUnit ?? '',
            mapped.startDate,
            mapped.endDate ?? '',
            mapped.reminderTime ?? '',
            mapped.completionDeadline ?? '',
            mapped.priority,
            mapped.status,
          ];
        })
      );

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="habitflow-habits.csv"');
      res.send(csv);
    } catch (error) {
      console.error('Export habits CSV error:', error);
      res.status(500).json({ error: 'Failed to export habits CSV.' });
    }
  });

  app.get('/api/exports/logs.csv', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = await getDb();
      const userId = req.authUser!.id;
      const now = nowProvider();
      const userToday = getLocalDateInTimezone(now, req.authUser!.timezone);

      const start = req.query.start && isValidIsoDate(String(req.query.start)) ? String(req.query.start) : addDays(userToday, -29);
      const end = req.query.end && isValidIsoDate(String(req.query.end)) ? String(req.query.end) : userToday;

      const { habitsList, logsList } = await fetchUserHabitsAndLogs(db, userId, {
        startDate: start,
        endDate: end,
      });
      const habitMap = new Map(habitsList.map((h) => [h.id, h]));

      const sortedLogs = [...logsList].sort((a, b) =>
        a.localDate !== b.localDate ? b.localDate.localeCompare(a.localDate) : a.habitId - b.habitId
      );

      const csv = buildCsvDocument(
        [
          'Local Date',
          'Habit Name',
          'Category',
          'Habit Type',
          'Completed',
          'Numeric Value',
          'Duration Minutes',
          'Target Value',
          'Target Unit',
          'Notes',
          'Completed At (UTC)',
        ],
        sortedLogs.map((log) => {
          const habit = habitMap.get(log.habitId);
          return [
            log.localDate,
            habit?.name ?? `Habit #${log.habitId}`,
            habit?.category ?? '',
            habit?.habitType ?? 'boolean',
            log.completed ? 'Yes' : 'No',
            log.numericValue ?? '',
            log.durationSeconds != null ? roundMetric(log.durationSeconds / 60, 1) : '',
            habit?.targetValue ?? '',
            habit?.targetUnit ?? '',
            log.notes ?? '',
            log.completedAt ?? '',
          ];
        })
      );

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="habitflow-logs-${start}-to-${end}.csv"`
      );
      res.send(csv);
    } catch (error) {
      console.error('Export logs CSV error:', error);
      res.status(500).json({ error: 'Failed to export daily logs CSV.' });
    }
  });

  app.get('/api/exports/report.csv', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = await getDb();
      const userId = req.authUser!.id;
      const now = nowProvider();
      const userToday = getLocalDateInTimezone(now, req.authUser!.timezone);
      const userTime = getLocalTimeInTimezone(now, req.authUser!.timezone);

      const preset = String(req.query.preset || '30d');
      const range = resolvePresetDateRange(
        preset,
        userToday,
        req.authUser!.weekStartPreference,
        req.query.start ? String(req.query.start) : undefined,
        req.query.end ? String(req.query.end) : undefined
      );

      const { habitsList, logsList } = await fetchUserHabitsAndLogs(db, userId);
      const ranked = rankHabitsInPeriod(habitsList, logsList, range.startDate, range.endDate, userToday, userTime);

      const csv = buildCsvDocument(
        [
          'Period Start',
          'Period End',
          'Habit Name',
          'Category',
          'Scheduled Occurrences',
          'Completed Occurrences',
          'Missed Occurrences',
          'Completion Rate (%)',
          'Current Streak',
          'Longest Streak',
          'Sample Note',
        ],
        ranked.map((item) => [
          range.startDate,
          range.endDate,
          item.habitName,
          item.category,
          item.eligibleOccurrences,
          item.completedOccurrences,
          item.missedOccurrences,
          item.completionRate,
          item.currentStreak,
          item.longestStreak,
          item.lowSampleSize ? 'Low sample size (<5 scheduled)' : 'Standard sample',
        ])
      );

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="habitflow-report-${range.startDate}-to-${range.endDate}.csv"`
      );
      res.send(csv);
    } catch (error) {
      console.error('Export report CSV error:', error);
      res.status(500).json({ error: 'Failed to export summary report CSV.' });
    }
  });

  // ============================================================================
  // OPTIONAL AI INSIGHTS ENDPOINTS
  // ============================================================================

  app.get('/api/ai/status', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
    const enabled = isAiInsightsEnabled();
    res.json({
      enabled,
      message: enabled
        ? 'AI Insights module is active.'
        : 'Optional AI Insights are currently disabled because no GEMINI_API_KEY secret is configured on the server. Core tracking and analytics work without AI.',
    });
  });

  app.post('/api/ai/insights', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    if (!isAiInsightsEnabled()) {
      res.status(503).json({
        error: 'Optional AI Insights require GEMINI_API_KEY to be configured on the server.',
        enabled: false,
      });
      return;
    }

    try {
      const db = await getDb();
      const userId = req.authUser!.id;
      const now = nowProvider();
      const userToday = getLocalDateInTimezone(now, req.authUser!.timezone);
      const userTime = getLocalTimeInTimezone(now, req.authUser!.timezone);

      const preset = String(req.body?.preset || '30d');
      const range = resolvePresetDateRange(preset, userToday, req.authUser!.weekStartPreference);
      const { habitsList, logsList } = await fetchUserHabitsAndLogs(db, userId);

      if (habitsList.length === 0) {
        res.status(400).json({ error: 'Add and track at least one habit before requesting insights.' });
        return;
      }

      const logsLookup = buildLogsLookup(logsList);
      const periodMetrics = calculateRangeMetrics(
        habitsList,
        logsLookup,
        range.startDate,
        range.endDate,
        userToday,
        userTime
      );
      const overallStreaks = calculateOverallConsistencyStreak(habitsList, logsLookup, userToday, userTime);
      const ranked = rankHabitsInPeriod(habitsList, logsList, range.startDate, range.endDate, userToday, userTime);

      const insights = await generateHabitAiInsights({
        periodLabel: `${range.label} (${range.startDate} to ${range.endDate})`,
        overallCompletionRate: periodMetrics.completionRate,
        completedOccurrences: periodMetrics.completedCount,
        eligibleOccurrences: periodMetrics.eligibleToDate,
        currentStreak: overallStreaks.currentStreak,
        longestStreak: overallStreaks.longestStreak,
        topHabits: ranked
          .filter((h) => h.eligibleOccurrences > 0)
          .slice(0, 3)
          .map((h) => ({
            name: h.habitName,
            completionRate: h.completionRate,
            completed: h.completedOccurrences,
            eligible: h.eligibleOccurrences,
          })),
        attentionHabits: ranked
          .filter((h) => h.missedOccurrences > 0)
          .sort((a, b) => b.missedOccurrences - a.missedOccurrences)
          .slice(0, 3)
          .map((h) => ({
            name: h.habitName,
            completionRate: h.completionRate,
            missed: h.missedOccurrences,
            eligible: h.eligibleOccurrences,
          })),
      });

      res.json({ insights });
    } catch (error: any) {
      console.error('AI Insights generation error:', error);
      res.status(502).json({
        error: error?.message || 'Unable to generate AI insights right now.',
      });
    }
  });

  // Catch-all for unknown /api/* routes
  app.use('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  return app;
}
