import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { sanitizeEmail, sanitizeSingleLine } from "./sanitize";

export type DbCtx = QueryCtx | MutationCtx;
export type UserRole = "user" | "admin";

export interface NormalizedIdentity {
  clerkId: string;
  email: string;
  emailVerified: boolean;
  name: string;
  resolvedRole: UserRole;
}

/**
 * Resolves user role strictly server-side:
 * - ignores any client arguments
 * - grants "admin" only from a verified Clerk custom JWT claim (`role === "admin"`)
 *   OR when `emailVerified === true` and email matches ADMIN_BOOTSTRAP_EMAIL.
 */
export function resolveServerRole(params: {
  jwtRole?: unknown;
  email?: string;
  emailVerified?: boolean;
  bootstrapAdminEmail?: string;
}): UserRole {
  if (params.jwtRole === "admin") {
    return "admin";
  }
  const normalizedUserEmail = sanitizeEmail(params.email);
  const normalizedBootstrap = sanitizeEmail(params.bootstrapAdminEmail);
  if (
    params.emailVerified === true &&
    normalizedUserEmail &&
    normalizedBootstrap &&
    normalizedUserEmail === normalizedBootstrap
  ) {
    return "admin";
  }
  return "user";
}

export function extractNormalizedIdentity(
  identity: UserIdentity
): NormalizedIdentity {
  const email = sanitizeEmail(identity.email);
  const emailVerified = identity.emailVerified === true;
  const fallbackName = email ? email.split("@")[0] : "Neighbor";
  const rawName =
    identity.name ||
    identity.nickname ||
    [identity.givenName, identity.familyName].filter(Boolean).join(" ") ||
    fallbackName;

  let name = "Neighbor";
  try {
    name = sanitizeSingleLine(rawName, {
      field: "Display name",
      minLength: 1,
      maxLength: 80,
    });
  } catch {
    name = "Neighbor";
  }

  const claims = identity as unknown as Record<string, unknown>;
  const resolvedRole = resolveServerRole({
    jwtRole: claims.role,
    email,
    emailVerified,
    bootstrapAdminEmail: process.env.ADMIN_BOOTSTRAP_EMAIL,
  });

  return {
    clerkId: identity.subject,
    email,
    emailVerified,
    name,
    resolvedRole,
  };
}

export async function getOptionalAuthenticatedUser(
  ctx: DbCtx
): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }
  return await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .unique();
}

export async function getAuthenticatedUserOrThrow(
  ctx: DbCtx
): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "Authentication required.",
    });
  }

  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .unique();

  if (!user) {
    throw new ConvexError({
      code: "USER_NOT_INITIALIZED",
      message: "User profile is still syncing. Please refresh.",
    });
  }

  return user;
}

export const requireAuth = getAuthenticatedUserOrThrow;

export async function requireAdmin(ctx: DbCtx): Promise<Doc<"users">> {
  const user = await getAuthenticatedUserOrThrow(ctx);
  if (user.role !== "admin") {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Admin privileges required for this operation.",
    });
  }
  return user;
}

export function assertOwnership(
  ownerId: Id<"users">,
  callerUserId: Id<"users">,
  message = "You do not have permission to modify this resource."
): void {
  if (ownerId !== callerUserId) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message,
    });
  }
}
