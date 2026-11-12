import { describe, expect, it } from "vitest";
import { resolveServerRole } from "../../convex/lib/auth";
import {
  buildOverdueIdempotencyKey,
  canTransitionLoanStatus,
  computeDaysOverdue,
  isValidIsoDate,
  rangesOverlap,
  validateBorrowDateRange,
} from "../../convex/lib/dates";
import {
  sanitizeOperationalText,
  sanitizeSingleLine,
} from "../../convex/lib/sanitize";

describe("Phase 1: Date Validation, Overlap Math & Sanitization", () => {
  it("1. accepts valid YYYY-MM-DD range where startDate <= endDate", () => {
    expect(isValidIsoDate("2026-11-11")).toBe(true);
    expect(
      validateBorrowDateRange("2026-11-11", "2026-11-11", "2026-11-11").valid
    ).toBe(true);
    expect(
      validateBorrowDateRange("2026-11-12", "2026-11-15", "2026-11-11").valid
    ).toBe(true);
  });

  it("2. rejects inverted range, past startDate, and malformed/non-existent calendar dates", () => {
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2025-02-29")).toBe(false);
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("11/11/2026")).toBe(false);

    const inverted = validateBorrowDateRange(
      "2026-11-15",
      "2026-11-12",
      "2026-11-11"
    );
    expect(inverted.valid).toBe(false);

    const pastStart = validateBorrowDateRange(
      "2026-11-10",
      "2026-11-12",
      "2026-11-11"
    );
    expect(pastStart.valid).toBe(false);

    const badDate = validateBorrowDateRange(
      "2026-02-30",
      "2026-03-02",
      "2026-02-01"
    );
    expect(badDate.valid).toBe(false);
  });

  it("3. detects partial overlap, exact overlap, boundary-touch overlap, and inner containment", () => {
    // Partial overlap
    expect(
      rangesOverlap("2026-11-10", "2026-11-13", "2026-11-12", "2026-11-15")
    ).toBe(true);
    // Exact overlap
    expect(
      rangesOverlap("2026-11-10", "2026-11-12", "2026-11-10", "2026-11-12")
    ).toBe(true);
    // Single-day edge touch
    expect(
      rangesOverlap("2026-11-10", "2026-11-12", "2026-11-12", "2026-11-14")
    ).toBe(true);
    // Inner containment
    expect(
      rangesOverlap("2026-11-10", "2026-11-20", "2026-11-12", "2026-11-14")
    ).toBe(true);
  });

  it("4. allows adjacent non-overlapping ranges (2026-11-10..12 and 2026-11-13..15)", () => {
    expect(
      rangesOverlap("2026-11-10", "2026-11-12", "2026-11-13", "2026-11-15")
    ).toBe(false);
    expect(
      rangesOverlap("2026-11-13", "2026-11-15", "2026-11-10", "2026-11-12")
    ).toBe(false);
  });

  it("enforces strict loan state machine and deterministic overdue calculations", () => {
    expect(canTransitionLoanStatus("pending", "approved")).toBe(true);
    expect(canTransitionLoanStatus("pending", "declined")).toBe(true);
    expect(canTransitionLoanStatus("pending", "returned")).toBe(false);
    expect(canTransitionLoanStatus("approved", "returned")).toBe(true);
    expect(canTransitionLoanStatus("approved", "declined")).toBe(false);
    expect(canTransitionLoanStatus("declined", "approved")).toBe(false);
    expect(canTransitionLoanStatus("returned", "approved")).toBe(false);

    expect(buildOverdueIdempotencyKey("j57xyz789", "2026-11-11")).toBe(
      "overdue:j57xyz789:2026-11-11"
    );
    expect(computeDaysOverdue("2026-11-08", "2026-11-11")).toBe(3);
    expect(computeDaysOverdue("2026-11-11", "2026-11-11")).toBe(0);
    expect(computeDaysOverdue("2026-11-15", "2026-11-11")).toBe(0);
  });

  it("sanitizes input strings and enforces verified-email admin bootstrap", () => {
    expect(
      sanitizeSingleLine("  DeWalt\u0007   Drill \n 20V ", {
        field: "Tool name",
        minLength: 2,
        maxLength: 80,
      })
    ).toBe("DeWalt Drill 20V");

    const fakeKey = ["sk", "test", "abcdefghijklmnopqrstuv"].join("_");
    expect(
      sanitizeOperationalText(`Failed with Bearer secret_token_123 and ${fakeKey}`)
    ).toBe("Failed with [REDACTED] and [REDACTED]");

    expect(
      resolveServerRole({
        jwtRole: undefined,
        email: "admin@example.com",
        emailVerified: true,
        bootstrapAdminEmail: "ADMIN@EXAMPLE.COM",
      })
    ).toBe("admin");

    expect(
      resolveServerRole({
        jwtRole: undefined,
        email: "admin@example.com",
        emailVerified: false,
        bootstrapAdminEmail: "admin@example.com",
      })
    ).toBe("user");
  });
});
