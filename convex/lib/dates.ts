export type LoanStatus = "pending" | "approved" | "declined" | "returned";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates that a string is a real YYYY-MM-DD calendar date.
 */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [yearStr, monthStr, dayStr] = value.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Returns today's UTC calendar date formatted as YYYY-MM-DD.
 */
export function getTodayUtcIso(nowMs: number = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * Validates borrow date ranges:
 * - both dates must be valid YYYY-MM-DD calendar dates
 * - endDate >= startDate
 * - startDate >= minStartDate (defaults to UTC today when omitted)
 */
export function validateBorrowDateRange(
  startDate: string,
  endDate: string,
  minStartDate: string = getTodayUtcIso()
): { valid: true } | { valid: false; error: string } {
  if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate)) {
    return { valid: false, error: "Dates must use valid YYYY-MM-DD format." };
  }
  if (endDate < startDate) {
    return {
      valid: false,
      error: "End date must be on or after the start date.",
    };
  }
  if (minStartDate && isValidIsoDate(minStartDate) && startDate < minStartDate) {
    return {
      valid: false,
      error: "Start date cannot be in the past.",
    };
  }
  return { valid: true };
}

/**
 * Inclusive date-range overlap check: [startA, endA] overlaps [startB, endB]
 * iff startA <= endB && endA >= startB.
 */
export function rangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string
): boolean {
  return startA <= endB && endA >= startB;
}

const ALLOWED_TRANSITIONS: Record<LoanStatus, ReadonlyArray<LoanStatus>> = {
  pending: ["approved", "declined"],
  approved: ["returned"],
  declined: [],
  returned: [],
};

export function canTransitionLoanStatus(
  from: LoanStatus,
  to: LoanStatus
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Deterministic daily idempotency key for overdue reminders.
 */
export function buildOverdueIdempotencyKey(
  loanId: string,
  dateKey: string
): string {
  return `overdue:${loanId}:${dateKey}`;
}

/**
 * Whole UTC days elapsed since endDateIso relative to asOfDateIso.
 */
export function computeDaysOverdue(
  endDateIso: string,
  asOfDateIso: string = getTodayUtcIso()
): number {
  if (!isValidIsoDate(endDateIso) || !isValidIsoDate(asOfDateIso)) return 0;
  if (asOfDateIso <= endDateIso) return 0;
  const endMs = Date.parse(`${endDateIso}T00:00:00Z`);
  const asOfMs = Date.parse(`${asOfDateIso}T00:00:00Z`);
  return Math.max(0, Math.round((asOfMs - endMs) / 86_400_000));
}

