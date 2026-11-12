"use client";

import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Clock,
  ShieldCheck,
} from "lucide-react";
import { formatLoanAutomationActivity } from "@/lib/formatRelativeTime";
import type { LoanStatus } from "@/lib/utils";

const STATUS_STYLES: Record<
  LoanStatus,
  { label: string; className: string }
> = {
  pending: {
    label: "Pending",
    className: "border-amber-200 bg-amber-50 text-amber-800",
  },
  approved: {
    label: "Approved",
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  declined: {
    label: "Declined",
    className: "border-rose-200 bg-rose-50 text-rose-800",
  },
  returned: {
    label: "Returned",
    className: "border-slate-200 bg-slate-100 text-slate-700",
  },
};

export function LoanStatusBadge({ status }: { status: LoanStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${style.className}`}
    >
      {style.label}
    </span>
  );
}

export function OverdueBadge({ daysOverdue }: { daysOverdue: number }) {
  if (daysOverdue <= 0) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-800">
      <AlertTriangle className="h-3 w-3" />
      Overdue by {daysOverdue}d
    </span>
  );
}

export function TrustedLenderBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800">
      <ShieldCheck className="h-3.5 w-3.5" />
      Trusted Lender
    </span>
  );
}

export function AutomationActivityBadge({
  loan,
}: {
  loan: {
    lastReminderSentAt?: number;
    reminderCount?: number;
    lastAutomationSummary?: string;
    lastAutomationAt?: number;
  };
}) {
  const label = formatLoanAutomationActivity(loan);
  if (!label) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-slate-400">
        <Clock className="h-3 w-3" />
        No automation activity yet
      </span>
    );
  }

  const isReminder = Boolean(loan.lastReminderSentAt);
  const isFailure = loan.lastAutomationSummary?.toLowerCase().includes("failed");

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
        isFailure
          ? "border-rose-200 bg-rose-50 text-rose-900"
          : isReminder
            ? "border-amber-200 bg-amber-50/70 text-amber-900"
            : "border-slate-200 bg-slate-50 text-slate-700"
      }`}
    >
      {isFailure ? (
        <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />
      ) : isReminder ? (
        <BellRing className="h-3.5 w-3.5 text-amber-600" />
      ) : (
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
      )}
      <span>
        {label}
        {loan.reminderCount && loan.reminderCount > 1
          ? ` (${loan.reminderCount} total)`
          : ""}
      </span>
    </span>
  );
}

