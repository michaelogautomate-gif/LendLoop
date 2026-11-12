import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { assertOwnership, requireAdmin, requireAuth } from "./lib/auth";
import { getTodayUtcIso } from "./lib/dates";
import {
  sanitizeMultiLine,
  sanitizeOptionalNote,
  sanitizeSingleLine,
} from "./lib/sanitize";
import { toolCategories, toolConditions } from "./schema";

async function isToolOnLoanToday(
  ctx: QueryCtx,
  toolId: Id<"tools">,
  todayIso: string
): Promise<boolean> {
  const approvedLoans = await ctx.db
    .query("loans")
    .withIndex("by_toolId_status", (q) =>
      q.eq("toolId", toolId).eq("status", "approved")
    )
    .collect();
  // Any approved (unreturned) loan whose startDate is on or before today means
  // the tool is currently out on loan (including overdue unreturned loans).
  return approvedLoans.some((loan) => loan.startDate <= todayIso);
}

function resolveAvailabilityStatus(
  tool: Doc<"tools">,
  onLoanToday: boolean
): "available" | "on_loan" | "unavailable" {
  if (!tool.isAvailable) return "unavailable";
  if (onLoanToday) return "on_loan";
  return "available";
}

function extractFirstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0];
  return first || "Neighbor";
}

/**
 * PUBLIC READ-ONLY CATALOG:
 * Enforces strict server-side data minimization.
 * Returns ONLY { _id, name, category } for tools currently available.
 * Never returns ownerId, owner names, descriptions, condition, or timestamps.
 */
