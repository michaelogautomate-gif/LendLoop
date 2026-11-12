import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { assertOwnership, requireAdmin, requireAuth } from "./lib/auth";
import {
  canTransitionLoanStatus,
  computeDaysOverdue,
  getTodayUtcIso,
  rangesOverlap,
  validateBorrowDateRange,
} from "./lib/dates";
import { sanitizeOptionalNote } from "./lib/sanitize";

async function enrichLoans(
  ctx: QueryCtx,
  loans: Doc<"loans">[],
  options: { includeEmails: boolean }
) {
  const todayIso = getTodayUtcIso();
  const userCache = new Map<Id<"users">, Doc<"users"> | null>();
  const toolCache = new Map<Id<"tools">, Doc<"tools"> | null>();

  const getUser = async (id: Id<"users">) => {
    if (!userCache.has(id)) {
      userCache.set(id, await ctx.db.get(id));
    }
    return userCache.get(id) ?? null;
  };

  const getTool = async (id: Id<"tools">) => {
    if (!toolCache.has(id)) {
      toolCache.set(id, await ctx.db.get(id));
    }
    return toolCache.get(id) ?? null;
  };

  const results = [];
  for (const loan of loans) {
    const [tool, owner, borrower] = await Promise.all([
      getTool(loan.toolId),
      getUser(loan.ownerId),
      getUser(loan.borrowerId),
    ]);

    const daysOverdue =
      loan.status === "approved"
        ? computeDaysOverdue(loan.endDate, todayIso)
        : 0;

    results.push({
      _id: loan._id,
      toolId: loan.toolId,
      toolName: tool?.name ?? "Removed Tool",
      toolCategory: tool?.category ?? ("other" as const),
      ownerId: loan.ownerId,
      ownerName: owner?.name ?? "Neighbor",
      ownerIsTrustedLender: owner?.isTrustedLender ?? false,
      borrowerId: loan.borrowerId,
      borrowerName: borrower?.name ?? "Neighbor",
      ...(options.includeEmails
        ? {
            ownerEmail: owner?.email ?? "",
            borrowerEmail: borrower?.email ?? "",
          }
        : {}),
      startDate: loan.startDate,
      endDate: loan.endDate,
      status: loan.status,
      borrowerNote: loan.borrowerNote,
      lenderResponseNote: loan.lenderResponseNote,
      approvedAt: loan.approvedAt,
      returnedAt: loan.returnedAt,
      daysOverdue,
      lastReminderSentAt: loan.lastReminderSentAt,
      lastReminderDateKey: loan.lastReminderDateKey,
      reminderCount: loan.reminderCount,
      lastAutomationSummary: loan.lastAutomationSummary,
      lastAutomationAt: loan.lastAutomationAt,
      createdAt: loan.createdAt,
    });
  }

  return results.sort((a, b) => b.createdAt - a.createdAt);
}

