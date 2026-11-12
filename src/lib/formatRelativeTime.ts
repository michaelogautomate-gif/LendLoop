import { formatDistanceToNow } from "date-fns";

export function formatRelativeTime(timestampMs: number): string {
  return formatDistanceToNow(new Date(timestampMs), { addSuffix: true });
}

export function formatLoanAutomationActivity(loan: {
  lastReminderSentAt?: number;
  lastAutomationSummary?: string;
  lastAutomationAt?: number;
}): string | null {
  if (loan.lastReminderSentAt) {
    return `Reminder sent ${formatRelativeTime(loan.lastReminderSentAt)}`;
  }
  if (loan.lastAutomationSummary && loan.lastAutomationAt) {
    return `${loan.lastAutomationSummary} · ${formatRelativeTime(
      loan.lastAutomationAt
    )}`;
  }
  if (loan.lastAutomationSummary) {
    return loan.lastAutomationSummary;
  }
  return null;
}

