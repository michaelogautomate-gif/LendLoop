import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { buildSignedHeaders } from "./lib/crypto";
import {
  buildOverdueIdempotencyKey,
  computeDaysOverdue,
  getTodayUtcIso,
  isValidIsoDate,
} from "./lib/dates";
import { sanitizeOperationalText } from "./lib/sanitize";

const MAX_WEBHOOK_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractFirstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0];
  return first || "Neighbor";
}

function formatOutboundSummary(eventType: string): string {
  switch (eventType) {
    case "loan_requested":
      return "Borrow request notification delivered";
    case "loan_approved":
      return "Approval notification delivered";
    case "loan_declined":
      return "Decline notification delivered";
    case "loan_returned":
      return "Return confirmation delivered";
    default:
      return "Notification delivered";
  }
}

/**
 * Returns strictly minimal fields required by the n8n Request Notification workflow.
 * Never exposes clerkId, user roles, borrower/lender notes, or full database rows.
 */
export const getOutboundWebhookPayload = internalQuery({
  args: {
    loanId: v.id("loans"),
    eventType: v.string(),
    idempotencyKey: v.string(),
    toolNameOverride: v.optional(v.string()),
    toolCategoryOverride: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const loan = await ctx.db.get(args.loanId);
    if (!loan) return null;

    const [tool, owner, borrower] = await Promise.all([
      ctx.db.get(loan.toolId),
      ctx.db.get(loan.ownerId),
      ctx.db.get(loan.borrowerId),
    ]);

    if (!owner || !borrower) return null;

    const notifyOwner = args.eventType === "loan_requested";
    const recipient = notifyOwner ? owner : borrower;

    return {
      eventId: args.idempotencyKey,
      eventType: args.eventType,
      loanId: loan._id,
      toolName: tool?.name ?? args.toolNameOverride ?? "Tool",
      toolCategory: tool?.category ?? args.toolCategoryOverride ?? "other",
      status: loan.status,
      startDate: loan.startDate,
      endDate: loan.endDate,
      recipientEmail: recipient.email,
      recipientFirstName: extractFirstName(recipient.name),
    };
  },
});

export const recordOutboundDispatchResult = internalMutation({
  args: {
    loanId: v.id("loans"),
    idempotencyKey: v.string(),
    eventType: v.union(
      v.literal("loan_requested"),
      v.literal("loan_approved"),
      v.literal("loan_declined"),
      v.literal("loan_returned")
    ),
    status: v.union(v.literal("delivered"), v.literal("failed")),
    attemptCount: v.number(),
    summary: v.string(),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const safeSummary = sanitizeOperationalText(args.summary, 140);
    const safeError = args.errorMessage
      ? sanitizeOperationalText(args.errorMessage, 300)
      : undefined;

    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_idempotencyKey", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        attemptCount: args.attemptCount,
        summary: safeSummary,
        errorMessage: safeError,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("automationEvents", {
        idempotencyKey: args.idempotencyKey,
        loanId: args.loanId,
        direction: "outbound_to_n8n",
        eventType: args.eventType,
        status: args.status,
        attemptCount: args.attemptCount,
        summary: safeSummary,
        errorMessage: safeError,
        createdAt: now,
        updatedAt: now,
      });
    }

    const loan = await ctx.db.get(args.loanId);
    if (loan) {
      await ctx.db.patch(loan._id, {
        lastAutomationSummary: safeSummary,
        lastAutomationAt: now,
      });
    }
  },
});