export const requestBorrow = mutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
    borrowerNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const borrower = await requireAuth(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Tool listing not found.",
      });
    }
    if (!tool.isAvailable) {
      throw new ConvexError({
        code: "CONFLICT",
        message: "This tool is currently paused by its owner.",
      });
    }
    if (tool.ownerId === borrower._id) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "You cannot request to borrow your own tool.",
      });
    }

    const todayIso = getTodayUtcIso();
    const dateValidation = validateBorrowDateRange(
      args.startDate,
      args.endDate,
      todayIso
    );
    if (!dateValidation.valid) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: dateValidation.error,
      });
    }

    const borrowerNote = sanitizeOptionalNote(
      args.borrowerNote,
      "Borrow note",
      300
    );

    const existingLoans = await ctx.db
      .query("loans")
      .withIndex("by_toolId", (q) => q.eq("toolId", tool._id))
      .collect();

    const overlappingApproved = existingLoans.find((loan) => {
      if (loan.status !== "approved") return false;
      const effectiveEndDate =
        loan.endDate < todayIso ? todayIso : loan.endDate;
      return rangesOverlap(
        args.startDate,
        args.endDate,
        loan.startDate,
        effectiveEndDate
      );
    });
    if (overlappingApproved) {
      throw new ConvexError({
        code: "CONFLICT",
        message: `Dates overlap with an approved loan (${overlappingApproved.startDate} to ${overlappingApproved.endDate}).`,
      });
    }

    const duplicatePending = existingLoans.find(
      (loan) =>
        loan.borrowerId === borrower._id &&
        loan.status === "pending" &&
        rangesOverlap(
          args.startDate,
          args.endDate,
          loan.startDate,
          loan.endDate
        )
    );
    if (duplicatePending) {
      throw new ConvexError({
        code: "CONFLICT",
        message: "You already have a pending request overlapping these dates.",
      });
    }

    const now = Date.now();
    const loanId = await ctx.db.insert("loans", {
      toolId: tool._id,
      ownerId: tool.ownerId,
      borrowerId: borrower._id,
      startDate: args.startDate,
      endDate: args.endDate,
      status: "pending",
      borrowerNote,
      reminderCount: 0,
      lastAutomationSummary: "Borrow request notification queued",
      lastAutomationAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const idempotencyKey = `loan_requested:${loanId}:${now}`;
    await ctx.db.insert("automationEvents", {
      idempotencyKey,
      loanId,
      direction: "outbound_to_n8n",
      eventType: "loan_requested",
      status: "pending",
      attemptCount: 0,
      summary: "Borrow request notification queued",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.automation.dispatchLoanWebhook, {
      loanId,
      eventType: "loan_requested",
      idempotencyKey,
    });

    return loanId;
  },
});

export const respondToRequest = mutation({
  args: {
    loanId: v.id("loans"),
    decision: v.union(v.literal("approve"), v.literal("decline")),
    lenderResponseNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const owner = await requireAuth(ctx);
    const loan = await ctx.db.get(args.loanId);
    if (!loan) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Loan request not found.",
      });
    }
    assertOwnership(
      loan.ownerId,
      owner._id,
      "Only the tool owner can respond to this request."
    );

    const nextStatus = args.decision === "approve" ? "approved" : "declined";
    if (!canTransitionLoanStatus(loan.status, nextStatus)) {
      throw new ConvexError({
        code: "CONFLICT",
        message: `Cannot ${args.decision} a loan whose status is '${loan.status}'.`,
      });
    }

    if (nextStatus === "approved") {
      const tool = await ctx.db.get(loan.toolId);
      if (!tool) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Cannot approve a request for a deleted tool.",
        });
      }

      const approvedLoans = await ctx.db
        .query("loans")
        .withIndex("by_toolId_status", (q) =>
          q.eq("toolId", loan.toolId).eq("status", "approved")
        )
        .collect();

      const todayIso = getTodayUtcIso();
      const conflict = approvedLoans.find((existing) => {
        if (existing._id === loan._id) return false;
        const effectiveEndDate =
          existing.endDate < todayIso ? todayIso : existing.endDate;
        return rangesOverlap(
          loan.startDate,
          loan.endDate,
          existing.startDate,
          effectiveEndDate
        );
      });
      if (conflict) {
        throw new ConvexError({
          code: "CONFLICT",
          message: `Cannot approve: overlaps with another approved loan (${conflict.startDate} to ${conflict.endDate}).`,
        });
      }
    }

    const now = Date.now();
    const lenderResponseNote = sanitizeOptionalNote(
      args.lenderResponseNote,
      "Response note",
      300
    );
    const eventType =
      nextStatus === "approved" ? "loan_approved" : "loan_declined";
    const summary =
      nextStatus === "approved"
        ? "Approval notification queued"
        : "Decline notification queued";

    await ctx.db.patch(loan._id, {
      status: nextStatus,
      lenderResponseNote,
      approvedAt: nextStatus === "approved" ? now : loan.approvedAt,
      lastAutomationSummary: summary,
      lastAutomationAt: now,
      updatedAt: now,
    });

    const idempotencyKey = `${eventType}:${loan._id}:${now}`;
    await ctx.db.insert("automationEvents", {
      idempotencyKey,
      loanId: loan._id,
      direction: "outbound_to_n8n",
      eventType,
      status: "pending",
      attemptCount: 0,
      summary,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.automation.dispatchLoanWebhook, {
      loanId: loan._id,
      eventType,
      idempotencyKey,
    });

    return { ok: true, status: nextStatus };
  },
});

