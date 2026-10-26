import * as XLSX from 'xlsx';
import { formatIsoDateParts, isValidIsoDate } from '../shared/dates.ts';
import type {
  HabitType,
  ImportPreviewHabit,
  ImportPreviewLog,
  ImportPreviewPayload,
  ScheduleType,
} from '../shared/types.ts';

const KNOWN_HEADERS = new Set([
  'habit',
  'habit name',
  'name',
  'title',
  'routine',
  'category',
  'type',
  'habit type',
  'schedule',
  'schedule type',
  'frequency',
  'target',
  'target value',
  'goal',
  'unit',
  'target unit',
  'date',
  'local date',
  'completed',
  'status',
  'value',
  'numeric value',
  'duration',
  'notes',
  'priority',
  'description',
]);

function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function parseTruthyCell(val: unknown): boolean | null {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val > 0;
  if (typeof val === 'string') {
    const s = val.trim().toLowerCase();
    if (['true', 'yes', 'y', '1', 'done', 'completed', '✓', '✔', 'x'].includes(s)) return true;
    if (['false', 'no', 'n', '0', 'missed', 'pending', ''].includes(s)) return false;
  }
  return null;
}

function tryCoerceDateHeaderOrValue(raw: unknown): string | null {
  if (!raw) return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return formatIsoDateParts(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate());
  }
  const str = String(raw).trim();
  if (isValidIsoDate(str)) return str;

  // Support MM/DD/YYYY or YYYY/MM/DD
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, m, d, y] = slashMatch;
    const candidate = formatIsoDateParts(Number(y), Number(m), Number(d));
    if (isValidIsoDate(candidate)) return candidate;
  }
  return null;
}

function normalizeHabitType(raw: unknown): HabitType {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'count' || s === 'numeric' || s === 'number') return 'count';
  if (s === 'duration' || s === 'time' || s === 'minutes') return 'duration';
  return 'boolean';
}

function normalizeScheduleType(raw: unknown): ScheduleType {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s.includes('weekday') || s === 'mon-fri') return 'weekdays';
  if (s.includes('weekend') || s === 'sat-sun') return 'weekends';
  return 'daily';
}

/**
 * Safely parses an uploaded Excel (.xlsx/.xls) or CSV buffer on the server without
 * evaluating formulas or macros, producing a transparent preview with validation feedback.
 * Never fabricates historical completions.
 */