export const listPublicCatalog = query({
  args: {},
  handler: async (ctx) => {
    const todayIso = getTodayUtcIso();
    const availableCandidates = await ctx.db
      .query("tools")
      .withIndex("by_available_category", (q) => q.eq("isAvailable", true))
      .collect();

    const results: Array<{
      _id: Id<"tools">;
      name: string;
      category: Doc<"tools">["category"];
    }> = [];

    for (const tool of availableCandidates) {
      const onLoan = await isToolOnLoanToday(ctx, tool._id, todayIso);
      if (onLoan) continue;
      results.push({
        _id: tool._id,
        name: tool.name,
        category: tool.category,
      });
    }

    return results.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * AUTHENTICATED BOARD CATALOG:
 * Supports optional category filter, returns tool details + owner's firstName
 * + isTrustedLender badge + computed availability status. Never exposes email or clerkId.
 */
export const listAuthenticatedCatalog = query({
  args: {
    category: v.optional(toolCategories),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireAuth(ctx);
    const todayIso = getTodayUtcIso();

    const tools = args.category
      ? await ctx.db
          .query("tools")
          .withIndex("by_category", (q) => q.eq("category", args.category!))
          .collect()
      : await ctx.db.query("tools").collect();

    const ownerCache = new Map<Id<"users">, Doc<"users"> | null>();
    const results = [];

    for (const tool of tools) {
      let owner = ownerCache.get(tool.ownerId);
      if (owner === undefined) {
        owner = await ctx.db.get(tool.ownerId);
        ownerCache.set(tool.ownerId, owner);
      }

      const onLoanToday = await isToolOnLoanToday(ctx, tool._id, todayIso);
      const availabilityStatus = resolveAvailabilityStatus(tool, onLoanToday);
      const ownerDisplayName = owner?.name ?? "Neighbor";

      results.push({
        _id: tool._id,
        name: tool.name,
        category: tool.category,
        condition: tool.condition,
        description: tool.description,
        isAvailable: tool.isAvailable,
        availabilityStatus,
        isOwner: tool.ownerId === currentUser._id,
        ownerId: tool.ownerId,
        firstName: extractFirstName(ownerDisplayName),
        ownerName: ownerDisplayName,
        isTrustedLender: owner?.isTrustedLender ?? false,
        createdAt: tool.createdAt,
      });
    }

    return results.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const listMyTools = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    const todayIso = getTodayUtcIso();
    const ownedTools = await ctx.db
      .query("tools")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", user._id))
      .collect();

    const results = [];
    for (const tool of ownedTools) {
      const loans = await ctx.db
        .query("loans")
        .withIndex("by_toolId", (q) => q.eq("toolId", tool._id))
        .collect();
      const pendingCount = loans.filter((l) => l.status === "pending").length;
      const activeApprovedCount = loans.filter(
        (l) => l.status === "approved"
      ).length;
      const onLoanToday = loans.some(
        (l) => l.status === "approved" && l.startDate <= todayIso
      );

      results.push({
        _id: tool._id,
        name: tool.name,
        category: tool.category,
        condition: tool.condition,
        description: tool.description,
        isAvailable: tool.isAvailable,
        availabilityStatus: resolveAvailabilityStatus(tool, onLoanToday),
        pendingCount,
        activeApprovedCount,
        createdAt: tool.createdAt,
      });
    }

    return results.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const createTool = mutation({
  args: {
    name: v.string(),
    category: toolCategories,
    condition: toolConditions,
    description: v.string(),
    isAvailable: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const name = sanitizeSingleLine(args.name, {
      field: "Tool name",
      minLength: 2,
      maxLength: 80,
    });
    const description = sanitizeMultiLine(args.description, {
      field: "Description",
      minLength: 5,
      maxLength: 500,
    });
    const now = Date.now();
    return await ctx.db.insert("tools", {
      ownerId: user._id,
      name,
      category: args.category,
      condition: args.condition,
      description,
      isAvailable: args.isAvailable ?? true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateTool = mutation({
  args: {
    toolId: v.id("tools"),
    name: v.string(),
    category: toolCategories,
    condition: toolConditions,
    description: v.string(),
    isAvailable: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Tool listing not found.",
      });
    }
    assertOwnership(
      tool.ownerId,
      user._id,
      "You can only edit your own tool listings."
    );

    const name = sanitizeSingleLine(args.name, {
      field: "Tool name",
      minLength: 2,
      maxLength: 80,
    });
    const description = sanitizeMultiLine(args.description, {
      field: "Description",
      minLength: 5,
      maxLength: 500,
    });

    await ctx.db.patch(tool._id, {
      name,
      category: args.category,
      condition: args.condition,
      description,
      isAvailable: args.isAvailable,
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});

export const deleteTool = mutation({
  args: {
    toolId: v.id("tools"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Tool listing not found.",
      });
    }
    assertOwnership(
      tool.ownerId,
      user._id,
      "You can only delete your own tool listings."
    );

    const approvedLoans = await ctx.db
      .query("loans")
      .withIndex("by_toolId_status", (q) =>
        q.eq("toolId", tool._id).eq("status", "approved")
      )
      .collect();

    if (approvedLoans.length > 0) {
      throw new ConvexError({
        code: "CONFLICT",
        message:
          "Cannot delete a tool while it has an active approved loan. Mark it returned first.",
      });
    }

    const now = Date.now();
    const pendingLoans = await ctx.db
      .query("loans")
      .withIndex("by_toolId_status", (q) =>
        q.eq("toolId", tool._id).eq("status", "pending")
      )
      .collect();

    for (const loan of pendingLoans) {
      const idempotencyKey = `loan_declined:${loan._id}:${now}`;
      await ctx.db.patch(loan._id, {
        status: "declined",
        lenderResponseNote: "Listing deleted by owner",
        lastAutomationSummary: "Decline notification queued",
        lastAutomationAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("automationEvents", {
        idempotencyKey,
        loanId: loan._id,
        direction: "outbound_to_n8n",
        eventType: "loan_declined",
        status: "pending",
        attemptCount: 0,
        summary: "Decline notification queued (listing deleted)",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.automation.dispatchLoanWebhook,
        {
          loanId: loan._id,
          eventType: "loan_declined",
          idempotencyKey,
          toolNameOverride: tool.name,
          toolCategoryOverride: tool.category,
        }
      );
    }

    await ctx.db.delete(tool._id);
    return { ok: true };
  },
});

export const adminRemoveTool = mutation({
  args: {
    toolId: v.id("tools"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Tool listing not found.",
      });
    }

    const now = Date.now();
    const reason =
      sanitizeOptionalNote(args.reason, "Moderation reason", 200) ??
      "removed_by_admin";

    const pendingLoans = await ctx.db
      .query("loans")
      .withIndex("by_toolId_status", (q) =>
        q.eq("toolId", tool._id).eq("status", "pending")
      )
      .collect();

    const approvedLoans = await ctx.db
      .query("loans")
      .withIndex("by_toolId_status", (q) =>
        q.eq("toolId", tool._id).eq("status", "approved")
      )
      .collect();

    for (const loan of pendingLoans) {
      const idempotencyKey = `loan_declined:${loan._id}:${now}`;
      await ctx.db.patch(loan._id, {
        status: "declined",
        lenderResponseNote: "Listing removed by admin moderation",
        lastAutomationSummary: "Decline notification queued",
        lastAutomationAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("automationEvents", {
        idempotencyKey,
        loanId: loan._id,
        direction: "outbound_to_n8n",
        eventType: "loan_declined",
        status: "pending",
        attemptCount: 0,
        summary: "Decline notification queued (admin moderation)",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.automation.dispatchLoanWebhook,
        {
          loanId: loan._id,
          eventType: "loan_declined",
          idempotencyKey,
          toolNameOverride: tool.name,
          toolCategoryOverride: tool.category,
        }
      );
    }

    for (const loan of approvedLoans) {
      await ctx.db.patch(loan._id, {
        status: "returned",
        returnedAt: now,
        lenderResponseNote: "Listing removed by admin moderation",
        lastAutomationSummary: "Closed by admin moderation",
        lastAutomationAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.delete(tool._id);

    await ctx.db.insert("securityAuditLogs", {
      actorUserId: admin._id,
      actorRole: admin.role,
      action: "admin_remove_tool",
      targetTable: "tools",
      targetId: tool._id,
      metadata: JSON.stringify({
        toolName: tool.name,
        ownerId: tool.ownerId,
        reason,
      }),
      createdAt: now,
    });

    return { ok: true };
  },
});
