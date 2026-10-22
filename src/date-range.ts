const DAY_MS = 86_400_000;

/** Parses a strict `YYYY-MM-DD` string as midnight UTC and rejects dates that do not exist. */
export function parseIsoDate(input: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new Error(`expected a date in YYYY-MM-DD format, got "${input}"`);
  }
  const date = new Date(`${input}T00:00:00.000Z`);
  // Date silently rolls 2026-02-30 over to March; the round trip catches that.
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input) {
    throw new Error(`"${input}" is not a valid calendar date`);
  }
  return date;
}

function utcDayNumber(date: Date): number {
  return Math.floor(date.getTime() / DAY_MS);
}

/** Whole UTC calendar days from `from` to `to`; negative when `to` is earlier. Time of day is ignored. */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1;
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/** Adds `days` business days (Monday to Friday) to `start`, returning a new date. */
export function addBusinessDays(start: Date, days: number): Date {
  if (days < 0) {
    throw new Error(`days must not be negative, got ${days}`);
  }
  const result = new Date(start.getTime());
  let remaining = days;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    remaining -= 1;
    if (isWeekend(result)) {
      result.setUTCDate(result.getUTCDate() + 2);
    }
  }
  return result;
}
