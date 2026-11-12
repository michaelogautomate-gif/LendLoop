import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

const modules = import.meta.glob("../../convex/**/*.*s");

function createBackend() {
  return convexTest(schema, modules);
}

describe("Phase 2: Server-Side RBAC & Data Minimization", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.ADMIN_BOOTSTRAP_EMAIL = "admin@lendloop.test";
  });

  afterEach(async () => {
    vi.useRealTimers();
    delete process.env.ADMIN_BOOTSTRAP_EMAIL;
  });

  it("1. listPublicCatalog returns strictly {_id, name, category} for available tools only", async () => {
    const t = createBackend();
    const alice = t.withIdentity({
      subject: "clerk_alice",
      name: "Alice Lender",
      email: "alice@lendloop.test",
      emailVerified: true,
    });
    const bob = t.withIdentity({
      subject: "clerk_bob",
      name: "Bob Borrower",
      email: "bob@lendloop.test",
      emailVerified: true,
    });

    await alice.mutation(api.users.ensureCurrentUser, {});
    await bob.mutation(api.users.ensureCurrentUser, {});

    const availableId = await alice.mutation(api.tools.createTool, {
      name: "DeWalt 20V Drill",
      category: "power_tools",
      condition: "excellent",
      description: "Private neighbor note: pickup on side porch.",
      isAvailable: true,
    });
    await alice.mutation(api.tools.createTool, {
      name: "Paused Lawn Mower",
      category: "garden",
      condition: "good",
      description: "Needs blade sharpening.",
      isAvailable: false,
    });
    const loanedId = await alice.mutation(api.tools.createTool, {
      name: "Camping Stove",
      category: "camping",
      condition: "new",
      description: "Two-burner propane stove.",
      isAvailable: true,
    });

    // Borrow and approve Camping Stove starting today so it is actively on loan
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const loanId = await bob.mutation(api.loans.requestBorrow, {
      toolId: loanedId,
      startDate: today,
      endDate: tomorrow,
    });
    await alice.mutation(api.loans.respondToRequest, {
      loanId,
      decision: "approve",
    });

    // Also create a tool with an overdue unreturned ("approved") loan (endDate in the past)
    const overdueToolId = await alice.mutation(api.tools.createTool, {
      name: "Overdue Pressure Washer",
      category: "cleaning",
      condition: "good",
      description: "2000 PSI electric washer.",
      isAvailable: true,
    });
    const overdueLoanId = await bob.mutation(api.loans.requestBorrow, {
      toolId: overdueToolId,
      startDate: today,
      endDate: tomorrow,
    });
    await alice.mutation(api.loans.respondToRequest, {
      loanId: overdueLoanId,
      decision: "approve",
    });
    const fourDaysAgo = new Date(Date.now() - 4 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await t.run(async (ctx) => {
      await ctx.db.patch(overdueLoanId, {
        startDate: fourDaysAgo,
        endDate: twoDaysAgo,
      });
    });

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Unauthenticated public query must exclude both active today and overdue unreturned tools
    const publicCatalog = await t.query(api.tools.listPublicCatalog, {});
    expect(publicCatalog).toHaveLength(1);
    expect(publicCatalog[0]).toEqual({
      _id: availableId,
      name: "DeWalt 20V Drill",
      category: "power_tools",
    });

    const record = publicCatalog[0] as Record<string, unknown>;
    expect(Object.keys(record).sort()).toEqual(["_id", "category", "name"]);
    expect(record.ownerId).toBeUndefined();
    expect(record.description).toBeUndefined();
    expect(record.condition).toBeUndefined();
    expect(record.isAvailable).toBeUndefined();
  });

  it("2. rejects unauthenticated callers on protected queries and mutations", async () => {
    const t = createBackend();

    await expect(
      t.mutation(api.tools.createTool, {
        name: "Hammer",
        category: "other",
        condition: "good",
        description: "Basic steel claw hammer.",
      })
    ).rejects.toThrow(/Authentication required/i);

    await expect(
      t.query(api.tools.listAuthenticatedCatalog, {})
    ).rejects.toThrow(/Authentication required/i);

    await expect(
      t.query(api.loans.listAllLoansForAdmin, {})
    ).rejects.toThrow(/Authentication required/i);

    await expect(
      t.query(api.users.listUsersForAdmin, {})
    ).rejects.toThrow(/Authentication required/i);
  });

  it("3. prevents regular users from editing or deleting another user's tool", async () => {
    const t = createBackend();
    const alice = t.withIdentity({
      subject: "clerk_alice",
      name: "Alice Lender",
      email: "alice@lendloop.test",
      emailVerified: true,
    });
    const mallory = t.withIdentity({
      subject: "clerk_mallory",
      name: "Mallory",
      email: "mallory@lendloop.test",
      emailVerified: true,
    });

    await alice.mutation(api.users.ensureCurrentUser, {});
    await mallory.mutation(api.users.ensureCurrentUser, {});

    const toolId = await alice.mutation(api.tools.createTool, {
      name: "Orbital Sander",
      category: "power_tools",
      condition: "good",
      description: "Includes 80/120/220 grit discs.",
    });

    await expect(
      mallory.mutation(api.tools.updateTool, {
        toolId,
        name: "Hijacked Sander",
        category: "power_tools",
        condition: "fair",
        description: "Attempted unauthorized edit.",
        isAvailable: false,
      })
    ).rejects.toThrow(/only edit your own/i);

    await expect(
      mallory.mutation(api.tools.deleteTool, { toolId })
    ).rejects.toThrow(/only delete your own/i);
  });

  it("4. blocks regular users from admin endpoints and rejects unverified bootstrap emails", async () => {
    const t = createBackend();

    // Unverified email matching ADMIN_BOOTSTRAP_EMAIL must NOT become admin
    const spoofed = t.withIdentity({
      subject: "clerk_spoof",
      name: "Spoof User",
      email: "admin@lendloop.test",
      emailVerified: false,
    });
    await spoofed.mutation(api.users.ensureCurrentUser, {});
    const spoofedProfile = await spoofed.query(api.users.me, {});
    expect(spoofedProfile?.role).toBe("user");

    const alice = t.withIdentity({
      subject: "clerk_alice",
      name: "Alice",
      email: "alice@lendloop.test",
      emailVerified: true,
    });
    const aliceId = await alice.mutation(api.users.ensureCurrentUser, {});
    const toolId = await alice.mutation(api.tools.createTool, {
      name: "Pressure Washer",
      category: "cleaning",
      condition: "excellent",
      description: "Electric 2000 PSI pressure washer.",
    });

    await expect(
      spoofed.query(api.loans.listAllLoansForAdmin, {})
    ).rejects.toThrow(/Admin privileges required/i);

    await expect(
      spoofed.mutation(api.tools.adminRemoveTool, { toolId })
    ).rejects.toThrow(/Admin privileges required/i);

    await expect(
      spoofed.mutation(api.users.toggleTrustedLender, {
        userId: aliceId,
        isTrustedLender: true,
      })
    ).rejects.toThrow(/Admin privileges required/i);
  });

  it("5. allows verified admin to toggle Trusted Lender, view all loans, remove any tool, and writes audit logs", async () => {
    const t = createBackend();

    const admin = t.withIdentity({
      subject: "clerk_admin",
      name: "Neighborhood Admin",
      email: "admin@lendloop.test",
      emailVerified: true,
    });
    const alice = t.withIdentity({
      subject: "clerk_alice",
      name: "Alice",
      email: "alice@lendloop.test",
      emailVerified: true,
    });
    const bob = t.withIdentity({
      subject: "clerk_bob",
      name: "Bob",
      email: "bob@lendloop.test",
      emailVerified: true,
    });

    await admin.mutation(api.users.ensureCurrentUser, {});
    const aliceId = await alice.mutation(api.users.ensureCurrentUser, {});
    await bob.mutation(api.users.ensureCurrentUser, {});

    const adminProfile = await admin.query(api.users.me, {});
    expect(adminProfile?.role).toBe("admin");

    await admin.mutation(api.users.toggleTrustedLender, {
      userId: aliceId,
      isTrustedLender: true,
    });

    const toolId = await alice.mutation(api.tools.createTool, {
      name: "OBD2 Diagnostic Scanner",
      category: "automotive",
      condition: "new",
      description: "Reads and clears engine codes.",
    });

    const catalog = await bob.query(api.tools.listAuthenticatedCatalog, {
      category: "automotive",
    });
    expect(catalog).toHaveLength(1);
    expect(catalog[0].isTrustedLender).toBe(true);
    expect(catalog[0].firstName).toBe("Alice");
    expect((catalog[0] as Record<string, unknown>).email).toBeUndefined();

    const futureStart = new Date(Date.now() + 86_400_000)
      .toISOString()
      .slice(0, 10);
    const futureEnd = new Date(Date.now() + 2 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await bob.mutation(api.loans.requestBorrow, {
      toolId,
      startDate: futureStart,
      endDate: futureEnd,
    });

    const adminLoans = await admin.query(api.loans.listAllLoansForAdmin, {});
    expect(adminLoans.loans).toHaveLength(1);

    await admin.mutation(api.tools.adminRemoveTool, {
      toolId,
      reason: "Safety recall check",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const remaining = await bob.query(api.tools.listAuthenticatedCatalog, {});
    expect(remaining).toHaveLength(0);

    const auditLogs = await admin.query(
      api.users.listSecurityAuditLogsForAdmin,
      {}
    );
    const actions = auditLogs.map((entry) => entry.action);
    expect(actions).toContain("grant_trusted_lender");
    expect(actions).toContain("admin_remove_tool");
    expect(actions).toContain("bootstrap_admin_created");
  });
});

