import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { createManagedDatabase, type AppDatabase } from '../db/index.ts';
import { runMigrations } from '../db/migrate.ts';
import { createApp } from '../server/app.ts';

describe('Full-Stack API, PostgreSQL Persistence, Auth Security & Multi-User Isolation', () => {
  let dbCtx: ReturnType<typeof createManagedDatabase>;
  let db: AppDatabase;
  const fixedNow = new Date('2026-10-20T14:00:00.000Z'); // Tuesday 2026-10-20 14:00 UTC

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DISABLE_RATE_LIMIT = 'true';
    dbCtx = createManagedDatabase({ inMemory: true });
    await runMigrations(dbCtx.db, dbCtx.rawExec);
    db = dbCtx.db;
  });

  afterAll(async () => {
    await dbCtx.close();
  });

  it('registers users, hashes passwords, enforces CSRF on state changes, and blocks unauthenticated access', async () => {
    const app = createApp(async () => db, () => fixedNow);

    // Unauthenticated access to protected endpoints must return 401
    const unauth = await request(app).get('/api/habits');
    expect(unauth.status).toBe(401);

    // Weak password rejected with 400
    const weakPw = await request(app).post('/api/auth/register').send({
      name: 'Weak User',
      email: 'weak@example.com',
      password: 'short',
      timezone: 'UTC',
      weekStartPreference: 1,
    });
    expect(weakPw.status).toBe(400);

    const agentA = request.agent(app);
    const regRes = await agentA.post('/api/auth/register').send({
      name: 'Alice Tracker',
      email: 'alice@example.com',
      password: 'Password123',
      timezone: 'UTC',
      weekStartPreference: 1,
    });
    expect(regRes.status).toBe(201);
    expect(regRes.body.user.email).toBe('alice@example.com');
    expect(regRes.body.user.passwordHash).toBeUndefined();
    const csrfA = regRes.body.csrfToken as string;
    expect(csrfA).toBeTruthy();

    // Duplicate email rejected with 409
    const dupRes = await request(app).post('/api/auth/register').send({
      name: 'Alice Duplicate',
      email: 'ALICE@example.com',
      password: 'Password123',
      timezone: 'UTC',
      weekStartPreference: 1,
    });
    expect(dupRes.status).toBe(409);

    // Wrong password rejected with 401
    const badLogin = await request(app).post('/api/auth/login').send({
      email: 'alice@example.com',
      password: 'WrongPassword999',
    });
    expect(badLogin.status).toBe(401);

    // Mutating request WITHOUT x-csrf-token must be rejected with 403
    const missingCsrf = await agentA.post('/api/habits').send({
      name: 'CSRF Test Habit',
      category: 'Health',
      habitType: 'boolean',
      scheduleType: 'daily',
      targetValue: 1,
      startDate: '2026-10-01',
    });
    expect(missingCsrf.status).toBe(403);

    // Logout invalidates server-side session
    const logoutRes = await agentA.post('/api/auth/logout').set('x-csrf-token', csrfA);
    expect(logoutRes.status).toBe(200);

    const afterLogout = await agentA.get('/api/auth/me');
    expect(afterLogout.status).toBe(401);
  });

  it('supports 6-digit email verification code password reset, attempt tracking, and session revocation', async () => {
    const app = createApp(async () => db, () => fixedNow);
    const agent = request.agent(app);

    const loginRes = await agent.post('/api/auth/login').send({
      email: 'alice@example.com',
      password: 'Password123',
    });
    expect(loginRes.status).toBe(200);

    // Step 1: Request 6-digit verification code
    const forgotRes = await request(app).post('/api/auth/forgot-password').send({
      email: 'alice@example.com',
    });
    expect(forgotRes.status).toBe(200);
    expect(forgotRes.body.step).toBe('verify_code');
    const sixDigitCode = forgotRes.body.testResetCode as string;
    expect(sixDigitCode).toMatch(/^\d{6}$/);

    // Wrong 6-digit code must be rejected
    const wrongCode = sixDigitCode === '000000' ? '999999' : '000000';
    const badVerify = await request(app).post('/api/auth/verify-reset-code').send({
      email: 'alice@example.com',
      code: wrongCode,
    });
    expect(badVerify.status).toBe(400);

    // Step 2: Verify the valid 6-digit code and obtain single-use resetToken
    const verifyRes = await request(app).post('/api/auth/verify-reset-code').send({
      email: 'alice@example.com',
      code: sixDigitCode,
    });
    expect(verifyRes.status).toBe(200);
    const resetToken = verifyRes.body.resetToken as string;
    expect(resetToken).toBeTruthy();

    // Same 6-digit code cannot be verified again once exchanged
    const replayCode = await request(app).post('/api/auth/verify-reset-code').send({
      email: 'alice@example.com',
      code: sixDigitCode,
    });
    expect(replayCode.status).toBe(400);

    // Step 3: Set new password using verified resetToken
    const resetRes = await request(app).post('/api/auth/reset-password').send({
      token: resetToken,
      password: 'NewPassword456',
    });
    expect(resetRes.status).toBe(200);

    // Verified resetToken cannot be reused a second time
    const reuseRes = await request(app).post('/api/auth/reset-password').send({
      token: resetToken,
      password: 'AnotherPassword789',
    });
    expect(reuseRes.status).toBe(400);

    // Previous session was revoked during password reset
    const oldSessionCheck = await agent.get('/api/auth/me');
    expect(oldSessionCheck.status).toBe(401);

    // Sign in succeeds with NewPassword456
    const freshLogin = await agent.post('/api/auth/login').send({
      email: 'alice@example.com',
      password: 'NewPassword456',
    });
    expect(freshLogin.status).toBe(200);
  });

  it('enforces strict multi-user isolation across habits, daily logs, goals, analytics, and CSV exports', async () => {
    const app = createApp(async () => db, () => fixedNow);

    // Sign in User A (Alice)
    const agentA = request.agent(app);
    const loginA = await agentA.post('/api/auth/login').send({
      email: 'alice@example.com',
      password: 'NewPassword456',
    });
    expect(loginA.status).toBe(200);
    const csrfA = loginA.body.csrfToken as string;

    // Register User B (Bob)
    const agentB = request.agent(app);
    const regB = await agentB.post('/api/auth/register').send({
      name: 'Bob Isolated',
      email: 'bob@example.com',
      password: 'BobPassword123',
      timezone: 'America/New_York',
      weekStartPreference: 0,
    });
    expect(regB.status).toBe(201);
    const csrfB = regB.body.csrfToken as string;

    // Alice creates a private habit with commas & quotes in description to also verify CSV escaping
    const createHabitA = await agentA
      .post('/api/habits')
      .set('x-csrf-token', csrfA)
      .send({
        name: 'Alice Deep Work',
        description: 'Focus session, "no distractions"',
        category: 'Career & Work',
        icon: 'Briefcase',
        color: '#C6FF00',
        habitType: 'duration',
        scheduleType: 'daily',
        targetValue: 60,
        targetUnit: 'minutes',
        startDate: '2026-10-15',
        priority: 'high',
      });
    expect(createHabitA.status).toBe(201);
    const aliceHabitId = createHabitA.body.habit.id as number;

    // Alice logs completion on 2026-10-19 and 2026-10-20; test upsert idempotency (no duplicate rows)
    const log1 = await agentA
      .put(`/api/habits/${aliceHabitId}/logs/2026-10-19`)
      .set('x-csrf-token', csrfA)
      .send({ completed: true, numericValue: 60, notes: 'Completed block 1' });
    expect(log1.status).toBe(200);
    expect(log1.body.streaks.currentStreak).toBe(1);

    const log2First = await agentA
      .put(`/api/habits/${aliceHabitId}/logs/2026-10-20`)
      .set('x-csrf-token', csrfA)
      .send({ completed: false, numericValue: 30, notes: 'Halfway' });
    expect(log2First.status).toBe(200);
    expect(log2First.body.log.completed).toBe(false);

    const log2Upsert = await agentA
      .put(`/api/habits/${aliceHabitId}/logs/2026-10-20`)
      .set('x-csrf-token', csrfA)
      .send({ completed: true, numericValue: 65, notes: 'Finished full hour, "strong focus"' });
    expect(log2Upsert.status).toBe(200);
    expect(log2Upsert.body.log.completed).toBe(true);
    expect(log2Upsert.body.streaks.currentStreak).toBe(2);

    // Future date completion must be rejected
    const futureLog = await agentA
      .put(`/api/habits/${aliceHabitId}/logs/2026-10-25`)
      .set('x-csrf-token', csrfA)
      .send({ completed: true, numericValue: 60 });
    expect(futureLog.status).toBe(400);

    // Alice creates a goal
    const goalA = await agentA
      .post('/api/goals')
      .set('x-csrf-token', csrfA)
      .send({
        title: 'Alice Weekly Focus Goal',
        goalType: 'habit_target',
        habitId: aliceHabitId,
        targetValue: 2,
        targetUnit: 'completions',
        startDate: '2026-10-15',
        endDate: '2026-10-25',
      });
    expect(goalA.status).toBe(201);
    const aliceGoalId = goalA.body.goal.id as number;

    // Verify Bob CANNOT see or mutate Alice's habit, logs, goals, analytics, or CSV exports
    const bobHabits = await agentB.get('/api/habits');
    expect(bobHabits.status).toBe(200);
    expect(bobHabits.body.habits).toHaveLength(0);

    const bobReadAliceHabit = await agentB.get(`/api/habits/${aliceHabitId}`);
    expect(bobReadAliceHabit.status).toBe(404);

    const bobPatchAliceHabit = await agentB
      .patch(`/api/habits/${aliceHabitId}`)
      .set('x-csrf-token', csrfB)
      .send({ name: 'Hijacked Name' });
    expect(bobPatchAliceHabit.status).toBe(404);

    const bobDeleteAliceHabit = await agentB
      .delete(`/api/habits/${aliceHabitId}`)
      .set('x-csrf-token', csrfB);
    expect(bobDeleteAliceHabit.status).toBe(404);

    const bobLogAliceHabit = await agentB
      .put(`/api/habits/${aliceHabitId}/logs/2026-10-20`)
      .set('x-csrf-token', csrfB)
      .send({ completed: true });
    expect(bobLogAliceHabit.status).toBe(404);

    const bobDeleteAliceGoal = await agentB
      .delete(`/api/goals/${aliceGoalId}`)
      .set('x-csrf-token', csrfB);
    expect(bobDeleteAliceGoal.status).toBe(404);

    const bobAnalytics = await agentB.get('/api/analytics/overview');
    expect(bobAnalytics.status).toBe(200);
    expect(bobAnalytics.body.hasAnyHabits).toBe(false);

    const bobCsv = await agentB.get('/api/exports/habits.csv');
    expect(bobCsv.status).toBe(200);
    expect(bobCsv.text).not.toContain('Alice Deep Work');

    // Verify Alice's CSV export contains properly RFC 4180 escaped fields
    const aliceCsv = await agentA.get('/api/exports/habits.csv');
    expect(aliceCsv.status).toBe(200);
    expect(aliceCsv.text).toContain('Alice Deep Work');
    expect(aliceCsv.text).toContain('"Focus session, ""no distractions"""');

    // Verify undo/delete log recalculates Alice's streak immediately
    const undoLog = await agentA
      .delete(`/api/habits/${aliceHabitId}/logs/2026-10-20`)
      .set('x-csrf-token', csrfA);
    expect(undoLog.status).toBe(200);
    expect(undoLog.body.streaks.currentStreak).toBe(1); // Oct 19 still intact while Oct 20 is open today
  });

  it('previews and imports .xlsx spreadsheet workbooks without duplicating existing habits', async () => {
    const app = createApp(async () => db, () => fixedNow);
    const agentB = request.agent(app);
    const loginB = await agentB.post('/api/auth/login').send({
      email: 'bob@example.com',
      password: 'BobPassword123',
    });
    const csrfB = loginB.body.csrfToken as string;

    // Construct an in-memory .xlsx workbook mimicking Habit Tracker.xlsx
    const wb = XLSX.utils.book_new();
    const sheetRows = [
      ['Habit Name', 'Category', '2026-10-18', '2026-10-19', '2026-10-20'],
      ['Wake up early', 'Health', true, true, false],
      ['Read 20 pages', 'Learning', 1, 1, 1],
    ];
    const ws = XLSX.utils.aoa_to_sheet(sheetRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Monthly Tracker');
    const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const previewRes = await agentB
      .post('/api/import/preview')
      .set('x-csrf-token', csrfB)
      .attach('file', xlsxBuffer, 'Habit Tracker.xlsx');

    expect(previewRes.status).toBe(200);
    expect(previewRes.body.preview.habits.length).toBe(2);
    expect(previewRes.body.preview.logs.length).toBeGreaterThanOrEqual(4);

    const commitRes = await agentB
      .post('/api/import/commit')
      .set('x-csrf-token', csrfB)
      .send({
        habits: previewRes.body.preview.habits,
        logs: previewRes.body.preview.logs,
      });
    expect(commitRes.status).toBe(201);
    expect(commitRes.body.createdHabits).toBe(2);

    // Committing the exact same payload again must skip duplicate habits & logs
    const secondCommit = await agentB
      .post('/api/import/commit')
      .set('x-csrf-token', csrfB)
      .send({
        habits: previewRes.body.preview.habits,
        logs: previewRes.body.preview.logs,
      });
    expect(secondCommit.status).toBe(201);
    expect(secondCommit.body.createdHabits).toBe(0);
    expect(secondCommit.body.importedLogs).toBe(0);
  });

  it('persists data durably across database restarts on disk-backed PostgreSQL', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'habitflow-pg-persist-'));
    const pgDir = path.join(tmpRoot, 'pgdata');

    try {
      // Boot #1: run migrations, register user, create habit
      const ctx1 = createManagedDatabase({ dataDir: pgDir });
      await runMigrations(ctx1.db, ctx1.rawExec);
      const app1 = createApp(async () => ctx1.db, () => fixedNow);
      const agent1 = request.agent(app1);

      const reg = await agent1.post('/api/auth/register').send({
        name: 'Persistent User',
        email: 'persist@example.com',
        password: 'PersistPassword1',
        timezone: 'UTC',
        weekStartPreference: 1,
      });
      expect(reg.status).toBe(201);

      const createH = await agent1
        .post('/api/habits')
        .set('x-csrf-token', reg.body.csrfToken)
        .send({
          name: 'Survives Restart',
          category: 'Mindfulness',
          habitType: 'boolean',
          scheduleType: 'daily',
          targetValue: 1,
          startDate: '2026-10-01',
        });
      expect(createH.status).toBe(201);

      await ctx1.close();

      // Boot #2: reopen PostgreSQL data directory, verify migrations are idempotent and habit persists
      const ctx2 = createManagedDatabase({ dataDir: pgDir });
      await runMigrations(ctx2.db, ctx2.rawExec);
      const app2 = createApp(async () => ctx2.db, () => fixedNow);
      const agent2 = request.agent(app2);

      const login2 = await agent2.post('/api/auth/login').send({
        email: 'persist@example.com',
        password: 'PersistPassword1',
      });
      expect(login2.status).toBe(200);

      const list2 = await agent2.get('/api/habits');
      expect(list2.status).toBe(200);
      expect(list2.body.habits).toHaveLength(1);
      expect(list2.body.habits[0].name).toBe('Survives Restart');

      await ctx2.close();
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('completes onboarding ("Enter Workspace") and revokes session via Bearer token when third-party cookies are blocked in iframes', async () => {
    const app = createApp(async () => db, () => fixedNow);

    // Note: using plain request(app) (NOT request.agent) so ZERO cookies are stored or sent!
    const regRes = await request(app).post('/api/auth/register').send({
      name: 'Iframe User',
      email: 'iframe@example.com',
      password: 'IframePassword1',
      timezone: 'Asia/Dhaka',
      weekStartPreference: 1,
    });
    expect(regRes.status).toBe(201);
    const { sessionToken, csrfToken } = regRes.body as { sessionToken: string; csrfToken: string };
    expect(sessionToken).toBeTruthy();
    expect(csrfToken).toBeTruthy();

    // Clicking "Enter Workspace" sends PATCH /api/profile { onboardingCompleted: true }
    const onboardingRes = await request(app)
      .patch('/api/profile')
      .set('Authorization', `Bearer ${sessionToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ onboardingCompleted: true });
    expect(onboardingRes.status).toBe(200);
    expect(onboardingRes.body.user.onboardingCompleted).toBe(true);

    // Unsafe SVG data URL must be rejected
    const unsafeAvatar = await request(app)
      .patch('/api/profile')
      .set('Authorization', `Bearer ${sessionToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ avatarUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' });
    expect(unsafeAvatar.status).toBe(400);

    // Valid PNG data URL saves and persists
    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const validAvatar = await request(app)
      .patch('/api/profile')
      .set('Authorization', `Bearer ${sessionToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ avatarUrl: tinyPng });
    expect(validAvatar.status).toBe(200);
    expect(validAvatar.body.user.avatarUrl).toBe(tinyPng);

    // Remove avatar via DELETE /api/profile/avatar
    const removeAvatar = await request(app)
      .delete('/api/profile/avatar')
      .set('Authorization', `Bearer ${sessionToken}`)
      .set('x-csrf-token', csrfToken);
    expect(removeAvatar.status).toBe(200);
    expect(removeAvatar.body.user.avatarUrl).toBeNull();

    // Logout via Bearer token revokes the PostgreSQL session
    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${sessionToken}`)
      .set('x-csrf-token', csrfToken);
    expect(logoutRes.status).toBe(200);

    const afterLogout = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${sessionToken}`);
    expect(afterLogout.status).toBe(401);
  });
});
