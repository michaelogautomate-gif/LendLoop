"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { formatCategoryLabel } from "@/lib/utils";

export function PublicToolGrid() {
  const publicTools = useQuery(api.tools.listPublicCatalog);

  if (publicTools === undefined) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        Loading available neighborhood tools...
      </div>
    );
  }

  if (publicTools.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
        <p className="text-sm font-medium text-slate-700">
          No available tools listed right now.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Sign in to list the first tool in your neighborhood.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {publicTools.map((tool) => (
        <article
          key={tool._id}
          data-testid="public-tool-card"
          className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-xs"
        >
          <span className="font-medium text-slate-900">{tool.name}</span>
          <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-700">
            {formatCategoryLabel(tool.category)}
          </span>
        </article>
      ))}
    </div>
  );
}

