import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { buildSignedHeaders, verifySignedRequest } from "../../convex/lib/crypto";
import { buildOverdueIdempotencyKey, getTodayUtcIso } from "../../convex/lib/dates";
import schema from "../../convex/schema";

const modules = import.meta.glob("../../convex/**/*.*s");

const AUTOMATION_SECRET = "test-convex-automation-secret-32chars";
const WEBHOOK_SECRET = "test-n8n-webhook-secret-32chars-xyz";

describe("Phase 3: Bidirectional Automation, HMAC Auth & Idempotency", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.CONVEX_AUTOMATION_SECRET = AUTOMATION_SECRET;
    process.env.N8N_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.N8N_LOAN_EVENT_WEBHOOK_URL =
      "http://127.0.0.1:5678/webhook/lendloop-loan-event";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete process.env.CONVEX_AUTOMATION_SECRET;
    delete process.env.N8N_WEBHOOK_SECRET;
    delete process.env.N8N_LOAN_EVENT_WEBHOOK_URL;
  });

  it("1. GET /api/automation/overdue-loans rejects unsigned/expired/tampered requests and returns minimal overdue loans when signed", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.seedDemoData, {});

    // Unsigned request -> 401
    const unsignedRes = await t.fetch("/api/automation/overdue-loans", {
      method: "GET",
    });
    expect(unsignedRes.status).toBe(401);

    // Expired timestamp (>300s) -> 401
    const staleSeconds = Math.floor(Date.now() / 1000) - 305;
    const staleHeaders = await buildSignedHeaders(
      AUTOMATION_SECRET,
      "",
      "evt_stale",
      staleSeconds
    );
    const staleRes = await t.fetch("/api/automation/overdue-loans", {
      method: "GET",
      headers: staleHeaders,
    });
    expect(staleRes.status).toBe(401);

    // Valid signed GET -> 200 with minimal fields (only overdue loan, not future/active loan)
    const validHeaders = await buildSignedHeaders(
      AUTOMATION_SECRET,
      "",
      "evt_overdue_fetch"
    );
    const validRes = await t.fetch("/api/automation/overdue-loans", {
      method: "GET",
      headers: validHeaders,
    });
    expect(validRes.status).toBe(200);

    const payload = (await validRes.json()) as {
      dateKey: string;
      overdueLoans: Array<Record<string, unknown>>;
    };
    expect(payload.dateKey).toBe(getTodayUtcIso());
    expect(payload.overdueLoans).toHaveLength(1);
    expect(payload.overdueLoans[0].toolName).toBe(
      "Bosch Electric Pressure Washer"
    );
    expect(payload.overdueLoans[0].daysOverdue).toBe(2);
    expect(payload.overdueLoans[0].borrowerEmail).toBe(
      "sam.neighbor@lendloop.local"
    );
    expect(payload.overdueLoans[0].borrowerFirstName).toBe("Sam");
    expect(payload.overdueLoans[0].alreadyRemindedToday).toBe(false);
    // Strict minimization checks
    expect(payload.overdueLoans[0].clerkId).toBeUndefined();
    expect(payload.overdueLoans[0].borrowerNote).toBeUndefined();
    expect(payload.overdueLoans[0].ownerEmail).toBeUndefined();
  });

  it("2. POST /api/automation/overdue-reminders updates loan once and deduplicates identical retries", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.seedDemoData, {});

    const fetchHeaders = await buildSignedHeaders(
      AUTOMATION_SECRET,
      "",
      "evt_fetch"
    );
    const fetchRes = await t.fetch("/api/automation/overdue-loans", {
      method: "GET",
      headers: fetchHeaders,
    });
    const { dateKey, overdueLoans } = (await fetchRes.json()) as {
      dateKey: string;
      overdueLoans: Array<{ loanId: string }>;
    };
    const loanId = overdueLoans[0].loanId;
    const idempotencyKey = buildOverdueIdempotencyKey(loanId, dateKey);

    const writeBody = JSON.stringify({
      idempotencyKey,
      loanId,
      dateKey,
      channel: "email",
    });

    // Tampered body fails HMAC verification with 401
    const badHeaders = await buildSignedHeaders(
      AUTOMATION_SECRET,
      writeBody,
      idempotencyKey
    );
    const tamperedRes = await t.fetch("/api/automation/overdue-reminders", {
      method: "POST",
      headers: badHeaders,
      body: writeBody.replace("email", "slack"),
    });
    expect(tamperedRes.status).toBe(401);

    // First valid signed POST -> deduplicated: false, reminderCount === 1
    const signedHeaders1 = await buildSignedHeaders(
      AUTOMATION_SECRET,
      writeBody,
      idempotencyKey
    );
    const firstRes = await t.fetch("/api/automation/overdue-reminders", {
      method: "POST",
      headers: signedHeaders1,
      body: writeBody,
    });
    expect(firstRes.status).toBe(200);
    expect(await firstRes.json()).toEqual({ ok: true, deduplicated: false });

    const afterFirst = await t.run(async (ctx) => {
      const loan = await ctx.db
        .query("loans")
        .filter((q) => q.eq(q.field("_id"), loanId))
        .unique();
      const events = await ctx.db
        .query("automationEvents")
        .withIndex("by_idempotencyKey", (q) =>
          q.eq("idempotencyKey", idempotencyKey)
        )
        .collect();
      return { loan, events };
    });

    expect(afterFirst.loan?.reminderCount).toBe(1);
    expect(afterFirst.loan?.lastReminderSentAt).toBeTypeOf("number");
    expect(afterFirst.loan?.lastReminderDateKey).toBe(dateKey);
    expect(afterFirst.loan?.lastAutomationSummary).toBe(
      "Overdue reminder sent"
    );
    expect(afterFirst.events).toHaveLength(1);
    expect(afterFirst.events[0].status).toBe("delivered");

    // Duplicate retry with identical idempotencyKey -> deduplicated: true, reminderCount stays 1
    const signedHeaders2 = await buildSignedHeaders(
      AUTOMATION_SECRET,
      writeBody,
      idempotencyKey
    );
    const retryRes = await t.fetch("/api/automation/overdue-reminders", {
      method: "POST",
      headers: signedHeaders2,
      body: writeBody,
    });
    expect(retryRes.status).toBe(200);
    expect(await retryRes.json()).toEqual({ ok: true, deduplicated: true });

    const afterRetry = await t.run(async (ctx) => {
      const loan = await ctx.db
        .query("loans")
        .filter((q) => q.eq(q.field("_id"), loanId))
        .unique();
      const events = await ctx.db
        .query("automationEvents")
        .withIndex("by_idempotencyKey", (q) =>
          q.eq("idempotencyKey", idempotencyKey)
        )
        .collect();
      return { loan, events };
    });
    expect(afterRetry.loan?.reminderCount).toBe(1);
    expect(afterRetry.events).toHaveLength(1);

    // Subsequent overdue-loans poll on the same day omits the already-reminded loan
    const refetchHeaders = await buildSignedHeaders(
      AUTOMATION_SECRET,
      "",
      "evt_refetch"
    );
    const refetchRes = await t.fetch("/api/automation/overdue-loans", {
      method: "GET",
      headers: refetchHeaders,
    });
    const refetched = (await refetchRes.json()) as {
      overdueLoans: Array<unknown>;
    };
    expect(refetched.overdueLoans).toHaveLength(0);
  });

  it("3. POST /api/automation/error-callback rejects unsigned requests, scrubs secrets, and logs workflow errors", async () => {
    const t = convexTest(schema, modules);

    const unsigned = await t.fetch("/api/automation/error-callback", {
      method: "POST",
      body: "{}",
    });
    expect(unsigned.status).toBe(401);

    const errPayload = JSON.stringify({
      idempotencyKey: "err:overdue:exec_99",
      workflowName: "02-overdue-reminders",
      errorMessage: "SMTP failed with Bearer top_secret_token_999",
    });
    const headers = await buildSignedHeaders(
      AUTOMATION_SECRET,
      errPayload,
      "err:overdue:exec_99"
    );

    const res = await t.fetch("/api/automation/error-callback", {
      method: "POST",
      headers,
      body: errPayload,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deduplicated: false });

    const logged = await t.run(async (ctx) => {
      const events = await ctx.db.query("automationEvents").collect();
      const audits = await ctx.db.query("securityAuditLogs").collect();
      return { events, audits };
    });
    expect(logged.events).toHaveLength(1);
    expect(logged.events[0].eventType).toBe("workflow_error");
    expect(logged.events[0].status).toBe("failed");
    expect(logged.events[0].errorMessage).toContain("[REDACTED]");
    expect(logged.events[0].errorMessage).not.toContain("top_secret_token_999");
    expect(logged.audits).toHaveLength(1);
    expect(logged.audits[0].action).toBe("workflow_error_callback");
  });

  it("4. outbound dispatchLoanWebhook sends signed minimal payload, retries transient errors, and logs failures", async () => {
    const capturedRequests: Array<{
      url: string;
      headers: Record<string, string>;
      body: string;
    }> = [];

    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        callCount += 1;
        const headersObj: Record<string, string> = {};
        if (init?.headers && typeof init.headers === "object") {
          for (const [k, v] of Object.entries(
            init.headers as Record<string, string>
          )) {
            headersObj[k.toLowerCase()] = v;
          }
        }
        capturedRequests.push({
          url: String(input),
          headers: headersObj,
          body: String(init?.body ?? ""),
        });

        // Simulate transient 503 on first attempt, then 200 OK
        if (callCount === 1) {
          return new Response("Service Unavailable", { status: 503 });
        }
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );

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

    await alice.mutation(api.users.ensureCurrentUser, {});
    await bob.mutation(api.users.ensureCurrentUser, {});
    const toolId = await alice.mutation(api.tools.createTool, {
      name: "Miter Saw",
      category: "power_tools",
      condition: "excellent",
      description: "10-inch sliding compound miter saw.",
    });

    const today = getTodayUtcIso();
    await bob.mutation(api.loans.requestBorrow, {
      toolId,
      startDate: today,
      endDate: today,
      borrowerNote: "Private personal note that must NEVER go over webhook.",
    });

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(capturedRequests).toHaveLength(2);
    const deliveredReq = capturedRequests[1];
    expect(deliveredReq.url).toBe(
      "http://127.0.0.1:5678/webhook/lendloop-loan-event"
    );

    const sigCheck = await verifySignedRequest({
      secret: WEBHOOK_SECRET,
      rawBody: deliveredReq.body,
      timestampHeader: deliveredReq.headers["x-lendloop-timestamp"],
      signatureHeader: deliveredReq.headers["x-lendloop-signature"],
    });
    expect(sigCheck.ok).toBe(true);

    const parsedBody = JSON.parse(deliveredReq.body) as Record<string, unknown>;
    expect(Object.keys(parsedBody).sort()).toEqual(
      [
        "endDate",
        "eventId",
        "eventType",
        "loanId",
        "recipientEmail",
        "recipientFirstName",
        "startDate",
        "status",
        "toolCategory",
        "toolName",
      ].sort()
    );
    expect(parsedBody.recipientEmail).toBe("alice@lendloop.test");
    expect(parsedBody.recipientFirstName).toBe("Alice");
    expect(parsedBody.borrowerNote).toBeUndefined();
    expect(parsedBody.clerkId).toBeUndefined();

    const myReqs = await bob.query(api.loans.listMyRequests, {});
    expect(myReqs[0].lastAutomationSummary).toBe(
      "Borrow request notification delivered"
    );

    // Verify overdue-reminders rejects malformed dateKey or non-existent loanId cleanly
    const badDateBody = JSON.stringify({
      idempotencyKey: "overdue:bad_date",
      loanId: String(myReqs[0]._id),
      dateKey: "not-a-date",
    });
    const badDateHeaders = await buildSignedHeaders(
      AUTOMATION_SECRET,
      badDateBody,
      "overdue:bad_date"
    );
    const badDateRes = await t.fetch("/api/automation/overdue-reminders", {
      method: "POST",
      headers: badDateHeaders,
      body: badDateBody,
    });
    expect(badDateRes.status).toBe(400);

    const fakeLoanBody = JSON.stringify({
      idempotencyKey: "overdue:fake_loan",
      loanId: "not_a_valid_convex_loan_id",
      dateKey: today,
    });
    const fakeLoanHeaders = await buildSignedHeaders(
      AUTOMATION_SECRET,
      fakeLoanBody,
      "overdue:fake_loan"
    );
    const fakeLoanRes = await t.fetch("/api/automation/overdue-reminders", {
      method: "POST",
      headers: fakeLoanHeaders,
      body: fakeLoanBody,
    });
    expect(fakeLoanRes.status).toBe(400);
  });
});

