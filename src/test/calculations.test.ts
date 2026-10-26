import { describe, expect, it } from 'vitest';
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
  isHabitScheduledOnDate,
  rankHabitsInPeriod,
} from '../shared/calculations.ts';
import {
  getDaysInMonth,
  getLocalDateInTimezone,
  getLocalTimeInTimezone,
  getMonthWeekBuckets,
  isLeapYear,
  isValidIsoDate,
  resolvePresetDateRange,
} from '../shared/dates.ts';
import type { GoalRecord, HabitLogRecord, HabitRecord } from '../shared/types.ts';

function makeHabit(overrides: Partial<HabitRecord> = {}): HabitRecord {
  return {
    id: 1,
    userId: 10,
    name: 'Morning Run',
    description: null,
    category: 'Fitness',
    icon: 'Dumbbell',
    color: '#C6FF00',
    habitType: 'boolean',
    scheduleType: 'daily',
    scheduleConfig: {},
    targetValue: 1,
    targetUnit: null,
    startDate: '2026-01-01',
    endDate: null,
    reminderTime: null,
    completionDeadline: null,
    priority: 'high',
    displayOrder: 0,
    status: 'active',
    archivedAt: null,
    archivedLocalDate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeLog(overrides: Partial<HabitLogRecord> & { localDate: string }): HabitLogRecord {
  return {
    id: Math.floor(Math.random() * 100000) + 1,
    userId: 10,
    habitId: 1,
    completed: true,
    numericValue: 1,
    durationSeconds: null,
    notes: null,
    completedAt: `${overrides.localDate}T08:00:00.000Z`,
    createdAt: `${overrides.localDate}T08:00:00.000Z`,
    updatedAt: `${overrides.localDate}T08:00:00.000Z`,
    ...overrides,
  };
}

describe('Calendar, Leap Year, Timezone & Week #1-#5 Grouping Logic', () => {
  it('accurately handles February lengths across leap years and non-leap years as well as 30/31-day months', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2025)).toBe(false);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);

    expect(getDaysInMonth(2024, 2)).toBe(29);
    expect(getDaysInMonth(2026, 2)).toBe(28);
    expect(getDaysInMonth(2026, 4)).toBe(30);
    expect(getDaysInMonth(2026, 10)).toBe(31);

    expect(isValidIsoDate('2024-02-29')).toBe(true);
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2026-04-31')).toBe(false);
  });

  it('resolves local dates and times accurately across IANA timezones at UTC midnight boundaries', () => {
    // 2026-10-25T20:30:00Z is already Oct 26 02:30 in Asia/Dhaka (+06:00), still Oct 25 16:30 in America/New_York (-04:00)
    const instant = new Date('2026-10-25T20:30:00.000Z');
    expect(getLocalDateInTimezone(instant, 'UTC')).toBe('2026-10-25');
    expect(getLocalTimeInTimezone(instant, 'UTC')).toBe('20:30');

    expect(getLocalDateInTimezone(instant, 'Asia/Dhaka')).toBe('2026-10-26');
    expect(getLocalTimeInTimezone(instant, 'Asia/Dhaka')).toBe('02:30');

    expect(getLocalDateInTimezone(instant, 'America/New_York')).toBe('2026-10-25');
    expect(getLocalTimeInTimezone(instant, 'America/New_York')).toBe('16:30');
  });

  it('builds Week #1 through Week #5+ buckets respecting Monday, Sunday, and Saturday week-start preferences', () => {
    // October 2026 starts on Thursday (2026-10-01) and has 31 days (ends Saturday 2026-10-31)
    const mondayBuckets = getMonthWeekBuckets(2026, 10, 1);
    expect(mondayBuckets.length).toBe(5);
    expect(mondayBuckets[0]).toMatchObject({
      weekNumber: 1,
      label: 'Week #1 (Partial)',
      isPartial: true,
      startDate: '2026-10-01',
      endDate: '2026-10-04',
    });
    expect(mondayBuckets[1]).toMatchObject({
      weekNumber: 2,
      label: 'Week #2',
      isPartial: false,
      startDate: '2026-10-05',
      endDate: '2026-10-11',
    });
    expect(mondayBuckets[4]).toMatchObject({
      weekNumber: 5,
      label: 'Week #5 (Partial)',
      isPartial: true,
      startDate: '2026-10-26',
      endDate: '2026-10-31',
    });

    // With Sunday start (0), Oct 1-3 (Thu-Sat) is Week #1 (3 days), Oct 4-10 is Week #2 (7 days), ..., Oct 25-31 is Week #5 (7 full days!)
    const sundayBuckets = getMonthWeekBuckets(2026, 10, 0);
    expect(sundayBuckets.length).toBe(5);
    expect(sundayBuckets[0].dates.length).toBe(3);
    expect(sundayBuckets[4]).toMatchObject({
      weekNumber: 5,
      label: 'Week #5',
      isPartial: false,
      startDate: '2026-10-25',
      endDate: '2026-10-31',
    });

    // With Saturday start (6), Oct 31 starts a new Saturday week -> 6 week groups
    const saturdayBuckets = getMonthWeekBuckets(2026, 10, 6);
    expect(saturdayBuckets.length).toBe(6);
    expect(saturdayBuckets[5].dates).toEqual(['2026-10-31']);
  });

  it('resolves preset date ranges cleanly including previous month across January boundary', () => {
    const prevFromJan = resolvePresetDateRange('previous_month', '2026-01-15', 1);
    expect(prevFromJan.startDate).toBe('2025-12-01');
    expect(prevFromJan.endDate).toBe('2025-12-31');
  });
});

