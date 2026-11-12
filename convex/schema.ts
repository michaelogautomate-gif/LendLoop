import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const toolCategories = v.union(
  v.literal("power_tools"),
  v.literal("garden"),
  v.literal("kitchen"),
  v.literal("camping"),
  v.literal("automotive"),
  v.literal("cleaning"),
  v.literal("other")
);

export const toolConditions = v.union(
  v.literal("new"),
  v.literal("excellent"),
  v.literal("good"),
  v.literal("fair")
);

export const userRoles = v.union(v.literal("user"), v.literal("admin"));

export const loanStatuses = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("returned")
);

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    email: v.string(),
    name: v.string(),
    role: userRoles,
    isTrustedLender: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_clerkId", ["clerkId"])
    .index("by_email", ["email"])
    .index("by_role", ["role"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: toolCategories,
    condition: toolConditions,
    description: v.string(),
    isAvailable: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_ownerId", ["ownerId"])
    .index("by_category", ["category"])
    .index("by_available_category", ["isAvailable", "category"]),

  loans: defineTable({
    toolId: v.id("tools"),
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(), // Strict YYYY-MM-DD (UTC)
    endDate: v.string(), // Strict YYYY-MM-DD (UTC)
    status: loanStatuses,
    borrowerNote: v.optional(v.string()),
    lenderResponseNote: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
    lastReminderSentAt: v.optional(v.number()),
    lastReminderDateKey: v.optional(v.string()), // e.g. "2026-11-11"
    reminderCount: v.number(),
    lastAutomationSummary: v.optional(v.string()),
    lastAutomationAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_toolId", ["toolId"])
    .index("by_toolId_status", ["toolId", "status"])
    .index("by_ownerId", ["ownerId"])
    .index("by_borrowerId", ["borrowerId"])
    .index("by_status", ["status"])
    .index("by_status_endDate", ["status", "endDate"]),

  automationEvents: defineTable({
    idempotencyKey: v.string(),
    loanId: v.optional(v.id("loans")),
    direction: v.union(
      v.literal("outbound_to_n8n"),
      v.literal("inbound_from_n8n")
    ),
    eventType: v.union(
      v.literal("loan_requested"),
      v.literal("loan_approved"),
      v.literal("loan_declined"),
      v.literal("loan_returned"),
      v.literal("overdue_reminder_sent"),
      v.literal("workflow_error")
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("delivered"),
      v.literal("failed")
    ),
    attemptCount: v.number(),
    summary: v.string(),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_loanId", ["loanId"])
    .index("by_createdAt", ["createdAt"]),

  securityAuditLogs: defineTable({
    actorUserId: v.optional(v.id("users")),
    actorRole: v.string(),
    action: v.string(),
    targetTable: v.string(),
    targetId: v.string(),
    metadata: v.string(), // Sanitized JSON string
    createdAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),
});
