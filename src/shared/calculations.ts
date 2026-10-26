import { addDays, enumerateDates, getDayOfWeek, getMonthWeekBuckets } from './dates.ts';
import type {
  DaySummaryMetrics,
  EvaluatedHabitOccurrence,
  GoalRecord,
  GoalWithProgress,
  HabitLogRecord,
  HabitRecord,
  HabitStreakSummary,
  OverallStreakSummary,
  WeekGroupSummary,
} from './types.ts';

export const CONSISTENCY_STREAK_THRESHOLD_PCT = 80;

export function roundMetric(value: number, decimals: number = 1): number {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Determines whether a habit is scheduled on a given local date (YYYY-MM-DD).
 *
 * Archived policy:
 * - If a habit is archived (`status === 'archived'`), dates strictly after `archivedLocalDate`
 *   are NOT scheduled, while historical dates on or before `archivedLocalDate` remain eligible
 *   so archiving preserves historical analytics and calendar entries accurately.
 */
export function isHabitScheduledOnDate(habit: HabitRecord, localDate: string): boolean {
  if (localDate < habit.startDate) return false;
  if (habit.endDate && localDate > habit.endDate) return false;
  if (habit.status === 'archived' && habit.archivedLocalDate && localDate > habit.archivedLocalDate) {
    return false;
  }

  const dow = getDayOfWeek(localDate);
  switch (habit.scheduleType) {
    case 'daily':
      return true;
    case 'weekdays':
      return dow >= 1 && dow <= 5;
    case 'weekends':
      return dow === 0 || dow === 6;
    case 'custom_days': {
      const days = habit.scheduleConfig?.daysOfWeek ?? [];
      return days.includes(dow);
    }
    default:
      return true;
  }
}

/**
 * Evaluates completion & target attainment for a single habit and optional saved log.
 * Partial numeric/duration progress is reported via `attainmentPct` and is NOT treated as
 * completed unless `scheduleConfig.allowPartialCompletion` is explicitly true (and value > 0)
 * or the configured target is reached.
 */
export function evaluateHabitCompletion(
  habit: HabitRecord,
  log: HabitLogRecord | null | undefined
): {
  isCompleted: boolean;
  attainmentPct: number;
  currentValue: number;
  targetValue: number;
} {
  if (!log) {
    const defaultTarget = habit.habitType === 'boolean' ? 1 : Math.max(habit.targetValue, 1);
    return {
      isCompleted: false,
      attainmentPct: 0,
      currentValue: 0,
      targetValue: defaultTarget,
    };
  }

  if (habit.habitType === 'boolean') {
    const done = Boolean(log.completed);
    return {
      isCompleted: done,
      attainmentPct: done ? 100 : 0,
      currentValue: done ? 1 : 0,
      targetValue: 1,
    };
  }

  if (habit.habitType === 'count') {
    const target = Math.max(habit.targetValue || 1, 0.0001);
    const val = Math.max(log.numericValue ?? (log.completed ? target : 0), 0);
    const rawPct = Math.min(100, (val / target) * 100);
    const allowPartial = Boolean(habit.scheduleConfig?.allowPartialCompletion);
    const isCompleted = val >= target || (allowPartial && val > 0 && Boolean(log.completed));
    return {
      isCompleted,
      attainmentPct: roundMetric(rawPct, 1),
      currentValue: val,
      targetValue: habit.targetValue || 1,
    };
  }

  // Duration habit: targetValue is stored in targetUnit ('minutes' default, or 'hours')
  const unitMultiplier = habit.targetUnit === 'hours' ? 3600 : 60;
  const targetSeconds = Math.max((habit.targetValue || 1) * unitMultiplier, 1);
  const loggedSeconds = Math.max(
    log.durationSeconds ?? (log.numericValue != null ? log.numericValue * unitMultiplier : log.completed ? targetSeconds : 0),
    0
  );
  const displayCurrent = roundMetric(loggedSeconds / unitMultiplier, 1);
  const rawPct = Math.min(100, (loggedSeconds / targetSeconds) * 100);
  const allowPartial = Boolean(habit.scheduleConfig?.allowPartialCompletion);
  const isCompleted = loggedSeconds >= targetSeconds || (allowPartial && loggedSeconds > 0 && Boolean(log.completed));

  return {
    isCompleted,
    attainmentPct: roundMetric(rawPct, 1),
    currentValue: displayCurrent,
    targetValue: habit.targetValue || 1,
  };
}

/**
 * Classifies a scheduled occurrence relative to the user's local `userToday` and `userCurrentTime` (HH:mm).
 * Today's incomplete habits remain `'pending'` unless their configured `completionDeadline` has already passed.
 * Future dates are `'upcoming'` and excluded from missed counts.
 */
export function classifyOccurrence(
  habit: HabitRecord,
  date: string,
  log: HabitLogRecord | null | undefined,
  userToday: string,
  userCurrentTime: string = '12:00'
): Omit<EvaluatedHabitOccurrence, 'currentStreak' | 'longestStreak'> {
  const isScheduled = isHabitScheduledOnDate(habit, date);
  const evalResult = evaluateHabitCompletion(habit, log);

  if (!isScheduled) {
    return {
      habit,
      date,
      isScheduled: false,
      state: 'unscheduled',
      isCompleted: evalResult.isCompleted,
      attainmentPct: evalResult.attainmentPct,
      currentValue: evalResult.currentValue,
      targetValue: evalResult.targetValue,
      log: log ?? null,
    };
  }

  if (evalResult.isCompleted) {
    return {
      habit,
      date,
      isScheduled: true,
      state: 'completed',
      isCompleted: true,
      attainmentPct: evalResult.attainmentPct,
      currentValue: evalResult.currentValue,
      targetValue: evalResult.targetValue,
      log: log ?? null,
    };
  }

  if (date > userToday) {
    return {
      habit,
      date,
      isScheduled: true,
      state: 'upcoming',
      isCompleted: false,
      attainmentPct: evalResult.attainmentPct,
      currentValue: evalResult.currentValue,
      targetValue: evalResult.targetValue,
      log: log ?? null,
    };
  }

  if (date < userToday) {
    return {
      habit,
      date,
      isScheduled: true,
      state: 'missed',
      isCompleted: false,
      attainmentPct: evalResult.attainmentPct,
      currentValue: evalResult.currentValue,
      targetValue: evalResult.targetValue,
      log: log ?? null,
    };
  }

  // date === userToday and not completed yet: check optional completionDeadline
  const deadlinePassed = Boolean(
    habit.completionDeadline && userCurrentTime > habit.completionDeadline
  );

  return {
    habit,
    date,
    isScheduled: true,
    state: deadlinePassed ? 'missed' : 'pending',
    isCompleted: false,
    attainmentPct: evalResult.attainmentPct,
    currentValue: evalResult.currentValue,
    targetValue: evalResult.targetValue,
    log: log ?? null,
  };
}

/**
 * Calculates schedule-aware current and longest streaks for a single habit up to `userToday`.
 *
 * Rules:
 * 1. Unscheduled dates are skipped and NEVER break a streak.
 * 2. Future dates (> `userToday`) are ignored.
 * 3. On `userToday`, if the habit is scheduled and still pending (not completed and deadline not passed),
 *    it neither increments nor breaks the active streak carried from the previous scheduled date.
 *    If completed on `userToday`, it increments the streak.
 */
export function calculateHabitStreak(
  habit: HabitRecord,
  logsByDate: Map<string, HabitLogRecord>,
  userToday: string,
  userCurrentTime: string = '12:00'
): { currentStreak: number; longestStreak: number } {
  if (habit.startDate > userToday) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  const effectiveEnd = habit.endDate && habit.endDate < userToday ? habit.endDate : userToday;
  const archivedCap =
    habit.status === 'archived' && habit.archivedLocalDate && habit.archivedLocalDate < effectiveEnd
      ? habit.archivedLocalDate
      : effectiveEnd;

  const dates = enumerateDates(habit.startDate, archivedCap);
  let running = 0;
  let longest = 0;

  for (const d of dates) {
    if (!isHabitScheduledOnDate(habit, d)) {
      continue;
    }

    const log = logsByDate.get(d);
    const { isCompleted } = evaluateHabitCompletion(habit, log);

    if (isCompleted) {
      running += 1;
      if (running > longest) longest = running;
    } else if (d === userToday) {
      const deadlinePassed = Boolean(habit.completionDeadline && userCurrentTime > habit.completionDeadline);
      if (deadlinePassed) {
        running = 0;
      }
      // If still pending today, preserve running streak without breaking it
    } else {
      running = 0;
    }
  }

  return {
    currentStreak: running,
    longestStreak: longest,
  };
}

/**
 * Computes daily summary metrics for a single date across a user's habits.
 * Handles zero eligible habits cleanly without NaN or division by zero.
 */
export function calculateDaySummary(
  habits: HabitRecord[],
  logsByHabitAndDate: Map<string, HabitLogRecord>,
  date: string,
  userToday: string,
  userCurrentTime: string = '12:00'
): DaySummaryMetrics {
  let eligibleCount = 0;
  let completedCount = 0;
  let pendingCount = 0;
  let missedCount = 0;
  let upcomingCount = 0;

  let booleanEligibleCount = 0;
  let booleanCompletedCount = 0;

  let measurableEligibleCount = 0;
  let measurableAttainmentSum = 0;

  for (const habit of habits) {
    const log = logsByHabitAndDate.get(`${habit.id}:${date}`);
    const occ = classifyOccurrence(habit, date, log, userToday, userCurrentTime);
    if (!occ.isScheduled) continue;

    eligibleCount += 1;
    if (occ.state === 'completed') completedCount += 1;
    else if (occ.state === 'pending') pendingCount += 1;
    else if (occ.state === 'missed') missedCount += 1;
    else if (occ.state === 'upcoming') upcomingCount += 1;

    if (habit.habitType === 'boolean') {
      booleanEligibleCount += 1;
      if (occ.isCompleted) booleanCompletedCount += 1;
    } else {
      measurableEligibleCount += 1;
      measurableAttainmentSum += occ.attainmentPct;
    }
  }

  const overallCompletionRate = eligibleCount > 0 ? roundMetric((completedCount / eligibleCount) * 100, 1) : 0;
  const booleanCompletionRate =
    booleanEligibleCount > 0 ? roundMetric((booleanCompletedCount / booleanEligibleCount) * 100, 1) : 0;
  const measurableAverageAttainment =
    measurableEligibleCount > 0 ? roundMetric(measurableAttainmentSum / measurableEligibleCount, 1) : 0;

  return {
    date,
    hasEligibleHabits: eligibleCount > 0,
    eligibleCount,
    completedCount,
    pendingCount,
    missedCount,
    upcomingCount,
    overallCompletionRate,
    booleanEligibleCount,
    booleanCompletedCount,
    booleanCompletionRate,
    measurableEligibleCount,
    measurableAverageAttainment,
  };
}

/**
 * Calculates period-level completion metrics across `[startDate, endDate]`.
 * Excludes future scheduled occurrences (`upcoming`) from the performance rate denominator
 * until those dates become eligible, while still reporting `upcomingCount` transparently.
 */
export function calculateRangeMetrics(
  habits: HabitRecord[],
  logsByHabitAndDate: Map<string, HabitLogRecord>,
  startDate: string,
  endDate: string,
  userToday: string,
  userCurrentTime: string = '12:00'
): {
  totalScheduled: number;
  eligibleToDate: number;
  completedCount: number;
  pendingCount: number;
  missedCount: number;
  upcomingCount: number;
  completionRate: number;
  dailySummaries: DaySummaryMetrics[];
} {
  const dates = enumerateDates(startDate, endDate);
  const dailySummaries: DaySummaryMetrics[] = [];

  let totalScheduled = 0;
  let eligibleToDate = 0;
  let completedCount = 0;
  let pendingCount = 0;
  let missedCount = 0;
  let upcomingCount = 0;

  for (const d of dates) {
    const summary = calculateDaySummary(habits, logsByHabitAndDate, d, userToday, userCurrentTime);
    dailySummaries.push(summary);
    totalScheduled += summary.eligibleCount;
    completedCount += summary.completedCount;
    pendingCount += summary.pendingCount;
    missedCount += summary.missedCount;
    upcomingCount += summary.upcomingCount;
    if (d <= userToday) {
      eligibleToDate += summary.eligibleCount;
    }
  }

  const completionRate = eligibleToDate > 0 ? roundMetric((completedCount / eligibleToDate) * 100, 1) : 0;

  return {
    totalScheduled,
    eligibleToDate,
    completedCount,
    pendingCount,
    missedCount,
    upcomingCount,
    completionRate,
    dailySummaries,
  };
}

/**
 * Calculates overall workspace consistency streaks across all scheduled days up to `userToday`.
 *
 * Documented Rule:
 * - `currentStreak` / `longestStreak` (Consistency Streak): Consecutive calendar days with at least 1
 *   scheduled habit where the user completed >= 80% of scheduled habits. Days with 0 scheduled habits
 *   do not break the streak. If `userToday` has pending habits and hasn't reached 80% yet, today does
 *   not break yesterday's active streak unless all remaining habits cannot reach 80% and deadlines passed.
 * - `perfectDayCurrentStreak` / `perfectDayLongestStreak`: Consecutive scheduled days with 100% completion.
 */
export function calculateOverallConsistencyStreak(
  habits: HabitRecord[],
  logsByHabitAndDate: Map<string, HabitLogRecord>,
  userToday: string,
  userCurrentTime: string = '12:00'
): OverallStreakSummary {
  if (habits.length === 0) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      perfectDayCurrentStreak: 0,
      perfectDayLongestStreak: 0,
      consistencyThresholdPct: CONSISTENCY_STREAK_THRESHOLD_PCT,
    };
  }

  let earliestStart = userToday;
  for (const h of habits) {
    if (h.startDate < earliestStart) earliestStart = h.startDate;
  }
  // Cap scan window to 730 days for predictable performance while preserving multi-year streaks
  const minScanStart = addDays(userToday, -730);
  const scanStart = earliestStart < minScanStart ? minScanStart : earliestStart;
  if (scanStart > userToday) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      perfectDayCurrentStreak: 0,
      perfectDayLongestStreak: 0,
      consistencyThresholdPct: CONSISTENCY_STREAK_THRESHOLD_PCT,
    };
  }

  const dates = enumerateDates(scanStart, userToday);
  let consistencyRunning = 0;
  let consistencyLongest = 0;
  let perfectRunning = 0;
  let perfectLongest = 0;

  for (const d of dates) {
    const day = calculateDaySummary(habits, logsByHabitAndDate, d, userToday, userCurrentTime);
    if (!day.hasEligibleHabits) {
      continue;
    }

    const meetsConsistency = day.overallCompletionRate >= CONSISTENCY_STREAK_THRESHOLD_PCT;
    const meetsPerfect = day.completedCount === day.eligibleCount;

    if (meetsConsistency) {
      consistencyRunning += 1;
      if (consistencyRunning > consistencyLongest) consistencyLongest = consistencyRunning;
    } else if (d === userToday && day.pendingCount > 0) {
      const maxPossiblePct = ((day.completedCount + day.pendingCount) / day.eligibleCount) * 100;
      if (maxPossiblePct < CONSISTENCY_STREAK_THRESHOLD_PCT) {
        consistencyRunning = 0;
      }
    } else {
      consistencyRunning = 0;
    }

    if (meetsPerfect) {
      perfectRunning += 1;
      if (perfectRunning > perfectLongest) perfectLongest = perfectRunning;
    } else if (d === userToday && day.missedCount === 0 && day.pendingCount > 0) {
      // Today is still open with zero missed deadlines
    } else {
      perfectRunning = 0;
    }
  }

  return {
    currentStreak: consistencyRunning,
    longestStreak: consistencyLongest,
    perfectDayCurrentStreak: perfectRunning,
    perfectDayLongestStreak: perfectLongest,
    consistencyThresholdPct: CONSISTENCY_STREAK_THRESHOLD_PCT,
  };
}

