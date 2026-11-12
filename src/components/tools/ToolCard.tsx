"use client";

import { CalendarPlus } from "lucide-react";
import type { Id } from "@convex/_generated/dataModel";
import { TrustedLenderBadge } from "@/components/loans/AutomationActivityBadge";
import {
  formatCategoryLabel,
  formatConditionLabel,
  type ToolCategory,
  type ToolCondition,
} from "@/lib/utils";

const AVAILABILITY_BADGE: Record<
  "available" | "on_loan" | "unavailable",
  { label: string; className: string }
> = {
  available: {
    label: "Available",
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  on_loan: {
    label: "On Loan",
    className: "border-amber-200 bg-amber-50 text-amber-800",
  },
  unavailable: {
    label: "Unavailable",
    className: "border-slate-200 bg-slate-100 text-slate-600",
  },
};

export interface AuthenticatedToolItem {
  _id: Id<"tools">;
  name: string;
  category: ToolCategory;
  condition: ToolCondition;
  description: string;
  isAvailable: boolean;
  availabilityStatus: "available" | "on_loan" | "unavailable";
  isOwner: boolean;
  firstName: string;
  ownerName: string;
  isTrustedLender: boolean;
}

export function ToolCard({
  tool,
  onRequestBorrow,
}: {
  tool: AuthenticatedToolItem;
  onRequestBorrow: (tool: AuthenticatedToolItem) => void;
}) {
  const avail = AVAILABILITY_BADGE[tool.availabilityStatus];

  return (
    <article className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-slate-300">
      <div>
        <div className="flex items-start justify-between gap-2">
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
            {formatCategoryLabel(tool.category)}
          </span>
          <span
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${avail.className}`}
          >
            {avail.label}
          </span>
        </div>

        <h3 className="mt-3 text-base font-semibold text-slate-900">
          {tool.name}
        </h3>
        <p className="mt-1 text-xs font-medium text-slate-500">
          Condition: {formatConditionLabel(tool.condition)}
        </p>
        <p className="mt-2.5 text-sm leading-relaxed text-slate-600">
          {tool.description}
        </p>
      </div>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
          <span>Lender:</span>
          <span className="font-medium text-slate-900">{tool.firstName}</span>
          {tool.isTrustedLender && <TrustedLenderBadge />}
        </div>

        <div className="mt-3">
          {tool.isOwner ? (
            <span className="block w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center text-xs font-medium text-slate-500">
              Your listing
            </span>
          ) : !tool.isAvailable ? (
            <span className="block w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center text-xs font-medium text-slate-500">
              Currently paused by owner
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onRequestBorrow(tool)}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700"
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              Request to Borrow
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

