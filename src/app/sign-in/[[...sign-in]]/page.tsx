import { SignIn } from "@clerk/nextjs";
import Link from "next/link";

const hasClerkKey = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.endsWith("_replace_me")
);

export default function SignInPage() {
  if (!hasClerkKey) {
    return (
      <main className="mx-auto mt-16 max-w-lg rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-950">
        <h1 className="text-lg font-semibold">Clerk keys not configured</h1>
        <p className="mt-2 text-sm">
          Add your Clerk Publishable &amp; Secret keys to{" "}
          <code className="rounded bg-amber-100 px-1.5 py-0.5">.env.local</code>{" "}
          and sync <code className="rounded bg-amber-100 px-1.5 py-0.5">CLERK_JWT_ISSUER_DOMAIN</code>{" "}
          with <code className="rounded bg-amber-100 px-1.5 py-0.5">npm run convex:env</code>.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white"
        >
          Back to Public Board
        </Link>
      </main>
    );
  }

  return (
    <main className="flex min-h-[calc(100vh-72px)] items-center justify-center px-4 py-12">
      <SignIn />
    </main>
  );
}
