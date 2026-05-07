// Pure date/time helpers for IHPU pressure log parsing.
//
// IHPU log timestamps are wall-clock local time without timezone. We deliberately
// avoid `new Date(string)` parsing (which is locale-dependent and would silently
// shift values by the host TZ offset) and instead use Date.UTC to produce a
// deterministic monotonic key that is the same on Windows, on a CI runner in
// any timezone, and inside a Node-based Vitest test.

export interface DateParts {
  year: number;
  /** 1-12, calendar month. */
  month: number;
  /** 1-31, calendar day. */
  day: number;
}

export interface TimeParts {
  /** 0-23. */
  hour: number;
  /** 0-59. */
  minute: number;
  /** 0-59. */
  second: number;
}

export interface DateTimeParts extends DateParts, TimeParts {}

const DATE_DOT = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
const DATE_SLASH = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const DATE_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const TIME_HMS = /^(\d{1,2}):(\d{2}):(\d{2})$/;
const TIME_HM = /^(\d{1,2}):(\d{2})$/;

/**
 * Parse a date string in one of: DD.MM.YYYY, DD/MM/YYYY, YYYY-MM-DD.
 * Returns null on any malformed or out-of-range value (including 31 February).
 */
export function parseDateParts(value: string): DateParts | null {
  const trimmed = value.trim();

  let m = trimmed.match(DATE_DOT);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    return validateDate(year, month, day);
  }

  m = trimmed.match(DATE_SLASH);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    return validateDate(year, month, day);
  }

  m = trimmed.match(DATE_ISO);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    return validateDate(year, month, day);
  }

  return null;
}

/**
 * Parse a time string in HH:MM or HH:MM:SS. Seconds defaults to 0 when omitted.
 */
export function parseTimeParts(value: string): TimeParts | null {
  const trimmed = value.trim();

  let m = trimmed.match(TIME_HMS);
  if (m) {
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    const second = Number(m[3]);
    if (validateTime(hour, minute, second)) return { hour, minute, second };
    return null;
  }

  m = trimmed.match(TIME_HM);
  if (m) {
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (validateTime(hour, minute, 0)) return { hour, minute, second: 0 };
    return null;
  }

  return null;
}

/**
 * Parse a combined "DATE TIME" string (whitespace-separated). Returns null if
 * either the date or the time component fails to parse.
 *
 * Example: "21.02.2026 13:10:37" -> { year: 2026, month: 2, day: 21, hour: 13, minute: 10, second: 37 }
 */
export function parseIhpuLocalDateTime(value: string): DateTimeParts | null {
  const trimmed = value.trim();
  const splitAt = trimmed.search(/\s/);
  if (splitAt === -1) return null;

  const dateStr = trimmed.slice(0, splitAt);
  const timeStr = trimmed.slice(splitAt + 1).trim();

  const date = parseDateParts(dateStr);
  if (!date) return null;
  const time = parseTimeParts(timeStr);
  if (!time) return null;

  return { ...date, ...time };
}

/**
 * Render parts as a local ISO-8601 string with NO timezone suffix.
 * Example: "2026-02-21T13:10:37".
 */
export function toLocalIso(parts: DateTimeParts): string {
  return (
    pad4(parts.year) +
    '-' +
    pad2(parts.month) +
    '-' +
    pad2(parts.day) +
    'T' +
    pad2(parts.hour) +
    ':' +
    pad2(parts.minute) +
    ':' +
    pad2(parts.second)
  );
}

/**
 * Convert parts to a deterministic millisecond key using Date.UTC. This is the
 * canonical sort/duration key for IHPU rows. The value is NOT a UTC instant in
 * the wall-clock sense — it's an ordering surrogate that produces the same
 * deltas regardless of host timezone.
 */
export function toDeterministicTimestampMs(parts: DateTimeParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

/**
 * Format a duration in minutes as a short human-readable string, e.g. "69.4 min".
 */
export function formatDurationMinutes(value: number): string {
  return value.toFixed(1) + ' min';
}

// ---------- internal helpers ----------

function validateDate(year: number, month: number, day: number): DateParts | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || year > 9999) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  // Reconstruct via Date.UTC and confirm round-trip — catches Feb 30, Apr 31, leap years.
  const ms = Date.UTC(year, month - 1, day);
  const d = new Date(ms);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function validateTime(hour: number, minute: number, second: number): boolean {
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || !Number.isInteger(second)) return false;
  if (hour < 0 || hour > 23) return false;
  if (minute < 0 || minute > 59) return false;
  if (second < 0 || second > 59) return false;
  return true;
}

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

function pad4(n: number): string {
  if (n >= 1000) return String(n);
  if (n >= 100) return '0' + n;
  if (n >= 10) return '00' + n;
  return '000' + n;
}
