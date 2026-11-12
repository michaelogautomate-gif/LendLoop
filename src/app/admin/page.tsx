"use client";

import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useQuery,
} from "convex/react";
import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { api } from "@convex/_generated/api";
import { AdminControls } from "@/components/admin/AdminControls";

function AdminGate() {
  const me = useQuery(api.users.me);

  if (me === undefined) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        Checking admin authorization...
      </div>
    );
  }

  if (!me || me.role !== "admin") {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-rose-200 bg-rose-50 p-8 text-center text-rose-950">
        <ShieldAlert className="mx-auto h-8 w-8 text-rose-600" />
        <h1 className="mt-3 text-lg font-semibold">403 — Admin Access Only</h1>
        <p className="mt-2 text-sm text-rose-800">
          Your account has standard <code className="font-mono">user</code>{" "}
          privileges. Admin actions are enforced inside Convex backend
          functions.
        </p>
        <Link
          href="/dashboard"
          className="mt-5 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Return to Dashboard
        </Link>
      </div>
    );
  }

  return <AdminControls />;
}

export default function AdminPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <AuthLoading>
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          Authenticating...
        </div>
      </AuthLoading>
      <Unauthenticated>
        <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center">
          <h1 className="text-lg font-semibold text-slate-900">
            Admin sign-in required
          </h1>
          <Link
            href="/sign-in"
            className="mt-4 inline-flex rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Go to Sign In
          </Link>
        </div>
      </Unauthenticated>
      <Authenticated>
        <AdminGate />
      </Authenticated>
    </main>
  );
}