export const dispatchLoanWebhook = internalAction({
  args: {
    loanId: v.id("loans"),
    eventType: v.union(
      v.literal("loan_requested"),
      v.literal("loan_approved"),
      v.literal("loan_declined"),
      v.literal("loan_returned")
    ),
    idempotencyKey: v.string(),
    toolNameOverride: v.optional(v.string()),
    toolCategoryOverride: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const payload = await ctx.runQuery(
      internal.automation.getOutboundWebhookPayload,
      {
        loanId: args.loanId,
        eventType: args.eventType,
        idempotencyKey: args.idempotencyKey,
        toolNameOverride: args.toolNameOverride,
        toolCategoryOverride: args.toolCategoryOverride,
      }
    );

    if (!payload) {
      return { skipped: true };
    }

    const webhookUrl = process.env.N8N_LOAN_EVENT_WEBHOOK_URL;
    const webhookSecret = process.env.N8N_WEBHOOK_SECRET;

    if (!webhookUrl || !webhookSecret) {
      await ctx.runMutation(internal.automation.recordOutboundDispatchResult, {
        loanId: args.loanId,
        idempotencyKey: args.idempotencyKey,
        eventType: args.eventType,
        status: "failed",
        attemptCount: 0,
        summary: "Notification failed (logged)",
        errorMessage:
          "Missing N8N_LOAN_EVENT_WEBHOOK_URL or N8N_WEBHOOK_SECRET in Convex env.",
      });
      return { ok: false, reason: "missing_env" };
    }

    const rawBody = JSON.stringify(payload);
    let lastError = "Unknown webhook delivery failure";

    for (let attempt = 1; attempt <= MAX_WEBHOOK_ATTEMPTS; attempt += 1) {
      try {
        const headers = await buildSignedHeaders(
          webhookSecret,
          rawBody,
          payload.eventId
        );

        const response = await fetch(webhookUrl, {
          method: "POST",
          headers,
          body: rawBody,
        });

        if (response.ok) {
          await ctx.runMutation(
            internal.automation.recordOutboundDispatchResult,
            {
              loanId: args.loanId,
              idempotencyKey: args.idempotencyKey,
              eventType: args.eventType,
              status: "delivered",
              attemptCount: attempt,
              summary: formatOutboundSummary(args.eventType),
            }
          );
          return { ok: true, attempt };
        }

        lastError = `n8n webhook returned HTTP ${response.status}`;
        if (
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 429
        ) {
          break;
        }
      } catch (err) {
        lastError =
          err instanceof Error ? err.message : "Network error calling n8n";
      }

      if (attempt < MAX_WEBHOOK_ATTEMPTS) {
        await sleep(BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1));
      }
    }

    await ctx.runMutation(internal.automation.recordOutboundDispatchResult, {
      loanId: args.loanId,
      idempotencyKey: args.idempotencyKey,
      eventType: args.eventType,
      status: "failed",
      attemptCount: MAX_WEBHOOK_ATTEMPTS,
      summary: "Notification failed (logged)",
      errorMessage: lastError,
    });

    return { ok: false, error: lastError };
  },
});

/**
 * Returns currently overdue approved loans (endDate < UTC today) that have not
 * already been reminded today, projected with strictly minimal notification fields.
 */
export const getOverdueLoansInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const dateKey = getTodayUtcIso();
    const candidates = await ctx.db
      .query("loans")
      .withIndex("by_status_endDate", (q) =>
        q.eq("status", "approved").lt("endDate", dateKey)
      )
      .collect();

    const overdueLoans = [];

    for (const loan of candidates) {
      const idempotencyKey = buildOverdueIdempotencyKey(loan._id, dateKey);
      const deliveredEvent = await ctx.db
        .query("automationEvents")
        .withIndex("by_idempotencyKey", (q) =>
          q.eq("idempotencyKey", idempotencyKey)
        )
        .unique();

      const alreadyRemindedToday =
        loan.lastReminderDateKey === dateKey ||
        deliveredEvent?.status === "delivered";

      if (alreadyRemindedToday) {
        continue;
      }

      const [tool, borrower] = await Promise.all([
        ctx.db.get(loan.toolId),
        ctx.db.get(loan.borrowerId),
      ]);

      if (!borrower) continue;

      overdueLoans.push({
        loanId: loan._id,
        toolName: tool?.name ?? "Borrowed Tool",
        startDate: loan.startDate,
        endDate: loan.endDate,
        daysOverdue: computeDaysOverdue(loan.endDate, dateKey),
        borrowerEmail: borrower.email,
        borrowerFirstName: extractFirstName(borrower.name),
        alreadyRemindedToday: false,
      });
    }

    return {
      dateKey,
      overdueLoans,
    };
  },
});

/**
 * Idempotent write-back from n8n after sending an overdue reminder.
 * Retries with the same idempotencyKey return { ok: true, deduplicated: true }
 * without incrementing reminderCount or creating duplicate automationEvents rows.
 */