export const cancelBorrowRequest = mutation({
  args: {
    loanId: v.id("loans"),
  },
  handler: async (ctx, args) => {
    const borrower = await requireAuth(ctx);
    const loan = await ctx.db.get(args.loanId);
    if (!loan) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Loan request not found.",
      });
    }
    assertOwnership(
      loan.borrowerId,
      borrower._id,
      "Only the borrower can cancel this request."
    );
    if (!canTransitionLoanStatus(loan.status, "declined")) {
      throw new ConvexError({
        code: "CONFLICT",
        message: `Cannot cancel a request whose status is '${loan.status}'.`,
      });
    }

    const now = Date.now();
    await ctx.db.patch(loan._id, {
      status: "declined",
      lenderResponseNote: "Cancelled by borrower",
      updatedAt: now,
    });

    return { ok: true };
  },
});

export const markReturned = mutation({
  args: {
    loanId: v.id("loans"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const loan = await ctx.db.get(args.loanId);
    if (!loan) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Loan not found.",
      });
    }
    if (loan.ownerId !== user._id && user.role !== "admin") {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only the tool owner or an admin can mark a loan returned.",
      });
    }
    if (!canTransitionLoanStatus(loan.status, "returned")) {
      throw new ConvexError({
        code: "CONFLICT",
        message: `Cannot mark returned from status '${loan.status}'.`,
      });
    }

    const now = Date.now();
    await ctx.db.patch(loan._id, {
      status: "returned",
      returnedAt: now,
      lastAutomationSummary: "Return confirmation queued",
      lastAutomationAt: now,
      updatedAt: now,
    });

    if (user.role === "admin" && loan.ownerId !== user._id) {
      await ctx.db.insert("securityAuditLogs", {
        actorUserId: user._id,
        actorRole: user.role,
        action: "admin_mark_loan_returned",
        targetTable: "loans",
        targetId: loan._id,
        metadata: JSON.stringify({ ownerId: loan.ownerId }),
        createdAt: now,
      });
    }

    const idempotencyKey = `loan_returned:${loan._id}:${now}`;
    await ctx.db.insert("automationEvents", {
      idempotencyKey,
      loanId: loan._id,
      direction: "outbound_to_n8n",
      eventType: "loan_returned",
      status: "pending",
      attemptCount: 0,
      summary: "Return confirmation queued",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.automation.dispatchLoanWebhook, {
      loanId: loan._id,
      eventType: "loan_returned",
      idempotencyKey,
    });

    return { ok: true };
  },
});

export const listMyRequests = query({
  args: {},
  handler: async (ctx) => {
    const borrower = await requireAuth(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrowerId", (q) => q.eq("borrowerId", borrower._id))
      .collect();
    return await enrichLoans(ctx, loans, { includeEmails: false });
  },
});

export const listIncomingRequests = query({
  args: {},
  handler: async (ctx) => {
    const owner = await requireAuth(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", owner._id))
      .collect();
    return await enrichLoans(ctx, loans, { includeEmails: false });
  },
});

export const listAllLoansForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const loans = await ctx.db.query("loans").collect();
    const enrichedLoans = await enrichLoans(ctx, loans, { includeEmails: true });
    const recentEvents = await ctx.db
      .query("automationEvents")
      .withIndex("by_createdAt")
      .order("desc")
      .take(30);

    return {
      loans: enrichedLoans,
      automationEvents: recentEvents,
    };
  },
});
