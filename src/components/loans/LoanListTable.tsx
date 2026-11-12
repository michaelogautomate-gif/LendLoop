"use client";

import { useMutation } from "convex/react";
import { Calendar, Check, RotateCcw, X, XCircle } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  extractErrorMessage,
  formatCategoryLabel,
  type LoanStatus,
  type ToolCategory,
} from "@/lib/utils";
import {
  AutomationActivityBadge,
  LoanStatusBadge,
  OverdueBadge,
  TrustedLenderBadge,
} from "./AutomationActivityBadge";

export interface EnrichedLoanRow {
  _id: Id<"loans">;
  toolName: string;
  toolCategory: ToolCategory;
  ownerName: string;
  ownerIsTrustedLender: boolean;
  borrowerName: string;
  startDate: string;
  endDate: string;
  status: LoanStatus;
  borrowerNote?: string;
  lenderResponseNote?: string;
  daysOverdue: number;
  lastReminderSentAt?: number;
  reminderCount: number;
  lastAutomationSummary?: string;
  lastAutomationAt?: number;
}

export function LoanListTable({
  mode,
  loans,
}: {
  mode: "my_requests" | "incoming_requests";
  loans: EnrichedLoanRow[] | undefined;
}) {
  const respondToRequest = useMutation(api.loans.respondToRequest);
  const cancelBorrowRequest = useMutation(api.loans.cancelBorrowRequest);
  const markReturned = useMutation(api.loans.markReturned);

  const [busyId, setBusyId] = useState<Id<"loans"> | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function runAction(loanId: Id<"loans">, fn: () => Promise<unknown>) {
    setError(null);
    setBusyId(loanId);
    try {
      await fn();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  if (loans === undefined) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        Loading loans...
      </div>
    );
  }

  if (loans.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <p className="text-sm font-medium text-slate-700">
          {mode === "my_requests"
            ? "You haven't requested any tools yet."
            : "No incoming borrow requests yet."}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {mode === "my_requests"
            ? "Browse neighbor tools to send your first borrow request."
            : "Requests from neighbors for your listed tools will appear here."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800">
          {error}
        </div>
      )}

      {loans.map((loan) => (
        <div
          key={loan._id}
          className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs sm:flex-row sm:items-center"
        >
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-slate-900">
                {loan.toolName}
              </h3>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                {formatCategoryLabel(loan.toolCategory)}
              </span>
              <LoanStatusBadge status={loan.status} />
              <OverdueBadge daysOverdue={loan.daysOverdue} />
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5 text-slate-400" />
                {loan.startDate} to {loan.endDate}
              </span>
              {mode === "my_requests" ? (
                <span className="inline-flex items-center gap-1.5">
                  <span>
                    Lender:{" "}
                    <strong className="font-medium text-slate-900">
                      {loan.ownerName}
                    </strong>
                  </span>
                  {loan.ownerIsTrustedLender && <TrustedLenderBadge />}
                </span>
              ) : (
                <span>
                  Borrower:{" "}
                  <strong className="font-medium text-slate-900">
                    {loan.borrowerName}
                  </strong>
                </span>
              )}
            </div>

            {loan.borrowerNote && (
              <p className="text-xs italic text-slate-500">
                Borrower note: &ldquo;{loan.borrowerNote}&rdquo;
              </p>
            )}

            {loan.lenderResponseNote && (
              <p className="text-xs text-slate-600">
                Response note: &ldquo;{loan.lenderResponseNote}&rdquo;
              </p>
            )}

            <div className="pt-1">
              <AutomationActivityBadge loan={loan} />
            </div>
          </div>

          <div className="flex flex-col items-start gap-2 sm:items-end">
            {mode === "my_requests" && loan.status === "pending" && (
              <button
                type="button"
                disabled={busyId === loan._id}
                onClick={() =>
                  runAction(loan._id, () =>
                    cancelBorrowRequest({ loanId: loan._id })
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                <XCircle className="h-3.5 w-3.5" />
                {busyId === loan._id ? "Cancelling..." : "Cancel Request"}
              </button>
            )}

            {mode === "incoming_requests" && loan.status === "pending" && (
              <div className="flex flex-col gap-2 sm:items-end">
                <input
                  type="text"
                  maxLength={300}
                  value={notes[loan._id] ?? ""}
                  onChange={(e) =>
                    setNotes((prev) => ({
                      ...prev,
                      [loan._id]: e.target.value,
                    }))
                  }
                  placeholder="Optional pickup/decline note..."
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-1 text-xs focus:border-emerald-500 focus:outline-none sm:w-56"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busyId === loan._id}
                    onClick={() =>
                      runAction(loan._id, () =>
                        respondToRequest({
                          loanId: loan._id,
                          decision: "approve",
                          lenderResponseNote:
                            notes[loan._id]?.trim() || undefined,
                        })
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busyId === loan._id}
                    onClick={() =>
                      runAction(loan._id, () =>
                        respondToRequest({
                          loanId: loan._id,
                          decision: "decline",
                          lenderResponseNote:
                            notes[loan._id]?.trim() || undefined,
                        })
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                  >
                    <X className="h-3.5 w-3.5" />
                    Decline
                  </button>
                </div>
              </div>
            )}

            {mode === "incoming_requests" && loan.status === "approved" && (
              <button
                type="button"
                disabled={busyId === loan._id}
                onClick={() =>
                  runAction(loan._id, () => markReturned({ loanId: loan._id }))
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Mark as Returned
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