export function parseSpreadsheetBuffer(
  buffer: Buffer,
  fileName: string,
  existingHabitNamesLower: Set<string>
): ImportPreviewPayload {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellFormula: false,
    cellHTML: false,
    bookVBA: false,
    cellDates: true,
  });

  const habitsMap = new Map<string, ImportPreviewHabit>();
  const logs: ImportPreviewLog[] = [];
  const warnings: string[] = [];
  const errors: { row: number; message: string }[] = [];
  const unrecognizedSet = new Set<string>();

  if (workbook.SheetNames.length === 0) {
    errors.push({ row: 0, message: 'The uploaded workbook contains no sheets.' });
    return { fileName, habits: [], logs: [], warnings, errors, unrecognizedColumns: [] };
  }

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
      raw: true,
    });

    if (rows.length === 0) continue;

    const sampleKeys = Object.keys(rows[0]);
    const dateColumns: { key: string; isoDate: string }[] = [];

    for (const key of sampleKeys) {
      const norm = normalizeHeader(key);
      const maybeDate = tryCoerceDateHeaderOrValue(key);
      if (maybeDate) {
        dateColumns.push({ key, isoDate: maybeDate });
      } else if (!KNOWN_HEADERS.has(norm) && !norm.startsWith('empty')) {
        unrecognizedSet.add(`${sheetName}: ${key}`);
      }
    }

    rows.forEach((row, index) => {
      const rowNum = index + 2;
      const entries = Object.entries(row);
      const byNorm = new Map<string, unknown>();
      for (const [k, v] of entries) {
        byNorm.set(normalizeHeader(k), v);
      }

      const rawName =
        byNorm.get('habit name') ??
        byNorm.get('habit') ??
        byNorm.get('name') ??
        byNorm.get('title') ??
        byNorm.get('routine') ??
        '';
      const habitName = String(rawName ?? '').trim();

      if (!habitName) {
        // Skip completely blank visual separator rows, record error if row had log data
        const hasOtherData = Array.from(byNorm.values()).some((v) => String(v ?? '').trim() !== '');
        if (hasOtherData) {
          errors.push({ row: rowNum, message: `Sheet "${sheetName}" row ${rowNum}: Missing habit name.` });
        }
        return;
      }

      if (habitName.length > 120) {
        errors.push({
          row: rowNum,
          message: `Sheet "${sheetName}" row ${rowNum}: Habit name exceeds 120 characters.`,
        });
        return;
      }

      const category = String(byNorm.get('category') || 'Personal Development').trim().slice(0, 60);
      const habitType = normalizeHabitType(byNorm.get('habit type') ?? byNorm.get('type'));
      const scheduleType = normalizeScheduleType(
        byNorm.get('schedule type') ?? byNorm.get('schedule') ?? byNorm.get('frequency')
      );
      const rawTarget = Number(byNorm.get('target value') ?? byNorm.get('target') ?? byNorm.get('goal') ?? 1);
      const targetValue = Number.isFinite(rawTarget) && rawTarget > 0 ? rawTarget : 1;
      const rawUnit = String(byNorm.get('target unit') ?? byNorm.get('unit') ?? '').trim();
      const targetUnit = rawUnit ? rawUnit.slice(0, 32) : habitType === 'duration' ? 'minutes' : null;

      const lowerKey = habitName.toLowerCase();
      if (!habitsMap.has(lowerKey)) {
        habitsMap.set(lowerKey, {
          rowNumber: rowNum,
          name: habitName,
          category: category || 'Personal Development',
          habitType,
          scheduleType,
          targetValue,
          targetUnit,
          alreadyExists: existingHabitNamesLower.has(lowerKey),
        });
      }

      // Check row-level date log format (e.g. exported logs.csv re-import)
      const explicitDate = tryCoerceDateHeaderOrValue(byNorm.get('local date') ?? byNorm.get('date'));
      if (explicitDate) {
        const completedVal = parseTruthyCell(byNorm.get('completed') ?? byNorm.get('status'));
        const numRaw = byNorm.get('numeric value') ?? byNorm.get('value');
        const numericValue = numRaw !== '' && numRaw != null && Number.isFinite(Number(numRaw)) ? Number(numRaw) : null;
        if (completedVal !== null || numericValue !== null) {
          logs.push({
            habitName,
            localDate: explicitDate,
            completed: completedVal ?? Boolean(numericValue && numericValue >= targetValue),
            numericValue,
          });
        }
      }

      // Check matrix-style date columns (Habit rows × YYYY-MM-DD columns)
      for (const dc of dateColumns) {
        const cellVal = row[dc.key];
        if (cellVal === '' || cellVal === null || cellVal === undefined) continue;
        const parsedBool = parseTruthyCell(cellVal);
        if (parsedBool === true) {
          logs.push({
            habitName,
            localDate: dc.isoDate,
            completed: true,
            numericValue: habitType === 'boolean' ? null : targetValue,
          });
        }
      }
    });
  }

  if (habitsMap.size === 0 && errors.length === 0) {
    warnings.push(
      'No recognizable habit rows were detected. Ensure your sheet includes a "Habit Name" or "Habit" column.'
    );
  }

  if (unrecognizedSet.size > 0) {
    warnings.push(
      `${unrecognizedSet.size} unrecognized column(s) were preserved in this preview summary rather than silently discarded.`
    );
  }

  return {
    fileName,
    habits: Array.from(habitsMap.values()),
    logs: logs.slice(0, 5000),
    warnings,
    errors,
    unrecognizedColumns: Array.from(unrecognizedSet),
  };
}