describe('Habit Scheduling, Occurrence Classification, Targets & Streaks', () => {
  it('evaluates schedule eligibility across weekdays, weekends, custom_days, and archived cutoff dates', () => {
    const weekdayHabit = makeHabit({ scheduleType: 'weekdays', startDate: '2026-10-01' });
    // 2026-10-23 is Friday, 2026-10-24 is Saturday
    expect(isHabitScheduledOnDate(weekdayHabit, '2026-10-23')).toBe(true);
    expect(isHabitScheduledOnDate(weekdayHabit, '2026-10-24')).toBe(false);
    expect(isHabitScheduledOnDate(weekdayHabit, '2026-09-30')).toBe(false);

    const customHabit = makeHabit({
      scheduleType: 'custom_days',
      scheduleConfig: { daysOfWeek: [1, 3, 5] }, // Mon, Wed, Fri
    });
    expect(isHabitScheduledOnDate(customHabit, '2026-10-19')).toBe(true); // Monday
    expect(isHabitScheduledOnDate(customHabit, '2026-10-20')).toBe(false); // Tuesday

    const archivedHabit = makeHabit({
      status: 'archived',
      archivedLocalDate: '2026-10-15',
    });
    expect(isHabitScheduledOnDate(archivedHabit, '2026-10-15')).toBe(true);
    expect(isHabitScheduledOnDate(archivedHabit, '2026-10-16')).toBe(false);
  });

  it('distinguishes pending today, missed after deadline, missed in past, and upcoming future dates', () => {
    const habit = makeHabit({ completionDeadline: '18:00' });
    const userToday = '2026-10-20';

    const pendingToday = classifyOccurrence(habit, '2026-10-20', null, userToday, '14:00');
    expect(pendingToday.state).toBe('pending');

    const missedAfterDeadline = classifyOccurrence(habit, '2026-10-20', null, userToday, '19:05');
    expect(missedAfterDeadline.state).toBe('missed');

    const pastMissed = classifyOccurrence(habit, '2026-10-19', null, userToday, '14:00');
    expect(pastMissed.state).toBe('missed');

    const futureUpcoming = classifyOccurrence(habit, '2026-10-21', null, userToday, '14:00');
    expect(futureUpcoming.state).toBe('upcoming');
  });

  it('evaluates numeric count and duration targets accurately with partial attainment vs completion', () => {
    const waterHabit = makeHabit({
      habitType: 'count',
      targetValue: 8,
      targetUnit: 'glasses',
    });

    const partialWater = evaluateHabitCompletion(
      waterHabit,
      makeLog({ localDate: '2026-10-20', completed: false, numericValue: 4 })
    );
    expect(partialWater.isCompleted).toBe(false);
    expect(partialWater.attainmentPct).toBe(50);

    const fullWater = evaluateHabitCompletion(
      waterHabit,
      makeLog({ localDate: '2026-10-20', completed: true, numericValue: 8 })
    );
    expect(fullWater.isCompleted).toBe(true);
    expect(fullWater.attainmentPct).toBe(100);

    const readingHabit = makeHabit({
      habitType: 'duration',
      targetValue: 30,
      targetUnit: 'minutes',
    });
    const partialReading = evaluateHabitCompletion(
      readingHabit,
      makeLog({ localDate: '2026-10-20', completed: false, numericValue: 15, durationSeconds: 900 })
    );
    expect(partialReading.isCompleted).toBe(false);
    expect(partialReading.attainmentPct).toBe(50);
    expect(partialReading.currentValue).toBe(15);

    const fullReading = evaluateHabitCompletion(
      readingHabit,
      makeLog({ localDate: '2026-10-20', completed: true, numericValue: 30, durationSeconds: 1800 })
    );
    expect(fullReading.isCompleted).toBe(true);
    expect(fullReading.attainmentPct).toBe(100);
  });

  it('preserves streaks across unscheduled rest days, keeps open today intact, and recalculates on historical edits', () => {
    // Mon/Wed/Fri habit starting Monday 2026-10-12
    const mwfHabit = makeHabit({
      scheduleType: 'custom_days',
      scheduleConfig: { daysOfWeek: [1, 3, 5] },
      startDate: '2026-10-12',
    });

    // Completed Mon Oct 12, Wed Oct 14, Fri Oct 16; Today is Mon Oct 19 (still pending at 10:00)
    const logs = new Map<string, HabitLogRecord>([
      ['2026-10-12', makeLog({ localDate: '2026-10-12' })],
      ['2026-10-14', makeLog({ localDate: '2026-10-14' })],
      ['2026-10-16', makeLog({ localDate: '2026-10-16' })],
    ]);

    const beforeTodayDone = calculateHabitStreak(mwfHabit, logs, '2026-10-19', '10:00');
    expect(beforeTodayDone.currentStreak).toBe(3);
    expect(beforeTodayDone.longestStreak).toBe(3);

    // Complete today (Mon Oct 19) -> streak increments to 4
    logs.set('2026-10-19', makeLog({ localDate: '2026-10-19' }));
    const afterTodayDone = calculateHabitStreak(mwfHabit, logs, '2026-10-19', '10:00');
    expect(afterTodayDone.currentStreak).toBe(4);
    expect(afterTodayDone.longestStreak).toBe(4);

    // Historical undo on Wed Oct 14 -> longest is 2 (Fri Oct 16 + Mon Oct 19), current is 2
    logs.delete('2026-10-14');
    const afterHistoricalUndo = calculateHabitStreak(mwfHabit, logs, '2026-10-19', '10:00');
    expect(afterHistoricalUndo.currentStreak).toBe(2);
    expect(afterHistoricalUndo.longestStreak).toBe(2);
  });

  it('handles zero eligible habits safely without NaN and excludes future dates from missed counts', () => {
    const emptySummary = calculateDaySummary([], new Map(), '2026-10-20', '2026-10-20');
    expect(emptySummary.hasEligibleHabits).toBe(false);
    expect(emptySummary.eligibleCount).toBe(0);
    expect(emptySummary.overallCompletionRate).toBe(0);
    expect(Number.isNaN(emptySummary.overallCompletionRate)).toBe(false);

    const dailyHabit = makeHabit({ startDate: '2026-10-19' });
    const logsLookup = buildLogsLookup([makeLog({ habitId: 1, localDate: '2026-10-19' })]);

    // Range spans Oct 19 (completed), Oct 20 (today pending), Oct 21-22 (future upcoming)
    const range = calculateRangeMetrics([dailyHabit], logsLookup, '2026-10-19', '2026-10-22', '2026-10-20', '09:00');
    expect(range.totalScheduled).toBe(4);
    expect(range.eligibleToDate).toBe(2);
    expect(range.completedCount).toBe(1);
    expect(range.pendingCount).toBe(1);
    expect(range.missedCount).toBe(0);
    expect(range.upcomingCount).toBe(2);
    expect(range.completionRate).toBe(50);
  });

  it('computes overall consistency streak, habit rankings with low-sample flags, week summaries, and goals progress', () => {
    const h1 = makeHabit({ id: 1, name: 'Alpha Habit', startDate: '2026-10-01' });
    const h2 = makeHabit({ id: 2, name: 'Beta Habit', startDate: '2026-10-18' }); // only 3 scheduled days up to Oct 20 -> lowSampleSize

    const logs: HabitLogRecord[] = [
      makeLog({ habitId: 1, localDate: '2026-10-18' }),
      makeLog({ habitId: 1, localDate: '2026-10-19' }),
      makeLog({ habitId: 1, localDate: '2026-10-20' }),
      makeLog({ habitId: 2, localDate: '2026-10-18' }),
      makeLog({ habitId: 2, localDate: '2026-10-19' }),
      makeLog({ habitId: 2, localDate: '2026-10-20' }),
    ];

    const ranked = rankHabitsInPeriod([h1, h2], logs, '2026-10-01', '2026-10-20', '2026-10-20');
    const betaRanked = ranked.find((r) => r.habitId === 2)!;
    expect(betaRanked.completionRate).toBe(100);
    expect(betaRanked.lowSampleSize).toBe(true);

    const lookup = buildLogsLookup(logs);
    const overall = calculateOverallConsistencyStreak([h1, h2], lookup, '2026-10-20', '12:00');
    expect(overall.currentStreak).toBe(3);
    expect(overall.perfectDayCurrentStreak).toBe(3);

    const monthWeeks = calculateMonthWeekSummaries(2026, 10, 1, [h1], lookup, '2026-10-20', '12:00');
    expect(monthWeeks.length).toBe(5);

    const goals: GoalRecord[] = [
      {
        id: 1,
        userId: 10,
        habitId: 1,
        title: 'Complete Alpha 3 times',
        goalType: 'habit_target',
        targetValue: 3,
        targetUnit: 'completions',
        startDate: '2026-10-18',
        endDate: '2026-10-25',
        status: 'active',
        createdAt: '2026-10-18T00:00:00.000Z',
        updatedAt: '2026-10-18T00:00:00.000Z',
      },
    ];
    const evaluatedGoals = evaluateGoalsProgress(goals, [h1], lookup, '2026-10-20', '12:00');
    expect(evaluatedGoals[0].currentValue).toBe(3);
    expect(evaluatedGoals[0].progressPct).toBe(100);
    expect(evaluatedGoals[0].isTargetReached).toBe(true);
  });
});
