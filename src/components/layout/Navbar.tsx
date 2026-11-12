"use client";

import { SignInButton, UserButton } from "@clerk/nextjs";
import { Authenticated, Unauthenticated, useQuery } from "convex/react";
import { ArrowRight, LayoutDashboard, Shield, Wrench } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@convex/_generated/api";
import { TrustedLenderBadge } from "@/components/loans/AutomationActivityBadge";
import { cn } from "@/lib/utils";

const hasClerkKey = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.endsWith("_replace_me")
);

function SignedOutAction() {
  if (!hasClerkKey) {
    return (
      <Link
        href="/sign-in"
        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-xs transition hover:bg-emerald-700"
      >
        Sign in to lend or borrow
        <ArrowRight className="h-4 w-4" />
      </Link>
    );
  }

  return (
    <SignInButton mode="modal">
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-xs transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
      >
        Sign in to lend or borrow
        <ArrowRight className="h-4 w-4" />
      </button>
    </SignInButton>
  );
}

function AuthenticatedNavControls() {
  const me = useQuery(api.users.me);
  const pathname = usePathname();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link
        href="/dashboard"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition",
          pathname?.startsWith("/dashboard")
            ? "bg-emerald-50 text-emerald-800"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        )}
      >
        <LayoutDashboard className="h-4 w-4" />
        Dashboard
      </Link>

      {me?.role === "admin" && (
        <Link
          href="/admin"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition",
            pathname?.startsWith("/admin")
              ? "bg-indigo-50 text-indigo-800"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          )}
        >
          <Shield className="h-4 w-4" />
          Admin
        </Link>
      )}

      {me && (
        <div className="hidden items-center gap-2 text-xs sm:flex">
          <span className="font-medium text-slate-700">{me.name}</span>
          {me.role === "admin" && (
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 font-semibold text-indigo-800">
              admin
            </span>
          )}
          {me.isTrustedLender && <TrustedLenderBadge />}
        </div>
      )}

      {hasClerkKey && <UserButton />}
    </div>
  );
}

export function Navbar() {
  return (
    <header className="border-b border-slate-200/80 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-xs">
            <Wrench className="h-4 w-4" />
          </div>
          <div>
            <span className="text-lg font-bold tracking-tight text-slate-900">
              LendLoop
            </span>
            <p className="hidden text-xs text-slate-500 sm:block">
              Borrow what you need. Lend what you don&apos;t.
            </p>
          </div>
        </Link>

        <Authenticated>
          <AuthenticatedNavControls />
        </Authenticated>
        <Unauthenticated>
          <SignedOutAction />
        </Unauthenticated>
      </div>
    </header>
  );
}

