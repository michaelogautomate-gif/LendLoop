import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

const modules = import.meta.glob("../../convex/**/*.*s");

function isoOffsetDays(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

describe("Phase 2: Loan Lifecycle, Overlaps & Ownership Guards", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("1. blocks self-borrowing inside requestBorrow", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({
      subject: "clerk_alice",
      name: "Alice Lender",
      email: "alice@lendloop.test",
      emailVerified: true,
    });
    await alice.mutation(api.users.ensureCurrentUser, {});
    const toolId = await alice.mutation(api.tools.createTool, {
      name: "Tile Saw",
      category: "power_tools",
      condition: "good",
      description: "Wet tile saw with diamond blade.",
    });

    await expect(
      alice.mutation(api.loans.requestBorrow, {
        toolId,
        startDate: isoOffsetDays(1),
        endDate: isoOffsetDays(2),
      })
    ).rejects.toThrow(/cannot request to borrow your own tool/i);
  });

  it("2. prevents approving overlapping loans and allows non-overlapping adjacent dates", async () => {
    const t = convexTest(schema, modules);
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
    const carol = t.withIdentity({
      subject: "clerk_carol",
      name: "Carol Borrower",
      email: "carol@lendloop.test",
      emailVerified: true,
    });

    await alice.mutation(api.users.ensureCurrentUser, {});
    await bob.mutation(api.users.ensureCurrentUser, {});
    await carol.mutation(api.users.ensureCurrentUser, {});

    const toolId = await alice.mutation(api.tools.createTool, {
      name: "KitchenAid Mixer",
      category: "kitchen",
      condition: "excellent",
      description: "5Qt stand mixer with dough hook.",
    });

    // Two pending requests with overlapping windows (days 2..5 and days 4..6)
    const bobLoanId = await bob.mutation(api.loans.requestBorrow, {
      toolId,
      startDate: isoOffsetDays(2),
      endDate: isoOffsetDays(5),
    });
    const carolOverlappingId = await carol.mutation(api.loans.requestBorrow, {
      toolId,
      startDate: isoOffsetDays(4),
      endDate: isoOffsetDays(6),
    });

    // Approve Bob's request
    await alice.mutation(api.loans.respondToRequest, {
      loanId: bobLoanId,
      decision: "approve",
    });

    // Approving Carol's overlapping request MUST fail
    await expect(
      alice.mutation(api.loans.respondToRequest, {
        loanId: carolOverlappingId,
        decision: "approve",
      })
    ).rejects.toThrow(/overlaps with another approved loan/i);

    // Owner declines the conflicting pending request so Carol can pick clean dates
    await alice.mutation(api.loans.respondToRequest, {
      loanId: carolOverlappingId,
      decision: "decline",
    });

    // Submitting a brand-new request overlapping Bob's approved dates also fails
    await expect(
      carol.mutation(api.loans.requestBorrow, {
        toolId,
        startDate: isoOffsetDays(5),
        endDate: isoOffsetDays(7),
      })
    ).rejects.toThrow(/overlap with an approved loan/i);

    // Adjacent non-overlapping window (days 6..8, right after Bob's 2..5) succeeds
    const carolAdjacentId = await carol.mutation(api.loans.requestBorrow, {
      toolId,
      startDate: isoOffsetDays(6),
      endDate: isoOffsetDays(8),
    });
    await alice.mutation(api.loans.respondToRequest, {
      loanId: carolAdjacentId,
      decision: "approve",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const incoming = await alice.query(api.loans.listIncomingRequests, {});
    const approvedCount = incoming.filter((l) => l.status === "approved").length;
    expect(approvedCount).toBe(2);
  });

  it("3. enforces strict loan state transitions (pending -> approved -> returned; terminal declined/returned)", async () => {
    const t = convexTest(schema, modules);
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

    await alice.mutation(api.users.ensureCurrentUser, {});
    await bob.mutation(api.users.ensureCurrentUser, {});

    const toolId = await alice.mutation(api.tools.createTool, {
      name: "Hedge Trimmer",
      category: "garden",
      condition: "good",
      description: "Cordless 22-inch hedge trimmer.",
    });

    // Cannot mark pending loan as returned directly
    const loan1 = await bob.mutation(api.loans.requestBorrow, {
      toolId,
      startDate: isoOffsetDays(1),
      endDate: isoOffsetDays(2),
    });
    await expect(
      alice.mutation(api.loans.markReturned, { loanId: loan1 })
    ).rejects.toThrow(/Cannot mark returned from status 'pending'/i);

    // Approve -> Return -> Cannot re-approve or decline returned loan
    await alice.mutation(api.loans.respondToRequest, {
      loanId: loan1,
      decision: "approve",
      lenderResponseNote: "Left on porch.",
    });

    // Owner cannot delete tool while approved loan is still out
    await expect(
      alice.mutation(api.tools.deleteTool, { toolId })
    ).rejects.toThrow(/active approved loan/i);

    await alice.mutation(api.loans.markReturned, { loanId: loan1 });

    await expect(
      alice.mutation(api.loans.respondToRequest, {
        loanId: loan1,
        decision: "approve",
      })
    ).rejects.toThrow(/Cannot approve a loan whose status is 'returned'/i);

    // Declined loan is terminal and cannot be re-approved
    const loan2 = await bob.mutation(api.loans.requestBorrow, {
      toolId,
      startDate: isoOffsetDays(3),
      endDate: isoOffsetDays(4),
    });
    await alice.mutation(api.loans.respondToRequest, {
      loanId: loan2,
      decision: "decline",
    });
    await expect(
      alice.mutation(api.loans.respondToRequest, {
        loanId: loan2,
        decision: "approve",
      })
    ).rejects.toThrow(/Cannot approve a loan whose status is 'declined'/i);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  it("4. blocks non-owners from approving, declining, or marking returned on someone else's tool", async () => {
    const t = convexTest(schema, modules);
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
    const carol = t.withIdentity({
      subject: "clerk_carol",
      name: "Carol",
      email: "carol@lendloop.test",
      emailVerified: true,
    });

    await alice.mutation(api.users.ensureCurrentUser, {});
    await bob.mutation(api.users.ensureCurrentUser, {});
    await carol.mutation(api.users.ensureCurrentUser, {});

    const toolId = await alice.mutation(api.tools.createTool, {
      name: "Roof Rack Cargo Box",
      category: "camping",
      condition: "good",
      description: "16 cu ft rooftop carrier.",
    });

    const loanId = await bob.mutation(api.loans.requestBorrow, {
      toolId,
      startDate: isoOffsetDays(1),
      endDate: isoOffsetDays(3),
    });

    // Neither borrower (Bob) nor unrelated neighbor (Carol) can approve or decline
    await expect(
      bob.mutation(api.loans.respondToRequest, {
        loanId,
        decision: "approve",
      })
    ).rejects.toThrow(/Only the tool owner/i);

    await expect(
      carol.mutation(api.loans.respondToRequest, {
        loanId,
        decision: "decline",
      })
    ).rejects.toThrow(/Only the tool owner/i);

    await alice.mutation(api.loans.respondToRequest, {
      loanId,
      decision: "approve",
    });

    await expect(
      bob.mutation(api.loans.markReturned, { loanId })
    ).rejects.toThrow(/Only the tool owner or an admin/i);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  it("5. blocks double-booking today on a tool whose approved loan is overdue and unreturned", async () => {
    const t = convexTest(schema, modules);
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
    const carol = t.withIdentity({
      subject: "clerk_carol",
      name: "Carol",
      email: "carol@lendloop.test",
      emailVerified: true,
    });

    await alice.mutation(api.users.ensureCurrentUser, {});
    await bob.mutation(api.users.ensureCurrentUser, {});
    await carol.mutation(api.users.ensureCurrentUser, {});

    const toolId = await alice.mutation(api.tools.createTool, {
      name: "Bosch Electric Pressure Washer",
      category: "cleaning",
      condition: "good",
      description: "2000 PSI washer.",
    });

    const loanId = await bob.mutation(api.loans.requestBorrow, {
      toolId,
      startDate: isoOffsetDays(0),
      endDate: isoOffsetDays(1),
    });
    await alice.mutation(api.loans.respondToRequest, {
      loanId,
      decision: "approve",
    });

    // Backdate Bob's loan so it is overdue (endDate = 2 days ago) and still "approved" (unreturned)
    await t.run(async (ctx) => {
      await ctx.db.patch(loanId, {
        startDate: isoOffsetDays(-5),
        endDate: isoOffsetDays(-2),
      });
    });

    await expect(
      carol.mutation(api.loans.requestBorrow, {
        toolId,
        startDate: isoOffsetDays(0),
        endDate: isoOffsetDays(1),
      })
    ).rejects.toThrow(/Dates overlap with an approved loan/i);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });
});
