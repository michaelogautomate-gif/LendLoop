"use client";

import { SignInButton } from "@clerk/nextjs";
import { Authenticated, Unauthenticated } from "convex/react";
import { ArrowRight, Lock } from "lucide-react";
import Link from "next/link";
import { PublicToolGrid } from "@/components/tools/PublicToolGrid";

const hasClerkKey = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.endsWith("_replace_me")
);

function PublicCtaButton() {
  if (!hasClerkKey) {
    return (
      <Link
        href="/sign-in"
        className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white shadow-xs transition hover:bg-slate-800"
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
        className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white shadow-xs transition hover:bg-slate-800"
      >
        Sign in to lend or borrow
        <ArrowRight className="h-4 w-4" />
      </button>
    </SignInButton>
  );
}

export default function HomePage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-xs sm:p-10">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
            LendLoop · Neighborhood Tool-Lending Board
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Borrow what you need. Lend what you don&apos;t.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-600">
            See what tools are currently available on your block. Sign in to
            view condition, request borrow dates, list tools of your own, and
            receive automated loan &amp; reminder updates.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Authenticated>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white shadow-xs transition hover:bg-emerald-700"
              >
                Open Dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Authenticated>
            <Unauthenticated>
              <PublicCtaButton />
            </Unauthenticated>

            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
              <Lock className="h-3.5 w-3.5 text-slate-400" />
              Owner details and borrow actions require sign-in
            </span>
          </div>
        </div>
      </section>

      <section className="mt-10 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Currently Available Tools
          </h2>
          <p className="text-sm text-slate-500">
            Public read-only catalog (name and category only)
          </p>
        </div>

        <PublicToolGrid />
      </section>
    </main>
  );
}
