"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import {
  Authenticated,
  ConvexProviderWithAuth,
  ConvexReactClient,
  useMutation,
} from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { api } from "@convex/_generated/api";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const hasConfiguredClerkKey = Boolean(
  clerkPublishableKey && !clerkPublishableKey.endsWith("_replace_me")
);
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

function useUnconfiguredAuth() {
  return useMemo(
    () => ({
      isLoading: false,
      isAuthenticated: false,
      fetchAccessToken: async () => null,
    }),
    []
  );
}

function UserSyncGate() {
  const ensureCurrentUser = useMutation(api.users.ensureCurrentUser);
  const syncedRef = useRef(false);

  useEffect(() => {
    if (!syncedRef.current) {
      syncedRef.current = true;
      ensureCurrentUser().catch(() => {
        syncedRef.current = false;
      });
    }
  }, [ensureCurrentUser]);

  return null;
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!convex) {
    return (
      <div className="mx-auto mt-16 max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-950">
        <h1 className="text-lg font-semibold">Convex URL not configured</h1>
        <p className="mt-2 text-sm">
          Run{" "}
          <code className="rounded bg-amber-100 px-1.5 py-0.5">
            npx convex dev --local
          </code>{" "}
          and ensure{" "}
          <code className="rounded bg-amber-100 px-1.5 py-0.5">
            NEXT_PUBLIC_CONVEX_URL
          </code>{" "}
          is set in{" "}
          <code className="rounded bg-amber-100 px-1.5 py-0.5">.env.local</code>.
        </p>
      </div>
    );
  }

  if (!hasConfiguredClerkKey) {
    return (
      <ConvexProviderWithAuth client={convex} useAuth={useUnconfiguredAuth}>
        {children}
      </ConvexProviderWithAuth>
    );
  }

  return (
    <ClerkProvider publishableKey={clerkPublishableKey}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <Authenticated>
          <UserSyncGate />
        </Authenticated>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