/**
 * Ranks habits over `[startDate, endDate]` with consistent tie-breaking:
 * 1) Higher completion rate
 * 2) Higher completed occurrences count
 * 3) Alphabetical habit name
 * Flags `lowSampleSize: true` when `eligibleOccurrences < 5`.
 */
export function rankHabitsInPeriod(
  habits: HabitRecord[],
  logs: HabitLogRecord[],
  startDate: string,
  endDate: string,
  userToday: string,
  userCurrentTime: string = '12:00'
): HabitStreakSummary[] {
  const logsByHabit = new Map<number, Map<string, HabitLogRecord>>();
  for (const log of logs) {
    let map = logsByHabit.get(log.habitId);
    if (!map) {
      map = new Map();
      logsByHabit.set(log.habitId, map);
    }
    map.set(log.localDate, log);
  }

  const effectiveEnd = endDate > userToday ? userToday : endDate;
  const periodDates = startDate <= effectiveEnd ? enumerateDates(startDate, effectiveEnd) : [];

  const summaries: HabitStreakSummary[] = habits.map((habit) => {
    const habitLogs = logsByHabit.get(habit.id) ?? new Map<string, HabitLogRecord>();
    const streaks = calculateHabitStreak(habit, habitLogs, userToday, userCurrentTime);

    let eligibleOccurrences = 0;
    let completedOccurrences = 0;
    let missedOccurrences = 0;

    for (const d of periodDates) {
      const occ = classifyOccurrence(habit, d, habitLogs.get(d), userToday, userCurrentTime);
      if (!occ.isScheduled) continue;
      eligibleOccurrences += 1;
      if (occ.state === 'completed') completedOccurrences += 1;
      else if (occ.state === 'missed') missedOccurrences += 1;
    }

    const completionRate =
      eligibleOccurrences > 0 ? roundMetric((completedOccurrences / eligibleOccurrences) * 100, 1) : 0;

    return {
      habitId: habit.id,
      habitName: habit.name,
      category: habit.category,
      color: habit.color,
      currentStreak: streaks.currentStreak,
      longestStreak: streaks.longestStreak,
      completedOccurrences,
      eligibleOccurrences,
      missedOccurrences,
      completionRate,
      lowSampleSize: eligibleOccurrences > 0 && eligibleOccurrences < 5,
    };
  });

  summaries.sort((a, b) => {
    if (a.eligibleOccurrences === 0 && b.eligibleOccurrences > 0) return 1;
    if (b.eligibleOccurrences === 0 && a.eligibleOccurrences > 0) return -1;
    if (b.completionRate !== a.completionRate) return b.completionRate - a.completionRate;
    if (b.completedOccurrences !== a.completedOccurrences) return b.completedOccurrences - a.completedOccurrences;
    return a.habitName.localeCompare(b.habitName);
  });

  return summaries;
}