export const recordOverdueReminderInternal = internalMutation({
  args: {
    idempotencyKey: v.string(),
    loanId: v.string(),
    dateKey: v.string(),
    channel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!isValidIsoDate(args.dateKey)) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "dateKey must be a valid YYYY-MM-DD calendar date.",
      });
    }

    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_idempotencyKey", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey)
      )
      .unique();

    if (existing && existing.status === "delivered") {
      return {
        ok: true,
        deduplicated: true,
      };
    }

    const normalizedLoanId = ctx.db.normalizeId("loans", args.loanId);
    if (!normalizedLoanId) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Loan not found.",
      });
    }

    const loan = await ctx.db.get(normalizedLoanId);
    if (!loan) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Loan not found.",
      });
    }

    if (loan.status !== "approved" || loan.endDate >= args.dateKey) {
      return {
        ok: false,
        deduplicated: false,
        skippedReason:
          loan.status !== "approved"
            ? `Loan is not active (status=${loan.status})`
            : `Loan is not overdue for dateKey=${args.dateKey} (endDate=${loan.endDate})`,
      };
    }

    const now = Date.now();
    const summary = "Overdue reminder sent";

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "delivered",
        attemptCount: existing.attemptCount + 1,
        summary,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("automationEvents", {
        idempotencyKey: args.idempotencyKey,
        loanId: loan._id,
        direction: "inbound_from_n8n",
        eventType: "overdue_reminder_sent",
        status: "delivered",
        attemptCount: 1,
        summary,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.patch(loan._id, {
      lastReminderSentAt: now,
      lastReminderDateKey: args.dateKey,
      reminderCount: loan.reminderCount + 1,
      lastAutomationSummary: summary,
      lastAutomationAt: now,
      updatedAt: now,
    });

    return {
      ok: true,
      deduplicated: false,
    };
  },
});

export const recordEventAckInternal = internalMutation({
  args: {
    idempotencyKey: v.string(),
    loanId: v.optional(v.string()),
    status: v.union(v.literal("delivered"), v.literal("failed")),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_idempotencyKey", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey)
      )
      .unique();

    const safeSummary = sanitizeOperationalText(
      args.summary ||
        (args.status === "delivered"
          ? "Notification delivered"
          : "Notification failed (logged)"),
      140
    );

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        summary: safeSummary,
        updatedAt: now,
      });
    }

    const validLoanId = args.loanId
      ? ctx.db.normalizeId("loans", args.loanId)
      : existing?.loanId ?? null;

    if (validLoanId) {
      const loan = await ctx.db.get(validLoanId);
      if (loan) {
        await ctx.db.patch(loan._id, {
          lastAutomationSummary: safeSummary,
          lastAutomationAt: now,
        });
      }
    }

    return { ok: true };
  },
});

export const recordWorkflowErrorInternal = internalMutation({
  args: {
    idempotencyKey: v.string(),
    workflowName: v.string(),
    errorMessage: v.string(),
    loanId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_idempotencyKey", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey)
      )
      .unique();

    if (existing) {
      return { ok: true, deduplicated: true };
    }

    const now = Date.now();
    const safeWorkflow = sanitizeOperationalText(args.workflowName, 80);
    const safeError = sanitizeOperationalText(args.errorMessage, 300);
    const validLoanId = args.loanId
      ? ctx.db.normalizeId("loans", args.loanId)
      : null;

    const eventId = await ctx.db.insert("automationEvents", {
      idempotencyKey: args.idempotencyKey,
      loanId: validLoanId ?? undefined,
      direction: "inbound_from_n8n",
      eventType: "workflow_error",
      status: "failed",
      attemptCount: 1,
      summary: `Workflow error: ${safeWorkflow}`,
      errorMessage: safeError,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("securityAuditLogs", {
      actorRole: "n8n_automation",
      action: "workflow_error_callback",
      targetTable: "automationEvents",
      targetId: eventId,
      metadata: JSON.stringify({
        workflowName: safeWorkflow,
        loanId: validLoanId,
      }),
      createdAt: now,
    });

    if (validLoanId) {
      const loan = await ctx.db.get(validLoanId);
      if (loan) {
        await ctx.db.patch(loan._id, {
          lastAutomationSummary: "Automation error (logged)",
          lastAutomationAt: now,
        });
      }
    }

    return { ok: true, deduplicated: false };
  },
});
