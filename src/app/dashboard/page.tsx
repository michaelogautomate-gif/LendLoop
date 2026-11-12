"use client";

import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useMutation,
  useQuery,
} from "convex/react";
import {
  Inbox,
  Package,
  Pencil,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { BorrowRequestModal } from "@/components/loans/BorrowRequestModal";
import { LoanListTable } from "@/components/loans/LoanListTable";
import { CategoryFilterBar } from "@/components/tools/CategoryFilterBar";
import { CreateToolModal } from "@/components/tools/CreateToolModal";
import {
  ToolCard,
  type AuthenticatedToolItem,
} from "@/components/tools/ToolCard";
import {
  extractErrorMessage,
  formatCategoryLabel,
  formatConditionLabel,
  type ToolCategory,
  type ToolCondition,
} from "@/lib/utils";

type DashboardTab = "browse" | "listings" | "requests" | "incoming";

function DashboardWorkspace() {
  const me = useQuery(api.users.me);
  const [activeTab, setActiveTab] = useState<DashboardTab>("browse");
  const [selectedCategory, setSelectedCategory] = useState<
    ToolCategory | undefined
  >(undefined);
  const [search, setSearch] = useState("");
  const [borrowTarget, setBorrowTarget] =
    useState<AuthenticatedToolItem | null>(null);
  const [creatingTool, setCreatingTool] = useState(false);
  const [editingTool, setEditingTool] = useState<{
    _id: Id<"tools">;
    name: string;
    category: ToolCategory;
    condition: ToolCondition;
    description: string;
    isAvailable: boolean;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [seedInfo, setSeedInfo] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const catalog = useQuery(
    api.tools.listAuthenticatedCatalog,
    me ? { category: selectedCategory } : "skip"
  );
  const myTools = useQuery(api.tools.listMyTools, me ? {} : "skip");
  const myRequests = useQuery(api.loans.listMyRequests, me ? {} : "skip");
  const incomingRequests = useQuery(
    api.loans.listIncomingRequests,
    me ? {} : "skip"
  );

  const deleteTool = useMutation(api.tools.deleteTool);
  const seedDemo = useMutation(api.seed.seedDemoForCurrentUser);

  const demoSeedEnabled = process.env.NEXT_PUBLIC_ENABLE_DEMO_SEED === "true";

  const filteredTools = (catalog ?? []).filter((t) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.firstName.toLowerCase().includes(q)
    );
  });

  const pendingIncomingCount = (incomingRequests ?? []).filter(
    (l) => l.status === "pending"
  ).length;

  async function handleDeleteOwnTool(toolId: Id<"tools">, name: string) {
    setActionError(null);
    if (!window.confirm(`Delete "${name}" from LendLoop?`)) return;
    try {
      await deleteTool({ toolId });
    } catch (err) {
      setActionError(extractErrorMessage(err));
    }
  }

  async function handleSeedDemo() {
    setActionError(null);
    setSeedInfo(null);
    setSeeding(true);
    try {
      const res = await seedDemo();
      setSeedInfo(
        `Demo ready: ${res.createdTools} tools added${
          res.createdOverdueLoan
            ? " + 1 overdue loan ready for n8n reminder testing."
            : "."
        }`
      );
    } catch (err) {
      setActionError(extractErrorMessage(err));
    } finally {
      setSeeding(false);
    }
  }

  if (me === undefined) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        Syncing your LendLoop profile...
      </div>
    );
  }

  const tabs: Array<{
    id: DashboardTab;
    label: string;
    icon: typeof Wrench;
    badge?: number;
  }> = [
    { id: "browse", label: "Browse All Tools", icon: Wrench },
    { id: "listings", label: "My Listings", icon: Package },
    { id: "requests", label: "My Requests", icon: Send },
    {
      id: "incoming",
      label: "Incoming Requests",
      icon: Inbox,
      badge: pendingIncomingCount > 0 ? pendingIncomingCount : undefined,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-1">
        <nav className="flex gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-medium transition ${
                  active
                    ? "border-emerald-600 text-emerald-700"
                    : "border-transparent text-slate-600 hover:text-slate-900"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
                {tab.badge !== undefined && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {(demoSeedEnabled || me?.role === "admin") && (
          <button
            type="button"
            disabled={seeding}
            onClick={handleSeedDemo}
            className="mb-1.5 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {seeding ? "Seeding..." : "Seed Demo Tools & Overdue Loan"}
          </button>
        )}
      </div>

      {seedInfo && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-900">
          {seedInfo}
        </div>
      )}

      {actionError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800">
          {actionError}
        </div>
      )}

      {activeTab === "browse" && (
        <div className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CategoryFilterBar
              selected={selectedCategory}
              onSelect={setSelectedCategory}
            />
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tools or lenders..."
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
          </div>

          {catalog === undefined ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
              Loading neighborhood catalog...
            </div>
          ) : filteredTools.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
              <p className="text-sm font-medium text-slate-700">
                No matching tools found.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Clear filters or add a tool from &ldquo;My Listings&rdquo;.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredTools.map((tool) => (
                <ToolCard
                  key={tool._id}
                  tool={tool}
                  onRequestBorrow={setBorrowTarget}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "listings" && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                My Listings
              </h2>
              <p className="text-xs text-slate-500">
                Create, edit, pause, or remove your own neighborhood tool
                listings.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCreatingTool(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white shadow-xs hover:bg-emerald-700"
            >
              <Plus className="h-4 w-4" />
              List a Tool
            </button>
          </div>

          {myTools === undefined ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              Loading your listings...
            </div>
          ) : myTools.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
              <p className="text-sm font-medium text-slate-700">
                You haven&apos;t listed any tools yet.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {myTools.map((tool) => (
                <div
                  key={tool._id}
                  className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-xs"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {formatCategoryLabel(tool.category)}
                      </span>
                      <span className="text-xs font-medium text-slate-500">
                        {tool.availabilityStatus === "available"
                          ? "Available"
                          : tool.availabilityStatus === "on_loan"
                            ? "Currently On Loan"
                            : "Paused"}
                      </span>
                    </div>
                    <h3 className="mt-2.5 text-base font-semibold text-slate-900">
                      {tool.name}
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Condition: {formatConditionLabel(tool.condition)}
                    </p>
                    <p className="mt-2 text-sm text-slate-600">
                      {tool.description}
                    </p>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3.5">
                    <span className="text-xs text-slate-500">
                      {tool.pendingCount} pending · {tool.activeApprovedCount}{" "}
                      active
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setEditingTool({
                            _id: tool._id,
                            name: tool.name,
                            category: tool.category,
                            condition: tool.condition,
                            description: tool.description,
                            isAvailable: tool.isAvailable,
                          })
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleDeleteOwnTool(tool._id, tool.name)
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "requests" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              My Requests
            </h2>
            <p className="text-xs text-slate-500">
              Track approval status, return dates, and automated reminder
              activity.
            </p>
          </div>
          <LoanListTable mode="my_requests" loans={myRequests} />
        </div>
      )}

      {activeTab === "incoming" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Incoming Requests
            </h2>
            <p className="text-xs text-slate-500">
              Approve or decline borrow requests on your tools and mark active
              loans returned.
            </p>
          </div>
          <LoanListTable mode="incoming_requests" loans={incomingRequests} />
        </div>
      )}

      {borrowTarget && (
        <BorrowRequestModal
          tool={borrowTarget}
          onClose={() => setBorrowTarget(null)}
          onSuccess={() => setActiveTab("requests")}
        />
      )}

      {creatingTool && (
        <CreateToolModal onClose={() => setCreatingTool(false)} />
      )}
      {editingTool && (
        <CreateToolModal
          existing={editingTool}
          onClose={() => setEditingTool(null)}
        />
      )}
    </div>
  );
}

export default function DashboardPage() {
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
            Sign in required
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Please sign in to access your LendLoop neighborhood dashboard.
          </p>
          <Link
            href="/sign-in"
            className="mt-5 inline-flex rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Go to Sign In
          </Link>
        </div>
      </Unauthenticated>
      <Authenticated>
        <DashboardWorkspace />
      </Authenticated>
    </main>
  );
}