export function calculateMonthWeekSummaries(
  year: number,
  month: number,
  weekStartPreference: number,
  habits: HabitRecord[],
  logsByHabitAndDate: Map<string, HabitLogRecord>,
  userToday: string,
  userCurrentTime: string = '12:00'
): WeekGroupSummary[] {
  const buckets = getMonthWeekBuckets(year, month, weekStartPreference);
  return buckets.map((bucket) => {
    const metrics = calculateRangeMetrics(
      habits,
      logsByHabitAndDate,
      bucket.startDate,
      bucket.endDate,
      userToday,
      userCurrentTime
    );
    return {
      weekNumber: bucket.weekNumber,
      label: bucket.label,
      isPartial: bucket.isPartial,
      startDate: bucket.startDate,
      endDate: bucket.endDate,
      dates: bucket.dates,
      completedCount: metrics.completedCount,
      eligibleCount: metrics.eligibleToDate,
      completionRate: metrics.completionRate,
    };
  });
}

export function evaluateGoalsProgress(
  goals: GoalRecord[],
  habits: HabitRecord[],
  logsByHabitAndDate: Map<string, HabitLogRecord>,
  userToday: string,
  userCurrentTime: string = '12:00'
): GoalWithProgress[] {
  const habitMap = new Map(habits.map((h) => [h.id, h]));

  return goals.map((goal) => {
    const linkedHabit = goal.habitId ? habitMap.get(goal.habitId) ?? null : null;
    const effectiveEnd = goal.endDate > userToday ? userToday : goal.endDate;

    if (goal.startDate > userToday) {
      return {
        ...goal,
        habitName: linkedHabit?.name ?? null,
        currentValue: 0,
        progressPct: 0,
        isTargetReached: false,
        eligibleDays: 0,
        summaryText: `Starts on ${goal.startDate}`,
      };
    }

    if (goal.goalType === 'habit_target' && linkedHabit) {
      const dates = enumerateDates(goal.startDate, effectiveEnd);
      let completedDays = 0;
      let numericSum = 0;
      let scheduledDays = 0;

      for (const d of dates) {
        const occ = classifyOccurrence(linkedHabit, d, logsByHabitAndDate.get(`${linkedHabit.id}:${d}`), userToday, userCurrentTime);
        if (occ.isScheduled) scheduledDays += 1;
        if (occ.isCompleted) completedDays += 1;
        numericSum += occ.currentValue;
      }

      const useCompletions = goal.targetUnit === 'completions' || goal.targetUnit === 'days' || linkedHabit.habitType === 'boolean';
      const currentValue = roundMetric(useCompletions ? completedDays : numericSum, 1);
      const progressPct = roundMetric(Math.min(100, (currentValue / Math.max(goal.targetValue, 1)) * 100), 1);

      return {
        ...goal,
        habitName: linkedHabit.name,
        currentValue,
        progressPct,
        isTargetReached: currentValue >= goal.targetValue,
        eligibleDays: scheduledDays,
        summaryText: `${currentValue} / ${goal.targetValue} ${goal.targetUnit ?? 'completions'}`,
      };
    }

    // Rate-based goals (daily_completion, weekly_consistency, monthly_completion)
    const scopedHabits = linkedHabit ? [linkedHabit] : habits;
    const rangeMetrics = calculateRangeMetrics(
      scopedHabits,
      logsByHabitAndDate,
      goal.startDate,
      effectiveEnd,
      userToday,
      userCurrentTime
    );

    const currentValue = rangeMetrics.completionRate;
    const progressPct = roundMetric(Math.min(100, (currentValue / Math.max(goal.targetValue, 1)) * 100), 1);
    const eligibleDays = rangeMetrics.dailySummaries.filter((d) => d.hasEligibleHabits).length;

    return {
      ...goal,
      habitName: linkedHabit?.name ?? null,
      currentValue,
      progressPct,
      isTargetReached: eligibleDays > 0 && currentValue >= goal.targetValue,
      eligibleDays,
      summaryText:
        eligibleDays > 0
          ? `${currentValue}% achieved against ${goal.targetValue}% target (${rangeMetrics.completedCount}/${rangeMetrics.eligibleToDate} scheduled)`
          : 'No scheduled occurrences in range yet',
    };
  });
}

export function buildLogsLookup(logs: HabitLogRecord[]): Map<string, HabitLogRecord> {
  const map = new Map<string, HabitLogRecord>();
  for (const log of logs) {
    map.set(`${log.habitId}:${log.localDate}`, log);
  }
  return map;
}
