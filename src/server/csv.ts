/**
 * Escapes a single CSV field per RFC 4180 and neutralizes spreadsheet formula injection
 * when non-numeric string values start with `=`, `+`, `-`, or `@`.
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  let str = String(value);
  // Prevent CSV formula execution in Excel / Google Sheets on untrusted text strings
  if (/^[=+\-@]/.test(str) && !/^-[0-9]+(\.[0-9]+)?$/.test(str)) {
    str = `'${str}`;
  }

  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

export function buildCsvDocument(headers: string[], rows: unknown[][]): string {
  const headerLine = headers.map(escapeCsvCell).join(',');
  const bodyLines = rows.map((row) => row.map(escapeCsvCell).join(','));
  return [headerLine, ...bodyLines].join('\r\n') + '\r\n';
}
