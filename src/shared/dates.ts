const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HH_MM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidIsoDate(dateStr: string): boolean {
  if (!ISO_DATE_RE.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= getDaysInMonth(y, m);
}

export function isValidTimeString(timeStr: string): boolean {
  return HH_MM_RE.test(timeStr);
}

export function isValidIanaTimezone(tz: string): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function getLocalDateInTimezone(instant: Date, timeZone: string): string {
  const safeTz = isValidIanaTimezone(timeZone) ? timeZone : 'UTC';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);

  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

export function getLocalTimeInTimezone(instant: Date, timeZone: string): string {
  const safeTz = isValidIanaTimezone(timeZone) ? timeZone : 'UTC';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: safeTz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);

  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hour === '24' ? '00' : hour}:${minute}`;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function getDaysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) {
    throw new Error(`Invalid month: ${month}`);
  }
  const daysPerMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return daysPerMonth[month - 1];
}

export function parseIsoDate(dateStr: string): { year: number; month: number; day: number } {
  if (!isValidIsoDate(dateStr)) {
    throw new Error(`Invalid ISO date string: ${dateStr}`);
  }
  const [year, month, day] = dateStr.split('-').map(Number);
  return { year, month, day };
}

export function formatIsoDateParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function addDays(dateStr: string, deltaDays: number): string {
  const { year, month, day } = parseIsoDate(dateStr);
  const utc = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return formatIsoDateParts(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}

export function compareDates(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function daysBetweenInclusive(startDate: string, endDate: string): number {
  if (startDate > endDate) return 0;
  const a = parseIsoDate(startDate);
  const b = parseIsoDate(endDate);
  const utcA = Date.UTC(a.year, a.month - 1, a.day);
  const utcB = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((utcB - utcA) / 86_400_000) + 1;
}

export function enumerateDates(startDate: string, endDate: string): string[] {
  if (startDate > endDate) return [];
  const count = daysBetweenInclusive(startDate, endDate);
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    result.push(addDays(startDate, i));
  }
  return result;
}

/**
 * Returns day of week: 0 = Sunday, 1 = Monday, ..., 6 = Saturday
 * Uses pure UTC calendar arithmetic so server timezone or DST never shifts the weekday.
 */
export function getDayOfWeek(dateStr: string): number {
  const { year, month, day } = parseIsoDate(dateStr);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function getStartOfWeek(dateStr: string, weekStartPreference: number = 1): string {
  const normalizedStart = [0, 1, 6].includes(weekStartPreference) ? weekStartPreference : 1;
  const dow = getDayOfWeek(dateStr);
  const diff = (dow - normalizedStart + 7) % 7;
  return addDays(dateStr, -diff);
}

export function getEndOfWeek(dateStr: string, weekStartPreference: number = 1): string {
  return addDays(getStartOfWeek(dateStr, weekStartPreference), 6);
}

export function getMonthDateRange(year: number, month: number): { startDate: string; endDate: string; dates: string[] } {
  const totalDays = getDaysInMonth(year, month);
  const startDate = formatIsoDateParts(year, month, 1);
  const endDate = formatIsoDateParts(year, month, totalDays);
  return {
    startDate,
    endDate,
    dates: enumerateDates(startDate, endDate),
  };
}

export interface MonthWeekBucket {
  weekNumber: number;
  label: string;
  isPartial: boolean;
  startDate: string;
  endDate: string;
  dates: string[];
}

/**
 * Splits a calendar month into explicit Week #1 .. Week #5 (and Week #6 if calendar spans 6 weeks)
 * aligned strictly to the user's configured weekStartPreference (0=Sun, 1=Mon, 6=Sat).
 * Partial weeks at the start or end of a month are clearly flagged with `isPartial: true`.
 */
export function getMonthWeekBuckets(
  year: number,
  month: number,
  weekStartPreference: number = 1
): MonthWeekBucket[] {
  const normalizedStart = [0, 1, 6].includes(weekStartPreference) ? weekStartPreference : 1;
  const { dates } = getMonthDateRange(year, month);
  const buckets: MonthWeekBucket[] = [];
  let currentDates: string[] = [];

  for (const date of dates) {
    const dow = getDayOfWeek(date);
    if (currentDates.length > 0 && dow === normalizedStart) {
      const weekNum = buckets.length + 1;
      const isPartial = currentDates.length < 7;
      buckets.push({
        weekNumber: weekNum,
        label: isPartial ? `Week #${weekNum} (Partial)` : `Week #${weekNum}`,
        isPartial,
        startDate: currentDates[0],
        endDate: currentDates[currentDates.length - 1],
        dates: currentDates,
      });
      currentDates = [];
    }
    currentDates.push(date);
  }

  if (currentDates.length > 0) {
    const weekNum = buckets.length + 1;
    const isPartial = currentDates.length < 7;
    buckets.push({
      weekNumber: weekNum,
      label: isPartial ? `Week #${weekNum} (Partial)` : `Week #${weekNum}`,
      isPartial,
      startDate: currentDates[0],
      endDate: currentDates[currentDates.length - 1],
      dates: currentDates,
    });
  }

  return buckets;
}

export function resolvePresetDateRange(
  preset: string,
  userToday: string,
  weekStartPreference: number = 1,
  customStart?: string,
  customEnd?: string
): { startDate: string; endDate: string; label: string } {
  const { year, month } = parseIsoDate(userToday);

  switch (preset) {
    case '7d':
      return {
        startDate: addDays(userToday, -6),
        endDate: userToday,
        label: 'Last 7 days',
      };
    case '30d':
      return {
        startDate: addDays(userToday, -29),
        endDate: userToday,
        label: 'Last 30 days',
      };
    case 'current_week':
    case 'this_week': {
      const start = getStartOfWeek(userToday, weekStartPreference);
      const end = getEndOfWeek(userToday, weekStartPreference);
      return {
        startDate: start,
        endDate: end,
        label: 'Current week',
      };
    }
    case 'previous_week': {
      const currentWeekStart = getStartOfWeek(userToday, weekStartPreference);
      const prevStart = addDays(currentWeekStart, -7);
      const prevEnd = addDays(currentWeekStart, -1);
      return {
        startDate: prevStart,
        endDate: prevEnd,
        label: 'Previous week',
      };
    }
    case 'current_month':
    case 'this_month': {
      const mRange = getMonthDateRange(year, month);
      return {
        startDate: mRange.startDate,
        endDate: mRange.endDate,
        label: 'Current month',
      };
    }
    case 'previous_month': {
      const prevYear = month === 1 ? year - 1 : year;
      const prevMonth = month === 1 ? 12 : month - 1;
      const mRange = getMonthDateRange(prevYear, prevMonth);
      return {
        startDate: mRange.startDate,
        endDate: mRange.endDate,
        label: 'Previous month',
      };
    }
    case 'custom': {
      if (customStart && customEnd && isValidIsoDate(customStart) && isValidIsoDate(customEnd) && customStart <= customEnd) {
        const cappedSpan = daysBetweenInclusive(customStart, customEnd) > 366 ? addDays(customStart, 365) : customEnd;
        return {
          startDate: customStart,
          endDate: cappedSpan,
          label: `${customStart} to ${cappedSpan}`,
        };
      }
      return {
        startDate: addDays(userToday, -29),
        endDate: userToday,
        label: 'Last 30 days',
      };
    }
    default:
      return {
        startDate: addDays(userToday, -29),
        endDate: userToday,
        label: 'Last 30 days',
      };
  }
}
