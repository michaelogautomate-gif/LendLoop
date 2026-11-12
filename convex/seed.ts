import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { getTodayUtcIso } from "./lib/dates";

function shiftUtcDays(baseIso: string, deltaDays: number): string {
  const baseMs = Date.parse(`${baseIso}T00:00:00Z`);
  return new Date(baseMs + deltaDays * 86_400_000).toISOString().slice(0, 10);
}

async function upsertDemoNeighbor(
  ctx: MutationCtx,
  params: {
    clerkId: string;
    email: string;
    name: string;
    isTrustedLender: boolean;
  }
): Promise<Id<"users">> {
  const existing = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", params.clerkId))
    .unique();
  const now = Date.now();
  if (existing) {
    return existing._id;
  }
  return await ctx.db.insert("users", {
    clerkId: params.clerkId,
    email: params.email,
    name: params.name,
    role: "user",
    isTrustedLender: params.isTrustedLender,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedCoreDemoRecords(
  ctx: MutationCtx,
  borrowerIdForOverdue: Id<"users"> | null
) {
  const now = Date.now();
  const todayIso = getTodayUtcIso(now);

  const alexId = await upsertDemoNeighbor(ctx, {
    clerkId: "demo_neighbor_alex",
    email: "alex.neighbor@lendloop.local",
    name: "Alex Rivera",
    isTrustedLender: true,
  });

  const samId = await upsertDemoNeighbor(ctx, {
    clerkId: "demo_neighbor_sam",
    email: "sam.neighbor@lendloop.local",
    name: "Sam Patel",
    isTrustedLender: false,
  });

  const existingTools = await ctx.db.query("tools").collect();
  const byName = new Map(existingTools.map((t) => [t.name, t._id]));

  const catalog = [
    {
      ownerId: alexId,
      name: "DeWalt 20V Cordless Drill",
      category: "power_tools" as const,
      condition: "excellent" as const,
      description:
        "Includes two 2Ah batteries, charger, and 20-piece driver bit kit.",
    },
    {
      ownerId: alexId,
      name: "Bosch Electric Pressure Washer",
      category: "cleaning" as const,
      condition: "good" as const,
      description:
        "2030 PSI electric washer with 20ft hose; ideal for driveways and patios.",
    },
    {
      ownerId: samId,
      name: "KitchenAid Stand Mixer (5 Qt)",
      category: "kitchen" as const,
      condition: "new" as const,
      description:
        "Includes flat beater, dough hook, and wire whip attachments.",
    },
    {
      ownerId: samId,
      name: "REI 4-Person Dome Tent",
      category: "camping" as const,
      condition: "good" as const,
      description:
        "Waterproof rainfly, aluminum poles, and footprint tarp included.",
    },
    {
      ownerId: alexId,
      name: "Fiskars Telescoping Pole Saw",
      category: "garden" as const,
      condition: "good" as const,
      description: "Extends up to 14 ft for clean tree limb trimming.",
    },
    {
      ownerId: samId,
      name: "OBD2 Car Diagnostic Scanner",
      category: "automotive" as const,
      condition: "excellent" as const,
      description: "Reads check-engine fault codes and live sensor data.",
    },
  ];

  let createdTools = 0;
  for (const item of catalog) {
    if (!byName.has(item.name)) {
      const toolId = await ctx.db.insert("tools", {
        ownerId: item.ownerId,
        name: item.name,
        category: item.category,
        condition: item.condition,
        description: item.description,
        isAvailable: true,
        createdAt: now,
        updatedAt: now,
      });
      byName.set(item.name, toolId);
      createdTools += 1;
    }
  }

  let createdOverdueLoan = false;
  let createdActiveLoan = false;
  const washerId = byName.get("Bosch Electric Pressure Washer");
  const drillId = byName.get("DeWalt 20V Cordless Drill");
  const targetBorrower = borrowerIdForOverdue ?? samId;

  if (washerId && targetBorrower !== alexId) {
    const existingWasherLoans = await ctx.db
      .query("loans")
      .withIndex("by_toolId_status", (q) =>
        q.eq("toolId", washerId).eq("status", "approved")
      )
      .collect();

    if (existingWasherLoans.length === 0) {
      await ctx.db.insert("loans", {
        toolId: washerId,
        ownerId: alexId,
        borrowerId: targetBorrower,
        startDate: shiftUtcDays(todayIso, -5),
        endDate: shiftUtcDays(todayIso, -2),
        status: "approved",
        borrowerNote: "Demo overdue loan for testing daily n8n reminders.",
        approvedAt: now - 5 * 86_400_000,
        reminderCount: 0,
        lastAutomationSummary: "Overdue loan ready for n8n reminder run",
        lastAutomationAt: now,
        createdAt: now - 5 * 86_400_000,
        updatedAt: now,
      });
      createdOverdueLoan = true;
    }
  }

  if (drillId && targetBorrower !== alexId) {
    const existingDrillLoans = await ctx.db
      .query("loans")
      .withIndex("by_toolId_status", (q) =>
        q.eq("toolId", drillId).eq("status", "approved")
      )
      .collect();

    if (existingDrillLoans.length === 0) {
      await ctx.db.insert("loans", {
        toolId: drillId,
        ownerId: alexId,
        borrowerId: targetBorrower,
        startDate: todayIso,
        endDate: shiftUtcDays(todayIso, 3),
        status: "approved",
        borrowerNote: "Building bookshelf this week.",
        approvedAt: now,
        reminderCount: 0,
        lastAutomationSummary: "Approval notification delivered",
        lastAutomationAt: now,
        createdAt: now,
        updatedAt: now,
      });
      createdActiveLoan = true;
    }
  }

  return {
    createdTools,
    createdOverdueLoan,
    createdActiveLoan,
  };
}

/**
 * CLI-runnable seed script (`npx convex run seed:seedDemoData`).
 */
export const seedDemoData = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await seedCoreDemoRecords(ctx, null);
  },
});

/**
 * Protected dev/admin demo seeder. Requires authentication and either
 * admin role or ALLOW_DEMO_SEED=true in Convex environment variables.
 */
export const seedDemoForCurrentUser = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    if (user.role !== "admin" && process.env.ALLOW_DEMO_SEED !== "true") {
      throw new ConvexError({
        code: "FORBIDDEN",
        message:
          "Demo seeding requires admin privileges or ALLOW_DEMO_SEED=true.",
      });
    }
    return await seedCoreDemoRecords(ctx, user._id);
  },
});
