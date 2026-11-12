import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import {
  extractNormalizedIdentity,
  getOptionalAuthenticatedUser,
  requireAdmin,
} from "./lib/auth";
import { sanitizeEmail } from "./lib/sanitize";

/**
 * Syncs the authenticated Clerk user into Convex.
 * Security: ignores any client-supplied role arguments; determines "admin"
 * exclusively server-side via verified Clerk claims or ADMIN_BOOTSTRAP_EMAIL
 * (only when identity.emailVerified === true).
 */
export const ensureCurrentUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "Authentication required.",
      });
    }

    const normalized = extractNormalizedIdentity(identity);
    const now = Date.now();
    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", normalized.clerkId))
      .unique();

    if (existing) {
      const nextRole =
        normalized.resolvedRole === "admin" ? "admin" : existing.role;
      const needsUpdate =
        existing.name !== normalized.name ||
        existing.email !== normalized.email ||
        existing.role !== nextRole;

      if (needsUpdate) {
        await ctx.db.patch(existing._id, {
          name: normalized.name,
          email: normalized.email,
          role: nextRole,
          updatedAt: now,
        });
      }

      if (existing.role !== "admin" && nextRole === "admin") {
        await ctx.db.insert("securityAuditLogs", {
          actorUserId: existing._id,
          actorRole: "admin",
          action: "bootstrap_admin_promoted",
          targetTable: "users",
          targetId: existing._id,
          metadata: JSON.stringify({ via: "verified_identity" }),
          createdAt: now,
        });
      }

      return existing._id;
    }

    const userId = await ctx.db.insert("users", {
      clerkId: normalized.clerkId,
      email: normalized.email,
      name: normalized.name,
      role: normalized.resolvedRole,
      isTrustedLender: false,
      createdAt: now,
      updatedAt: now,
    });

    if (normalized.resolvedRole === "admin") {
      await ctx.db.insert("securityAuditLogs", {
        actorUserId: userId,
        actorRole: "admin",
        action: "bootstrap_admin_created",
        targetTable: "users",
        targetId: userId,
        metadata: JSON.stringify({ via: "verified_identity" }),
        createdAt: now,
      });
    }

    return userId;
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return null;
    }
    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      isTrustedLender: user.isTrustedLender,
    };
  },
});

export const listUsersForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").collect();
    return users
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((u) => ({
        _id: u._id,
        name: u.name,
        email: u.email,
        role: u.role,
        isTrustedLender: u.isTrustedLender,
        createdAt: u.createdAt,
      }));
  },
});

export const toggleTrustedLender = mutation({
  args: {
    userId: v.id("users"),
    isTrustedLender: v.boolean(),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const target = await ctx.db.get(args.userId);
    if (!target) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "User not found.",
      });
    }

    const now = Date.now();
    await ctx.db.patch(args.userId, {
      isTrustedLender: args.isTrustedLender,
      updatedAt: now,
    });

    await ctx.db.insert("securityAuditLogs", {
      actorUserId: admin._id,
      actorRole: admin.role,
      action: args.isTrustedLender
        ? "grant_trusted_lender"
        : "revoke_trusted_lender",
      targetTable: "users",
      targetId: args.userId,
      metadata: JSON.stringify({
        isTrustedLender: args.isTrustedLender,
      }),
      createdAt: now,
    });

    return { ok: true, isTrustedLender: args.isTrustedLender };
  },
});

export const listSecurityAuditLogsForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db
      .query("securityAuditLogs")
      .withIndex("by_createdAt")
      .order("desc")
      .take(50);
  },
});

/**
 * CLI-only internal mutation for promoting/demoting users locally:
 *   npx convex run users:setUserRoleInternal '{"email":"you@example.com","role":"admin"}'
 */
export const setUserRoleInternal = internalMutation({
  args: {
    email: v.string(),
    role: v.union(v.literal("user"), v.literal("admin")),
  },
  handler: async (ctx, args) => {
    const normalizedEmail = sanitizeEmail(args.email);
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .unique();
    if (!user) {
      throw new Error(`No synced user found with email ${normalizedEmail}`);
    }

    const now = Date.now();
    await ctx.db.patch(user._id, {
      role: args.role,
      updatedAt: now,
    });

    await ctx.db.insert("securityAuditLogs", {
      actorUserId: user._id,
      actorRole: "system_cli",
      action: "cli_set_user_role",
      targetTable: "users",
      targetId: user._id,
      metadata: JSON.stringify({ role: args.role }),
      createdAt: now,
    });

    return { userId: user._id, email: user.email, role: args.role };
  },
});
