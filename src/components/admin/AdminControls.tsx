"use client";

import { useMutation, useQuery } from "convex/react";
import {
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  AutomationActivityBadge,
  LoanStatusBadge,
  OverdueBadge,
  TrustedLenderBadge,
} from "@/components/loans/AutomationActivityBadge";
import { formatRelativeTime } from "@/lib/formatRelativeTime";
import { extractErrorMessage, formatCategoryLabel } from "@/lib/utils";

export function AdminControls() {
  const adminLoans = useQuery(api.loans.listAllLoansForAdmin);
  const users = useQuery(api.users.listUsersForAdmin);
  const tools = useQuery(api.tools.listAuthenticatedCatalog, {});
  const auditLogs = useQuery(api.users.listSecurityAuditLogsForAdmin);

  const toggleTrustedLender = useMutation(api.users.toggleTrustedLender);
  const adminRemoveTool = useMutation(api.tools.adminRemoveTool);
  const markReturned = useMutation(api.loans.markReturned);
  const seedDemo = useMutation(api.seed.seedDemoForCurrentUser);

  const [error, setError] = useState<string | null>(null);
  const [seedInfo, setSeedInfo] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  async function handleToggleTrusted(
    userId: Id<"users">,
    isTrustedLender: boolean
  ) {
    setError(null);
    try {
      await toggleTrustedLender({ userId, isTrustedLender });
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  async function handleRemoveListing(toolId: Id<"tools">, name: string) {
    setError(null);
    if (!window.confirm(`Admin moderation: permanently remove "${name}"?`)) {
      return;
    }
    try {
      await adminRemoveTool({
        toolId,
        reason: "removed_by_admin_moderation",
      });
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  async function handleMarkReturned(loanId: Id<"loans">) {
    setError(null);
    try {
      await markReturned({ loanId });
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  async function handleSeed() {
    setError(null);
    setSeedInfo(null);
    setSeeding(true);
    try {
      const res = await seedDemo();
      setSeedInfo(
        `Seeded ${res.createdTools} tools${
          res.createdOverdueLoan ? " + 1 overdue loan" : ""
        }${res.createdActiveLoan ? " + 1 active loan" : ""}.`
      );
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50/70 px-4 py-3 text-xs text-indigo-950">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-indigo-700" />
          <span>
            Admin actions are strictly enforced inside Convex functions via{" "}
            <code className="rounded bg-indigo-100 px-1 py-0.5">
              requireAdmin(ctx)
            </code>{" "}
            and logged to{" "}
            <code className="rounded bg-indigo-100 px-1 py-0.5">
              securityAuditLogs
            </code>
            .
          </span>
        </div>

        <button
          type="button"
          disabled={seeding}
          onClick={handleSeed}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-2xs hover:bg-emerald-50 disabled:opacity-60"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {seeding ? "Seeding..." : "Seed Demo Tools & Overdue Loan"}
        </button>
      </div>

      {seedInfo && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900">
          {seedInfo}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800">
          {error}
        </div>
      )}

      {/* Trusted Lender Management */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">
          Neighborhood Users &amp; Trusted Lenders
        </h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Trust Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {(users ?? []).map((u) => (
                <tr key={u._id}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {u.name}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {u.email}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {u.isTrustedLender ? (
                      <TrustedLenderBadge />
                    ) : (
                      <span className="text-xs text-slate-400">Standard</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() =>
                        handleToggleTrusted(u._id, !u.isTrustedLender)
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <ShieldCheck className="h-3.5 w-3.5 text-teal-600" />
                      {u.isTrustedLender
                        ? "Revoke Trusted"
                        : "Mark Trusted Lender"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Moderation: All Active Listings */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">
          Listing Moderation ({tools?.length ?? 0})
        </h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Tool</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3 text-right">Moderation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {(tools ?? []).map((t) => (
                <tr key={t._id}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {t.name}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {formatCategoryLabel(t.category)}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700">
                    {t.ownerName}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleRemoveListing(t._id, t.name)}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove Listing
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* All Neighborhood Loans */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">
          All Neighborhood Loans ({adminLoans?.loans.length ?? 0})
        </h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Tool</th>
                <th className="px-4 py-3">Lender → Borrower</th>
                <th className="px-4 py-3">Dates</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Automation</th>
                <th className="px-4 py-3 text-right">Admin Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {(adminLoans?.loans ?? []).map((loan) => (
                <tr key={loan._id}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {loan.toolName}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700">
                    {loan.ownerName} → {loan.borrowerName}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {loan.startDate} .. {loan.endDate}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <LoanStatusBadge status={loan.status} />
                      <OverdueBadge daysOverdue={loan.daysOverdue} />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <AutomationActivityBadge loan={loan} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {loan.status === "approved" && (
                      <button
                        type="button"
                        onClick={() => handleMarkReturned(loan._id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Mark Returned
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Automation Events */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">
          Recent Automation Events (n8n ↔ Convex)
        </h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Event Type</th>
                <th className="px-4 py-3">Direction</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Summary</th>
                <th className="px-4 py-3">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {(adminLoans?.automationEvents ?? []).map((evt) => (
                <tr key={evt._id}>
                  <td className="px-4 py-2.5 font-mono text-slate-800">
                    {evt.eventType}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {evt.direction}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 font-medium ${
                        evt.status === "failed"
                          ? "bg-rose-100 text-rose-800"
                          : evt.status === "pending"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      {evt.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">
                    <div>{evt.summary}</div>
                    {evt.errorMessage && (
                      <div className="mt-0.5 text-rose-700">
                        {evt.errorMessage}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {formatRelativeTime(evt.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Security Audit Logs */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">
          Security Audit Log
        </h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Actor Role</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">Metadata</th>
                <th className="px-4 py-3">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {(auditLogs ?? []).map((entry) => (
                <tr key={entry._id}>
                  <td className="px-4 py-2.5 font-mono text-slate-800">
                    {entry.action}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {entry.actorRole}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-slate-600">
                    {entry.targetTable}:{entry.targetId}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-slate-600">
                    {entry.metadata}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {formatRelativeTime(entry.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

