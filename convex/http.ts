import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { verifySignedRequest } from "./lib/crypto";

const http = httpRouter();

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

async function verifyInboundAutomationRequest(
  request: Request,
  rawBody: string
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const secret = process.env.CONVEX_AUTOMATION_SECRET || "";
  const verification = await verifySignedRequest({
    secret,
    rawBody,
    timestampHeader: request.headers.get("x-lendloop-timestamp"),
    signatureHeader: request.headers.get("x-lendloop-signature"),
  });

  if (!verification.ok) {
    return {
      ok: false,
      response: jsonResponse(
        { error: verification.reason || "Unauthorized" },
        401
      ),
    };
  }

  return { ok: true };
}

http.route({
  path: "/api/health",
  method: "GET",
  handler: httpAction(async () => {
    return jsonResponse({ ok: true, service: "lendloop-convex" }, 200);
  }),
});

http.route({
  path: "/api/automation/overdue-loans",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = await verifyInboundAutomationRequest(request, "");
    if (!auth.ok) return auth.response;

    const result = await ctx.runQuery(
      internal.automation.getOverdueLoansInternal,
      {}
    );
    return jsonResponse(result, 200);
  }),
});

http.route({
  path: "/api/automation/overdue-reminders",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const auth = await verifyInboundAutomationRequest(request, rawBody);
    if (!auth.ok) return auth.response;

    let parsed: {
      idempotencyKey?: unknown;
      loanId?: unknown;
      dateKey?: unknown;
      channel?: unknown;
    };
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ error: "Invalid JSON payload" }, 400);
    }

    if (
      typeof parsed.idempotencyKey !== "string" ||
      !parsed.idempotencyKey.trim() ||
      typeof parsed.loanId !== "string" ||
      !parsed.loanId.trim() ||
      typeof parsed.dateKey !== "string" ||
      !parsed.dateKey.trim()
    ) {
      return jsonResponse(
        { error: "idempotencyKey, loanId, and dateKey are required strings" },
        400
      );
    }

    try {
      const result = await ctx.runMutation(
        internal.automation.recordOverdueReminderInternal,
        {
          idempotencyKey: parsed.idempotencyKey.trim(),
          loanId: parsed.loanId.trim(),
          dateKey: parsed.dateKey.trim(),
          channel:
            typeof parsed.channel === "string" && parsed.channel.trim()
              ? parsed.channel.trim()
              : "email",
        }
      );
      return jsonResponse(result, 200);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to record reminder";
      return jsonResponse({ error: message }, 400);
    }
  }),
});

http.route({
  path: "/api/automation/event-ack",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const auth = await verifyInboundAutomationRequest(request, rawBody);
    if (!auth.ok) return auth.response;

    let parsed: {
      idempotencyKey?: unknown;
      loanId?: unknown;
      status?: unknown;
      summary?: unknown;
    };
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ error: "Invalid JSON payload" }, 400);
    }

    if (
      typeof parsed.idempotencyKey !== "string" ||
      !parsed.idempotencyKey.trim()
    ) {
      return jsonResponse({ error: "idempotencyKey is required" }, 400);
    }

    const status = parsed.status === "failed" ? "failed" : "delivered";
    const result = await ctx.runMutation(
      internal.automation.recordEventAckInternal,
      {
        idempotencyKey: parsed.idempotencyKey.trim(),
        loanId: typeof parsed.loanId === "string" ? parsed.loanId : undefined,
        status,
        summary:
          typeof parsed.summary === "string" ? parsed.summary : undefined,
      }
    );
    return jsonResponse(result, 200);
  }),
});

http.route({
  path: "/api/automation/error-callback",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const auth = await verifyInboundAutomationRequest(request, rawBody);
    if (!auth.ok) return auth.response;

    let parsed: {
      idempotencyKey?: unknown;
      workflowName?: unknown;
      errorMessage?: unknown;
      loanId?: unknown;
    };
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ error: "Invalid JSON payload" }, 400);
    }

    const result = await ctx.runMutation(
      internal.automation.recordWorkflowErrorInternal,
      {
        idempotencyKey:
          typeof parsed.idempotencyKey === "string" &&
          parsed.idempotencyKey.trim()
            ? parsed.idempotencyKey.trim()
            : `error:${Date.now()}`,
        workflowName:
          typeof parsed.workflowName === "string" && parsed.workflowName.trim()
            ? parsed.workflowName.trim()
            : "unknown",
        errorMessage:
          typeof parsed.errorMessage === "string" && parsed.errorMessage.trim()
            ? parsed.errorMessage.trim()
            : "Unhandled workflow error",
        loanId: typeof parsed.loanId === "string" ? parsed.loanId : undefined,
      }
    );

    return jsonResponse(result, 200);
  }),
});

export default http;
